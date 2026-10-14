import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Alert } from "../../components";
import { CopyButton } from "../../components/CopyButton";
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

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="font-heading text-[24px] font-semibold tracking-[-0.02em] text-text-primary">Shared text</h1>

      {loading && (
        <div role="status" className="motion-safe:animate-pulse space-y-2 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-4">
          <span className="sr-only">Loading…</span>
          <div className="h-3 w-2/3 rounded bg-surface-3" />
          <div className="h-3 w-full rounded bg-surface-3" />
          <div className="h-3 w-5/6 rounded bg-surface-3" />
        </div>
      )}

      {!loading && error && (
        <Alert variant="error">This paste is unavailable — it may have expired or the link may be incorrect.</Alert>
      )}

      {!loading && paste && (
        <div className="space-y-3 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-4">
          <pre
            tabIndex={0}
            aria-label="Shared text content"
            className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-ds-md border border-border-default bg-surface-0 p-3.5 font-mono text-[13px] text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {paste.content}
          </pre>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-text-secondary">
              Expires {new Date(paste.expiresAt * 1000).toLocaleString()}
            </span>
            <CopyButton text={paste.content} label="Copy text" className="sm:ml-auto" />
          </div>
        </div>
      )}
    </div>
  );
};

export default TextViewPage;
