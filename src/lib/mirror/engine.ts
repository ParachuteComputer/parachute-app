import type { LensDB } from "@/lib/sync/db";
import type { VaultClient } from "@/lib/vault/client";
import {
  clearMirrorCursor,
  getMirrorCursor,
  setMirrorCursor,
  setMirrorLastSyncedAt,
  setMirrorState,
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

const DEFAULT_TICK_MS = 60_000;
const DEFAULT_PAGE_LIMIT = 200;

export interface MirrorContext {
  // Only the cursor method is used; `Pick` keeps the surface tight and mocks
  // trivial. The app's VaultClient (which extends the SDK client) satisfies it.
  client: Pick<VaultClient, "queryNotesCursor">;
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
  // Fired on terminal transitions (live / error) — not on the transient
  // "hydrating" a poll passes through — so a status consumer isn't spammed.
  onStateChange?: (vaultId: string, state: MirrorState) => void;
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
  private readonly db: LensDB;
  private readonly tickMs: number;
  private readonly pageLimit: number;
  private readonly onlineListener: () => void;
  private readonly visibilityListener: () => void;
  // In-flight promise from the most recent trigger; tests await it.
  public lastRun: Promise<MirrorSyncResult> | null = null;

  constructor(private readonly opts: MirrorEngineOptions) {
    this.db = opts.db;
    this.tickMs = opts.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.pageLimit = opts.pageLimit ?? DEFAULT_PAGE_LIMIT;
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
    if (!ctx) return { ...empty, skipped: "no-context" };
    this.syncing = true;
    try {
      return await this.withLock(ctx.vaultId, () => this.drainCursor(ctx.client, ctx.vaultId));
    } finally {
      this.syncing = false;
    }
  }

  // Only one tab hydrates a given vault at a time. `ifAvailable` means a tab
  // that can't get the lock (another holds it) skips this tick instead of
  // queuing behind it. Degrades to running directly where Web Locks is
  // unavailable (older browsers, jsdom under tests).
  private async withLock(
    vaultId: string,
    fn: () => Promise<MirrorSyncResult>,
  ): Promise<MirrorSyncResult> {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks?.request) return fn();
    const empty: MirrorSyncResult = { pagesApplied: 0, notesApplied: 0, reWalked: false };
    return locks.request(`mirror:${vaultId}`, { ifAvailable: true }, async (lock) => {
      if (!lock) return { ...empty, skipped: "locked" as const };
      return fn();
    });
  }

  private async drainCursor(
    client: MirrorContext["client"],
    vaultId: string,
  ): Promise<MirrorSyncResult> {
    // Persisted but not emitted — a caught-up poll passes through here briefly.
    await setMirrorState(this.db, vaultId, { phase: "hydrating" });
    let cursor = (await getMirrorCursor(this.db, vaultId)) ?? "";
    let pagesApplied = 0;
    let notesApplied = 0;
    let reWalked = false;

    try {
      while (true) {
        let page: { items: unknown[]; nextCursor?: string };
        try {
          page = await client.queryNotesCursor(MIRROR_QUERY, cursor, this.pageLimit);
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
        }
        // Advance + PERSIST the watermark after EVERY page (idempotent upserts
        // + a per-page cursor commit = a killed app resumes exactly here).
        if (page.nextCursor !== undefined) {
          cursor = page.nextCursor;
          await setMirrorCursor(this.db, vaultId, cursor);
        }
        pagesApplied += 1;
        // Terminate on an empty page — the watermark is never falsy, so an
        // empty page (not a falsy cursor) is the only end signal.
        if (items.length === 0) break;
      }

      await setMirrorLastSyncedAt(this.db, vaultId, Date.now());
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
}
