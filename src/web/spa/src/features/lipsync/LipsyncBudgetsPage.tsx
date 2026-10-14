import React, { useCallback, useEffect, useState } from "react";
import { ArrowsClockwise, Check, PencilSimple, Plus, Warning, X } from "@phosphor-icons/react";
import { useAuth, hasRole } from "../../shell/AuthContext";
import { AdminPageHeader } from "../admin/AdminPageHeader";
import { Alert } from "../../components";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { IconButton } from "../../components/IconButton";
import {
  ApiError,
  listAdminBudgets,
  listDirectoryUsers,
  updateUserBudget,
  type AdminUserBudget,
  type DirectoryUser,
} from "./api";
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

const inputClass = `min-h-10 rounded-ds-md border border-border-default bg-surface-0 px-2.5 text-sm text-text-primary placeholder:text-text-tertiary hover:border-border-hover motion-safe:transition-colors motion-safe:duration-150 ${focusRing}`;
const cardClass = "rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2";
const statLabel = "text-xs font-semibold text-text-secondary";
const statValue = "mt-1 font-heading text-[26px] font-semibold tracking-[-0.02em]";
const thClass = "px-4 py-3 text-xs font-semibold text-text-secondary";

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
            className={buttonClasses("secondary", "md")}
          >
            <ArrowsClockwise
              size={16}
              weight="regular"
              aria-hidden="true"
              className={refreshing ? "motion-safe:animate-spin" : ""}
            />
            Refresh
          </button>
        }
      />

      {error && <Alert variant="error">{error}</Alert>}

      {/* Summary: fal balance, totals, and the commitments-vs-balance check. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className={`${cardClass} p-4`}>
          <p className={statLabel}>fal account balance</p>
          {summary.falBalanceCents == null ? (
            <p className="mt-1 flex items-center gap-1.5 font-heading text-lg font-semibold text-warning">
              <Warning size={20} weight="regular" aria-hidden="true" className="shrink-0" />
              Balance unavailable
            </p>
          ) : (
            <p className={`${statValue} text-text-primary`}>{formatCents(summary.falBalanceCents)}</p>
          )}
          <p className="mt-1 text-xs text-text-secondary">
            {summary.falBalanceFetchedAt ? `As of ${formatDateTime(summary.falBalanceFetchedAt)}` : "Never fetched"}
          </p>
        </div>

        <div
          className={`rounded-ds-lg border p-4 ${
            overCommitted ? "border-danger/60 bg-danger/10" : "border-[color:var(--color-divider)] bg-surface-2"
          }`}
        >
          <p className={`text-xs font-semibold ${overCommitted ? "text-danger" : "text-text-secondary"}`}>
            Total granted
          </p>
          <p className={`${statValue} ${overCommitted ? "text-danger" : "text-text-primary"}`}>
            {formatCents(summary.totalGrantedCents)}
          </p>
          {overCommitted && (
            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-danger">
              <Warning size={14} weight="regular" aria-hidden="true" className="shrink-0" />
              Exceeds fal balance by {formatCents(summary.totalGrantedCents - (summary.falBalanceCents ?? 0))}
            </p>
          )}
        </div>

        <div className={`${cardClass} p-4`}>
          <p className={statLabel}>Total spent</p>
          <p className={`${statValue} text-text-primary`}>{formatCents(summary.totalSpentCents)}</p>
        </div>
      </div>

      {overCommitted && (
        <Alert variant="error">
          <span className="flex items-start gap-1.5">
            <Warning size={16} weight="regular" aria-hidden="true" className="mt-0.5 shrink-0" />
            Total granted budgets ({formatCents(summary.totalGrantedCents)}) exceed the live fal balance (
            {formatCents(summary.falBalanceCents)}). If everyone spent down to zero remaining, some jobs would run
            out of real balance to charge against.
          </span>
        </Alert>
      )}

      <GrantBudgetForm onGranted={() => load({ silent: true })} />

      <div className={`${cardClass} overflow-x-auto`} aria-busy={loading}>
        <table className="min-w-full">
          <thead className="bg-surface-3/40">
            <tr>
              <th scope="col" className={`${thClass} text-left`}>User</th>
              <th scope="col" className={`${thClass} text-right`}>Granted</th>
              <th scope="col" className={`${thClass} text-right`}>Spent</th>
              <th scope="col" className={`${thClass} text-right`}>Reserved</th>
              <th scope="col" className={`${thClass} text-right`}>Remaining</th>
              <th scope="col" className={`${thClass} text-left`}>Updated</th>
              <th scope="col" className={`${thClass} text-left`}>Note</th>
              <th scope="col" className={`${thClass} text-right`}>
                <span className="sr-only">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--color-divider)] border-t border-[color:var(--color-divider)]">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-9 text-center text-sm text-text-secondary">
                  Loading…
                </td>
              </tr>
            ) : budgets.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-9 text-center text-sm text-text-secondary">
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
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);

  // Suggestions only. A budget may be granted to an address that isn't here
  // yet (that's why budgets key on email, not on a Cognito sub), so a failed
  // lookup must never block the form.
  useEffect(() => {
    let cancelled = false;
    listDirectoryUsers().then((users) => {
      if (!cancelled) setDirectory(users);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setFormError("Enter the user's email address.");
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
      <button type="button" onClick={() => setExpanded(true)} className={`${buttonClasses("secondary", "md")} w-full sm:w-auto`}>
        <Plus size={16} weight="regular" aria-hidden="true" />
        Grant a new user a budget
      </button>
    );
  }

  return (
    <form onSubmit={submit} className={`${cardClass} space-y-3 p-4`}>
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-[18px] font-semibold text-text-primary">Grant a new user a budget</h2>
        <IconButton
          icon={<X size={16} weight="regular" aria-hidden="true" />}
          label="Cancel"
          onClick={() => setExpanded(false)}
        />
      </div>

      {formError && <Alert variant="error">{formError}</Alert>}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto">
          <label htmlFor="grant-username" className="mb-1 block text-[13px] font-semibold text-text-primary">
            User email
          </label>
          {/* Budgets key on EMAIL (routes.py::_budgetIdentity), so this must be
              an address, not a Cognito username -- granting to "jdoe" would
              create a budget that never matches anyone. The datalist suggests
              known users while still allowing a not-yet-registered address. */}
          <input
            id="grant-username"
            type="email"
            list="lipsync-user-emails"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="name@example.com"
            className={`${inputClass} w-full sm:w-64`}
          />
          <datalist id="lipsync-user-emails">
            {directory.map((u) => (
              <option key={u.email} value={u.email}>
                {u.username && u.username !== u.email ? u.username : ""}
              </option>
            ))}
          </datalist>
        </div>
        <div className="w-full sm:w-auto">
          <label htmlFor="grant-amount" className="mb-1 block text-[13px] font-semibold text-text-primary">
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
            className={`${inputClass} w-full sm:w-28`}
          />
        </div>
        <div className="min-w-[10rem] flex-1 basis-full sm:basis-0">
          <label htmlFor="grant-note" className="mb-1 block text-[13px] font-semibold text-text-primary">
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
          className={`${buttonClasses("primary", "md")} w-full sm:w-auto`}
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
    <tr className="align-top motion-safe:transition-colors hover:bg-surface-3/40">
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
          remainingNegative ? "text-danger" : "text-text-primary"
        }`}
      >
        {remainingNegative ? formatCents(budget.remainingCents) : formatCentsRemaining(budget.remainingCents)}
      </td>
      <td className="px-4 py-3 text-xs text-text-secondary whitespace-nowrap">
        {budget.updatedAt ? (
          <>
            <div>{formatDateTime(budget.updatedAt)}</div>
            {budget.updatedBy && <div>by {budget.updatedBy}</div>}
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="px-4 py-3 text-xs text-text-secondary max-w-[16rem]">
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
          <div className="flex items-center justify-end gap-1.5">
            <IconButton
              icon={<Check size={16} weight="regular" aria-hidden="true" />}
              label={`Save budget for ${budget.username}`}
              onClick={save}
              disabled={saving}
              className="!text-success"
            />
            <IconButton
              icon={<X size={16} weight="regular" aria-hidden="true" />}
              label={`Cancel editing ${budget.username}`}
              onClick={cancelEdit}
              disabled={saving}
            />
          </div>
        ) : (
          <IconButton
            icon={<PencilSimple size={16} weight="regular" aria-hidden="true" />}
            label={`Edit budget for ${budget.username}`}
            onClick={startEdit}
            className="ml-auto"
          />
        )}
        {rowError && <p role="alert" className="mt-1 max-w-[10rem] text-right text-xs font-semibold text-danger">{rowError}</p>}
      </td>
    </tr>
  );
}
