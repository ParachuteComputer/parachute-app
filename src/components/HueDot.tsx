import { hueForTag } from "@/lib/hue/hue";

// The hue module's chip (EDITOR-STUDY §7/§9) — a small leading dot recognizing
// a tag's hue at a glance. Renders nothing for an empty/neutral tag (a view
// with no subject tag, or a note with no kind-coded tag) rather than a
// default color — silence is the "no opinion" state, not a fallback hue.
export function HueDot({
  tag,
  className,
}: {
  tag: string | null | undefined;
  className?: string;
}) {
  const hue = hueForTag(tag);
  if (!hue) return null;
  return (
    <span
      aria-hidden="true"
      className={`hue-dot hue-dot-${hue}${className ? ` ${className}` : ""}`}
    />
  );
}
