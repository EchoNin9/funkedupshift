import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowsClockwise,
  PencilSimple,
  PushPin,
  Star,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import { Alert } from "../../components/Alert";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
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
import { FeedModal } from "./FeedModal";
import { useFeedsContext } from "./FeedsLayout";
import { SafeHtml } from "./SafeHtml";
import { isSafeHref } from "./sanitizeHtml";

const COLLAPSE_THRESHOLD = 2600;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidDayString(raw: string | null | undefined): boolean {
  if (!raw || !DAY_RE.test(raw)) return false;
  const match = DAY_RE.exec(raw);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function buildFeedPath(feedId: string, day?: string | null): string {
  const base = `/feeds/feed/${encodeURIComponent(feedId)}`;
  if (day && isValidDayString(day)) {
    return `${base}/${day}`;
  }
  return base;
}

function isAuthExpired(err: unknown): boolean {
  return (err as { name?: string } | null | undefined)?.name === "AuthExpiredError";
}

export function FeedDayView() {
  const { feedId, day } = useParams<{ feedId: string; day?: string }>();
  if (!feedId) {
    return <Navigate to="/feeds" replace />;
  }
  return <FeedDayViewInner key={feedId} feedId={feedId} routeDay={day ?? null} />;
}

interface FeedDayViewInnerProps {
  feedId: string;
  routeDay: string | null;
}

function FeedDayViewInner({ feedId, routeDay: rawDay }: FeedDayViewInnerProps) {
  const navigate = useNavigate();
  const {
    feeds,
    userTz,
    togglePin,
    refreshFeed,
    renameFeed,
    deleteFeed,
    handleFeedUpdated,
    handleAuthError,
  } = useFeedsContext();

  const routeDay = rawDay && isValidDayString(rawDay) ? rawDay : null;
  const knownFeed = feeds.find((f) => f.feedId === feedId) ?? null;

  const [feed, setFeed] = useState<Feed | null>(knownFeed);
  const [days, setDays] = useState<DaySummary[]>([]);
  const [daysCursor, setDaysCursor] = useState<string | null>(null);
  const [daysLoading, setDaysLoading] = useState(true);
  const [loadingMoreDays, setLoadingMoreDays] = useState(false);

  const [items, setItems] = useState<FeedItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<"days" | "items" | "action" | null>(null);
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

  const renameInputId = useId();
  const mountedRef = useRef(true);
  const activeEpochRef = useRef(0);
  const daysReqIdRef = useRef(0);
  const itemsReqIdRef = useRef(0);
  const refreshReqIdRef = useRef(0);
  const routeDayRef = useRef(routeDay);
  routeDayRef.current = routeDay;
  const pendingStarsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    mountedRef.current = true;
    activeEpochRef.current += 1;
    return () => {
      mountedRef.current = false;
      activeEpochRef.current += 1;
    };
  }, []);

  useEffect(() => {
    setFeed((prev) => {
      if (knownFeed && knownFeed.feedId === feedId) {
        return prev && prev.feedId === feedId ? { ...prev, ...knownFeed } : knownFeed;
      }
      return prev && prev.feedId === feedId ? prev : null;
    });
  }, [knownFeed, feedId]);

  const selectDay = useCallback(
    (day: string, replace?: boolean) => {
      if (!feedId) return;
      navigate(buildFeedPath(feedId, day), { replace: !!replace });
    },
    [feedId, navigate]
  );

  const loadDays = useCallback(async () => {
    if (!feedId) return null;
    const epoch = activeEpochRef.current;
    const reqId = ++daysReqIdRef.current;
    setDaysLoading(true);
    setError(null);
    setErrorSource(null);
    try {
      const page = await listDays(feedId);
      if (
        !mountedRef.current ||
        activeEpochRef.current !== epoch ||
        daysReqIdRef.current !== reqId
      ) {
        return null;
      }
      setDays(page.days);
      setDaysCursor(page.nextCursor);
      return page.days;
    } catch (err: unknown) {
      if (
        !mountedRef.current ||
        activeEpochRef.current !== epoch ||
        daysReqIdRef.current !== reqId
      ) {
        return null;
      }
      if (isAuthExpired(err)) {
        handleAuthError();
        return null;
      }
      setError((err as { message?: string })?.message || "Failed to load feed days.");
      setErrorSource("days");
      return null;
    } finally {
      if (
        mountedRef.current &&
        activeEpochRef.current === epoch &&
        daysReqIdRef.current === reqId
      ) {
        setDaysLoading(false);
      }
    }
  }, [feedId, handleAuthError]);

  const loadItems = useCallback(
    async (targetDay: string) => {
      if (!feedId || !targetDay) return;
      const epoch = activeEpochRef.current;
      const reqId = ++itemsReqIdRef.current;
      setItemsLoading(true);
      setStarError(null);
      setError(null);
      setErrorSource(null);

      try {
        const res = await getDayItems(feedId, targetDay);
        if (
          !mountedRef.current ||
          activeEpochRef.current !== epoch ||
          itemsReqIdRef.current !== reqId
        ) {
          return;
        }
        setFeed(res.feed);
        handleFeedUpdated(res.feed);
        setItems(res.items);
      } catch (err: unknown) {
        if (
          !mountedRef.current ||
          activeEpochRef.current !== epoch ||
          itemsReqIdRef.current !== reqId
        ) {
          return;
        }
        if (isAuthExpired(err)) {
          handleAuthError();
          return;
        }
        setError((err as { message?: string })?.message || "Failed to load day items.");
        setErrorSource("items");
      } finally {
        if (
          mountedRef.current &&
          activeEpochRef.current === epoch &&
          itemsReqIdRef.current === reqId
        ) {
          setItemsLoading(false);
        }
      }
    },
    [feedId, handleFeedUpdated, handleAuthError]
  );

  useEffect(() => {
    if (!feedId) return;
    setDays([]);
    setItems([]);
    setExpandedItems({});
    setRefreshNote(null);
    void loadDays();

    return () => {
      daysReqIdRef.current += 1;
    };
  }, [feedId, loadDays]);

  useEffect(() => {
    if (!routeDay && !daysLoading && days.length > 0) {
      selectDay(days[0].day, true);
    }
  }, [routeDay, daysLoading, days, selectDay]);

  useEffect(() => {
    if (!feedId || !routeDay) {
      itemsReqIdRef.current += 1;
      setItems([]);
      setItemsLoading(false);
      return;
    }
    void loadItems(routeDay);

    return () => {
      itemsReqIdRef.current += 1;
    };
  }, [feedId, routeDay, loadItems]);

  const handleLoadMoreDays = async () => {
    if (!daysCursor || loadingMoreDays) return;
    const epoch = activeEpochRef.current;
    const daysReqId = daysReqIdRef.current;
    setLoadingMoreDays(true);
    try {
      const next = await listDays(feedId, daysCursor);
      if (
        !mountedRef.current ||
        activeEpochRef.current !== epoch ||
        daysReqIdRef.current !== daysReqId
      ) {
        return;
      }
      setDays((prev) => {
        const seen = new Set(prev.map((d) => d.day));
        return [...prev, ...next.days.filter((d) => !seen.has(d.day))];
      });
      setDaysCursor(next.nextCursor);
    } catch (err: unknown) {
      if (
        !mountedRef.current ||
        activeEpochRef.current !== epoch ||
        daysReqIdRef.current !== daysReqId
      ) {
        return;
      }
      if (isAuthExpired(err)) {
        handleAuthError();
        return;
      }
      setError((err as { message?: string })?.message || "Failed to load older days.");
      setErrorSource("action");
    } finally {
      if (mountedRef.current && activeEpochRef.current === epoch) {
        setLoadingMoreDays(false);
      }
    }
  };

  const handleRefreshNow = async () => {
    if (!feed || feed.kind === "push" || refreshing) return;
    const epoch = activeEpochRef.current;
    const refreshReqId = ++refreshReqIdRef.current;
    const dayAtStart = routeDayRef.current;
    setRefreshing(true);
    setRefreshNote(null);
    setError(null);
    setErrorSource(null);
    try {
      const res = await refreshFeed(feed, { suppressLayoutError: true });
      if (
        !mountedRef.current ||
        activeEpochRef.current !== epoch ||
        refreshReqIdRef.current !== refreshReqId ||
        !res
      ) {
        return;
      }
      setFeed(res.feed);
      setRefreshNote(
        res.itemsAdded > 0
          ? `+${res.itemsAdded} new ${res.itemsAdded === 1 ? "item" : "items"}`
          : "Up to date"
      );
      const freshDays = await loadDays();
      if (
        !mountedRef.current ||
        activeEpochRef.current !== epoch ||
        refreshReqIdRef.current !== refreshReqId
      ) {
        return;
      }
      const targetDay = routeDayRef.current || freshDays?.[0]?.day || null;
      if (targetDay) {
        if (targetDay !== routeDayRef.current) {
          selectDay(targetDay, true);
        } else {
          const refreshedDay = await getDayItems(feedId, targetDay);
          if (
            !mountedRef.current ||
            activeEpochRef.current !== epoch ||
            refreshReqIdRef.current !== refreshReqId ||
            (routeDayRef.current && routeDayRef.current !== targetDay)
          ) {
            return;
          }
          if (!dayAtStart || routeDayRef.current === dayAtStart) {
            setFeed(refreshedDay.feed);
            setItems(refreshedDay.items);
          }
        }
      }
    } catch (err: unknown) {
      if (
        !mountedRef.current ||
        activeEpochRef.current !== epoch ||
        refreshReqIdRef.current !== refreshReqId
      ) {
        return;
      }
      if (isAuthExpired(err)) {
        handleAuthError();
        return;
      }
      setError((err as { message?: string })?.message || "Feed refresh failed.");
      setErrorSource("action");
    } finally {
      if (
        mountedRef.current &&
        activeEpochRef.current === epoch &&
        refreshReqIdRef.current === refreshReqId
      ) {
        setRefreshing(false);
      }
    }
  };

  const handleToggleStar = async (targetItem: FeedItem) => {
    if (pendingStarsRef.current.has(targetItem.itemSk)) return;
    const epoch = activeEpochRef.current;
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
      if (!mountedRef.current || activeEpochRef.current !== epoch) return;
      setItems((prev) =>
        prev.map((it) =>
          it.itemSk === targetItem.itemSk ? { ...it, starred: targetItem.starred } : it
        )
      );
      if (isAuthExpired(err)) {
        handleAuthError();
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

  const chipBtnClass = `inline-flex min-h-[32px] items-center gap-1 rounded-ds-sm border border-[color:var(--color-divider)] bg-surface-1 px-2.5 py-1 text-xs font-semibold text-text-secondary transition-colors hover:border-[color:var(--color-border-strong)] hover:bg-surface-3 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`;

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/feeds"
          className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-ds-sm px-1 text-sm font-semibold text-accent-text hover:underline ${focusRing}`}
        >
          <ArrowLeft size={15} weight="bold" aria-hidden="true" />
          <span>All feeds</span>
        </Link>
      </div>

      {feed && (
        <header className="flex flex-col gap-3 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 break-words [overflow-wrap:anywhere] font-display text-xl font-semibold text-text-primary sm:text-2xl">
                {feed.title}
              </h2>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide ${
                  feed.kind === "push"
                    ? "border-accent/25 bg-accent/15 text-accent-text"
                    : "border-[color:var(--color-divider)] bg-surface-3 text-text-secondary"
                }`}
              >
                {feed.kind}
              </span>
              {refreshNote && (
                <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
                  {refreshNote}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
              {feed.kind === "push" ? (
                <span className="min-w-0 [overflow-wrap:anywhere] font-mono text-[11px] text-text-tertiary">
                  slug: {feed.slug}
                </span>
              ) : (
                <>
                  {feed.siteUrl && isSafeHref(feed.siteUrl) && (
                    <a
                      href={feed.siteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-1 font-medium text-accent-text hover:underline ${focusRing} rounded-sm`}
                    >
                      <span>{extractHost(feed.siteUrl) || feed.siteUrl}</span>
                      <ArrowUpRight size={12} weight="bold" aria-hidden="true" />
                    </a>
                  )}
                  {feed.url && (
                    <span className="font-mono text-[11px] text-text-tertiary">
                      {extractHost(feed.url)}
                    </span>
                  )}
                </>
              )}
              <span>
                {feed.kind === "push" ? "Last push " : "Fetched "}
                {formatRelativeTime(feed.lastFetchedAt)}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:justify-end">
            <button
              type="button"
              className={
                feed.pinned
                  ? `inline-flex min-h-[32px] items-center gap-1 rounded-ds-sm border border-accent/40 bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent-text transition-colors hover:bg-accent/25 ${focusRing}`
                  : chipBtnClass
              }
              aria-pressed={feed.pinned}
              onClick={() => {
                const epoch = activeEpochRef.current;
                if (errorSource === "action") {
                  setError(null);
                  setErrorSource(null);
                }
                void togglePin(feed, { suppressLayoutError: true }).then((errMsg) => {
                  if (!mountedRef.current || activeEpochRef.current !== epoch) return;
                  if (errMsg) {
                    setError(errMsg);
                    setErrorSource("action");
                  }
                });
              }}
            >
              <PushPin size={13} weight={feed.pinned ? "fill" : "regular"} aria-hidden="true" />
              <span>{feed.pinned ? "Pinned" : "Pin"}</span>
            </button>
            {feed.kind !== "push" && (
              <button
                type="button"
                className={chipBtnClass}
                onClick={() => void handleRefreshNow()}
                disabled={refreshing}
              >
                <ArrowsClockwise
                  size={13}
                  weight="bold"
                  className={refreshing ? "motion-safe:animate-spin" : ""}
                  aria-hidden="true"
                />
                <span>{refreshing ? "Refreshing…" : "Refresh now"}</span>
              </button>
            )}
            <button
              type="button"
              className={chipBtnClass}
              onClick={() => {
                setRenameError(null);
                setRenameVal(feed.title);
                setRenameOpen(true);
              }}
            >
              <PencilSimple size={13} weight="regular" aria-hidden="true" />
              <span>Rename</span>
            </button>
            <button
              type="button"
              className={`inline-flex min-h-[32px] items-center gap-1 rounded-ds-sm border border-danger/35 bg-surface-1 px-2.5 py-1 text-xs font-semibold text-danger transition-colors hover:bg-danger/10 ${focusRing}`}
              onClick={() => {
                setDeleteError(null);
                setDeleteOpen(true);
              }}
            >
              <Trash size={13} weight="regular" aria-hidden="true" />
              <span>Delete</span>
            </button>
          </div>
        </header>
      )}

      {feed?.lastError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/60 bg-warning/10 px-3 py-2 text-sm text-warning"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 [overflow-wrap:anywhere]">
            <Warning size={16} weight="fill" className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              Last fetch failed: {feed.lastError}
            </span>
          </span>
          {feed.kind !== "push" && (
            <button
              type="button"
              className={`font-semibold underline underline-offset-2 hover:opacity-80 ${focusRing} rounded-sm`}
              onClick={() => void handleRefreshNow()}
            >
              Retry fetch
            </button>
          )}
        </div>
      )}

      {error && (
        <Alert variant="error" className="flex flex-wrap items-center justify-between gap-2">
          <span>{error}</span>
          {(days.length === 0 || errorSource === "days" || (errorSource === "items" && routeDay)) && (
            <button
              type="button"
              className="font-semibold underline underline-offset-2 hover:opacity-80"
              onClick={() => {
                if (days.length === 0 || errorSource === "days") {
                  void loadDays();
                } else if (errorSource === "items" && routeDay) {
                  void loadItems(routeDay);
                }
              }}
            >
              Retry
            </button>
          )}
        </Alert>
      )}

      {starError && <Alert variant="error">{starError}</Alert>}

      <section
        className="flex flex-col gap-2.5 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-1 p-3 sm:flex-row sm:items-center sm:justify-between"
        aria-label="Archive days"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1 scrollbar-thin sm:pb-0">
          {days.map((d) => {
            const chip = formatDayChip(d.day, tz);
            const active = d.day === routeDay;
            return (
              <Link
                key={d.day}
                to={buildFeedPath(feedId, d.day)}
                aria-current={active ? "date" : undefined}
                className={`flex shrink-0 flex-col rounded-ds-md border px-3 py-1.5 text-left transition-colors ${focusRing} ${
                  active
                    ? "border-accent bg-accent text-on-accent"
                    : "border-[color:var(--color-divider)] bg-surface-2 text-text-secondary hover:border-[color:var(--color-border-strong)] hover:bg-surface-3 hover:text-text-primary"
                }`}
              >
                <span className="text-xs font-semibold leading-tight">{chip.primary}</span>
                <span
                  className={`font-mono text-[11px] leading-tight ${
                    active ? "text-on-accent/85" : "text-text-tertiary"
                  }`}
                >
                  {chip.secondary} · {d.count}
                </span>
              </Link>
            );
          })}
          {daysCursor && (
            <button
              type="button"
              className={`${chipBtnClass} shrink-0`}
              onClick={() => void handleLoadMoreDays()}
              disabled={loadingMoreDays}
            >
              {loadingMoreDays ? "Loading…" : "Older days →"}
            </button>
          )}
        </div>

        <label className="w-full shrink-0 sm:w-auto">
          <span className="sr-only">Jump to date</span>
          <input
            type="date"
            aria-label="Jump to date"
            value={routeDay || ""}
            onChange={(e) => {
              const val = e.target.value;
              if (isValidDayString(val)) {
                selectDay(val);
              }
            }}
            className="input feeds-date-input !min-h-[36px] w-full !py-1.5 text-xs sm:!w-auto"
          />
        </label>
      </section>

      {daysLoading && days.length === 0 ? (
        <div
          className="flex min-h-[24vh] items-center justify-center rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-8 text-sm text-text-secondary"
          role="status"
        >
          Loading archive days…
        </div>
      ) : !error && days.length === 0 && !routeDay ? (
        <section className="space-y-2 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <h3 className="font-display text-lg font-semibold text-text-primary">No items yet</h3>
          {feed?.kind === "push" ? (
            <p className="m-0 text-sm text-text-secondary">
              This push archive is ready. Send summaries to{" "}
              <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-xs text-text-primary">
                POST /feeds/ingest
              </code>{" "}
              with{" "}
              <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-xs text-text-primary">
                {`{"feed": "${feed.slug}"}`}
              </code>{" "}
              and your API key from Settings.
            </p>
          ) : (
            <p className="m-0 text-sm text-text-secondary">
              No entries have been archived for this feed yet. Try refreshing now or wait for the
              next hourly poll.
            </p>
          )}
        </section>
      ) : routeDay ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-lg font-semibold text-text-primary">
              {formatDayHeading(routeDay)}
            </h3>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className={chipBtnClass}
                disabled={!newerDay}
                onClick={() => newerDay && selectDay(newerDay)}
              >
                ← Newer day
              </button>
              <button
                type="button"
                className={chipBtnClass}
                disabled={!olderDay}
                onClick={() => olderDay && selectDay(olderDay)}
              >
                Older day →
              </button>
            </div>
          </div>

          {itemsLoading ? (
            <div
              className="flex min-h-[24vh] items-center justify-center rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-8 text-sm text-text-secondary"
              role="status"
            >
              Loading entries for {routeDay}…
            </div>
          ) : items.length === 0 ? (
            <section className="space-y-3 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
              <h4 className="font-display text-base font-semibold text-text-primary">
                No items on {routeDay}
              </h4>
              <p className="m-0 text-sm text-text-secondary">
                Nothing was published or archived on this date.
              </p>
              {days.length > 0 && (
                <button
                  type="button"
                  className={buttonClasses("primary", "sm")}
                  onClick={() => selectDay(days[0].day)}
                >
                  Jump to latest active day ({days[0].day})
                </button>
              )}
            </section>
          ) : (
            <div className="space-y-4">
              {items.map((item) => {
                const singleDayDigest = items.length === 1;
                const isVeryLong = !singleDayDigest && item.contentHtml.length > COLLAPSE_THRESHOLD;
                const isExpanded = !!expandedItems[item.itemSk];
                const collapsed = isVeryLong && !isExpanded;
                const itemHost = extractHost(item.link);
                const timeStr = formatItemTime(item.publishedAt, tz);

                return (
                  <article
                    key={item.itemSk}
                    className="rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-4 sm:p-5"
                  >
                    <header className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <h4 className="break-words [overflow-wrap:anywhere] font-display text-lg font-semibold leading-snug text-text-primary">
                          {item.link && isSafeHref(item.link) ? (
                            <a
                              href={item.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`hover:text-accent-text hover:underline ${focusRing} rounded-sm`}
                            >
                              {item.title}
                            </a>
                          ) : (
                            item.title
                          )}
                        </h4>
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-text-secondary">
                          {timeStr && <span>{timeStr}</span>}
                          {item.author && (
                            <span className="min-w-0 [overflow-wrap:anywhere]">by {item.author}</span>
                          )}
                          {itemHost && (
                            <span className="font-mono text-[11px] text-text-tertiary">
                              {itemHost}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        aria-pressed={item.starred}
                        aria-label={item.starred ? `Unstar ${item.title}` : `Star ${item.title}`}
                        title={item.starred ? "Remove star" : "Star item"}
                        onClick={() => void handleToggleStar(item)}
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-ds-md border transition-colors ${focusRing} ${
                          item.starred
                            ? "border-warning/40 bg-warning/15 text-warning hover:bg-warning/25"
                            : "border-[color:var(--color-divider)] bg-surface-1 text-text-tertiary hover:border-[color:var(--color-border-strong)] hover:bg-surface-3 hover:text-text-primary"
                        }`}
                      >
                        <Star
                          size={17}
                          weight={item.starred ? "fill" : "regular"}
                          aria-hidden="true"
                        />
                      </button>
                    </header>

                    {item.contentHtml ? (
                      <div
                        className={
                          collapsed ? "feeds-entry-body-wrap is-collapsed" : "feeds-entry-body-wrap"
                        }
                      >
                        <SafeHtml html={item.contentHtml} className="feeds-entry-body" />
                      </div>
                    ) : item.summary ? (
                      <p className="mt-3 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-text-secondary">
                        {item.summary}
                      </p>
                    ) : null}

                    {isVeryLong && (
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        className={`mt-2.5 inline-flex items-center text-xs font-semibold text-accent-text hover:underline ${focusRing} rounded-sm`}
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

      <FeedModal
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
          className="flex flex-col gap-3.5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!feed) return;
            const t = renameVal.trim();
            if (!t) {
              setRenameError("Title cannot be blank.");
              return;
            }
            if (t.length > 120) {
              setRenameError("Title must be 120 characters or fewer.");
              return;
            }
            const epoch = activeEpochRef.current;
            setRenameSaving(true);
            setRenameError(null);
            try {
              await renameFeed(feed, t);
              if (mountedRef.current && activeEpochRef.current === epoch) {
                setFeed((prev) => (prev ? { ...prev, title: t } : prev));
                setRenameOpen(false);
              }
            } catch (err: unknown) {
              if (mountedRef.current && activeEpochRef.current === epoch) {
                setRenameError((err as { message?: string })?.message || "Could not rename feed.");
              }
            } finally {
              if (mountedRef.current && activeEpochRef.current === epoch) {
                setRenameSaving(false);
              }
            }
          }}
        >
          <div className="field">
            <label htmlFor={renameInputId}>Feed title</label>
            <input
              id={renameInputId}
              type="text"
              maxLength={120}
              className="input"
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              disabled={renameSaving}
              data-autofocus=""
              autoFocus
              required
            />
          </div>
          {renameError && <Alert variant="error">{renameError}</Alert>}
          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              className={buttonClasses("secondary", "md")}
              onClick={() => {
                setRenameError(null);
                setRenameOpen(false);
              }}
              disabled={renameSaving}
            >
              Cancel
            </button>
            <button type="submit" className={buttonClasses("primary", "md")} disabled={renameSaving}>
              {renameSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </FeedModal>

      <FeedModal
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
        <p className="m-0 text-sm text-text-secondary [overflow-wrap:anywhere]">
          Delete <strong className="text-text-primary [overflow-wrap:anywhere]">{feed?.title}</strong> and its archived
          items? Any items you starred remain in Starred.
        </p>
        {deleteError && <Alert variant="error">{deleteError}</Alert>}
        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            className={buttonClasses("secondary", "md")}
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
            className={`inline-flex items-center justify-center gap-2 rounded-ds-md bg-danger px-3.5 py-2 text-sm font-semibold text-on-danger transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
            onClick={async () => {
              if (!feed) return;
              const epoch = activeEpochRef.current;
              setDeleteSaving(true);
              setDeleteError(null);
              try {
                const deleted = await deleteFeed(feed);
                if (deleted && mountedRef.current && activeEpochRef.current === epoch) {
                  setDeleteOpen(false);
                }
              } catch (err: unknown) {
                if (mountedRef.current && activeEpochRef.current === epoch) {
                  setDeleteError(
                    (err as { message?: string })?.message || "Could not delete feed."
                  );
                }
              } finally {
                if (mountedRef.current && activeEpochRef.current === epoch) {
                  setDeleteSaving(false);
                }
              }
            }}
            disabled={deleteSaving}
          >
            {deleteSaving ? "Deleting…" : "Delete feed"}
          </button>
        </div>
      </FeedModal>
    </div>
  );
}

export default FeedDayView;
