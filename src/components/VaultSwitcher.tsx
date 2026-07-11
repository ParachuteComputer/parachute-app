import { InsecureContextBanner } from "@/components/InsecureContextBanner";
import { listVaults } from "@/lib/account/client";
import { describeAccountError } from "@/lib/account/error-copy";
import { isHostedVaultRecord, openHostedVault } from "@/lib/account/hosted-vault";
import type { AccountVault } from "@/lib/account/types";
import { useAccountSummary } from "@/lib/account/use-summary";
import {
  type HubVaultEntry,
  type VaultRecord,
  beginOAuth,
  fetchHubVaults,
  hubOriginForVault,
  normalizeVaultUrl,
  useVaultStore,
} from "@/lib/vault";
import { InsecureContextError } from "@/lib/vault/pkce";
import { announceVaultSwitch, switchVault, vaultDisplayLabel } from "@/lib/vault/switch";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

// The vault switcher v2 — "the hinge" (DESIGN-SPEC §2.4/§3.2): the one
// canonical door for switch / open / create / connect. Three row sources,
// partitioned honestly:
//
//   · ON THIS DEVICE — local VaultRecords: the active vault (✓ current) and
//     the others (click to switch, confirmed by the "Now in {vault}" toast).
//   · IN YOUR ACCOUNT — the door account's hosted vaults that are NOT on this
//     device (F13's real fix: "Open" is scoped to exactly these, so it can
//     never silently reopen the vault you're already in).
//   · FROM YOUR HUB — hub-published vaults not yet connected (OAuth door,
//     unchanged behavior).
//
// Foot verbs inline the AddVaultChooser's cards (F2 — the chooser is no longer
// only reachable by a link): Create a vault · Connect your own. The Create row
// is PLAN-AWARE: at the account's vault limit it renders the upsell instead of
// letting a doomed create attempt fire the 409 (WALK-manager #3). A quiet
// trial line surfaces while trialing (decision b's ambient surfacing, F4).

interface DeviceRow {
  kind: "device";
  id: string;
  label: string;
  isActive: boolean;
  /** The hub also publishes this vault's URL (kept for future "hub knows
   *  about this one" hints — same field the popover carried). */
  hubKnown: boolean;
  vault: VaultRecord;
}

interface AccountRow {
  kind: "account";
  name: string;
  url?: string;
}

interface HubRow {
  kind: "hub";
  name: string;
  url: string;
  hubOrigin: string;
}

export type VaultSwitcherRow = DeviceRow | AccountRow | HubRow;

function normalizedUrlForMatch(raw: string): string {
  try {
    return normalizeVaultUrl(raw);
  } catch {
    return raw.replace(/\/$/, "");
  }
}

/**
 * Compute the switcher's rows from the three sources. Pure for easy testing.
 *
 * Matching is URL-based (normalized), with one belt-and-braces addition for
 * account vaults: a home-door record with the same NAME as an account vault is
 * that vault (account slugs are unique per door), even when the stored URL and
 * the account list's URL differ in shape. Without it a cosmetic URL mismatch
 * would resurrect the F13 bug in reverse — an "Open" row for a vault that's
 * already on this device.
 *
 * `accountVaults === null` means "no account list to show" (signed out,
 * self-host door, or the fetch failed) — no account rows, everything else
 * unaffected. A hub entry whose URL matches an account vault's collapses into
 * the account "Open" row (one click, no OAuth — the better door wins).
 */
