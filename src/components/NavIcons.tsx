// Shared inline nav glyphs for the desktop Rail and the mobile BottomTabBar.
// lucide-react isn't a dependency and keeps the bundle tight — these are the
// same 24-grid, 1.75-stroke line icons used across the chrome. Rendered at
// 20px; size via a wrapping element if a surface needs a different scale.

import type { SVGProps } from "react";

const BASE: SVGProps<SVGSVGElement> = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

// A clock face — the Recent lens mark (what you've touched lately).
export function IconClock(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2.5" />
    </svg>
  );
}

export function IconNotes(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <path d="M5 3.5h11l3 3V20.5H5z" />
      <path d="M15.5 3.5V7h3.5" />
      <path d="M8 11h8M8 14.5h8M8 17.5h5" />
    </svg>
  );
}

export function IconTag(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <path d="M20.5 12.5 12.5 20.5a2 2 0 0 1-2.83 0L3 13.83V3h10.83L20.5 9.67a2 2 0 0 1 0 2.83Z" />
      <circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" />
    </svg>
  );
}

export function IconPlus(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconSearch(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function IconUser(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" />
    </svg>
  );
}

export function IconCog(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9 1.7 1.7 0 0 0 4.26 7.13L4.2 7.07A2 2 0 1 1 7.03 4.24l.06.06A1.7 1.7 0 0 0 9 4.64 1.7 1.7 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1h.04a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
    </svg>
  );
}

// A pulse line — the Activity feed mark.
export function IconActivity(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <path d="M3 12h4l2.5-6 4 13 2.5-7H21" />
    </svg>
  );
}

// A month grid — the Calendar mark.
export function IconCalendar(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <rect x="4" y="5.5" width="16" height="15" rx="2" />
      <path d="M4 10.5h16" />
      <path d="M8.5 3.5V7M15.5 3.5V7" />
    </svg>
  );
}

// A dialed safe door — the Vaults mark (your places, kept).
export function IconVault(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 6.5v2M12 15.5v2M17.5 12h-2M8.5 12h-2" />
    </svg>
  );
}

// A four-point spark — the Connect-AI mark (✧ in the spec's shorthand).
export function IconSpark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <path d="M12 4c.9 4 3.1 6.2 7 7-3.9.8-6.1 3-7 7-.9-4-3.1-6.2-7-7 3.9-.8 6.1-3 7-7Z" />
    </svg>
  );
}

// An arrow settling into a tray — the Import mark (⇊ in the spec's shorthand).
export function IconImport(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <path d="M12 4v9" />
      <path d="m8.5 9.5 3.5 3.5 3.5-3.5" />
      <path d="M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15" />
    </svg>
  );
}

// An arrow rising out of a tray — the Export mark (⇈, mirrors Import's ⇊:
// same tray, arrow reversed — data leaving the vault instead of settling in).
export function IconExport(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <path d="M12 13V4" />
      <path d="m8.5 7.5 3.5-3.5 3.5 3.5" />
      <path d="M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15" />
    </svg>
  );
}

// A pen over a baseline — the speed-dial's "New note" verb (prototype 15's
// write glyph).
export function IconPen(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <path d="M14.5 5 19 9.5 9.5 19H5v-4.5z" />
      <path d="m12.5 7 4.5 4.5" />
      <path d="M4.5 21.5h15" />
    </svg>
  );
}

// A microphone — the speed-dial's "Voice note" verb.
export function IconMic(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3.5" />
    </svg>
  );
}

// A five-point star — the Pinned lens mark (mirrors NoteRow's ★ pinned cue).
export function IconStar(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <path d="m12 3.5 2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.65l5.9-.85Z" />
    </svg>
  );
}

// A lidded box — the Archive lens mark (set aside, never deleted).
export function IconArchive(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <rect x="3.5" y="4.5" width="17" height="4.5" rx="1" />
      <path d="M5.5 9v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9" />
      <path d="M10 13h4" />
    </svg>
  );
}

// A quiet chevron — the rail's collapse/expand toggle.
export function IconChevronLeft(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <path d="m14.5 6-5 6 5 6" />
    </svg>
  );
}

// Three lanes — a board view's kind glyph (views-wave-1, VIEWS-RENDER-SPEC §9).
export function IconColumns(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <rect x="3.5" y="4.5" width="5" height="15" rx="1.5" />
      <rect x="9.5" y="4.5" width="5" height="10" rx="1.5" />
      <rect x="15.5" y="4.5" width="5" height="13" rx="1.5" />
    </svg>
  );
}

// A 2x2 tile grid — a gallery view's kind glyph (deferred renderer, §4.4;
// the glyph still distinguishes the kind on a note that declares it).
export function IconGrid(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} aria-hidden="true" {...props}>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="1.5" />
    </svg>
  );
}

// A one-hub / three-satellite relational glyph — the Map mark.
export function IconMap(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} strokeWidth={1.6} aria-hidden="true" {...props}>
      <line x1="12" y1="12" x2="5" y2="5.5" />
      <line x1="12" y1="12" x2="19" y2="6.5" />
      <line x1="12" y1="12" x2="17" y2="18.5" />
      <circle cx="5" cy="5" r="2" />
      <circle cx="19.5" cy="6" r="2" />
      <circle cx="17.5" cy="19" r="2" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
