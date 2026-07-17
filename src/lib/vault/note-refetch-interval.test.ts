import { newLocalId } from "@/lib/sync/id-map";
import { describe, expect, it } from "vitest";
import { noteRefetchInterval } from "./queries";
import type { Note, NoteAttachment } from "./types";

const audio = (status: string): NoteAttachment =>
  ({ id: "a", mimeType: "audio/webm", metadata: { transcribe_status: status } }) as NoteAttachment;

const note = (over: Partial<Note> = {}): Note =>
  ({ id: "srv-1", createdAt: "2026-01-01T00:00:00Z", ...over }) as Note;

describe("noteRefetchInterval — the useNote poll fallback", () => {
  describe("local-id bridge (preserved)", () => {
    it("polls at 2s while the route id is local and unresolved", () => {
      const localId = newLocalId();
      expect(noteRefetchInterval(localId, undefined)).toBe(2_000);
      // data still an optimistic local note → keep bridging
      expect(noteRefetchInterval(localId, note({ id: localId }))).toBe(2_000);
    });

    it("stops the 2s bridge once the local id resolves to a server note", () => {
      const localId = newLocalId();
      // resolved to a plain server note with no pending transcription
      expect(noteRefetchInterval(localId, note({ id: "srv-1", content: "done" }))).toBe(false);
    });

    it("bridges to the 4s pending poll if the resolved note is still transcribing", () => {
      const localId = newLocalId();
      expect(
        noteRefetchInterval(localId, note({ id: "srv-1", attachments: [audio("pending")] })),
      ).toBe(4_000);
    });
  });

  describe("pending-transcription poll (new)", () => {
    it("polls at 4s while the attachment status is pending", () => {
      expect(noteRefetchInterval("srv-1", note({ attachments: [audio("pending")] }))).toBe(4_000);
    });

    it("polls at 4s on the body pending marker (attachment-status absent)", () => {
      expect(noteRefetchInterval("srv-1", note({ content: "_Transcript pending._" }))).toBe(4_000);
    });

    it("stops on a done attachment", () => {
      expect(noteRefetchInterval("srv-1", note({ attachments: [audio("done")] }))).toBe(false);
    });

    it("stops on a failed attachment", () => {
      expect(noteRefetchInterval("srv-1", note({ attachments: [audio("failed")] }))).toBe(false);
    });

    it("stops on the voice-limit marker", () => {
      expect(
        noteRefetchInterval(
          "srv-1",
          note({ content: "_Monthly voice limit reached — transcription resumes next month._" }),
        ),
      ).toBe(false);
    });
  });

  it("does not poll a plain server note or an undefined id", () => {
    expect(noteRefetchInterval("srv-1", note({ content: "just a note" }))).toBe(false);
    expect(noteRefetchInterval(undefined, undefined)).toBe(false);
  });
});
