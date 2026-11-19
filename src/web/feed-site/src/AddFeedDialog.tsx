import React, { useEffect, useRef, useState } from "react";
import { ApiError, createPolledFeed, createPushFeed, type Feed } from "./api";
import Dialog from "./Dialog";
import { slugifyTitle } from "./feedOrder";

interface AddFeedDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (feed: Feed, itemsAdded: number) => void;
  onOpenExisting: (feedId: string) => void;
  onAuthError: () => void;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const AddFeedDialog: React.FC<AddFeedDialogProps> = ({
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
        if ((err as { name?: string })?.name === "AuthExpiredError") {
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
      if ((err as { name?: string })?.name === "AuthExpiredError") {
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
    <Dialog open={open} onClose={onClose} title="Add feed" closedBy={submitting ? "none" : "any"}>
      <div className="segmented" role="group" aria-label="Feed source type">
        <button
          type="button"
          aria-pressed={tab === "poll"}
          className={tab === "poll" ? "seg-btn is-active" : "seg-btn"}
          onClick={() => {
            setTab("poll");
            setError(null);
            setDuplicateFeedId(null);
          }}
        >
          Website / RSS URL
        </button>
        <button
          type="button"
          aria-pressed={tab === "push"}
          className={tab === "push" ? "seg-btn is-active" : "seg-btn"}
          onClick={() => {
            setTab("push");
            setError(null);
            setDuplicateFeedId(null);
          }}
        >
          Push archive
        </button>
      </div>

      <form className="modal-form" onSubmit={handleSubmit}>
        {tab === "poll" ? (
          <>
            <p className="field-hint">
              Paste a blog homepage or direct RSS, Atom, or JSON Feed URL. If you enter a homepage,
              feed.e9.cx discovers the feed link automatically and fetches recent items right away.
            </p>
            <label className="field">
              <span>Website or feed URL</span>
              <input
                type="text"
                inputMode="url"
                placeholder="https://example.com or https://example.com/feed.xml"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={submitting}
                data-autofocus=""
                autoFocus
                required
              />
            </label>
            <label className="field">
              <span>Custom title (optional)</span>
              <input
                type="text"
                maxLength={120}
                placeholder="Uses the site's feed title if blank"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitting}
              />
            </label>
          </>
        ) : (
          <>
            <p className="field-hint">
              Push feeds receive summaries from Mox, qwer, Rally, or your own scripts via{" "}
              <code>POST /feeds/ingest</code>. Publishing directly with a new slug also auto-creates
              a push feed.
            </p>
            <label className="field">
              <span>Feed title</span>
              <input
                type="text"
                maxLength={120}
                placeholder="e.g. Mox · Todoist"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitting}
                data-autofocus=""
                autoFocus
                required
              />
            </label>
            <label className="field">
              <span>Slug (optional)</span>
              <input
                type="text"
                maxLength={64}
                placeholder={suggestedSlug}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                disabled={submitting}
              />
              <span className="field-sub">
                Lowercase letters, digits, hyphens. Defaults to <code>{suggestedSlug}</code>.
              </span>
            </label>
          </>
        )}

        {error && (
          <div className="banner banner-error">
            <span>{error}</span>
            {duplicateFeedId && (
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  onClose();
                  onOpenExisting(duplicateFeedId);
                }}
              >
                Open existing feed →
              </button>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
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
    </Dialog>
  );
};

export default AddFeedDialog;
