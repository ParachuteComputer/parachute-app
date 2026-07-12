import { AccountSessionBanner, HubGateBanner } from "@/components/AccountSessionBanner";
import { AmbientMapFab } from "@/components/AmbientMapFab";
import { BottomTabBar } from "@/components/BottomTabBar";
import { Header } from "@/components/Header";
import { QuickSwitchMount } from "@/components/QuickSwitchMount";
import { Rail } from "@/components/Rail";
import { SpeedDial } from "@/components/SpeedDial";
import { TextSizeShortcutsMount } from "@/components/TextSizeControl";
import { Toaster } from "@/components/Toaster";
import { UpdateBanner } from "@/components/UpdateBanner";
import { VaultStatusBanner } from "@/components/VaultStatusBanner";
import { type BootDecision, getDoorDescriptor, resolveBoot } from "@/lib/account";
import { detectMountBase } from "@/lib/base-url";
import { isCeremonyPath } from "@/lib/nav/model";
import { applyTextSize, readStoredTextSize } from "@/lib/text-size";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault";
import { useCrossTabVaultSync } from "@/lib/vault/cross-tab-sync";
import { useActiveVaultClient } from "@/lib/vault/queries";
import { useReachabilityProbe } from "@/lib/vault/reachability-probe";
import { QueryProvider } from "@/providers/QueryProvider";
import { SyncProvider } from "@/providers/SyncProvider";
import { matchesNavigationDenylist } from "@/pwa-navigation-denylist";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router";
import { Landing } from "./routes/Landing";
import { VaultSurface } from "./routes/VaultSurface";

// Landing + VaultSurface stay eager: the index dispatcher paints the vault
// surface's Recent lens (with a vault) or the Landing (without) on first
// load, so splitting them would block FCP on a network round-trip — and
// since LZ-4 the `/` and `/notes` doors share the ONE eager VaultSurface
// chunk (Home dissolved into it). Every other route gets its own chunk so
// the editor's CodeMirror, the graph's force-graph layer, settings, etc.
// don't pile into the initial download. DayView (the day drill-in, formerly
// Today's dual-purpose route) moved into this lazy set in W2-3 — the
// no-param front-door timeline it used to render (which DID need to be
// eager) is gone, absorbed into Home and now the Recent lens; what's left is
// a secondary destination reached from Calendar / day headers, same as any
// other room.
const Account = lazy(() => import("./routes/Account").then((m) => ({ default: m.Account })));
const Activity = lazy(() => import("./routes/Activity").then((m) => ({ default: m.Activity })));
const AddVault = lazy(() => import("./routes/AddVault").then((m) => ({ default: m.AddVault })));
const AddVaultChooser = lazy(() =>
  import("./routes/AddVaultChooser").then((m) => ({ default: m.AddVaultChooser })),
);
// AddVaultCreate + AddVaultReady live in ONE module (and so one chunk) on
// purpose: ready always follows create (a replace mid-ceremony), and a lazy
// Suspense "Loading…" flash between the creating tick and "X is ready." would
// break the ceremony's calm (§4.1 rule 4).
const AddVaultCreate = lazy(() =>
  import("./routes/AddVaultCreate").then((m) => ({ default: m.AddVaultCreate })),
);
const AddVaultReady = lazy(() =>
  import("./routes/AddVaultCreate").then((m) => ({ default: m.AddVaultReady })),
);
const Calendar = lazy(() => import("./routes/Calendar").then((m) => ({ default: m.Calendar })));
const ConnectAI = lazy(() => import("./routes/ConnectAI").then((m) => ({ default: m.ConnectAI })));
const DayView = lazy(() => import("./routes/DayView").then((m) => ({ default: m.DayView })));
const Import = lazy(() => import("./routes/Import").then((m) => ({ default: m.Import })));
const NoteEditor = lazy(() =>
  import("./routes/NoteEditor").then((m) => ({ default: m.NoteEditor })),
);
const NoteNew = lazy(() => import("./routes/NoteNew").then((m) => ({ default: m.NoteNew })));
const NoteView = lazy(() => import("./routes/NoteView").then((m) => ({ default: m.NoteView })));
const OAuthCallback = lazy(() =>
  import("./routes/OAuthCallback").then((m) => ({ default: m.OAuthCallback })),
);
const Settings = lazy(() => import("./routes/Settings").then((m) => ({ default: m.Settings })));
const Tags = lazy(() => import("./routes/Tags").then((m) => ({ default: m.Tags })));
const VaultGraph = lazy(() =>
  import("./routes/VaultGraph").then((m) => ({ default: m.VaultGraph })),
);
const Vaults = lazy(() => import("./routes/Vaults").then((m) => ({ default: m.Vaults })));
const Welcome = lazy(() => import("./routes/Welcome").then((m) => ({ default: m.Welcome })));
const CheckEmail = lazy(() =>
  import("./routes/CheckEmail").then((m) => ({ default: m.CheckEmail })),
);

