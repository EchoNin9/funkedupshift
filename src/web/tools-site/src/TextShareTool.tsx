import React, { useEffect, useState } from "react";
import {
  TextPasteMinted,
  TextPasteSummary,
  deleteTextPaste,
  listTextPastes,
  mintTextPaste
} from "./api";
import { isAuthError } from "./api";

interface Props {
  onBack: () => void;
  onAuthError: () => void;
}

type ExpiryChoice = "3600" | "86400" | "604800" | "2592000";

const EXPIRY_OPTIONS: { value: ExpiryChoice; label: string }[] = [
  { value: "3600", label: "1 hour" },
  { value: "86400", label: "1 day" },
  { value: "604800", label: "1 week (default)" },
  { value: "2592000", label: "30 days" }
];

function shareUrlFor(id: string): string {
  return `https://tools.e9.cx/t/${id}`;
}

function formatExpiry(epochSeconds: number): string {
  try {
    return new Date(epochSeconds * 1000).toLocaleString();
  } catch {
    return String(epochSeconds);
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through — the link/content is shown regardless, so the user can copy by hand
  }
  return false;
}

const TextShareTool: React.FC<Props> = ({ onBack, onAuthError }) => {
  const [content, setContent] = useState("");
  const [expiry, setExpiry] = useState<ExpiryChoice>("604800");
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [mintResult, setMintResult] = useState<TextPasteMinted | null>(null);
  const [copied, setCopied] = useState(false);

  const [pastes, setPastes] = useState<TextPasteSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const load = async (reset: boolean) => {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    setListError(null);
    try {
      const page = await listTextPastes(reset ? null : cursor);
      setPastes((prev) => (reset ? page.items : [...prev, ...page.items]));
      setCursor(page.nextCursor);
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError();
        return;
      }
      setListError(err instanceof Error ? err.message : "Failed to load your pastes.");
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
    if (!content.trim()) return;
    setMinting(true);
    setMintError(null);
    setMintResult(null);
    setCopied(false);
    try {
      const paste = await mintTextPaste(content, Number(expiry));
      setMintResult(paste);
      setContent("");
      setPastes((prev) => [
        { id: paste.id, kind: paste.kind, createdAt: paste.createdAt, expiresAt: paste.expiresAt },
        ...prev
      ]);
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError();
        return;
      }
      setMintError(err instanceof Error ? err.message : "Failed to share text.");
    } finally {
      setMinting(false);
    }
  };

  const handleCopy = async (text: string) => {
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTextPaste(id);
      setPastes((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError();
        return;
      }
      setListError(err instanceof Error ? err.message : "Failed to delete paste.");
    }
  };

  return (
    <section className="tool-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="tool-heading">Text Share</h1>
      <p className="textshare-residency-note">Stored encrypted at rest in Canada. Anyone with the link can read it.</p>

      <form className="textshare-form" onSubmit={handleMint}>
        <textarea
          placeholder="Paste or type text to share…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
        />
        <div className="textshare-controls">
          <select value={expiry} onChange={(e) => setExpiry(e.target.value as ExpiryChoice)}>
            {EXPIRY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary" disabled={minting}>
            {minting ? "Sharing…" : "Share"}
          </button>
        </div>
      </form>

      {mintError && <div className="banner banner-error">{mintError}</div>}

      {mintResult && (
        <div className="mint-result">
          <code>{shareUrlFor(mintResult.id)}</code>
          <button type="button" className="btn btn-ghost" onClick={() => handleCopy(shareUrlFor(mintResult.id))}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}

      <h2 className="links-heading">Your pastes</h2>

      {listError && <div className="banner banner-error">{listError}</div>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : pastes.length === 0 ? (
        <p className="muted">You haven't shared any text yet.</p>
      ) : (
        <ul className="link-list">
          {pastes.map((paste) => (
            <li key={paste.id} className="link-row">
              <div className="link-main">
                <code>{shareUrlFor(paste.id)}</code>
              </div>
              <div className="link-meta">
                <span className="expiry">Expires {formatExpiry(paste.expiresAt)}</span>
                <button type="button" className="btn btn-ghost" onClick={() => handleCopy(shareUrlFor(paste.id))}>
                  Copy
                </button>
                <button type="button" className="btn btn-danger" onClick={() => handleDelete(paste.id)}>
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

export default TextShareTool;
