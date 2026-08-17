import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  SparklesIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { Alert, useClickOutside } from "../../components";
import { cancelJob, getJob, getJobOutputUrl, isTerminalStatus, type LipsyncJob } from "./api";
import { MODE_META, statusMeta } from "./statusStyles";
import { formatDateTime, formatExpiry, isExpiringSoon } from "./dateUtils";

// Background poll cadence — matches the runner's fastest backoff step (15s,
// see docs/lipsync-design.md's Backoff section) so the modal doesn't lag
// noticeably behind what's actually happening server-side.
const POLL_INTERVAL_MS = 15000;

interface JobDetailProps {
  jobId: string;
  onClose: () => void;
  /** Called after a mutation (cancel) that should refresh the list behind the modal. */
  onChanged: () => void;
}

/** Modal showing a single job's live status and, once completed, video playback + download. */
export function JobDetail({ jobId, onClose, onChanged }: JobDetailProps) {
  const [job, setJob] = useState<LipsyncJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputError, setOutputError] = useState<string | null>(null);
  const [outputLoading, setOutputLoading] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  useClickOutside(dialogRef, onClose, true);

  const fetchJob = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const data = await getJob(jobId);
        setJob(data);
        // Clear any earlier transient error once a refresh succeeds, silent or not.
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load this clip.");
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [jobId]
  );

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const isTerminal = job ? isTerminalStatus(job.status) : false;

  // Refetch when the tab regains focus — costs nothing while away, covers
  // coming back to check on a clip. No point once the job is terminal.
  useEffect(() => {
    if (isTerminal) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchJob({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchJob, isTerminal]);

  // Poll only while the job is non-terminal AND the tab is visible. Stops on
  // terminal status and on unmount — mirrors CalendarPage.tsx's identical
  // hasLivework/interval pattern, applied to a single job instead of a list.
  useEffect(() => {
    if (isTerminal) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") fetchJob({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [isTerminal, fetchJob]);

  const loadOutputUrl = useCallback(async () => {
    setOutputLoading(true);
    setOutputError(null);
    try {
      const url = await getJobOutputUrl(jobId);
      setOutputUrl(url);
    } catch (err) {
      setOutputError(err instanceof Error ? err.message : "Could not load the video.");
    } finally {
      setOutputLoading(false);
    }
  }, [jobId]);

  // Fetch a playable URL as soon as the job is completed. The presigned URL
  // is only valid for 300s (see api.ts::getJobOutputUrl) -- if it goes stale
  // while this modal is still open, the <video> onError handler below offers
  // a manual reload rather than failing silently.
  useEffect(() => {
    if (job?.status === "completed" && !outputUrl && !outputLoading) {
      loadOutputUrl();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  const handleCancel = useCallback(async () => {
    if (!window.confirm("Cancel this clip? This can't be undone.")) return;
    setCancelling(true);
    setError(null);
    try {
      const result = await cancelJob(jobId);
      setJob((prev) => (prev ? { ...prev, status: result.status } : prev));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel this clip.");
    } finally {
      setCancelling(false);
    }
  }, [jobId, onChanged]);

  const expiring = job ? isExpiringSoon(job.expiresAt) : false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lipsync-job-detail-title"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg rounded-xl border border-border-hover bg-surface-2 shadow-xl max-h-[85vh] overflow-y-auto scrollbar-thin"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-default p-4">
          <h2
            id="lipsync-job-detail-title"
            className="text-lg font-display font-extrabold uppercase tracking-tight text-text-primary"
          >
            Clip detail
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

        <div className="space-y-4 p-4">
          {error && <Alert variant="error">{error}</Alert>}

          {loading && !job && (
            <div className="space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-surface-3" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-surface-3" />
              <div className="h-40 w-full animate-pulse rounded bg-surface-3" />
            </div>
          )}

          {job && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center rounded-full border border-border-hover px-2 py-0.5 text-xs font-medium text-text-secondary">
                  {MODE_META[job.mode]?.label ?? job.mode}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusMeta(job.status).badge}`}
                >
                  {statusMeta(job.status).label}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                  <SparklesIcon className="h-3 w-3" />
                  AI-generated
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <dt className="text-text-tertiary">Created</dt>
                <dd className="text-text-primary">{formatDateTime(job.createdAt)}</dd>
                <dt className="text-text-tertiary">Updated</dt>
                <dd className="text-text-primary">{formatDateTime(job.updatedAt)}</dd>
                <dt className="text-text-tertiary">Expires</dt>
                <dd className={expiring ? "text-amber-400" : "text-text-primary"}>{formatExpiry(job.expiresAt)}</dd>
                {typeof job.durationSec === "number" && (
                  <>
                    <dt className="text-text-tertiary">Duration</dt>
                    <dd className="text-text-primary">{job.durationSec.toFixed(1)}s</dd>
                  </>
                )}
              </dl>

              {!isTerminal && (
                <div className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-1 p-3 text-sm text-text-secondary">
                  <ArrowPathIcon className="h-4 w-4 shrink-0 animate-spin text-accent" />
                  Generating your clip — this can take a few minutes. This panel updates automatically.
                </div>
              )}

              {job.status === "failed" && (
                <Alert variant="error">
                  <span className="flex items-start gap-1.5">
                    <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
                    {job.error || "This clip failed to generate."}
                  </span>
                </Alert>
              )}

              {job.status === "cancelled" && <p className="text-sm text-text-tertiary">This clip was cancelled.</p>}

              {job.status === "completed" && (
                <div className="space-y-2">
                  {outputError ? (
                    <Alert variant="error">
                      <div className="space-y-2">
                        <p>{outputError}</p>
                        <button
                          type="button"
                          onClick={loadOutputUrl}
                          disabled={outputLoading}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border-hover bg-surface-2 px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-surface-3 transition-colors disabled:opacity-50"
                        >
                          <ArrowPathIcon className={`h-3.5 w-3.5 ${outputLoading ? "animate-spin" : ""}`} />
                          Reload video
                        </button>
                      </div>
                    </Alert>
                  ) : outputUrl ? (
                    <>
                      <video
                        src={outputUrl}
                        controls
                        playsInline
                        className="w-full rounded-lg border border-border-hover bg-black"
                        onError={() => setOutputError("The video link expired or failed to load.")}
                      />
                      <a
                        href={outputUrl}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md border border-border-hover bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-3 transition-colors"
                      >
                        <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                        Download
                      </a>
                    </>
                  ) : (
                    <p className="text-sm text-text-tertiary">Loading video…</p>
                  )}
                </div>
              )}

              {!isTerminal && (
                <div className="flex items-center gap-2 border-t border-border-default pt-3">
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-500/60 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                    {cancelling ? "Cancelling…" : "Cancel clip"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
