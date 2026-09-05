import { MIRROR_FLAG_KEY } from "@/lib/mirror/flag";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

// app#186 / app#194 — `/v/<vault>/n/<note>`: a note link that names its own
// vault. Both segments take a name OR an id, and the note half may be a path.
//
// The mount base is detected from `window.location.pathname` at render time
// (`detectMountBase`), so this file exercises BOTH deploy shapes without a
// module mock: a path under `/notes/` lands the router on basename `/notes`,
// and a bare `/v/...` path lands it on the root mount (basename ""). Each test
// says which one it is standing in.

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response("{}", { status: 404 })),
  );
}

function vault(id: string, name: string): VaultRecord {
  return {
    id,
    url: `http://localhost:1940/vault/${name}`,
    name,
    issuer: "http://localhost:1940",
    clientId: "c",
    scope: "full",
    addedAt: "2026-08-30T00:00:00.000Z",
    lastUsedAt: "2026-08-30T00:00:00.000Z",
  };
}

/** Two connected vaults, `alpha` active — the cross-vault link case. */
function seedTwoVaults() {
  useVaultStore.setState({
    vaults: { "v-alpha": vault("v-alpha", "alpha"), "v-beta": vault("v-beta", "beta") },
    activeVaultId: "v-alpha",
  });
}

