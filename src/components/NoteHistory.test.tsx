import { VaultConflictError } from "@/lib/vault/client";
import type { Note } from "@/lib/vault/types";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NoteHistory } from "./NoteHistory";

const client = vi.hoisted(() => ({
  listHistory: vi.fn(),
  readHistory: vi.fn(),
  getNote: vi.fn(),
  restoreHistory: vi.fn(),
}));
vi.mock("@/lib/vault/queries", () => ({ useActiveVaultClient: () => client }));
vi.mock("@/lib/vault/store", () => ({
  useVaultStore: (select: (s: unknown) => unknown) => select({ activeVaultId: "vault" }),
}));
vi.mock("@/providers/SyncProvider", () => ({ useSync: () => ({ db: null }) }));
const note = {
  id: "note",
  content: "current body",
  updatedAt: "current-stamp",
  metadata: {},
  tags: [],
} as unknown as Note;
const row = {
  note_id: "note",
  version_ix: 0,
  op: "update",
  superseded_at: "2026-09-17",
  encoding: "whole",
  content_len: 8,
  path: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  client.listHistory.mockResolvedValue({ versions: [row], total: 1 });
  client.readHistory.mockResolvedValue({
    ...row,
    content: "old body",
    metadata: {},
    extension: "md",
  });
  client.getNote.mockResolvedValue(note);
  client.restoreHistory.mockResolvedValue({
    ...note,
    content: "old body",
    updatedAt: "restored-stamp",
  });
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});
function mount(
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <NoteHistory note={note} />
    </QueryClientProvider>,
  );
}
async function selectVersion() {
  fireEvent.click(screen.getByRole("button", { name: "Version history" }));
  fireEvent.click(await screen.findByRole("button", { name: /Version 0/ }));
  await screen.findByText("old body");
  await screen.findByText("current body");
}
it("loads on demand and restores only after explicit confirmation with the reviewed timestamp", async () => {
  mount();
  expect(client.listHistory).not.toHaveBeenCalled();
  await selectVersion();
  fireEvent.click(screen.getByRole("button", { name: "Restore selected version…" }));
  expect(client.restoreHistory).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));
  await waitFor(() =>
    expect(client.restoreHistory).toHaveBeenCalledWith("note", { version_ix: 0 }, "current-stamp"),
  );
  await screen.findByText(/Version restored/);
});
it("preserves cached attachment and link collections until a full note fetch", async () => {
  const qc = new QueryClient();
  const complete = { ...note, attachments: [{ id: "audio" }], links: [{ id: "related" }] };
  qc.setQueryData(["note", "vault", "note"], complete);
  mount(qc);
  await selectVersion();
  fireEvent.click(screen.getByRole("button", { name: "Restore selected version…" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));
  await screen.findByText(/Version restored/);
  expect(qc.getQueryData(["note", "vault", "note"])).toEqual(complete);
});
it("explains paused offline history instead of showing an endless loader", async () => {
  onlineManager.setOnline(false);
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Version history" }));
  await screen.findByText(/Offline copies do not include version history/);
  expect(screen.queryByText("Loading history…")).toBeNull();
  expect(client.listHistory).not.toHaveBeenCalled();
});
it("does not claim a network failure proves the restore never happened", async () => {
  client.restoreHistory.mockRejectedValue(new Error("Connection lost"));
  mount();
  await selectVersion();
  fireEvent.click(screen.getByRole("button", { name: "Restore selected version…" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));
  await screen.findByText(/Restore could not be confirmed/);
  expect(screen.getByRole("button", { name: "Restore selected version…" })).toBeDisabled();
});
it("does not pause an offline restore for automatic replay on reconnect", async () => {
  mount();
  await selectVersion();
  fireEvent.click(screen.getByRole("button", { name: "Restore selected version…" }));
  onlineManager.setOnline(false);
  fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));
  await screen.findByText(/Connect to the vault before restoring/);
  onlineManager.setOnline(true);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Restore selected version…" })).toBeDisabled(),
  );
  expect(client.restoreHistory).not.toHaveBeenCalled();
});
it("never forces or automatically retries a conflicting restore", async () => {
  client.restoreHistory.mockRejectedValue(new VaultConflictError({ current_updated_at: "newer" }));
  mount();
  await selectVersion();
  fireEvent.click(screen.getByRole("button", { name: "Restore selected version…" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));
  await screen.findByText(/server refused.*Read the current note again/);
  expect(client.restoreHistory).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Confirm restore" })).toBeNull();
});
it("does not present unavailable history as an empty list", async () => {
  client.listHistory.mockRejectedValue(new Error("404"));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Version history" }));
  await screen.findByText(/This is not an empty-history result/);
  expect(screen.queryByText(/No retained versions/)).toBeNull();
});
it("keeps imported selectors distinct and refuses content-less versions", async () => {
  const imported = { ...row, version_ix: undefined, origin: "git-import", import_ix: 3 };
  client.listHistory.mockResolvedValue({ versions: [imported], total: 1 });
  client.readHistory.mockResolvedValue({
    ...imported,
    content: null,
    encoding: "overflow",
    metadata: {},
  });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Version history" }));
  fireEvent.click(await screen.findByRole("button", { name: /Imported snapshot 3/ }));
  await screen.findByText(/It cannot be restored/);
  expect(client.readHistory).toHaveBeenCalledWith("note", { origin: "git-import", import_ix: 3 });
  expect(screen.getByRole("button", { name: "Restore selected version…" })).toBeDisabled();
});
