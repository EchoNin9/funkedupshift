import React, { useCallback, useEffect, useState } from "react";
import { Alert } from "../../components";
import { apiGet, apiSend, fmtMoney, type Budget } from "./api";
import type { FinancesContext } from "./FinancesPage";

const BudgetsTab: React.FC<{ ctx: FinancesContext }> = ({ ctx }) => {
  const readOnly = !!ctx.owner;
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [newLimit, setNewLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<{ budgets: Budget[] }>(`/finances/budgets${ctx.owner ? `?owner=${encodeURIComponent(ctx.owner)}` : ""}`)
      .then((d) => setBudgets(d.budgets))
      .catch((e: Error) => setError(e.message));
  }, [ctx.owner]);

  useEffect(load, [load]);

  const save = async (next: Budget[]) => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("PUT", "/finances/budgets", {
        budgets: next.map((b) => ({ category: b.category, monthlyLimit: b.monthlyLimit })),
      });
      load();
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const addBudget = () => {
    const limit = parseFloat(newLimit);
    if (!newCategory || !Number.isFinite(limit)) return;
    save([...budgets.filter((b) => b.category !== newCategory), { category: newCategory, monthlyLimit: limit }]);
    setNewCategory("");
    setNewLimit("");
  };

  const input = "rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary";

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label htmlFor="budgetCat" className="block text-xs text-text-tertiary mb-1">Category</label>
            <select id="budgetCat" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className={input}>
              <option value="">Choose…</option>
              {ctx.categories
                .filter((c) => !budgets.some((b) => b.category === c))
                .map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="budgetLimit" className="block text-xs text-text-tertiary mb-1">Monthly limit</label>
            <input id="budgetLimit" type="number" min="0" step="1" value={newLimit}
              onChange={(e) => setNewLimit(e.target.value)} className={input} />
          </div>
          <button
            type="button"
            onClick={addBudget}
            disabled={busy || !newCategory || !newLimit}
            className="rounded-md bg-accent-500 px-3 py-2 text-sm font-medium text-surface-0 hover:bg-orange-500 disabled:opacity-50"
          >
            Add budget
          </button>
        </div>
      )}

      <div className="space-y-3">
        {budgets.map((b) => {
          const actual = b.actual ?? 0;
          const over = actual > b.monthlyLimit;
          const pct = b.monthlyLimit > 0 ? Math.min(100, (actual / b.monthlyLimit) * 100) : 100;
          return (
            <div key={b.category} className="rounded-xl border border-border-default bg-surface-1 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm font-medium text-text-primary">{b.category}</p>
                <p className={`text-sm ${over ? "text-red-400 font-semibold" : "text-text-secondary"}`}>
                  {fmtMoney(actual)} / {fmtMoney(b.monthlyLimit)}
                  {over && " — over budget"}
                </p>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => save(budgets.filter((x) => x.category !== b.category))}
                    className="ml-auto text-xs text-text-tertiary hover:text-red-400"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="mt-2 h-2 w-full rounded-full bg-surface-3">
                <div
                  className={`h-2 rounded-full ${over ? "bg-red-400" : "bg-accent-500"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
        {budgets.length === 0 && (
          <p className="text-sm text-text-tertiary">
            No budgets yet{readOnly ? "." : " — pick a category and set a monthly limit above."}
          </p>
        )}
      </div>

      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
};

export default BudgetsTab;
