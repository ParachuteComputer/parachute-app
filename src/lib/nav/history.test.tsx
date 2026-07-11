import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { useHistoryAwareBack } from "./history";

// The hook reads the browser's real `window.history.state.idx` (see the file
// comment for why key-based detection is unsafe), so these tests drive it
// through a real <BrowserRouter> against a fresh window.history — a
// MemoryRouter keeps its own separate stack the hook can't see.

function EscapeButton({ fallbackTo }: { fallbackTo: string }) {
  const back = useHistoryAwareBack(fallbackTo);
  return (
    <button type="button" onClick={back}>
      Escape
    </button>
  );
}

function PushButton({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      Go
    </button>
  );
}

function ReplaceButton({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to, { replace: true })}>
      Replace
    </button>
  );
}

function CurrentPath() {
  const loc = useLocation();
  return <div data-testid="path">{loc.pathname}</div>;
}

function Harness({ fallbackTo }: { fallbackTo: string }) {
  return (
    <BrowserRouter>
      <CurrentPath />
      <Routes>
        <Route
          path="/a"
          element={
            <div>
              <p>Screen A</p>
              <PushButton to="/b" />
              <ReplaceButton to="/b" />
            </div>
          }
        />
        <Route
          path="/b"
          element={
            <div>
              <p>Screen B</p>
              <EscapeButton fallbackTo={fallbackTo} />
            </div>
          }
        />
        <Route path="/fallback" element={<p>Fallback screen</p>} />
      </Routes>
    </BrowserRouter>
  );
}

describe("useHistoryAwareBack", () => {
  beforeEach(() => {
    // Reset window.history.state to null so BrowserRouter re-initialises the
    // stack at idx 0 for each test (window.history is one shared singleton).
    window.history.replaceState(null, "", "/a");
  });

  it("goes back in history when a prior entry exists (a real push stacked one behind)", async () => {
    render(<Harness fallbackTo="/fallback" />);
    expect(screen.getByText("Screen A")).toBeInTheDocument();
    // A real user-initiated PUSH: /a -> /b (idx 0 -> 1).
    fireEvent.click(screen.getByRole("button", { name: /^go$/i }));
    await waitFor(() => expect(screen.getByText("Screen B")).toBeInTheDocument());
    // The escape should go BACK to /a (real history), not to the fallback.
    fireEvent.click(screen.getByRole("button", { name: /escape/i }));
    await waitFor(() => expect(screen.getByText("Screen A")).toBeInTheDocument());
  });

  it("falls back to the named route on a fresh first entry (idx 0, no history behind)", async () => {
    // Land directly on /b (a deep link / fresh tab) — idx 0, nothing behind.
    window.history.replaceState(null, "", "/b");
    render(<Harness fallbackTo="/fallback" />);
    expect(screen.getByText("Screen B")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /escape/i }));
    await waitFor(() => expect(screen.getByText("Fallback screen")).toBeInTheDocument());
  });

  it("falls back even after a first-entry REPLACE (the magic-link-tab trap the idx check fixes)", async () => {
    // /a is the first entry (idx 0). A `replace` to /b mints a FRESH
    // non-default key but keeps idx 0 — a key-based check would wrongly
    // believe there's history behind and navigate(-1) would exit the app.
    // The idx check must still fall back to the named route.
    render(<Harness fallbackTo="/fallback" />);
    fireEvent.click(screen.getByRole("button", { name: /replace/i }));
    await waitFor(() => expect(screen.getByText("Screen B")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /escape/i }));
    await waitFor(() => expect(screen.getByText("Fallback screen")).toBeInTheDocument());
  });
});
