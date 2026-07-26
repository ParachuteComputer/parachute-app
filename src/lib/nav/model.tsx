import {
  IconActivity,
  IconArchive,
  IconCalendar,
  IconClock,
  IconCog,
  IconExport,
  IconImport,
  IconMap,
  IconNotes,
  IconPlus,
  IconSpark,
  IconStar,
  IconTag,
  IconUser,
  IconVault,
} from "@/components/NavIcons";
import { ViewNavIcon } from "@/components/ViewNavIcon";
import { isHostedVaultRecord } from "@/lib/account/hosted-vault";
import { summaryOrNull, useAccountSummary } from "@/lib/account/use-summary";
import { type HomeStepId, deriveSteps, hasUserAuthoredNote } from "@/lib/home/checklist";
import { useMapEarned, useNotesForDateViews, useVaultStore } from "@/lib/vault";
import { useTagRoles } from "@/lib/vault/settings";
import { DEFAULT_VIEW_PATHS } from "@/lib/views/defaults";
import { useViewList } from "@/lib/views/queries";
import { primaryQueryTag } from "@/lib/views/query";
import { decodeViewDef, isLegacySavedView } from "@/lib/views/schema";
import { type ReactNode, createContext, useContext, useMemo } from "react";

// The shared nav model (DESIGN-SPEC §2.1; reshaped by LENS-SPEC §4 in LZ-2) —
// ONE data model renders BOTH projections: the desktop Rail and the mobile
// NavSheet. This is the F14 fix at the root: the two form factors can't
// disagree about what the rooms are, because neither owns a room list — they
// both render `useNavBands()`.
//
// Three named zones (the lens model — LENS-SPEC §1's lens/destination line):
//   YOUR NOTES     — the LENS SET over the one collection (Recent · All notes ·
//                    Pinned · Archive). A lens is a filter rendered as the
//                    same note list, not a different room.
//   EXPLORE        — the destinations (Calendar · Tags · Activity ·
//                    Map-once-earned): different visualizations/objects.
//   YOUR PARACHUTE — the manager rooms (Account & plan · Vaults · Connect AI ·
//                    Import notes · Export notes). "The app AS the manager"
//                    finally has a named home in the IA.
// plus the SET UP shelf (incomplete guided steps, hidden when done/dismissed)
// and the foot (Settings — pinned, unlabeled band).
//
// The vault switcher is NOT a NavItem — it's the hinge (§2.4), rendered by
// each projection above the bands.
//
// Lenses ARE the URLs we already have (LENS-SPEC §2 — zero migration): Recent
// = `/`, All notes = `/notes`, Pinned/Archive = `/notes?view=…`. That last
// pair is why `match` reads the SEARCH STRING too, not just the pathname.

/** The location slice every match rule reads — pathname AND search (LZ-2). */
export interface NavLocation {
  pathname: string;
  search: string;
}

export interface NavItem {
  id: string;
  label: string;
  to: string;
  /** NavIcons — thin-stroke, rounded caps. */
  icon: ReactNode;
  /** Active-state rule, shared by every projection (rail, sheet, tab bar). */
  match: (loc: NavLocation) => boolean;
  /** e.g. the trial chip on "Account & plan" (§3.1 ambience slot 3). */
  badge?: ReactNode;
}

export interface NavBand {
  id: "notes" | "views" | "explore" | "parachute" | "setup" | "foot";
  /** Uppercase sage section label; the foot has none. */
  label?: string;
  /** Quiet parenthetical beside the label — the SET UP shelf's "n of m". */
  sublabel?: string;
  items: NavItem[];
}

// ---------------------------------------------------------------------------
// Match rules — exported so the BottomTabBar (whose Recent/Notes tabs are a
// subset projection of the notes band) uses the SAME active-state grammar
// instead of a drifting copy.
// ---------------------------------------------------------------------------

/**
 * The Recent lens (what Today was; Recent = `/`). Reading a note (/n/:id) and
 * the day drill-in (/today?date=) stay under it — drill-ins inherit the lens
 * you drilled in from.
 */
