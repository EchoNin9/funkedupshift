import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDots, CheckCircle, LinkSimple, LockSimple, Trash } from "@phosphor-icons/react";
import { Alert } from "../../components";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { CopyButton } from "../../components/CopyButton";
import { FormCard } from "../../components/FormCard";
import { IconButton } from "../../components/IconButton";
import { FieldError, IconTextField } from "../../components/IconTextField";
import { ListCard, ListEmpty, ListRow } from "../../components/ListCard";
import { useAuth } from "../../shell/AuthContext";
import { mintShortLink, listLinks, deleteLink, updateExpiry, type ShortLink } from "./api";

const URL_PATTERN = /^https?:\/\/[^\s/]+\.[^\s/]+/i;
const URL_ERROR = "Enter a full URL starting with http:// or https://";

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

const LinkRow: React.FC<{
  link: ShortLink;
  onDelete: (code: string) => void;
  onSaveExpiry: (code: string, expiresAt: number) => Promise<void>;
  busy: boolean;
}> = ({ link, onDelete, onSaveExpiry, busy }) => {
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
      setRowError("Pick a date and time in the future.");
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
    <ListRow className={busy ? "opacity-60" : ""}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-[260px]">
          <a
            href={link.shortUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`break-all rounded-sm text-[15px] font-bold text-accent-text hover:underline ${focusRing}`}
          >
            {link.shortUrl}
          </a>
          <div className="truncate text-[13px] text-text-secondary" title={link.url}>
            {link.url}
          </div>
        </div>
        <div className="min-w-[150px] text-xs leading-snug text-text-secondary">
          <div>Created {formatIsoDate(link.createdAt)}</div>
          <div>
            Expires <span className="font-semibold text-text-primary">{formatEpochDate(link.expiresAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <CopyButton text={link.shortUrl} />
          <IconButton
            icon={<CalendarDots size={16} weight="regular" aria-hidden="true" />}
            label="Edit expiry"
            onClick={startEdit}
            disabled={busy}
          />
          <IconButton
            icon={<Trash size={16} weight="regular" aria-hidden="true" />}
            label="Delete link"
            tone="danger"
            onClick={() => {
              if (window.confirm(`Delete ${link.shortUrl}? This cannot be undone.`)) onDelete(link.code);
            }}
            disabled={busy}
          />
        </div>
      </div>

      {editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-[color:var(--color-divider)] pt-3">
          <label htmlFor={`expiry-${link.code}`} className="text-[13px] font-semibold text-text-primary">
            New expiry
          </label>
          <input
            id={`expiry-${link.code}`}
            type="datetime-local"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-invalid={rowError ? true : undefined}
            aria-describedby={rowError ? `expiry-err-${link.code}` : undefined}
            className={`min-h-9 rounded-ds-md border border-border-default bg-surface-0 px-2.5 text-sm text-text-primary hover:border-border-hover ${focusRing}`}
          />
          <button type="button" onClick={saveEdit} disabled={saving} className={buttonClasses("primary", "sm")}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(false)} disabled={saving} className={buttonClasses("ghost", "sm")}>
            Cancel
          </button>
          {rowError && (
            <span id={`expiry-err-${link.code}`} role="alert" className="w-full text-[13px] text-danger">
              {rowError}
            </span>
          )}
        </div>
      )}
    </ListRow>
  );
};

const SkeletonRows: React.FC = () => (
  <>
    {[0, 1, 2].map((i) => (
      <ListRow key={i}>
        <div className="motion-safe:animate-pulse space-y-2">
          <div className="h-4 w-48 max-w-full rounded bg-surface-3" />
          <div className="h-3 w-72 max-w-full rounded bg-surface-3" />
        </div>
      </ListRow>
    ))}
  </>
);

