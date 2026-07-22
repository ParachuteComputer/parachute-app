import type { LensDB } from "@/lib/sync/db";
import { isLocalId } from "@/lib/sync/id-map";
import type { VaultClient } from "@/lib/vault/client";
import { MIRROR_CEILING_BYTES, type MirrorEvictResult, evictOverCeiling } from "./evict";
import { collectProtectedIds, diffMirror, makeIsProtected } from "./reconcile";
import {
  clearMirrorCursor,
  getMirrorCursor,
  getMirrorLastSweepAt,
  getMirrorLastSyncedAt,
  listMirrorNotes,
  removeMirrorNote,
  removeMirrorNotes,
  setMirrorCursor,
  setMirrorLastSweepAt,
  setMirrorLastSyncedAt,
  setMirrorState,
  setMirrorTags,
  upsertMirrorNote,
  upsertMirrorNotes,
} from "./store";
import type { MirrorState } from "./types";

// The mirror walks an UNFILTERED cursor and asks for the full shape — bodies,
// links, and attachment rows — so the local copy is complete enough to READ
// offline (Wave 3). Cursor mode is query-hash-bound, so this filter set must
// stay constant; changing it invalidates every stored cursor (the engine
// recovers by re-walking, but avoid churn).
const MIRROR_QUERY: Parameters<VaultClient["queryNotesCursor"]>[0] = {
  includeContent: true,
  includeLinks: true,
  includeAttachments: true,
};

// The reconcile sweep's ENUMERATION query — id + updatedAt only (no bodies).
// This is the "what does the server have RIGHT NOW" probe; a lean shape lets a
// large vault enumerate in a handful of requests. Also the shape of the live
// remove-subscription (an unfiltered remove == a real delete).
const LEAN_QUERY: Parameters<VaultClient["queryNotesCursor"]>[0] = {
  includeContent: false,
  includeLinks: false,
  includeAttachments: false,
};

const DEFAULT_TICK_MS = 60_000;
const DEFAULT_PAGE_LIMIT = 200;
// The enumeration walk asks for big pages — the full id set is what matters and
// a lean row is cheap (Aaron's ~3400-note vault = ~4 requests at 1000).
const DEFAULT_SWEEP_ENUM_LIMIT = 1000;
// At most one full sweep per this window across app starts (throttled via the
// persisted lastSweepAt). A cursor-error re-walk forces one regardless.
const DEFAULT_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Hard ceiling on pages walked in a SINGLE drain / enumeration — belt against a
// non-terminating cursor walk (a broken client or daemon that keeps handing back
// rows without ever advancing to exhaustion). A healthy vault exhausts in orders
// of magnitude fewer pages (Aaron's ~3400 notes = ~17 pages at 200); at 1000
// pages this is well past any realistic vault, so tripping it means the walk is
// genuinely stuck and we bail loud rather than spin forever.
const MAX_DRAIN_PAGES = 1000;

// The client capability the mirror needs. `queryNotesCursor` is the only hard
// requirement (Wave 1); `getNote` (backfill), `listTags` (offline filters), and
// `subscribe` (live removes) are optional so a Wave-1-shaped mock still
// satisfies the type and the engine degrades gracefully when one is absent. The
// real VaultClient supplies all four.
export type MirrorClient = Pick<VaultClient, "queryNotesCursor"> &
  Partial<Pick<VaultClient, "getNote" | "listTags" | "subscribe">>;

export interface MirrorContext {
  client: MirrorClient;
  vaultId: string;
}

