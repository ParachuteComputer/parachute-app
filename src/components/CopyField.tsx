import { useToastStore } from "@/lib/toast/store";
import { useState } from "react";

// Shared copy-to-clipboard behavior: writes `value`, flips `copied` true for
// a beat (2s) so a caller can show a transient label, and always toasts
// (success, or a manual-copy invitation on failure — the value stays
// selectable text, never hidden behind the button alone). Used by CopyField
// below; any other copy affordance that wants the identical feel without the
// mono-field chrome can use this directly instead of re-deriving it.
export function useCopyToClipboard(): {
  copied: boolean;
  copy: (value: string) => Promise<void>;
} {
  const pushToast = useToastStore((s) => s.push);
  const [copied, setCopied] = useState(false);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      pushToast("Copied to clipboard.", "success");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      pushToast("Couldn't copy — select and copy manually.", "error");
    }
  };

  return { copied, copy };
}

// A read-only value (URL / command) shown in a mono field with a copy button.
export function CopyField({
  value,
  label,
  className,
}: {
  value: string;
  /** Accessible name for the copy button, e.g. "vault address". */
  label: string;
  className?: string;
}) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <div className={`flex items-stretch gap-2 ${className ?? ""}`}>
      <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-bg-soft px-3 py-2 font-mono text-sm text-fg">
        {value}
      </code>
      <button
        type="button"
        onClick={() => copy(value)}
        className="btn btn-secondary btn-touch shrink-0"
        aria-label={`Copy ${label}`}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
