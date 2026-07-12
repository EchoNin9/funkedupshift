import React, { useCallback, useEffect, useState } from "react";
import { Alert } from "../../components";
import { apiGet, fmtMoney, type Account, type Overview } from "./api";
import type { FinancesContext } from "./FinancesPage";
import NetLineChart from "./NetLineChart";
import EraBadge, { EraEmptyState } from "./EraBadge";
import AccountsManager from "./AccountsManager";

function groupByBank(accounts: Account[]): [string, Account[]][] {
  const groups = new Map<string, Account[]>();
  for (const a of accounts) {
    const key = a.source === "era" ? "Era" : a.bank || "Other accounts";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }
  return [...groups.entries()];
}

const DashboardTab: React.FC<{ ctx: FinancesContext }> = ({ ctx }) => {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<Overview>(`/finances/overview${ctx.owner ? `?owner=${encodeURIComponent(ctx.owner)}` : ""}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [ctx.owner]);

  useEffect(load, [load]);

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!data) return <div className="h-48 animate-pulse rounded-xl bg-surface-3" />;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border-default bg-surface-1 p-4">
        <p className="text-xs uppercase text-text-tertiary">Net worth</p>
        <p className="text-3xl font-semibold text-text-primary">{fmtMoney(data.netWorth)}</p>
        <div className="mt-2 flex flex-wrap gap-6 text-sm">
          <span className="text-text-secondary">
            30-day income: <span className="text-emerald-400 font-medium">{fmtMoney(data.cashFlow30d.income)}</span>
          </span>
          <span className="text-text-secondary">
            30-day spend: <span className="text-red-400 font-medium">{fmtMoney(data.cashFlow30d.spend)}</span>
          </span>
          <span className="text-text-secondary">
            Net:{" "}
            <span className={`font-medium ${data.cashFlow30d.net >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {fmtMoney(data.cashFlow30d.net)}
            </span>
          </span>
        </div>
      </div>

      {!ctx.owner && <AccountsManager accounts={data.accounts} onChanged={load} />}

      {groupByBank(data.accounts).map(([bank, accounts]) => (
        <div key={bank} className="space-y-2">
          <h2 className="text-sm font-semibold text-text-primary uppercase">{bank}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {accounts.map((a) => {
              const drift = a.reconciledBalance != null && Math.abs(a.balance - a.reconciledBalance) > 0.005;
              return (
                <div key={`${a.source}-${a.id}`} className="rounded-xl border border-border-default bg-surface-1 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-text-primary">{a.displayName ?? a.name}</p>
                    {a.source === "era" && <EraBadge />}
                  </div>
                  <p className="text-xs text-text-tertiary capitalize">{a.kind}</p>
                  <p className={`mt-1 text-lg font-semibold ${a.balance < 0 ? "text-red-400" : "text-text-primary"}`}>
                    {fmtMoney(a.balance, a.currency)}
                  </p>
                  {drift && (
                    <p className="mt-1 text-xs text-amber-400">
                      Bank statement says {fmtMoney(a.reconciledBalance!, a.currency)}
                      {a.reconciledAt ? ` (as of ${a.reconciledAt})` : ""} — doesn&apos;t match the register.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {data.accounts.length === 0 && (
        <p className="text-sm text-text-tertiary">
          No accounts yet. Add one above, then record transactions or import a bank file.
        </p>
      )}

      {!data.eraConnected && <EraEmptyState />}

      <div className="rounded-xl border border-border-default bg-surface-1 p-4 space-y-2">
        <h2 className="text-sm font-semibold text-text-primary uppercase">Cash flow — last 90 days</h2>
        {data.cashFlowSeries90d.length > 1 ? (
          <NetLineChart points={data.cashFlowSeries90d.map((p) => ({ date: p.date, value: p.net }))} />
        ) : (
          <p className="text-sm text-text-tertiary">Not enough transactions to chart yet.</p>
        )}
      </div>
    </div>
  );
};

export default DashboardTab;