export function buildVaultSwitcherRows(
  connected: VaultRecord[],
  activeId: string | null,
  hubVaults: HubVaultEntry[],
  hubOriginForAvailable: string | null,
  accountVaults: AccountVault[] | null,
): VaultSwitcherRow[] {
  const hubUrlSet = new Set(hubVaults.map((v) => normalizedUrlForMatch(v.url)));
  const connectedUrlSet = new Set(connected.map((v) => normalizedUrlForMatch(v.url)));
  const hostedNameSet = new Set(
    connected.filter((v) => isHostedVaultRecord(v.clientId)).map((v) => v.name),
  );

  const deviceRows: DeviceRow[] = [...connected]
    .sort((a, b) => vaultDisplayLabel(a).localeCompare(vaultDisplayLabel(b)))
    .map((v) => ({
      kind: "device" as const,
      id: v.id,
      label: vaultDisplayLabel(v),
      isActive: v.id === activeId,
      hubKnown: hubUrlSet.has(normalizedUrlForMatch(v.url)),
      vault: v,
    }));

  const accountRows: AccountRow[] = (accountVaults ?? [])
    .filter(
      (av) =>
        !(av.url !== undefined && connectedUrlSet.has(normalizedUrlForMatch(av.url))) &&
        !hostedNameSet.has(av.name),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((av) => ({ kind: "account" as const, name: av.name, url: av.url }));

  const accountUrlSet = new Set(
    accountRows
      .filter((r): r is AccountRow & { url: string } => r.url !== undefined)
      .map((r) => normalizedUrlForMatch(r.url)),
  );

  const hubRows: HubRow[] =
    hubOriginForAvailable === null
      ? []
      : hubVaults
          .filter(
            (hv) =>
              !connectedUrlSet.has(normalizedUrlForMatch(hv.url)) &&
              !accountUrlSet.has(normalizedUrlForMatch(hv.url)),
          )
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((hv) => ({
            kind: "hub" as const,
            name: hv.name,
            url: hv.url,
            hubOrigin: hubOriginForAvailable,
          }));

  return [...deviceRows, ...accountRows, ...hubRows];
}

interface VaultSwitcherProps {
  /**
   * Render variant.
   *   - `header` — the mobile/tablet dropdown anchored to the header's vault pill.
   *   - `rail`   — the desktop left-rail identity switcher: a full-width card
   *                with a glyph + the vault name, its panel dropping full-width
   *                beneath it.
   * (W2-5 adds `sheet` — rows rendered inline in the mobile NavSheet.)
   */
  variant?: "header" | "rail";
}

// The vault-initial glyph square — the icon-in-soft-circle row pattern
// (DESIGN-SPEC §3.2 / adopt #9). Grass-soft for vaults on this device (the
// trust green you have); a quiet neutral square for vaults you haven't
// opened here yet.
function GlyphSquare({ label, here }: { label: string; here: boolean }) {
  const initial = (label.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-semibold ${
        here ? "bg-grass-soft text-grass-ink" : "bg-bg-soft text-fg-muted"
      }`}
    >
      {initial}
    </span>
  );
}

// A verb/upsell row's leading circle — the same soft-circle pattern in the
// verb's own color voice (accent = create, sky = self-host, sun = plan nudge).
function VerbCircle({ tone, children }: { tone: "accent" | "sky" | "sun"; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm ${
        tone === "sun" ? "bg-sun-soft text-sun-ink" : "bg-bg-soft"
      }`}
      style={
        tone === "sky"
          ? { color: "var(--color-sky)" }
          : tone === "accent"
            ? { color: "var(--color-accent)" }
            : undefined
      }
    >
      {children}
    </span>
  );
}

