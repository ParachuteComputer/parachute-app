import { formatFieldDate } from "@/lib/dates";
import type { TagFieldSchema } from "@/lib/vault/types";
import type { ViewFieldValue } from "@/lib/views/mutate";
import type { ReactNode } from "react";

// Typed field RENDERING (views polish V1) — the read half of the field seam.
// Every field VALUE a view shows (chip, table cell, boolean toggle) funnels
// through `FieldValueControl`'s trigger, and the trigger renders THIS. It is
// pure and hook-free: value in (the `scalarValue()` narrowing), schema in
// (the tag's declared field type), ReactNode out.
//
//   date    → "Today" / "Yesterday" / "Tomorrow" / "Jul 24" / "Jul 24, 2025"
//   boolean → ✓ (grass) / ✕ (dim) — unset falls to the placeholder
//   number  → tabular-nums, no locale reformat
//   url     → link-STYLED (hostname + truncated path, accent) — still one
//             door: the tap opens the editor, never navigates (no nested
//             anchor inside the trigger button; the editor popover offers
//             the real "open" anchor)
//   enum    → plain text for now (V2 does tinting)
//   string  → as-is, clamped by the trigger's existing max-w
//   empty   → the quiet "—" placeholder (the trigger dims it)
//
// Display-only: writes, toasts (`formatFieldValue`'s Yes/No), and the wire
// shapes are untouched.

const PLACEHOLDER = "—";

const URL_RE = /^https?:\/\//i;

/** Whether a field value is a web URL — drives link styling + the editor's "open" anchor. */
export function isUrlValue(value: ViewFieldValue): value is string {
  return typeof value === "string" && URL_RE.test(value);
}

/** Longest path/query tail shown after the hostname before it's cut with an ellipsis. */
const URL_REST_MAX = 24;

function urlParts(raw: string): { host: string; rest: string } {
  try {
    const u = new URL(raw);
    let rest = `${u.pathname}${u.search}${u.hash}`;
    if (rest === "/") rest = "";
    if (rest.length > URL_REST_MAX) rest = `${rest.slice(0, URL_REST_MAX - 1)}…`;
    return { host: u.host, rest };
  } catch {
    // Matched the scheme but not a parseable URL — show it bare, still link-styled.
    return { host: raw.replace(URL_RE, ""), rest: "" };
  }
}

export function FieldDisplay({
  value,
  schema,
}: {
  value: ViewFieldValue;
  schema?: TagFieldSchema | null;
}): ReactNode {
  if (value === null || value === undefined || value === "") return PLACEHOLDER;

  // Booleans read by the VALUE's type, not the schema's — a real boolean is
  // a check either way, and a mis-typed value on a boolean field stays honest
  // (renders raw below).
  if (typeof value === "boolean") {
    return value ? <span className="text-grass">✓</span> : <span className="text-fg-dim">✕</span>;
  }

  if (schema?.type === "date" && typeof value === "string") {
    return formatFieldDate(value);
  }

  if (isUrlValue(value)) {
    const { host, rest } = urlParts(value);
    return (
      <span className="min-w-0 truncate text-accent underline underline-offset-2" title={value}>
        {host}
        {rest ? <span className="opacity-70">{rest}</span> : null}
      </span>
    );
  }

  if (typeof value === "number") {
    return <span className="tabular-nums">{String(value)}</span>;
  }

  // Enum values + plain strings — as-is (the trigger's max-w clamps length).
  return String(value);
}