export interface MirrorEngineOptions {
  db: LensDB;
  // Resolves the client + vault to mirror on each tick. Null (no active vault /
  // no token) pauses the engine; the timer keeps running for when state changes.
  // The mirror is active-vault only — switching vaults just means the next tick
  // hydrates the other vault from its own stored cursor.
  resolveContext: () => MirrorContext | null;
  tickIntervalMs?: number;
  pageLimit?: number;
  // Hard ceiling on pages walked in a single drain / enumeration — the belt
  // against a non-terminating cursor walk. Defaults to MAX_DRAIN_PAGES; overridable
  // mainly so tests can trip it cheaply.
  maxDrainPages?: number;
  // Page size for the reconcile sweep's lean enumeration walk.
  sweepEnumLimit?: number;
  // Minimum spacing between reconcile sweeps (throttle). A cursor-error re-walk
  // forces a sweep regardless.
  sweepIntervalMs?: number;
  // Per-vault storage ceiling for the mirror (bytes). Past it, the post-drain
  // eviction drops the oldest note bodies. Defaults to MIRROR_CEILING_BYTES.
  ceilingBytes?: number;
  // Fired on terminal transitions (live / error) and, on a COLD hydration only
  // (first-ever sync of this vault), on entering "hydrating" — so a status
  // consumer learns the first-hydration progress without being spammed by the
  // transient hydrating→live a warm poll passes through every tick.
  onStateChange?: (vaultId: string, state: MirrorState) => void;
  // Cumulative notes written so far during a COLD hydration (first-ever sync),
  // emitted after each page so a one-time "Saving your vault for offline · {n}"
  // progress line can tick. Not emitted on warm polls.
  onProgress?: (vaultId: string, done: number) => void;
}

export interface MirrorSyncResult {
  pagesApplied: number;
  notesApplied: number;
  // True if a stored cursor was rejected and we re-walked from "".
  reWalked: boolean;
  // Set instead of the counts when the tick did no work.
  skipped?: "in-flight" | "offline" | "no-context" | "locked";
  // Set when the drain threw (state persisted as "error").
  error?: string;
}

// Outcome of a reconcile sweep. `aborted` is set (and the counts are 0) when a
// safety guard tripped — either the sweep didn't run at all (in-flight /
// offline / no-context / locked) or the lean enumeration was NOT provably
// complete, so the diff was refused rather than risk a mass-delete on partial
// data.
export interface MirrorSweepResult {
  deleted: number;
  backfilled: number;
  refetched: number;
  // Size of the enumerated server-id set (0 when the walk failed/was empty).
  enumerated: number;
  aborted?:
    | "in-flight"
    | "offline"
    | "no-context"
    | "locked"
    | "incomplete-enumeration"
    | "empty-enumeration";
}

// A stored cursor the server won't accept — invalidated, or bound to a
// different query hash than the one we're sending now. The SDK surfaces a 400
// as a plain Error whose message carries the response body (which holds the
// structured `error_type`), so we match on the tokens.
export function isCursorRejection(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /cursor_invalid|cursor_query_mismatch/i.test(err.message);
}