export function matchRecent(loc: NavLocation): boolean {
  return loc.pathname === "/" || loc.pathname === "/today" || loc.pathname.startsWith("/n/");
}

/** The `?view=` lens param — the one search dimension the nav model reads. */
function viewParam(loc: NavLocation): string | null {
  return new URLSearchParams(loc.search).get("view");
}

/**
 * The All-notes lens — `/notes` in every dress EXCEPT the pinned/archived
 * lenses. The maintenance filters (`?view=untagged|orphaned`) and the
 * search/tag/saved-view params all stay under All: they're filters over the
 * full collection, not lenses of their own (LENS-SPEC §1).
 */
export function matchAllNotes(loc: NavLocation): boolean {
  if (loc.pathname !== "/notes") return false;
  const view = viewParam(loc);
  return view !== "pinned" && view !== "archived";
}

/** The Pinned lens — `/notes?view=pinned` (the `pinned` role tag). */
export function matchPinned(loc: NavLocation): boolean {
  return loc.pathname === "/notes" && viewParam(loc) === "pinned";
}

/** The Archive lens — `/notes?view=archived` (label "Archive", param stays). */
export function matchArchive(loc: NavLocation): boolean {
  return loc.pathname === "/notes" && viewParam(loc) === "archived";
}

/**
 * The whole one-surface footprint (LENS-SPEC §5.2, LZ-5) — every lens over
 * the one collection: Recent (`/` plus the /n/:id and /today drill-ins that
 * stay under it) and `/notes` in every `?view=` dress. The 3-slot mobile
 * bar's single "Notes" tab lights on this — one surface, one surface tab;
 * WHICH lens you're wearing is the on-surface LensStrip's job, not the bar's.
 */
export function matchVaultSurface(loc: NavLocation): boolean {
  return matchRecent(loc) || loc.pathname === "/notes";
}

/** Route targets, single-sourced (W2-7 renamed these off `/all`/`/graph`). */
export const RECENT_TO = "/";
export const NOTES_TO = "/notes";
export const MAP_TO = "/map";

/** Pathname-only rooms wrap trivially — the search string is ignored. */
function pathIs(path: string): (loc: NavLocation) => boolean {
  return (loc) => loc.pathname === path;
}

// ---------------------------------------------------------------------------
// Ceremony routes (DESIGN-SPEC §4.1's applies-to list, minus `/` — BootGate is
// Home or the marketing Landing). Rule 5 / F21: no app-chrome noise under a
// ceremony — the AGPL footer and the floating capture chrome (SpeedDial) both
// gate on this. Re-homed here from App.tsx in W2-9 so chrome components can
// read the same list without importing the route table.
// ---------------------------------------------------------------------------

export const CEREMONY_ROUTES = [
  "/welcome",
  "/check-email",
  "/add",
  "/add-vault",
  "/oauth/callback",
];

