import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsClockwise,
  FilmStrip,
  Image as ImageIcon,
  Microphone,
  ShieldCheck,
  VideoCamera,
  XCircle,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { Alert } from "../../components";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { FormCard } from "../../components/FormCard";
import { IconButton } from "../../components/IconButton";
import { ListCard, ListEmpty } from "../../components/ListCard";
import {
  ApiError,
  createJob,
  getBudget,
  isTerminalStatus,
  listJobs,
  presignMedia,
  uploadFileToS3,
  type CreateJobInput,
  type LipsyncBudget,
  type LipsyncJob,
  type LipsyncJobStatus,
  type LipsyncMode,
  type MediaKind,
} from "./api";
import {
  DEFAULT_MODELS,
  MODE_META,
  estimateCostCents,
  modelLabel,
  modelMeta,
  modelsForMode,
} from "./statusStyles";
import { formatDateTime, formatExpiry, isExpiringSoon } from "./dateUtils";
import { formatCents, formatCentsRemaining } from "./money";
import { BudgetSummary } from "./BudgetSummary";
import { JobDetail } from "./JobDetail";
import { LipsyncAiTag, LipsyncModeTag, LipsyncStatusTag } from "./LipsyncTags";
import { LipsyncSegmented } from "./LipsyncSegmented";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_DURATION_SEC = 20;
const PAGE_SIZE = 20;

// Background poll cadence for the job list — matches the runner's fastest
// backoff step (15s, see docs/lipsync-design.md's Backoff section) so the UI
// doesn't lag noticeably behind what's actually happening server-side.
const POLL_INTERVAL_MS = 15000;

const MODE_OPTIONS: { value: LipsyncMode; label: string; icon: PhosphorIcon }[] = [
  { value: "avatar", label: "Avatar", icon: ImageIcon },
  { value: "relip", label: "Re-lip", icon: FilmStrip },
];

// Shared control styling (select / textarea) — same tokens as IconTextField, without the leading icon.
const controlClass = `w-full rounded-ds-md border border-border-default bg-surface-0 px-3 text-[15px] text-text-primary placeholder:text-text-tertiary hover:border-border-hover motion-safe:transition-colors motion-safe:duration-150 disabled:opacity-60 ${focusRing}`;

/** Labelled form row. With `htmlFor` the label targets that control; without it the row is an aria-labelled group (upload slots, consent). */
function Field({
  label,
  required,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  const labelId = React.useId();
  const text = (
    <>
      {label}
      {required && <span className="ml-0.5 text-accent-text" aria-hidden="true">*</span>}
    </>
  );
  const cls = "mb-1.5 block text-[13px] font-semibold text-text-primary";
  return htmlFor ? (
    <div>
      <label htmlFor={htmlFor} className={cls}>{text}</label>
      {children}
    </div>
  ) : (
    <div role="group" aria-labelledby={labelId}>
      <span id={labelId} className={cls}>{text}</span>
      {children}
    </div>
  );
}

const STATUS_FILTER_OPTIONS: { value: "" | LipsyncJobStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "queued", label: "Queued" },
  { value: "submitting", label: "Submitting" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

interface UploadItem {
  file: File;
  previewUrl: string;
  status: "uploading" | "uploaded" | "error";
  progress: number;
  key?: string;
  error?: string;
  /** Audio only — best-effort, set when readable. */
  durationSec?: number;
}

/**
 * Best-effort audio duration read via a detached (never DOM-mounted) Audio
 * object — mirrors features/social/ComposerPage.tsx::readImageDimensions.
 * Never rejects: an unreadable duration resolves undefined so the caller
 * treats it as "unknown" rather than blocking the pick.
 */
async function readAudioDuration(file: File): Promise<number | undefined> {
  if (!file.type.startsWith("audio/")) return undefined;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const finish = (duration: number | undefined) => {
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : undefined);
    audio.onerror = () => finish(undefined);
    audio.src = url;
  });
}

interface UploadSlotProps {
  kindLabel: string;
  icon: PhosphorIcon;
  accept: string;
  item: UploadItem | null;
  inputRef: React.RefObject<HTMLInputElement>;
  onFile: (file: File) => void;
  onRemove: () => void;
  onRetry: () => void;
}

