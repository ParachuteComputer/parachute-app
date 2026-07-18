import { TranscriptionStatus } from "@/components/TranscriptionStatus";
import type { NoteAttachment } from "@/lib/vault/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const audioWith = (status: string, extra: Record<string, unknown> = {}): NoteAttachment =>
  ({
    id: "att-1",
    mimeType: "audio/webm",
    metadata: { transcribe_status: status, ...extra },
  }) as unknown as NoteAttachment;

describe("TranscriptionStatus", () => {
  it("renders nothing when neither marker nor attachment status is present", () => {
    const { container } = render(<TranscriptionStatus content="plain note body" />);
    expect(container).toBeEmptyDOMElement();
  });

  describe("body-marker fallback (no attachment status)", () => {
    it("shows 'Transcribing…' when the note still carries the pending marker", () => {
      render(<TranscriptionStatus content="# 🎙️ Voice memo\n\n_Transcript pending._\n" />);
      expect(screen.getByText(/transcribing/i)).toBeInTheDocument();
    });

    it("shows the unavailable chip when the note carries the unavailable marker", () => {
      render(
        <TranscriptionStatus content="Some preamble.\n\n_Transcription unavailable._\n\nrest" />,
      );
      expect(screen.getByText(/transcription unavailable/i)).toBeInTheDocument();
    });

    it("shows the voice-limit chip when the note carries the monthly-limit marker", () => {
      render(
        <TranscriptionStatus content="_Monthly voice limit reached — transcription resumes next month._" />,
      );
      expect(screen.getByText(/monthly voice limit reached/i)).toBeInTheDocument();
      // Not the failure copy — a cap is not a failure.
      expect(screen.queryByText(/transcription unavailable/i)).not.toBeInTheDocument();
    });

    it("prefers the pending chip when pending + a terminal marker coexist", () => {
      render(<TranscriptionStatus content="_Transcript pending._\n_Transcription unavailable._" />);
      expect(screen.getByText(/transcribing/i)).toBeInTheDocument();
      expect(screen.queryByText(/transcription unavailable/i)).not.toBeInTheDocument();
    });
  });

  describe("attachment-status-first", () => {
    it("shows 'Transcribing…' from a pending attachment even with no body marker", () => {
      render(
        <TranscriptionStatus content="body without markers" attachments={[audioWith("pending")]} />,
      );
      expect(screen.getByText(/transcribing/i)).toBeInTheDocument();
    });

    it("renders nothing once the attachment is done, even if a stale pending marker lingers", () => {
      const { container } = render(
        <TranscriptionStatus content="_Transcript pending._" attachments={[audioWith("done")]} />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it("shows the failed chip for a failed attachment with no limit marker", () => {
      render(<TranscriptionStatus content="some body" attachments={[audioWith("failed")]} />);
      expect(screen.getByText(/transcription unavailable/i)).toBeInTheDocument();
    });

    it("distinguishes voice-limit from failure: failed attachment + limit body marker → limit chip", () => {
      // markTerminal stores transcribe_status:"failed" for the cap too — the
      // body marker is the only discriminator.
      render(
        <TranscriptionStatus
          content="_Monthly voice limit reached — transcription resumes next month._"
          attachments={[audioWith("failed")]}
        />,
      );
      expect(screen.getByText(/monthly voice limit reached/i)).toBeInTheDocument();
      expect(screen.queryByText(/transcription unavailable/i)).not.toBeInTheDocument();
    });
  });

  // Voice Wave 2: segmented recordings + the Retry action.
  describe("segmented + retry", () => {
    it("shows a 'part k of n' hint while a segmented recording is in flight", () => {
      render(
        <TranscriptionStatus
          content="body"
          attachments={[audioWith("done"), audioWith("pending"), audioWith("pending")]}
        />,
      );
      expect(screen.getByText(/transcribing/i)).toBeInTheDocument();
      // 1 done of 3 → the part now in flight is part 2.
      expect(screen.getByText(/part 2 of 3/i)).toBeInTheDocument();
    });

    it("a single-segment pending chip shows no part hint", () => {
      render(<TranscriptionStatus content="body" attachments={[audioWith("pending")]} />);
      expect(screen.getByText(/transcribing/i)).toBeInTheDocument();
      expect(screen.queryByText(/part \d+ of \d+/i)).not.toBeInTheDocument();
    });

    it("the failed chip offers Retry when onRetry is provided, and fires it on click", () => {
      const onRetry = vi.fn();
      render(
        <TranscriptionStatus
          content="body"
          attachments={[audioWith("failed")]}
          onRetry={onRetry}
        />,
      );
      const retry = screen.getByRole("button", { name: /^retry$/i });
      fireEvent.click(retry);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("the failed chip shows a spinner label and disables Retry while retrying", () => {
      render(
        <TranscriptionStatus
          content="body"
          attachments={[audioWith("failed")]}
          onRetry={() => {}}
          retrying
        />,
      );
      const retry = screen.getByRole("button", { name: /retrying/i });
      expect(retry).toBeDisabled();
    });

    it("no Retry button when onRetry is omitted (display-only surfaces)", () => {
      render(<TranscriptionStatus content="body" attachments={[audioWith("failed")]} />);
      expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    });
  });
});
