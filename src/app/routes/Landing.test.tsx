import { Landing } from "@/app/routes/Landing";
import { getSession, requestMagicLink } from "@/lib/account/client";
import { getDoorDescriptor } from "@/lib/account/descriptor";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The front door (SYNTHESIS #1): ONE email field that both signs in and creates
// (magic-link resolves new-vs-returning). Plus the self-hosted side door, the
// already-signed-in card (#9), and net-error weather (#12). HUB-PARITY P4 adds
// the ONE door-conditional branch: a password-only door swaps the email form
// for a ceremony-hop card (see the "front door — door descriptor branch"
// describe block below).

vi.mock("@/lib/account/client", () => ({
  getSession: vi.fn().mockResolvedValue({ signed_in: false, csrf: "csrf-123" }),
  requestMagicLink: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn().mockResolvedValue(undefined),
}));

// Defaults to null (no descriptor) — the documented fallback that keeps every
// pre-P4 test's behavior byte-unchanged; individual tests override per fixture.
vi.mock("@/lib/account/descriptor", () => ({
  getDoorDescriptor: vi.fn().mockResolvedValue(null),
}));

function renderLanding(ui = <Landing />, initial = "/") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/" element={ui} />
        <Route path="/add" element={<div>Add form</div>} />
        <Route path="/check-email" element={<div>Check email screen</div>} />
        <Route path="/welcome" element={<div>Welcome dispatcher</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Landing — the front door", () => {
  beforeEach(() => {
    localStorage.clear();
    // Re-establish the factory defaults each run (mockClear alone would leave a
    // prior test's override in place; restoreAllMocks would wipe the impl).
    vi.mocked(getSession).mockReset().mockResolvedValue({ signed_in: false, csrf: "csrf-123" });
    vi.mocked(requestMagicLink).mockReset().mockResolvedValue(undefined);
    vi.mocked(getDoorDescriptor).mockReset().mockResolvedValue(null);
  });

  it("leads with one email field that signs in OR creates (not vault-naming)", () => {
    renderLanding();
    expect(screen.getByText(/sign in or create your account/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /email me a sign-in link/i })).toBeInTheDocument();
    expect(screen.getByText(/one link does both/i)).toBeInTheDocument();
    expect(screen.getByText(/free for 30 days/i)).toBeInTheDocument();
    // naming is gone from the door
    expect(screen.queryByText(/what should we call your vault/i)).not.toBeInTheDocument();
  });

  it("keeps the CTA disabled until a plausible email is entered", () => {
    renderLanding();
    const cta = screen.getByRole("button", { name: /email me a sign-in link/i });
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
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "moss@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /email me a sign-in link/i }));
    await waitFor(() => expect(screen.getByText("Check email screen")).toBeInTheDocument());
    expect(getSession).toHaveBeenCalled();
    expect(requestMagicLink).toHaveBeenCalledWith("moss@example.com", "csrf-123", "/welcome");
  });

  it("offers the self-hosted side door → /add", () => {
    renderLanding();
    expect(screen.getByRole("link", { name: /connect your own vault/i })).toHaveAttribute(
      "href",
      "/add",
    );
  });

  it("shows the expired-link cue on ?link=expired", () => {
    renderLanding(<Landing />, "/?link=expired");
    expect(screen.getByText(/that link has/i)).toBeInTheDocument();
    expect(screen.getByText(/no harm done/i)).toBeInTheDocument();
  });

  it("renders the already-signed-in card (never a sign-in field) for a signed-in session", () => {
    renderLanding(<Landing signedIn={{ email: "ag@unforced.org", vaults: [{ name: "moss" }] }} />);
    expect(screen.getByText(/you're already signed in as/i)).toBeInTheDocument();
    expect(screen.getByText(/ag@unforced\.org/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open moss/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
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

// HUB-PARITY P4 — the front door's ONE door-conditional branch (SYNTHESIS
// "PORTABILITY"): a password-only door (a hub) swaps the magic-link email
// form for a ceremony-hop card. Three fixtures per the build plan: magic_link
// (unchanged), password+signup, password-no-signup — plus the mount-aware hop
// URL under a simulated `/app` base (a hub-mounted app).
describe("Landing — front door, door descriptor branch", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(getSession).mockReset().mockResolvedValue({ signed_in: false, csrf: "csrf-123" });
    vi.mocked(requestMagicLink).mockReset().mockResolvedValue(undefined);
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

  it("magic_link door → the existing email form (byte-unchanged), not the ceremony-hop card", async () => {
    vi.mocked(getDoorDescriptor).mockResolvedValue({
      door: "cloud",
      auth: { methods: ["magic_link"], signin_path: "/login" },
    });
    renderLanding();
    await waitFor(() => expect(getDoorDescriptor).toHaveBeenCalled());
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue to sign in/i })).not.toBeInTheDocument();
  });

  it("password door + signup_path → the ceremony-hop card + a quiet signup link, mount-aware hop URL", async () => {
    vi.mocked(getDoorDescriptor).mockResolvedValue({
      door: "hub",
      auth: { methods: ["password"], signin_path: "/login" },
      signup_path: "/signup",
    });
    stubAppMount();
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });

    renderLanding();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /continue to sign in/i })).toBeInTheDocument(),
    );
    // The magic-link form is gone — no email field on a password-only door.
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    expect(screen.getByText(/sign in to your parachute/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create your account/i })).toHaveAttribute(
      "href",
      "/signup",
    );
    // The self-host side door stays on this branch too.
    expect(screen.getByRole("link", { name: /connect your own vault/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /continue to sign in/i }));
    // signin_path is the DOOR's own path — origin-rooted, NEVER mount-prefixed.
    // next IS mount-prefixed (`/app/welcome`) — under a hub the app serves at
    // `/app`.
    expect(window.location.assign).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent("/app/welcome")}`,
    );
  });

  it("password door, no signup_path → the operator-provisioned line, no signup link", async () => {
    vi.mocked(getDoorDescriptor).mockResolvedValue({
      door: "hub",
      auth: { methods: ["password"], signin_path: "/login" },
    });

    renderLanding();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /continue to sign in/i })).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/accounts on this parachute are created by its operator/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /create your account/i })).not.toBeInTheDocument();
  });

  it("password door with no mount base → the hop URL falls back to root (`/welcome`, no prefix)", async () => {
    vi.mocked(getDoorDescriptor).mockResolvedValue({
      door: "hub",
      auth: { methods: ["password"], signin_path: "/login" },
    });
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });

    renderLanding();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /continue to sign in/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /continue to sign in/i }));
    expect(window.location.assign).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent("/welcome")}`,
    );
  });
});
