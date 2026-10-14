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
    dot: "bg-hue-teal",
    chip: "border-hue-teal/60 bg-hue-teal/10 text-text-primary",
    badge: "border-hue-teal text-hue-teal",
  },
  publishing: {
    label: "Publishing",
    dot: "bg-hue-amber animate-pulse",
    chip: "border-hue-amber/60 bg-hue-amber/10 text-text-primary",
    badge: "border-hue-amber text-hue-amber",
  },
  processing: {
    label: "Processing",
    dot: "bg-hue-coral animate-pulse",
    chip: "border-hue-coral/60 bg-hue-coral/10 text-text-primary",
    badge: "border-hue-coral text-hue-coral",
  },
  published: {
    label: "Published",
    dot: "bg-success",
    chip: "border-success/60 bg-success/10 text-text-primary",
    badge: "border-success text-success",
  },
  failed: {
    label: "Failed",
    dot: "bg-danger",
    chip: "border-danger/60 bg-danger/10 text-text-primary",
    badge: "border-danger text-danger",
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
    dot: "bg-accent",
    chip: "border-accent/60 bg-accent/10 text-text-primary",
    badge: "border-accent text-accent-text",
  },
};

/** Accepts a bare `string` (not `PostStatus | TargetStatus`) so runtime-only statuses like "processing" resolve correctly instead of hitting the `pending` fallback. Genuinely unknown values still fall back to `pending`. */
export function statusMeta(status: Status) {
  return STATUS_META[status] ?? STATUS_META.pending;
}
