import { HueDot } from "@/components/HueDot";
import { IconCalendar, IconColumns, IconGrid, IconNotes } from "@/components/NavIcons";
import type { ViewKind } from "@/lib/views/schema";

// The Rail band / ViewSurface header's combined mark (VIEWS-RENDER-SPEC §9):
// the KIND carries the glyph (list/board/calendar/gallery — shape), the
// QUERY's primary tag carries the hue (subject — color). Kind never wears a
// hue of its own; a view with no subject tag renders glyph-only (HueDot
// itself returns null for an empty tag).
export function ViewNavIcon({ kind, hueTag }: { kind: ViewKind; hueTag?: string }) {
  return (
    <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
      <KindGlyph kind={kind} />
      <HueDot tag={hueTag} className="absolute -right-0.5 -bottom-0.5 ring-2 ring-(--color-card)" />
    </span>
  );
}

function KindGlyph({ kind }: { kind: ViewKind }) {
  switch (kind) {
    case "board":
      return <IconColumns width={16} height={16} />;
    case "calendar":
      return <IconCalendar width={16} height={16} />;
    case "gallery":
      return <IconGrid width={16} height={16} />;
    default:
      return <IconNotes width={16} height={16} />;
  }
}
