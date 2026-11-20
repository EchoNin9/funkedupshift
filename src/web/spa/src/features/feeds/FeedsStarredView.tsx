import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Star } from "@phosphor-icons/react";
import { Alert } from "../../components/Alert";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { listStars, unstarItem, type StarItem } from "./api";
import { extractHost, formatRelativeTime } from "./dateFormat";
import { useFeedsContext } from "./FeedsLayout";
import { isSafeHref } from "./sanitizeHtml";

function isAuthExpired(err: unknown): boolean {
  return (err as { name?: string } | null | undefined)?.name === "AuthExpiredError";
}

function buildArchivePath(feedId: string, day: string): string {
  return `/feeds/feed/${encodeURIComponent(feedId)}/${encodeURIComponent(day)}`;
}

export const FeedsStarredView: React.FC = () => {
  const { handleAuthError } = useFeedsContext();

  const [items, setItems] = useState<StarItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingUnstarsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listStars();
      if (!mountedRef.current) return;
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      if (isAuthExpired(err)) {
        handleAuthError();
        return;
      }
      setError((err as { message?: string })?.message || "Failed to load starred items.");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [handleAuthError]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const handleLoadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await listStars(cursor);
      if (!mountedRef.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((s) => s.starSk));
        return [...prev, ...page.items.filter((s) => !seen.has(s.starSk))];
      });
      setCursor(page.nextCursor);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      if (isAuthExpired(err)) {
        handleAuthError();
        return;
      }
      setError((err as { message?: string })?.message || "Failed to load more stars.");
    } finally {
      if (mountedRef.current) setLoadingMore(false);
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
      if (!mountedRef.current) return;
      setItems((prev) => {
        if (prev.some((s) => s.starSk === target.starSk)) return prev;
        return [...prev, target].sort((a, b) => b.starredAt.localeCompare(a.starredAt));
      });
      if (isAuthExpired(err)) {
        handleAuthError();
        return;
      }
      setError((err as { message?: string })?.message || "Could not remove star.");
    } finally {
      pendingUnstarsRef.current.delete(target.starSk);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-semibold text-text-primary sm:text-2xl">
          Starred
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Saved articles and daily digest highlights.
        </p>
      </div>

      {error && (
        <Alert variant="error" className="flex flex-wrap items-center justify-between gap-2">
          <span>{error}</span>
          <button
            type="button"
            className="font-semibold underline underline-offset-2 hover:opacity-80"
            onClick={() => void loadInitial()}
          >
            Retry
          </button>
        </Alert>
      )}

      {loading ? (
        <div
          className="flex min-h-[24vh] items-center justify-center rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-8 text-sm text-text-secondary"
          role="status"
        >
          Loading starred items…
        </div>
      ) : items.length === 0 ? (
        <section className="space-y-2 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <h3 className="font-display text-lg font-semibold text-text-primary">
            No starred items yet
          </h3>
          <p className="m-0 text-sm text-text-secondary">
            Click the star button on any feed item or Mox digest to save it here.
          </p>
        </section>
      ) : (
        <>
          <ul className="space-y-3">
            {items.map((star) => {
              const archivePath = buildArchivePath(star.feedId, star.day);
              const host = extractHost(star.link);
              return (
                <li
                  key={star.starSk}
                  className="rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-4 sm:p-5"
                >
                  <header className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide ${
                            star.feedKind === "push"
                              ? "border-accent/25 bg-accent/15 text-accent-text"
                              : "border-[color:var(--color-divider)] bg-surface-3 text-text-secondary"
                          }`}
                        >
                          {star.feedKind}
                        </span>
                        <Link
                          to={archivePath}
                          className={`min-w-0 [overflow-wrap:anywhere] font-medium text-accent-text hover:underline ${focusRing} rounded-sm`}
                        >
                          {star.feedTitle}
                        </Link>
                        <span className="font-mono text-[11px] text-text-tertiary">
                          {star.day}
                        </span>
                      </div>

                      <h3 className="break-words [overflow-wrap:anywhere] font-display text-lg font-semibold leading-snug text-text-primary">
                        {star.link && isSafeHref(star.link) ? (
                          <a
                            href={star.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`hover:text-accent-text hover:underline ${focusRing} rounded-sm`}
                          >
                            {star.title}
                          </a>
                        ) : (
                          <Link
                            to={archivePath}
                            className={`hover:text-accent-text hover:underline ${focusRing} rounded-sm`}
                          >
                            {star.title}
                          </Link>
                        )}
                      </h3>
                    </div>

                    <button
                      type="button"
                      aria-pressed={true}
                      aria-label={`Unstar ${star.title}`}
                      title="Remove star"
                      onClick={() => void handleUnstar(star)}
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-ds-md border border-warning/40 bg-warning/15 text-warning transition-colors hover:bg-warning/25 ${focusRing}`}
                    >
                      <Star size={17} weight="fill" aria-hidden="true" />
                    </button>
                  </header>

                  {star.snippet && (
                    <p className="mt-2.5 min-w-0 [overflow-wrap:anywhere] text-sm text-text-secondary">
                      {star.snippet}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--color-divider)] pt-2.5 text-xs text-text-tertiary">
                    <span>
                      Starred {formatRelativeTime(star.starredAt)}
                      {host ? ` · ${host}` : ""}
                    </span>
                    <Link
                      to={archivePath}
                      className={`inline-flex items-center gap-1 font-semibold text-accent-text hover:underline ${focusRing} rounded-sm`}
                    >
                      <span>View in archive</span>
                      <ArrowRight size={13} weight="bold" aria-hidden="true" />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>

          {cursor && (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                className={buttonClasses("secondary", "md")}
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

export default FeedsStarredView;
