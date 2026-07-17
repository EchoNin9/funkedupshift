import React, { useEffect, useState } from "react";
import { ShortLink, deleteLink, isAuthError, listLinks, mintShortLink, updateExpiry } from "./api";

interface Props {
  onBack: () => void;
  onAuthError: () => void;
}

function formatExpiry(epochSeconds: number): string {
  try {
    return new Date(epochSeconds * 1000).toLocaleDateString();
  } catch {
    return String(epochSeconds);
  }
}

function toDateInputValue(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return d.toISOString().slice(0, 10);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through — the link text is shown regardless, so the user can copy by hand
  }
  return false;
}

const ShortenerTool: React.FC<Props> = ({ onBack, onAuthError }) => {
  const [url, setUrl] = useState("");
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [mintResult, setMintResult] = useState<ShortLink | null>(null);
  const [copied, setCopied] = useState(false);

  const [links, setLinks] = useState<ShortLink[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const load = async (reset: boolean) => {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    setListError(null);
    try {
      const page = await listLinks(reset ? null : cursor);
      setLinks((prev) => (reset ? page.items : [...prev, ...page.items]));
      setCursor(page.nextCursor);
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError();
        return;
      }
      setListError(err instanceof Error ? err.message : "Failed to load links.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMint: React.FormEventHandler = async (e) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setMinting(true);
    setMintError(null);
    setMintResult(null);
    setCopied(false);
    try {
      const link = await mintShortLink(trimmed);
      setMintResult(link);
      setUrl("");
      setLinks((prev) => [link, ...prev]);
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError();
        return;
      }
      setMintError(err instanceof Error ? err.message : "Failed to mint link.");
    } finally {
      setMinting(false);
    }
  };

  const handleCopy = async (text: string) => {
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDelete = async (code: string) => {
    try {
      await deleteLink(code);
      setLinks((prev) => prev.filter((l) => l.code !== code));
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError();
        return;
      }
      setListError(err instanceof Error ? err.message : "Failed to delete link.");
    }
  };

  const startEdit = (link: ShortLink) => {
    setEditingCode(link.code);
    setEditDate(toDateInputValue(link.expiresAt));
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingCode(null);
    setEditError(null);
  };

  const saveEdit = async (code: string) => {
    const ts = Math.floor(new Date(`${editDate}T23:59:59Z`).getTime() / 1000);
    if (!Number.isFinite(ts) || ts <= Math.floor(Date.now() / 1000)) {
      setEditError("Pick a date in the future.");
      return;
    }
    try {
      const updated = await updateExpiry(code, ts);
      setLinks((prev) => prev.map((l) => (l.code === code ? updated : l)));
      setEditingCode(null);
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError();
        return;
      }
      setEditError(err instanceof Error ? err.message : "Failed to update expiry.");
    }
  };

  return (
    <section className="tool-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="tool-heading">URL Shortener</h1>

      <form className="mint-form" onSubmit={handleMint}>
        <input
          type="url"
          placeholder="https://example.com/a-very-long-link"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button type="submit" className="btn btn-primary" disabled={minting}>
          {minting ? "Minting…" : "Shorten"}
        </button>
      </form>

      {mintError && <div className="banner banner-error">{mintError}</div>}

      {mintResult && (
        <div className="mint-result">
          <code>{mintResult.shortUrl}</code>
          <button type="button" className="btn btn-ghost" onClick={() => handleCopy(mintResult.shortUrl)}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}

      <h2 className="links-heading">Your links</h2>

      {listError && <div className="banner banner-error">{listError}</div>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : links.length === 0 ? (
        <p className="muted">You haven't minted any links yet.</p>
      ) : (
        <ul className="link-list">
          {links.map((link) => (
            <li key={link.code} className="link-row">
              <div className="link-main">
                <code>{link.shortUrl}</code>
                <span className="link-target" title={link.url}>
                  {link.url}
                </span>
              </div>
              <div className="link-meta">
                {editingCode === link.code ? (
                  <div className="edit-expiry">
                    <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                    <button type="button" className="btn btn-ghost" onClick={() => saveEdit(link.code)}>
                      Save
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
                      Cancel
                    </button>
                    {editError && <span className="inline-error">{editError}</span>}
                  </div>
                ) : (
                  <>
                    <span className="expiry">Expires {formatExpiry(link.expiresAt)}</span>
                    <button type="button" className="btn btn-ghost" onClick={() => startEdit(link)}>
                      Edit
                    </button>
                  </>
                )}
                <button type="button" className="btn btn-ghost" onClick={() => handleCopy(link.shortUrl)}>
                  Copy
                </button>
                <button type="button" className="btn btn-danger" onClick={() => handleDelete(link.code)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <button type="button" className="btn btn-ghost load-more" onClick={() => load(false)} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
};

export default ShortenerTool;
