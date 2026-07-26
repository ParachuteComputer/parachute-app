# Parachute — the super-surface (`parachute-app`)

The go-to single-page app for interfacing with your Parachute. It is, at heart,
a **surface**: name a vault, capture and browse your notes, connect your AI, and
manage the **cloud** and the **hub** through their APIs — all from one calm,
warm home.

- **Layer:** L2 Surface (super-surface). Speaks the wire contract (vault REST/MCP,
  the cloud `/account/*` door contract, OAuth/PKCE).
- **Vision (Aaron):** *"The Parachute app is really just a surface — a single-page
  application that manages the cloud and the hub via their APIs. The ideal
  starting point for interfacing with your parachute. Our go-to super surface."*

## What this is (and isn't)

Seeded from `parachute-surface/packages/notes-ui` to keep the hard-won machinery
— the vault client, OAuth/PKCE auth, the offline sync/outbox layer,
IndexedDB/OPFS, notes CRUD, and the `surface-client` / `surface-render`
integration. The **arrival** and **home** were rebuilt to match the synthesized
prototype: a calm centered arrival, the vault-name-as-identity thread, and a
warm home with a focused composer and quiet quick-actions.

This app is developed **in parallel** with the currently-deployed notes-ui; it
does not touch that production path. Cut-over is a later decision.

## Install (self-host)

```sh
parachute install app     # bun add -g @openparachute/app
parachute start app       # served at <origin>/app, port 1944
```

The published package is a **prebuilt bundle**: the tarball carries `dist/`
(the SPA shell, hashed assets, service worker, PWA manifest) and nothing is
built on the operator's machine. `parachute start app` runs the hub's
static-serve shim (`parachute-hub` `src/notes-serve.ts --package
@openparachute/app`), which resolves the installed package's `dist/`
and serves it directly.

Because the shipped artifact *is* `dist/`, the `prepack` hook rebuilds it for
every `npm pack` / `npm publish`, and both CI and the release workflow refuse
to proceed unless the tarball actually contains `dist/index.html` +
`dist/assets/*`.

## Develop

```sh
bun install
bun run dev        # http://localhost:1942
bun run build      # tsc -b && vite build → dist/
bun run typecheck
bun run lint
bun run test       # vitest — bare `bun test` breaks (the `@/` alias only
                   # resolves through vitest.config.ts)
bun run test:smoke # assert a built dist/ is publishable (run after build)
```

Root-hosted by default (`base: /`). The runtime mount detector
(`src/lib/base-url.ts`) still lets the same bundle serve under a sub-path.

## Storage namespace

Keeps the frozen `lens:*` localStorage / IndexedDB keys from notes-ui. This app
runs at its own origin, so storage is isolated from any notes-ui install; reusing
the keys keeps the sync/outbox machinery untouched and any future data migration
between the two trivial.

Part of the [Parachute Computer](https://parachute.computer) ecosystem. AGPL-3.0.
