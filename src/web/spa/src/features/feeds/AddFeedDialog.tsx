import React, { useEffect, useId, useRef, useState } from "react";
import { Alert } from "../../components/Alert";
import { buttonClasses } from "../../components/buttonClasses";
import { SegmentedControl } from "../../components/SegmentedControl";
import { ApiError, AuthExpiredError, createPolledFeed, createPushFeed, type Feed } from "./api";
import { FeedModal } from "./FeedModal";
import { slugifyTitle } from "./feedOrder";

export interface AddFeedDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (feed: Feed, itemsAdded: number) => void;
  onOpenExisting: (feedId: string) => void;
  onAuthError: () => void;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function isAuthExpired(err: unknown): boolean {
  return (
    err instanceof AuthExpiredError ||
    (err as { name?: string } | null | undefined)?.name === "AuthExpiredError"
  );
}

export const AddFeedDialog: React.FC<AddFeedDialogProps> = ({
  open,
  onClose,
  onCreated,
  onOpenExisting,
  onAuthError,
}) => {
  const [tab, setTab] = useState<"poll" | "push">("poll");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateFeedId, setDuplicateFeedId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const pollUrlId = useId();
  const pollTitleId = useId();
  const pushTitleId = useId();
  const pushSlugId = useId();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setUrl("");
      setTitle("");
      setSlug("");
      setSubmitting(false);
      setError(null);
      setDuplicateFeedId(null);
    }
  }, [open]);

  const suggestedSlug = slugifyTitle(title) || "mox-daily";

  const handleTabChange = (nextTab: "poll" | "push") => {
    setTab(nextTab);
    setError(null);
    setDuplicateFeedId(null);
  };

  const handleSubmit: React.FormEventHandler = async (e) => {
    e.preventDefault();
    setError(null);
    setDuplicateFeedId(null);

    if (tab === "poll") {
      const trimmedUrl = url.trim();
      if (!trimmedUrl) {
        setError("Enter a website or feed URL.");
        return;
      }
      setSubmitting(true);
      try {
        const res = await createPolledFeed(trimmedUrl, title);
        if (!mountedRef.current) return;
        onCreated(res.feed, res.itemsAdded);
        onClose();
      } catch (err: unknown) {
        if (!mountedRef.current) return;
        if (isAuthExpired(err)) {
          onClose();
          onAuthError();
          return;
        }
        if (err instanceof ApiError && err.status === 409) {
          const existing = typeof err.data?.feedId === "string" ? err.data.feedId : null;
          setDuplicateFeedId(existing);
          setError("You already subscribe to this feed.");
        } else {
          setError((err as { message?: string })?.message || "Could not add feed.");
        }
      } finally {
        if (mountedRef.current) setSubmitting(false);
      }
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle || trimmedTitle.length > 120) {
      setError("Title is required (max 120 characters).");
      return;
    }
    const cleanSlug = slug.trim().toLowerCase();
    if (cleanSlug && !SLUG_RE.test(cleanSlug)) {
      setError("Slug must contain lowercase letters, numbers, and hyphens only.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await createPushFeed(trimmedTitle, cleanSlug || undefined);
      if (!mountedRef.current) return;
      onCreated(res.feed, res.itemsAdded);
      onClose();
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      if (isAuthExpired(err)) {
        onClose();
        onAuthError();
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        const existing = typeof err.data?.feedId === "string" ? err.data.feedId : null;
        setDuplicateFeedId(existing);
        setError("A push feed with that slug already exists.");
      } else {
        setError((err as { message?: string })?.message || "Could not create push feed.");
      }
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <FeedModal open={open} onClose={onClose} title="Add feed" closedBy={submitting ? "none" : "any"}>
      <SegmentedControl
        options={[
          { id: "poll", label: "Website / RSS URL" },
          { id: "push", label: "Push archive" },
        ]}
        value={tab}
        onChange={handleTabChange}
        ariaLabel="Feed source type"
        size="sm"
        className="w-full [&>button]:flex-1"
      />

      <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
        {tab === "poll" ? (
          <>
            <p className="m-0 text-sm text-text-secondary">
              Paste a blog homepage or direct RSS, Atom, or JSON Feed URL. If you enter a homepage,
              feed.e9.cx discovers the feed link automatically and fetches recent items right away.
            </p>
            <div className="field">
              <label htmlFor={pollUrlId}>Website or feed URL</label>
              <input
                id={pollUrlId}
                type="text"
                inputMode="url"
                className="input"
                placeholder="https://example.com or https://example.com/feed.xml"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={submitting}
                data-autofocus=""
                autoFocus
                required
              />
            </div>
            <div className="field">
              <label htmlFor={pollTitleId}>Custom title (optional)</label>
              <input
                id={pollTitleId}
                type="text"
                maxLength={120}
                className="input"
                placeholder="Uses the site's feed title if blank"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitting}
              />
            </div>
          </>
        ) : (
          <>
            <p className="m-0 text-sm text-text-secondary">
              Push feeds receive summaries from Mox, qwer, Rally, or your own scripts via{" "}
              <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-xs text-text-primary">
                POST /feeds/ingest
              </code>
              . Publishing directly with a new slug also auto-creates a push feed.
            </p>
            <div className="field">
              <label htmlFor={pushTitleId}>Feed title</label>
              <input
                id={pushTitleId}
                type="text"
                maxLength={120}
                className="input"
                placeholder="e.g. Mox · Todoist"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitting}
                data-autofocus=""
                autoFocus
                required
              />
            </div>
            <div className="field">
              <label htmlFor={pushSlugId}>Slug (optional)</label>
              <input
                id={pushSlugId}
                type="text"
                maxLength={64}
                className="input"
                placeholder={suggestedSlug}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                disabled={submitting}
              />
              <span className="mt-1 block text-xs text-text-secondary">
                Lowercase letters, digits, hyphens. Defaults to{" "}
                <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[11px] text-text-primary">
                  {suggestedSlug}
                </code>
                .
              </span>
            </div>
          </>
        )}

        {error && (
          <Alert variant="error" className="flex flex-wrap items-center justify-between gap-2">
            <span>{error}</span>
            {duplicateFeedId && (
              <button
                type="button"
                className="font-semibold underline underline-offset-2 hover:opacity-80"
                onClick={() => {
                  onClose();
                  onOpenExisting(duplicateFeedId);
                }}
              >
                Open existing feed →
              </button>
            )}
          </Alert>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            className={buttonClasses("secondary", "md")}
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button type="submit" className={buttonClasses("primary", "md")} disabled={submitting}>
            {submitting
              ? tab === "poll"
                ? "Discovering & fetching…"
                : "Creating…"
              : tab === "poll"
                ? "Subscribe"
                : "Create push feed"}
          </button>
        </div>
      </form>
    </FeedModal>
  );
};

export default AddFeedDialog;
