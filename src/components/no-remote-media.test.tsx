/**
 * A note must not make the reader's device load anything from outside the
 * vault. `![](https://tracker.example/x.png)` would tell that server the note
 * was opened, when and from where; an image that merely looks like storage on
 * another host must never get the vault token. Same rules as
 * parachute-surface#246, for the two places the app draws note images: note
 * markdown and the gallery card's cover.
 *
 * Made-up notes and hosts only. The vault client is the real one; only the
 * network (`fetchImpl`) is faked.
 */
import { NoteCard } from "@/components/views/NoteCard";
import { VaultClient } from "@/lib/vault/client";
import type { Note } from "@/lib/vault/types";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownView } from "./MarkdownView";

let client: VaultClient | null = null;
vi.mock("@/lib/vault/queries", () => ({ useActiveVaultClient: () => client }));

const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Blob(["png"])));

beforeAll(() => {
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
  globalThis.URL.revokeObjectURL = vi.fn();
});

beforeEach(() => {
  fetchImpl.mockClear();
  client = new VaultClient({
    vaultUrl: "https://hub.example/vault/default",
    accessToken: "pvt_owner",
    fetchImpl,
  });
});

/** Every URL the rendered DOM would make the browser load on its own. */
function loadedUrls(root: ParentNode): string[] {
  const out: string[] = [];
  for (const el of Array.from(root.querySelectorAll("[src],[srcset],[poster]"))) {
    for (const attr of ["src", "srcset", "poster"]) {
      const v = el.getAttribute(attr);
      if (v) out.push(v);
    }
  }
  return out;
}

const NOTE = [
  "# Weekly review",
  "",
  "![tracker pixel](https://tracker.example/open.png?note=1)",
  "",
  "![](http://plain.example/x.gif)",
  "",
  "![proto](//cdn.example/y.png)",
  "",
  "![lookalike](https://evil.example/api/storage/z.png)",
  "",
  "![other vault](https://hub.example/vault/other/api/storage/z.png)",
  "",
  "![script](javascript:alert(1))",
  "",
  "![ours](/api/storage/2026-11-13/ours.png)",
  "",
  "![ours absolute](https://hub.example/vault/default/api/storage/2026-11-13/abs.png)",
  "",
  "![inline](data:image/png;base64,iVBORw0KGgo=)",
].join("\n");

describe("note markdown images", () => {
  it("loads only this vault's storage (with the token); remote images become links", async () => {
    const { container } = render(
      <MemoryRouter>
        <MarkdownView content={NOTE} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByAltText("ours")).toHaveAttribute("src", "blob:mock"));

    // Only blob: (fetched through the client) and data: reach the DOM.
    for (const url of loadedUrls(container)) {
      expect(url.startsWith("blob:") || url.startsWith("data:"), url).toBe(true);
    }
    expect(screen.getByAltText("ours absolute")).toHaveAttribute("src", "blob:mock");
    // (react-markdown's own URL transform drops `data:` before we see it.)

    // The only requests were the vault's own storage, with the bearer.
    expect(fetchImpl.mock.calls.map(([u]) => String(u)).sort()).toEqual([
      "https://hub.example/vault/default/api/storage/2026-11-13/abs.png",
      "https://hub.example/vault/default/api/storage/2026-11-13/ours.png",
    ]);

    // A remote image is a link the reader can choose to open.
    const tracker = screen.getByRole("link", { name: "tracker pixel" });
    expect(tracker).toHaveAttribute("href", "https://tracker.example/open.png?note=1");
    expect(tracker).toHaveAttribute("target", "_blank");
    expect(tracker.getAttribute("rel")).toContain("noreferrer");
    expect(screen.getByRole("link", { name: "lookalike" })).toBeInTheDocument();
    // Not http(s) and not ours: words only.
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });
});

describe("gallery card cover", () => {
  function note(url: string): Note {
    return {
      id: "n1",
      content: "A trip",
      path: "Trip",
      tags: [],
      createdAt: "2026-11-13T00:00:00Z",
      updatedAt: "2026-11-13T00:00:00Z",
      attachments: [{ id: "a1", mimeType: "image/png", url }],
    } as unknown as Note;
  }

  it("a remote cover URL is never loaded", () => {
    const { container } = render(
      <MemoryRouter>
        <NoteCard
          note={note("https://tracker.example/cover.png")}
          pinnedTag="pinned"
          archivedTag="archived"
          variant="gallery"
        />
      </MemoryRouter>,
    );
    expect(loadedUrls(container)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a cover on this vault's storage loads through the client", async () => {
    const { container } = render(
      <MemoryRouter>
        <NoteCard
          note={note("https://hub.example/vault/default/api/storage/2026-11-13/c.png")}
          pinnedTag="pinned"
          archivedTag="archived"
          variant="gallery"
        />
      </MemoryRouter>,
    );
    await waitFor(() => expect(loadedUrls(container)).toEqual(["blob:mock"]));
    expect(fetchImpl.mock.calls.map(([u]) => String(u))).toEqual([
      "https://hub.example/vault/default/api/storage/2026-11-13/c.png",
    ]);
  });
});
