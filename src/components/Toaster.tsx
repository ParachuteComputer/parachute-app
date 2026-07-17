import { useToastStore } from "@/lib/toast/store";
import { useEffect } from "react";

const AUTO_DISMISS_MS = 4000;

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => window.setTimeout(() => dismiss(t.id), AUTO_DISMISS_MS));
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;

  return (
    <output
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`enter-rise pointer-events-auto flex max-w-md items-center gap-3 rounded-[var(--radius-lg)] border px-4 py-2 text-sm shadow-lift backdrop-blur ${
            t.tone === "error"
              ? // Parens form, not brackets: Tailwind's `[--foo]` bracket syntax takes the
                // value literally (no var() wrap) — it was silently compiling to the invalid
                // `color: --color-danger` on main. `(--foo)` is the CSS-var shorthand that
                // does wrap (same form PR 1 already relies on for `duration-(--dur-move)`).
                "border-(--color-danger-border) bg-(--color-danger-soft) text-(--color-danger)"
              : t.tone === "success"
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border bg-card text-fg-muted"
          }`}
        >
          <span>{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="focus-ring text-fg-dim hover:text-fg"
          >
            ×
          </button>
        </div>
      ))}
    </output>
  );
}
