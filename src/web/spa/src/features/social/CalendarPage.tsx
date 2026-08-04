import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  CalendarDaysIcon,
  Squares2X2Icon,
  ListBulletIcon,
} from "@heroicons/react/24/outline";
import { Alert, SkeletonCard } from "../../components";
import { listPosts, type SocialPost } from "./api";
import { MonthGrid } from "./MonthGrid";
import { DayList } from "./DayList";
import { PostDetail } from "./PostDetail";
import {
  addDaysLocal,
  addMonthsLocal,
  formatDayLabel,
  formatMonthLabel,
  localDayKey,
  monthKeyFromDate,
  parseDayKey,
} from "./dateUtils";

type ViewMode = "month" | "day";

const VIEW_OPTIONS: { value: ViewMode; label: string; icon: typeof Squares2X2Icon }[] = [
  { value: "month", label: "Month", icon: Squares2X2Icon },
  { value: "day", label: "Day", icon: ListBulletIcon },
];

function parseView(raw: string | null): ViewMode {
  return raw === "day" ? "day" : "month";
}

/** Falls back to today for a missing or malformed `?date=` param — never crashes. */
function parseDate(raw: string | null): Date {
  if (!raw) return new Date();
  return parseDayKey(raw) ?? new Date();
}

export default function CalendarPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const view = parseView(searchParams.get("view"));
  const date = useMemo(() => parseDate(searchParams.get("date")), [searchParams]);
  const dateKey = useMemo(() => localDayKey(date), [date]);
  const monthKey = useMemo(() => monthKeyFromDate(date), [date]);

  // Month-keyed cache so switching between Month and Day within the same month doesn't refetch.
  const [postsByMonth, setPostsByMonth] = useState<Record<string, SocialPost[]>>({});
  const cachedMonthsRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (cachedMonthsRef.current.has(monthKey) || inFlightRef.current.has(monthKey)) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    inFlightRef.current.add(monthKey);

    listPosts(monthKey)
      .then((posts) => {
        if (cancelled) return;
        cachedMonthsRef.current.add(monthKey);
        setPostsByMonth((prev) => ({ ...prev, [monthKey]: posts }));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load scheduled posts.");
        setPostsByMonth((prev) => ({ ...prev, [monthKey]: [] }));
      })
      .finally(() => {
        inFlightRef.current.delete(monthKey);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // reloadTick forces a refetch (e.g. after a post mutation) by clearing the cache below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey, reloadTick]);

  const posts = postsByMonth[monthKey] ?? [];

  const dayPosts = useMemo(() => {
    if (view !== "day") return [];
    return posts.filter((p) => {
      const ms = Date.parse(p.scheduledAt);
      return !Number.isNaN(ms) && localDayKey(new Date(ms)) === dateKey;
    });
  }, [posts, view, dateKey]);

  const setViewAndDate = useCallback(
    (nextView: ViewMode, nextDate: Date) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("view", nextView);
        next.set("date", localDayKey(nextDate));
        return next;
      });
    },
    [setSearchParams]
  );

  const handleViewChange = useCallback((nextView: ViewMode) => setViewAndDate(nextView, date), [date, setViewAndDate]);

  const handlePrev = useCallback(() => {
    if (view === "month") setViewAndDate("month", addMonthsLocal(date, -1));
    else setViewAndDate("day", addDaysLocal(date, -1));
  }, [view, date, setViewAndDate]);

  const handleNext = useCallback(() => {
    if (view === "month") setViewAndDate("month", addMonthsLocal(date, 1));
    else setViewAndDate("day", addDaysLocal(date, 1));
  }, [view, date, setViewAndDate]);

  const handleToday = useCallback(() => setViewAndDate(view, new Date()), [view, setViewAndDate]);

  const handleSelectDay = useCallback((day: Date) => setViewAndDate("day", day), [setViewAndDate]);

  const handleChanged = useCallback(() => {
    // Invalidate the currently-needed month and refetch.
    cachedMonthsRef.current.delete(monthKey);
    setReloadTick((t) => t + 1);
  }, [monthKey]);

  const headerLabel = useMemo(() => {
    if (view === "month") return formatMonthLabel(monthKey);
    return formatDayLabel(date);
  }, [view, date, monthKey]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <motion.h1
          className="text-2xl font-semibold tracking-tight text-text-primary flex items-center gap-2"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <CalendarDaysIcon className="h-6 w-6 text-accent" />
          Social Scheduler
        </motion.h1>
        <Link
          to="/social/compose"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 transition-colors shrink-0"
        >
          <PlusIcon className="h-4 w-4" />
          New post
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePrev}
            aria-label={`Previous ${view}`}
            className="inline-flex items-center justify-center rounded-lg border border-border-hover bg-surface-2 p-1.5 text-text-primary hover:bg-surface-3 transition-colors"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleNext}
            aria-label={`Next ${view}`}
            className="inline-flex items-center justify-center rounded-lg border border-border-hover bg-surface-2 p-1.5 text-text-primary hover:bg-surface-3 transition-colors"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleToday}
            className="ml-1 rounded-lg border border-border-hover bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-3 transition-colors"
          >
            Today
          </button>
        </div>

        <h2 className="text-sm font-semibold text-text-primary">{headerLabel}</h2>

        <div
          role="group"
          aria-label="Calendar view"
          className="inline-flex items-center rounded-lg border border-border-hover bg-surface-2 p-0.5"
        >
          {VIEW_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => handleViewChange(value)}
              aria-pressed={view === value}
              aria-label={`${label} view`}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                view === value
                  ? "bg-accent-500 text-white"
                  : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {loading ? (
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <SkeletonCard key={i} imageHeight="h-20" lines={1} showPills={false} />
          ))}
        </div>
      ) : (
        <>
          {view === "month" && (
            <MonthGrid
              monthKey={monthKey}
              posts={posts}
              onSelectPost={(p) => setSelectedPostId(p.postId)}
              onSelectDay={handleSelectDay}
            />
          )}
          {view === "day" && <DayList posts={dayPosts} onSelectPost={(p) => setSelectedPostId(p.postId)} />}

          {view === "month" && posts.length === 0 && (
            <p className="text-sm text-text-tertiary text-center py-4">
              No posts scheduled this month —{" "}
              <Link to="/social/compose" className="text-nav hover:underline">
                create one
              </Link>
              .
            </p>
          )}
        </>
      )}

      {selectedPostId && (
        <PostDetail postId={selectedPostId} onClose={() => setSelectedPostId(null)} onChanged={handleChanged} />
      )}
    </div>
  );
}
