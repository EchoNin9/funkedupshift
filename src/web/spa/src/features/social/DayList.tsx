import React, { useMemo } from "react";
import { ArrowTopRightOnSquareIcon, PaperClipIcon } from "@heroicons/react/24/outline";
import type { SocialPost } from "./api";
import { statusMeta } from "./statusStyles";
import { platformMeta } from "./platformStyles";
import { formatLocalTime } from "./dateUtils";

interface DayListProps {
  posts: SocialPost[];
  onSelectPost: (post: SocialPost) => void;
}

/**
 * `SocialPost` (api.ts) doesn't declare a media field, but the backend item
 * does carry `mediaKeys` (see src/lambda/social/storage.py createPost /
 * routes.py listPosts, which spreads the raw parent item into the response).
 * api.ts is out of scope for this change, so this reads it defensively as an
 * optional runtime-only field rather than widening the shared type.
 */
type PostWithMedia = SocialPost & { mediaKeys?: unknown[] };

function mediaCountFor(post: SocialPost): number {
  const keys = (post as PostWithMedia).mediaKeys;
  return Array.isArray(keys) ? keys.length : 0;
}

/** Single-day agenda: every post for the day, in time order, with room for per-target detail. */
export function DayList({ posts, onSelectPost }: DayListProps) {
  const sorted = useMemo(
    () => [...posts].sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt)),
    [posts]
  );

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-border-default bg-surface-1 p-8 text-center">
        <p className="text-sm text-text-tertiary">No posts scheduled this day.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {sorted.map((post) => {
        const parentMeta = statusMeta(post.status);
        const targets = post.targets ?? [];
        const mediaCount = mediaCountFor(post);

        return (
          <li key={post.postId} className="card card-flat overflow-hidden">
            <button
              type="button"
              onClick={() => onSelectPost(post)}
              className="w-full text-left p-3 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 hover:bg-surface-3 transition-colors"
            >
              <div className="shrink-0 w-20 text-sm font-semibold text-text-primary">
                {formatLocalTime(post.scheduledAt)}
              </div>

              <div className="min-w-0 flex-1 space-y-1">
                <p className="whitespace-pre-wrap break-words text-sm text-text-primary">
                  {post.text || "(no text)"}
                </p>
                {mediaCount > 0 && (
                  <p className="inline-flex items-center gap-1 text-xs text-text-tertiary">
                    <PaperClipIcon className="h-3 w-3" />
                    {mediaCount} media item{mediaCount === 1 ? "" : "s"}
                  </p>
                )}
              </div>

              <span className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${parentMeta.badge}`}>
                {parentMeta.label}
              </span>
            </button>

            <ul className="space-y-1 px-3 pb-3">
              {targets.length === 0 && (
                <li className="text-xs text-text-tertiary px-1">No targets on this post.</li>
              )}
              {targets.map((t) => {
                const plat = platformMeta(t.platform);
                const tMeta = statusMeta(t.status);
                return (
                  <li
                    key={`${t.platform}:${t.accountId}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border-default bg-surface-1 px-2.5 py-1.5"
                  >
                    <span className="min-w-0 flex items-center gap-2">
                      <span title={plat.label} className={`shrink-0 rounded px-1 text-[9px] font-bold leading-tight text-white ${plat.dot}`}>
                        {plat.short}
                      </span>
                      <span className="truncate text-xs text-text-primary">{t.accountId}</span>
                      <span className={`shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${tMeta.badge}`}>
                        {tMeta.label}
                      </span>
                    </span>
                    {t.permalink && (
                      <a
                        href={t.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 inline-flex items-center gap-1 text-xs text-nav hover:underline"
                      >
                        View <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
