import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, CalendarDaysIcon } from "@heroicons/react/24/outline";
import { Alert, SkeletonCard } from "../../components";
import { listPosts, type SocialPost } from "./api";
import { MonthGrid } from "./MonthGrid";
import { PostDetail } from "./PostDetail";
import { formatMonthLabel, monthKeyFromDate, shiftMonthKey } from "./dateUtils";

export default function CalendarPage() {
  const [monthKey, setMonthKey] = useState(() => monthKeyFromDate(new Date()));
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);

  const load = useCallback(async (month: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listPosts(month);
      setPosts(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load scheduled posts.");
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(monthKey);
  }, [monthKey, load]);

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

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonthKey((m) => shiftMonthKey(m, -1))}
            aria-label="Previous month"
            className="inline-flex items-center justify-center rounded-lg border border-border-hover bg-surface-2 p-1.5 text-text-primary hover:bg-surface-3 transition-colors"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setMonthKey((m) => shiftMonthKey(m, 1))}
            aria-label="Next month"
            className="inline-flex items-center justify-center rounded-lg border border-border-hover bg-surface-2 p-1.5 text-text-primary hover:bg-surface-3 transition-colors"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setMonthKey(monthKeyFromDate(new Date()))}
            className="ml-1 rounded-lg border border-border-hover bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-3 transition-colors"
          >
            Today
          </button>
        </div>
        <h2 className="text-sm font-semibold text-text-primary">{formatMonthLabel(monthKey)}</h2>
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
          <MonthGrid monthKey={monthKey} posts={posts} onSelectPost={(p) => setSelectedPostId(p.postId)} />
          {posts.length === 0 && (
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
        <PostDetail
          postId={selectedPostId}
          onClose={() => setSelectedPostId(null)}
          onChanged={() => load(monthKey)}
        />
      )}
    </div>
  );
}
