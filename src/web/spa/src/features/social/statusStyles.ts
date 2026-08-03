import type { PostStatus, TargetStatus } from "./api";

/** Compact colour + label metadata for post/target status chips and badges. */
export const STATUS_META: Record<
  PostStatus,
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
    dot: "bg-text-tertiary",
    chip: "border-border-default bg-surface-3/60 text-text-tertiary line-through",
    badge: "border-border-hover text-text-tertiary",
  },
  partial: {
    label: "Partial",
    dot: "bg-n1",
    chip: "border-n1/60 bg-n1/10 text-text-primary",
    badge: "border-n1 text-n1",
  },
};

export function statusMeta(status: PostStatus | TargetStatus) {
  return STATUS_META[status] ?? STATUS_META.pending;
}
