# parachute-app — the Parachute App

The portable, door-agnostic super-surface: the DEFAULT frontend for both doors (self-hosted
Hub and hosted Cloud). Real users on both — keep compatible.

## Gotchas

- **Tests are vitest** — `bun run test` (plus `bun run typecheck`, `bun run lint`). Bare
  `bun test` breaks: the `@/` alias only resolves through `vitest.config.ts`.
- **`next` is the trunk.** Branch from `next`, open the PR against `next`, never push to `next` or `main`.
  Concurrent PRs are fine when disjoint; serialize only when two branches heavily rewrite the same file. CI
  (`gates`: lint, typecheck, test, build, dist smoke, pack) runs on every PR and every push to `main` and `next`,
  and must be green before merge. A merge that changes `version` publishes to npm
  (`.github/workflows/release.yml` explains rc and stable).
- **Review is recorded in the PR body.** Every PR gets a fresh Claude reviewer (an agent that didn't write the code),
  written up in a `## Review` section with its verdict. GitHub approvals aren't used: Uni opens and merges PRs as
  `unforcedagi` after the review says ship.
- **This repo is public.** No private notes, real user data or secrets in code, tests, commits or PRs.
- **Merging here does NOT deploy.** Cloud embeds the SPA from a source pin
  (`parachute-cloud/scripts/spa-source.env`); promoting the app to hosted = a cloud pin-bump PR.
- **Aaron's box serves this app bun-linked at the hub origin root** — the dogfood ring runs the
  leading-edge local build ahead of cloud; what's live there is the local `dist`, not npm.
- **Toy-scale test vaults flatter the code.** UI work touching lists, filters, or tag surfaces
  gets checked against the realistic-scale sandbox (47 tags / 2,600 notes) before the PR:
  `bun run bigvault up` — see `scripts/bigvault/README.md`.
