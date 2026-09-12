import { App } from "@/app/App";
import * as accountClient from "@/lib/account/client";
import * as hostedVault from "@/lib/account/hosted-vault";
import { useFocusMode } from "@/lib/focus-mode";
import { MIRROR_FLAG_KEY } from "@/lib/mirror/flag";
import { useToastStore } from "@/lib/toast/store";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { UNSAFE_createBrowserHistory } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// app#207 P3–P5, P11–P17, P19–P22: exercise real App routing, not a store-derived basename.
const record = (name: string): VaultRecord => ({
  id: name,
  name,
  url: `https://mock.invalid/vault/${name}`,
  issuer: "https://mock.invalid",
  clientId: "mock",
  scope: "full",
  addedAt: "2026-09-11",
  lastUsedAt: "2026-09-11",
});
const note = (id: string) => ({
  id,
  path: `Note ${id}`,
  content: `# Note ${id}\n\nSynthetic ${id}.\n\n[Other vault](/v/other/n/y)`,
  tags: [],
  links: [],
  attachments: [],
  createdAt: "2026-09-11T00:00:00Z",
  updatedAt: "2026-09-11T00:00:00Z",
});
function seed(active = "beta") {
  useVaultStore.setState({
    vaults: { alpha: record("alpha"), beta: record("beta") },
    activeVaultId: active,
  });
  for (const id of ["alpha", "beta"])
    localStorage.setItem(
      `lens:token:${id}`,
      JSON.stringify({ accessToken: "synthetic", scope: "full", vault: id }),
    );
}
function arrive(path: string) {
  window.history.replaceState({}, "", path);
  return render(<App />);
}
async function at(path: string) {
  await waitFor(() => expect(window.location.pathname).toBe(path), { timeout: 4000 });
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(MIRROR_FLAG_KEY, "false");
  useVaultStore.setState({ vaults: {}, activeVaultId: null });
  useToastStore.setState({ toasts: [] });
  useFocusMode.setState({ on: false });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        window.location.origin,
      );
      if (url.pathname.endsWith("/api/notes"))
        return Response.json(
          url.searchParams.has("id") ? note(url.searchParams.get("id")!) : [note("x"), note("y")],
        );
      return new Response("{}", { status: 404 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useFocusMode.setState({ on: false });
});

