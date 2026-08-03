import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { Alert, useClickOutside } from "../../components";
import { deletePost, getPost, retryPost, type PostTarget, type SocialPostDetail } from "./api";
import { statusMeta } from "./statusStyles";
import { formatLocalDateTime, formatUtcLabel } from "./dateUtils";

interface PostDetailProps {
  postId: string;
  onClose: () => void;
  /** Called after any mutation (retry/cancel) that should refresh the calendar list. */
  onChanged: () => void;
}

/** Modal showing a post's per-target publish status, with retry/cancel actions. */
export function PostDetail({ postId, onClose, onChanged }: PostDetailProps) {
  const [detail, setDetail] = useState<SocialPostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useClickOutside(dialogRef, onClose, true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const post = await getPost(postId);
      setDetail(post);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this post.");
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleRetry = useCallback(
    async (target?: PostTarget) => {
      const key = target ? `${target.platform}:${target.accountId}` : "all";
      setBusyKey(key);
      setError(null);
      try {
        const result = await retryPost(postId, target ? { platform: target.platform, accountId: target.accountId } : undefined);
        setDetail(result.post);
        onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Retry failed.");
      } finally {
        setBusyKey(null);
      }
    },
    [postId, onChanged]
  );

  const handleCancel = useCallback(async () => {
    if (!window.confirm("Cancel this scheduled post? This can't be undone.")) return;
    setBusyKey("cancel");
    setError(null);
    try {
      const result = await deletePost(postId);
      setDetail(result.post);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel this post.");
    } finally {
      setBusyKey(null);
    }
  }, [postId, onChanged]);

  const failedCount = detail?.targets.filter((t) => t.status === "failed").length ?? 0;
  const parentMeta = detail ? statusMeta(detail.parent.status) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-detail-title"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg rounded-xl border border-border-hover bg-surface-2 shadow-xl max-h-[85vh] overflow-y-auto scrollbar-thin"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-default p-4">
          <h2 id="post-detail-title" className="text-lg font-display font-extrabold uppercase tracking-tight text-text-primary">
            Post detail
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-text-tertiary hover:bg-surface-3 hover:text-text-primary transition-colors"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {error && <Alert variant="error">{error}</Alert>}

          {loading && !detail && (
            <div className="space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-surface-3" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-surface-3" />
              <div className="h-16 w-full animate-pulse rounded bg-surface-3" />
            </div>
          )}

          {detail && (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  {parentMeta && (
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${parentMeta.badge}`}>
                      {parentMeta.label}
                    </span>
                  )}
                  <span className="text-xs text-text-tertiary">
                    {formatLocalDateTime(detail.parent.scheduledAt)} local ({formatUtcLabel(detail.parent.scheduledAt)})
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-text-primary">{detail.parent.text}</p>
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wider text-text-tertiary">
                  Targets ({detail.targets.length})
                </h3>
                <ul className="space-y-2">
                  {detail.targets.map((t) => {
                    const meta = statusMeta(t.status);
                    const key = `${t.platform}:${t.accountId}`;
                    return (
                      <li key={key} className="rounded-lg border border-border-default bg-surface-1 p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="min-w-0 flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-text-primary truncate">
                              {t.platform} · {t.accountId}
                            </span>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium shrink-0 ${meta.badge}`}>
                              {meta.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {t.permalink && (
                              <a
                                href={t.permalink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-nav hover:underline"
                              >
                                View <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                              </a>
                            )}
                            {t.status === "failed" && (
                              <button
                                type="button"
                                onClick={() => handleRetry(t)}
                                disabled={busyKey !== null}
                                className="inline-flex items-center gap-1 rounded-md border border-border-hover bg-surface-2 px-2 py-1 text-xs font-medium text-text-primary hover:bg-surface-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <ArrowPathIcon className={`h-3.5 w-3.5 ${busyKey === key ? "animate-spin" : ""}`} />
                                Retry
                              </button>
                            )}
                          </div>
                        </div>
                        {typeof t.attemptCount === "number" && (
                          <p className="text-xs text-text-tertiary">Attempts: {t.attemptCount}</p>
                        )}
                        {t.lastError && (
                          <p className="text-xs text-red-400 break-words">{t.lastError}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border-default">
                {failedCount > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRetry()}
                    disabled={busyKey !== null}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border-hover bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowPathIcon className={`h-3.5 w-3.5 ${busyKey === "all" ? "animate-spin" : ""}`} />
                    Retry all failed ({failedCount})
                  </button>
                )}
                {detail.parent.status === "pending" && (
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={busyKey !== null}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-500/60 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                    Cancel post
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
