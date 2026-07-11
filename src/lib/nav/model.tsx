import {
  IconActivity,
  IconCalendar,
  IconCog,
  IconHome,
  IconImport,
  IconMap,
  IconNotes,
  IconSpark,
  IconTag,
  IconUser,
  IconVault,
} from "@/components/NavIcons";
import { isHostedVaultRecord } from "@/lib/account/hosted-vault";
import { summaryOrNull, useAccountSummary } from "@/lib/account/use-summary";
import { type HomeStepId, deriveSteps, hasUserAuthoredNote } from "@/lib/home/checklist";
import { useHomeChecklist } from "@/lib/home/use-home-checklist";
import { useInstallAffordance } from "@/lib/pwa-install";
import { useMapEarned, useNotesForDateViews, useVaultStore } from "@/lib/vault";
import type { ReactNode } from "react";

// The shared nav model (DESIGN-SPEC §2.1) — ONE data model renders BOTH
// projections: the desktop Rail and the mobile NavSheet. This is the F14 fix
// at the root: the two form factors can't disagree about what the rooms are,
// because neither owns a room list — they both render `useNavBands()`.
//
// Two named zones (F15's two-zone IA):
//   YOUR NOTES     — the reading/writing rooms (Today · Notes · Calendar ·
//                    Tags · Activity · Map-once-earned).
//   YOUR PARACHUTE — the manager rooms (Account & plan · Vaults · Connect AI ·
//                    Import notes). "The app AS the manager" finally has a
//                    named home in the IA.
// plus the SET UP shelf (incomplete guided steps, hidden when done/dismissed)
// and the foot (Settings — pinned, unlabeled band).
//
// The vault switcher is NOT a NavItem — it's the hinge (§2.4), rendered by
// each projection above the bands.
//
// Labels vs routes: the spec's labels ("Notes", "Map") landed in W2-5; the
// route RENAMES (`/all`→`/notes`, `/graph`→`/map`) are W2-7's, landed here —
// `/all` and `/graph` now live only as replace-shims in App.tsx.

export interface NavItem {
  id: string;
  label: string;
  to: string;
  /** NavIcons — thin-stroke, rounded caps. */
  icon: ReactNode;
  /** Active-state rule, shared by every projection (rail, sheet, tab bar). */
  match: (pathname: string) => boolean;
  /** e.g. the trial chip on "Account & plan" (§3.1 ambience slot 3). */
  badge?: ReactNode;
}

export interface NavBand {
  id: "notes" | "parachute" | "setup" | "foot";
  /** Uppercase sage section label; the foot has none. */
  label?: string;
  /** Quiet parenthetical beside the label — the SET UP shelf's "n of m". */
  sublabel?: string;
  items: NavItem[];
}

// ---------------------------------------------------------------------------
// Match rules — exported so the BottomTabBar (whose Today/Notes tabs are a
// subset projection of the notes band) uses the SAME active-state grammar
// instead of a drifting copy.
// ---------------------------------------------------------------------------

/** Reading a note (/n/:id) and the day drill-in (/today?date=) live under Today. */
export function matchToday(pathname: string): boolean {
  return pathname === "/" || pathname === "/today" || pathname.startsWith("/n/");
}

/** The Notes room — label "Notes", route `/notes` (W2-7; `/all` is a shim). */
export function matchNotes(pathname: string): boolean {
  return pathname === "/notes";
}

/** Route targets, single-sourced (W2-7 renamed these off `/all`/`/graph`). */
export const TODAY_TO = "/";
export const NOTES_TO = "/notes";
export const MAP_TO = "/map";

// ---------------------------------------------------------------------------
// The static skeleton — everything that doesn't depend on live state.
// ---------------------------------------------------------------------------

const TODAY_ITEM: NavItem = {
  id: "today",
  label: "Today",
  to: TODAY_TO,
  icon: <IconHome />,
  match: matchToday,
};

const NOTES_ITEM: NavItem = {
  id: "notes",
  label: "Notes",
  to: NOTES_TO,
  icon: <IconNotes />,
  match: matchNotes,
};

const CALENDAR_ITEM: NavItem = {
  id: "calendar",
  label: "Calendar",
  to: "/calendar",
  icon: <IconCalendar />,
  match: (p) => p === "/calendar",
};

const TAGS_ITEM: NavItem = {
  id: "tags",
  label: "Tags",
  to: "/tags",
  icon: <IconTag />,
  match: (p) => p === "/tags",
};

