import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ClipboardDocumentIcon, DocumentTextIcon, TrashIcon } from "@heroicons/react/24/outline";
import { Alert, fadeUpStaggered, stagger } from "../../components";
import { useAuth } from "../../shell/AuthContext";
import {
  TextPasteSummary,
  deleteTextPaste,
  listTextPastes,
  mintTextPaste,
  shareUrlFor,
} from "./api";

const input =
  "rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary";

type ExpiryChoice = "3600" | "86400" | "604800" | "2592000";

const EXPIRY_OPTIONS: { value: ExpiryChoice; label: string }[] = [
  { value: "3600", label: "1 hour" },
  { value: "86400", label: "1 day" },
  { value: "604800", label: "1 week (default)" },
  { value: "2592000", label: "30 days" },
];

function formatEpochDateTime(epochSeconds: number): string {
  if (!epochSeconds) return "—";
  return new Date(epochSeconds * 1000).toLocaleString();
}

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-hover bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-3 transition-colors shrink-0"
    >
      <ClipboardDocumentIcon className="h-3.5 w-3.5" />
      {copied ? "Copied" : "Copy"}
    </button>
  );
};

const PasteRow: React.FC<{
  paste: TextPasteSummary;
  index: number;
  onDelete: (id: string) => void;
  busy: boolean;
}> = ({ paste, index, onDelete, busy }) => {
  const url = shareUrlFor(paste.id);
  return (
    <motion.div
      variants={fadeUpStaggered}
      custom={index}
      className="rounded-xl border border-border-default bg-surface-2/80 p-3 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-nav hover:underline break-all"
        >
          {url}
        </a>
        <p className="text-xs text-text-tertiary">
          Expires {formatEpochDateTime(paste.expiresAt)}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <CopyButton text={url} />
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Delete this shared paste? This cannot be undone.")) onDelete(paste.id);
          }}
          disabled={busy}
          aria-label="Delete paste"
          className="inline-flex items-center justify-center rounded-lg border border-border-hover bg-surface-2 p-1.5 text-red-500 hover:bg-surface-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  );
};

const TextSharePage: React.FC = () => {
  const { user } = useAuth();
  const [content, setContent] = useState("");
  const [expiry, setExpiry] = useState<ExpiryChoice>("604800");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mintedUrl, setMintedUrl] = useState<string | null>(null);

  const [pastes, setPastes] = useState<TextPasteSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadFirstPage = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const page = await listTextPastes();
      setPastes(page.items);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not load your pastes.");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) loadFirstPage();
  }, [user, loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setListLoading(true);
    setListError(null);
    try {
      const page = await listTextPastes(nextCursor);
      setPastes((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not load more pastes.");
    } finally {
      setListLoading(false);
    }
  }, [nextCursor]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!content.trim() || submitting) return;
      setSubmitting(true);
      setError(null);
      setMintedUrl(null);
      try {
        const paste = await mintTextPaste(content, Number(expiry));
        setPastes((prev) => [
          { id: paste.id, kind: paste.kind, createdAt: paste.createdAt, expiresAt: paste.expiresAt },
          ...prev,
        ]);
        setMintedUrl(shareUrlFor(paste.id));
        setContent("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not share that text.");
      } finally {
        setSubmitting(false);
      }
    },
    [content, expiry, submitting]
  );

  const handleDelete = useCallback(async (id: string) => {
    setBusyId(id);
    setListError(null);
    try {
      await deleteTextPaste(id);
      setPastes((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not delete that paste.");
    } finally {
      setBusyId(null);
    }
  }, []);

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-text-primary">Text Share</h1>
        <p className="text-sm text-text-secondary">Sign in to share text snippets.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <motion.h1
        className="text-2xl font-semibold tracking-tight text-text-primary flex items-center gap-2"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <DocumentTextIcon className="h-6 w-6 text-accent" />
        Text Share
      </motion.h1>
      <p className="text-sm text-text-secondary">
        Paste text to mint a unique link — anyone with the link can read it, no sign-in required.
        Stored encrypted at rest in Canada.
      </p>

      {error && <Alert variant="error">{error}</Alert>}

      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          aria-label="Text to share"
          placeholder="Paste or type text to share…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          className={`${input} w-full font-mono text-xs resize-y`}
          required
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Expiry"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value as ExpiryChoice)}
            className={input}
          >
            {EXPIRY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={submitting || !content.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {submitting ? "Sharing…" : "Share"}
          </button>
        </div>
      </form>

      {mintedUrl && (
        <div className="rounded-xl border border-border-default bg-surface-2/80 p-3 flex items-center gap-2">
          <code className="flex-1 text-sm text-nav break-all">{mintedUrl}</code>
          <CopyButton text={mintedUrl} />
        </div>
      )}

      <div className="space-y-2 pt-2">
        <h2 className="text-sm font-semibold text-text-primary">Your pastes</h2>

        {listError && <Alert variant="error">{listError}</Alert>}

        {pastes.length === 0 && !listLoading && (
          <p className="text-sm text-text-tertiary">You haven't shared any text yet.</p>
        )}

        {pastes.length > 0 && (
          <motion.div className="space-y-2" initial="hidden" animate="visible" variants={stagger(0.05)}>
            {pastes.map((paste, i) => (
              <PasteRow
                key={paste.id}
                paste={paste}
                index={i}
                onDelete={handleDelete}
                busy={busyId === paste.id}
              />
            ))}
          </motion.div>
        )}

        {nextCursor && (
          <div className="pt-1">
            <button
              type="button"
              onClick={loadMore}
              disabled={listLoading}
              className="rounded-md border border-border-hover px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-3 disabled:opacity-50"
            >
              {listLoading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TextSharePage;
