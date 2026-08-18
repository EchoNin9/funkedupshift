import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowPathIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  PencilIcon,
  PlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";
import { AdminPageHeader } from "../admin/AdminPageHeader";
import { Alert } from "../../components";
import { ApiError, listAdminBudgets, updateUserBudget, type AdminUserBudget } from "./api";
import { centsToDollarsInput, formatCents, formatCentsRemaining, parseDollarsToCents } from "./money";
import { formatDateTime } from "./dateUtils";

interface SummaryState {
  falBalanceCents: number | null;
  falBalanceFetchedAt: string | null;
  totalGrantedCents: number;
  totalSpentCents: number;
}

const EMPTY_SUMMARY: SummaryState = {
  falBalanceCents: null,
  falBalanceFetchedAt: null,
  totalGrantedCents: 0,
  totalSpentCents: 0,
};

const inputClass =
  "rounded-md border border-border-hover bg-surface-0 px-2 py-1 text-sm text-text-primary";

/**
 * Admin-only view of every user's lipsync budget, plus the real fal.ai
 * account balance so an admin can tell at a glance whether what's been
 * granted across all users could actually be covered. Nested under
 * shell/AppLayout.tsx's /admin route (AdminLayout already redirects guests
 * and blocks non-admins at a coarse level); this page's own isSuperAdmin
 * check narrows that further, same pattern as BrandingPage.tsx and
 * InternetDashboardAdminPage.tsx for their own superadmin-only content --
 * `/lipsync/admin/*` requires the Cognito `admin` group server side, so
 * this is defence in depth, not the only gate.
 */