// The boot dispatcher (`/`) — SYNTHESIS "boot dispatcher"; Aaron's confusion #2
// (a signed-in person never gets sent to an auth screen). Precedence: a vault
// connected on THIS device → the VaultSurface's Recent lens immediately (no
// network — `/` and `/notes` are one component since LZ-4, wearing different
// lenses); else ask the hosted door for the session and render the front door
// (signed-out), the "already signed in" card (signed-in, #9), or the net-error
// weather (#12). The session check gates first paint on `/` only — deep routes
// with a local vault are unaffected. `?add=<url>` stays a connect deep-link
// into `/add`.
function BootGate() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const [searchParams] = useSearchParams();
  const [decision, setDecision] = useState<BootDecision | null>(null);
  const startedRef = useRef(false);

  const run = useCallback(() => {
    startedRef.current = true;
    setDecision(null);
    // HUB-PARITY P4: prefetch the door descriptor in parallel with the
    // session check. By the time a signed-out decision renders FrontDoor
    // (`Landing.tsx`), its own `getDoorDescriptor()` call resolves from the
    // now-warm in-module cache instead of paying a second network round-trip
    // — shrinks the window where a password-only door briefly shows the
    // magic-link form before swapping to the ceremony-hop card.
    getDoorDescriptor().catch(() => {});
    resolveBoot({ hasLocalActiveVault: false })
      .then(setDecision)
      .catch(() => setDecision({ kind: "front-door" }));
  }, []);

  useEffect(() => {
    if (activeVault || startedRef.current) return;
    run();
  }, [activeVault, run]);

  // NAVIGATION.md: "BootGate ?add= → /add" — (b) one-shot param, replace.
  if (searchParams.get("add")) {
    return <Navigate to={`/add?${searchParams.toString()}`} replace />;
  }
  // A vault already lives on this device — the surface owns it, Recent lens.
  if (activeVault) return <VaultSurface lens="recent" />;
  // Resolving the session (brief) — a calm neutral loader, not "signing you in"
  // (we don't yet know who they are).
  if (!decision) return <BootLoading />;
  switch (decision.kind) {
    case "home":
      return <VaultSurface lens="recent" />;
    case "signed-in":
      return (
        <Landing
          signedIn={{ email: decision.email, username: decision.username, vaults: decision.vaults }}
        />
      );
    case "net-error":
      return <Landing netError={decision.message} onRetry={run} />;
    default:
      return <Landing />;
  }
}

function BootLoading() {
  return (
    <output
      aria-live="polite"
      className="mx-auto flex min-h-[50dvh] items-center justify-center text-sm text-fg-dim"
    >
      <span className="animate-pulse">Loading…</span>
    </output>
  );
}

