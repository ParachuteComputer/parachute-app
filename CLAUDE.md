# parachute-app — the Parachute App

The portable, door-agnostic super-surface: the DEFAULT frontend for both doors (self-hosted
Hub and hosted Cloud). Real users on both — keep compatible.

## Gotchas

- **Tests are vitest** — `bun run test` (plus `bun run typecheck`, `bun run lint`). Bare
  `bun test` breaks: the `@/` alias only resolves through `vitest.config.ts`.
- **Single dev branch `ag-unforced-dev`, one PR at a time** — workspace flow in `../CLAUDE.md`.
- **Merging here does NOT deploy.** Cloud embeds the SPA from a source pin
  (`parachute-cloud/scripts/spa-source.env`); promoting the app to hosted = a cloud pin-bump PR.
- **Aaron's box serves this app bun-linked at the hub origin root** — the dogfood ring runs the
  leading-edge local build ahead of cloud; what's live there is the local `dist`, not npm.
- **Toy-scale test vaults flatter the code.** UI work touching lists, filters, or tag surfaces
  gets checked against the realistic-scale sandbox (47 tags / 2,600 notes) before the PR:
  `bun run bigvault up` — see `scripts/bigvault/README.md`.
