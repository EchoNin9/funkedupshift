import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  getDayItems,
  listDays,
  starItem,
  unstarItem,
  type DaySummary,
  type Feed,
  type FeedItem,
} from "./api";
import {
  extractHost,
  formatDayChip,
  formatDayHeading,
  formatItemTime,
  formatRelativeTime,
} from "./dateFormat";
import Dialog from "./Dialog";
import { buildFeedPath, isValidDayString } from "./router";
import SafeHtml from "./SafeHtml";
import { isSafeHref } from "./sanitizeHtml";

interface FeedDayViewProps {
  feedId: string;
  routeDay: string | null;
  knownFeed: Feed | null;
  userTz: string;
  onSelectDay: (day: string, replace?: boolean) => void;
  onBack: () => void;
  onFeedUpdated: (feed: Feed) => void;
  onTogglePin: (feed: Feed) => Promise<void>;
  onRefreshFeed: (feed: Feed) => Promise<{ feed: Feed; notModified: boolean; itemsAdded: number } | null>;
  onRenameFeed: (feed: Feed, newTitle: string) => Promise<void>;
  onDeleteFeed: (feed: Feed) => Promise<void>;
  onAuthError: () => void;
}

const COLLAPSE_THRESHOLD = 2600;

const FeedDayView: React.FC<FeedDayViewProps> = ({
  feedId,
  routeDay,
  knownFeed,
  userTz,
  onSelectDay,
  onBack,
  onFeedUpdated,
  onTogglePin,
  onRefreshFeed,
  onRenameFeed,
  onDeleteFeed,
  onAuthError,
}) => {
  const [feed, setFeed] = useState<Feed | null>(knownFeed);
  const [days, setDays] = useState<DaySummary[]>([]);
  const [daysCursor, setDaysCursor] = useState<string | null>(null);
  const [daysLoading, setDaysLoading] = useState(true);
  const [loadingMoreDays, setLoadingMoreDays] = useState(false);

  const [items, setItems] = useState<FeedItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starError, setStarError] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const routeDayRef = useRef(routeDay);
  routeDayRef.current = routeDay;
  const pendingStarsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (knownFeed && knownFeed.feedId === feedId) {
      setFeed((prev) => (prev && prev.feedId === feedId ? { ...prev, ...knownFeed } : knownFeed));
    }
  }, [knownFeed, feedId]);

  const loadDays = useCallback(async () => {
    setDaysLoading(true);
    setError(null);
    try {
      const page = await listDays(feedId);
      setDays(page.days);
      setDaysCursor(page.nextCursor);
      return page.days;
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AuthExpiredError") {
        onAuthError();
        return null;
      }
      setError((err as { message?: string })?.message || "Failed to load feed days.");
      return null;
    } finally {
      setDaysLoading(false);
    }
  }, [feedId, onAuthError]);

  useEffect(() => {
    let cancelled = false;
    setDays([]);
    setItems([]);
    setExpandedItems({});
    setRefreshNote(null);

    void (async () => {
      try {
        setDaysLoading(true);
        setError(null);
        const page = await listDays(feedId);
        if (cancelled) return;
        setDays(page.days);
        setDaysCursor(page.nextCursor);
      } catch (err: unknown) {
        if (cancelled) return;
        if ((err as { name?: string })?.name === "AuthExpiredError") {
          onAuthError();
          return;
        }
        setError((err as { message?: string })?.message || "Failed to load feed days.");
      } finally {
        if (!cancelled) setDaysLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [feedId, onAuthError]);

  useEffect(() => {
    if (!routeDay && !daysLoading && days.length > 0) {
      onSelectDay(days[0].day, true);
    }
  }, [routeDay, daysLoading, days, onSelectDay]);

  useEffect(() => {
    if (!routeDay) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setItemsLoading(true);
    setStarError(null);
    setError(null);

    void getDayItems(feedId, routeDay)
      .then((res) => {
        if (cancelled) return;
        setFeed(res.feed);
        onFeedUpdated(res.feed);
        setItems(res.items);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if ((err as { name?: string })?.name === "AuthExpiredError") {
          onAuthError();
          return;
        }
        setError((err as { message?: string })?.message || "Failed to load day items.");
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [feedId, routeDay, onFeedUpdated, onAuthError]);

  const handleLoadMoreDays = async () => {
    if (!daysCursor || loadingMoreDays) return;
    setLoadingMoreDays(true);
    try {
      const next = await listDays(feedId, daysCursor);
      if (!mountedRef.current) return;
      setDays((prev) => {
        const seen = new Set(prev.map((d) => d.day));
        return [...prev, ...next.days.filter((d) => !seen.has(d.day))];
      });
      setDaysCursor(next.nextCursor);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      if ((err as { name?: string })?.name === "AuthExpiredError") {
        onAuthError();
        return;
      }
      setError((err as { message?: string })?.message || "Failed to load older days.");
    } finally {
      if (mountedRef.current) setLoadingMoreDays(false);
    }
  };

  const handleRefreshNow = async () => {
    if (!feed || feed.kind === "push" || refreshing) return;
    const dayAtStart = routeDayRef.current;
    setRefreshing(true);
    setRefreshNote(null);
    setError(null);
    try {
      const res = await onRefreshFeed(feed);
      if (!mountedRef.current || !res) return;
      setFeed(res.feed);
      setRefreshNote(res.itemsAdded > 0 ? `+${res.itemsAdded} new items` : "Up to date");
      const freshDays = await loadDays();
      if (!mountedRef.current) return;
      const targetDay = routeDayRef.current || freshDays?.[0]?.day || null;
      if (targetDay) {
        if (targetDay !== routeDayRef.current) {
          onSelectDay(targetDay, true);
        } else {
          const refreshedDay = await getDayItems(feedId, targetDay);
          if (!mountedRef.current || (routeDayRef.current && routeDayRef.current !== targetDay)) {
            return;
          }
          if (!dayAtStart || routeDayRef.current === dayAtStart) {
            setFeed(refreshedDay.feed);
            setItems(refreshedDay.items);
          }
        }
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      if ((err as { name?: string })?.name === "AuthExpiredError") {
        onAuthError();
        return;
      }
      setError((err as { message?: string })?.message || "Feed refresh failed.");
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  };

  const handleToggleStar = async (targetItem: FeedItem) => {
    if (pendingStarsRef.current.has(targetItem.itemSk)) return;
    pendingStarsRef.current.add(targetItem.itemSk);
    setStarError(null);
    const nextStarred = !targetItem.starred;
    setItems((prev) =>
      prev.map((it) => (it.itemSk === targetItem.itemSk ? { ...it, starred: nextStarred } : it))
    );

    try {
      if (nextStarred) {
        await starItem(feedId, targetItem.itemSk);
      } else {
        await unstarItem(feedId, targetItem.itemSk);
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setItems((prev) =>
        prev.map((it) =>
          it.itemSk === targetItem.itemSk ? { ...it, starred: targetItem.starred } : it
        )
      );
      if ((err as { name?: string })?.name === "AuthExpiredError") {
        onAuthError();
        return;
      }
      setStarError((err as { message?: string })?.message || "Could not update star status.");
    } finally {
      pendingStarsRef.current.delete(targetItem.itemSk);
    }
  };

  const tz = feed?.tz || userTz;
  const activeIndex = routeDay ? days.findIndex((d) => d.day === routeDay) : -1;
  const newerDay = activeIndex > 0 ? days[activeIndex - 1].day : null;
  const olderDay =
    activeIndex >= 0 && activeIndex < days.length - 1 ? days[activeIndex + 1].day : null;

  return (
    <div className="view-wrap">
      <div className="breadcrumb-row">
        <a
          href="/"
          className="back-link"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onBack();
          }}
        >
          ← All feeds
        </a>
      </div>

      {feed && (
        <header className="feed-hero">
          <div className="feed-hero-main">
            <div className="feed-top">
              <h1 className="view-title">{feed.title}</h1>
              <span className={`kind-badge kind-${feed.kind}`}>{feed.kind}</span>
              {refreshNote && <span className="status-pill">{refreshNote}</span>}
            </div>
            <div className="feed-meta">
              {feed.kind === "push" ? (
                <span className="mono-meta">slug: {feed.slug}</span>
              ) : (
                <>
                  {feed.siteUrl && isSafeHref(feed.siteUrl) && (
                    <a
                      href={feed.siteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="meta-link"
                    >
                      {extractHost(feed.siteUrl) || feed.siteUrl} ↗
                    </a>
                  )}
                  {feed.url && <span className="mono-meta">{extractHost(feed.url)}</span>}
                </>
              )}
              <span>
                {feed.kind === "push" ? "Last push " : "Fetched "}
                {formatRelativeTime(feed.lastFetchedAt)}
              </span>
            </div>
          </div>

          <div className="feed-actions">
            <button
              type="button"
              className={feed.pinned ? "btn-chip is-pinned" : "btn-chip"}
              aria-pressed={feed.pinned}
              onClick={() => void onTogglePin(feed)}
            >
              {feed.pinned ? "Pinned" : "Pin"}
            </button>
            {feed.kind !== "push" && (
              <button
                type="button"
                className="btn-chip"
                onClick={() => void handleRefreshNow()}
                disabled={refreshing}
              >
                {refreshing ? "Refreshing…" : "Refresh now"}
              </button>
            )}
            <button
              type="button"
              className="btn-chip"
              onClick={() => {
                setRenameError(null);
                setRenameVal(feed.title);
                setRenameOpen(true);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="btn-chip btn-chip-danger"
              onClick={() => {
                setDeleteError(null);
                setDeleteOpen(true);
              }}
            >
              Delete
            </button>
          </div>
        </header>
      )}

      {feed?.lastError && (
        <div className="banner banner-warn">
          <span>Last fetch failed: {feed.lastError}</span>
          {feed.kind !== "push" && (
            <button type="button" className="btn-link" onClick={() => void handleRefreshNow()}>
              Retry fetch
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="banner banner-error">
          <span>{error}</span>
          <button type="button" className="btn-link" onClick={() => void loadDays()}>
            Retry
          </button>
        </div>
      )}

      {starError && <div className="banner banner-error">{starError}</div>}

      <section className="day-picker-bar" aria-label="Archive days">
        <div className="day-strip">
          {days.map((d) => {
            const chip = formatDayChip(d.day, tz);
            const active = d.day === routeDay;
            return (
              <a
                key={d.day}
                href={buildFeedPath(feedId, d.day)}
                className={active ? "day-chip is-active" : "day-chip"}
                aria-current={active ? "date" : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  onSelectDay(d.day);
                }}
              >
                <span className="day-chip-primary">{chip.primary}</span>
                <span className="day-chip-secondary">
                  {chip.secondary} · {d.count}
                </span>
              </a>
            );
          })}
          {daysCursor && (
            <button
              type="button"
              className="btn-chip"
              onClick={() => void handleLoadMoreDays()}
              disabled={loadingMoreDays}
            >
              {loadingMoreDays ? "Loading…" : "Older days →"}
            </button>
          )}
        </div>

        <label className="date-jump">
          <span className="sr-only">Jump to date</span>
          <input
            type="date"
            aria-label="Jump to date"
            value={routeDay || ""}
            onChange={(e) => {
              const val = e.target.value;
              if (isValidDayString(val)) {
                onSelectDay(val);
              }
            }}
          />
        </label>
      </section>

      {daysLoading && days.length === 0 ? (
        <div className="loading-state">Loading archive days…</div>
      ) : !error && days.length === 0 && !routeDay ? (
        <section className="empty-card">
          <h2>No items yet</h2>
          {feed?.kind === "push" ? (
            <p>
              This push archive is ready. Send summaries to <code>POST /feeds/ingest</code> with{" "}
              <code>{`{"feed": "${feed.slug}"}`}</code> and your API key from Settings.
            </p>
          ) : (
            <p>
              No entries have been archived for this feed yet. Try refreshing now or wait for the
              next hourly poll.
            </p>
          )}
        </section>
      ) : routeDay ? (
        <>
          <div className="day-subbar">
            <h2 className="day-heading">{formatDayHeading(routeDay)}</h2>
            <div className="day-nav-btns">
              <button
                type="button"
                className="btn-chip"
                disabled={!newerDay}
                onClick={() => newerDay && onSelectDay(newerDay)}
              >
                ← Newer day
              </button>
              <button
                type="button"
                className="btn-chip"
                disabled={!olderDay}
                onClick={() => olderDay && onSelectDay(olderDay)}
              >
                Older day →
              </button>
            </div>
          </div>

          {itemsLoading ? (
            <div className="loading-state">Loading entries for {routeDay}…</div>
          ) : items.length === 0 ? (
            <section className="empty-card">
              <h2>No items on {routeDay}</h2>
              <p>Nothing was published or archived on this date.</p>
              {days.length > 0 && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => onSelectDay(days[0].day)}
                >
                  Jump to latest active day ({days[0].day})
                </button>
              )}
            </section>
          ) : (
            <div className="items-stream">
              {items.map((item) => {
                const singleDayDigest = items.length === 1;
                const isVeryLong = !singleDayDigest && item.contentHtml.length > COLLAPSE_THRESHOLD;
                const isExpanded = !!expandedItems[item.itemSk];
                const collapsed = isVeryLong && !isExpanded;
                const itemHost = extractHost(item.link);
                const timeStr = formatItemTime(item.publishedAt, tz);

                return (
                  <article key={item.itemSk} className="entry-card">
                    <header className="entry-header">
                      <div className="entry-title-wrap">
                        <h3 className="entry-title">
                          {item.link && isSafeHref(item.link) ? (
                            <a href={item.link} target="_blank" rel="noopener noreferrer">
                              {item.title}
                            </a>
                          ) : (
                            item.title
                          )}
                        </h3>
                        <div className="entry-meta">
                          {timeStr && <span>{timeStr}</span>}
                          {item.author && <span>by {item.author}</span>}
                          {itemHost && <span className="mono-meta">{itemHost}</span>}
                        </div>
                      </div>

                      <button
                        type="button"
                        className={item.starred ? "star-btn is-starred" : "star-btn"}
                        aria-pressed={item.starred}
                        aria-label={item.starred ? `Unstar ${item.title}` : `Star ${item.title}`}
                        title={item.starred ? "Remove star" : "Star item"}
                        onClick={() => void handleToggleStar(item)}
                      >
                        {item.starred ? "★" : "☆"}
                      </button>
                    </header>

                    {item.contentHtml ? (
                      <div className={collapsed ? "entry-body-wrap is-collapsed" : "entry-body-wrap"}>
                        <SafeHtml html={item.contentHtml} className="item-prose" />
                      </div>
                    ) : item.summary ? (
                      <p className="entry-summary">{item.summary}</p>
                    ) : null}

                    {isVeryLong && (
                      <button
                        type="button"
                        className="btn-link collapse-toggle"
                        onClick={() =>
                          setExpandedItems((prev) => ({
                            ...prev,
                            [item.itemSk]: !prev[item.itemSk],
                          }))
                        }
                      >
                        {isExpanded ? "Show less" : "Show full entry"}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>
      ) : null}

      <Dialog
        open={renameOpen}
        onClose={() => {
          if (!renameSaving) {
            setRenameError(null);
            setRenameOpen(false);
          }
        }}
        title="Rename feed"
        closedBy={renameSaving ? "none" : "any"}
      >
        <form
          className="modal-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!feed) return;
            const t = renameVal.trim();
            if (!t || t.length > 120) return;
            setRenameSaving(true);
            setRenameError(null);
            try {
              await onRenameFeed(feed, t);
              if (mountedRef.current) {
                setFeed((prev) => (prev ? { ...prev, title: t } : prev));
                setRenameOpen(false);
              }
            } catch (err: unknown) {
              if (mountedRef.current) {
                setRenameError((err as { message?: string })?.message || "Could not rename feed.");
              }
            } finally {
              if (mountedRef.current) setRenameSaving(false);
            }
          }}
        >
          <label className="field">
            <span>Feed title</span>
            <input
              type="text"
              maxLength={120}
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
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
                setRenameOpen(false);
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
        open={deleteOpen}
        onClose={() => {
          if (!deleteSaving) {
            setDeleteError(null);
            setDeleteOpen(false);
          }
        }}
        title="Delete feed?"
        closedBy={deleteSaving ? "none" : "closerequest"}
      >
        <p className="confirm-copy">
          Delete <strong>{feed?.title}</strong> and its archived items? Any items you starred remain
          in Starred.
        </p>
        {deleteError && <div className="banner banner-error">{deleteError}</div>}
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setDeleteError(null);
              setDeleteOpen(false);
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
            onClick={async () => {
              if (!feed) return;
              setDeleteSaving(true);
              setDeleteError(null);
              try {
                await onDeleteFeed(feed);
                if (mountedRef.current) setDeleteOpen(false);
              } catch (err: unknown) {
                if (mountedRef.current) {
                  setDeleteError((err as { message?: string })?.message || "Could not delete feed.");
                }
              } finally {
                if (mountedRef.current) setDeleteSaving(false);
              }
            }}
            disabled={deleteSaving}
          >
            {deleteSaving ? "Deleting…" : "Delete feed"}
          </button>
        </div>
      </Dialog>
    </div>
  );
};

export default FeedDayView;