// Fallback while a lazy route's chunk loads. Routes are tiny once split, so
// the round-trip is usually invisible — but if the network stalls (slow PWA
// cold-start, offline-with-stale-SW, throttled mobile) the user needs *some*
// signal that the app is doing work. `<output>` carries an implicit
// `role="status"`; we set `aria-live="polite"` explicitly because NVDA on
// Windows has historically inconsistent support for the implicit form, and
// the rest of the codebase (Toaster) already pairs status with explicit
// aria-live. The visible "Loading…" matches what sighted users see, so both
// audiences get the same affordance.
export function RouteFallback() {
  return (
    <output
      aria-live="polite"
      className="mx-auto block max-w-5xl px-6 py-10 text-center text-sm text-fg-dim"
    >
      Loading…
    </output>
  );
}

// Shim for pre-mount external bookmarks. When the app lived at the origin root,
// links were `/<id>` and `/<id>/edit`. After the frontend moved under its own
// mount (now `/notes/`), Tailscale strips that prefix, leaving internal
// `/<id>` and `/<id>/edit` — which the catch-all would otherwise bounce to
// `/`. Redirect them to the canonical `/n/<id>` routes so old bookmarks
// survive.
//
// One class of bare path must NOT be treated as a note: a ceremony-shaped path
// (`/login`, `/admin`, `/console`, …). Once the app is served same-origin with
// the auth/account ceremonies (Phase 1 — parachute-cloud#116) the service
// worker forwards those paths past the SPA to the real server page (the
// navigation denylist), so the route table has to agree — otherwise a note
// bookmarked as bare `/login` would be redirected to `/n/login` on the SPA
// side while a hard nav to the same URL lands on the ceremony, and the two
// would disagree. The canonical `/n/<id>` form is unaffected (it never matches
// the denylist), so a note literally named `login` stays reachable there. We
// test `window.location.pathname` — the origin-absolute path the SW itself
// evaluates — so the guard is mount-aware: under a `/notes` or `/surface/<slug>`
// mount the same note sits at `/notes/login`, which is not a ceremony, and
// still redirects. Only ordinary bare paths (`/MyNote`) keep the legacy shim.
// NAVIGATION.md: (a) redirect shims — replace throughout (a bare-path guess
// or a denylist bounce never really "was" a page the user should Back into).
function NoteIdRedirect({ suffix = "" }: { suffix?: string }) {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/" replace />;
  if (matchesNavigationDenylist(window.location.pathname)) {
    return <Navigate to="/" replace />;
  }
  return <Navigate to={`/n/${encodeURIComponent(id)}${suffix}`} replace />;
}

// W2-7 route renames (`/all`→`/notes`, `/graph`→`/map`): the old address
// becomes a shim to the new one, preserving any query string (a bookmark to
// `/all?view=pinned` must land on `/notes?view=pinned`, not just `/notes`).
// NAVIGATION.md: (a) redirect shim — replace throughout.
function ShimPreservingQuery({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
}

// The catch-all (`*` route — DESIGN-SPEC §2.5's route table: "keep the shim,
// plus a quiet toast", F7-adjacent): a typo'd or stale URL silently teleported
// home with zero acknowledgment before this fix — no different, from the
// user's seat, than the app just ignoring what they typed. One toast names
// what happened instead of a silent bounce. Fires at most once per mount
// (StrictMode double-invokes effects in dev; the ref guards a duplicate
// toast, not the redirect itself, which is idempotent either way).
function NotFoundRedirect() {
  const pushToast = useToastStore((s) => s.push);
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    pushToast("That page doesn't exist — brought you home.", "info");
  }, [pushToast]);
  // NAVIGATION.md: (a) redirect shim — replace.
  return <Navigate to="/" replace />;
}

