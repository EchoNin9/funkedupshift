import React from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
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
    return <div className="h-6 w-56 animate-pulse rounded bg-surface-3" aria-hidden="true" />;
  }

  if (error) {
    // Degrade gracefully -- a failed budget fetch shouldn't block the rest
    // of the page (create form, job history) from rendering.
    return (
      <p className="flex items-center gap-1.5 text-sm text-amber-400">
        <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
        Could not load your budget. {error}
      </p>
    );
  }

  if (!budget || budget.budgetCents <= 0) {
    return (
      <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
        No budget allocated — ask an admin to grant you one before generating clips.
      </p>
    );
  }

  return (
    <p className="text-sm">
      <span className="font-display font-extrabold uppercase tracking-tight text-text-primary">
        {formatCents(budget.budgetCents)} budget, {formatCentsRemaining(budget.remainingCents)} remaining
      </span>
      {budget.reservedCents > 0 && (
        <span className="ml-1.5 text-text-tertiary">
          ({formatCents(budget.reservedCents)} reserved for clips in progress)
        </span>
      )}
    </p>
  );
}
