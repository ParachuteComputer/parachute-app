# bigvault — a realistic-scale sandbox vault, one command

Every walkthrough vault this repo tested against had ~15 notes and 3–4 tags. A
real, lived-in vault runs ~47 tags and thousands of notes — and at that scale
two real bugs shipped that toy vaults could never show:

- **The blind filter panel.** Open Filters at 49 tags and the results are
  entirely off-screen — at 1440×900 zero result rows stayed visible, and on a
  phone the list vanished completely, so selecting a tag visibly changed
  nothing.
- **The bottomless tag page.** `/tags/<busy-tag>` rendered all 622 matching
  notes into a single 64,231px document — no cap, no pager, no count. (Row
  count is the stable figure; pixel height varies with device scale factor.)
- **All-notes pagination that doesn't paginate.** The same cause, worse:
  2,606 rows in a 330,339px page with both pager buttons dead, because a live
  subscription always delivers the complete matching set and overwrites the
  bounded poll. A cold visit moved 8.8 MiB and crossed the vault seven times.

All three shipped because every test vault was small enough to flatter the
code. This tool makes the realistic vault a one-command fixture.

## One command

```
bun run bigvault up
```

Boots a sandboxed vault server on :19572 seeded with 47 tags / 2,600 notes:
power-law distribution (a few tags on hundreds of notes, a long tail on one or
two), slash-namespaced families, field schemas from zero to nine fields, and
timestamps spread over two years so Recent reads like a lived-in vault. The
unevenness is the point. (The vault server adds its own starter content on a
fresh init — a couple of tags and a handful of guide notes — so the app shows
~49 tags; that's realism too.)

Then `bun run dev` and add a vault in the app with the printed URL + token.

Needs a `parachute-vault` checkout for the server binary — the sibling
`../parachute-vault` by default, or `--vault-repo <path>` /
`PARACHUTE_VAULT_REPO`.

`bun run bigvault status` shows what's running; `bun run bigvault down
[--wipe]` tears it down.

## Knobs

| flag | default | meaning |
| --- | --- | --- |
| `--tags N` | 47 | tag count — ≤47 truncates the curated head, more generates a tail |
| `--notes N` | 2600 | total notes, spread power-law (every tag gets at least one) |
| `--schema-share F` | 0.19 | fraction of tags carrying a field schema |
| `--max-fields N` | 9 | ceiling schema size; exactly one tag always carries it |
| `--seed N` | 424242 | PRNG seed |
| `--anchor DATE` | today UTC | the date treated as "now" for all timestamps |
| `--port N` | 19572 | vault server port (1939/1940/1941 refused) |
| `--home DIR` | `$TMPDIR/parachute-bigvault` | sandbox home |

Find the next ceiling: `bun run bigvault up --tags 500 --notes 10000`.

## Deterministic

Same inputs → the same vault: tag names, counts, schemas, note text, metadata,
and timestamps all derive from `--seed` and `--anchor`. The anchor defaults to
today (UTC), so re-runs within a day are identical; pin `--anchor` for exact
reproduction across days. `taxonomy.test.ts` holds this property in CI.

All content is **entirely synthetic** — invented names, invented prose,
nothing sampled from any real vault.

## Sandboxed, loudly

`sandbox.ts` gates every destructive step by construction, not convention:

- The sandbox home must carry a `.bigvault-sandbox` marker — the tool only
  ever wipes or backdates a directory **it created**. An existing directory
  without the marker is refused; `~/.parachute` (and anything inside or above
  it) is refused outright, marker or not.
- The live ports (hub :1939, vault :1940, agent :1941) are refused, and the
  seeder only ever dials `127.0.0.1` on a validated port — there is no way to
  hand it a URL.
- It never kills by port; only the server pid it recorded at boot.
- An ambient `PARACHUTE_HOME` is ignored (and warned about).

`sandbox.test.ts` pins every refusal.

## The probe (screenshots)

```
cd scripts/bigvault && bun install && bunx playwright install chromium   # once
bun scripts/bigvault/probe.ts --app http://localhost:5173
```

Captures the filter panel, tag directory, and tag pages at desktop (1440×900)
and phone (390×844) widths into `<sandbox-home>/shots/`. Playwright installs
privately to this folder — it is deliberately not an app dependency. Steps
needing a route the current branch doesn't have (e.g. `/tags/:name`) are
skipped, not fatal.

## The standing expectation

UI work that touches **lists, filters, or tag surfaces** gets checked against
a bigvault before the PR. A change that looks fine at 15 notes has not been
tested — it has been flattered.
