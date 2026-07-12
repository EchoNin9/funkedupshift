import React, { useCallback, useEffect, useState } from "react";
import { Alert } from "../../components";
import { apiGet, apiSend, fmtMoney, ownerParam, type Account, type Txn } from "./api";
import type { FinancesContext } from "./FinancesPage";
import EraBadge, { EraEmptyState } from "./EraBadge";
import ImportPanel from "./ImportPanel";
import RulesSection from "./RulesSection";
import CategoriesSection from "./CategoriesSection";

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
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkCategory, setBulkCategory] = useState("");
  const [pageSize, setPageSize] = useState(30);
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (filters.from) qs.set("from", filters.from);
    if (filters.to) qs.set("to", filters.to);
    if (filters.q) qs.set("q", filters.q);
    if (filters.category) qs.set("category", filters.category);
    apiGet<{ transactions: Txn[] }>(`/finances/transactions?${qs.toString()}${ownerParam(ctx.owner)}`)
      .then((d) => {
        setTxns(d.transactions);
        setSelectedIds([]);
        setPage(1);
      })
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

  const bulkCategorize = async () => {
    if (!bulkCategory || selectedIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend<{ updated: number }>("POST", "/finances/transactions/bulk-categorize",
        { ids: selectedIds, category: bulkCategory });
      setSelectedIds([]);
      setBulkCategory("");
      load();
    } catch (e: any) {
      setError(e?.message ?? "Bulk categorize failed");
    } finally {
      setBusy(false);
    }
  };

  // account/bank filter buttons: empty selection = show everything
  const txnKey = (t: Txn) => (t.source === "era" ? "era" : t.accountId || "none");
  const toggleKeys = (keys: string[]) => {
    setPage(1);
    setSelectedAccounts((prev) => {
      const allOn = keys.every((k) => prev.includes(k));
      return allOn ? prev.filter((k) => !keys.includes(k))
        : [...new Set([...prev, ...keys])];
    });
  };
  const banks = new Map<string, string[]>();
  for (const a of accounts) {
    const bank = a.bank || "Other";
    if (!banks.has(bank)) banks.set(bank, []);
    banks.get(bank)!.push(a.id);
  }
  const hasUnassigned = txns.some((t) => t.source === "local" && !t.accountId);

  const visible = selectedAccounts.length === 0
    ? txns
    : txns.filter((t) => selectedAccounts.includes(txnKey(t)));
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = visible.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selectableOnPage = pageRows.filter((t) => t.source === "local").map((t) => t.id);
  const allOnPageSelected = selectableOnPage.length > 0
    && selectableOnPage.every((id) => selectedIds.includes(id));

  const resultsTotal = visible.reduce((sum, t) => sum + t.amount, 0);

  const pill = (active: boolean) =>
    `rounded-full border border-accent-500 px-3 py-1 text-xs font-medium ${
      active ? "bg-accent-500 text-surface-0" : "text-accent-500 hover:bg-surface-2"
    }`;
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

      {(accounts.length > 0 || hasUnassigned || ctx.eraConnected) && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-text-tertiary">Accounts:</span>
          {[...banks.entries()].map(([bank, ids]) => (
            <React.Fragment key={bank}>
              {ids.length > 1 && (
                <button type="button" onClick={() => toggleKeys(ids)}
                  aria-pressed={ids.every((id) => selectedAccounts.includes(id))}
                  className={pill(ids.every((id) => selectedAccounts.includes(id)))}>
                  {bank} (all)
                </button>
              )}
              {ids.map((id) => {
                const a = accounts.find((x) => x.id === id)!;
                return (
                  <button key={id} type="button" onClick={() => toggleKeys([id])}
                    aria-pressed={selectedAccounts.includes(id)}
                    className={pill(selectedAccounts.includes(id))}>
                    {a.displayName ?? a.name}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
          {ctx.eraConnected && (
            <button type="button" onClick={() => toggleKeys(["era"])}
              aria-pressed={selectedAccounts.includes("era")}
              className={pill(selectedAccounts.includes("era"))}>
              Era
            </button>
          )}
          {hasUnassigned && (
            <button type="button" onClick={() => toggleKeys(["none"])}
              aria-pressed={selectedAccounts.includes("none")}
              className={pill(selectedAccounts.includes("none"))}>
              Unassigned
            </button>
          )}
          {selectedAccounts.length > 0 && (
            <button type="button" onClick={() => { setSelectedAccounts([]); setPage(1); }}
              className="text-xs text-text-tertiary hover:text-text-primary">
              Clear
            </button>
          )}
        </div>
      )}

      {!readOnly && selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center rounded-md border border-accent-500 bg-surface-1 px-4 py-2">
          <span className="text-sm text-text-primary">{selectedIds.length} selected</span>
          <select aria-label="Bulk category" value={bulkCategory}
            onChange={(e) => setBulkCategory(e.target.value)} className={input}>
            <option value="">Set category…</option>
            {ctx.categories.filter((c) => c !== "Transfer").map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" onClick={bulkCategorize} disabled={busy || !bulkCategory}
            className="rounded-md bg-accent-500 px-3 py-1.5 text-sm font-medium text-surface-0 hover:bg-orange-500 disabled:opacity-50">
            {busy ? "Applying…" : "Apply"}
          </button>
          <button type="button" onClick={() => setSelectedIds([])}
            className="ml-auto text-xs text-text-tertiary hover:text-text-primary">
            Clear selection
          </button>
        </div>
      )}

      <div className="rounded-xl border border-border-default bg-surface-1 overflow-x-auto">
        <table className="min-w-full divide-y divide-border-default">
          <thead className="bg-surface-2">
            <tr>
              {!readOnly && (
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" aria-label="Select all on page"
                    checked={allOnPageSelected}
                    onChange={() => setSelectedIds(allOnPageSelected
                      ? selectedIds.filter((id) => !selectableOnPage.includes(id))
                      : [...new Set([...selectedIds, ...selectableOnPage])])} />
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Date</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Payee</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Category</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">
                {visible.length > 0 && (
                  <span
                    className={`mb-1 block ml-auto w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold normal-case text-surface-0 ${
                      resultsTotal >= 0 ? "bg-emerald-500" : "bg-orange-500"
                    }`}
                    title="Total of all transactions in the current results"
                  >
                    {fmtMoney(resultsTotal)}
                  </span>
                )}
                Amount
              </th>
              <th className="px-4 py-3 w-32" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {pageRows.map((t) => (
              <tr key={`${t.source}-${t.id}`} className="hover:bg-surface-3">
                {!readOnly && (
                  <td className="px-4 py-3">
                    {t.source === "local" && (
                      <input type="checkbox" aria-label={`Select ${t.payee || t.id}`}
                        checked={selectedIds.includes(t.id)}
                        onChange={() => setSelectedIds(selectedIds.includes(t.id)
                          ? selectedIds.filter((id) => id !== t.id)
                          : [...selectedIds, t.id])} />
                    )}
                  </td>
                )}
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
            {visible.length === 0 && (
              <tr>
                <td colSpan={readOnly ? 5 : 6} className="px-4 py-3 text-sm text-text-tertiary">
                  No transactions found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {visible.length > 0 && (
        <div className="flex flex-wrap gap-3 items-center text-sm text-text-secondary">
          <button type="button" onClick={() => setPage(safePage - 1)} disabled={safePage <= 1}
            className="rounded-md border border-border-hover px-3 py-1 hover:bg-surface-2 disabled:opacity-40">
            ‹ Prev
          </button>
          <span>Page {safePage} of {pageCount} — {visible.length} transaction(s)</span>
          <button type="button" onClick={() => setPage(safePage + 1)} disabled={safePage >= pageCount}
            className="rounded-md border border-border-hover px-3 py-1 hover:bg-surface-2 disabled:opacity-40">
            Next ›
          </button>
          <label htmlFor="finPageSize" className="ml-auto text-xs text-text-tertiary">Rows per page</label>
          <input id="finPageSize" type="number" min={1} max={50} value={pageSize}
            onChange={(e) => {
              const n = Math.max(1, Math.min(50, parseInt(e.target.value || "30", 10) || 30));
              setPageSize(n);
              setPage(1);
            }}
            className={`${input} w-20`} />
        </div>
      )}

      {!readOnly && <CategoriesSection categories={ctx.categories} onChanged={ctx.reloadConfig} />}

      {!readOnly && <RulesSection categories={ctx.categories} />}

      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
};

export default TransactionsTab;