// The ceremony-route gate (§4.1 rule 5 / F21 — no app-chrome noise under a
// ceremony) moved to `@/lib/nav/model` in W2-9 so the SpeedDial shares the
// same list. The AGPL ecosystem footer gates off it here.
function AppFooter() {
  const { pathname } = useLocation();
  if (isCeremonyPath(pathname)) return null;
  return (
    <footer className="mx-auto max-w-5xl px-6 py-10 text-center text-sm text-fg-dim">
      <p>
        Part of the{" "}
        <a href="https://parachute.computer" className="text-accent hover:underline">
          Parachute Computer
        </a>{" "}
        ecosystem. AGPL-3.0.
      </p>
    </footer>
  );
}

// Mounted under SyncProvider (which is under QueryProvider) so the
// reachability probe can use both `useQueryClient` and `useActiveVaultClient`.
// Renders no DOM — purely effects.
function ReachabilityProbeMount() {
  const activeId = useVaultStore((s) => s.activeVaultId);
  const client = useActiveVaultClient();
  useReachabilityProbe(activeId, client);
  return null;
}

export function App() {
  // Wired at the app root (not a provider) so the storage-event listener
  // outlives every route transition. Same vault state surfaces in every tab
  // without a refresh.
  useCrossTabVaultSync();
  // Apply the stored text-size on mount. Wired here rather than inline in
  // Settings so the preference takes effect on every route — Settings is
  // where you change it, App is where it lives.
  useEffect(() => {
    applyTextSize(readStoredTextSize());
  }, []);
  // Thread the active vault's name through the document title (Neil's trick —
  // the vault name is the identity everywhere). "Parachute — {vault}" with a
  // vault, plain "Parachute" without. index.html seeds the bare "Parachute".
  const activeVaultName = useVaultStore((s) => s.getActiveVault()?.name ?? null);
  useEffect(() => {
    document.title = activeVaultName ? `Parachute — ${activeVaultName}` : "Parachute";
  }, [activeVaultName]);
  return (
    <QueryProvider>
      <SyncProvider>
        <ReachabilityProbeMount />
        <TextSizeShortcutsMount />
        {/*
          Mount-agnostic basename: detected at runtime from window.location
          so the same built bundle works at `/notes/` (legacy daemon),
          `/surface/parachute/` (parachute-surface default), or `/surface/<custom-slug>/`
          (parachute-surface with a renamed install). See `src/lib/base-url.ts`
          for the detector + the design rationale.
        */}
        <BrowserRouter basename={detectMountBase()}>
          <div className="app-canvas min-h-dvh overflow-x-hidden text-fg">
            <Toaster />
            <UpdateBanner />
            <VaultStatusBanner />
            <AccountSessionBanner />
            <HubGateBanner />
            {/*
              The shell: a left Rail (desktop spine, hidden lg:flex) beside the
              content column. Below lg the Rail collapses and the mobile Header
              + BottomTabBar carry navigation. `pb-16 lg:pb-0` keeps content
              clear of the fixed bottom bar on mobile only.
            */}
            <div className="lg:flex">
              <Rail />
              <div className="flex min-w-0 flex-1 flex-col pb-16 lg:pb-0">
                <Header />
                <QuickSwitchMount />
                <main className="flex-1">
                  <Suspense fallback={<RouteFallback />}>
                    <Routes>
                      <Route path="/" element={<BootGate />} />
                      <Route path="/check-email" element={<CheckEmail />} />
                      {/*
                    /notes is the ONE SURFACE over the vault (LZ-3): the
                    VaultSurface, wearing the lens `?view=` names (All by
                    default; pinned/archived; the untagged/orphaned
                    maintenance views). Registered here — well before the
                    dynamic /:id bare-path shim below — so a note literally
                    named "notes" can never shadow this route; that note is
                    reachable only at /n/notes (same accepted tradeoff as the
                    ceremony denylist). React Router's ranked matching already
                    prefers static segments over /:id regardless of
                    declaration order (see App.test.tsx's "/settings wins"
                    guard), but the order stays literal/readable here too.
                  */}
                      <Route path="/notes" element={<VaultSurface />} />
                      {/*
                    /all is the pre-W2-7 address — a shim to /notes,
                    preserving any query string. NAVIGATION.md: (a) redirect
                    shim — replace.
                  */}
                      <Route path="/all" element={<ShimPreservingQuery to="/notes" />} />
                      {/*
                    The four built-in views are filters inside /notes now (a
                    ?view= chip), not their own routes. Old bookmarks redirect
                    into the filtered list so links keep working.
                    NAVIGATION.md: (a) redirect shims — replace throughout.
                  */}
                      <Route
                        path="/pinned"
                        element={<Navigate to="/notes?view=pinned" replace />}
                      />
                      <Route
                        path="/archived"
                        element={<Navigate to="/notes?view=archived" replace />}
                      />
                      <Route
                        path="/untagged"
                        element={<Navigate to="/notes?view=untagged" replace />}
                      />
                      <Route
                        path="/orphaned"
                        element={<Navigate to="/notes?view=orphaned" replace />}
                      />
                      <Route path="/tags" element={<Tags />} />
                      <Route path="/new" element={<NoteNew />} />
                      {/*
                    Capture and New were split surfaces pre-2026-05-27. Unified
                    into NoteNew per Aaron's "serious pass": one creation
                    screen with title up front, voice as an affordance.
                    Legacy `/capture` bookmarks redirect into the new flow.
                    NAVIGATION.md: (a) redirect shim — replace.
                  */}
                      <Route path="/capture" element={<Navigate to="/new" replace />} />
                      <Route path="/import" element={<Import />} />
                      <Route path="/connect" element={<ConnectAI />} />
                      {/*
                    W2-7: /map is the canonical Map room (label "Map" matches
                    address; earned-gated on both projections, §2.2). /graph
                    is the pre-W2-7 address — a shim to /map, preserving any
                    query string. NAVIGATION.md: (a) redirect shim — replace.
                  */}
                      <Route path="/map" element={<VaultGraph />} />
                      <Route path="/graph" element={<ShimPreservingQuery to="/map" />} />
                      <Route path="/today" element={<DayView />} />
                      <Route path="/calendar" element={<Calendar />} />
                      <Route path="/activity" element={<Activity />} />
                      <Route path="/n/:id" element={<NoteView />} />
                      <Route path="/n/:id/edit" element={<NoteEditor />} />
                      <Route path="/:id" element={<NoteIdRedirect />} />
                      <Route path="/:id/edit" element={<NoteIdRedirect suffix="/edit" />} />
                      <Route path="/add" element={<AddVault />} />
                      <Route path="/add-vault" element={<AddVaultChooser />} />
                      {/*
                    The creation ceremony's stepped URLs (W2-6, DESIGN-SPEC
                    §4.2): naming (+ the in-shell creating beat) at
                    /add-vault/create, the ready beat at /add-vault/ready.
                    The old /welcome?new=1 entry shims to /create inside the
                    Welcome dispatcher.
                  */}
                      <Route path="/add-vault/create" element={<AddVaultCreate />} />
                      <Route path="/add-vault/ready" element={<AddVaultReady />} />
                      <Route path="/welcome" element={<Welcome />} />
                      <Route path="/oauth/callback" element={<OAuthCallback />} />
                      <Route path="/vaults" element={<Vaults />} />
                      <Route path="/account" element={<Account />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="*" element={<NotFoundRedirect />} />
                    </Routes>
                  </Suspense>
                </main>
                <AppFooter />
              </div>
            </div>
            <BottomTabBar />
            <AmbientMapFab />
            {/* Desktop-only capture speed-dial (W2-9) — top-right, clear of
                the Map FAB's bottom-right corner. Mobile capture stays the
                BottomTabBar's centre [+]. */}
            <SpeedDial />
          </div>
        </BrowserRouter>
      </SyncProvider>
    </QueryProvider>
  );
}
