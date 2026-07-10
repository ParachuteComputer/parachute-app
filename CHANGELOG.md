# Changelog — @openparachute/parachute-app

## [0.1.0] - 2026-07-10

Founding scaffold of the Parachute super-surface.

- Seeded the substrate from `parachute-surface/packages/notes-ui` (0.2.1): the
  vault client, OAuth/PKCE auth, offline sync/outbox layer, IndexedDB/OPFS, notes
  CRUD, and the `surface-client` / `surface-render` integration — kept intact.
- Resolved workspace deps to published npm (`@openparachute/surface-client@0.3.4`,
  `@openparachute/surface-render@0.2.0`).
- Root-hosted by default (`base: /`, `VITE_BASE_PATH=/`) for a standalone origin.
- Renamed the service identity to `parachute-app` / "Parachute".
- Kept the frozen `lens:*` storage namespace (origin-isolated; keeps the sync
  layer untouched).
- Rebuilt the shell + arrival + home to match the synthesized prototype: warm
  paper tokens (grass/sun/sage families, softer shadows, generous radii), the
  calm centered arrival with vault-name-as-identity threading, and a warm home
  with a focused composer and quiet quick-actions.