describe("App — vault-scoped deep links (app#186, app#194)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // Same posture as App.test.tsx: this is a routing test, not a mirror test —
    // the background hydration engine would only add re-renders to race.
    localStorage.setItem(MIRROR_FLAG_KEY, "false");
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    window.history.replaceState({}, "", "/notes/");
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("under the /notes mount", () => {
    it("switches to the named vault and hands off to the canonical /n/<id>", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/n/abc123");
      render(<App />);

      // The vault named in the URL becomes the active one…
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
      });
      // …and the note resolves at its canonical address under the mount. The
      // `/v/...` shim has said everything it has to say once the context is
      // switched, so it doesn't linger in the address bar.
      await waitFor(() => {
        expect(window.location.pathname).toBe("/notes/n/abc123");
      });
      // Never double-prefixed (the /notes/notes class of bug).
      expect(window.location.pathname.startsWith("/notes/notes")).toBe(false);
    });

    it("confirms the switch with the standard 'Now in {vault}' toast (DESIGN-SPEC §4.4)", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/n/abc123");
      render(<App />);
      expect(await screen.findByText(/now in beta/i)).toBeInTheDocument();
    });

    it("does NOT announce a switch when the link names the vault you're already in", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/alpha/n/abc123");
      render(<App />);
      await waitFor(() => {
        expect(window.location.pathname).toBe("/notes/n/abc123");
      });
      expect(useVaultStore.getState().activeVaultId).toBe("v-alpha");
      expect(screen.queryByText(/now in/i)).not.toBeInTheDocument();
    });

    it("carries the /edit tail through to the canonical editor route", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/n/abc123/edit");
      render(<App />);
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
        expect(window.location.pathname).toBe("/notes/n/abc123/edit");
      });
    });

    it("resolves the vault name case-insensitively", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/BETA/n/abc123");
      render(<App />);
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
        expect(window.location.pathname).toBe("/notes/n/abc123");
      });
    });

    it("percent-decodes the note id and re-encodes it on the canonical address", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/n/Projects%2FREADME");
      render(<App />);
      await waitFor(() => {
        expect(window.location.pathname).toBe("/notes/n/Projects%2FREADME");
      });
    });

    it("a vault-scoped link to a ceremony-word note id still resolves (no denylist false-bail)", async () => {
      // `/v/aaron/n/login` matches nothing in the navigation denylist — the
      // prefixes are anchored at the start of the pathname. The bare-path shim's
      // ceremony guard must not leak into this route.
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/n/login");
      render(<App />);
      await waitFor(() => {
        expect(window.location.pathname).toBe("/notes/n/login");
      });
    });
  });

  describe("at the root mount", () => {
    it("switches and hands off with an empty basename", async () => {
      seedTwoVaults();
      // No recognised sub-mount in this pathname → detectMountBase returns "".
      window.history.replaceState({}, "", "/v/beta/n/abc123");
      render(<App />);
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
        expect(window.location.pathname).toBe("/n/abc123");
      });
    });
  });

  describe("unknown vault", () => {
    it("shows a real in-app state naming the vault, at the address the reader landed on", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/gamma/n/abc123");
      render(<App />);

      expect(await screen.findByText(/is not connected here/i)).toBeInTheDocument();
      expect(screen.getByText("gamma")).toBeInTheDocument();
      // Not a blank screen, not the generic 404, and no silent teleport — the
      // URL stays put so the reader can see (and re-copy) the link that failed.
      expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
      expect(window.location.pathname).toBe("/notes/v/gamma/n/abc123");
    });

    it("offers the existing connect affordance", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/gamma/n/abc123");
      render(<App />);
      await screen.findByText(/is not connected here/i);
      // The connect link carries the address that failed, so finishing the
      // connect returns here and resolves it (app B/6 — own describe below).
      expect(screen.getByRole("link", { name: /connect a vault/i })).toHaveAttribute(
        "href",
        "/notes/add?redirect=%2Fv%2Fgamma%2Fn%2Fabc123",
      );
      expect(screen.getByRole("link", { name: /your vaults/i })).toHaveAttribute(
        "href",
        "/notes/vaults",
      );
    });

    it("never resolves the note against the vault that happens to be active", async () => {
      // The whole point of the route: an unresolvable vault name is a dead end,
      // NOT a fallback to current-vault semantics (which would silently show the
      // wrong note, or the right id in the wrong vault).
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/gamma/n/abc123");
      render(<App />);
      await screen.findByText(/is not connected here/i);
      expect(useVaultStore.getState().activeVaultId).toBe("v-alpha");
    });

    it("shows the same state when no vault is connected at all", async () => {
      window.history.replaceState({}, "", "/notes/v/beta/n/abc123");
      render(<App />);
      expect(await screen.findByText(/is not connected here/i)).toBeInTheDocument();
    });
  });

  describe("the note reference — id or path (app#194)", () => {
    it("resolves a ULID note id", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/n/01JBQZ0Q2M8T9V5X7YB3KD4WEN");
      render(<App />);
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
        expect(window.location.pathname).toBe("/notes/n/01JBQZ0Q2M8T9V5X7YB3KD4WEN");
      });
    });

    it("takes a multi-segment PATH as the note reference", async () => {
      // The hand-written form. A note is addressable by path, and a path has
      // slashes — the splat route takes the whole remainder of the URL and the
      // canonical address re-encodes it into one segment.
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/n/Projects/2026/Roadmap");
      render(<App />);
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
        expect(window.location.pathname).toBe("/notes/n/Projects%2F2026%2FRoadmap");
      });
    });

    it("carries the /edit tail on a multi-segment path", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/n/Projects/2026/Roadmap/edit");
      render(<App />);
      await waitFor(() => {
        expect(window.location.pathname).toBe("/notes/n/Projects%2F2026%2FRoadmap/edit");
      });
    });

    it("keeps an encoded single-segment path ending in /edit as the note reference", async () => {
      // The encoded slash keeps this on the higher-ranked `:id` route. The
      // literal `edit` belongs to the note path, not the editor-route suffix.
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/n/Notes%2Fedit");
      render(<App />);
      await waitFor(() => {
        expect(window.location.pathname).toBe("/notes/n/Notes%2Fedit");
      });
    });

    it("a path and its percent-encoded form land on the SAME canonical address", async () => {
      // The two spellings of one address must not drift: whichever a reader
      // pastes, NoteView receives the identical reference.
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/n/Projects%2FREADME");
      const encoded = render(<App />);
      await waitFor(() => {
        expect(window.location.pathname).toBe("/notes/n/Projects%2FREADME");
      });
      encoded.unmount();

      useVaultStore.setState({ activeVaultId: "v-alpha" });
      window.history.replaceState({}, "", "/notes/v/beta/n/Projects/README");
      render(<App />);
      await waitFor(() => {
        expect(window.location.pathname).toBe("/notes/n/Projects%2FREADME");
      });
    });

    it("an empty note reference lands on that vault's notes, not a dead end", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/n/");
      render(<App />);
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
        expect(window.location.pathname).toBe("/notes/notes");
      });
    });
  });

  describe("the vault reference — name or id (app#194)", () => {
    it("resolves the vault by its id", async () => {
      // `vaultIdFromUrl` is derived from the vault URL, so this form resolves on
      // every device that connected the same vault — even one whose local label
      // was renamed away from the server slug (app#191).
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/v-beta/n/abc123");
      render(<App />);
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
        expect(window.location.pathname).toBe("/notes/n/abc123");
      });
    });

    it("resolves the vault by a case-folded id", async () => {
      // The id form is as hand-typeable as the name form, so it gets the same
      // case tolerance — `resolveVaultRef`'s fourth pass, through the router.
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/V-BETA/n/abc123");
      render(<App />);
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
        expect(window.location.pathname).toBe("/notes/n/abc123");
      });
    });

    it("takes an id vault AND a multi-segment note path in one address", async () => {
      // Both halves of Aaron's `/v/{vaultnameorid}/n/{notenameorid}` at their
      // widest, together: the id spelling of the vault reaches the SPLAT route,
      // not just the `:id` one. Each half is pinned alone above; nothing pinned
      // them meeting.
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/v-beta/n/Projects/2026/Roadmap");
      render(<App />);
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
        expect(window.location.pathname).toBe("/notes/n/Projects%2F2026%2FRoadmap");
      });
    });

    it("resolves a locally renamed vault by id when its name no longer matches", async () => {
      useVaultStore.setState({
        vaults: { "v-alpha": vault("v-alpha", "alpha"), "v-beta": vault("v-beta", "Beta Redux") },
        activeVaultId: "v-alpha",
      });
      window.history.replaceState({}, "", "/notes/v/v-beta/n/abc123");
      render(<App />);
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
        expect(window.location.pathname).toBe("/notes/n/abc123");
      });
    });
  });

  describe("the bare /v/<vault> address", () => {
    it("switches to the vault and lands on its notes", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta");
      render(<App />);
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
        expect(window.location.pathname).toBe("/notes/notes");
      });
    });

    it("shows the not-connected state for an unknown vault", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/gamma");
      render(<App />);
      expect(await screen.findByText(/is not connected here/i)).toBeInTheDocument();
      expect(useVaultStore.getState().activeVaultId).toBe("v-alpha");
    });

    it("tolerates a trailing slash", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/");
      render(<App />);
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
        expect(window.location.pathname).toBe("/notes/notes");
      });
    });

    it("lands on the notes list for `/v/<vault>/n` with nothing after it", async () => {
      // The splat matches an EMPTY remainder too, so the note-less `/n` shape
      // reaches `parseNoteRef` as null and takes the same landing as `/v/<vault>`.
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/v/beta/n");
      render(<App />);
      await waitFor(() => {
        expect(useVaultStore.getState().activeVaultId).toBe("v-beta");
        expect(window.location.pathname).toBe("/notes/notes");
      });
    });
  });

  describe("the bare `/v` prefix names no vault (app#194)", () => {
    // Regression: with no `/v` route the prefix fell to `/:id` and was read as a
    // NOTE named `v`, resolved against whatever vault was active — the precise
    // cross-vault ambiguity this namespace exists to remove, reached by nothing
    // more exotic than a link truncated in a chat client. It must never resolve
    // a note, and it must never touch the active vault.
    it.each([
      ["under the /notes mount", "/notes/v", "/notes/vaults"],
      ["with a trailing slash", "/notes/v/", "/notes/vaults"],
      ["at the root mount", "/v", "/vaults"],
    ])("%s it lands on the vault list", async (_label, from, to) => {
      seedTwoVaults();
      window.history.replaceState({}, "", from);
      render(<App />);
      await waitFor(() => {
        expect(window.location.pathname).toBe(to);
      });
      // Never the note-id reading, and never a silent vault switch.
      expect(window.location.pathname).not.toContain("/n/v");
      expect(useVaultStore.getState().activeVaultId).toBe("v-alpha");
    });

    it("does not shadow /vaults, which needs the whole word", async () => {
      // Control: `/v` is a prefix of `/vaults` as a STRING, but React Router
      // matches whole segments — the guard above must not have swallowed the
      // real vault-list route.
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/vaults");
      render(<App />);
      await waitFor(() => {
        expect(window.location.pathname).toBe("/notes/vaults");
      });
    });
  });

  describe("an unresolvable vault is a dead end at every note-reference shape", () => {
    it.each([
      ["a ULID id", "/notes/v/gamma/n/01JBQZ0Q2M8T9V5X7YB3KD4WEN"],
      ["a multi-segment path", "/notes/v/gamma/n/Projects/2026/Roadmap"],
      ["a path with an /edit tail", "/notes/v/gamma/n/Projects/2026/Roadmap/edit"],
      ["an empty note reference", "/notes/v/gamma/n/"],
    ])("%s", async (_label, path) => {
      // The access boundary: an address naming a vault this device does not hold
      // never borrows the ACTIVE vault's session to resolve the note. Same
      // response the single-segment form already gives.
      seedTwoVaults();
      window.history.replaceState({}, "", path);
      render(<App />);
      expect(await screen.findByText(/is not connected here/i)).toBeInTheDocument();
      expect(useVaultStore.getState().activeVaultId).toBe("v-alpha");
      expect(window.location.pathname).toBe(path);
    });
  });

  describe("the canonical /n/<id> is unchanged", () => {
    it("keeps current-vault semantics and does not touch the active vault", async () => {
      seedTwoVaults();
      window.history.replaceState({}, "", "/notes/n/abc123");
      render(<App />);
      // The control for the switch assertions above: a bare `/n/<id>` neither
      // switches the vault nor announces anything.
      await waitFor(() => {
        expect(window.location.pathname).toBe("/notes/n/abc123");
      });
      expect(useVaultStore.getState().activeVaultId).toBe("v-alpha");
      expect(screen.queryByText(/now in/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/is not connected here/i)).not.toBeInTheDocument();
    });
  });
});

