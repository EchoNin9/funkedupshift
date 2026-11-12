import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Alert } from "../../components";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { PublicFile, downloadPublicFile, getPublicFile } from "./api";
import { formatBytes } from "./filedrop";

/** Public, unauthenticated download page (SPA's own /f/:id, alongside the
 * canonical tools.e9.cx/f/:id link). Must render for a signed-out visitor: no
 * useAuth, and the API helpers use plain fetch with no bearer token. */
const FileViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [file, setFile] = useState<PublicFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setLoadError("File not found or deleted");
      return;
    }
    let cancelled = false;
    getPublicFile(id)
      .then((f) => !cancelled && setFile(f))
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : "File not found or deleted"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !id || busy) return;
    setBusy(true);
    setError(null);
    try {
      const d = await downloadPublicFile(id, file.hasPassword ? password : undefined);
      window.location.href = d.url; // server forces an attachment download
      setDownloaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  };

  const used = downloaded && !!file?.oneTime;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="font-heading text-[24px] font-semibold tracking-[-0.02em] text-text-primary">File Drop</h1>

      {loading && (
        <div role="status" className="motion-safe:animate-pulse space-y-2 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-4">
          <span className="sr-only">Loading…</span>
          <div className="h-3 w-2/3 rounded bg-surface-3" />
          <div className="h-3 w-1/2 rounded bg-surface-3" />
        </div>
      )}

      {!loading && loadError && <Alert variant="error">{loadError}</Alert>}

      {!loading && file && (
        <form onSubmit={handleDownload} className="space-y-3 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-4">
          <div className="break-all text-[17px] font-bold text-text-primary">{file.name}</div>
          <p className="text-xs text-text-secondary">
            {formatBytes(file.size)} · expires {new Date(file.expiresAt * 1000).toLocaleString()}
          </p>
          {file.oneTime && <p className="text-sm text-text-secondary">This link works for one download</p>}
          {used ? (
            <p className="text-sm text-text-primary">Downloaded. This link will not work again.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              {file.hasPassword && (
                <input
                  type="password"
                  aria-label="Password"
                  placeholder="Password"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={`min-h-12 w-full rounded-ds-md border border-border-default bg-surface-0 px-3 text-[15px] text-text-primary placeholder:text-text-tertiary sm:w-auto ${focusRing}`}
                />
              )}
              <button type="submit" disabled={busy} className={`${buttonClasses("primary", "lg")} w-full sm:w-auto`}>
                {busy ? "Preparing…" : "Download"}
              </button>
            </div>
          )}
          {error && <Alert variant="error">{error}</Alert>}
        </form>
      )}
    </div>
  );
};

export default FileViewPage;
