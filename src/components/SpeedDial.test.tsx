import { SpeedDial } from "@/components/SpeedDial";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function makeVault(id: string, url: string): VaultRecord {
  return {
    id,
    url,
    name: "gardening",
    issuer: url,
    clientId: "c",
    scope: "full",
    addedAt: "2026-04-22T00:00:00.000Z",
    lastUsedAt: "2026-04-22T00:00:00.000Z",
  };
}

function seedVault() {
  useVaultStore.setState({
    vaults: { a: makeVault("a", "http://localhost:1940") },
    activeVaultId: "a",
  });
}

function renderDial(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SpeedDial />
    </MemoryRouter>,
  );
}

describe("SpeedDial (W2-9)", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });
  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("renders nothing with no active vault", () => {
    const { container } = renderDial();
    expect(container.firstElementChild).toBeNull();
  });

  it("is TABLET+DESKTOP: the root gates `hidden md:block` (phone capture stays the tab bar's [+])", () => {
    seedVault();
    const { container } = renderDial();
    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    // JSDOM can't compute layout — the breakpoint contract is asserted at
    // the class level, same as navigation-breakpoint-contract.test.tsx.
    expect(root?.className).toMatch(/\bhidden\b/);
    // Three-band amendment (notes#147): the dial's gate mirrors the BOTTOM
    // BAR's, which went to `md:hidden` when the tablet band became the
    // NavDrawer's. The drawer, like the Rail, carries no capture verb — at
    // `lg:block` a tablet would have had no way to write at all.
    expect(root?.className).toMatch(/\bmd:block\b/);
    expect(root?.className).not.toMatch(/\blg:block\b/);
  });

  it("starts collapsed: the coral trigger only, no verbs", () => {
    seedVault();
    renderDial();
    const trigger = screen.getByRole("button", { name: /create/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("expands downward into the three verbs with the right destinations", () => {
    seedVault();
    renderDial();
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    const links = screen.getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["New note", "/new"],
      ["Voice note", "/new?voice=1"],
      ["Import notes", "/import"],
    ]);
    expect(screen.getByRole("button", { name: /close create menu/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("the Voice verb carries the voice param — landing in voice capture, no extra tap", () => {
    seedVault();
    renderDial();
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(screen.getByRole("link", { name: /voice note/i })).toHaveAttribute(
      "href",
      "/new?voice=1",
    );
  });

  it("Escape closes the dial and returns focus to the trigger", () => {
    seedVault();
    renderDial();
    const trigger = screen.getByRole("button", { name: /create/i });
    fireEvent.click(trigger);
    expect(screen.getAllByRole("link")).toHaveLength(3);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /create/i }));
  });

  it("is hidden on /new itself (you're already holding the pen)", () => {
    seedVault();
    const { container } = renderDial("/new");
    expect(container.firstElementChild).toBeNull();
  });

  it("is hidden under ceremonies (§4.1 rule 5 — no chrome noise)", () => {
    seedVault();
    for (const path of ["/welcome", "/add-vault/create", "/check-email"]) {
      const { container, unmount } = renderDial(path);
      expect(container.firstElementChild, `expected no SpeedDial at ${path}`).toBeNull();
      unmount();
    }
  });
});