export class MirrorEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  // In-tab guard so overlapping triggers (interval + visibility + online firing
  // together) don't run concurrent drains. Cross-TAB safety is the Web Lock.
  private syncing = false;
  // Separate in-tab guard for the sweep — it runs AFTER a drain (outside the
  // drain's lock section) so a re-entrant lock acquisition can't deadlock.
  private sweeping = false;
  // In-tab guard for the eviction pass (runs after the sweep, same reasoning).
  private evicting = false;
  // The live remove-subscription, tracked by the vault it's bound to so a vault
  // switch tears the old socket down and opens a fresh one.
  private subscription: { vaultId: string; unsubscribe: () => void } | null = null;
  private readonly db: LensDB;
  private readonly tickMs: number;
  private readonly pageLimit: number;
  private readonly maxDrainPages: number;
  private readonly sweepEnumLimit: number;
  private readonly sweepIntervalMs: number;
  private readonly ceilingBytes: number;
  private readonly onlineListener: () => void;
  private readonly visibilityListener: () => void;
  // In-flight promise from the most recent trigger; tests await it.
  public lastRun: Promise<MirrorSyncResult> | null = null;

  constructor(private readonly opts: MirrorEngineOptions) {
    this.db = opts.db;
    this.tickMs = opts.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.pageLimit = opts.pageLimit ?? DEFAULT_PAGE_LIMIT;
    this.maxDrainPages = opts.maxDrainPages ?? MAX_DRAIN_PAGES;
    this.sweepEnumLimit = opts.sweepEnumLimit ?? DEFAULT_SWEEP_ENUM_LIMIT;
    this.sweepIntervalMs = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.ceilingBytes = opts.ceilingBytes ?? MIRROR_CEILING_BYTES;
    this.onlineListener = () => {
      this.lastRun = this.syncOnce();
    };
    this.visibilityListener = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        this.lastRun = this.syncOnce();
      }
    };
  }

  start(): void {
    if (this.timer) return;
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onlineListener);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.visibilityListener);
    }
    this.timer = setInterval(() => {
      this.lastRun = this.syncOnce();
    }, this.tickMs);
    // Hydrate immediately on start (cold-launch catch-up); tests await lastRun.
    this.lastRun = this.syncOnce();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onlineListener);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityListener);
    }
    this.teardownSubscription();
  }

  get isSyncing(): boolean {
    return this.syncing;
  }

  async syncOnce(): Promise<MirrorSyncResult> {
    const empty: MirrorSyncResult = { pagesApplied: 0, notesApplied: 0, reWalked: false };
    if (this.syncing) return { ...empty, skipped: "in-flight" };
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { ...empty, skipped: "offline" };
    }
    const ctx = this.opts.resolveContext();
    if (!ctx) {
      // No active vault (logout / vault forgotten) — drop any live socket so it
      // doesn't outlive its vault.
      this.teardownSubscription();
      return { ...empty, skipped: "no-context" };
    }
    // Keep the live remove-subscription bound to the active vault. Cheap no-op
    // when already subscribed to this vault.
    this.ensureSubscription(ctx);
    this.syncing = true;
    try {
      const result = await this.withVaultLock(
        ctx.vaultId,
        () => ({ ...empty, skipped: "locked" as const }),
        () => this.drainCursor(ctx.client, ctx.vaultId),
      );
      // Reconcile AFTER the drain's lock section has released (a fresh lock
      // acquisition inside a held lock would deadlock — Web Locks aren't
      // reentrant). Only after a clean drain, and only when due.
      await this.maybeSweep(ctx, result);
      // Then bring the mirror under its storage ceiling (drops oldest bodies).
      // Also outside the drain lock, and only after a clean drain.
      await this.maybeEvict(result);
      return result;
    } catch (err) {
      // syncOnce runs fire-and-forget from the tick interval + the online /
      // visibility listeners (and directly from Settings "Sync now"), so it must
      // NEVER reject — an escaped rejection becomes an unhandled promise
      // rejection. drainCursor already catches its own drain/network errors and
      // records the error state; this backstops the rare throws OUTSIDE that
      // guard, chiefly a torn-down or evicted IndexedDB throwing from the
      // pre-drain cursor reads or the error-state write. Resolve to an error
      // result instead of throwing.
      return { ...empty, error: err instanceof Error ? err.message : String(err) };
    } finally {
      this.syncing = false;
    }
  }

  // Only one tab operates on a given vault at a time. `ifAvailable` means a tab
  // that can't get the lock (another holds it) skips instead of queuing behind
  // it. Degrades to running directly where Web Locks is unavailable (older
  // browsers, jsdom under tests). Generic so the drain and the sweep share the
  // same per-vault lock name.
  private async withVaultLock<T>(
    vaultId: string,
    onLocked: () => T,
    fn: () => Promise<T>,
  ): Promise<T> {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks?.request) return fn();
    return locks.request(`mirror:${vaultId}`, { ifAvailable: true }, async (lock) => {
      if (!lock) return onLocked();
      return fn();
    });
  }

  private async drainCursor(
    client: MirrorContext["client"],
    vaultId: string,
  ): Promise<MirrorSyncResult> {
    // Persisted always. A COLD hydration (no stored cursor AND no prior
    // successful sync) is the first-ever fill — emit the hydrating transition +
    // progress so the one-time "Saving your vault for offline" line can tick. A
    // warm poll passes through hydrating→live silently (no emit) so the status
    // line stays "synced".
    let cursor = (await getMirrorCursor(this.db, vaultId)) ?? "";
    const cold = cursor === "" && (await getMirrorLastSyncedAt(this.db, vaultId)) === undefined;
    const hydrating: MirrorState = { phase: "hydrating" };
    await setMirrorState(this.db, vaultId, hydrating);
    if (cold) {
      this.opts.onStateChange?.(vaultId, hydrating);
      this.opts.onProgress?.(vaultId, 0);
    }
    let pagesApplied = 0;
    let notesApplied = 0;
    let reWalked = false;

    try {
      // Set ONLY on a clean empty-page exhaustion — the sole exit that stamps
      // the completion watermark below. A no-advance stop or a thrown contract
      // violation leaves this false so a partial mirror never reads as "synced".
      let exhausted = false;
      while (true) {
        const sent = cursor;
        let page: { items: unknown[]; nextCursor?: string };
        try {
          page = await client.queryNotesCursor(MIRROR_QUERY, sent, this.pageLimit);
        } catch (err) {
          if (!reWalked && isCursorRejection(err)) {
            await clearMirrorCursor(this.db, vaultId);
            cursor = "";
            reWalked = true;
            continue;
          }
          throw err;
        }

        const items = page.items ?? [];
        if (items.length > 0) {
          await upsertMirrorNotes(
            this.db,
            vaultId,
            items as Parameters<typeof upsertMirrorNotes>[2],
          );
          notesApplied += items.length;
          if (cold) this.opts.onProgress?.(vaultId, notesApplied);
        }
        // CONTRACT VIOLATION → FAIL LOUD. A NON-empty page that carries no
        // next_cursor means the client/daemon isn't speaking cursor pagination
        // at all (e.g. a stale surface-client that only read an `X-Next-Cursor`
        // header the self-host daemon never sends — the exact 0.3.5 bug). Every
        // "page" is then the same first rows forever. THROW into the error state
        // instead of looping — and crucially WITHOUT stamping the completion
        // watermark (the mirror stays cold, not a false "complete"). This is
        // distinct from the no-advance case below, where a cursor IS present.
        if (items.length > 0 && page.nextCursor === undefined) {
          throw new Error(
            `mirror drain: ${items.length}-row page returned no next_cursor — cursor pagination contract violated (stale surface-client?)`,
          );
        }
        // Advance + PERSIST the watermark after EVERY page (idempotent upserts
        // + a per-page cursor commit = a killed app resumes exactly here).
        if (page.nextCursor !== undefined) {
          cursor = page.nextCursor;
          await setMirrorCursor(this.db, vaultId, cursor);
        }
        pagesApplied += 1;
        // Terminate on an empty page — the watermark is never falsy, so an
        // empty page (not a falsy cursor) is the only CLEAN end signal, and the
        // ONLY exit that marks the mirror complete below.
        if (items.length === 0) {
          exhausted = true;
          break;
        }
        // NO-ADVANCE GUARD: a NON-empty page whose next_cursor didn't move can't
        // be walked further (a cursor IS present here — the contract throw above
        // already handled the absent-cursor case). Stop, but do NOT mark
        // complete; the items are already upserted (idempotent) and the next
        // poll retries from the same watermark.
        if (page.nextCursor === sent) break;
        // HARD PAGE CAP — belt against any other non-terminating walk. A healthy
        // vault exhausts far sooner; tripping this means the walk is stuck.
        if (pagesApplied >= this.maxDrainPages) {
          throw new Error(
            `mirror drain: exceeded ${this.maxDrainPages} pages without exhausting the cursor`,
          );
        }
      }

      // COMPLETION watermark ONLY on a clean empty-page exhaustion (#79 item 1):
      // a no-advance stop leaves `exhausted` false and must not mark the mirror
      // synced (a stamped watermark would make a partial mirror look complete +
      // flip `cold` off, suppressing the re-hydrate).
      if (exhausted) {
        await setMirrorLastSyncedAt(this.db, vaultId, Date.now());
      }
      const live: MirrorState = { phase: "live" };
      await setMirrorState(this.db, vaultId, live);
      this.opts.onStateChange?.(vaultId, live);
      return { pagesApplied, notesApplied, reWalked };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errored: MirrorState = { phase: "error", lastError: message };
      await setMirrorState(this.db, vaultId, errored);
      this.opts.onStateChange?.(vaultId, errored);
      return { pagesApplied, notesApplied, reWalked, error: message };
    }
  }

  // ---------- reconcile sweep ----------

  // Run a sweep after a drain when one is due. The cursor tells us what CHANGED
  // (created/updated) but never what was DELETED, so a periodic full-ID diff is
  // the only way a server-side delete leaves the mirror. Triggered:
  //   - after the FIRST successful hydration (no lastSweepAt yet), and
  //   - on any later clean drain once the throttle window has elapsed, and
  //   - immediately after a cursor-error re-walk (state may be stale).
  // Skipped when the drain errored / was itself skipped.
  private async maybeSweep(ctx: MirrorContext, result: MirrorSyncResult): Promise<void> {
    if (result.error || result.skipped) return;
    const lastSweepAt = await getMirrorLastSweepAt(this.db, ctx.vaultId);
    const due =
      result.reWalked ||
      lastSweepAt === undefined ||
      Date.now() - lastSweepAt >= this.sweepIntervalMs;
    if (!due) return;
    await this.reconcileSweep();
  }

  // ---------- storage-ceiling eviction ----------

  // Run eviction after a clean drain. Skipped when the drain errored / was
  // itself skipped (nothing changed, or we weren't in a position to write).
  private async maybeEvict(result: MirrorSyncResult): Promise<void> {
    if (result.error || result.skipped) return;
    await this.evictIfOverCeiling();
  }

  // Bring the mirror at or under its per-vault ceiling by dropping the oldest
  // note bodies (keeping every index row + preview). Public so it can be
  // triggered/tested directly. Local-only (no network) but held under the same
  // per-vault lock as the drain/sweep so it never races another tab's writes,
  // plus an in-tab guard.
  async evictIfOverCeiling(): Promise<MirrorEvictResult> {
    const skip = (reason: NonNullable<MirrorEvictResult["skipped"]>): MirrorEvictResult => ({
      evicted: 0,
      freedBytes: 0,
      totalBytes: 0,
      skipped: reason,
    });
    if (this.evicting) return skip("in-flight");
    const ctx = this.opts.resolveContext();
    if (!ctx) return skip("no-context");

    this.evicting = true;
    try {
      return await this.withVaultLock(
        ctx.vaultId,
        () => skip("locked"),
        () => evictOverCeiling(this.db, ctx.vaultId, this.ceilingBytes),
      );
    } finally {
      this.evicting = false;
    }
  }

  // The full-ID reconcile. Public so it can be triggered/tested directly. Guards
  // itself against concurrency (in-tab + cross-tab) and no active vault.
  async reconcileSweep(): Promise<MirrorSweepResult> {
    const aborted = (reason: NonNullable<MirrorSweepResult["aborted"]>): MirrorSweepResult => ({
      deleted: 0,
      backfilled: 0,
      refetched: 0,
      enumerated: 0,
      aborted: reason,
    });

    if (this.sweeping) return aborted("in-flight");
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return aborted("offline");
    }
    const ctx = this.opts.resolveContext();
    if (!ctx) return aborted("no-context");

    this.sweeping = true;
    try {
      return await this.withVaultLock(
        ctx.vaultId,
        () => aborted("locked"),
        () => this.runSweep(ctx.client, ctx.vaultId),
      );
    } finally {
      this.sweeping = false;
    }
  }

  private async runSweep(client: MirrorClient, vaultId: string): Promise<MirrorSweepResult> {
    // 1. Enumerate the COMPLETE current server-id set (lean: id + updatedAt).
    const enumeration = await this.enumerateServerIds(client);

    // ABORT-ON-INCOMPLETE — the critical anti-mass-delete guard. If the walk
    // errored or couldn't guarantee full coverage, we did NOT provably see the
    // whole server set, so an "absent" id might just be one we never fetched.
    // Refuse the diff entirely; the next sweep retries. We STILL refresh tags
    // below only when complete (a partial walk says nothing about tags either).
    if (!enumeration.complete) {
      return {
        deleted: 0,
        backfilled: 0,
        refetched: 0,
        enumerated: enumeration.index.size,
        aborted: "incomplete-enumeration",
      };
    }
    // A cleanly-completed but EMPTY enumeration is treated as implausible: never
    // nuke a populated mirror on a zero-result walk (a transient server state, a
    // misconfigured token, etc.). Real deletes reach the mirror via the live
    // remove-subscription + the write path; the sweep stays conservative here.
    if (enumeration.index.size === 0) {
      return {
        deleted: 0,
        backfilled: 0,
        refetched: 0,
        enumerated: 0,
        aborted: "empty-enumeration",
      };
    }

    // 2. Build the EXCLUSION set: never prune un-synced user work. A row is
    //    protected if it's a bare local id (offline-created, not yet synced) OR
    //    its id has a pending queue mutation (edited/created offline, drain not
    //    landed) — including the id-map resolution of a local id that drained.
    const protectedIds = await collectProtectedIds(this.db, vaultId);
    const isProtected = makeIsProtected(protectedIds);

    // 3. Diff the mirror against the enumerated server set.
    const mirrorRows = await listMirrorNotes(this.db, vaultId);
    const diff = diffMirror(mirrorRows, enumeration.index, isProtected);

    // 4. Prune server-deleted notes (excludes anything protected, by construction).
    await removeMirrorNotes(this.db, vaultId, diff.toDelete);

    // 5. Backfill (behind-watermark imports) + refetch (stale bodies): both need
    //    full bodies, so pull each with getNote and upsert. Sequential to stay
    //    gentle on the vault; these sets are small on a healthy mirror.
    let backfilled = 0;
    let refetched = 0;
    if (client.getNote) {
      for (const id of diff.toBackfill) {
        const note = await client.getNote(id, { includeLinks: true, includeAttachments: true });
        if (note) {
          await upsertMirrorNote(this.db, vaultId, note);
          backfilled += 1;
        }
      }
      for (const id of diff.toRefetch) {
        const note = await client.getNote(id, { includeLinks: true, includeAttachments: true });
        if (note) {
          await upsertMirrorNote(this.db, vaultId, note);
          refetched += 1;
        }
      }
    }

    // 6. Refresh the mirrored tag list (Wave 3 offline filters). Best-effort.
    await this.refreshTags(client, vaultId);

    // 7. Watermark the sweep so the throttle holds across app starts.
    await setMirrorLastSweepAt(this.db, vaultId, Date.now());

    return {
      deleted: diff.toDelete.length,
      backfilled,
      refetched,
      enumerated: enumeration.index.size,
    };
  }

  // Walk the LEAN cursor from "" to collect every current server id (→ its
  // updatedAt). Returns `complete: false` on ANY error or a no-advance break, so
  // the caller can refuse to diff against a partial set. Independent of the
  // mirror's stored cursor — always starts fresh and never persists a watermark.
  private async enumerateServerIds(
    client: MirrorClient,
  ): Promise<{ index: Map<string, string>; complete: boolean }> {
    const index = new Map<string, string>();
    let cursor = "";
    let pages = 0;
    try {
      while (true) {
        const sent = cursor;
        const page = await client.queryNotesCursor(LEAN_QUERY, sent, this.sweepEnumLimit);
        const items = (page.items ?? []) as Array<{
          id: string;
          updatedAt?: string;
          createdAt?: string;
        }>;
        for (const it of items) {
          index.set(it.id, it.updatedAt ?? it.createdAt ?? "");
        }
        // CONTRACT: a non-empty page must carry a next_cursor. Its absence (a
        // stale surface-client that never parsed next_cursor — the 0.3.5 bug)
        // means we can't walk further and can't prove full coverage, so mark
        // INCOMPLETE (the sweep then aborts rather than over-delete) and never
        // loop. Mirrors drainCursor's contract guard.
        if (items.length > 0 && page.nextCursor === undefined) {
          return { index, complete: false };
        }
        if (page.nextCursor !== undefined) cursor = page.nextCursor;
        if (items.length === 0) break;
        // NO-ADVANCE on a non-empty page → we can't guarantee full coverage.
        // Mark incomplete so the diff aborts rather than over-delete.
        if (page.nextCursor === sent) {
          return { index, complete: false };
        }
        // HARD PAGE CAP — same belt as the drain; a stuck walk is not a proven
        // enumeration, so bail INCOMPLETE (never mass-delete on it).
        pages += 1;
        if (pages >= this.maxDrainPages) {
          return { index, complete: false };
        }
      }
      return { index, complete: true };
    } catch {
      // Any transport/query failure → NOT a full enumeration. Incomplete so the
      // caller aborts (never mass-delete on a failed walk).
      return { index, complete: false };
    }
  }

  private async refreshTags(client: MirrorClient, vaultId: string): Promise<void> {
    if (!client.listTags) return;
    try {
      const tags = await client.listTags();
      await setMirrorTags(this.db, vaultId, tags);
    } catch {
      // Tags are a convenience for Wave 3's filters — a failure here must never
      // fail the sweep (the deletes/backfills already landed).
    }
  }

  // ---------- live remove-subscription ----------

  // Keep a live subscription bound to the active vault. The cursor can't report
  // deletes; the live-query WS delivers `remove` events while connected, closing
  // the online-window delete gap (the sweep is the cold-start/reconnect net). We
  // subscribe UNFILTERED + LEAN: on an unfiltered query a `remove` means the note
  // was truly deleted (there's no filter it could merely fall out of), and lean
  // keeps the snapshot cheap — content upserts stay the cursor poll's job, so we
  // ignore snapshot/upsert here and act only on removes.
  private ensureSubscription(ctx: MirrorContext): void {
    const client = ctx.client;
    if (!client.subscribe) return;
    if (this.subscription?.vaultId === ctx.vaultId) return;
    this.teardownSubscription();
    const vaultId = ctx.vaultId;
    // The handler RETURNS the prune promise (assignable to the `void` handler
    // type) so tests can await it; the SDK ignores the return at runtime.
    const unsubscribe = client.subscribe(LEAN_QUERY, {
      onSnapshot: () => {},
      onUpsert: () => {},
      onRemove: (id: string) => this.applyWsRemove(vaultId, id),
    });
    this.subscription = { vaultId, unsubscribe };
  }

  private teardownSubscription(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  // Apply a live `remove` to the mirror, honoring the SAME exclusion as the
  // sweep: a server remove of a synced note is safe to prune, but never drop a
  // local-only row or one with an un-synced pending mutation. Never rejects — a
  // failed prune on a WS callback would be an unhandled rejection, and the next
  // sweep reconciles regardless.
  private async applyWsRemove(vaultId: string, id: string): Promise<void> {
    try {
      if (isLocalId(id)) return;
      const protectedIds = await collectProtectedIds(this.db, vaultId);
      if (protectedIds.has(id)) return;
      await removeMirrorNote(this.db, vaultId, id);
    } catch {
      // Swallow — reconciliation is idempotent; the sweep is the backstop.
    }
  }
}
