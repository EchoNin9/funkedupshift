import React from "react";
import { Warning } from "@phosphor-icons/react";
import type { LipsyncBudget } from "./api";
import { formatCents, formatCentsRemaining } from "./money";

interface BudgetSummaryProps {
  budget: LipsyncBudget | null;
  loading: boolean;
  /** Set only for a real fetch failure -- a brand-new user's "no budget record" is folded into `budget` as zeros by the caller, not surfaced here. */
  error: string | null;
}

/**
 * The user's own budget, front and centre on the create page: "$15.00
 * budget, $12.53 remaining" per the spec. A never-been-granted budget
 * (budgetCents 0) gets its own clear message instead of a "$0.00 remaining"
 * line sitting next to a form that still looks usable -- see
 * docs/lipsync-design.md: "A new account can never cost money by itself."
 */
export function BudgetSummary({ budget, loading, error }: BudgetSummaryProps) {
  if (loading) {
    return <div className="h-14 w-full rounded-ds-lg bg-surface-3 motion-safe:animate-pulse" aria-hidden="true" />;
  }

  const card = "rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 px-4 py-3.5";

  if (error) {
    // Degrade gracefully -- a failed budget fetch shouldn't block the rest
    // of the page (create form, job history) from rendering.
    return (
      <p role="alert" className={`${card} flex items-center gap-2 text-sm text-warning`}>
        <Warning size={18} weight="regular" aria-hidden="true" className="shrink-0" />
        Could not load your budget. {error}
      </p>
    );
  }

  if (!budget || budget.budgetCents <= 0) {
    return (
      <p className="flex items-center gap-2 rounded-ds-lg border border-warning/40 bg-warning/10 px-4 py-3.5 text-sm text-warning">
        <Warning size={18} weight="regular" aria-hidden="true" className="shrink-0" />
        No budget allocated — ask an admin to grant you one before generating clips.
      </p>
    );
  }

  return (
    <div className={`${card} flex flex-wrap items-baseline gap-x-3 gap-y-1`}>
      <span className="text-xs font-semibold text-text-secondary">Your budget</span>
      <span className="font-heading text-[20px] font-semibold tracking-[-0.02em] text-text-primary">
        {formatCents(budget.budgetCents)} budget, {formatCentsRemaining(budget.remainingCents)} remaining
      </span>
      {budget.reservedCents > 0 && (
        <span className="text-[13px] text-text-secondary">
          ({formatCents(budget.reservedCents)} reserved for clips in progress)
        </span>
      )}
    </div>
  );
}
