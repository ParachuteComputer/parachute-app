import { AccountSessionBanner, HubGateBanner } from "@/components/AccountSessionBanner";
import { useAccountSessionStore } from "@/lib/account/store";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The session-expired banner (SYNTHESIS weather #12) + HUB-PARITY P4's two
// extra hub gates (force_change_password / admin_locked, design §2 row 4).
// Both are app-wide, NON-BLOCKING weather driven by `useAccountSessionStore`
// — reading local notes is never gated on either.

function renderBanner(ui: ReactElement, initial = "/") {
  return render(<MemoryRouter initialEntries={[initial]}>{ui}</MemoryRouter>);
}

beforeEach(() => {
  useAccountSessionStore.setState({ expired: false, gate: null });
  for (const meta of document.querySelectorAll('meta[name="parachute-mount"]')) {
    meta.remove();
  }
});
afterEach(() => {
  useAccountSessionStore.setState({ expired: false, gate: null });
  for (const meta of document.querySelectorAll('meta[name="parachute-mount"]')) {
    meta.remove();
  }
});

describe("AccountSessionBanner", () => {
  it("renders nothing when the session hasn't expired", () => {
    renderBanner(<AccountSessionBanner />);
    expect(screen.queryByText(/your sign-in ended/i)).not.toBeInTheDocument();
  });

  it("shows the non-blocking banner once the session is marked expired, and clears on dismiss", () => {
    useAccountSessionStore.getState().markExpired();
    renderBanner(<AccountSessionBanner />);
    expect(screen.getByText(/your sign-in ended/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(useAccountSessionStore.getState().expired).toBe(false);
  });
});

describe("HubGateBanner", () => {
  it("renders nothing with no gate set", () => {
    renderBanner(<HubGateBanner />);
    expect(screen.queryByText(/finish setting your password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/admin screen is locked/i)).not.toBeInTheDocument();
  });

  it("force_change_password → the non-blocking card, hop URL mount-aware to /account/change-password", () => {
    useAccountSessionStore.getState().markGate("force_change_password");
    const meta = document.createElement("meta");
    meta.setAttribute("name", "parachute-mount");
    meta.setAttribute("content", "/app");
    document.head.appendChild(meta);

    renderBanner(<HubGateBanner />, "/account");
    expect(screen.getByText(/finish setting your password/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /continue/i });
    expect(link).toHaveAttribute(
      "href",
      `/account/change-password?next=${encodeURIComponent("/app/account")}`,
    );
  });

  it("admin_locked → the locked-admin card, no navigation link", () => {
    useAccountSessionStore.getState().markGate("admin_locked");
    renderBanner(<HubGateBanner />);
    expect(screen.getByText(/admin screen is locked/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("dismiss clears the gate", () => {
    useAccountSessionStore.getState().markGate("admin_locked");
    renderBanner(<HubGateBanner />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(useAccountSessionStore.getState().gate).toBeNull();
  });
});