const ShortenerPage: React.FC = () => {
  const { user } = useAuth();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<ShortLink | null>(null);

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
      if (!URL_PATTERN.test(url.trim())) {
        setError(URL_ERROR);
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        const result = await mintShortLink(url.trim());
        setLinks((prev) => [result, ...prev]);
        setMinted(result);
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
      setMinted((m) => (m && m.code === code ? null : m));
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

  const srTitle = <h1 className="sr-only">URL Shortener</h1>;

  if (!user) {
    return (
      <div className="space-y-4">
        {srTitle}
        <div className="flex flex-wrap items-center gap-4 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <LockSimple size={26} weight="regular" aria-hidden="true" className="text-accent-text" />
          <div className="min-w-[220px] flex-1">
            <div className="font-bold text-text-primary">Sign in to create short links</div>
            <div className="text-sm text-text-secondary">Your links stay private to your account.</div>
          </div>
          <Link to="/auth" className={buttonClasses("primary", "md")}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      {srTitle}
      <p className="mb-4 text-sm text-text-secondary">Paste a long URL to mint a short link on fus.fyi.</p>

      <FormCard onSubmit={handleSubmit} noValidate className="flex flex-wrap gap-2.5">
        <IconTextField
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          aria-label="URL to shorten"
          aria-describedby={error ? "shortener-error" : undefined}
          placeholder="https://example.com/some/very/long/path"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(null);
          }}
          icon={<LinkSimple size={18} weight="regular" />}
          invalid={!!error}
          wrapperClassName="flex-1 basis-[280px] min-w-0"
        />
        <button
          type="submit"
          disabled={submitting || !url.trim()}
          className={`${buttonClasses("primary", "lg")} w-full sm:w-auto`}
        >
          {submitting ? "Shortening…" : "Shorten"}
        </button>
      </FormCard>
      <FieldError id="shortener-error">{error}</FieldError>

      {minted && (
        <div
          role="status"
          className="mt-3 flex flex-wrap items-center gap-3.5 rounded-ds-lg border px-4 py-3.5"
          style={{
            background: "color-mix(in srgb, rgb(var(--color-hue-teal)) 12%, rgb(var(--color-surface-2)))",
            borderColor: "color-mix(in srgb, rgb(var(--color-hue-teal)) 35%, transparent)",
          }}
        >
          <CheckCircle size={22} weight="regular" aria-hidden="true" className="shrink-0 text-[rgb(var(--color-hue-teal))]" />
          <div className="min-w-0 flex-1 basis-[200px]">
            <div className="text-xs font-semibold text-text-secondary">Short link ready</div>
            <div className="break-all font-heading text-[20px] font-semibold tracking-[-0.02em] text-text-primary">
              {minted.shortUrl}
            </div>
          </div>
          <CopyButton text={minted.shortUrl} size="md" />
        </div>
      )}

      <section className="mt-9" aria-labelledby="your-links-heading">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 id="your-links-heading" className="font-heading text-[20px] font-semibold text-text-primary">
            Your links
          </h2>
          <span className="tag tag-neutral">{links.length}</span>
          <span className="text-[13px] text-text-secondary sm:ml-auto">
            Links expire after 90 days unless you change the date.
          </span>
        </div>

        {listError && <Alert variant="error" className="mb-3">{listError}</Alert>}

        <ListCard aria-busy={listLoading}>
          {listLoading && links.length === 0 ? (
            <SkeletonRows />
          ) : links.length === 0 ? (
            <ListEmpty>No short links yet — mint one above.</ListEmpty>
          ) : (
            links.map((link) => (
              <LinkRow
                key={link.code}
                link={link}
                onDelete={handleDelete}
                onSaveExpiry={handleSaveExpiry}
                busy={busyCode === link.code}
              />
            ))
          )}
        </ListCard>

        {nextCursor && (
          <div className="pt-3">
            <button type="button" onClick={loadMore} disabled={listLoading} className={buttonClasses("secondary", "md")}>
              {listLoading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
};

export default ShortenerPage;
