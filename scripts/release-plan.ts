/**
 * Decide whether @openparachute/app should publish, for the publish-on-merge
 * workflow.
 *
 * Ported from parachute-hub's `scripts/release-plan.ts` (hub#790). Lives here
 * rather than inline in release.yml because release logic that can
 * double-publish or silently drop a release deserves unit tests, not
 * untested shell in a `run:` block.
 *
 * ## What it guards against
 *
 * **Double-publishing.** Skip when the exact version already exists on npm, so
 * a re-run, a revert, or a merge that didn't bump is a no-op.
 *
 * **Silently skipping a real release.** An ambiguous registry response (5xx,
 * network failure) REFUSES rather than guessing. A false "not published"
 * double-publishes; a false "published" drops a release on the floor. Neither
 * is acceptable, so we don't pick one.
 *
 * **Publishing backwards.** As soon as PRs land in parallel: several open PRs
 * each pin their own `rc.N`, and they don't necessarily merge in version
 * order. Merging rc.6 and then rc.5 would leave the `rc` dist-tag pointing at
 * rc.5 — older than what consumers already had — so an operator installing
 * `@rc` would silently DOWNGRADE. We refuse to move a dist-tag backwards.
 * (Re-publishing an older version deliberately is still possible via an
 * explicit tag push, which takes the tag branch below.)
 */

/** Where a version stands relative to what's already published. */
export type PublishDecision =
  | { publish: true; reason: string }
  | { publish: false; reason: string }
  | { refuse: true; reason: string };

export interface RegistryView {
  /** True when this exact version is already on npm. */
  versionExists: boolean;
  /** Current version behind the dist-tag we'd move (`rc` or `latest`). */
  currentDistTagVersion?: string;
}

/** `rc` for a prerelease, `latest` otherwise. */
export function distTagFor(version: string): "rc" | "latest" {
  return /-rc\./.test(version) ? "rc" : "latest";
}

/**
 * Compare two semver-ish versions. Returns <0, 0, >0.
 *
 * Deliberately small rather than pulling a dependency into CI: handles
 * `X.Y.Z` and `X.Y.Z-rc.N`, which is the entire shape governance allows. A
 * release version always sorts ABOVE its own prereleases (0.7.5 > 0.7.5-rc.9),
 * matching semver.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.split("-");
    const nums = (core ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);
    // No prerelease sorts above any prerelease → Infinity.
    const preNum = pre
      ? Number.parseInt(pre.replace(/^rc\./, ""), 10) || 0
      : Number.POSITIVE_INFINITY;
    return { nums, preNum };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (pa.preNum === pb.preNum) return 0;
  return pa.preNum < pb.preNum ? -1 : 1;
}

/**
 * The decision. `isTagPush` short-circuits every check but the shape one — an
 * explicit tag is a human saying "release this", including a deliberate
 * re-release of something older.
 */
export function decidePublish(
  version: string,
  registry: RegistryView | { ambiguous: true },
  opts: { isTagPush?: boolean; branch?: string } = {},
): PublishDecision {
  if (opts.isTagPush) {
    return { publish: true, reason: `explicit tag push for ${version}` };
  }
  // `next` only ever cuts rc's. Unlike hub's decidePublish(), this function
  // has no matchingRcVersions()/suffix-drop check gating a stable publish on
  // an existing rc — so without this, a stable version merged to `next` (by
  // mistake, or a PR mistargeted mid-promotion) would publish straight to
  // `@latest`, bypassing `main` entirely. `main` is unaffected: it still
  // publishes rc OR stable, whatever's in package.json, same as before.
  if (opts.branch === "next" && distTagFor(version) !== "rc") {
    return {
      publish: false,
      reason: `${version} is a stable version pushed to next — stable promotions publish from main only`,
    };
  }
  if ("ambiguous" in registry) {
    return {
      refuse: true,
      reason:
        "couldn't determine what's published (registry error) — refusing to guess, " +
        "since a wrong answer either double-publishes or drops a release",
    };
  }
  if (registry.versionExists) {
    return { publish: false, reason: `${version} is already on npm` };
  }
  const current = registry.currentDistTagVersion;
  if (current && compareVersions(version, current) < 0) {
    return {
      refuse: true,
      reason: `${version} is OLDER than the current ${distTagFor(version)} (${current}) — publishing would move the dist-tag backwards and downgrade anyone installing it. This usually means parallel PRs merged out of version order; bump and re-merge.`,
    };
  }
  return { publish: true, reason: `${version} is not on npm` };
}

