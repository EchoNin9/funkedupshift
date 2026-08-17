import type { LipsyncJobStatus, LipsyncMode } from "./api";

/**
 * Compact colour + label metadata for job status badges.
 * Mirrors features/social/statusStyles.ts's shape and intent.
 */
export const STATUS_META: Record<LipsyncJobStatus, { label: string; badge: string }> = {
  queued: { label: "Queued", badge: "border-n3 text-n3" },
  submitting: { label: "Submitting", badge: "border-n2 text-n2" },
  processing: { label: "Processing", badge: "border-n4 text-n4" },
  completed: { label: "Completed", badge: "border-emerald-500 text-emerald-400" },
  failed: { label: "Failed", badge: "border-red-500 text-red-400" },
  // Deliberately the dullest badge in the set, same reasoning as social's
  // "cancelled" chip: a cancelled job is history and shouldn't compete with
  // live jobs for attention.
  cancelled: { label: "Cancelled", badge: "border-border-hover text-text-tertiary" },
};

export function statusMeta(status: LipsyncJobStatus) {
  return STATUS_META[status] ?? STATUS_META.queued;
}

/**
 * Static per-mode copy (label + one-line hint for the mode toggle). Model
 * identity and pricing used to live here too (one hardcoded string per
 * mode), back when the backend only ever offered one model per mode and
 * rejected any override. Now that `providers/fal.py::MODEL_CATALOG` offers
 * several models per mode, that display data has moved to MODEL_CATALOG
 * below, keyed by model id instead of mode -- see that constant.
 */
export const MODE_META: Record<LipsyncMode, { label: string; hint: string }> = {
  avatar: {
    label: "Avatar",
    hint: "Portrait image + audio → talking-head video.",
  },
  relip: {
    label: "Re-lip",
    hint: "Existing video + audio → re-synced lip movement.",
  },
};

/**
 * Mirrors the backend catalog (src/lambda/lipsync/providers/fal.py's
 * MODEL_CATALOG) for display purposes -- model ids here MUST match that
 * catalog's keys EXACTLY, since `id` is sent verbatim as CreateJobInput.model.
 * This is display/picker data only; the backend re-validates the model server
 * side regardless of what this list offers (routes.createJob never trusts the
 * client) -- see that module's docstring.
 *
 * Kept as a hand-synced mirror rather than fetched from the API: the create-
 * job contract is frozen at {mode, audioKey, imageKey?, videoKey?, model?,
 * prompt?, consentAttested} (docs/lipsync-design.md) with no catalog-listing
 * route, so there is nothing to fetch this from.
 *
 * `price` strings are INDICATIVE ONLY, not verified against a live fal
 * account -- same caveat as the backend catalog's comment. Where fal's own
 * pricing pages disagreed (VEED) the string says so; where no figure was
 * sourced at all, it says "not verified" rather than inventing one.
 */
export interface LipsyncModelMeta {
  mode: LipsyncMode;
  label: string;
  price: string;
  /** Whether this model has a prompt input at all -- false hides the prompt field entirely rather than showing one that would be silently ignored. */
  acceptsPrompt: boolean;
  promptRequired: boolean;
}

export const MODEL_CATALOG: Record<string, LipsyncModelMeta> = {
  "fal-ai/kling-video/ai-avatar/v2/pro": {
    mode: "avatar",
    label: "Kling Avatar v2 Pro",
    price: "~$0.115/s",
    acceptsPrompt: true,
    promptRequired: false,
  },
  "fal-ai/kling-video/ai-avatar/v2/standard": {
    mode: "avatar",
    label: "Kling Avatar v2 Standard",
    price: "not verified",
    acceptsPrompt: true,
    promptRequired: false,
  },
  "fal-ai/kling-video/v1/standard/ai-avatar": {
    mode: "avatar",
    label: "Kling Avatar v1 Standard",
    price: "not verified",
    acceptsPrompt: true,
    promptRequired: false,
  },
  "fal-ai/infinitalk": {
    mode: "avatar",
    label: "InfiniteTalk",
    price: "not verified",
    acceptsPrompt: true,
    promptRequired: true,
  },
  "veed/lipsync": {
    mode: "relip",
    label: "VEED Lipsync",
    price: "uncertain — sources disagree ($0.07/s vs $0.40/min)",
    acceptsPrompt: false,
    promptRequired: false,
  },
  "fal-ai/sync-lipsync/v2": {
    mode: "relip",
    label: "Sync Lipsync v2",
    price: "~$3/min",
    acceptsPrompt: false,
    promptRequired: false,
  },
  "fal-ai/latentsync": {
    mode: "relip",
    label: "LatentSync",
    price: "~$0.20 (clips up to 40s)",
    acceptsPrompt: false,
    promptRequired: false,
  },
  "fal-ai/musetalk": {
    mode: "relip",
    label: "MuseTalk",
    price: "not verified",
    acceptsPrompt: false,
    promptRequired: false,
  },
  "fal-ai/pixverse/lipsync": {
    mode: "relip",
    label: "PixVerse Lipsync",
    price: "~$0.04/s",
    acceptsPrompt: false,
    promptRequired: false,
  },
};

/** Same two defaults the backend falls back to when CreateJobInput carries no `model` (providers/fal.py's DEFAULT_MODELS). */
export const DEFAULT_MODELS: Record<LipsyncMode, string> = {
  avatar: "fal-ai/kling-video/ai-avatar/v2/pro",
  relip: "veed/lipsync",
};

/** Models valid for `mode`, in MODEL_CATALOG's declaration order -- what the create form's picker lists. */
export function modelsForMode(mode: LipsyncMode): Array<{ id: string } & LipsyncModelMeta> {
  return Object.entries(MODEL_CATALOG)
    .filter(([, meta]) => meta.mode === mode)
    .map(([id, meta]) => ({ id, ...meta }));
}

export function modelMeta(modelId: string | undefined): ({ id: string } & LipsyncModelMeta) | undefined {
  if (!modelId) return undefined;
  const meta = MODEL_CATALOG[modelId];
  return meta ? { id: modelId, ...meta } : undefined;
}

/** Human label for a job's model, falling back to the raw id for a job whose model isn't in this mirror (e.g. catalog drift, or the rare "unknown" edge case). */
export function modelLabel(modelId: string | undefined): string {
  if (!modelId) return "Unknown model";
  return MODEL_CATALOG[modelId]?.label ?? modelId;
}