// app B/6 — the vault-scoped shape of the logged-out deep link. `/v/<vault>/n/<id>`
// never reaches NoteView when the vault isn't here: it stops at the
// not-connected card, which is the RIGHT screen (the fix is a connect) but used
// to send the reader into `/add` with the address gone, so finishing the connect
// dropped them on the landing. The card's connect link now carries the whole
// `/v/...` address as `?redirect=` — the same channel `/n/<id>` uses — so the
// return re-enters THIS route, resolves the now-connected vault, and hands off
// to the note.
describe("App — a vault-scoped deep link survives the connect (app B/6)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(MIRROR_FLAG_KEY, "false");
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    useToastStore.setState({ toasts: [] });
    window.history.replaceState({}, "", "/");
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("the not-connected card's connect link carries the full /v/ address (root mount)", async () => {
    // No vaults at all — the logged-out reader who was handed a share link.
    window.history.replaceState({}, "", "/v/beta/n/abc123");
    render(<App />);

    await screen.findByText(/is not connected here/i);
    expect(screen.getByRole("link", { name: /connect a vault/i })).toHaveAttribute(
      "href",
      "/add?redirect=%2Fv%2Fbeta%2Fn%2Fabc123",
    );
  });

  it("carries a multi-segment note path and the /edit tail through unchanged", async () => {
    window.history.replaceState({}, "", "/v/beta/n/Projects/2026/Roadmap/edit");
    render(<App />);

    await screen.findByText(/is not connected here/i);
    const href = screen.getByRole("link", { name: /connect a vault/i }).getAttribute("href");
    expect(new URLSearchParams(href!.slice(href!.indexOf("?"))).get("redirect")).toBe(
      "/v/beta/n/Projects/2026/Roadmap/edit",
    );
  });

  it("is mount-aware: the href is prefixed, the return target is not (the /notes/notes bug)", async () => {
    // `withReturnTo` is handed the ROUTER-relative path (what OAuthCallback's
    // navigate() wants); only the Link itself gets the basename. Spelling the
    // mount into the param would double it on the way back.
    window.history.replaceState({}, "", "/notes/v/beta/n/abc123");
    render(<App />);

    await screen.findByText(/is not connected here/i);
    expect(screen.getByRole("link", { name: /connect a vault/i })).toHaveAttribute(
      "href",
      "/notes/add?redirect=%2Fv%2Fbeta%2Fn%2Fabc123",
    );
  });

  it("a vault this device DOES hold is unaffected — no card, no redirect param", async () => {
    // The control: the card (and its link) only exist on the unresolvable path.
    seedTwoVaults();
    window.history.replaceState({}, "", "/notes/v/beta/n/abc123");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/notes/n/abc123"));
    expect(window.location.search).toBe("");
    expect(screen.queryByText(/is not connected here/i)).not.toBeInTheDocument();
  });
});
