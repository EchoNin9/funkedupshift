import React, { useEffect, useState } from "react";
import { TextPastePublic, getPublicTextPaste } from "./api";

interface Props {
  id: string;
}

function formatExpiry(epochSeconds: number): string {
  try {
    return new Date(epochSeconds * 1000).toLocaleString();
  } catch {
    return String(epochSeconds);
  }
}

/** Public, unauthenticated viewer for a shared text paste (tools.e9.cx/t/<id>).
 * Mounted directly by main.tsx when the URL path matches /t/<id> — this
 * component (and everything it imports) MUST work for a signed-out visitor:
 * no window.auth calls, plain fetch only (see getPublicTextPaste in api.ts).
 * Content is rendered as a React text node inside <pre> (never innerHTML),
 * so no escaping is needed and no script in the paste can execute. */
const PublicTextView: React.FC<Props> = ({ id }) => {
  const [paste, setPaste] = useState<TextPastePublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPublicTextPaste(id)
      .then((result) => {
        if (!cancelled) setPaste(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "This paste could not be found.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleCopy = async () => {
    if (!paste) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(paste.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // clipboard denied — content is visible on screen regardless
    }
  };

  return (
    <div className="app">
      <header className="site-header">
        <a className="wordmark" href="/">
          e9 tools
        </a>
      </header>
      <main className="main">
        <section className="tool-view">
          <h1 className="tool-heading">Shared text</h1>

          {loading && <p className="muted">Loading…</p>}

          {!loading && error && (
            <div className="banner banner-error">
              This paste is unavailable — it may have expired or the link may be incorrect.
            </div>
          )}

          {!loading && paste && (
            <>
              <div className="textshare-viewer">
                <pre>{paste.content}</pre>
                <div className="link-meta">
                  <span className="expiry">Expires {formatExpiry(paste.expiresAt)}</span>
                  <button type="button" className="btn btn-ghost" onClick={handleCopy}>
                    {copied ? "Copied!" : "Copy text"}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
};

export default PublicTextView;
