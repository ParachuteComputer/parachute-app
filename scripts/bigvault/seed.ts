/**
 * Seed the sandbox vault over REST. A module, not a CLI: `bigvault.ts` calls
 * it with a base URL it constructed itself (127.0.0.1 + a validated port) —
 * there is deliberately no way to hand this code an arbitrary URL.
 */

import type { NotePlan, TagSpec } from "./taxonomy.ts";

const CONCURRENCY = 12;

export async function seedVault(opts: {
  base: string;
  token: string;
  taxonomy: TagSpec[];
  plan: NotePlan[];
  log?: (line: string) => void;
}): Promise<void> {
  const { base, token, taxonomy, plan, log = console.log } = opts;

  const api = async (path: string, init: RequestInit): Promise<void> => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`${init.method} ${path} -> ${res.status}: ${await res.text()}`);
  };

  // Schemas first: tag identity rows exist before any note references them.
  const typed = taxonomy.filter((t) => t.fields);
  for (const tag of typed) {
    await api(`/api/tags/${encodeURIComponent(tag.name)}`, {
      method: "PUT",
      body: JSON.stringify({ description: `Synthetic ${tag.name} notes.`, fields: tag.fields }),
    });
  }
  log(`   schemas -> ${typed.length} tags`);

  const queue = [...plan];
  let done = 0;
  const worker = async (): Promise<void> => {
    for (let job = queue.pop(); job; job = queue.pop()) {
      await api("/api/notes", { method: "POST", body: JSON.stringify(job) });
      done += 1;
      if (done % 500 === 0) log(`   ${done}/${plan.length} notes`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log(`   seeded ${done} notes`);
}
