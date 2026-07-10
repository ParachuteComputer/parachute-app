import { InsecureContextBanner } from "@/components/InsecureContextBanner";
import { beginOAuth, normalizeVaultUrl, useOriginVaultProbe } from "@/lib/vault";
import { InsecureContextError } from "@/lib/vault/pkce";
import { useVaultStore } from "@/lib/vault/store";
import { safeInternalRedirect, vaultIdFromUrl } from "@/lib/vault/url";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

export function AddVault() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryUrl = searchParams.get("url") ?? "";
  // `?add=<vault url>` — the cloud console's "Open in Notes" deep link
  // (NotesIndex forwards a root-path `/?add=…` here). An alias of the
  // existing `?url=` deep link (hub `/account` "Import notes", notes#63)
  // that ALSO auto-begins the connect flow: both prefill the same field and
  // both funnel into the same connect() path below. `?url=` stays
  // prefill-only so the hub flow keeps its confirm-with-Continue shape.
  // Only explicit http(s) values are honoured for auto-begin, and the param
  // is stripped from history once consumed so refresh/back can't re-trigger.
  const addUrl = searchParams.get("add") ?? "";
  const addUrlIsHttp = /^https?:\/\//i.test(addUrl);
  // One prefill source: an explicit ?url= wins (hub flow), else a valid ?add=.
  const initialUrl = queryUrl || (addUrlIsHttp ? addUrl : "");
  // Post-connect landing path (notes#63) — the hub `/account` "Import notes"
  // deep-link arrives as `/add?url=…&redirect=/import`. Sanitized to an
  // in-app same-origin path so it can never become an open redirect; an
  // invalid value falls back to the default `/` landing in OAuthCallback.
  const redirect = safeInternalRedirect(searchParams.get("redirect"));
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [insecureContext, setInsecureContext] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const prefilled = useRef(initialUrl.length > 0);
  const autoBeginRan = useRef(false);
  const probe = useOriginVaultProbe();

  // Auto-focus so the user can submit with Enter when the URL is pre-filled
  // via ?url=... or the origin probe. Runs once on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // If the probe resolves with a detected origin and the user hasn't typed
  // anything, seed the input. Don't clobber a ?url=/?add= value or user input.
  useEffect(() => {
    if (prefilled.current) return;
    if (probe.status === "found" && probe.origin && url === "") {
      setUrl(probe.origin);
      prefilled.current = true;
    }
  }, [probe.status, probe.origin, url]);

  // The one connect code path — the form submit and the ?add= auto-begin
  // both go through the same normalize → beginOAuth → redirect sequence and
  // surface errors identically.
  const connect = useCallback(
    async (rawUrl: string) => {
      setError(null);
      setInsecureContext(false);

      let normalized: string;
      try {
        normalized = normalizeVaultUrl(rawUrl);
      } catch (err) {
        setError((err as Error).message);
        return;
      }

      setSubmitting(true);
      try {
        const { authorizeUrl } = await beginOAuth(normalized, undefined, undefined, {
          ...(redirect ? { redirect } : {}),
        });
        window.location.assign(authorizeUrl);
      } catch (err) {
        // Web Crypto isn't available on non-HTTPS / non-localhost origins,
        // so PKCE can't run at all. Render a distinct banner (different
        // colour + structured remediations) instead of the generic
        // "Connection failed" message so the operator understands the
        // browser-secure-context cause and the two fix paths.
        if (err instanceof InsecureContextError) {
          setInsecureContext(true);
        } else {
          setError((err as Error).message);
        }
        setSubmitting(false);
      }
    },
    [redirect],
  );

  // ?add= auto-begin. Runs at most once per mount; the field is already
  // prefilled via `initialUrl` above.
  useEffect(() => {
    if (autoBeginRan.current || !addUrl) return;
    autoBeginRan.current = true;

    // Strip the param from history first (replace, not push) so a refresh
    // or back-navigation never re-triggers the auto-connect.
    const next = new URLSearchParams(searchParams);
    next.delete("add");
    setSearchParams(next, { replace: true });

    // When an explicit ?url= rides along, prefill-only wins: the field
    // displays queryUrl, so auto-beginning against a DIFFERENT ?add= value
    // would be a display/action mismatch a crafted link could exploit.
    if (queryUrl) return;

    // Only explicit http(s) URLs may auto-begin OAuth — a crafted link must
    // not smuggle another scheme (or a bare hostname) into the flow.
    if (!addUrlIsHttp) return;

    let normalized: string;
    try {
      normalized = normalizeVaultUrl(addUrl);
    } catch {
      // Malformed — leave the prefilled value for the user to correct.
      return;
    }

    // Already connected to this vault? Switch to it instead of running a
    // second OAuth dance. Honour the sanitized `redirect` companion the same
    // way the fresh-connect path does (OAuthCallback) — the cloud console's
    // "Import notes" door arrives as `?add=…&redirect=/import` and must land
    // on /import whether or not the vault is already connected.
    const store = useVaultStore.getState();
    const existing = store.vaults[vaultIdFromUrl(normalized)];
    if (existing) {
      store.setActiveVault(existing.id);
      navigate(redirect ?? "/", { replace: true });
      return;
    }

    void connect(normalized);
  }, [addUrl, addUrlIsHttp, queryUrl, redirect, searchParams, setSearchParams, navigate, connect]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void connect(url);
  }

  return (
    <div className="page-prose">
      <nav className="mb-4 text-sm text-fg-dim">
        <Link to="/" className="focus-ring hover:text-accent">
          ← Back
        </Link>
      </nav>

      <header className="mb-8">
        <h1 className="page-title">Connect a vault</h1>
        <p className="mt-3 text-fg-muted">
          Paste your vault address. You'll be taken to its consent page to authorize Parachute.
        </p>
      </header>

      <form onSubmit={onSubmit} className="card space-y-5 rounded-xl p-6 shadow-soft">
        <div>
          <label htmlFor="vault-url" className="mb-1.5 block text-sm font-medium text-fg">
            Vault address
          </label>
          <input
            id="vault-url"
            ref={inputRef}
            type="url"
            required
            placeholder="https://u.parachute.computer/vault/your-name"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={submitting}
            className="input input-on-bg font-mono"
          />
          <p className="mt-1.5 text-xs text-fg-dim">
            From your cloud console at <code className="note-id">cloud.parachute.computer</code>, or
            your own Parachute hub — a local install lives at{" "}
            <code className="note-id">http://localhost:1939</code>.
          </p>
        </div>

        {insecureContext ? <InsecureContextBanner /> : null}

        {error ? (
          <div className="rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting || !url}
          className="btn btn-primary btn-lg w-full"
        >
          {submitting ? "Starting OAuth…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
