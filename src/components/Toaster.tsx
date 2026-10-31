import { useToastStore } from "@/lib/toast/store";
import { useEffect } from "react";

const AUTO_DISMISS_MS = 4000;

// `aboveBottomBar`: on phones the fixed BottomTabBar owns the bottom edge and
// its raised + pokes above it, so while the bar is up the stack sits at the
// same height as the Map FAB (5rem + the home-indicator inset) instead of
// covering the +. From md up the bar is gone and the corner offset returns.
export function Toaster({ aboveBottomBar = false }: { aboveBottomBar?: boolean }) {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      window.setTimeout(() => dismiss(t.id), t.durationMs ?? AUTO_DISMISS_MS),
    );
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;

  return (
    <output
      aria-live="polite"
      data-above-bottom-bar={aboveBottomBar ? "true" : undefined}
      className={`pointer-events-none fixed left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2 ${
        aboveBottomBar ? "bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-6" : "bottom-6"
      }`}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`enter-rise pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border px-4 py-2 text-sm shadow-lift backdrop-blur ${
            t.tone === "error"
              ? // Parenthesis form, not bare custom-property brackets: Tailwind otherwise takes the
                // value literally (no var() wrap). The `(--foo)` shorthand does wrap it.
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
