import { Composer } from "@/components/Composer";
import { useToastStore } from "@/lib/toast/store";
import { _resetEnsuredVaultsForTesting } from "@/lib/vault/schema-ensure";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T-318 / DESIGN-0.9 §8b-8c: `#capture` is opt-in, and the app must not
// require the tag to exist. Unlike Composer.test.tsx, nothing of ours is
// mocked here: the real settings hook, payload builder, schema-ensure, audit
// and VaultClient run against a fake vault (fetch is the only stub). The fake
// vault starts like a fresh cloud vault: the `guide` tag only, no `capture`.

const VAULT: VaultRecord = {
  id: "v1",
  url: "http://localhost:1940",
  name: "default",
  issuer: "http://localhost:1940",
  clientId: "c",
  scope: "full",
  addedAt: "2026-10-28T00:00:00.000Z",
  lastUsedAt: "2026-10-28T00:00:00.000Z",
};

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function installFakeVault(opts: { tagNewNotes?: boolean; tags?: string[] }) {
  const calls: Call[] = [];
  const tags = new Set(opts.tags ?? ["guide"]);
  const impl = vi.fn<typeof fetch>(async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const json = (b: unknown, status = 200) =>
      ({ ok: status < 400, status, json: async () => b, text: async () => "" }) as Response;

    if (method === "GET" && url.includes("notes%2Fsettings")) {
      if (opts.tagNewNotes === undefined) return json({ error: "Not found" }, 404);
      return json([
        {
          id: "settings",
          path: ".parachute/notes/settings",
          content: "",
          updatedAt: "2026-10-28T00:00:00.000Z",
          metadata: { notes: { schemaVersion: 1, tagNewNotes: opts.tagNewNotes } },
        },
      ]);
    }
    if (method === "POST" && url.includes("/api/notes")) {
      for (const t of (body?.tags as string[] | undefined) ?? []) tags.add(t);
      return json({ id: "created-1", createdAt: new Date().toISOString(), ...body }, 201);
    }
    if (method === "GET" && url.includes("/api/tags")) {
      return json([...tags].map((name) => ({ name, count: 0, description: null })));
    }
    if (method === "PUT" && url.includes("/api/tags/")) {
      tags.add(decodeURIComponent(url.split("/api/tags/")[1]!.split("?")[0]!));
      return json({}, 200);
    }
    if (url.includes("/api/vault")) return json({ name: "default" });
    if (url.includes("/api/notes?")) return json([]);
    return json(null, 404);
  });
  vi.stubGlobal("fetch", impl);
  return { calls, tags };
}

function renderComposer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
  render(
    <Wrap>
      <Composer vault={VAULT} />
    </Wrap>,
  );
}

async function typeAndSave(text: string) {
  const input = await screen.findByRole("textbox", { name: /what's on your mind\?/i });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /save to default/i }));
  await waitFor(() =>
    expect(useToastStore.getState().toasts.some((t) => t.message === "Saved to default")).toBe(
      true,
    ),
  );
}

const posted = (calls: Call[]) =>
  calls.find((c) => c.method === "POST" && c.url.includes("/api/notes"))?.body as {
    tags?: string[];
    metadata?: Record<string, unknown>;
  };

describe("Composer against a fresh vault with no `capture` tag", () => {
  beforeEach(() => {
    localStorage.clear();
    _resetEnsuredVaultsForTesting();
    useToastStore.setState({ toasts: [] });
    useVaultStore.setState({ vaults: { v1: VAULT }, activeVaultId: "v1" });
    localStorage.setItem(
      "lens:token:v1",
      JSON.stringify({ accessToken: "t", scope: "full", vault: "default" }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("opt-in off (no settings note): saves with no tags, never declares or audits a tag, no error", async () => {
    const vault = installFakeVault({});
    renderComposer();
    await typeAndSave("first thought");

    expect(posted(vault.calls).tags).toBeUndefined();
    expect(posted(vault.calls).metadata).toEqual({ source: "text", app: "notes" });
    // The app never asked the vault about tags, and never wrote one.
    expect(vault.calls.some((c) => c.url.includes("/api/tags"))).toBe(false);
    expect(vault.tags.has("capture")).toBe(false);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("opt-in ON: the untagged note gets #capture and the tag is declared on first use", async () => {
    const vault = installFakeVault({ tagNewNotes: true });
    renderComposer();
    // Wait for the settings note to load (the hint only shows when ON).
    fireEvent.focus(await screen.findByRole("textbox", { name: /what's on your mind\?/i }));
    expect(await screen.findByTestId("inbox-tag-hint")).toHaveTextContent("#capture");
    await typeAndSave("sort me later");

    expect(posted(vault.calls).tags).toEqual(["capture"]);
    await waitFor(() =>
      expect(
        vault.calls.some((c) => c.method === "PUT" && c.url.endsWith("/api/tags/capture")),
      ).toBe(true),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("opt-in ON, vault already has `capture`: the existing tag row is left alone", async () => {
    const vault = installFakeVault({ tagNewNotes: true, tags: ["guide", "capture"] });
    renderComposer();
    fireEvent.focus(await screen.findByRole("textbox", { name: /what's on your mind\?/i }));
    await screen.findByTestId("inbox-tag-hint");
    await typeAndSave("another one");

    expect(posted(vault.calls).tags).toEqual(["capture"]);
    await waitFor(() =>
      expect(vault.calls.some((c) => c.method === "GET" && c.url.includes("/api/tags"))).toBe(true),
    );
    expect(vault.calls.some((c) => c.method === "PUT")).toBe(false);
  });
});
