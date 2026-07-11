import { WizardShell } from "@/components/WizardShell";
import { fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter, MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

// The ONE ceremony chrome (DESIGN-SPEC §4.1): wordmark-link always, a quiet
// escape unless the step auto-advances, segmented progress only when asked
// (the creation ceremony), and history-aware escape behavior.

function renderShell(ui: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/x"]}>
      <Routes>
        <Route path="/x" element={ui} />
        <Route path="/fallback" element={<p>Fallback screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WizardShell", () => {
  it("always renders the wordmark as a link (§4.1 rule 1)", () => {
    renderShell(<WizardShell escape={{ kind: "none" }}>content</WizardShell>);
    const wordmark = screen.getByRole("link", { name: /parachute/i });
    expect(wordmark).toHaveAttribute("href", "/");
  });

  it("renders a '← Back' escape by default for kind=back, honoring a custom label", () => {
    const { unmount } = renderShell(
      <WizardShell escape={{ kind: "back", to: "/fallback" }}>content</WizardShell>,
    );
    expect(screen.getByRole("button", { name: "← Back" })).toBeInTheDocument();
    unmount();

    renderShell(
      <WizardShell escape={{ kind: "back", to: "/fallback", label: "← Back to sign in" }}>
        content
      </WizardShell>,
    );
    expect(screen.getByRole("button", { name: "← Back to sign in" })).toBeInTheDocument();
  });

  it("renders a 'Maybe later' escape for kind=maybe-later", () => {
    renderShell(
      <WizardShell escape={{ kind: "maybe-later", to: "/fallback" }}>content</WizardShell>,
    );
    expect(screen.getByRole("button", { name: "Maybe later" })).toBeInTheDocument();
  });

  it("renders NO escape control for kind=none and for an omitted escape (auto-beats only)", () => {
    const { unmount } = renderShell(<WizardShell escape={{ kind: "none" }}>content</WizardShell>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    unmount();
    renderShell(<WizardShell>content</WizardShell>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("escapes fall back to the named route when there's no history behind (deep link)", () => {
    renderShell(<WizardShell escape={{ kind: "back", to: "/fallback" }}>content</WizardShell>);
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(screen.getByText("Fallback screen")).toBeInTheDocument();
  });

  it("renders the segmented progress bar ONLY when given (§4.1 rule 3), current marked", () => {
    const { unmount } = renderShell(
      <WizardShell
        escape={{ kind: "none" }}
        progress={{ labels: ["Name", "Making it", "Ready"], current: 1 }}
      >
        content
      </WizardShell>,
    );
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Making it")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    const current = document.querySelector('[aria-current="step"]');
    expect(current?.textContent).toBe("Making it");
    unmount();

    renderShell(<WizardShell escape={{ kind: "none" }}>content</WizardShell>);
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
  });
});

// The history-aware escape behavior needs a real <BrowserRouter> (the hook
// reads window.history.state.idx — a MemoryRouter keeps its own stack the
// hook can't see; see src/lib/nav/history.test.tsx).
describe("WizardShell — history-aware escape (BrowserRouter)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/a");
  });

  function PushButton({ to }: { to: string }) {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate(to)}>
        Go
      </button>
    );
  }

  it("goes BACK in real history when an in-app entry sits behind (never a forward push-loop)", async () => {
    render(
      <BrowserRouter>
        <Routes>
          <Route path="/a" element={<PushButton to="/b" />} />
          <Route
            path="/b"
            element={
              <WizardShell escape={{ kind: "maybe-later", to: "/fallback" }}>step</WizardShell>
            }
          />
          <Route path="/fallback" element={<p>Fallback screen</p>} />
        </Routes>
      </BrowserRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    fireEvent.click(await screen.findByRole("button", { name: "Maybe later" }));
    // Landed back on /a (real history), NOT on the fallback.
    expect(await screen.findByRole("button", { name: "Go" })).toBeInTheDocument();
  });
});
