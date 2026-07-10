// The Parachute glyph — a coral canopy over a warm-sun payload, the brand mark
// threaded through the prototype (arrival hero, wordmark, the creation canopy).
// Pure SVG on `currentColor`-free brand tokens so it reads identically on paper
// and in dark mode. `size` scales it; everything else is decorative.
export function ParachuteMark({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <path
        d="M8 30 Q32 2 56 30 Q49 37 42 30 Q37 38 32 30 Q27 38 22 30 Q15 37 8 30 Z"
        fill="var(--color-accent-light)"
      />
      <path d="M8 30 Q32 2 56 30" fill="none" stroke="var(--color-accent)" strokeWidth="1.4" />
      <line x1="8" y1="30" x2="30" y2="52" stroke="var(--color-fg-muted)" strokeWidth="1.3" />
      <line x1="22" y1="30" x2="30" y2="52" stroke="var(--color-fg-muted)" strokeWidth="1.3" />
      <line x1="42" y1="30" x2="34" y2="52" stroke="var(--color-fg-muted)" strokeWidth="1.3" />
      <line x1="56" y1="30" x2="34" y2="52" stroke="var(--color-fg-muted)" strokeWidth="1.3" />
      <rect
        x="26"
        y="50"
        width="12"
        height="10"
        rx="2.5"
        fill="var(--color-sun)"
        stroke="var(--color-sun-ink)"
        strokeWidth="1"
      />
    </svg>
  );
}

// Wordmark — the glyph beside the "Parachute" name, the identity lockup used in
// the arrival nav + wizard chrome.
export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 font-round font-bold text-fg">
      <ParachuteMark size={size} />
      <span>Parachute</span>
    </span>
  );
}
