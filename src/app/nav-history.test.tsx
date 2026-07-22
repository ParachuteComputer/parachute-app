import { App } from "@/app/App";
import {
  getSession,
  listVaults,
  logout,
  mintAccountToken,
  requestMagicLink,
} from "@/lib/account/client";
import { getDoorDescriptor } from "@/lib/account/descriptor";
import { createHostedVault, openHostedVault } from "@/lib/account/hosted-vault";
import { MIRROR_FLAG_KEY } from "@/lib/mirror/flag";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two golden flows named in the W2-2 brief, driven through the REAL
 * `<App/>` (BrowserRouter, real `window.history`) rather than an isolated
 * MemoryRouter — this is what makes `window.history.length` deltas
 * meaningful, mirroring exactly how WALK-nav.md measured Mechanism A/B live
 * against a real browser. Component-level push/replace assertions (using
 * `useNavigationType()` probes) live beside each route's own test file;
 * this file is the end-to-end shape check.
 *
 * A note on the numbers (same caveat WALK-nav.md documents): jsdom's
 * `window.history` starts this test file at whatever length the previous
 * test in the same file left it at (browsers don't reset `history.length`
 * either) — so every assertion below is a DELTA against a baseline captured
 * at the top of each test, exactly as WALK-nav.md's own methodology states
 * ("the deltas... are what matter").
 */

vi.mock("@/lib/account/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/account/client")>("@/lib/account/client");
  return {
    ...actual,
    getSession: vi.fn(),
    requestMagicLink: vi.fn(),
    listVaults: vi.fn(),
    logout: vi.fn(),
    mintAccountToken: vi.fn(),
  };
});
// These golden flows are the CLOUD magic-link path, so the front door must
// resolve to a confirmed cloud descriptor (a null/absent one now paints the
// door-NEUTRAL card, which has no email field). The synchronous peek returns
// cloud too, so the front door paints cloud on first render (no neutral flash).
vi.mock("@/lib/account/descriptor", () => ({
  getDoorDescriptor: vi.fn().mockResolvedValue({ door: "cloud" }),
  peekDoorDescriptor: vi.fn().mockReturnValue({ door: "cloud" }),
  retryDoorDescriptorIfCold: vi.fn(),
}));
vi.mock("@/lib/account/hosted-vault", () => ({
  openHostedVault: vi.fn(),
  createHostedVault: vi.fn(),
}));

function stubFetch404() {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response("{}", { status: 404 })),
  );
}

async function submitSignInEmail() {
  await waitFor(() => expect(screen.getByLabelText(/email address/i)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/email address/i), {
    target: { value: "ag@unforced.org" },
  });
  fireEvent.click(screen.getByRole("button", { name: /email me a sign-in link/i }));
  await waitFor(() => expect(window.location.pathname).toBe("/check-email"));
}

/** CheckEmail polls every 3s (real `setInterval`, not mocked) — wait past one
 *  tick for real. Slower than a fake-timer approach, but avoids fake-timer/
 *  testing-library `waitFor` interaction footguns for a one-shot per test. */
async function waitPastCheckEmailPoll() {
  await new Promise((r) => setTimeout(r, 3200));
}

