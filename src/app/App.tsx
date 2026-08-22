import { AccountSessionBanner, HubGateBanner } from "@/components/AccountSessionBanner";
import { AmbientMapFab } from "@/components/AmbientMapFab";
import { BottomTabBar } from "@/components/BottomTabBar";
import { AppErrorBoundary, RouteErrorBoundary } from "@/components/ErrorBoundary";
import { FocusModeExitChip, FocusModeMount } from "@/components/FocusModeMount";
import { Header } from "@/components/Header";
import { MirrorStatusLine } from "@/components/MirrorStatusLine";
import { NavDrawer } from "@/components/NavDrawer";
import { QuickSwitchMount } from "@/components/QuickSwitchMount";
import { Rail } from "@/components/Rail";
import { SpeedDial } from "@/components/SpeedDial";
import { TextSizeShortcutsMount } from "@/components/TextSizeControl";
import { Toaster } from "@/components/Toaster";
import { UpdateBanner } from "@/components/UpdateBanner";
import { VaultStatusBanner } from "@/components/VaultStatusBanner";
import { EmptyState } from "@/components/ui/EmptyState";
import { type BootDecision, getDoorDescriptor, resolveBoot } from "@/lib/account";
import { detectMountBase } from "@/lib/base-url";
import { isFocusablePath, useFocusMode } from "@/lib/focus-mode";
import { NavBandsProvider, isCeremonyPath } from "@/lib/nav/model";
import { applyTextSize, readStoredTextSize } from "@/lib/text-size";
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
  Link,
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
const Export = lazy(() => import("./routes/Export").then((m) => ({ default: m.Export })));
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
// The derived tag page (`/tags/:name`) — a view rendered from the tag's own
// schema. Shares the ViewSurface chunk (imports its `ViewCanvas`).
const TagPage = lazy(() => import("./routes/TagPage").then((m) => ({ default: m.TagPage })));
const VaultGraph = lazy(() =>
  import("./routes/VaultGraph").then((m) => ({ default: m.VaultGraph })),
);
const Vaults = lazy(() => import("./routes/Vaults").then((m) => ({ default: m.Vaults })));
const Welcome = lazy(() => import("./routes/Welcome").then((m) => ({ default: m.Welcome })));
const CheckEmail = lazy(() =>
  import("./routes/CheckEmail").then((m) => ({ default: m.CheckEmail })),
);
// views-wave-1 (VIEWS-RENDER-SPEC): the view organ. ViewNew is the "New
// view" ceremony `/views/new` links to; ViewSurface renders `/views/:id`.
const ViewNew = lazy(() => import("./routes/ViewNew").then((m) => ({ default: m.ViewNew })));
const ViewSurface = lazy(() =>
  import("./routes/ViewSurface").then((m) => ({ default: m.ViewSurface })),
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
  if (activeVault) {
    return (
      <RouteErrorBoundary>
        <VaultSurface lens="recent" />
      </RouteErrorBoundary>
    );
  }
  // Resolving the session (brief) — a calm neutral loader, not "signing you in"
  // (we don't yet know who they are).
  if (!decision) {
    return (
      <RouteErrorBoundary>
        <BootLoading />
      </RouteErrorBoundary>
    );
  }
  switch (decision.kind) {
    case "home":
      return (
        <RouteErrorBoundary>
          <VaultSurface lens="recent" />
        </RouteErrorBoundary>
      );
    case "signed-in":
      return (
        <RouteErrorBoundary>
          <Landing
            signedIn={{
              email: decision.email,
              username: decision.username,
              vaults: decision.vaults,
            }}
          />
        </RouteErrorBoundary>
      );
    case "net-error":
      return (
        <RouteErrorBoundary>
          <Landing netError={decision.message} onRetry={run} />
        </RouteErrorBoundary>
      );
    default:
      return (
        <RouteErrorBoundary>
          <Landing />
        </RouteErrorBoundary>
      );
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

// The catch-all (`*` route — DESIGN-SPEC §2.5's route table). UI-audit
// finding #2/#3: a typo'd or stale URL used to bounce silently to `/` with
// only a toast — indistinguishable, from the user's seat, from the app just
// ignoring what they typed, and giving no way to tell "genuinely gone" from
// "hang on, still loading." A real page: friendly copy, one way back. Note
// this only ever catches a MULTI-segment or otherwise-unmatched path — a
// single bare segment (`/some-slug`) matches the `/:id` legacy-bookmark
// shim above and resolves through NoteView's own not-found state instead.
function NotFoundPage() {
  return (
    <div className="page">
      <EmptyState
        title={<span className="font-serif text-xl text-fg">Page not found</span>}
        description="That address doesn't match anything in Parachute. It may be mistyped, or the page may have moved."
        action={
          <Link to="/notes" className="btn btn-primary btn-touch">
            Back to notes
          </Link>
        }
      />
    </div>
  );
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
        <a href="https://parachute.computer" className="focus-ring text-accent hover:underline">
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

// Everything below the router basename — pulled out of `App()` into its own
// component (POLISH-WAVE PR 4) purely so it can call `useLocation()`: `App()`
// itself renders `<BrowserRouter>`, so it sits ABOVE the router context and
// can't read the route. `focusActive` gates the app chrome off both the
// store (ephemeral, reset on every navigation — FocusModeMount) AND
// `isFocusablePath` (only /n/:id and /n/:id/edit may ever show it) — the
// second check is belt-and-suspenders, not load-bearing, since the store
// can't stay `true` on a route it didn't arm on.
function AppShell() {
  const location = useLocation();
  const focusOn = useFocusMode((s) => s.on);
  const focusActive = focusOn && isFocusablePath(location.pathname);

  return (
    <div className="app-canvas min-h-dvh overflow-x-hidden text-fg">
      <Toaster />
      <UpdateBanner />
      <VaultStatusBanner />
      <AccountSessionBanner />
      <HubGateBanner />
      <MirrorStatusLine />
      <FocusModeMount />
      {/*
        The shell: a left nav column beside the content column. THREE bands
        now (the notes#147 contract as amended — see
        `navigation-breakpoint-contract.test.tsx`), and the nav column is a
        flex sibling in all of them, which is what lets both the desktop Rail
        and the tablet NavDrawer dock by animating their own width while the
        content reflows:
          · phone  (<768px)     — no nav column; Header + LensStrip +
                                  BottomTabBar + the modal NavSheet carry nav,
                                  and `pb-16` keeps content clear of the fixed
                                  bottom bar.
          · tablet (768–1023px) — the NavDrawer: a persistent 56px handle rail
                                  that slides out to a docked 288px panel.
          · desktop (>=1024px)  — the Rail (unchanged).
        `pb-16 md:pb-0` therefore drops the bottom-bar gutter at md, where the
        bar itself is gone. Focus mode (PR 4) drops
        Rail/NavDrawer/Header/BottomTabBar/AppFooter/SpeedDial/AmbientMapFab
        entirely — an instant unmount, not an exit animation: PR1 already
        settled "entrances only, exits stay instant" for every floating
        surface in this app, and re-litigating that here for the chrome
        itself would mean keeping it mounted mid-animation (the deferred-
        unmount machinery PR1 deliberately avoided).
      */}
      <div className="md:flex">
        {focusActive ? null : <NavDrawer />}
        {focusActive ? null : <Rail />}
        <div className={`flex min-w-0 flex-1 flex-col ${focusActive ? "" : "pb-16 md:pb-0"}`}>
          {focusActive ? null : <Header />}
          <QuickSwitchMount />
          <main
            className="flex-1"
            // The Header/Rail normally carry `env(safe-area-inset-top)` —
            // with both gone in focus mode, the inset moves here so a
            // notched device's camera/pill never overlaps the first line.
            // The data attribute exists because jsdom's CSSOM silently drops
            // `env()` values (verified: `el.style.paddingTop = "env(...)"`
            // round-trips to `""` in jsdom), so a real browser is the only
            // way to see the style itself — the attribute lets tests still
            // pin WHEN the relocation should apply.
            data-focus-safe-area={focusActive ? "true" : undefined}
            style={focusActive ? { paddingTop: "env(safe-area-inset-top)" } : undefined}
          >
            {/*
                    RESERVED PATH-SPACE (my. Phase A2, URL-TOPOLOGY.md §2.3 —
                    the one-origin door): once this app is served on
                    my.parachute.computer, `/vault/<name>/*` is the vault
                    worker's data plane (a Cloudflare zone route dispatches it
                    ABOVE this worker, before any route below ever sees the
                    request) and `/u/<handle>/*` is reserved for Phase B's
                    per-account vault namespace. NEITHER PREFIX MAY EVER GAIN
                    A ROUTE HERE — a client route matching `/vault/...` or
                    `/u/...` would only ever be reached if the zone route were
                    misconfigured, which must fail loudly (404), never fall
                    back to some SPA page pretending to be the data plane.
                    Nothing below collides today: the `/:id` bare-path shim
                    two routes down is single-segment only (RR7's exact match,
                    can't claim `/vault/x`), and no two-segment literal route
                    is named `vault` or `u`. `pwa-navigation-denylist.ts`
                    denies the same two prefixes at the service-worker layer;
                    App.test.tsx's "reserved path-space" cases pin that a
                    `/vault/<name>` or `/u/<handle>` navigation lands on the
                    `*` catch-all, not on NoteView.
                  */}
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<BootGate />} />
                <Route
                  path="/check-email"
                  element={
                    <RouteErrorBoundary>
                      <CheckEmail />
                    </RouteErrorBoundary>
                  }
                />
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
                <Route
                  path="/notes"
                  element={
                    <RouteErrorBoundary>
                      <VaultSurface />
                    </RouteErrorBoundary>
                  }
                />
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
                <Route path="/pinned" element={<Navigate to="/notes?view=pinned" replace />} />
                <Route path="/archived" element={<Navigate to="/notes?view=archived" replace />} />
                <Route path="/untagged" element={<Navigate to="/notes?view=untagged" replace />} />
                <Route path="/orphaned" element={<Navigate to="/notes?view=orphaned" replace />} />
                <Route
                  path="/tags"
                  element={
                    <RouteErrorBoundary>
                      <Tags />
                    </RouteErrorBoundary>
                  }
                />
                {/*
                    The derived tag page (tag-page wave): `/tags/:name` renders
                    a view derived from the tag's own schema — a typed tag opens
                    as a table, a plain tag as a list. Two-segment, so it never
                    collides with the single-segment `/:id` bare-path shim
                    below; `/tags` stays the tag directory.
                  */}
                <Route
                  path="/tags/:name"
                  element={
                    <RouteErrorBoundary>
                      <TagPage />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/new"
                  element={
                    <RouteErrorBoundary>
                      <NoteNew />
                    </RouteErrorBoundary>
                  }
                />
                {/*
                    Capture and New were split surfaces pre-2026-05-27. Unified
                    into NoteNew per Aaron's "serious pass": one creation
                    screen with title up front, voice as an affordance.
                    Legacy `/capture` bookmarks redirect into the new flow.
                    NAVIGATION.md: (a) redirect shim — replace.
                  */}
                <Route path="/capture" element={<Navigate to="/new" replace />} />
                <Route
                  path="/import"
                  element={
                    <RouteErrorBoundary>
                      <Import />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/export"
                  element={
                    <RouteErrorBoundary>
                      <Export />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/connect"
                  element={
                    <RouteErrorBoundary>
                      <ConnectAI />
                    </RouteErrorBoundary>
                  }
                />
                {/*
                    W2-7: /map is the canonical Map room (label "Map" matches
                    address; earned-gated on both projections, §2.2). /graph
                    is the pre-W2-7 address — a shim to /map, preserving any
                    query string. NAVIGATION.md: (a) redirect shim — replace.
                  */}
                <Route
                  path="/map"
                  element={
                    <RouteErrorBoundary>
                      <VaultGraph />
                    </RouteErrorBoundary>
                  }
                />
                <Route path="/graph" element={<ShimPreservingQuery to="/map" />} />
                <Route
                  path="/today"
                  element={
                    <RouteErrorBoundary>
                      <DayView />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/calendar"
                  element={
                    <RouteErrorBoundary>
                      <Calendar />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/activity"
                  element={
                    <RouteErrorBoundary>
                      <Activity />
                    </RouteErrorBoundary>
                  }
                />
                {/*
                    views-wave-1 (VIEWS-RENDER-SPEC §2/§6): the view organ.
                    `/views/new` is registered before the `:id` route so the
                    literal "new" segment can never be swallowed as an id
                    (React Router ranks static segments first regardless,
                    but the order stays literal/readable here too — same
                    convention as `/notes` above the `/:id` bare-path shim).
                  */}
                <Route
                  path="/views/new"
                  element={
                    <RouteErrorBoundary>
                      <ViewNew />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/views/:id"
                  element={
                    <RouteErrorBoundary>
                      <ViewSurface />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/n/:id"
                  element={
                    <RouteErrorBoundary>
                      <NoteView />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/n/:id/edit"
                  element={
                    <RouteErrorBoundary>
                      <NoteEditor />
                    </RouteErrorBoundary>
                  }
                />
                <Route path="/:id" element={<NoteIdRedirect />} />
                <Route path="/:id/edit" element={<NoteIdRedirect suffix="/edit" />} />
                <Route
                  path="/add"
                  element={
                    <RouteErrorBoundary>
                      <AddVault />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/add-vault"
                  element={
                    <RouteErrorBoundary>
                      <AddVaultChooser />
                    </RouteErrorBoundary>
                  }
                />
                {/*
                    The creation ceremony's stepped URLs (W2-6, DESIGN-SPEC
                    §4.2): naming (+ the in-shell creating beat) at
                    /add-vault/create, the ready beat at /add-vault/ready.
                    The old /welcome?new=1 entry shims to /create inside the
                    Welcome dispatcher.
                  */}
                <Route
                  path="/add-vault/create"
                  element={
                    <RouteErrorBoundary>
                      <AddVaultCreate />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/add-vault/ready"
                  element={
                    <RouteErrorBoundary>
                      <AddVaultReady />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/welcome"
                  element={
                    <RouteErrorBoundary>
                      <Welcome />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/oauth/callback"
                  element={
                    <RouteErrorBoundary>
                      <OAuthCallback />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/vaults"
                  element={
                    <RouteErrorBoundary>
                      <Vaults />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/account"
                  element={
                    <RouteErrorBoundary>
                      <Account />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <RouteErrorBoundary>
                      <Settings />
                    </RouteErrorBoundary>
                  }
                />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </main>
          {focusActive ? null : <AppFooter />}
        </div>
      </div>
      {focusActive ? null : <BottomTabBar />}
      {focusActive ? null : <AmbientMapFab />}
      {/* Desktop-only capture speed-dial (W2-9) — top-right, clear of
          the Map FAB's bottom-right corner. Mobile capture stays the
          BottomTabBar's centre [+]. */}
      {focusActive ? null : <SpeedDial />}
      {focusActive ? <FocusModeExitChip /> : null}
    </div>
  );
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
    // The last net (#48): mounted above every provider and the router itself
    // so a chrome-level throw (a provider, Rail, Header — anything the route-
    // level boundaries below don't cover) still lands on the honest full-page
    // card instead of a white screen.
    <AppErrorBoundary>
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
            {/*
              The ONE nav-model derivation (app#110 Finding A): Rail, NavDrawer,
              LensStrip and NavSheet all read `useNavBands()` from this provider instead
              of deriving it themselves — the breakpoint contract hides
              projections in CSS without unmounting them, so per-consumer
              derivation paid the model's data layer once per projection
              (historically the full-vault dateviews subscription, ×2 every
              route and ×3 with the mobile sheet; today the view-list socket
              and the bounded first-note probe — see useNavBandsModel).
              Mounted unconditionally (not behind the focus-mode gate): focus
              mode is a transient overlay, and keeping the model alive through
              it avoids tearing down and reopening the live layer on every
              focus toggle.
            */}
            <NavBandsProvider>
              <AppShell />
            </NavBandsProvider>
          </BrowserRouter>
        </SyncProvider>
      </QueryProvider>
    </AppErrorBoundary>
  );
}
