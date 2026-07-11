import { Landing } from "@/app/routes/Landing";
import { getSession, requestMagicLink } from "@/lib/account/client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The front door (SYNTHESIS #1): ONE email field that both signs in and creates
// (magic-link resolves new-vs-returning). Plus the self-hosted side door, the
// already-signed-in card (#9), and net-error weather (#12).

vi.mock("@/lib/account/client", () => ({
  getSession: vi.fn().mockResolvedValue({ signed_in: false, csrf: "csrf-123" }),
  requestMagicLink: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn().mockResolvedValue(undefined),
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

  it("renders the net-error weather with a retry", () => {
    const onRetry = vi.fn();
    renderLanding(<Landing netError="offline" onRetry={onRetry} />);
    expect(screen.getByText(/couldn't fetch your/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