describe("Golden flows — history-depth measurements (mirrors WALK-nav.md)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // Real-App history/routing golden-flow test, not a mirror test. The mirror
    // is now ON by default; its background hydration engine adds async
    // re-renders that perturb these timing-sensitive nav/history assertions.
    // Force it OFF so the measured routing shape stays what this suite pins.
    localStorage.setItem(MIRROR_FLAG_KEY, "false");
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    window.history.replaceState({}, "", "/");
    stubFetch404();
    vi.mocked(getSession).mockReset();
    vi.mocked(requestMagicLink).mockReset().mockResolvedValue(undefined);
    vi.mocked(listVaults).mockReset();
    vi.mocked(logout).mockReset().mockResolvedValue(undefined);
    vi.mocked(mintAccountToken).mockReset().mockResolvedValue({ token: "acct-token" });
    vi.mocked(getDoorDescriptor).mockReset().mockResolvedValue({ door: "cloud" });
    vi.mocked(openHostedVault).mockReset().mockResolvedValue("v1");
    vi.mocked(createHostedVault).mockReset().mockResolvedValue("v1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Mechanism A, single-vault 'welcome-back' persona — the WALK-nav-measured shape is UNCHANGED (accepted limit)", async () => {
    // Every transition in THIS specific persona's chain (CheckEmail poll,
    // the /welcome dispatcher, the welcome-back auto-open beat) is
    // independently correct as `replace` per NAVIGATION.md rows (c)/(d) —
    // this is the table's own "accepted limit" row, not a regression this
    // PR introduces or a bug this PR is meant to fix. It's included here
    // so the claim is measured, not just asserted in prose.
    const baseline = window.history.length;
    vi.mocked(getSession).mockResolvedValue({ signed_in: false, csrf: "csrf-1" });
    render(<App />);

    await submitSignInEmail();
    // ONE push happened so far (front door -> /check-email).
    expect(window.history.length).toBe(baseline + 1);

    // The magic link was "clicked" in this same tab: getSession now
    // reports signed in, with exactly one account vault (welcome-back).
    vi.mocked(getSession).mockResolvedValue({
      signed_in: true,
      csrf: "csrf-2",
      email: "ag@unforced.org",
    });
    vi.mocked(listVaults).mockResolvedValue({ vaults: [{ name: "moss" }] });

    await waitPastCheckEmailPoll();
    // CheckEmail replace -> /welcome -> dispatcher replace -> welcome-back
    // auto-open replace -> "/". None of those grow the stack.
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    await waitFor(() => expect(openHostedVault).toHaveBeenCalledWith("moss"));
    expect(window.history.length).toBe(baseline + 1);

    // Reproduce WALK-nav's own observation: Back #1 is a visual no-op
    // (both remaining stack slots are "/", and BootGate paints Home off
    // the now-truthy activeVault store state regardless of which slot is
    // current — history position doesn't drive that render).
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();

    // Test hygiene: return to the tip entry (same URL, no new push) so a
    // stray "forward" entry doesn't distort the NEXT test's baseline delta
    // — jsdom's `history` is one real singleton shared across every test
    // in this file, exactly like a real tab's session history is shared
    // across everything that happens in it.
    window.history.forward();
    await waitFor(() => expect(window.location.pathname).toBe("/"));
  }, 10_000);

  it("Mechanism A, MANY-vaults picker persona — FIXED: Back now returns to the picker, not out of the app", async () => {
    const baseline = window.history.length;
    vi.mocked(getSession).mockResolvedValue({ signed_in: false, csrf: "csrf-1" });
    render(<App />);

    await submitSignInEmail();
    expect(window.history.length).toBe(baseline + 1);

    vi.mocked(getSession).mockResolvedValue({
      signed_in: true,
      csrf: "csrf-2",
      email: "ag@unforced.org",
    });
    vi.mocked(listVaults).mockResolvedValue({
      vaults: [{ name: "moss" }, { name: "journal" }, { name: "atlas" }],
    });

    await waitPastCheckEmailPoll();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /which vault today/i })).toBeInTheDocument(),
    );
    // The picker renders IN PLACE at /welcome — no navigation yet.
    expect(window.location.pathname).toBe("/welcome");
    expect(window.history.length).toBe(baseline + 1);

    // NAVIGATION.md fix: picking a vault now PUSHes / (was a gratuitous
    // replace before this PR).
    fireEvent.click(screen.getAllByRole("button", { name: /open →/i })[0] as HTMLElement);
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(window.history.length).toBe(baseline + 2);

    // Back returns to a REAL prior place — the picker — not out of the app.
    window.history.back();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /which vault today/i })).toBeInTheDocument(),
    );
    expect(window.location.pathname).toBe("/welcome");

    // Test hygiene (see the comment in the persona-1 test above).
    window.history.forward();
    await waitFor(() => expect(window.location.pathname).toBe("/"));
  }, 10_000);

  it("Mechanism B, magic-link opened in a fresh tab — accepted limit, UNCHANGED (spec's own call, not fixed by history policy)", async () => {
    // A magic-link click opens `/welcome` directly in a brand-new tab —
    // exactly one real history entry from the moment the tab exists.
    window.history.replaceState({}, "", "/welcome");
    const baseline = window.history.length;

    vi.mocked(getSession).mockResolvedValue({
      signed_in: true,
      csrf: "csrf-3",
      email: "ag@unforced.org",
    });
    vi.mocked(listVaults).mockResolvedValue({ vaults: [{ name: "moss" }] });

    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    await waitFor(() => expect(openHostedVault).toHaveBeenCalledWith("moss"));
    // The welcome-back beat replaces -> the stack never grew. NAVIGATION.md
    // names this explicitly as the accepted limit: the fix is the
    // wizard-chrome escape hatches (W2-6), not history surgery here.
    expect(window.history.length).toBe(baseline);
  }, 10_000);
});
