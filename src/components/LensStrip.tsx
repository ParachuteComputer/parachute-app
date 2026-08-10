import { useNavBands } from "@/lib/nav/model";
import { Link, useLocation } from "react-router";

// The on-surface lens strip (LENS-SPEC §5.1, LZ-5) — the nav model's lens band
// projected ON the surface as a horizontal chip row, directly under the
// masthead, below `lg` ONLY: at lg+ the desktop Rail owns the lens set, and
// rendering both would duplicate the vocabulary D2 rejected. This is the
// retired desktop PresetFilterBar reborn in its old spot — but where that row
// carried its own five-view list, these chips ARE the Rail/NavSheet's lens
// items (`useNavBands()`'s "notes" band): single source, no second list to
// drift (the F14 lesson). With the bottom bar down to one surface tab (§5.2),
// this strip is how a phone switches lenses — every lens is one tap from any
// other, on every lens (Recent · All notes · Pinned · Archive).
//
// Tapping a chip is a PUSH navigation to the lens URL (NAVIGATION.md row 1:
// a lens switch is a place change — react-router Links push by default). The
// active chip wears the §3 grass-soft pill, same as the rail row it mirrors.
// The row scrolls horizontally if cramped, bleeding into the page padding so
// the scroll runs edge to edge.
//
// It keeps `lg:hidden` — i.e. it spans BOTH sub-desktop bands of the amended
// three-band contract (phone AND tablet), and is deliberately NOT one of the
// three primary-nav projections that contract counts. It is a filter control
// on the surface, not a room list: on a tablet the NavDrawer rests CLOSED, so
// this strip is what makes lens switching one tap rather than three, and the
// only moment both carry the lens set is while the drawer is deliberately held
// open. At lg+ the Rail is PERMANENT chrome, which is why the strip still
// yields there and only there. See `navigation-breakpoint-contract.test.tsx`.
export function LensStrip() {
  const bands = useNavBands();
  const location = useLocation();
  const lens = bands.find((b) => b.id === "notes");
  if (!lens || lens.items.length === 0) return null;
  return (
    <nav
      aria-label="Lenses"
      className="-mx-5 mb-6 flex gap-2 overflow-x-auto px-5 pb-1 md:-mx-8 md:px-8 lg:hidden"
    >
      {lens.items.map((item) => {
        const active = item.match(location);
        return (
          <Link
            key={item.id}
            to={item.to}
            data-nav-item={item.id}
            aria-current={active ? "page" : undefined}
            className={`focus-ring shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 font-round text-sm transition-colors ${
              active
                ? "border-transparent bg-grass-soft font-semibold text-grass-ink"
                : "border-border bg-card font-medium text-fg-muted hover:text-fg"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