export function VaultSwitcher({ variant = "header" }: VaultSwitcherProps) {
  const vaults = useVaultStore((s) => s.vaults);
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const activeVault = activeVaultId ? (vaults[activeVaultId] ?? null) : null;
  const [open, setOpen] = useState(false);
  const [hubVaults, setHubVaults] = useState<HubVaultEntry[] | null>(null);
  // Distinct from `hubVaults === null` (which also means "the probe failed") —
  // without it the quiet "looking…" hint would show forever on a door with no
  // /.well-known/parachute.json (cloud, standalone vaults).
  const [hubPending, setHubPending] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [openingName, setOpeningName] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [insecureContext, setInsecureContext] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const hubOrigin = useMemo(
    () => (activeVault ? hubOriginForVault(activeVault) : null),
    [activeVault],
  );

  // Plan/trial context — the shared account-summary hook (§2.4), LAZY: enabled
  // only while the panel is open, so the switcher never adds a boot fetch.
  const summaryQuery = useAccountSummary({ enabled: open });
  const summary = summaryQuery.data ?? null;

  // The account's hosted vault list (the cloud door), also lazy on open.
  // `null` = nothing to show (signed out / self-host / fetch failed) — the
  // switcher degrades to on-device + hub rows, exactly today's behavior
  // (the chooser's Open card at /add-vault remains the fallback door).
  const accountVaultsQuery = useQuery<AccountVault[] | null>({
    queryKey: ["account", "vaults"],
    queryFn: async () => {
      try {
        return (await listVaults()).vaults;
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
    enabled: open,
  });
  const accountVaults = accountVaultsQuery.data ?? null;

  // Outside-click and Escape close the popover. Same shape as
  // SyncStatusIndicator — mousedown so a click that selects something inside
  // doesn't fire before the click handler.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Fetch the hub's vault list when the popover opens. Refetched per-open so
  // newly-added vaults show up without a page reload; cheap (one same-origin
  // GET to a static-ish JSON).
  useEffect(() => {
    if (!open || !hubOrigin) {
      return;
    }
    const ctrl = new AbortController();
    setHubPending(true);
    fetchHubVaults(hubOrigin, fetch.bind(globalThis), ctrl.signal).then((result) => {
      if (ctrl.signal.aborted) return;
      setHubVaults(result);
      setHubPending(false);
    });
    return () => {
      ctrl.abort();
      setHubPending(false);
    };
  }, [open, hubOrigin]);

  const rows = useMemo(
    () =>
      buildVaultSwitcherRows(
        Object.values(vaults),
        activeVaultId,
        hubVaults ?? [],
        hubOrigin,
        accountVaults,
      ),
    [vaults, activeVaultId, hubVaults, hubOrigin, accountVaults],
  );
  const deviceRows = rows.filter((r): r is DeviceRow => r.kind === "device");
  const accountRows = rows.filter((r): r is AccountRow => r.kind === "account");
  const hubRows = rows.filter((r): r is HubRow => r.kind === "hub");

  // Plan-aware create (WALK-manager #3): at the vault limit the Create row
  // becomes the upsell — the 409 is unreachable from here. Both numbers must
  // be present (never fabricate a limit); no summary → plain Create row, the
  // server still guards.
  const plan = summary?.plan ?? null;
  const atVaultLimit =
    plan !== null &&
    typeof plan.vault_limit === "number" &&
    typeof plan.vaults_used === "number" &&
    plan.vaults_used >= plan.vault_limit;
  // Trial ambience (decision b / F4): only when the door reports a number.
  const trialDaysLeft = typeof plan?.trial_days_left === "number" ? plan.trial_days_left : null;

  const triggerLabel = activeVault ? vaultDisplayLabel(activeVault) : "Choose vault";

  const toggleOpen = useCallback(() => {
    setOpen((v) => {
      if (!v) {
        // Fresh open — stale errors from the last open would read as current.
        setConnectError(null);
        setOpenError(null);
        setInsecureContext(false);
      }
      return !v;
    });
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const onSwitch = useCallback((row: DeviceRow) => {
    // §4.4: every switch confirms with "Now in {vault}". Clicking the current
    // vault just closes — nothing changed, nothing to announce.
    if (!row.isActive) switchVault(row.id, { toast: true });
    setOpen(false);
  }, []);

  // Open an account vault that isn't on this device (the cloud door): mint a
  // per-vault token, store + activate it, confirm with the toast. No
  // navigation — same stay-in-place behavior as an on-device switch.
  const onOpenAccount = useCallback(
    async (row: AccountRow) => {
      if (openingName) return;
      setOpeningName(row.name);
      setOpenError(null);
      try {
        await openHostedVault(row.name);
        announceVaultSwitch(row.name);
        setOpen(false);
      } catch (err) {
        // F12 — friendly copy, never a raw wire code.
        setOpenError(describeAccountError(err, "Couldn't open that vault."));
      } finally {
        setOpeningName(null);
      }
    },
    [openingName],
  );

  const onConnect = useCallback(async (row: HubRow) => {
    setConnecting(row.name);
    setConnectError(null);
    setInsecureContext(false);
    try {
      // Path A (design doc §2): pass `vault=<name>` as a hint. Pre-#240 hubs
      // ignore it and the consent screen renders the picker as today; future
      // hubs can pre-select on the consent screen with no app change.
      const { authorizeUrl } = await beginOAuth(row.hubOrigin, undefined, undefined, {
        params: { vault: row.name },
      });
      window.location.assign(authorizeUrl);
    } catch (err) {
      setConnecting(null);
      // Insecure-context failure has a distinct remediation path (use
      // localhost, or terminate HTTPS upstream) — surface it with the
      // dedicated banner instead of jamming the long actionable message
      // into the popover's thin error line.
      if (err instanceof InsecureContextError) {
        setInsecureContext(true);
      } else {
        setConnectError((err as Error).message);
      }
    }
  }, []);

  const lookingForMore = open && (hubPending || accountVaultsQuery.isPending);

  const panel = (
    // biome-ignore lint/a11y/useSemanticElements: a native <dialog> requires imperative show()/showModal() calls; this is a popover, not a modal.
    <div
      role="dialog"
      aria-label="Vaults"
      // Both variants anchor LEFT: the trigger sits at the screen's left edge
      // on both form factors, so a right-anchored panel wider than its trigger
      // would hang off-screen (the old header popover's latent clip). The rail
      // panel floats a step wider than the rail so the richer rows (Open
      // pills, the upsell line) breathe instead of truncating.
      className={
        variant === "header"
          ? "absolute left-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-card text-sm shadow-lift"
          : "absolute left-0 z-30 mt-2 w-72 overflow-hidden rounded-2xl border border-border bg-card text-sm shadow-lift"
      }
    >
      {deviceRows.length > 0 ? (
        <div className="border-b border-border-light">
          <p className="eyebrow px-3 pt-3 pb-1 text-2xs">On this device</p>
          <ul className="pb-2">
            {deviceRows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onSwitch(row)}
                  className="focus-ring flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-bg-soft"
                >
                  <GlyphSquare label={row.label} here />
                  <span className="min-w-0 flex-1 truncate font-semibold text-fg">{row.label}</span>
                  {row.isActive ? (
                    <span className="shrink-0 text-2xs font-medium text-grass-ink">✓ current</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {accountRows.length > 0 ? (
        <div className="border-b border-border-light">
          <p className="eyebrow px-3 pt-3 pb-1 text-2xs">In your account</p>
          <ul className="pb-2">
            {accountRows.map((row) => (
              <li key={row.name}>
                <div className="flex w-full items-center gap-2.5 px-3 py-1.5">
                  <GlyphSquare label={row.name} here={false} />
                  <span className="min-w-0 flex-1 truncate text-fg-muted">{row.name}</span>
                  <button
                    type="button"
                    onClick={() => onOpenAccount(row)}
                    disabled={openingName === row.name}
                    className="focus-ring shrink-0 rounded-full border border-accent/40 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-60"
                  >
                    {openingName === row.name ? "Opening…" : "Open →"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hubRows.length > 0 ? (
        <div className="border-b border-border-light">
          <p className="eyebrow px-3 pt-3 pb-1 text-2xs">From your hub</p>
          <ul className="pb-2">
            {hubRows.map((row) => (
              <li key={row.url}>
                <div className="flex w-full items-center gap-2.5 px-3 py-1.5">
                  <GlyphSquare label={row.name} here={false} />
                  <span className="min-w-0 flex-1 truncate text-fg-muted">{row.name}</span>
                  <button
                    type="button"
                    onClick={() => onConnect(row)}
                    disabled={connecting === row.name}
                    className="focus-ring shrink-0 rounded-full border border-accent/40 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-60"
                  >
                    {connecting === row.name ? "Connecting…" : "Connect"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {insecureContext ? (
        <div className="border-b border-border-light px-3 py-2">
          <InsecureContextBanner />
        </div>
      ) : null}

      {connectError || openError ? (
        <div className="border-b border-border-light px-3 py-2 text-xs text-[--color-danger]">
          {connectError ?? openError}
        </div>
      ) : null}

      {/* The inline add-vault verbs (F2) — the chooser's cards, one row each.
          /add-vault stays the deep-linkable page form; this is the primary door. */}
      <div className="border-b border-border-light py-2">
        {atVaultLimit && plan ? (
          // WALK-manager #3 — the at-limit moment IS the upsell, not a 409.
          // NAVIGATION.md: card link — user-initiated, push.
          <Link
            to="/account"
            onClick={close}
            className="focus-ring flex w-full items-center gap-2.5 px-3 py-1.5 hover:bg-bg-soft"
          >
            <VerbCircle tone="sun">↑</VerbCircle>
            {/* Wraps rather than truncates — the plan fact must read whole. */}
            <span className="min-w-0 flex-1 leading-snug text-fg-muted">
              {plan.vaults_used} of {plan.vault_limit} vaults on your plan
            </span>
            <span className="shrink-0 text-sm font-semibold text-accent">Upgrade →</span>
          </Link>
        ) : (
          // NAVIGATION.md: "Chooser card → /welcome?new=1" — user-initiated,
          // push. (The switcher inlines the chooser's Create card; W2-6 moves
          // the target to /add-vault/create.)
          <Link
            to="/welcome?new=1"
            onClick={close}
            className="focus-ring flex w-full items-center gap-2.5 px-3 py-1.5 hover:bg-bg-soft"
          >
            <VerbCircle tone="accent">＋</VerbCircle>
            <span className="min-w-0 flex-1 truncate font-semibold text-accent">
              Create a vault
            </span>
          </Link>
        )}
        {/* NAVIGATION.md: "Chooser card → /add" — user-initiated, push. */}
        <Link
          to="/add"
          onClick={close}
          className="focus-ring flex w-full items-center gap-2.5 px-3 py-1.5 hover:bg-bg-soft"
        >
          <VerbCircle tone="sky">⌂</VerbCircle>
          <span
            className="min-w-0 flex-1 truncate font-semibold"
            style={{ color: "var(--color-sky)" }}
          >
            Connect your own
          </span>
        </Link>
      </div>

      <div className="px-3 py-2">
        {trialDaysLeft !== null ? (
          // Ambient trial line (decision b, F4) — quiet, never a nag.
          // NAVIGATION.md: footer link — user-initiated, push.
          <Link
            to="/account"
            onClick={close}
            className="focus-ring mb-1 block text-xs text-sun-ink hover:underline"
          >
            Free trial · {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"} left
          </Link>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          {/* NAVIGATION.md: footer link — user-initiated, push. */}
          <Link
            to="/vaults"
            onClick={close}
            className="focus-ring text-xs text-fg-muted hover:text-accent"
          >
            Manage vaults →
          </Link>
          {lookingForMore ? (
            <span className="text-[10px] text-fg-dim">Looking for more vaults…</span>
          ) : null}
        </div>
      </div>
    </div>
  );

  // The rail switcher is the identity spine at the top of the desktop rail:
  // a full-width card with a glyph square carrying the vault's initial + its
  // name. Threads the vault name into the rail exactly where Neil put it.
  if (variant === "rail") {
    const initial = (triggerLabel.trim()[0] ?? "?").toUpperCase();
    return (
      <div ref={rootRef} className="relative">
        <button
          type="button"
          aria-label={`Active vault: ${triggerLabel}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={toggleOpen}
          title={triggerLabel}
          className="focus-ring flex w-full items-center gap-2.5 rounded-xl border border-border bg-card px-2.5 py-2 text-left shadow-sm hover:border-accent/50"
        >
          <span
            aria-hidden
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-grass-soft font-round text-sm font-semibold text-grass-ink"
          >
            {initial}
          </span>
          <span className="min-w-0 flex-1 truncate font-round font-semibold text-fg">
            {triggerLabel}
          </span>
          <span aria-hidden className="shrink-0 text-xs text-fg-dim">
            ▾
          </span>
        </button>
        {open ? panel : null}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative max-w-full">
      <button
        type="button"
        aria-label={`Active vault: ${triggerLabel}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggleOpen}
        // `title` mirrors the visible label so sighted users can hover to
        // see the full vault name when the rem-capped trigger truncates it
        // (notes#147 reviewer).
        title={triggerLabel}
        // `max-w-[12rem]` caps the trigger at a rem-based width so a
        // long vault name truncates instead of pushing header siblings
        // out (notes#136). rem so the cap scales with text-size.
        className="flex min-w-0 max-w-[12rem] items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-fg hover:border-accent/50"
      >
        <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full bg-accent" />
        <span className="min-w-0 truncate">{triggerLabel}</span>
        <span aria-hidden className="ml-1 shrink-0 text-xs text-fg-dim">
          ▾
        </span>
      </button>

      {open ? panel : null}
    </div>
  );
}
