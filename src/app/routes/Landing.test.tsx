import { Landing } from "@/app/routes/Landing";
import { getSession, requestMagicLink } from "@/lib/account/client";
import { getDoorDescriptor, peekDoorDescriptor } from "@/lib/account/descriptor";
import { openHostedVault } from "@/lib/account/hosted-vault";
import { beginOAuth } from "@/lib/vault/oauth";
import { probeForIssuer } from "@/lib/vault/probe";
import { type NavLogEntry, NavTypeLog } from "@/test/nav-probe";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The front door forks on the door descriptor into THREE states (the fix for
// "cloud onboarding on a hub"):
//   - CONFIRMED cloud/magic-link → the email form (sign in OR create).
//   - CONFIRMED hub/password     → the HYBRID card (OAuth "Open your parachute"
//                                  + quiet "Manage this parachute").
//   - UNRESOLVED (null / in-flight / unclassifiable) → a door-NEUTRAL shell,
//                                  never cloud onboarding.
// Plus the self-hosted side door, the already-signed-in card (#9), and
// net-error weather (#12).

vi.mock("@/lib/account/client", () => ({
  getSession: vi.fn().mockResolvedValue({ signed_in: false, csrf: "csrf-123" }),
  requestMagicLink: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/account/descriptor", () => ({
  getDoorDescriptor: vi.fn().mockResolvedValue(null),
  // Cold synchronous peek (no warm cache) → the front door starts NEUTRAL and
  // resolves to the confirmed card via getDoorDescriptor; tests use findBy.
  peekDoorDescriptor: vi.fn().mockReturnValue(null),
  // The cold-miss self-heal re-arm (#81c) — a no-op stub for the fork tests.
  retryDoorDescriptorIfCold: vi.fn(),
}));

vi.mock("@/lib/account/hosted-vault", () => ({
  openHostedVault: vi.fn().mockResolvedValue("v1"),
}));

// The hub card's PRIMARY begins OAuth at the serving origin; mock the two
// pieces it reaches for so a click can be asserted without a live issuer.
vi.mock("@/lib/vault/oauth", () => ({
  beginOAuth: vi.fn(),
}));
vi.mock("@/lib/vault/probe", () => ({
  probeForIssuer: vi.fn(),
}));

// A confirmed cloud descriptor — the fixture the cloud-form tests run against
// (a null/absent descriptor now renders the NEUTRAL card, not the email form).
const CLOUD_DESCRIPTOR = { door: "cloud" as const };

function renderLanding(ui = <Landing />, initial = "/", navLog?: NavLogEntry[]) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      {navLog ? <NavTypeLog log={navLog} /> : null}
      <Routes>
        <Route path="/" element={ui} />
        <Route path="/add" element={<div>Add form</div>} />
        <Route path="/check-email" element={<div>Check email screen</div>} />
        <Route path="/welcome" element={<div>Welcome dispatcher</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Landing — the front door (confirmed cloud)", () => {
  beforeEach(() => {
    localStorage.clear();
    // Re-establish the factory defaults each run (mockClear alone would leave a
    // prior test's override in place; restoreAllMocks would wipe the impl).
    vi.mocked(getSession).mockReset().mockResolvedValue({ signed_in: false, csrf: "csrf-123" });
    vi.mocked(requestMagicLink).mockReset().mockResolvedValue(undefined);
    // The cloud email form only paints for a CONFIRMED cloud descriptor now.
    vi.mocked(getDoorDescriptor).mockReset().mockResolvedValue(CLOUD_DESCRIPTOR);
    vi.mocked(openHostedVault).mockReset().mockResolvedValue("v1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leads with one email field that signs in OR creates (not vault-naming)", async () => {
    renderLanding();
    expect(await screen.findByText(/sign in or create your account/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /email me a sign-in link/i })).toBeInTheDocument();
    expect(screen.getByText(/one link does both/i)).toBeInTheDocument();
    expect(screen.getByText(/free for 30 days/i)).toBeInTheDocument();
    // naming is gone from the door
    expect(screen.queryByText(/what should we call your vault/i)).not.toBeInTheDocument();
  });

  it("keeps the CTA disabled until a plausible email is entered", async () => {
    renderLanding();
    const cta = await screen.findByRole("button", { name: /email me a sign-in link/i });
    expect(cta).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "nope" } });
    expect(cta).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "moss@example.com" },
    });
    expect(cta).toBeEnabled();
  });

  it("requests the magic link (JSON, same-origin) and advances to check-email", async () => {
    renderLanding();
    fireEvent.change(await screen.findByLabelText(/email address/i), {
      target: { value: "moss@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /email me a sign-in link/i }));
    await waitFor(() => expect(screen.getByText("Check email screen")).toBeInTheDocument());
    expect(getSession).toHaveBeenCalled();
    expect(requestMagicLink).toHaveBeenCalledWith("moss@example.com", "csrf-123", "/welcome");
  });

  it("offers the self-hosted side door → /add", async () => {
    renderLanding();
    expect(await screen.findByRole("link", { name: /connect your own vault/i })).toHaveAttribute(
      "href",
      "/add",
    );
  });

  it("shows the expired-link cue on ?link=expired", async () => {
    renderLanding(<Landing />, "/?link=expired");
    expect(await screen.findByText(/that link has/i)).toBeInTheDocument();
    expect(screen.getByText(/no harm done/i)).toBeInTheDocument();
  });

  // The pricing line travels WITH the door: cloud's descriptor carries `plans`,
  // and the "from" price is derived (cheapest yearly), not hardcoded.
  it("derives the plans price line from the descriptor's `plans` (cheapest yearly)", async () => {
    vi.mocked(getDoorDescriptor).mockResolvedValue({
      door: "cloud",
      plans: [
        {
          id: "entry",
          name: "Entry",
          intervals: { yearly: { available: true, price: 10, label: "$10/yr" } },
        },
        {
          id: "standard",
          name: "Standard",
          intervals: { yearly: { available: true, price: 25, label: "$25/yr" } },
        },
      ],
    });
    renderLanding();
    expect(await screen.findByText(/plans from \$10 a year/i)).toBeInTheDocument();
  });

  it("renders the already-signed-in card (never a sign-in field) for a signed-in session", () => {
    renderLanding(<Landing signedIn={{ email: "ag@unforced.org", vaults: [{ name: "moss" }] }} />);
    expect(screen.getByText(/you're already signed in as/i)).toBeInTheDocument();
    expect(screen.getByText(/ag@unforced\.org/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open moss/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
  });

  // NAVIGATION.md: "Landing 'already signed in' card: Open {vault} → /" —
  // user-initiated, push (F7 offender: this used to be a gratuitous replace).
  it("Open {vault} on the already-signed-in card PUSHes / (NAVIGATION.md)", async () => {
    const navLog: NavLogEntry[] = [];
    renderLanding(
      <Landing signedIn={{ email: "ag@unforced.org", vaults: [{ name: "moss" }] }} />,
      "/",
      navLog,
    );
    fireEvent.click(screen.getByRole("button", { name: /open moss/i }));
    await waitFor(() => expect(openHostedVault).toHaveBeenCalledWith("moss"));
    await waitFor(() => expect(navLog.at(-1)).toEqual({ type: "PUSH", pathname: "/" }));
  });

  // NAVIGATION.md: "Sign out → /" — replace; the session context is gone, so
  // Back into a signed-in page would lie.
  it("Sign out REPLACEs / (NAVIGATION.md)", async () => {
    const navLog: NavLogEntry[] = [];
    renderLanding(
      <Landing signedIn={{ email: "ag@unforced.org", vaults: [{ name: "moss" }] }} />,
      "/",
      navLog,
    );
    // window.location.assign isn't implemented in jsdom navigation — stub it
    // so the post-signOut hard reload doesn't throw.
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: /not you\? sign out/i }));
    await waitFor(() => expect(navLog.at(-1)).toEqual({ type: "REPLACE", pathname: "/" }));
  });

  // HUB-PARITY P4: a hub-shaped session carries `username`, not `email` — the
  // already-signed-in card falls back `email ?? username`.
  it("falls back to username when a hub-shaped signed-in session has no email", () => {
    renderLanding(<Landing signedIn={{ username: "aaron", vaults: [{ name: "moss" }] }} />);
    expect(screen.getByText(/you're already signed in as/i)).toBeInTheDocument();
    expect(screen.getByText(/aaron/)).toBeInTheDocument();
  });

  it("renders the net-error weather with a retry", () => {
    const onRetry = vi.fn();
    renderLanding(<Landing netError="offline" onRetry={onRetry} />);
    expect(screen.getByText(/couldn't fetch your/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});

// The front door's door-descriptor fork: the NEUTRAL default (the bug fix), the
// hub HYBRID card, and the preserved cloud onboarding.
describe("Landing — front door, door descriptor fork", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(getSession).mockReset().mockResolvedValue({ signed_in: false, csrf: "csrf-123" });
    vi.mocked(requestMagicLink).mockReset().mockResolvedValue(undefined);
    vi.mocked(getDoorDescriptor).mockReset().mockResolvedValue(null);
    // Default cold peek (no warm cache) — the warm-cache test overrides this.
    vi.mocked(peekDoorDescriptor).mockReset().mockReturnValue(null);
    vi.mocked(beginOAuth)
      .mockReset()
      .mockResolvedValue({ authorizeUrl: "https://hub.example/authorize?x=1" } as never);
    vi.mocked(probeForIssuer).mockReset().mockResolvedValue("https://hub.example");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const meta of document.querySelectorAll('meta[name="parachute-mount"]')) {
      meta.remove();
    }
  });

  function stubAppMount() {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "parachute-mount");
    meta.setAttribute("content", "/app");
    document.head.appendChild(meta);
  }

  // (a) UNRESOLVED — null / in-flight / unclassifiable — is the door-NEUTRAL
  // shell: a "Sign in" affordance to /add, and NONE of the cloud onboarding.
  it("null / unresolved descriptor → NEUTRAL card (no cloud email, no pricing, no create-account)", async () => {
    vi.mocked(getDoorDescriptor).mockResolvedValue(null);
    renderLanding();
    const signIn = await screen.findByRole("link", { name: /^sign in/i });
    expect(signIn).toHaveAttribute("href", "/add");
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/free for 30 days/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/plans from/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sign in or create your account/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /create your account/i })).not.toBeInTheDocument();
  });

  // A descriptor claiming a door but carrying no usable auth is unclassifiable
  // → still NEUTRAL, never cloud.
  it("an unclassifiable descriptor ({ door: 'hub' }, no auth) → NEUTRAL, not cloud", async () => {
    vi.mocked(getDoorDescriptor).mockResolvedValue({ door: "hub" });
    renderLanding();
    expect(await screen.findByRole("link", { name: /^sign in/i })).toHaveAttribute("href", "/add");
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
  });

  // (b) CONFIRMED cloud — the existing onboarding is untouched.
  it("confirmed cloud descriptor → the existing cloud email form (no regression)", async () => {
    vi.mocked(getDoorDescriptor).mockResolvedValue({
      door: "cloud",
      auth: { methods: ["magic_link"], signin_path: "/login" },
    });
    renderLanding();
    expect(await screen.findByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /email me a sign-in link/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open your parachute/i })).not.toBeInTheDocument();
  });

  // (c) CONFIRMED hub — the HYBRID card. PRIMARY begins OAuth at the serving
  // origin (fastest to notes); no cloud email / pricing anywhere on it.
  it("confirmed hub → hybrid card: PRIMARY 'Open your parachute' begins OAuth at the serving origin", async () => {
    vi.mocked(getDoorDescriptor).mockResolvedValue({
      door: "hub",
      auth: { methods: ["password"], signin_path: "/login" },
    });
    const assign = vi.fn();
    vi.stubGlobal("location", {
      ...window.location,
      host: "hub.example.com",
      origin: "https://hub.example.com",
      assign,
    });

    renderLanding();
    const primary = await screen.findByRole("button", { name: /open your parachute/i });
    // No cloud onboarding on the hub card.
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/free for 30 days/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/plans from/i)).not.toBeInTheDocument();
    // Names the box.
    expect(screen.getByText(/hub\.example\.com/)).toBeInTheDocument();

    fireEvent.click(primary);
    await waitFor(() => expect(probeForIssuer).toHaveBeenCalledWith("https://hub.example.com"));
    await waitFor(() => expect(beginOAuth).toHaveBeenCalledWith("https://hub.example"));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://hub.example/authorize?x=1"));
  });

  // WARM-CACHE HUB paint (#81b): a door already KNOWN for this origin is peeked
  // SYNCHRONOUSLY, so the FIRST render is already the hub card — no NEUTRAL flash
  // before getDoorDescriptor resolves. Asserted with synchronous getBy* (no
  // findBy): the hub card must be present on the very first paint.
  it("warm-cache hub → first render is the hub card synchronously (no neutral flash)", () => {
    const hub = {
      door: "hub" as const,
      auth: { methods: ["password" as const], signin_path: "/login" },
    };
    vi.mocked(peekDoorDescriptor).mockReturnValue(hub);
    vi.mocked(getDoorDescriptor).mockResolvedValue(hub);
    renderLanding();
    // First paint IS the hub card — no await.
    expect(screen.getByRole("button", { name: /open your parachute/i })).toBeInTheDocument();
    // The neutral shell never flashed: no door-agnostic "Sign in →" link, and
    // none of the cloud onboarding.
    expect(screen.queryByRole("link", { name: /^sign in/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
  });

  it("confirmed hub → hybrid card: SECONDARY 'Manage this parachute' hops to the door /login?next=<mount /welcome>", async () => {
    vi.mocked(getDoorDescriptor).mockResolvedValue({
      door: "hub",
      auth: { methods: ["password"], signin_path: "/login" },
      signup_path: "/signup",
    });
    stubAppMount();
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });

    renderLanding();
    const manage = await screen.findByRole("button", { name: /manage this parachute/i });
    // The quiet signup affordance rides along on a self-serve door.
    expect(screen.getByRole("link", { name: /create your account/i })).toHaveAttribute(
      "href",
      "/signup",
    );
    // The self-host side door stays on this branch too.
    expect(screen.getByRole("link", { name: /connect your own vault/i })).toBeInTheDocument();

    fireEvent.click(manage);
    // signin_path is the DOOR's own path — origin-rooted, NEVER mount-prefixed.
    // next IS mount-prefixed (`/app/welcome`) — under a hub the app serves at
    // `/app`.
    expect(assign).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/app/welcome")}`);
  });

  it("confirmed hub, no signup_path → the operator-provisioned line, no signup link", async () => {
    vi.mocked(getDoorDescriptor).mockResolvedValue({
      door: "hub",
      auth: { methods: ["password"], signin_path: "/login" },
    });

    renderLanding();
    await screen.findByRole("button", { name: /open your parachute/i });
    expect(
      screen.getByText(/accounts on this parachute are created by its operator/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /create your account/i })).not.toBeInTheDocument();
  });

  it("confirmed hub with no mount base → the manage hop URL falls back to root (`/welcome`, no prefix)", async () => {
    vi.mocked(getDoorDescriptor).mockResolvedValue({
      door: "hub",
      auth: { methods: ["password"], signin_path: "/login" },
    });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });

    renderLanding();
    const manage = await screen.findByRole("button", { name: /manage this parachute/i });
    fireEvent.click(manage);
    expect(assign).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/welcome")}`);
  });

  it("hub PRIMARY falls back to the /add connect form when OAuth can't start", async () => {
    vi.mocked(getDoorDescriptor).mockResolvedValue({
      door: "hub",
      auth: { methods: ["password"], signin_path: "/login" },
    });
    vi.mocked(beginOAuth).mockRejectedValue(new Error("insecure context"));

    renderLanding();
    const primary = await screen.findByRole("button", { name: /open your parachute/i });
    fireEvent.click(primary);
    // Hands off to the full connect form (stubbed route content).
    await waitFor(() => expect(screen.getByText("Add form")).toBeInTheDocument());
  });
});
