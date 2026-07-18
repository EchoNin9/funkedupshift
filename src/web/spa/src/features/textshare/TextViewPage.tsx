import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Alert } from "../../components";
import { TextPastePublic, getPublicTextPaste } from "./api";

/** Public, unauthenticated viewer for a shared text paste (SPA's own
 * /t/:id, served alongside the canonical tools.e9.cx/t/:id link). This
 * component MUST render correctly for a signed-out visitor — it does not
 * call useAuth or gate on it, and getPublicTextPaste uses a plain fetch with
 * no bearer token (the route has no Cognito authorizer at all). */
const TextViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [paste, setPaste] = useState<TextPastePublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError("Missing paste id.");
      return;
    }
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
      await navigator.clipboard.writeText(paste.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-text-primary">Shared text</h1>

      {loading && <p className="text-sm text-text-tertiary">Loading…</p>}

      {!loading && error && (
        <Alert variant="error">This paste is unavailable — it may have expired or the link may be incorrect.</Alert>
      )}

      {!loading && paste && (
        <div className="rounded-xl border border-border-default bg-surface-2/80 p-4 space-y-3">
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-text-primary max-h-[60vh] overflow-y-auto">
            {paste.content}
          </pre>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-tertiary">
              Expires {new Date(paste.expiresAt * 1000).toLocaleString()}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-hover bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-3 transition-colors"
            >
              {copied ? "Copied" : "Copy text"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TextViewPage;