describe("canonical vault routes", () => {
  it("P3: NoteRow navigation keeps the vault prefix", async () => {
    seed();
    arrive("/v/beta/notes");
    const link = await screen.findByRole("link", { name: /Note x/ });
    expect(link).toHaveAttribute("href", "/v/beta/n/x");
    fireEvent.click(link);
    await at("/v/beta/n/x");
  });
  it("P4: a bare note replaces into the active vault without another history entry", async () => {
    seed();
    const length = window.history.length;
    arrive("/n/x");
    await at("/v/beta/n/x");
    expect(window.history.length).toBe(length);
  });
  it("P5: bare home becomes canonical vault home", async () => {
    seed();
    arrive("/");
    await at("/v/beta");
    expect(screen.getByRole("link", { name: "Notes", current: "page" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Note x/ })).toBeInTheDocument();
  });
  it("P11: a device sidebar switch navigates, activates and toasts exactly once", async () => {
    seed("alpha");
    arrive("/v/alpha/n/x");
    fireEvent.click((await screen.findAllByRole("button", { name: /active vault/i }))[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "beta" }));
    await at("/v/beta");
    expect(useVaultStore.getState().activeVaultId).toBe("beta");
    expect(useToastStore.getState().toasts.filter((t) => t.message === "Now in beta")).toHaveLength(
      1,
    );
    await act(async () => window.history.back());
    await at("/v/alpha/n/x");
    await waitFor(() => expect(useVaultStore.getState().activeVaultId).toBe("alpha"));
    await act(async () => window.history.forward());
    await at("/v/beta");
  });
  it("P12: Copy link matches the open note address", async () => {
    seed();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    arrive("/v/beta/n/x");
    await screen.findAllByText(/Synthetic x/, {}, { timeout: 4000 });
    fireEvent.click(await screen.findByRole("button", { name: /copy a shareable link/i }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
  });
  it("P13: focus still reads the stripped note path", async () => {
    seed();
    arrive("/v/beta/n/x");
    await screen.findAllByText(/Synthetic x/, {}, { timeout: 4000 });
    fireEvent.click(await screen.findByRole("button", { name: /^focus/i }));
    expect(screen.getByRole("button", { name: /exit focus mode/i })).toBeInTheDocument();
  });
  it("P14: bare login bounces home, never becoming a note; canonical login remains a note", async () => {
    seed();
    const first = arrive("/login");
    await at("/v/beta");
    expect(window.location.pathname).not.toContain("login");
    first.unmount();
    arrive("/v/beta/n/login");
    expect(await screen.findByText(/Synthetic login/)).toBeInTheDocument();
    await at("/v/beta/n/login");
  });
  it("P16: cross-vault markdown uses an absolute anchor without doubled prefixes", async () => {
    seed();
    arrive("/v/beta/n/x");
    await screen.findAllByText(/Synthetic x/, {}, { timeout: 4000 });
    const link = await screen.findByRole("link", { name: "Other vault" });
    expect(link).toHaveAttribute("href", "/v/other/n/y");
    for (const a of document.querySelectorAll("a[href]"))
      expect((a.getAttribute("href")!.match(/\/v\//g) ?? []).length).toBeLessThanOrEqual(1);
  });
  it.each(["/n/x", "/", "/add", "/welcome", "/oauth/callback"])(
    "P17: no connected vault leaves %s unprefixed",
    async (path) => {
      arrive(path);
      await waitFor(() => expect(document.body.textContent).not.toBe(""));
      expect(window.location.pathname).not.toMatch(/^\/v\//);
    },
  );
  it("P19: React Router exports its browser history factory", () => {
    expect(UNSAFE_createBrowserHistory).toBeTypeOf("function");
  });
  it("P20: opening an account-only vault keeps its new prefix and one toast", async () => {
    seed("alpha");
    useVaultStore.setState({ vaults: { alpha: record("alpha") } });
    vi.spyOn(accountClient, "listVaults").mockResolvedValue({
      vaults: [{ name: "beta", url: "https://mock.invalid/vault/beta" }],
    } as Awaited<ReturnType<typeof accountClient.listVaults>>);
    vi.spyOn(hostedVault, "openHostedVault").mockImplementation(async () => {
      useVaultStore.setState({
        vaults: { alpha: record("alpha"), beta: record("beta") },
        activeVaultId: "beta",
      });
      return "beta";
    });
    arrive("/v/alpha/n/x");
    fireEvent.click((await screen.findAllByRole("button", { name: /active vault/i }))[0]!);
    fireEvent.click(await screen.findByRole("button", { name: /Open →/ }));
    await at("/v/beta");
    await waitFor(() => expect(useVaultStore.getState().activeVaultId).toBe("beta"));
    await within(screen.getByRole("main")).findByRole("link", { name: /Note x/ });
    expect(useVaultStore.getState().activeVaultId).toBe("beta");
    expect(useToastStore.getState().toasts.filter((t) => t.message === "Now in beta")).toHaveLength(
      1,
    );
  }, 15000);
  it.each(["/add-vault/create", "/account"])(
    "P21: %s sheds the prefix with no extra Back step",
    async (path) => {
      seed("alpha");
      arrive("/v/alpha/n/x");
      fireEvent.click((await screen.findAllByRole("button", { name: /active vault/i }))[0]!);
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
      const link = links.find((a) => a.getAttribute("href") === `/v/alpha${path}`);
      expect(link).toBeDefined();
      const length = window.history.length;
      fireEvent.click(link!);
      await at(path);
      expect(window.history.length).toBe(length + 1);
      expect(useVaultStore.getState().activeVaultId).toBe("alpha");
      await act(async () => window.history.back());
      await at("/v/alpha/n/x");
      await act(async () => window.history.forward());
      await at(path);
    },
  );
  it("P22: create, ready and Open activate the new canonical vault", async () => {
    seed("alpha");
    vi.spyOn(hostedVault, "createHostedVault").mockResolvedValue("gamma");
    vi.spyOn(hostedVault, "openHostedVault").mockImplementation(async () => {
      useVaultStore.setState({
        vaults: { ...useVaultStore.getState().vaults, gamma: record("gamma") },
        activeVaultId: "gamma",
      });
      localStorage.setItem(
        "lens:token:gamma",
        JSON.stringify({ accessToken: "synthetic", scope: "full", vault: "gamma" }),
      );
      return "gamma";
    });
    arrive("/v/alpha/add-vault/create");
    await at("/add-vault/create");
    fireEvent.change(await screen.findByLabelText(/vault name/i), { target: { value: "gamma" } });
    fireEvent.click(screen.getByRole("button", { name: /create.*gamma/i }));
    await at("/add-vault/ready");
    expect(useVaultStore.getState().activeVaultId).toBe("alpha");
    fireEvent.click(await screen.findByRole("button", { name: /open gamma/i }, { timeout: 4000 }));
    await at("/v/gamma");
    expect(useVaultStore.getState().activeVaultId).toBe("gamma");
    expect(
      useToastStore.getState().toasts.filter((t) => t.message === "Now in gamma"),
    ).toHaveLength(1);
  }, 15000);
  it("P23: gate uses rendered location when the browser address changes without popstate", async () => {
    seed("alpha");
    arrive("/v/alpha/n/x");
    await screen.findAllByText(/Synthetic x/, {}, { timeout: 4000 });
    const toasts = useToastStore.getState().toasts;
    await act(async () => {
      window.history.replaceState({}, "", "/vaults");
      useVaultStore.setState((state) => ({ vaults: { ...state.vaults } }));
    });
    expect(window.location.pathname).toBe("/vaults");
    expect(useToastStore.getState().toasts).toEqual(toasts);
    expect(useVaultStore.getState().activeVaultId).toBe("alpha");
  });
});
