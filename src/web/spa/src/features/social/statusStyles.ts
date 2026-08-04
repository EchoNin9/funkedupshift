/**
 * Keyed by string rather than `PostStatus | TargetStatus` from api.ts: the
 * backend has a non-terminal target status ("processing", Instagram
 * transcoding a Reel server-side — see storage.py STATUS_PROCESSING) that
 * predates api.ts's string-literal unions picking it up. api.ts is out of
 * scope here, so this stays permissive and falls back to `pending` for
 * anything it doesn't recognise, same as before.
 */
type Status = string;

/** Compact colour + label metadata for post/target status chips and badges. */
export const STATUS_META: Record<
  Status,
  { label: string; dot: string; chip: string; badge: string }
> = {
  pending: {
    label: "Pending",
    dot: "bg-n3",
    chip: "border-n3/60 bg-n3/10 text-text-primary",
    badge: "border-n3 text-n3",
  },
  publishing: {
    label: "Publishing",
    dot: "bg-n2 animate-pulse",
    chip: "border-n2/60 bg-n2/10 text-text-primary",
    badge: "border-n2 text-n2",
  },
  processing: {
    label: "Processing",
    dot: "bg-n4 animate-pulse",
    chip: "border-n4/60 bg-n4/10 text-text-primary",
    badge: "border-n4 text-n4",
  },
  published: {
    label: "Published",
    dot: "bg-emerald-500",
    chip: "border-emerald-500/60 bg-emerald-500/10 text-text-primary",
    badge: "border-emerald-500 text-emerald-400",
  },
  failed: {
    label: "Failed",
    dot: "bg-red-500",
    chip: "border-red-500/60 bg-red-500/10 text-text-primary",
    badge: "border-red-500 text-red-400",
  },
  cancelled: {
    label: "Cancelled",
    dot: "bg-text-tertiary/50",
    // Deliberately the dullest chip in the set: a cancelled post is history and
    // should recede so live posts on the same day stand out. Subtle border, no
    // fill, faded text -- still legible, just not competing for attention.
    chip: "border-border-subtle bg-transparent text-text-tertiary/60 line-through",
    badge: "border-border-hover text-text-tertiary",
  },
  partial: {
    label: "Partial",
    dot: "bg-n1",
    chip: "border-n1/60 bg-n1/10 text-text-primary",
    badge: "border-n1 text-n1",
  },
};

/** Accepts a bare `string` (not `PostStatus | TargetStatus`) so runtime-only statuses like "processing" resolve correctly instead of hitting the `pending` fallback. Genuinely unknown values still fall back to `pending`. */
export function statusMeta(status: Status) {
  return STATUS_META[status] ?? STATUS_META.pending;
}