const ACTIVITY_ITEM: NavItem = {
  id: "activity",
  label: "Activity",
  to: "/activity",
  icon: <IconActivity />,
  match: (p) => p === "/activity",
};

const MAP_ITEM: NavItem = {
  id: "map",
  label: "Map",
  to: MAP_TO,
  icon: <IconMap />,
  match: (p) => p === MAP_TO,
};

const VAULTS_ITEM: NavItem = {
  id: "vaults",
  label: "Vaults",
  to: "/vaults",
  icon: <IconVault />,
  match: (p) => p === "/vaults",
};

// [spec-resolved §2.2] Connections is TWO adjacent rows here (one row = one
// destination — the rail has no submenus); the grouped "Connections" concept
// lives on /account's Connections card (W2-8).
const CONNECT_ITEM: NavItem = {
  id: "connect",
  label: "Connect AI",
  to: "/connect",
  icon: <IconSpark />,
  match: (p) => p === "/connect",
};

const IMPORT_ITEM: NavItem = {
  id: "import",
  label: "Import notes",
  to: "/import",
  icon: <IconImport />,
  match: (p) => p === "/import",
};

const SETTINGS_ITEM: NavItem = {
  id: "settings",
  label: "Settings",
  to: "/settings",
  icon: <IconCog />,
  match: (p) => p === "/settings",
};

// The SET UP shelf's step rows — guided actions, not rooms, so they carry no
// active state (`match: () => false`); their destinations are rooms that also
// exist elsewhere in the bands.
const SETUP_DEST: Record<HomeStepId, Omit<NavItem, "id">> = {
  write: { label: "Write a note", to: "/new", icon: <SetupTick />, match: () => false },
  connect: { label: "Connect your AI", to: "/connect", icon: <SetupTick />, match: () => false },
  import: { label: "Bring notes over", to: "/import", icon: <SetupTick />, match: () => false },
  install: { label: "Install the app", to: "/settings", icon: <SetupTick />, match: () => false },
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
}

export function buildNavBands(signals: NavBandSignals): NavBand[] {
  const notesItems: NavItem[] = [TODAY_ITEM, NOTES_ITEM, CALENDAR_ITEM, TAGS_ITEM, ACTIVITY_ITEM];
  // Earned gate (route-map row 11): the Map row is absent until earned, and
  // IDENTICAL on both projections — F14's desktop-gated/mobile-unconditional
  // split can't come back. Pre-earn, the AmbientMapFab carries Map access.
  if (signals.mapEarned) notesItems.push(MAP_ITEM);

  const accountItem: NavItem = {
    id: "account",
    label: "Account & plan",
    to: "/account",
    icon: <IconUser />,
    match: (p) => p === "/account",
    badge:
      signals.trialDaysLeft !== null ? <TrialChip daysLeft={signals.trialDaysLeft} /> : undefined,
  };

  const bands: NavBand[] = [
    { id: "notes", label: "Your notes", items: notesItems },
    {
      id: "parachute",
      label: "Your parachute",
      items: [accountItem, VAULTS_ITEM, CONNECT_ITEM, IMPORT_ITEM],
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
// The hook — one derivation, two consumers (Rail, NavSheet).
// ---------------------------------------------------------------------------

/**
 * Derives the full band list: earned gates (`useMapEarned`), setup-shelf
 * state (checklist + live signals — same sources as Home's nudge), and the
 * trial chip (`useAccountSummary`, lazily — see below). Returns `[]` with no
 * active vault (both projections render nothing vault-scoped without one).
 */
export function useNavBands(): NavBand[] {
  const vault = useVaultStore((s) => s.getActiveVault());
  const mapEarned = useMapEarned();

  // SET UP shelf signals — shared with Home's checklist (same storage, same
  // derivation), so the shelf and the nudge can never disagree on progress.
  const { state: checklistState } = useHomeChecklist(vault?.id ?? null);
  const notes = useNotesForDateViews();
  const install = useInstallAffordance();

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

  if (!vault) return [];

  const steps = deriveSteps(checklistState, {
    hasUserNote: hasUserAuthoredNote(notes.data),
    installed: install.state === "installed",
    installable: install.state === "available",
  });
  const incomplete = steps.filter((s) => !s.done);
  // Hidden entirely once complete or dismissed (adopt #12 — no persistent
  // "You're all set" row; done guidance gets out of the way).
  const setup =
    checklistState.dismissed || incomplete.length === 0
      ? null
      : {
          steps: incomplete.map((s) => s.id),
          done: steps.length - incomplete.length,
          total: steps.length,
        };

  return buildNavBands({ mapEarned, trialDaysLeft, setup });
}
