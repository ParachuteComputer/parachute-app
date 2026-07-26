#!/usr/bin/env bun

/**
 * probe — screenshot the app against the bigvault sandbox at desktop and
 * phone widths: the filter panel at ~49 tags, the tag directory, and (when
 * the branch has them) tag pages for the busiest tag and the widest-schema
 * tag. This is the run that caught the blind filter panel and the 128,000px
 * tag page — point it at any branch's dev server before a list/filter/tag PR.
 *
 *   bun scripts/bigvault/probe.ts [--app http://localhost:5173] [--home DIR] [--out DIR]
 *
 * Steps that need a route or control the branch doesn't have are skipped,
 * not fatal. Screenshots land in <sandbox-home>/shots/ by default.
 *
 * Playwright is deliberately NOT an app dependency — install it privately to
 * this folder first (nothing in the repo's own manifest changes):
 *
 *   cd scripts/bigvault && bun install && bunx playwright install chromium
 *
 * (This file is excluded from `bun run typecheck` for the same reason.)
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_HOME, readRuntime } from "./sandbox.ts";

let chromium: typeof import("playwright")["chromium"];
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "probe: playwright is not installed (it is deliberately not an app dependency).\n" +
      "  cd scripts/bigvault && bun install && bunx playwright install chromium",
  );
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    app: { type: "string" },
    home: { type: "string" },
    out: { type: "string" },
  },
});

const home = values.home ?? DEFAULT_HOME;
const runtime = readRuntime(home);
if (!runtime) {
  console.error(`probe: no bigvault sandbox at ${home} — run: bun run bigvault up`);
  process.exit(1);
}
const app = (values.app ?? "http://localhost:5173").replace(/\/$/, "");
const out = values.out ?? join(home, "shots");
mkdirSync(out, { recursive: true });

// Pre-wire the vault the way the app stores it, so the probe lands signed-in.
const vaultSeed = {
  vaults: {
    dev: {
      id: "dev",
      url: `http://localhost:${runtime.port}/vault/default`,
      name: "Riverbed",
      issuer: `http://localhost:${runtime.port}`,
      clientId: "client-bigvault",
      scope: "full",
      addedAt: runtime.startedAt,
      lastUsedAt: runtime.startedAt,
    },
  },
  active: "dev",
  token: { accessToken: runtime.token, scope: "full", vault: "default" },
};

const browser = await chromium.launch();
let taken = 0;
let skipped = 0;

async function makePage(width: number, height: number) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript((seed) => {
    localStorage.setItem("lens:vaults", JSON.stringify(seed.vaults));
    localStorage.setItem("lens:active_vault", seed.active);
    localStorage.setItem("lens:token:dev", JSON.stringify(seed.token));
  }, vaultSeed);
  return page;
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    taken += 1;
    console.log(`  ok    ${name}`);
  } catch (err) {
    skipped += 1;
    const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.log(`  skip  ${name} — ${reason}`);
  }
}

const shot = (name: string) => join(out, `${name}.png`);
const rich = encodeURIComponent(runtime.richestTag);
const heavy = encodeURIComponent(runtime.heaviestTag);

for (const [label, width, height] of [
  ["desktop", 1440, 900],
  ["phone", 390, 844],
] as const) {
  const page = await makePage(width, height);
  const settle = (ms = 1200) => page.waitForTimeout(ms);

  await step(`${label}: notes list`, async () => {
    await page.goto(`${app}/notes`);
    await page.getByRole("button", { name: /filters/i }).waitFor({ timeout: 15000 });
    await settle(2000);
    await page.screenshot({ path: shot(`${label}-notes`) });
  });

  await step(`${label}: filter panel open at ${runtime.params.tags} tags`, async () => {
    await page.getByRole("button", { name: /filters/i }).click();
    await settle();
    await page.screenshot({ path: shot(`${label}-notes-filters-open`) });
  });

  await step(`${label}: tag list scrolled to the long tail`, async () => {
    const tagList = page.locator('nav[aria-label="Browse by tag"] ul');
    await tagList.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await settle(400);
    await page.screenshot({ path: shot(`${label}-notes-filters-tail`) });
  });

  await step(`${label}: tag directory`, async () => {
    await page.goto(`${app}/tags`);
    await page.getByRole("heading", { name: "Tags" }).waitFor({ timeout: 15000 });
    await settle(2000);
    await page.screenshot({ path: shot(`${label}-tags-directory`) });
    if (label === "desktop")
      await page.screenshot({ path: shot(`${label}-tags-directory-full`), fullPage: true });
  });

  // The remaining steps live on the /tags/:name route (the tag-page branch);
  // when the first one can't find it, its dependents skip instantly instead
  // of each burning their own timeout.
  let tagPageOk = false;
  await step(`${label}: tag page for #${runtime.richestTag} (widest schema)`, async () => {
    await page.goto(`${app}/tags/${rich}`);
    await page.getByRole("table").waitFor({ timeout: 15000 });
    await settle(1500);
    await page.screenshot({ path: shot(`${label}-tagpage-rich`) });
    tagPageOk = true;
  });

  await step(`${label}: fields control at ${runtime.params.maxFields} fields`, async () => {
    if (!tagPageOk) throw new Error("no tag page on this branch");
    await page.getByRole("button", { name: /fields/i }).click();
    await settle(600);
    await page.screenshot({ path: shot(`${label}-tagpage-rich-fields`) });
    await page.keyboard.press("Escape");
  });

  if (label === "desktop") {
    await step("desktop: group-by menu on the board lens", async () => {
      if (!tagPageOk) throw new Error("no tag page on this branch");
      await page.getByRole("button", { name: /lens/i }).click();
      await settle(400);
      await page.getByRole("menuitemradio", { name: "Board" }).click();
      await settle(1500);
      await page.getByRole("button", { name: /group by/i }).click();
      await settle(600);
      await page.screenshot({ path: shot("desktop-tagpage-rich-groupby") });
      await page.keyboard.press("Escape");
    });

    await step(`desktop: tag page for #${runtime.heaviestTag} (busiest tag)`, async () => {
      await page.goto(`${app}/tags/${heavy}`);
      await page.getByRole("heading", { name: runtime.heaviestTag }).waitFor({ timeout: 15000 });
      await settle(2500);
      const rows = await page.locator("main li, main tr").count();
      console.log(`        #${runtime.heaviestTag} rendered ~${rows} rows`);
      await page.screenshot({ path: shot("desktop-tagpage-heavy") });
    });
  }

  await page.context().close();
}

await browser.close();
console.log(`${taken} screenshots -> ${out}${skipped > 0 ? ` (${skipped} steps skipped)` : ""}`);
