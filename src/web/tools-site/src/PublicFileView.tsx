import React, { useEffect, useState } from "react";
import { PublicFile, downloadPublicFile, getPublicFile } from "./api";
import { formatBytes } from "./filedrop";

interface Props {
  id: string;
}

/** Public, unauthenticated download page for a File Drop link (tools.e9.cx/f/<id>).
 * Mounted directly by main.tsx — like PublicTextView it must work signed-out:
 * no window.auth, plain fetch only (see getPublicFile / downloadPublicFile). */
const PublicFileView: React.FC<Props> = ({ id }) => {
  const [file, setFile] = useState<PublicFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPublicFile(id)
      .then((f) => !cancelled && setFile(f))
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : "File not found or deleted"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleDownload: React.FormEventHandler = async (e) => {
    e.preventDefault();
    if (!file || busy) return;
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
    <div className="app">
      <header className="site-header">
        <a className="wordmark" href="/">
          Echo9 Tools
        </a>
      </header>
      <main className="main">
        <section className="tool-view">
          <h1 className="tool-heading">File Drop</h1>
          {loading && <p className="muted">Loading…</p>}
          {!loading && loadError && <div className="banner banner-error">{loadError}</div>}
          {!loading && file && (
            <form className="textshare-viewer" onSubmit={handleDownload}>
              <p>
                <strong className="filedrop-name">{file.name}</strong>
              </p>
              <p className="muted">
                {formatBytes(file.size)} · expires {new Date(file.expiresAt * 1000).toLocaleString()}
              </p>
              {file.oneTime && <p className="muted">This link works for one download</p>}
              {used ? (
                <p>Downloaded. This link will not work again.</p>
              ) : (
                <div className="textshare-controls">
                  {file.hasPassword && (
                    <input
                      type="password"
                      className="filedrop-password"
                      placeholder="Password"
                      aria-label="Password"
                      autoComplete="off"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  )}
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy ? "Preparing…" : "Download"}
                  </button>
                </div>
              )}
              {error && <div className="banner banner-error">{error}</div>}
            </form>
          )}
        </section>
      </main>
    </div>
  );
};

export default PublicFileView;