function UploadSlot({ kindLabel, icon: Icon, accept, item, inputRef, onFile, onRemove, onRetry }: UploadSlotProps) {
  const isAudio = item?.file.type.startsWith("audio/");
  const isVideo = item?.file.type.startsWith("video/");
  return (
    <div>
      {/* Always mounted — a conditionally-rendered file input based on state
          the async upload handler itself sets can silently no-op the first
          pick (see CLAUDE.md gotcha #4). Hidden via CSS instead. */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        aria-label={`Choose ${kindLabel} file`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
      {!item ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`${buttonClasses("secondary", "md")} w-full border-dashed sm:w-auto`}
        >
          <Icon size={18} weight="regular" aria-hidden="true" />
          Choose {kindLabel}
        </button>
      ) : (
        <div className="flex flex-wrap items-start gap-3 rounded-ds-md border border-[color:var(--color-divider)] bg-surface-0 p-2.5 sm:flex-nowrap">
          {isVideo && (
            <video
              src={item.previewUrl}
              controls
              muted
              playsInline
              preload="metadata"
              className="h-20 w-28 shrink-0 rounded-ds-sm border border-[color:var(--color-divider)] bg-surface-3 object-cover"
            />
          )}
          {!isAudio && !isVideo && (
            <img
              src={item.previewUrl}
              alt={item.file.name}
              className="h-20 w-28 shrink-0 rounded-ds-sm border border-[color:var(--color-divider)] object-cover"
            />
          )}
          <div className="min-w-0 flex-1 basis-[160px] space-y-1 pt-0.5">
            <p className="truncate text-[13px] font-semibold text-text-primary" title={item.file.name}>{item.file.name}</p>
            <p className="text-xs text-text-secondary">
              {formatBytes(item.file.size)}
              {item.durationSec != null ? ` · ${item.durationSec.toFixed(1)}s` : ""}
            </p>
            {isAudio && item.status !== "error" && (
              <audio src={item.previewUrl} controls className="h-8 w-full max-w-[16rem]" />
            )}
            {item.status === "uploading" && (
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
                role="progressbar"
                aria-label={`Uploading ${kindLabel}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={item.progress}
              >
                <div className="h-full bg-accent motion-safe:transition-[width]" style={{ width: `${item.progress}%` }} />
              </div>
            )}
            {item.status === "uploaded" && <p className="text-xs font-semibold text-success">Uploaded</p>}
            {item.status === "error" && (
              <p role="alert" className="break-words text-xs font-semibold text-danger">{item.error}</p>
            )}
          </div>
          <div className="ml-auto flex shrink-0 gap-1.5">
            {item.status === "error" && (
              <IconButton
                icon={<ArrowsClockwise size={16} weight="regular" aria-hidden="true" />}
                label="Retry upload"
                onClick={onRetry}
              />
            )}
            <IconButton
              icon={<XCircle size={16} weight="regular" aria-hidden="true" />}
              label={`Remove ${kindLabel}`}
              onClick={onRemove}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function JobCard({ job, onSelect }: { job: LipsyncJob; onSelect: () => void }) {
  const expiring = isExpiringSoon(job.expiresAt);
  return (
    <div role="listitem">
      <button
        type="button"
        onClick={onSelect}
        className={`block w-full space-y-1.5 px-4 py-3.5 text-left hover:bg-surface-3/50 motion-safe:transition-colors motion-safe:duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent`}
      >
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <LipsyncModeTag mode={job.mode} />
            <LipsyncStatusTag status={job.status} />
          </div>
          <LipsyncAiTag />
        </div>
        <p className="text-[15px] font-bold text-text-primary">{modelLabel(job.model)}</p>
        <p className="text-xs text-text-secondary">
          Created {formatDateTime(job.createdAt)} ·{" "}
          <span className={expiring ? "font-semibold text-warning" : ""}>Expires {formatExpiry(job.expiresAt)}</span>
        </p>
        {job.status === "failed" && job.error && <p className="break-words text-[13px] text-danger">{job.error}</p>}
      </button>
    </div>
  );
}

export default function LipsyncPage() {
  /* ── Create form state ──────────────────────────────────────────── */
  const [mode, setMode] = useState<LipsyncMode>("avatar");
  const [model, setModel] = useState<string>(DEFAULT_MODELS.avatar);
  const [prompt, setPrompt] = useState("");
  const [imageItem, setImageItem] = useState<UploadItem | null>(null);
  const [videoItem, setVideoItem] = useState<UploadItem | null>(null);
  const [audioItem, setAudioItem] = useState<UploadItem | null>(null);
  const [consentAttested, setConsentAttested] = useState(false);
  const [generalErrors, setGeneralErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const modelOptions = useMemo(() => modelsForMode(mode), [mode]);
  const selectedModelMeta = modelMeta(model);
  const promptRequired = selectedModelMeta?.promptRequired ?? false;

  // Mode owns model (each mode has its own valid model set) -- switching
  // modes always resets to that mode's default so a relip model can never
  // stay selected on an avatar job or vice versa. Any prompt is cleared too
  // if the new model doesn't accept one, so a value the field no longer even
  // shows can't be silently carried into the next submit.
  const changeMode = useCallback((newMode: LipsyncMode) => {
    setMode(newMode);
    const nextModel = DEFAULT_MODELS[newMode];
    setModel(nextModel);
    if (!modelMeta(nextModel)?.acceptsPrompt) setPrompt("");
  }, []);

  const changeModel = useCallback((newModel: string) => {
    setModel(newModel);
    if (!modelMeta(newModel)?.acceptsPrompt) setPrompt("");
  }, []);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // Revoke object URLs on unmount.
  useEffect(() => {
    return () => {
      if (imageItem) URL.revokeObjectURL(imageItem.previewUrl);
      if (videoItem) URL.revokeObjectURL(videoItem.previewUrl);
      if (audioItem) URL.revokeObjectURL(audioItem.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Budget ──────────────────────────────────────────────────────── */
  const [budget, setBudget] = useState<LipsyncBudget | null>(null);
  const [budgetLoading, setBudgetLoading] = useState(true);
  const [budgetError, setBudgetError] = useState<string | null>(null);

  const loadBudget = useCallback(async () => {
    setBudgetLoading(true);
    setBudgetError(null);
    try {
      const data = await getBudget();
      setBudget(data);
    } catch (err) {
      // A brand-new user can have no budget record at all, which the API
      // may surface as a 404 -- treat that the same as a zero budget rather
      // than an error (docs/lipsync-design.md: "no budget record at all,
      // which means $0"). Any other failure degrades gracefully: the rest
      // of the page still renders, see BudgetSummary's error state.
      if (err instanceof ApiError && err.status === 404) {
        setBudget({ budgetCents: 0, spentCents: 0, reservedCents: 0, remainingCents: 0 });
      } else {
        setBudgetError(err instanceof Error ? err.message : "Could not load your budget.");
      }
    } finally {
      setBudgetLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBudget();
  }, [loadBudget]);

  // Estimated cost for the currently-picked model + audio duration -- UX
  // only, mirrors the backend's documented formula (see estimateCostCents's
  // docstring). Needs a readable audio duration, which is only known once
  // pickAudio's best-effort probe resolves.
  const estimateCents = useMemo(
    () => estimateCostCents(model, audioItem?.durationSec),
    [model, audioItem?.durationSec]
  );

  // Blocks submit outright once we know for certain it can't fit -- either
  // no budget at all (remaining <= 0, independent of whether we have an
  // estimate yet) or a known estimate that exceeds what's left. Stays false
  // (does not block) whenever the answer is merely unknown -- e.g. the
  // budget fetch failed, or duration hasn't been read yet -- since the
  // server is the real gate either way and a false block would be worse UX
  // than an occasional server-side 400.
  const noBudget = budget != null && budget.remainingCents <= 0;
  const overBudget = noBudget || (budget != null && estimateCents != null && estimateCents > budget.remainingCents);

  /* ── Job list state ─────────────────────────────────────────────── */
  const [jobs, setJobs] = useState<LipsyncJob[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | LipsyncJobStatus>("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setListError(null);
    listJobs({ status: statusFilter || undefined, limit: PAGE_SIZE })
      .then((resp) => {
        if (cancelled) return;
        setJobs(resp.jobs);
        setCursor(resp.cursor);
      })
      .catch((err) => {
        if (cancelled) return;
        setListError(err instanceof Error ? err.message : "Could not load clips.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [statusFilter, reloadTick]);

  const handleChanged = useCallback(() => setReloadTick((t) => t + 1), []);

  // Load-more pagination collapses back to page one on the next background
  // poll -- acceptable at this feature's expected volume (~40 clips/month
  // per docs/lipsync-design.md), and keeps the poll a single cheap request.
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const resp = await listJobs({ status: statusFilter || undefined, limit: PAGE_SIZE, cursor });
      setJobs((prev) => [...prev, ...resp.jobs]);
      setCursor(resp.cursor);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not load more clips.");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, statusFilter]);

  const hasLivework = useMemo(() => jobs.some((j) => !isTerminalStatus(j.status)), [jobs]);

  // Refetch when the tab regains focus.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") handleChanged();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [handleChanged]);

  // Poll only while a job is in flight AND the tab is visible.
  useEffect(() => {
    if (!hasLivework) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") handleChanged();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [hasLivework, handleChanged]);

  /* ── Uploads ─────────────────────────────────────────────────────── */

  // Guards every state patch with `prev.file === item.file` so a slow upload
  // that's since been replaced (user picked a different file for the same
  // slot) or removed can't clobber the current slot with stale data.
  const runUpload = useCallback(
    async (kind: MediaKind, item: UploadItem, setItem: React.Dispatch<React.SetStateAction<UploadItem | null>>) => {
      setItem((prev) =>
        prev && prev.file === item.file ? { ...prev, status: "uploading", progress: 0, error: undefined } : prev
      );
      try {
        const presign = await presignMedia({ filename: item.file.name, contentType: item.file.type, kind });
        await uploadFileToS3(presign.uploadUrl, item.file, item.file.type, (fraction) =>
          setItem((prev) => (prev && prev.file === item.file ? { ...prev, progress: Math.round(fraction * 100) } : prev))
        );
        setItem((prev) =>
          prev && prev.file === item.file ? { ...prev, status: "uploaded", key: presign.key, progress: 100 } : prev
        );
      } catch (err) {
        setItem((prev) =>
          prev && prev.file === item.file
            ? { ...prev, status: "error", error: err instanceof Error ? err.message : "Upload failed." }
            : prev
        );
      }
    },
    []
  );

  const pickImage = useCallback(
    (file: File) => {
      const previousUrl = imageItem?.previewUrl;
      if (file.size > MAX_IMAGE_BYTES) {
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        setImageItem({
          file,
          previewUrl: URL.createObjectURL(file),
          status: "error",
          progress: 0,
          error: `Image must be ≤10MB (this file is ${formatBytes(file.size)}).`,
        });
        return;
      }
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      const item: UploadItem = { file, previewUrl: URL.createObjectURL(file), status: "uploading", progress: 0 };
      setImageItem(item);
      runUpload("image", item, setImageItem);
    },
    [imageItem, runUpload]
  );

  const pickVideo = useCallback(
    (file: File) => {
      const previousUrl = videoItem?.previewUrl;
      if (file.size > MAX_VIDEO_BYTES) {
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        setVideoItem({
          file,
          previewUrl: URL.createObjectURL(file),
          status: "error",
          progress: 0,
          error: `Video must be ≤100MB (this file is ${formatBytes(file.size)}).`,
        });
        return;
      }
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      const item: UploadItem = { file, previewUrl: URL.createObjectURL(file), status: "uploading", progress: 0 };
      setVideoItem(item);
      runUpload("video", item, setVideoItem);
    },
    [videoItem, runUpload]
  );

  const pickAudio = useCallback(
    async (file: File) => {
      // Captured up front; only revoked right before it's actually replaced
      // on screen so the still-displayed preview never points at a dead URL
      // during the async duration read below.
      const previousUrl = audioItem?.previewUrl;

      if (file.size > MAX_AUDIO_BYTES) {
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        setAudioItem({
          file,
          previewUrl: URL.createObjectURL(file),
          status: "error",
          progress: 0,
          error: `Audio must be ≤20MB (this file is ${formatBytes(file.size)}).`,
        });
        return;
      }

      const duration = await readAudioDuration(file);
      if (duration != null && duration > MAX_AUDIO_DURATION_SEC) {
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        setAudioItem({
          file,
          previewUrl: URL.createObjectURL(file),
          status: "error",
          progress: 0,
          error: `Audio is ${Math.round(duration)}s — must be ≤20s.`,
          durationSec: duration,
        });
        return;
      }

      if (previousUrl) URL.revokeObjectURL(previousUrl);
      const item: UploadItem = {
        file,
        previewUrl: URL.createObjectURL(file),
        status: "uploading",
        progress: 0,
        durationSec: duration,
      };
      setAudioItem(item);
      runUpload("audio", item, setAudioItem);
    },
    [audioItem, runUpload]
  );

  const resetForm = useCallback(() => {
    if (imageItem) URL.revokeObjectURL(imageItem.previewUrl);
    if (videoItem) URL.revokeObjectURL(videoItem.previewUrl);
    if (audioItem) URL.revokeObjectURL(audioItem.previewUrl);
    setImageItem(null);
    setVideoItem(null);
    setAudioItem(null);
    setConsentAttested(false);
    setPrompt("");
    setGeneralErrors([]);
  }, [imageItem, videoItem, audioItem]);

  /* ── Submit ──────────────────────────────────────────────────────── */

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      setSubmitError(null);

      const errors: string[] = [];
      if (mode === "avatar" && !imageItem) errors.push("Add a portrait image.");
      if (mode === "relip" && !videoItem) errors.push("Add a source video.");
      if (!audioItem) errors.push("Add audio.");
      if ([imageItem, videoItem, audioItem].some((i) => i?.status === "uploading")) {
        errors.push("Wait for uploads to finish.");
      }
      if ([imageItem, videoItem, audioItem].some((i) => i?.status === "error")) {
        errors.push("Remove or retry the failed upload.");
      }
      if (!consentAttested) errors.push("Confirm you have the right to use this likeness.");
      // Mirrors the server rule (providers/fal.py's promptRequired, enforced
      // again in routes.createJob) -- this client-side copy is UX only, the
      // 400 the server would return either way is the real guard.
      if (promptRequired && !prompt.trim()) {
        errors.push(`${selectedModelMeta?.label ?? "This model"} requires a prompt.`);
      }
      // Same idea for budget: the button is already disabled once overBudget
      // is true, but a form can still submit via Enter, so check again here.
      // This is still UX only -- the server holds the real reservation check
      // and can 400 regardless (see the catch block below for how that
      // surfaces), this just avoids a pointless round trip when we already
      // know it can't fit.
      if (overBudget) {
        errors.push(
          noBudget
            ? "You have no lipsync budget — ask an admin to grant you one."
            : `Estimated cost (${formatCents(estimateCents)}) exceeds your remaining budget (${formatCentsRemaining(
                budget?.remainingCents
              )}).`
        );
      }

      setGeneralErrors(errors);
      if (errors.length > 0) return;

      setSubmitting(true);
      try {
        const payload: CreateJobInput = {
          mode,
          model,
          audioKey: audioItem!.key!,
          consentAttested,
          ...(mode === "avatar" ? { imageKey: imageItem!.key! } : { videoKey: videoItem!.key! }),
          ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
        };
        const created = await createJob(payload);
        resetForm();
        handleChanged();
        // Jump straight to the detail modal so progress is easy to watch.
        setSelectedJobId(created.jobId);
      } catch (err) {
        // The server's reservation check (docs/lipsync-design.md's "Reserve
        // → settle → release") can 400 here even when the client-side
        // estimate above said it fit -- estimates are approximate by design.
        // Surface whatever message it sent rather than a generic one.
        if (err instanceof ApiError && err.errors && err.errors.length) {
          setSubmitError(err.errors.join(" "));
        } else {
          setSubmitError(err instanceof Error ? err.message : "Could not create the job.");
        }
      } finally {
        setSubmitting(false);
        // Refresh regardless of outcome: a success moves cents into
        // reservedCents, and a budget-related failure means the displayed
        // remaining was already stale.
        loadBudget();
      }
    },
    [
      submitting,
      mode,
      model,
      prompt,
      promptRequired,
      selectedModelMeta,
      imageItem,
      videoItem,
      audioItem,
      consentAttested,
      overBudget,
      noBudget,
      estimateCents,
      budget,
      resetForm,
      handleChanged,
      loadBudget,
    ]
  );

  const modeInfo = MODE_META[mode];

  return (
    <div className="space-y-8">
      <h1 className="sr-only">Lipsync Studio</h1>

      <BudgetSummary budget={budget} loading={budgetLoading} error={budgetError} />

      <section className="max-w-2xl space-y-3" aria-labelledby="lipsync-create-heading">
        <h2 id="lipsync-create-heading" className="font-heading text-[20px] font-semibold text-text-primary">
          New clip
        </h2>
        {submitError && <Alert variant="error">{submitError}</Alert>}
        {generalErrors.length > 0 && (
          <Alert variant="error">
            <ul className="list-disc space-y-0.5 pl-4">
              {generalErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </Alert>
        )}

        <FormCard onSubmit={handleSubmit} className="space-y-5 !p-4 sm:!p-5">
          <Field label="Mode" required>
            <LipsyncSegmented
              label="Mode"
              value={mode}
              onChange={changeMode}
              options={MODE_OPTIONS.map(({ value, label, icon: Icon }) => ({
                value,
                label,
                icon: <Icon size={16} weight="regular" aria-hidden="true" />,
              }))}
            />
            <p className="mt-1.5 text-xs text-text-secondary">{modeInfo.hint}</p>
          </Field>

          <Field label="Model" required htmlFor="lipsync-model">
            <select
              id="lipsync-model"
              value={model}
              onChange={(e) => changeModel(e.target.value)}
              className={`${controlClass} min-h-12`}
            >
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} · {m.price}
                </option>
              ))}
            </select>
          </Field>

          {/* key forces a distinct instance per mode — without it React
              reconciles both branches as the same UploadSlot and the two
              inputRefs alias one reused DOM node. */}
          {mode === "avatar" ? (
            <Field key="image" label="Portrait image" required>
              <UploadSlot
                kindLabel="image"
                icon={ImageIcon}
                accept="image/png,image/jpeg,image/webp"
                item={imageItem}
                inputRef={imageInputRef}
                onFile={pickImage}
                onRemove={() => {
                  if (imageItem) URL.revokeObjectURL(imageItem.previewUrl);
                  setImageItem(null);
                }}
                onRetry={() => imageItem && runUpload("image", imageItem, setImageItem)}
              />
            </Field>
          ) : (
            <Field key="video" label="Source video" required>
              <UploadSlot
                kindLabel="video"
                icon={FilmStrip}
                accept="video/mp4,video/quicktime,video/webm"
                item={videoItem}
                inputRef={videoInputRef}
                onFile={pickVideo}
                onRemove={() => {
                  if (videoItem) URL.revokeObjectURL(videoItem.previewUrl);
                  setVideoItem(null);
                }}
                onRetry={() => videoItem && runUpload("video", videoItem, setVideoItem)}
              />
            </Field>
          )}

          <Field label="Audio" required>
            <UploadSlot
              kindLabel="audio"
              icon={Microphone}
              accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a"
              item={audioItem}
              inputRef={audioInputRef}
              onFile={pickAudio}
              onRemove={() => {
                if (audioItem) URL.revokeObjectURL(audioItem.previewUrl);
                setAudioItem(null);
              }}
              onRetry={() => audioItem && runUpload("audio", audioItem, setAudioItem)}
            />
            <p className="mt-1.5 text-xs text-text-secondary">Up to 20s. Longer clips are rejected by the server.</p>
          </Field>

          {estimateCents != null && (
            <div
              role="status"
              className={`rounded-ds-md border px-3.5 py-2.5 text-[13px] ${
                overBudget && !noBudget
                  ? "border-danger/60 bg-danger/10 text-danger"
                  : "border-[color:var(--color-divider)] bg-surface-0 text-text-secondary"
              }`}
            >
              <p>
                Estimated cost: <span className="font-semibold text-text-primary">~{formatCents(estimateCents)}</span>
                {selectedModelMeta && !selectedModelMeta.priceVerified && (
                  <span className="text-text-secondary"> — conservative estimate, this model's price isn't confirmed</span>
                )}
              </p>
              {budget && !noBudget && (
                <p className={overBudget ? "mt-1 font-semibold text-danger" : "mt-1 text-text-secondary"}>
                  {overBudget
                    ? `This exceeds your remaining budget of ${formatCentsRemaining(budget.remainingCents)}.`
                    : `You have ${formatCentsRemaining(budget.remainingCents)} remaining.`}
                </p>
              )}
            </div>
          )}

          {selectedModelMeta?.acceptsPrompt && (
            <Field label="Prompt" required={promptRequired} htmlFor="lipsync-prompt">
              <textarea
                id="lipsync-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                required={promptRequired}
                placeholder={
                  promptRequired
                    ? "Required for this model — describe the motion or scene…"
                    : "Optional — describe the motion or scene…"
                }
                className={`${controlClass} min-h-24 resize-y py-2.5`}
              />
              {promptRequired && (
                <p className="mt-1.5 text-xs text-text-secondary">{selectedModelMeta.label} requires a prompt.</p>
              )}
            </Field>
          )}

          <Field label="Likeness consent" required>
            <label className="flex min-h-10 cursor-pointer select-none items-start gap-2.5 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={consentAttested}
                onChange={(e) => setConsentAttested(e.target.checked)}
                className={`mt-0.5 h-5 w-5 shrink-0 rounded-ds-sm accent-[rgb(var(--color-accent))] ${focusRing}`}
              />
              <span className="inline-flex items-start gap-1.5">
                <ShieldCheck size={18} weight="regular" aria-hidden="true" className="shrink-0 text-accent-text" />
                I have the right to use this likeness
              </span>
            </label>
          </Field>

          <div className="pt-1">
            <button
              type="submit"
              disabled={submitting || !consentAttested || (promptRequired && !prompt.trim()) || overBudget}
              title={overBudget ? "This clip's estimated cost doesn't fit your remaining budget." : undefined}
              className={`${buttonClasses("primary", "lg")} w-full sm:w-auto`}
            >
              <VideoCamera size={18} weight="regular" aria-hidden="true" />
              {submitting ? "Submitting…" : "Generate clip"}
            </button>
          </div>
        </FormCard>
      </section>

      <section aria-labelledby="lipsync-clips-heading">
        <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <h2 id="lipsync-clips-heading" className="font-heading text-[20px] font-semibold text-text-primary">
            Clips
          </h2>
          <span className="tag tag-neutral">{jobs.length}</span>
          <div className="flex items-center gap-2 sm:ml-auto">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "" | LipsyncJobStatus)}
              aria-label="Filter by status"
              className={`${controlClass} min-h-10 w-auto py-0 text-sm`}
            >
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <IconButton
              icon={
                <ArrowsClockwise
                  size={16}
                  weight="regular"
                  aria-hidden="true"
                  className={hasLivework ? "motion-safe:animate-spin [animation-duration:3s]" : ""}
                />
              }
              label="Refresh clips"
              onClick={handleChanged}
              className="!h-10 !w-10"
            />
          </div>
        </div>

        {listError && <Alert variant="error" className="mb-3">{listError}</Alert>}

        <ListCard aria-busy={loading} role="list">
          {loading ? (
            [0, 1, 2].map((i) => (
              <div key={i} role="listitem" className="px-4 py-3.5">
                <div className="space-y-2 motion-safe:animate-pulse">
                  <div className="h-4 w-48 max-w-full rounded bg-surface-3" />
                  <div className="h-3 w-72 max-w-full rounded bg-surface-3" />
                </div>
              </div>
            ))
          ) : jobs.length === 0 ? (
            <div role="listitem"><ListEmpty>No clips yet — create one above to get started.</ListEmpty></div>
          ) : (
            jobs.map((job) => <JobCard key={job.jobId} job={job} onSelect={() => setSelectedJobId(job.jobId)} />)
          )}
        </ListCard>

        {cursor && (
          <div className="pt-3">
            <button type="button" onClick={loadMore} disabled={loadingMore} className={buttonClasses("secondary", "md")}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </section>

      {selectedJobId && (
        <JobDetail jobId={selectedJobId} onClose={() => setSelectedJobId(null)} onChanged={handleChanged} />
      )}
    </div>
  );
}
