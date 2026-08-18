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
  /**
   * Display-only fields below, added for the "estimated cost before submit"
   * UX (docs/lipsync-design.md's "Cost estimation" section) -- NOT part of
   * the hand-synced id/mode/promptRequired contract test_lipsync_catalog_sync.py
   * enforces, so these are free to exist only on this side.
   *
   * `priceVerified` false means `price` above is either "not verified" (no
   * figure sourced at all) or a range fal's own docs disagree on (VEED) --
   * either way `pricePerSecCents`/`flatCents` below is a documented
   * *conservative* stand-in, not a real quote, and estimateCostCents()'s
   * callers are expected to say so rather than presenting false precision.
   */
  priceVerified: boolean;
  /** Rate used by estimateCostCents() below: `ceil(durationSec * pricePerSecCents)`. Omit when `flatCents` applies instead. */
  pricePerSecCents?: number;
  /** A flat per-clip price instead of a per-second rate (LatentSync bills one flat fee up to its 40s cap, comfortably above this module's 20s hard cap). */
  flatCents?: number;
}

export const MODEL_CATALOG: Record<string, LipsyncModelMeta> = {
  "fal-ai/kling-video/ai-avatar/v2/pro": {
    mode: "avatar",
    label: "Kling Avatar v2 Pro",
    price: "~$0.115/s",
    acceptsPrompt: true,
    promptRequired: false,
    priceVerified: true,
    pricePerSecCents: 11.5,
  },
  "fal-ai/kling-video/ai-avatar/v2/standard": {
    mode: "avatar",
    label: "Kling Avatar v2 Standard",
    price: "not verified",
    acceptsPrompt: true,
    promptRequired: false,
    // No sourced figure for this model -- conservative fallback equal to the
    // highest verified *avatar*-mode rate in this catalog (Kling v2 Pro,
    // 11.5c/s) so the estimate never reads lower than a model we do have a
    // real number for.
    priceVerified: false,
    pricePerSecCents: 11.5,
  },
  "fal-ai/kling-video/v1/standard/ai-avatar": {
    mode: "avatar",
    label: "Kling Avatar v1 Standard",
    price: "not verified",
    acceptsPrompt: true,
    promptRequired: false,
    priceVerified: false,
    pricePerSecCents: 11.5,
  },
  "fal-ai/infinitalk": {
    mode: "avatar",
    label: "InfiniteTalk",
    price: "not verified",
    acceptsPrompt: true,
    promptRequired: true,
    priceVerified: false,
    pricePerSecCents: 11.5,
  },
  "veed/lipsync": {
    mode: "relip",
    label: "VEED Lipsync",
    price: "uncertain — sources disagree ($0.07/s vs $0.40/min)",
    acceptsPrompt: false,
    promptRequired: false,
    // Disagreeing sources gave $0.07/s and $0.40/min (~0.0067/s) -- use the
    // higher of the two so the estimate errs toward over-quoting, not under.
    priceVerified: false,
    pricePerSecCents: 7,
  },
  "fal-ai/sync-lipsync/v2": {
    mode: "relip",
    label: "Sync Lipsync v2",
    price: "~$3/min",
    acceptsPrompt: false,
    promptRequired: false,
    priceVerified: true,
    pricePerSecCents: 5, // $3/min ÷ 60s
  },
  "fal-ai/latentsync": {
    mode: "relip",
    label: "LatentSync",
    price: "~$0.20 (clips up to 40s)",
    acceptsPrompt: false,
    promptRequired: false,
    // Flat fee, not per-second -- every clip this module accepts (≤20s hard
    // cap, see MAX_AUDIO_DURATION_SEC in LipsyncPage.tsx) is well under
    // LatentSync's own 40s ceiling, so the estimate is the flat amount
    // regardless of measured duration.
    priceVerified: true,
    flatCents: 20,
  },
  "fal-ai/musetalk": {
    mode: "relip",
    label: "MuseTalk",
    price: "not verified",
    acceptsPrompt: false,
    promptRequired: false,
    // No sourced figure -- conservative fallback equal to the highest
    // verified *relip*-mode rate in this catalog (Sync Lipsync v2, 5c/s).
    priceVerified: false,
    pricePerSecCents: 5,
  },
  "fal-ai/pixverse/lipsync": {
    mode: "relip",
    label: "PixVerse Lipsync",
    price: "~$0.04/s",
    acceptsPrompt: false,
    promptRequired: false,
    priceVerified: true,
    pricePerSecCents: 4,
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

/**
 * Estimated cost in integer cents for a clip of `durationSec` on `modelId`.
 * UX only -- mirrors the backend's documented formula
 * (`ceil(durationSec * pricePerSecCents)`, docs/lipsync-design.md's "Cost
 * estimation" section) so the number shown before submit is in the same
 * ballpark as what the server will actually reserve. The server re-derives
 * and enforces its own estimate at creation time regardless; this never
 * replaces that check, it just gives the user a heads-up (and a reason a
 * disabled submit button is disabled) before they wait on an upload.
 *
 * Returns null when there isn't enough information yet (no model resolved,
 * or no readable audio duration) rather than guessing.
 */
export function estimateCostCents(modelId: string | undefined, durationSec: number | undefined): number | null {
  const meta = modelMeta(modelId);
  if (!meta || durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0) return null;
  if (meta.flatCents != null) return meta.flatCents;
  if (meta.pricePerSecCents != null) return Math.ceil(durationSec * meta.pricePerSecCents);
  return null;
}
