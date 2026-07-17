import { FocusModeMount } from "@/components/FocusModeMount";
import { useFocusMode } from "@/lib/focus-mode";
import { act, fireEvent, render } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// A minimal two-route harness: /n/abc is focusable, /notes is not. The nav
// link lets tests drive a real React Router navigation (not history.push
// directly) so FocusModeMount's `useLocation()` re-renders exactly as it
// would in the app.
function Harness() {
  return (
    <>
      <nav>
        <Link to="/n/abc">note</Link>
        <Link to="/notes">notes</Link>
        <Link to="/n/abc/edit">edit</Link>
      </nav>
      <FocusModeMount />
      <CurrentPath />
    </>
  );
}

function CurrentPath() {
  const { pathname } = useLocation();
  return <div data-testid="path">{pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  );
}

function pressCmdPeriod() {
  fireEvent.keyDown(window, { key: ".", metaKey: true });
}

describe("FocusModeMount", () => {
  beforeEach(() => {
    useFocusMode.setState({ on: false });
  });
  afterEach(() => {
    useFocusMode.setState({ on: false });
  });

  it("⌘. toggles focus mode on a focusable route", () => {
    renderAt("/n/abc");
    act(() => pressCmdPeriod());
    expect(useFocusMode.getState().on).toBe(true);
    act(() => pressCmdPeriod());
    expect(useFocusMode.getState().on).toBe(false);
  });

  it("⌘. is a no-op off a focusable route", () => {
    renderAt("/notes");
    act(() => pressCmdPeriod());
    expect(useFocusMode.getState().on).toBe(false);
  });

  it("Ctrl+. also toggles (non-Mac modifier)", () => {
    renderAt("/n/abc");
    act(() => {
      fireEvent.keyDown(window, { key: ".", ctrlKey: true });
    });
    expect(useFocusMode.getState().on).toBe(true);
  });

  it("a bare '.' (no modifier) does nothing", () => {
    renderAt("/n/abc");
    act(() => {
      fireEvent.keyDown(window, { key: "." });
    });
    expect(useFocusMode.getState().on).toBe(false);
  });

  it("navigating away resets focus mode off — even the read↔edit hop on the same note", () => {
    const { getByText } = renderAt("/n/abc");
    act(() => pressCmdPeriod());
    expect(useFocusMode.getState().on).toBe(true);

    act(() => {
      fireEvent.click(getByText("edit"));
    });
    expect(useFocusMode.getState().on).toBe(false);
  });

  it("navigating to another focusable route also resets — focus never survives a navigation", () => {
    const { getByText } = renderAt("/n/abc");
    act(() => pressCmdPeriod());
    expect(useFocusMode.getState().on).toBe(true);

    act(() => {
      fireEvent.click(getByText("notes"));
    });
    expect(useFocusMode.getState().on).toBe(false);
  });
});
