import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { describe, expect, it } from "vitest";
import { useHistoryAwareBack } from "./history";

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

function Harness({ fallbackTo, initial }: { fallbackTo: string; initial: string }) {
  return (
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route
          path="/a"
          element={
            <div>
              <p>Screen A</p>
              <PushButton to="/b" />
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
    </MemoryRouter>
  );
}

describe("useHistoryAwareBack", () => {
  it("goes back in history when a prior entry exists (real navigation happened)", () => {
    render(<Harness fallbackTo="/fallback" initial="/a" />);
    expect(screen.getByText("Screen A")).toBeInTheDocument();
    // A real user-initiated push: /a -> /b.
    fireEvent.click(screen.getByRole("button", { name: /go/i }));
    expect(screen.getByText("Screen B")).toBeInTheDocument();
    // The escape should go BACK to /a (real history), not to the fallback.
    fireEvent.click(screen.getByRole("button", { name: /escape/i }));
    expect(screen.getByText("Screen A")).toBeInTheDocument();
  });

  it("falls back to the named route when the current entry is the stack's first (location.key === 'default')", () => {
    // Landing directly on /b (a fresh tab / deep link / magic-link landing) —
    // there is nothing behind this entry, so history(-1) would exit the app.
    render(<Harness fallbackTo="/fallback" initial="/b" />);
    expect(screen.getByText("Screen B")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /escape/i }));
    expect(screen.getByText("Fallback screen")).toBeInTheDocument();
  });
});
