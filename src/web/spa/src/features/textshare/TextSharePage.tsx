import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle, LockSimple, Trash } from "@phosphor-icons/react";
import { Alert } from "../../components";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { CopyButton } from "../../components/CopyButton";
import { FormCard } from "../../components/FormCard";
import { IconButton } from "../../components/IconButton";
import { ListCard, ListEmpty, ListRow } from "../../components/ListCard";
import { useAuth } from "../../shell/AuthContext";
import {
  TextPasteSummary,
  deleteTextPaste,
  listTextPastes,
  mintTextPaste,
  shareUrlFor,
} from "./api";

const input = `rounded-ds-md border border-border-default bg-surface-0 px-3 text-[15px] text-text-primary placeholder:text-text-tertiary hover:border-border-hover motion-safe:transition-colors motion-safe:duration-150 ${focusRing}`;

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

const PasteRow: React.FC<{
  paste: TextPasteSummary;
  onDelete: (id: string) => void;
  busy: boolean;
}> = ({ paste, onDelete, busy }) => {
  const url = shareUrlFor(paste.id);
  return (
    <ListRow className={busy ? "opacity-60" : ""}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-[260px]">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={`break-all rounded-sm text-[15px] font-bold text-accent-text hover:underline ${focusRing}`}
          >
            {url}
          </a>
          <p className="text-xs text-text-secondary">Expires {formatEpochDateTime(paste.expiresAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <CopyButton text={url} />
          <IconButton
            icon={<Trash size={16} weight="regular" aria-hidden="true" />}
            label="Delete paste"
            tone="danger"
            onClick={() => {
              if (window.confirm("Delete this shared paste? This cannot be undone.")) onDelete(paste.id);
            }}
            disabled={busy}
          />
        </div>
      </div>
    </ListRow>
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

  const srTitle = <h1 className="sr-only">Text Share</h1>;

  if (!user) {
    return (
      <div className="space-y-4">
        {srTitle}
        <div className="flex flex-wrap items-center gap-4 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <LockSimple size={26} weight="regular" aria-hidden="true" className="text-accent-text" />
          <div className="min-w-[220px] flex-1">
            <div className="font-bold text-text-primary">Sign in to share text snippets</div>
            <div className="text-sm text-text-secondary">Anyone with a link can read it, no sign-in required.</div>
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
      <p className="mb-4 text-sm text-text-secondary">
        Paste text to mint a unique link — anyone with the link can read it, no sign-in required.
        Stored encrypted at rest in Canada.
      </p>

      {error && <Alert variant="error" className="mb-3">{error}</Alert>}

      <FormCard onSubmit={handleSubmit} className="space-y-2.5">
        <textarea
          aria-label="Text to share"
          placeholder="Paste or type text to share…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          className={`${input} w-full resize-y py-3 font-mono text-[13px]`}
          required
        />
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Expiry"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value as ExpiryChoice)}
            className={`${input} min-h-12 w-full sm:w-auto`}
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
            className={`${buttonClasses("primary", "lg")} w-full sm:w-auto`}
          >
            {submitting ? "Sharing…" : "Share"}
          </button>
        </div>
      </FormCard>

      {mintedUrl && (
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
            <div className="text-xs font-semibold text-text-secondary">Share link ready</div>
            <div className="break-all font-heading text-[18px] font-semibold tracking-[-0.02em] text-text-primary">
              {mintedUrl}
            </div>
          </div>
          <CopyButton text={mintedUrl} size="md" />
        </div>
      )}

      <section className="mt-9" aria-labelledby="your-pastes-heading">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 id="your-pastes-heading" className="font-heading text-[20px] font-semibold text-text-primary">
            Your pastes
          </h2>
          <span className="tag tag-neutral">{pastes.length}</span>
        </div>

        {listError && <Alert variant="error" className="mb-3">{listError}</Alert>}

        <ListCard aria-busy={listLoading}>
          {listLoading && pastes.length === 0 ? (
            [0, 1, 2].map((i) => (
              <ListRow key={i}>
                <div className="motion-safe:animate-pulse space-y-2">
                  <div className="h-4 w-48 max-w-full rounded bg-surface-3" />
                  <div className="h-3 w-32 max-w-full rounded bg-surface-3" />
                </div>
              </ListRow>
            ))
          ) : pastes.length === 0 ? (
            <ListEmpty>You haven't shared any text yet.</ListEmpty>
          ) : (
            pastes.map((paste) => (
              <PasteRow key={paste.id} paste={paste} onDelete={handleDelete} busy={busyId === paste.id} />
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

export default TextSharePage;
