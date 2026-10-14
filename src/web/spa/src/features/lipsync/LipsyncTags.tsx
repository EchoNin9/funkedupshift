import React from "react";
import { Sparkle } from "@phosphor-icons/react";
import type { LipsyncJobStatus, LipsyncMode } from "./api";
import { MODE_META, statusMeta } from "./statusStyles";

/**
 * Small pill badges shared by the clip list and the clip detail dialog.
 *  LipsyncStatusTag  — props: status: LipsyncJobStatus. Colour + label from statusMeta (uses `.tag`).
 *  LipsyncModeTag    — props: mode: LipsyncMode. Outline pill with the mode label.
 *  LipsyncAiTag      — no props. "AI-generated" accent pill (provenance disclosure; keep visible).
 */
export function LipsyncStatusTag({ status }: { status: LipsyncJobStatus }) {
  const meta = statusMeta(status);
  return <span className={`tag ${meta.badge}`}>{meta.label}</span>;
}

export function LipsyncModeTag({ mode }: { mode: LipsyncMode }) {
  return <span className="tag tag-outline">{MODE_META[mode]?.label ?? mode}</span>;
}

export function LipsyncAiTag() {
  return (
    <span className="tag tag-accent shrink-0">
      <Sparkle size={12} weight="fill" aria-hidden="true" />
      AI-generated
    </span>
  );
}
