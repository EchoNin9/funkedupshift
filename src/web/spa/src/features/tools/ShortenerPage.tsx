import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ClipboardDocumentIcon,
  LinkIcon,
  TrashIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import { Alert, fadeUpStaggered, stagger } from "../../components";
import { useAuth } from "../../shell/AuthContext";
import { mintShortLink, listLinks, deleteLink, updateExpiry, type ShortLink } from "./api";

const input =
  "rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary flex-1 min-w-0";

/** epoch seconds -> value for <input type="datetime-local"> (local time, no seconds). */
function toDatetimeLocalValue(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value (local time) -> epoch seconds. */
function fromDatetimeLocalValue(value: string): number | null {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

function formatEpochDate(epochSeconds: number): string {
  if (!epochSeconds) return "—";
  return new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatIsoDate(iso: string): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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

const LinkRow: React.FC<{
  link: ShortLink;
  index: number;
  onDelete: (code: string) => void;
  onSaveExpiry: (code: string, expiresAt: number) => Promise<void>;
  busy: boolean;
}> = ({ link, index, onDelete, onSaveExpiry, busy }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => toDatetimeLocalValue(link.expiresAt));
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const startEdit = useCallback(() => {
    setDraft(toDatetimeLocalValue(link.expiresAt));
    setRowError(null);
    setEditing(true);
  }, [link.expiresAt]);

  const saveEdit = useCallback(async () => {
    const epoch = fromDatetimeLocalValue(draft);
    if (epoch === null || epoch <= Math.floor(Date.now() / 1000)) {
      setRowError("Pick a date/time in the future.");
      return;
    }
    setSaving(true);
    setRowError(null);
    try {
      await onSaveExpiry(link.code, epoch);
      setEditing(false);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Could not update expiry.");
    } finally {
      setSaving(false);
    }
  }, [draft, link.code, onSaveExpiry]);

  return (
    <motion.div
      variants={fadeUpStaggered}
      custom={index}
      className="rounded-xl border border-border-default bg-surface-2/80 p-3 flex flex-col gap-1.5"
    >
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <a
            href={link.shortUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-nav hover:underline break-all"
          >
            {link.shortUrl}
          </a>
          <p className="text-xs text-text-tertiary truncate">{link.url}</p>
          <p className="text-xs text-text-tertiary">
            Created {formatIsoDate(link.createdAt)} · Expires {formatEpochDate(link.expiresAt)}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <CopyButton text={link.shortUrl} />
          <button
            type="button"
            onClick={startEdit}
            disabled={busy}
            aria-label="Edit expiry"
            className="inline-flex items-center justify-center rounded-lg border border-border-hover bg-surface-2 p-1.5 text-text-primary hover:bg-surface-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PencilSquareIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Delete ${link.shortUrl}? This cannot be undone.`)) onDelete(link.code);
            }}
            disabled={busy}
            aria-label="Delete link"
            className="inline-flex items-center justify-center rounded-lg border border-border-hover bg-surface-2 p-1.5 text-red-500 hover:bg-surface-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {editing && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border-default pt-2">
          <input
            type="datetime-local"
            aria-label="New expiry"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={input}
          />
          <button
            type="button"
            onClick={saveEdit}
            disabled={saving}
            className="rounded-md bg-accent-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={saving}
            className="rounded-md border border-border-hover px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-3 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          {rowError && <span className="text-xs text-red-500 w-full">{rowError}</span>}
        </div>
      )}
    </motion.div>
  );
};

const ShortenerPage: React.FC = () => {
  const { user } = useAuth();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [links, setLinks] = useState<ShortLink[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const loadFirstPage = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const page = await listLinks();
      setLinks(page.items);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not load your links.");
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
      const page = await listLinks(nextCursor);
      setLinks((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not load more links.");
    } finally {
      setListLoading(false);
    }
  }, [nextCursor]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!url.trim() || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const result = await mintShortLink(url.trim());
        setLinks((prev) => [result, ...prev]);
        setUrl("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not shorten that URL.");
      } finally {
        setSubmitting(false);
      }
    },
    [url, submitting]
  );

  const handleDelete = useCallback(async (code: string) => {
    setBusyCode(code);
    setListError(null);
    try {
      await deleteLink(code);
      setLinks((prev) => prev.filter((l) => l.code !== code));
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not delete that link.");
    } finally {
      setBusyCode(null);
    }
  }, []);

  const handleSaveExpiry = useCallback(async (code: string, expiresAt: number) => {
    const updated = await updateExpiry(code, expiresAt);
    setLinks((prev) => prev.map((l) => (l.code === code ? updated : l)));
  }, []);

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-text-primary">URL Shortener</h1>
        <p className="text-sm text-text-secondary">Sign in to create short links.</p>
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
        <LinkIcon className="h-6 w-6 text-accent" />
        URL Shortener
      </motion.h1>
      <p className="text-sm text-text-secondary">
        Paste a long URL to mint a short link on fus.fyi.
      </p>

      {error && <Alert variant="error">{error}</Alert>}

      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 items-center">
        <input
          type="url"
          aria-label="URL to shorten"
          placeholder="https://example.com/some/very/long/path"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className={input}
          required
        />
        <button
          type="submit"
          disabled={submitting || !url.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {submitting ? "Shortening…" : "Shorten"}
        </button>
      </form>

      <div className="space-y-2 pt-2">
        <h2 className="text-sm font-semibold text-text-primary">Your links</h2>

        {listError && <Alert variant="error">{listError}</Alert>}

        {links.length === 0 && !listLoading && (
          <p className="text-sm text-text-tertiary">No short links yet — mint one above.</p>
        )}

        {links.length > 0 && (
          <motion.div className="space-y-2" initial="hidden" animate="visible" variants={stagger(0.05)}>
            {links.map((link, i) => (
              <LinkRow
                key={link.code}
                link={link}
                index={i}
                onDelete={handleDelete}
                onSaveExpiry={handleSaveExpiry}
                busy={busyCode === link.code}
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

export default ShortenerPage;
