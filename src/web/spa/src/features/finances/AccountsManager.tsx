import React, { useState } from "react";
import { Alert } from "../../components";
import { apiSend, type Account } from "./api";

const KINDS = ["checking", "savings", "credit", "cash", "asset", "liability"];
const EMPTY = { name: "", bank: "", accountNumber: "", nickname: "", kind: "checking", openingBalance: "", currency: "USD" };

/** Add/edit/delete manual accounts (bank, account number, nickname, opening balance). */
const AccountsManager: React.FC<{ accounts: Account[]; onChanged: () => void }> = ({ accounts, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (a: Account) => {
    setEditingId(a.id);
    setForm({
      name: a.name,
      bank: a.bank ?? "",
      accountNumber: "", // full number never comes back; leave blank to keep it
      nickname: a.nickname ?? "",
      kind: a.kind,
      openingBalance: String(a.openingBalance ?? 0),
      currency: a.currency,
    });
    setOpen(true);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { ...form, openingBalance: parseFloat(form.openingBalance || "0") };
      if (editingId && !form.accountNumber) {
        // don't wipe the stored number when the field was left blank on edit
        const existing = accounts.find((a) => a.id === editingId);
        if (existing?.accountNumberMasked) delete body.accountNumber;
      }
      if (editingId) {
        await apiSend("PUT", `/finances/accounts/${encodeURIComponent(editingId)}`, body);
      } else {
        await apiSend("POST", "/finances/accounts", body);
      }
      setForm(EMPTY);
      setEditingId(null);
      setOpen(false);
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: Account) => {
    if (!window.confirm(`Delete account "${a.displayName ?? a.name}"? Its transactions keep their history.`)) return;
    try {
      await apiSend("DELETE", `/finances/accounts/${encodeURIComponent(a.id)}`);
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
    }
  };

  const input = "rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary";
  const locals = accounts.filter((a) => a.source === "local");

  return (
    <div className="rounded-xl border border-border-default bg-surface-1 p-4 space-y-3">
      <div className="flex items-center">
        <h2 className="text-sm font-semibold text-text-primary uppercase">Accounts</h2>
        <button
          type="button"
          onClick={() => { setOpen(!open); setEditingId(null); setForm(EMPTY); }}
          className="ml-auto rounded-md bg-accent-500 px-3 py-1.5 text-sm font-medium text-surface-0 hover:bg-orange-500"
        >
          {open ? "Close" : "Add account"}
        </button>
      </div>

      {open && (
        <div className="flex flex-wrap gap-2 items-end">
          <input type="text" aria-label="Account name" placeholder="Name (e.g. Chequing)" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
          <input type="text" aria-label="Bank" placeholder="Bank (RBC, TD…)" value={form.bank}
            onChange={(e) => setForm({ ...form, bank: e.target.value })} className={input} />
          <input type="text" aria-label="Account number" value={form.accountNumber}
            placeholder={editingId ? "Account # (blank = keep)" : "Account number"}
            onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} className={input} />
          <input type="text" aria-label="Nickname" placeholder="Nickname (optional)" value={form.nickname}
            onChange={(e) => setForm({ ...form, nickname: e.target.value })} className={input} />
          <select aria-label="Kind" value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })} className={input}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input type="number" step="0.01" aria-label="Opening balance" placeholder="Opening balance"
            value={form.openingBalance}
            onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} className={input} />
          <button
            type="button"
            onClick={submit}
            disabled={busy || !form.name}
            className="rounded-md bg-accent-500 px-3 py-2 text-sm font-medium text-surface-0 hover:bg-orange-500 disabled:opacity-50"
          >
            {busy ? "Saving…" : editingId ? "Save account" : "Create account"}
          </button>
        </div>
      )}

      {locals.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {locals.map((a) => (
            <span key={a.id} className="text-text-tertiary">
              {a.displayName ?? a.name}
              <button type="button" onClick={() => startEdit(a)} className="ml-1 text-accent-500 hover:text-orange-400">edit</button>
              <button type="button" onClick={() => remove(a)} className="ml-1 hover:text-red-400">delete</button>
            </span>
          ))}
        </div>
      )}

      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
};

export default AccountsManager;
