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
 * Static per-mode copy, sourced from docs/lipsync-design.md's Scope table.
 * Informational only — never sent to the API. The backend defaults `model`
 * per mode, so the create form doesn't expose a model picker.
 */
export const MODE_META: Record<
  LipsyncMode,
  { label: string; hint: string; model: string; pricePerSec: string }
> = {
  avatar: {
    label: "Avatar",
    hint: "Portrait image + audio → talking-head video.",
    model: "fal-ai/kling-video/ai-avatar/v2/pro",
    pricePerSec: "$0.115/s",
  },
  relip: {
    label: "Re-lip",
    hint: "Existing video + audio → re-synced lip movement.",
    model: "veed/lipsync",
    pricePerSec: "$0.07/s",
  },
};