export function isCeremonyPath(pathname: string): boolean {
  return CEREMONY_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

// ---------------------------------------------------------------------------
// The static skeleton — everything that doesn't depend on live state.
// ---------------------------------------------------------------------------

// The lens set (LENS-SPEC §1) — four dresses over the one collection. No
// counts in v1: All has no cheap total (pagination infers "more" from a full
// page), and counts on only some lenses would read as meaning something.
const RECENT_ITEM: NavItem = {
  id: "recent",
  label: "Recent",
  to: RECENT_TO,
  icon: <IconClock />,
  match: matchRecent,
};

const ALL_NOTES_ITEM: NavItem = {
  id: "notes",
  label: "All notes",
  to: NOTES_TO,
  icon: <IconNotes />,
  match: matchAllNotes,
};

const PINNED_ITEM: NavItem = {
  id: "pinned",
  label: "Pinned",
  to: "/notes?view=pinned",
  icon: <IconStar />,
  match: matchPinned,
};

const ARCHIVE_ITEM: NavItem = {
  id: "archive",
  label: "Archive",
  to: "/notes?view=archived",
  icon: <IconArchive />,
  match: matchArchive,
};

// The Views band's permanent trailing row (VIEWS-RENDER-SPEC §6: "the band
// renders nothing when empty except a quiet 'New view' affordance") —
// present whether or not the person has any views yet. `/views/new` creates
// the note and redirects into it (`ViewNew.tsx`); a plain NavItem keeps the
// Rail/NavSheet's Link-only architecture untouched.
export const NEW_VIEW_TO = "/views/new";
const NEW_VIEW_ITEM: NavItem = {
  id: "new-view",
  label: "New view",
  to: NEW_VIEW_TO,
  icon: <IconPlus />,
  match: pathIs(NEW_VIEW_TO),
};

// The EXPLORE destinations — each a different visualization/object, not a
// filter over the note list.
const CALENDAR_ITEM: NavItem = {
  id: "calendar",
  label: "Calendar",
  to: "/calendar",
  icon: <IconCalendar />,
  match: pathIs("/calendar"),
};

const TAGS_ITEM: NavItem = {
  id: "tags",
  label: "Tags",
  to: "/tags",
  icon: <IconTag />,
  match: pathIs("/tags"),
};

const ACTIVITY_ITEM: NavItem = {
  id: "activity",
  label: "Activity",
  to: "/activity",
  icon: <IconActivity />,
  match: pathIs("/activity"),
};

const MAP_ITEM: NavItem = {
  id: "map",
  label: "Map",
  to: MAP_TO,
  icon: <IconMap />,
  match: pathIs(MAP_TO),
};

const VAULTS_ITEM: NavItem = {
  id: "vaults",
  label: "Vaults",
  to: "/vaults",
  icon: <IconVault />,
  match: pathIs("/vaults"),
};

// [spec-resolved §2.2] Connections is TWO adjacent rows here (one row = one
// destination — the rail has no submenus); the grouped "Connections" concept
// lives on /account's Connections card (W2-8).
const CONNECT_ITEM: NavItem = {
  id: "connect",
  label: "Connect AI",
  to: "/connect",
  icon: <IconSpark />,
  match: pathIs("/connect"),
};

const IMPORT_ITEM: NavItem = {
  id: "import",
  label: "Import notes",
  to: "/import",
  icon: <IconImport />,
  match: pathIs("/import"),
};

// Export's sibling nav entry (Wave-3) — same band, right after Import.
const EXPORT_ITEM: NavItem = {
  id: "export",
  label: "Export notes",
  to: "/export",
  icon: <IconExport />,
  match: pathIs("/export"),
};

const SETTINGS_ITEM: NavItem = {
  id: "settings",
  label: "Settings",
  to: "/settings",
  icon: <IconCog />,
  match: pathIs("/settings"),
};

// The SET UP shelf's step rows — guided actions, not rooms, so they carry no
// active state (`match: () => false`); their destinations are rooms that also
// exist elsewhere in the bands. `write` is the only step left (W3 — state-
// derived rework: `connect` had no client-detectable, cross-device signal and
// was dropped; `import` folded into `write`; `install` moved out entirely to
// its own per-device nudge, `@/components/InstallPrompt`, which never gates
// this shelf). See checklist.ts's docstring for the full accounting.
const SETUP_DEST: Record<HomeStepId, Omit<NavItem, "id">> = {
  write: { label: "Write a note", to: "/new", icon: <SetupTick />, match: () => false },
};

function SetupTick() {
  return (
    <span
      aria-hidden
      className="grid h-5 w-5 place-items-center rounded-full border border-border text-[10px]"
    >
      ✦
    </span>
  );
}

// The quiet sun-soft trial chip on "Account & plan" (§3.1 ambience list, slot
// 3 of exactly four sanctioned places). "5d" — a glance, not a nag.
function TrialChip({ daysLeft }: { daysLeft: number }) {
  return (
    <span
      className="shrink-0 rounded-full bg-sun-soft px-1.5 py-0.5 font-round text-[10px] font-semibold text-sun-ink"
      title={`Free trial · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
    >
      {daysLeft}d
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pure band assembly — testable without hooks.
// ---------------------------------------------------------------------------

export interface NavBandSignals {
  mapEarned: boolean;
  /** Trial days left, or null when not trialing / no summary. */
  trialDaysLeft: number | null;
  /** The SET UP shelf: incomplete steps only; null hides the shelf entirely. */
  setup: { steps: HomeStepId[]; done: number; total: number } | null;
  /**
   * The Views band's decoded `#view` notes (VIEWS-RENDER-SPEC §6), already
   * mapped to `NavItem`s and with the four shipped default-page paths
   * excluded — `buildNavBands` appends the permanent "New view" row, so
   * callers never include it here.
   */
  viewItems: NavItem[];
}

export function buildNavBands(signals: NavBandSignals): NavBand[] {
  // YOUR NOTES is the lens set now (LZ-2); the destinations moved to EXPLORE.
  const lensItems: NavItem[] = [RECENT_ITEM, ALL_NOTES_ITEM, PINNED_ITEM, ARCHIVE_ITEM];

  const exploreItems: NavItem[] = [CALENDAR_ITEM, TAGS_ITEM, ACTIVITY_ITEM];
  // Earned gate (route-map row 11): the Map row is absent until earned, and
  // IDENTICAL on both projections — F14's desktop-gated/mobile-unconditional
  // split can't come back. Pre-earn, the AmbientMapFab carries Map access.
  if (signals.mapEarned) exploreItems.push(MAP_ITEM);

  const accountItem: NavItem = {
    id: "account",
    label: "Account & plan",
    to: "/account",
    icon: <IconUser />,
    match: pathIs("/account"),
    badge:
      signals.trialDaysLeft !== null ? <TrialChip daysLeft={signals.trialDaysLeft} /> : undefined,
  };

  const bands: NavBand[] = [
    { id: "notes", label: "Your notes", items: lensItems },
    { id: "views", label: "Views", items: [...signals.viewItems, NEW_VIEW_ITEM] },
    { id: "explore", label: "Explore", items: exploreItems },
    {
      id: "parachute",
      label: "Your parachute",
      items: [accountItem, VAULTS_ITEM, CONNECT_ITEM, IMPORT_ITEM, EXPORT_ITEM],
    },
  ];

  if (signals.setup && signals.setup.steps.length > 0) {
    bands.push({
      id: "setup",
      label: "Set up",
      sublabel: `${signals.setup.done} of ${signals.setup.total}`,
      items: signals.setup.steps.map((id) => ({ id: `setup-${id}`, ...SETUP_DEST[id] })),
    });
  }

  bands.push({ id: "foot", items: [SETTINGS_ITEM] });
  return bands;
}

// ---------------------------------------------------------------------------
// The derivation — runs in EXACTLY ONE place (NavBandsProvider below).
// ---------------------------------------------------------------------------

/**
 * Derives the full band list: earned gates (`useMapEarned`), setup-shelf
 * state (state-derived live signals only — W3; no checklist/localStorage
 * dependency left, so the rail/sheet's "Set up" band and the Recent lens's
 * inline nudge can never disagree — both derive from the same vault-note
 * signal), and the trial chip (`useAccountSummary`, lazily — see below).
 * Returns `[]` with no active vault (both projections render nothing
 * vault-scoped without one).
 *
 * Deliberately NOT exported (app#110 Finding A): this derivation carries the
 * data layer — `useNotesForDateViews` is a full-vault live subscription with
 * no dedup below react-query, so every component that runs it opens its own
 * socket. The breakpoint contract ("one nav projection per viewport",
 * notes#147) is CSS-only — `hidden lg:flex` / `lg:hidden` hide a projection
 * without unmounting it — so when Rail, LensStrip, and NavSheet each derived
 * this themselves, every route streamed the vault twice at boot and a ☰ tap
 * streamed it a third time. Keeping the derivation module-private makes "one
 * model, N projections" structural: consumers can only read the context.
 */
function useNavBandsModel(): NavBand[] {
  const vault = useVaultStore((s) => s.getActiveVault());
  const mapEarned = useMapEarned();
  const notes = useNotesForDateViews();
  const { roles } = useTagRoles(vault?.id ?? null);
  const viewList = useViewList(roles.view);

  // Trial ambience (§3.1 slot 3) — the shared summary hook, enabled only for
  // home-door (account-minted) vaults: a self-host door has no summary
  // endpoint, so don't fire the fetch at all. Never gates paint; the chip
  // just appears when the answer lands.
  const isHosted = vault !== null && isHostedVaultRecord(vault.clientId);
  const summaryQuery = useAccountSummary({ enabled: isHosted });
  // Ambient read: failed and absent both mean "no chip" (the retry affordance
  // lives on /account's Plan & billing card, not in a badge).
  const plan = (isHosted ? summaryOrNull(summaryQuery.data) : null)?.plan ?? null;
  const trialDaysLeft = typeof plan?.trial_days_left === "number" ? plan.trial_days_left : null;

  // The Views band (VIEWS-RENDER-SPEC §6): every `#view`-tagged note, minus
  // the four shipped default pages (they already have Rail entries under
  // "Your notes") and any legacy saved-view note (§8 is void — that shape
  // never renders here, 2026-07-17 scope cut), alpha-sorted.
  const viewItems = useMemo(() => {
    if (!Array.isArray(viewList.data)) return [];
    return viewList.data
      .filter((n) => !DEFAULT_VIEW_PATHS.includes(n.path ?? "") && !isLegacySavedView(n))
      .map((n) => {
        const def = decodeViewDef(n);
        const to = `/views/${encodeURIComponent(n.id)}`;
        const item: NavItem = {
          id: `view-${n.id}`,
          label: def.title,
          to,
          icon: <ViewNavIcon kind={def.kind} hueTag={primaryQueryTag(def.query)} />,
          match: pathIs(to),
        };
        return item;
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [viewList.data]);

  if (!vault) return [];

  const steps = deriveSteps({ hasUserNote: hasUserAuthoredNote(notes.data) });
  const incomplete = steps.filter((s) => !s.done);
  // Hidden entirely once complete (no more "dismissed" flag — W3: a
  // state-derived shelf just stops rendering when the state says onboarded;
  // adopt #12's "no persistent You're-all-set row" still holds).
  const setup =
    incomplete.length === 0
      ? null
      : {
          steps: incomplete.map((s) => s.id),
          done: steps.length - incomplete.length,
          total: steps.length,
        };

  return buildNavBands({ mapEarned, trialDaysLeft, setup, viewItems });
}

// `null` doubles as the "no provider" sentinel — the provider always supplies
// an array (possibly empty), so a null read means the tree is missing it.
const NavBandsContext = createContext<NavBand[] | null>(null);

/**
 * The ONE place the nav model derives (app#110 Finding A). Mounts once in the
 * app shell; Rail, LensStrip, and NavSheet read the result via `useNavBands`.
 * Besides the wire cost (see `useNavBandsModel`), a single deriver closes a
 * write race: two live subscriptions on the same react-query key are two
 * writers doing last-writer-wins `setQueryData` under `staleTime: Infinity`
 * — nothing self-heals a stale overwrite. One deriver, one writer.
 */
export function NavBandsProvider({ children }: { children: ReactNode }) {
  const bands = useNavBandsModel();
  return <NavBandsContext.Provider value={bands}>{children}</NavBandsContext.Provider>;
}

/** The bands, read from context. Throws outside `NavBandsProvider` — loudly,
 * so a projection mounted outside the shell (or a test missing the wrapper)
 * fails at first render instead of quietly re-opening its own vault stream. */
export function useNavBands(): NavBand[] {
  const bands = useContext(NavBandsContext);
  if (bands === null) {
    throw new Error(
      "useNavBands must render under <NavBandsProvider> — the nav model derives once, in the app shell (app#110)",
    );
  }
  return bands;
}
