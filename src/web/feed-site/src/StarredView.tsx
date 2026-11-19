import React, { useCallback, useEffect, useRef, useState } from "react";
import { listStars, unstarItem, type StarItem } from "./api";
import { extractHost, formatRelativeTime } from "./dateFormat";
import { buildFeedPath } from "./router";
import { isSafeHref } from "./sanitizeHtml";

interface StarredViewProps {
  onOpenArchive: (feedId: string, day: string) => void;
  onAuthError: () => void;
}

const StarredView: React.FC<StarredViewProps> = ({ onOpenArchive, onAuthError }) => {
  const [items, setItems] = useState<StarItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingUnstarsRef = useRef<Set<string>>(new Set());

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listStars();
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AuthExpiredError") {
        onAuthError();
        return;
      }
      setError((err as { message?: string })?.message || "Failed to load starred items.");
    } finally {
      setLoading(false);
    }
  }, [onAuthError]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const handleLoadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await listStars(cursor);
      setItems((prev) => {
        const seen = new Set(prev.map((s) => s.starSk));
        return [...prev, ...page.items.filter((s) => !seen.has(s.starSk))];
      });
      setCursor(page.nextCursor);
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AuthExpiredError") {
        onAuthError();
        return;
      }
      setError((err as { message?: string })?.message || "Failed to load more stars.");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleUnstar = async (target: StarItem) => {
    if (pendingUnstarsRef.current.has(target.starSk)) return;
    pendingUnstarsRef.current.add(target.starSk);
    setError(null);
    setItems((prev) => prev.filter((s) => s.starSk !== target.starSk));

    try {
      await unstarItem(target.feedId, target.itemSk);
    } catch (err: unknown) {
      setItems((prev) => {
        if (prev.some((s) => s.starSk === target.starSk)) return prev;
        return [...prev, target].sort((a, b) => b.starredAt.localeCompare(a.starredAt));
      });
      if ((err as { name?: string })?.name === "AuthExpiredError") {
        onAuthError();
        return;
      }
      setError((err as { message?: string })?.message || "Could not remove star.");
    } finally {
      pendingUnstarsRef.current.delete(target.starSk);
    }
  };

  return (
    <div className="view-wrap">
      <header className="view-header">
        <div>
          <h1 className="view-title">Starred</h1>
          <p className="view-subtitle">Saved articles and daily digest highlights.</p>
        </div>
      </header>

      {error && (
        <div className="banner banner-error">
          <span>{error}</span>
          <button type="button" className="btn-link" onClick={() => void loadInitial()}>
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="loading-state">Loading starred items…</div>
      ) : items.length === 0 ? (
        <section className="empty-card">
          <h2>No starred items yet</h2>
          <p>Click the ★ button on any feed item or Mox digest to save it here.</p>
        </section>
      ) : (
        <>
          <ul className="star-list">
            {items.map((star) => {
              const archiveHref = buildFeedPath(star.feedId, star.day);
              const host = extractHost(star.link);
              return (
                <li key={star.starSk} className="entry-card">
                  <header className="entry-header">
                    <div className="entry-title-wrap">
                      <div className="feed-top">
                        <span className={`kind-badge kind-${star.feedKind}`}>{star.feedKind}</span>
                        <a
                          href={archiveHref}
                          className="meta-link"
                          onClick={(e) => {
                            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                            e.preventDefault();
                            onOpenArchive(star.feedId, star.day);
                          }}
                        >
                          {star.feedTitle}
                        </a>
                        <span className="mono-meta">{star.day}</span>
                      </div>

                      <h2 className="entry-title">
                        {star.link && isSafeHref(star.link) ? (
                          <a href={star.link} target="_blank" rel="noopener noreferrer">
                            {star.title}
                          </a>
                        ) : (
                          <a
                            href={archiveHref}
                            onClick={(e) => {
                              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                              e.preventDefault();
                              onOpenArchive(star.feedId, star.day);
                            }}
                          >
                            {star.title}
                          </a>
                        )}
                      </h2>
                    </div>

                    <button
                      type="button"
                      className="star-btn is-starred"
                      aria-pressed={true}
                      aria-label={`Unstar ${star.title}`}
                      title="Remove star"
                      onClick={() => void handleUnstar(star)}
                    >
                      ★
                    </button>
                  </header>

                  {star.snippet && <p className="entry-summary">{star.snippet}</p>}

                  <div className="star-footer">
                    <span className="feed-meta-inline">
                      Starred {formatRelativeTime(star.starredAt)}
                      {host ? ` · ${host}` : ""}
                    </span>
                    <a
                      href={archiveHref}
                      className="btn-link"
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                        e.preventDefault();
                        onOpenArchive(star.feedId, star.day);
                      }}
                    >
                      View in archive →
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>

          {cursor && (
            <div className="load-more-wrap">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void handleLoadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load older stars"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default StarredView;
