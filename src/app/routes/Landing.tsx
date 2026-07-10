import { ParachuteMark, Wordmark } from "@/components/ParachuteMark";
import { useOwnOriginDoor } from "@/lib/vault";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

// The arrival — the calm centered first screen a vault-less visitor lands on
// (App.tsx's NotesIndex renders the guided Home once a vault is connected, so
// this never has to think about a connected vault).
//
// This is the prototype's Scene 2 made real: the identity spine is born by
// *naming your vault*. The live echo under the field ("Your vault: moss") makes
// the threading visible the instant you type — the whole thesis in one gesture.
//
// The fork (SYNTHESIS D10): if a DOOR serves this origin (an identity/issuer
// answering OAuth discovery here), "Continue" leads to the same-origin `/signup`
// account ceremony that actually mints the vault. On a plain static host (no
// door) it leads to connect-by-URL (`/add`). Either way the name you typed
// rides along as `?vault=` — forward-compatible; the ceremony is authoritative.
export function Landing() {
  const door = useOwnOriginDoor();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const trimmed = name.trim();

  // The typed name rides along as `?vault=` — forward-compatible; the ceremony
  // (or the connect flow) is authoritative.
  const vaultQuery = trimmed ? `?vault=${encodeURIComponent(trimmed)}` : "";
  const signupHref = `/signup${vaultQuery}`;
  const addHref = `/add${vaultQuery}`;

  // Enter mirrors the visible CTA. A door leads to the same-origin `/signup`
  // account ceremony (a real full-page nav); a static host leads to the SPA
  // connect-by-URL flow.
  const onContinue = () => {
    if (door === "door") window.location.assign(signupHref);
    else navigate(addHref);
  };

  const ctaLabel =
    door === "door"
      ? trimmed
        ? `Create ${trimmed}`
        : "Create your Parachute"
      : trimmed
        ? `Connect ${trimmed}`
        : "Connect a vault";

  return (
    <div className="relative flex min-h-[calc(100dvh-4rem)] flex-col">
      {/* A quiet top wordmark — the identity lockup, nothing else competes. */}
      <div className="flex items-center px-6 pt-6 sm:px-10">
        <Wordmark />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <div className="mx-auto w-full max-w-xl">
          {/* The canopy, settling. */}
          <ParachuteMark size={64} className="mx-auto mb-6 drop-in" />

          <p className="eyebrow mb-3">Name your vault</p>
          <h1 className="hero-title mb-4">
            What should we call your <span className="accent-word">vault?</span>
          </h1>
          <p className="mx-auto mb-8 max-w-md text-lg leading-relaxed text-fg-muted">
            A word for the place your thinking lives — it becomes the title, the switcher, the map's
            center, everywhere. You can change it later.
          </p>

          {door === "probing" ? (
            // Hold the fork back while probing so we don't flash one path then
            // swap. Reserve the vertical space so nothing jumps.
            <div className="h-44" aria-hidden="true" />
          ) : (
            <>
              <input
                // biome-ignore lint/a11y/noAutofocus: the arrival's single purpose is this field — focusing it is the point.
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onContinue();
                }}
                placeholder="gardening"
                autoComplete="off"
                spellCheck={false}
                aria-label="Vault name"
                className="mx-auto mb-2 block w-full max-w-sm border-0 border-b-2 border-border bg-transparent pb-2 text-center font-serif text-3xl text-fg outline-none transition-colors focus:border-accent-light"
              />
              <p className="mb-8 min-h-6 font-round text-sm text-fg-muted">
                {trimmed ? (
                  <span>
                    Your vault:{" "}
                    <b className="rounded-md bg-grass-soft px-2 py-0.5 text-grass-ink">{trimmed}</b>
                  </span>
                ) : (
                  "Type a name — watch it thread through everything after."
                )}
              </p>

              <div className="flex flex-col items-center gap-4">
                {door === "door" ? (
                  // Real full-page anchor to the same-origin `/signup` ceremony.
                  <a
                    href={signupHref}
                    className="rounded-full bg-accent px-6 py-3 font-round text-base font-semibold text-on-accent shadow-soft transition-colors hover:bg-accent-hover"
                  >
                    {ctaLabel} →
                  </a>
                ) : (
                  <Link
                    to={addHref}
                    className="rounded-full bg-accent px-6 py-3 font-round text-base font-semibold text-on-accent shadow-soft transition-colors hover:bg-accent-hover"
                  >
                    {ctaLabel} →
                  </Link>
                )}
                {door === "door" ? (
                  <Link
                    to="/add"
                    className="font-round text-sm font-semibold hover:underline"
                    style={{ color: "var(--color-sky)" }}
                  >
                    I already have a vault
                  </Link>
                ) : null}
              </div>

              <div className="mt-10 flex flex-wrap items-center justify-center gap-2.5">
                {["Local-first", "Open standard (MCP)", "Export anytime"].map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1.5 font-round text-xs text-fg-muted"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