export default function LipsyncBudgetsPage() {
  const { user } = useAuth();
  const isSuperAdmin = hasRole(user ?? null, "superadmin");

  const [budgets, setBudgets] = useState<AdminUserBudget[]>([]);
  const [summary, setSummary] = useState<SummaryState>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (opts?.silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await listAdminBudgets();
      setBudgets(data.budgets);
      setSummary({
        falBalanceCents: data.falBalanceCents,
        falBalanceFetchedAt: data.falBalanceFetchedAt,
        totalGrantedCents: data.totalGrantedCents,
        totalSpentCents: data.totalSpentCents,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load budgets.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) load();
  }, [isSuperAdmin, load]);

  if (!isSuperAdmin) {
    return (
      <div className="space-y-6">
        <AdminPageHeader title="Lipsync Budgets" description="Only superadmin users can manage lipsync budgets." />
      </div>
    );
  }

  // "Visually obvious" per the spec -- only assertable when we actually have
  // a live balance to compare against; a null balance already gets its own
  // "unavailable" treatment below rather than silently reading as "fine".
  const overCommitted = summary.falBalanceCents != null && summary.totalGrantedCents > summary.falBalanceCents;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Lipsync Budgets"
        description="Every user's granted, spent, and remaining lipsync spend, plus the live fal.ai account balance."
        actions={
          <button
            type="button"
            onClick={() => load({ silent: true })}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-hover bg-surface-2 px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-surface-3 transition-colors disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
      />

      {error && <Alert variant="error">{error}</Alert>}

      {/* Summary: fal balance, totals, and the commitments-vs-balance check. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border-default bg-surface-1 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary">fal account balance</p>
          {summary.falBalanceCents == null ? (
            <p className="mt-1 flex items-center gap-1.5 text-lg font-display font-extrabold uppercase tracking-tight text-amber-400">
              <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
              Balance unavailable
            </p>
          ) : (
            <p className="mt-1 text-2xl font-display font-extrabold uppercase tracking-tight text-text-primary">
              {formatCents(summary.falBalanceCents)}
            </p>
          )}
          <p className="mt-1 text-xs text-text-tertiary">
            {summary.falBalanceFetchedAt ? `As of ${formatDateTime(summary.falBalanceFetchedAt)}` : "Never fetched"}
          </p>
        </div>

        <div
          className={`rounded-xl border p-4 ${
            overCommitted ? "border-red-500/60 bg-red-500/10" : "border-border-default bg-surface-1"
          }`}
        >
          <p
            className={`text-xs font-medium uppercase tracking-wider ${
              overCommitted ? "text-red-300" : "text-text-tertiary"
            }`}
          >
            Total granted
          </p>
          <p
            className={`mt-1 text-2xl font-display font-extrabold uppercase tracking-tight ${
              overCommitted ? "text-red-300" : "text-text-primary"
            }`}
          >
            {formatCents(summary.totalGrantedCents)}
          </p>
          {overCommitted && (
            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-red-300">
              <ExclamationTriangleIcon className="h-3.5 w-3.5 shrink-0" />
              Exceeds fal balance by {formatCents(summary.totalGrantedCents - (summary.falBalanceCents ?? 0))}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border-default bg-surface-1 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary">Total spent</p>
          <p className="mt-1 text-2xl font-display font-extrabold uppercase tracking-tight text-text-primary">
            {formatCents(summary.totalSpentCents)}
          </p>
        </div>
      </div>

      {overCommitted && (
        <Alert variant="error">
          <span className="flex items-start gap-1.5">
            <ExclamationTriangleIcon className="h-4 w-4 shrink-0 mt-0.5" />
            Total granted budgets ({formatCents(summary.totalGrantedCents)}) exceed the live fal balance (
            {formatCents(summary.falBalanceCents)}). If everyone spent down to zero remaining, some jobs would run
            out of real balance to charge against.
          </span>
        </Alert>
      )}

      <GrantBudgetForm onGranted={() => load({ silent: true })} />

      <div className="overflow-x-auto rounded-lg border border-border-default">
        <table className="min-w-full divide-y divide-border-default">
          <thead className="bg-surface-2/80">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">User</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Granted</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Spent</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Reserved</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Remaining</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Updated</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Note</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">
                <span className="sr-only">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-text-tertiary">
                  Loading…
                </td>
              </tr>
            ) : budgets.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-text-tertiary">
                  No budgets granted yet.
                </td>
              </tr>
            ) : (
              budgets.map((b) => <BudgetRow key={b.username} budget={b} onSaved={() => load({ silent: true })} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Grant a first-time budget to a user who has no budget record yet. The
 * admin list (GET /lipsync/admin/budgets) is a scan over existing BUDGET
 * records only (docs/lipsync-design.md), so a brand-new user with nothing
 * granted has no row to "edit" in the table below -- this is the only way
 * to get them one. Same PUT endpoint as an in-table edit; the backend
 * treats it as an upsert either way.
 */
function GrantBudgetForm({ onGranted }: { onGranted: () => void }) {
  const [username, setUsername] = useState("");
  const [dollars, setDollars] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setFormError("Enter the exact Cognito username.");
      return;
    }
    const cents = parseDollarsToCents(dollars);
    if (cents == null) {
      setFormError("Enter a valid non-negative dollar amount.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await updateUserBudget(trimmedUsername, { budgetCents: cents, note: note.trim() || undefined });
      setUsername("");
      setDollars("");
      setNote("");
      setExpanded(false);
      onGranted();
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.errors && err.errors.length
          ? err.errors.join(" ")
          : err instanceof Error
            ? err.message
            : "Could not grant this budget."
      );
    } finally {
      setSaving(false);
    }
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border-hover bg-surface-2 px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-surface-3 transition-colors"
      >
        <PlusIcon className="h-4 w-4" />
        Grant a new user a budget
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-border-default bg-surface-1 p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-display font-extrabold uppercase tracking-tight text-text-primary">
          Grant a new user a budget
        </h2>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="Cancel"
          className="rounded-md p-1 text-text-tertiary hover:bg-surface-3 hover:text-text-primary transition-colors"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>

      {formError && <Alert variant="error">{formError}</Alert>}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="grant-username" className="block text-xs text-text-tertiary mb-1">
            Cognito username
          </label>
          <input
            id="grant-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. jdoe"
            className={`${inputClass} w-48`}
          />
        </div>
        <div>
          <label htmlFor="grant-amount" className="block text-xs text-text-tertiary mb-1">
            Budget ($)
          </label>
          <input
            id="grant-amount"
            type="number"
            min="0"
            step="0.01"
            value={dollars}
            onChange={(e) => setDollars(e.target.value)}
            placeholder="15.00"
            className={`${inputClass} w-28`}
          />
        </div>
        <div className="flex-1 min-w-[10rem]">
          <label htmlFor="grant-note" className="block text-xs text-text-tertiary mb-1">
            Note (optional)
          </label>
          <input
            id="grant-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this amount"
            className={`${inputClass} w-full`}
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Granting…" : "Grant"}
        </button>
      </div>
    </form>
  );
}

interface BudgetRowProps {
  budget: AdminUserBudget;
  onSaved: () => void;
}

/** One editable row: view mode shows the granted amount as text, edit mode swaps it (plus the note) for inputs. */
function BudgetRow({ budget, onSaved }: BudgetRowProps) {
  const [editing, setEditing] = useState(false);
  const [dollars, setDollars] = useState(() => centsToDollarsInput(budget.budgetCents));
  const [note, setNote] = useState(budget.note ?? "");
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const startEdit = () => {
    setDollars(centsToDollarsInput(budget.budgetCents));
    setNote(budget.note ?? "");
    setRowError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setRowError(null);
  };

  const save = async () => {
    const cents = parseDollarsToCents(dollars);
    if (cents == null) {
      setRowError("Enter a valid non-negative dollar amount.");
      return;
    }
    setSaving(true);
    setRowError(null);
    try {
      await updateUserBudget(budget.username, { budgetCents: cents, note: note.trim() || undefined });
      setEditing(false);
      onSaved();
    } catch (err) {
      setRowError(
        err instanceof ApiError && err.errors && err.errors.length
          ? err.errors.join(" ")
          : err instanceof Error
            ? err.message
            : "Could not save this budget."
      );
    } finally {
      setSaving(false);
    }
  };

  // Shouldn't happen under normal reserve/settle discipline, but an admin
  // lowering a budget below what's already committed is possible -- flag it
  // rather than silently showing a number that looks fine.
  const remainingNegative = budget.remainingCents < 0;

  return (
    <tr className="hover:bg-surface-2/60 transition-colors align-top">
      <td className="px-4 py-3 text-sm text-text-primary break-all">{budget.username}</td>
      <td className="px-4 py-3 text-right text-sm text-text-primary tabular-nums whitespace-nowrap">
        {editing ? (
          <input
            type="number"
            min="0"
            step="0.01"
            value={dollars}
            onChange={(e) => setDollars(e.target.value)}
            aria-label={`Budget for ${budget.username}`}
            className={`${inputClass} w-24 text-right`}
          />
        ) : (
          formatCents(budget.budgetCents)
        )}
      </td>
      <td className="px-4 py-3 text-right text-sm text-text-secondary tabular-nums whitespace-nowrap">
        {formatCents(budget.spentCents)}
      </td>
      <td className="px-4 py-3 text-right text-sm text-text-secondary tabular-nums whitespace-nowrap">
        {formatCents(budget.reservedCents)}
      </td>
      <td
        className={`px-4 py-3 text-right text-sm tabular-nums whitespace-nowrap ${
          remainingNegative ? "text-red-400" : "text-text-primary"
        }`}
      >
        {remainingNegative ? formatCents(budget.remainingCents) : formatCentsRemaining(budget.remainingCents)}
      </td>
      <td className="px-4 py-3 text-xs text-text-tertiary whitespace-nowrap">
        {budget.updatedAt ? (
          <>
            <div>{formatDateTime(budget.updatedAt)}</div>
            {budget.updatedBy && <div>by {budget.updatedBy}</div>}
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="px-4 py-3 text-xs text-text-tertiary max-w-[16rem]">
        {editing ? (
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
            aria-label={`Note for ${budget.username}`}
            className={`${inputClass} w-full`}
          />
        ) : (
          <span className="break-words">{budget.note || "—"}</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {editing ? (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              aria-label={`Save budget for ${budget.username}`}
              className="rounded-md p-1.5 text-emerald-400 hover:bg-surface-3 transition-colors disabled:opacity-50"
            >
              <CheckIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              aria-label={`Cancel editing ${budget.username}`}
              className="rounded-md p-1.5 text-text-tertiary hover:bg-surface-3 hover:text-red-400 transition-colors disabled:opacity-50"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            aria-label={`Edit budget for ${budget.username}`}
            className="rounded-md p-1.5 text-text-tertiary hover:bg-surface-3 hover:text-text-primary transition-colors"
          >
            <PencilIcon className="h-4 w-4" />
          </button>
        )}
        {rowError && <p className="mt-1 max-w-[10rem] text-right text-xs text-red-400">{rowError}</p>}
      </td>
    </tr>
  );
}