/** Query npm for a package's state. Ambiguity is reported, never guessed. */
export async function readRegistry(
  npmName: string,
  version: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RegistryView | { ambiguous: true }> {
  const encoded = npmName.replace("/", "%2f");
  try {
    const res = await fetchImpl(`https://registry.npmjs.org/${encoded}`);
    if (res.status === 404) {
      // Package has never been published at all — first release.
      return { versionExists: false };
    }
    if (!res.ok) return { ambiguous: true };
    const body = (await res.json()) as {
      versions?: Record<string, unknown>;
      "dist-tags"?: Record<string, string>;
    };
    return {
      versionExists: Boolean(body.versions?.[version]),
      currentDistTagVersion: body["dist-tags"]?.[distTagFor(version)],
    };
  } catch {
    return { ambiguous: true };
  }
}

/**
 * Commits sitting on `main` that no published version contains.
 *
 * Publish-on-merge skips silently when package.json already matches npm,
 * which is correct — but it means a fix merged just AFTER a release PR is
 * invisibly unpublished (hub hit this three times running: hub#794, #796,
 * #798). The version bump is a snapshot of main at merge time, and a release
 * PR cannot see what merges after it — so noticing has to happen here, on the
 * skip path.
 *
 * Advisory only: it warns, never fails. A release that legitimately hasn't
 * been cut yet is a normal state, not an error.
 *
 * Pure so it's testable without a repo; the caller supplies the log lines.
 */
export function unpublishedDrift(commitSubjects: readonly string[]): {
  drifted: boolean;
  count: number;
  summary: string;
} {
  const commits = commitSubjects.map((c) => c.trim()).filter((c) => c.length > 0);
  if (commits.length === 0) {
    return { drifted: false, count: 0, summary: "nothing unpublished" };
  }
  return {
    drifted: true,
    count: commits.length,
    summary: `${commits.length} commit(s) are NOT in any published version:\n${commits.map((c) => `  - ${c}`).join("\n")}\nOpen a release PR to ship them.`,
  };
}

// --- CLI -------------------------------------------------------------------
// Usage: bun scripts/release-plan.ts <package-dir> <npm-name> [--tag-push]
// Emits GitHub Actions outputs; exits non-zero on refusal.
//
// Node built-ins rather than the Bun.* globals hub's original used: this repo
// isn't Bun-native (no `@types/bun`, unlike hub — see its CLAUDE.md), so
// `Bun.file`/`Bun.write`/`Bun.spawnSync` don't typecheck here. Bun runs Node's
// `fs`/`child_process` APIs natively, so this is a straight swap, not a
// behavior change — except one bug it incidentally fixes: `Bun.write(path,
// data)` OVERWRITES rather than appends, so of the three `emit()` calls below
// only the last would have survived in `$GITHUB_OUTPUT`. That went unnoticed
// upstream because only `should_publish` (the last one emitted) is ever read
// back out. `appendFileSync` here actually appends.
if (import.meta.main) {
  const { readFileSync, appendFileSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");

  const [dir, npmName, ...rest] = process.argv.slice(2);
  if (!dir || !npmName) {
    console.error("usage: release-plan.ts <package-dir> <npm-name> [--tag-push]");
    process.exit(2);
  }
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
  const version: string = pkg.version;
  const registry = await readRegistry(npmName, version);
  const decision = decidePublish(version, registry, {
    isTagPush: rest.includes("--tag-push"),
    branch: process.env.GITHUB_REF_NAME,
  });

  const out = process.env.GITHUB_OUTPUT;
  const emit = (k: string, v: string) => {
    if (out) appendFileSync(out, `${k}=${v}\n`);
    console.log(`${k}=${v}`);
  };

  if ("refuse" in decision) {
    console.error(`::error::${npmName}@${version}: ${decision.reason}`);
    process.exit(1);
  }
  // On the skip path, say whether anything is stranded. A silent skip is
  // indistinguishable from "everything is shipped", which is how three fixes
  // in a row sat unpublished on main (hub's history — see above).
  if (!decision.publish && !rest.includes("--no-drift-check")) {
    try {
      const proc = spawnSync("git", ["log", `v${version}..HEAD`, "--oneline", "--no-merges"], {
        encoding: "utf8",
      });
      if (proc.status === 0) {
        const drift = unpublishedDrift((proc.stdout ?? "").split("\n"));
        if (drift.drifted) {
          console.log(`::warning::${npmName}: ${drift.summary}`);
          const sum = process.env.GITHUB_STEP_SUMMARY;
          if (sum) {
            appendFileSync(sum, `### Unpublished work\n\n\`\`\`\n${drift.summary}\n\`\`\`\n`);
          }
        }
      }
    } catch {
      // Never fail a run over the advisory check — a missing tag or a shallow
      // clone just means we can't tell, not that something is wrong.
    }
  }
  emit("version", version);
  emit("dist_tag", distTagFor(version));
  emit("should_publish", String(decision.publish));
  console.log(`${npmName}@${version}: ${decision.reason}`);
}
