import React, { useEffect, useState } from "react";
import { Alert } from "../../components";
import { apiGet, apiSend, fmtMoney, ownerParam, type Insights } from "./api";
import type { FinancesContext } from "./FinancesPage";
import { EraEmptyState } from "./EraBadge";

const InsightsTab: React.FC<{ ctx: FinancesContext }> = ({ ctx }) => {
  const readOnly = !!ctx.owner;
  const [period, setPeriod] = useState("");
  const [data, setData] = useState<Insights | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const qs = period ? `period=${encodeURIComponent(period)}` : "";
    apiGet<Insights>(`/finances/insights?${qs}${ownerParam(ctx.owner)}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [period, ctx.owner]);

  const runSummary = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await apiSend<{ summary: string }>("POST", "/finances/insights/summary",
        period ? { period } : {});
      setSummary(d.summary);
    } catch (e: any) {
      setError(e?.message ?? "Summary failed");
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <Alert variant="error">{error}</Alert>;
  if (!data) return <div className="h-48 animate-pulse rounded-xl bg-surface-3" />;

  const cats = Object.entries(data.spendingByCategory).sort((a, b) => b[1] - a[1]);
  const maxSpend = cats.length ? cats[0][1] : 0;
  const cmp = data.comparison;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label htmlFor="insightsPeriod" className="block text-xs text-text-tertiary mb-1">Period</label>
          <input
            id="insightsPeriod"
            type="month"
            value={period || data.period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary"
          />
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={runSummary}
            disabled={busy}
            className="ml-auto rounded-md border border-accent-500 px-3 py-2 text-sm font-medium text-accent-500 hover:bg-surface-2 disabled:opacity-50"
          >
            {busy ? "Summarizing…" : "AI summary"}
          </button>
        )}
      </div>

      {summary && (
        <p className="rounded-md bg-surface-2 p-3 text-sm text-text-secondary whitespace-pre-wrap">{summary}</p>
      )}

      <div className="rounded-xl border border-border-default bg-surface-1 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-text-primary uppercase">Spending by category — {data.period}</h2>
        {cats.length === 0 && <p className="text-sm text-text-tertiary">No spending recorded this period.</p>}
        {cats.map(([cat, amt]) => (
          <div key={cat}>
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">{cat}</span>
              <span className="text-text-primary font-medium">{fmtMoney(amt)}</span>
            </div>
            <div className="mt-1 h-2 w-full rounded-full bg-surface-3">
              <div className="h-2 rounded-full bg-accent-500"
                style={{ width: `${maxSpend > 0 ? (amt / maxSpend) * 100 : 0}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border-default bg-surface-1 p-4">
          <h2 className="text-sm font-semibold text-text-primary uppercase">vs previous month</h2>
          <div className="mt-2 space-y-1 text-sm text-text-secondary">
            <p>
              Spend: <span className="text-text-primary font-medium">{fmtMoney(cmp.spend)}</span>{" "}
              (prev {fmtMoney(cmp.previousSpend)}
              {cmp.previousSpend > 0 &&
                `, ${cmp.spend >= cmp.previousSpend ? "+" : ""}${(((cmp.spend - cmp.previousSpend) / cmp.previousSpend) * 100).toFixed(0)}%`}
              )
            </p>
            <p>
              Income: <span className="text-text-primary font-medium">{fmtMoney(cmp.income)}</span>{" "}
              (prev {fmtMoney(cmp.previousIncome)})
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-border-default bg-surface-1 p-4">
          <h2 className="text-sm font-semibold text-text-primary uppercase">Forecast — avg net flow</h2>
          <div className="mt-2 space-y-1 text-sm text-text-secondary">
            {data.forecast.map((f) => (
              <p key={f.month}>
                {f.month}:{" "}
                <span className={`font-medium ${f.projectedNet >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {fmtMoney(f.projectedNet)}
                </span>
              </p>
            ))}
          </div>
        </div>
      </div>

      {!data.eraConnected && <EraEmptyState />}
      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
};

export default InsightsTab;
