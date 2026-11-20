import React, { useState } from "react";
import type { Feed } from "./api";
import { extractHost, formatRelativeTime } from "./dateFormat";
import Dialog from "./Dialog";
import { nudgeFeed, reorderFeedList } from "./feedOrder";

interface FeedListViewProps {
  feeds: Feed[];
  loading: boolean;
  error: string | null;
  onRetryLoad: () => void;
  onOpenFeed: (feedId: string) => void;
  onOpenAdd: () => void;
  onOpenSettings: () => void;
  onTogglePin: (feed: Feed) => Promise<void>;
  onCommitOrder: (nextFeeds: Feed[]) => Promise<void>;
  onRefreshFeed: (feed: Feed) => Promise<{ feed: Feed; notModified: boolean; itemsAdded: number } | null>;
  onRenameFeed: (feed: Feed, newTitle: string) => Promise<void>;
  onDeleteFeed: (feed: Feed) => Promise<void>;
}

const FeedListView: React.FC<FeedListViewProps> = ({
  feeds,
  loading,
  error,
  onRetryLoad,
  onOpenFeed,
  onOpenAdd,
  onOpenSettings,
  onTogglePin,
  onCommitOrder,
  onRefreshFeed,
  onRenameFeed,
  onDeleteFeed,
}) => {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [refreshingIds, setRefreshingIds] = useState<Record<string, boolean>>({});
  const [refreshBadges, setRefreshBadges] = useState<Record<string, string>>({});
  const [renameTarget, setRenameTarget] = useState<Feed | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Feed | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const pinnedFeeds = feeds.filter((f) => f.pinned);
  const regularFeeds = feeds.filter((f) => !f.pinned);

  const handleDropOn = async (targetFeed: Feed) => {
    const sourceId = dragId;
    setDragId(null);
    setOverId(null);
    if (!sourceId || sourceId === targetFeed.feedId) return;
    const reordered = reorderFeedList(feeds, sourceId, targetFeed.feedId);
    if (reordered) {
      await onCommitOrder(reordered);
    }
  };

  const handleNudge = async (feedId: string, delta: -1 | 1) => {
    const reordered = nudgeFeed(feeds, feedId, delta);
    if (reordered) {
      await onCommitOrder(reordered);
    }
  };

  const handleRefresh = async (feed: Feed) => {
    setRefreshingIds((prev) => ({ ...prev, [feed.feedId]: true }));
    try {
      const res = await onRefreshFeed(feed);
      if (res) {
        const msg = res.itemsAdded > 0 ? `+${res.itemsAdded} new` : "Up to date";
        setRefreshBadges((prev) => ({ ...prev, [feed.feedId]: msg }));
      }
    } catch {
      // Parent updates feedsError banner cleanly
    } finally {
      setRefreshingIds((prev) => ({ ...prev, [feed.feedId]: false }));
    }
  };

  const submitRename: React.FormEventHandler = async (e) => {
    e.preventDefault();
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed.length > 120) return;
    setRenameSaving(true);
    setRenameError(null);
    try {
      await onRenameFeed(renameTarget, trimmed);
      setRenameTarget(null);
    } catch (err: unknown) {
      setRenameError((err as { message?: string })?.message || "Could not rename feed.");
    } finally {
      setRenameSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    setDeleteError(null);
    try {
      await onDeleteFeed(deleteTarget);
      setDeleteTarget(null);
    } catch (err: unknown) {
      setDeleteError((err as { message?: string })?.message || "Could not delete feed.");
    } finally {
      setDeleteSaving(false);
    }
  };

  const renderGroup = (groupFeeds: Feed[], sectionLabel?: string) => (
    <section className="feed-group" aria-label={sectionLabel || "Feeds"}>
      {sectionLabel && <h2 className="section-label">{sectionLabel}</h2>}
      <ul className="feed-list">
        {groupFeeds.map((feed, idx) => {
          const canMoveUp = idx > 0;
          const canMoveDown = idx < groupFeeds.length - 1;
          const isOver = overId === feed.feedId && dragId !== feed.feedId;
          const isDragging = dragId === feed.feedId;
          const isRefreshing = !!refreshingIds[feed.feedId];
          const badge = refreshBadges[feed.feedId];
          const subLabel =
            feed.kind === "push"
              ? `push/${feed.slug || "archive"}`
              : extractHost(feed.siteUrl || feed.url) || feed.url || "";

          return (
            <li
              key={feed.feedId}
              className={`feed-card${isDragging ? " is-dragging" : ""}${isOver ? " is-drop-target" : ""}`}
              draggable={groupFeeds.length > 1}
              onDragStart={(e) => {
                setDragId(feed.feedId);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", feed.feedId);
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                const dragged = feeds.find((f) => f.feedId === dragId);
                if (!dragged || dragged.pinned !== feed.pinned) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overId !== feed.feedId) setOverId(feed.feedId);
              }}
              onDragLeave={(e) => {
                if (overId === feed.feedId && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setOverId(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                void handleDropOn(feed);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
            >
              {groupFeeds.length > 1 && (
                <div className="feed-drag-col">
                  <span className="drag-grip" aria-hidden="true" title="Drag to reorder">
                    ⠿
                  </span>
                  <div className="nudge-btns">
                    <button
                      type="button"
                      className="btn-nudge"
                      onClick={() => void handleNudge(feed.feedId, -1)}
                      disabled={!canMoveUp}
                      aria-label={`Move ${feed.title} up`}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn-nudge"
                      onClick={() => void handleNudge(feed.feedId, 1)}
                      disabled={!canMoveDown}
                      aria-label={`Move ${feed.title} down`}
                      title="Move down"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              )}

              <div className="feed-main">
                <div className="feed-top">
                  <a
                    href={`/feed/${encodeURIComponent(feed.feedId)}`}
                    className="feed-title-link"
                    draggable={false}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                      e.preventDefault();
                      onOpenFeed(feed.feedId);
                    }}
                  >
                    <span className="feed-title">{feed.title}</span>
                  </a>
                  <span className={`kind-badge kind-${feed.kind}`}>{feed.kind}</span>
                  {feed.todayCount > 0 && (
                    <span className="count-pill">{feed.todayCount} today</span>
                  )}
                  {badge && <span className="status-pill">{badge}</span>}
                </div>

                <div className="feed-meta">
                  {subLabel && <span className="mono-meta">{subLabel}</span>}
                  <span>
                    {feed.kind === "push" ? "Last push " : "Fetched "}
                    {formatRelativeTime(feed.lastFetchedAt)}
                  </span>
                  {feed.lastItemAt && (
                    <span>Latest entry {formatRelativeTime(feed.lastItemAt)}</span>
                  )}
                </div>

                {feed.lastError && (
                  <p className="feed-error-line" title={feed.lastError}>
                    Fetch issue: {feed.lastError}
                  </p>
                )}
              </div>

              <div className="feed-actions">
                <button
                  type="button"
                  className={feed.pinned ? "btn-chip is-pinned" : "btn-chip"}
                  onClick={() => void onTogglePin(feed)}
                  aria-pressed={feed.pinned}
                  title={feed.pinned ? "Unpin feed" : "Pin feed to top"}
                >
                  {feed.pinned ? "Pinned" : "Pin"}
                </button>
                {feed.kind !== "push" && (
                  <button
                    type="button"
                    className="btn-chip"
                    onClick={() => void handleRefresh(feed)}
                    disabled={isRefreshing}
                    title="Fetch latest items now"
                  >
                    {isRefreshing ? "…" : "Refresh"}
                  </button>
                )}
                <button
                  type="button"
                  className="btn-chip"
                  onClick={() => {
                    setRenameError(null);
                    setRenameTarget(feed);
                    setRenameValue(feed.title);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="btn-chip btn-chip-danger"
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteTarget(feed);
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );

  return (
    <div className="view-wrap">
      <header className="view-header">
        <div>
          <h1 className="view-title">Feeds</h1>
          <p className="view-subtitle">
            RSS subscriptions and daily agent digests in one chronological archive.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onOpenAdd}>
          + Add feed
        </button>
      </header>

      {error && (
        <div className="banner banner-error">
          <span>{error}</span>
          <button type="button" className="btn-link" onClick={onRetryLoad}>
            Retry
          </button>
        </div>
      )}

      {loading && feeds.length === 0 ? (
        <div className="loading-state">Loading your feeds…</div>
      ) : feeds.length === 0 ? (
        <section className="empty-card">
          <h2>Your reader is empty</h2>
          <p>
            Add any website, RSS/Atom/JSON feed URL, or create a push archive for daily summaries
            from Mox, qwer, and Rally.
          </p>
          <div className="empty-actions">
            <button type="button" className="btn btn-primary" onClick={onOpenAdd}>
              Add your first feed
            </button>
            <button type="button" className="btn btn-ghost" onClick={onOpenSettings}>
              Configure API keys
            </button>
          </div>
        </section>
      ) : (
        <>
          {pinnedFeeds.length > 0 && renderGroup(pinnedFeeds, "Pinned")}
          {regularFeeds.length > 0 &&
            renderGroup(regularFeeds, pinnedFeeds.length > 0 ? "All feeds" : undefined)}
        </>
      )}

      <Dialog
        open={renameTarget !== null}
        onClose={() => {
          if (!renameSaving) {
            setRenameError(null);
            setRenameTarget(null);
          }
        }}
        title="Rename feed"
        closedBy={renameSaving ? "none" : "any"}
      >
        <form className="modal-form" onSubmit={submitRename}>
          <label className="field">
            <span>Feed title</span>
            <input
              type="text"
              maxLength={120}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              disabled={renameSaving}
              data-autofocus=""
              autoFocus
              required
            />
          </label>
          {renameError && <div className="banner banner-error">{renameError}</div>}
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setRenameError(null);
                setRenameTarget(null);
              }}
              disabled={renameSaving}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={renameSaving}>
              {renameSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleteSaving) {
            setDeleteError(null);
            setDeleteTarget(null);
          }
        }}
        title="Delete feed?"
        closedBy={deleteSaving ? "none" : "closerequest"}
      >
        <p className="confirm-copy">
          Delete <strong>{deleteTarget?.title}</strong> and its archived items? Any items you
          starred remain in your Starred list.
        </p>
        {deleteError && <div className="banner banner-error">{deleteError}</div>}
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setDeleteError(null);
              setDeleteTarget(null);
            }}
            disabled={deleteSaving}
            data-autofocus=""
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void confirmDelete()}
            disabled={deleteSaving}
          >
            {deleteSaving ? "Deleting…" : "Delete feed"}
          </button>
        </div>
      </Dialog>
    </div>
  );
};

export default FeedListView;
