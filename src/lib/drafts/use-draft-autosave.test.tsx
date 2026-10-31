import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DraftBody, loadDraft, saveDraft } from "./store";
import { type DraftAutosave, useDraftAutosave } from "./use-draft-autosave";

const body = (over: Partial<DraftBody> = {}): DraftBody => ({
  content: "draft text",
  path: "Notes/x",
  tags: [],
  ...over,
});

function Harness({
  vaultId = "v1",
  scope = "new",
  body: b,
  enabled,
  onControls,
}: {
  vaultId?: string | null;
  scope?: string | null;
  body: DraftBody;
  enabled: boolean;
  onControls?: (c: DraftAutosave) => void;
}) {
  const controls = useDraftAutosave(vaultId, scope, b, enabled, 500);
  onControls?.(controls);
  return null;
}

describe("useDraftAutosave", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("persists the body after the debounce, not before", () => {
    render(<Harness body={body()} enabled />);
    expect(loadDraft("v1", "new")).toBeNull();
    act(() => vi.advanceTimersByTime(500));
    expect(loadDraft("v1", "new")?.body).toEqual(body());
  });

  it("only persists the latest body when it changes within the debounce window", () => {
    const { rerender } = render(<Harness body={body({ content: "A" })} enabled />);
    act(() => vi.advanceTimersByTime(200));
    rerender(<Harness body={body({ content: "B" })} enabled />);
    act(() => vi.advanceTimersByTime(500));
    expect(loadDraft("v1", "new")?.body.content).toBe("B");
  });

  it("clears an existing draft when enabled goes false", () => {
    saveDraft("v1", "new", body({ content: "stale" }));
    render(<Harness body={body()} enabled={false} />);
    expect(loadDraft("v1", "new")).toBeNull();
  });

  it("flushes immediately on pagehide (the backgrounded-PWA / crash case)", () => {
    render(<Harness body={body({ content: "unsaved" })} enabled />);
    // No debounce advance — pagehide must persist right away.
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(loadDraft("v1", "new")?.body.content).toBe("unsaved");
  });

  it("saved() cancels the pending write and never re-persists that body; editing re-arms", () => {
    let controls: DraftAutosave | null = null;
    const grab = (c: DraftAutosave) => {
      controls = c;
    };
    const { rerender } = render(
      <Harness body={body({ content: "sent" })} enabled onControls={grab} />,
    );
    act(() => vi.advanceTimersByTime(200));
    act(() => controls?.saved(body({ content: "sent" }), new Date().toISOString()));
    act(() => vi.advanceTimersByTime(1000));
    expect(loadDraft("v1", "new")).toBeNull();
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(loadDraft("v1", "new")).toBeNull();

    rerender(<Harness body={body({ content: "sent, and more" })} enabled onControls={grab} />);
    act(() => vi.advanceTimersByTime(500));
    expect(loadDraft("v1", "new")?.body.content).toBe("sent, and more");
  });

  // Codex (high) on the snags2 fix: the user keeps typing while the save is in
  // flight. saved() settles only the body that was sent; the newer text is
  // unsaved work and must still reach the draft store (debounce and pagehide).
  it("saved() for an older body leaves the newer, unsaved text autosaving", () => {
    let controls: DraftAutosave | null = null;
    const grab = (c: DraftAutosave) => {
      controls = c;
    };
    const { rerender } = render(
      <Harness body={body({ content: "A" })} enabled onControls={grab} />,
    );
    const startedAt = new Date().toISOString(); // Save clicked with "A"
    act(() => vi.advanceTimersByTime(200));
    rerender(<Harness body={body({ content: "A and B" })} enabled onControls={grab} />);
    act(() => vi.advanceTimersByTime(100));
    act(() => controls?.saved(body({ content: "A" }), startedAt)); // the save answers
    act(() => vi.advanceTimersByTime(500));
    expect(loadDraft("v1", "new")?.body.content).toBe("A and B");
  });

  it("saved() for an older body still lets pagehide flush the newer text", () => {
    let controls: DraftAutosave | null = null;
    const grab = (c: DraftAutosave) => {
      controls = c;
    };
    const { rerender } = render(
      <Harness body={body({ content: "A" })} enabled onControls={grab} />,
    );
    const startedAt = new Date().toISOString();
    rerender(<Harness body={body({ content: "A and B" })} enabled onControls={grab} />);
    act(() => controls?.saved(body({ content: "A" }), startedAt));
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(loadDraft("v1", "new")?.body.content).toBe("A and B");
  });

  it("discard() clears the draft and the pending write", () => {
    let controls: DraftAutosave | null = null;
    saveDraft("v1", "new", body({ content: "earlier" }));
    render(
      <Harness
        body={body({ content: "thrown away" })}
        enabled
        onControls={(c) => {
          controls = c;
        }}
      />,
    );
    act(() => controls?.discard());
    act(() => vi.advanceTimersByTime(1000));
    expect(loadDraft("v1", "new")).toBeNull();
  });

  it("does not flush on pagehide when disabled", () => {
    render(<Harness body={body()} enabled={false} />);
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(loadDraft("v1", "new")).toBeNull();
  });
});
