import React, { useMemo } from "react";
import type { SocialPost } from "./api";
import { statusMeta } from "./statusStyles";
import { platformMeta } from "./platformStyles";
import { buildMonthGrid, formatLocalTime, isSameLocalDay, localDayKey, WEEKDAY_LABELS } from "./dateUtils";

const MAX_CHIPS_PER_DAY = 3;

interface MonthGridProps {
  monthKey: string;
  posts: SocialPost[];
  onSelectPost: (post: SocialPost) => void;
  /** Fired when a day cell (number, empty space, or "+N more") is clicked — the caller switches to Day view for this date. */
  onSelectDay: (date: Date) => void;
}

/** Hand-rolled Monday-start month calendar. No date/calendar library. */
export function MonthGrid({ monthKey, posts, onSelectPost, onSelectDay }: MonthGridProps) {
  const weeks = useMemo(() => buildMonthGrid(monthKey), [monthKey]);

  const postsByDay = useMemo(() => {
    const map = new Map<string, SocialPost[]>();
    for (const post of posts) {
      const ms = Date.parse(post.scheduledAt);
      if (Number.isNaN(ms)) continue;
      const key = localDayKey(new Date(ms));
      const bucket = map.get(key);
      if (bucket) bucket.push(post);
      else map.set(key, [post]);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
    }
    return map;
  }, [posts]);

  const today = new Date();
  const { month: currentMonth } = useMemo(() => {
    const [, m] = monthKey.split("-").map(Number);
    return { month: (m || 1) - 1 };
  }, [monthKey]);

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-xl border border-border-default bg-surface-1">
      <div className="grid grid-cols-7 border-b border-border-default bg-surface-2/60 text-center">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="py-2 text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 min-w-0">
        {weeks.flatMap((week, wi) =>
          week.map((day, di) => {
            const dayKey = localDayKey(day);
            const dayPosts = postsByDay.get(dayKey) ?? [];
            const inMonth = day.getMonth() === currentMonth;
            const isToday = isSameLocalDay(day, today);
            const overflow = dayPosts.length - MAX_CHIPS_PER_DAY;

            return (
              <div
                key={`${wi}-${di}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelectDay(day)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectDay(day);
                  }
                }}
                aria-label={`View agenda for ${day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`}
                className={`min-w-0 min-h-[6.5rem] sm:min-h-[7.5rem] border-b border-r border-border-subtle p-1 sm:p-1.5 flex flex-col gap-1 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-inset hover:bg-surface-2/60 transition-colors ${
                  inMonth ? "bg-surface-1" : "bg-surface-1/40"
                }`}
              >
                <div
                  className={`self-start text-[11px] font-medium leading-none px-1.5 py-0.5 rounded-full ${
                    isToday
                      ? "bg-accent-500 text-white"
                      : inMonth
                      ? "text-text-secondary"
                      : "text-text-tertiary/60"
                  }`}
                >
                  {day.getDate()}
                </div>

                <div className="flex flex-col gap-0.5 min-w-0">
                  {dayPosts.slice(0, MAX_CHIPS_PER_DAY).map((post) => {
                    const meta = statusMeta(post.status);
                    const targets = post.targets ?? [];
                    const account = targets[0];
                    const plat = platformMeta(account?.platform);
                    const accountLabel = account
                      ? targets.length > 1
                        ? `${account.accountId} +${targets.length - 1}`
                        : account.accountId
                      : "";
                    return (
                      <button
                        key={post.postId}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectPost(post);
                        }}
                        title={post.text}
                        className={`min-w-0 flex items-center gap-1 rounded border px-1 py-0.5 text-left text-[10px] sm:text-[11px] leading-tight hover:brightness-110 transition-[filter] ${meta.chip}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${meta.dot}`} />
                        {account && (
                          <span
                            title={plat.label}
                            className={`shrink-0 rounded px-0.5 text-[8px] font-bold leading-tight text-white ${plat.dot}`}
                          >
                            {plat.short}
                          </span>
                        )}
                        <span className="truncate shrink-0">{formatLocalTime(post.scheduledAt)}</span>
                        {accountLabel && <span className="truncate min-w-0 text-text-tertiary">{accountLabel}</span>}
                      </button>
                    );
                  })}
                  {overflow > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectDay(day);
                      }}
                      aria-label={`Show ${overflow} more post${overflow === 1 ? "" : "s"} on ${day.toLocaleDateString()}`}
                      className="w-full rounded px-1 py-0.5 text-left text-[10px] text-text-tertiary hover:text-text-primary hover:bg-surface-3 transition-colors"
                    >
                      +{overflow} more
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
