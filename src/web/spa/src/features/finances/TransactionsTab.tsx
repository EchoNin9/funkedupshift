import React, { useCallback, useEffect, useState } from "react";
import { Alert } from "../../components";
import { apiGet, apiSend, fmtMoney, ownerParam, type Account, type Txn } from "./api";
import type { FinancesContext } from "./FinancesPage";
import EraBadge, { EraEmptyState } from "./EraBadge";
import ImportPanel from "./ImportPanel";
import RulesSection from "./RulesSection";

const EMPTY_FORM = { date: "", amount: "", payee: "", category: "", notes: "", accountId: "" };
const EMPTY_XFER = { date: "", amount: "", fromAccountId: "", toAccountId: "", notes: "" };

const TransactionsTab: React.FC<{ ctx: FinancesContext }> = ({ ctx }) => {
  const readOnly = !!ctx.owner;
  const [txns, setTxns] = useState<Txn[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filters, setFilters] = useState({ from: "", to: "", q: "", category: "" });
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [xfer, setXfer] = useState(EMPTY_XFER);
  const [showXfer, setShowXfer] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (filters.from) qs.set("from", filters.from);
    if (filters.to) qs.set("to", filters.to);
    if (filters.q) qs.set("q", filters.q);
    if (filters.category) qs.set("category", filters.category);
    apiGet<{ transactions: Txn[] }>(`/finances/transactions?${qs.toString()}${ownerParam(ctx.owner)}`)
      .then((d) => setTxns(d.transactions))
      .catch((e: Error) => setError(e.message));
  }, [filters, ctx.owner]);

  useEffect(load, [load]);
  useEffect(() => {
    if (readOnly) return;
    apiGet<{ accounts: Account[] }>("/finances/accounts")
      .then((d) => setAccounts(d.accounts))
      .catch(() => {});
  }, [readOnly]);

  const startEdit = (t: Txn) => {
    setEditingId(t.id);
    setForm({
      date: t.date,
      amount: String(t.amount),
      payee: t.payee,
      category: t.category,
      notes: t.notes,
      accountId: t.accountId,
    });
    setShowForm(true);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, amount: parseFloat(form.amount) };
      if (editingId) {
        await apiSend("PUT", `/finances/transactions/${encodeURIComponent(editingId)}`, body);
      } else {
        await apiSend("POST", "/finances/transactions", body);
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      setShowForm(false);
      load();
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const submitTransfer = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/finances/transfers", { ...xfer, amount: parseFloat(xfer.amount) });
      setXfer(EMPTY_XFER);
      setShowXfer(false);
      load();
    } catch (e: any) {
      setError(e?.message ?? "Transfer failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: Txn) => {
    const msg = t.transferId
      ? `Delete this transfer? Both legs will be removed.`
      : `Delete transaction "${t.payee || t.id}"?`;
    if (!window.confirm(msg)) return;
    try {
      await apiSend("DELETE", `/finances/transactions/${encodeURIComponent(t.id)}`);
      load();
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
    }
  };

  const input = "rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label htmlFor="finFrom" className="block text-xs text-text-tertiary mb-1">From</label>
          <input id="finFrom" type="date" value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })} className={input} />
        </div>
        <div>
          <label htmlFor="finTo" className="block text-xs text-text-tertiary mb-1">To</label>
          <input id="finTo" type="date" value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })} className={input} />
        </div>
        <div className="grow max-w-xs">
          <label htmlFor="finQ" className="block text-xs text-text-tertiary mb-1">Search</label>
          <input id="finQ" type="text" value={filters.q} placeholder="Payee, notes, category"
            onChange={(e) => setFilters({ ...filters, q: e.target.value })} className={`${input} w-full`} />
        </div>
        <div>
          <label htmlFor="finCat" className="block text-xs text-text-tertiary mb-1">Category</label>
          <select id="finCat" value={filters.category}
            onChange={(e) => setFilters({ ...filters, category: e.target.value })} className={input}>
            <option value="">All</option>
            {ctx.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {!readOnly && (
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => setShowImport(!showImport)}
              className="rounded-md border border-accent-500 px-3 py-2 text-sm font-medium text-accent-500 hover:bg-surface-2"
            >
              {showImport ? "Close import" : "Import file"}
            </button>
            <button
              type="button"
              onClick={() => { setShowXfer(!showXfer); setXfer(EMPTY_XFER); }}
              className="rounded-md border border-accent-500 px-3 py-2 text-sm font-medium text-accent-500 hover:bg-surface-2"
            >
              {showXfer ? "Close transfer" : "Record transfer"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(EMPTY_FORM); }}
              className="rounded-md bg-accent-500 px-3 py-2 text-sm font-medium text-surface-0 hover:bg-orange-500"
            >
              {showForm ? "Close" : "Add transaction"}
            </button>
          </div>
        )}
      </div>

      {showImport && !readOnly && <ImportPanel accounts={accounts} onImported={load} />}

      {showXfer && !readOnly && (
        <div className="rounded-xl border border-border-default bg-surface-1 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-text-primary">Record transfer between accounts</h3>
          <div className="flex flex-wrap gap-2">
            <input type="date" aria-label="Transfer date" value={xfer.date}
              onChange={(e) => setXfer({ ...xfer, date: e.target.value })} className={input} />
            <input type="number" step="0.01" min="0" aria-label="Transfer amount" placeholder="Amount"
              value={xfer.amount} onChange={(e) => setXfer({ ...xfer, amount: e.target.value })} className={input} />
            <select aria-label="From account" value={xfer.fromAccountId}
              onChange={(e) => setXfer({ ...xfer, fromAccountId: e.target.value })} className={input}>
              <option value="">From…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName ?? a.name}</option>)}
            </select>
            <select aria-label="To account" value={xfer.toAccountId}
              onChange={(e) => setXfer({ ...xfer, toAccountId: e.target.value })} className={input}>
              <option value="">To…</option>
              {accounts.filter((a) => a.id !== xfer.fromAccountId)
                .map((a) => <option key={a.id} value={a.id}>{a.displayName ?? a.name}</option>)}
            </select>
            <input type="text" aria-label="Transfer notes" placeholder="Notes" value={xfer.notes}
              onChange={(e) => setXfer({ ...xfer, notes: e.target.value })} className={`${input} grow`} />
            <button
              type="button"
              onClick={submitTransfer}
              disabled={busy || !xfer.date || !xfer.amount || !xfer.fromAccountId || !xfer.toAccountId}
              className="rounded-md bg-accent-500 px-3 py-2 text-sm font-medium text-surface-0 hover:bg-orange-500 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Record transfer"}
            </button>
          </div>
          <p className="text-xs text-text-tertiary">
            Creates linked legs in both accounts — transfers never count as income or spend.
          </p>
        </div>
      )}

      {showForm && !readOnly && (
        <div className="rounded-xl border border-border-default bg-surface-1 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-text-primary">
            {editingId ? "Edit transaction" : "New transaction"}
          </h3>
          <div className="flex flex-wrap gap-2">
            <input type="date" aria-label="Date" value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })} className={input} />
            <input type="number" step="0.01" aria-label="Amount" placeholder="Amount (- = spend)"
              value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={input} />
            <input type="text" aria-label="Payee" placeholder="Payee" value={form.payee}
              onChange={(e) => setForm({ ...form, payee: e.target.value })} className={input} />
            <select aria-label="Category" value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })} className={input}>
              <option value="">Category…</option>
              {ctx.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select aria-label="Account" value={form.accountId}
              onChange={(e) => setForm({ ...form, accountId: e.target.value })} className={input}>
              <option value="">No account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <input type="text" aria-label="Notes" placeholder="Notes" value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`${input} grow`} />
            <button
              type="button"
              onClick={submit}
              disabled={busy || !form.date || !form.amount}
              className="rounded-md bg-accent-500 px-3 py-2 text-sm font-medium text-surface-0 hover:bg-orange-500 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {!ctx.eraConnected && <EraEmptyState />}

      <div className="rounded-xl border border-border-default bg-surface-1 overflow-x-auto">
        <table className="min-w-full divide-y divide-border-default">
          <thead className="bg-surface-2">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Date</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Payee</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Category</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Amount</th>
              <th className="px-4 py-3 w-32" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {txns.map((t) => (
              <tr key={`${t.source}-${t.id}`} className="hover:bg-surface-3">
                <td className="px-4 py-3 text-sm text-text-secondary whitespace-nowrap">{t.date}</td>
                <td className="px-4 py-3 text-sm text-text-primary">
                  {t.payee || "—"}
                  {t.source === "era" && <span className="ml-2"><EraBadge /></span>}
                  {(t.transferId || t.category === "Transfer") && (
                    <span className="ml-2 rounded-full border border-border-hover px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-tertiary">
                      Transfer
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-text-secondary">{t.category}</td>
                <td className={`px-4 py-3 text-sm text-right font-medium ${t.amount < 0 ? "text-red-400" : "text-emerald-400"}`}>
                  {fmtMoney(t.amount)}
                </td>
                <td className="px-4 py-3 text-sm text-right space-x-3">
                  {!readOnly && t.source === "local" && (
                    <>
                      <button type="button" onClick={() => startEdit(t)} className="text-accent-500 hover:text-orange-400">
                        Edit
                      </button>
                      <button type="button" onClick={() => remove(t)} className="text-text-tertiary hover:text-red-400">
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {txns.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-sm text-text-tertiary">No transactions found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!readOnly && <RulesSection categories={ctx.categories} />}

      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
};

export default TransactionsTab;
