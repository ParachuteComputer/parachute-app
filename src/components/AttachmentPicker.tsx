import { forwardRef, useImperativeHandle, useRef } from "react";

interface Props {
  onPickFiles: (files: File[]) => void;
  label?: string;
  className?: string;
}

export interface AttachmentPickerHandle {
  // Opens the native file dialog without a click on the visible button —
  // the "/"-menu's Image/attachment command drives this to reuse THIS
  // picker's upload flow rather than duplicating it (CodeMirrorEditor's
  // onRequestAttachment prop).
  open(): void;
}

const ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,audio/wav,audio/mpeg,audio/mp4,audio/ogg,audio/webm,video/webm,.wav,.mp3,.m4a,.ogg,.webm,.png,.jpg,.jpeg,.gif,.webp";

export const AttachmentPicker = forwardRef<AttachmentPickerHandle, Props>(function AttachmentPicker(
  { onPickFiles, label = "Attach files…", className },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ open: () => inputRef.current?.click() }), []);

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={
          className ??
          "min-h-11 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-fg-muted hover:text-accent"
        }
        title="Upload an attachment"
      >
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onPickFiles(files);
          e.target.value = "";
        }}
      />
    </>
  );
});
