import React, { useState } from "react";
import { Alert } from "../../components";
import { apiSend, type Account } from "./api";

interface ImportResult {
  format: string;
  total: number;
  new: number;
  duplicates: number;
  routed: Record<string, number>;
  committed: boolean;
  transfersLinked?: number;
}

const EMPTY_MAPPING = { date: "", payee: "", amount: "", debit: "", credit: "", account: "", category: "", dateFormat: "" };

/** Upload an OFX/QFX/QIF/CSV statement: preview counts, then commit. */
const ImportPanel: React.FC<{ accounts: Account[]; onImported: () => void }> = ({ accounts, onImported }) => {
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [accountId, setAccountId] = useState("");
  const [mapping, setMapping] = useState(EMPTY_MAPPING);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locals = accounts.filter((a) => a.source === "local");
  const isCsv = !!file && /\.csv$/i.test(file.name);

  const pickFile = (f: File | undefined) => {
    setPreview(null);
    setError(null);
    if (!f) return setFile(null);
    f.text().then((content) => setFile({ name: f.name, content }));
  };

  const selectAccount = (id: string) => {
    setAccountId(id);
    const saved = locals.find((a) => a.id === id)?.csvMapping;
    if (saved) setMapping({ ...EMPTY_MAPPING, ...saved });
  };

  const run = async (commit: boolean) => {
    if (!file || !accountId) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        accountId, filename: file.name, content: file.content, commit,
      };
      if (isCsv) {
        body.mapping = Object.fromEntries(
          Object.entries(mapping).filter(([, v]) => v.trim() !== ""));
      }
      const result = await apiSend<ImportResult>("POST", "/finances/import", body);
      setPreview(result);
      if (commit) {
        setFile(null);
        onImported();
      }
    } catch (e: any) {
      setError(e?.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const input = "rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary";

  return (
    <div className="rounded-xl border border-border-default bg-surface-1 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-text-primary">Import bank file (OFX/QFX, QIF, CSV)</h3>
      <div className="flex flex-wrap gap-2 items-center">
        <input type="file" accept=".ofx,.qfx,.qif,.csv" aria-label="Statement file"
          onChange={(e) => pickFile(e.target.files?.[0])} className="text-sm text-text-secondary" />
        <select aria-label="Target account" value={accountId}
          onChange={(e) => selectAccount(e.target.value)} className={input}>
          <option value="">Target account…</option>
          {locals.map((a) => <option key={a.id} value={a.id}>{a.displayName ?? a.name}</option>)}
        </select>
      </div>

      {isCsv && (
        <div className="flex flex-wrap gap-2">
          <input type="text" placeholder="Date column*" aria-label="Date column" value={mapping.date}
            onChange={(e) => setMapping({ ...mapping, date: e.target.value })} className={input} />
          <input type="text" placeholder="Payee column*" aria-label="Payee column" value={mapping.payee}
            onChange={(e) => setMapping({ ...mapping, payee: e.target.value })} className={input} />
          <input type="text" placeholder="Amount column" aria-label="Amount column" value={mapping.amount}
            onChange={(e) => setMapping({ ...mapping, amount: e.target.value })} className={input} />
          <input type="text" placeholder="or Debit column" aria-label="Debit column" value={mapping.debit}
            onChange={(e) => setMapping({ ...mapping, debit: e.target.value })} className={input} />
          <input type="text" placeholder="+ Credit column" aria-label="Credit column" value={mapping.credit}
            onChange={(e) => setMapping({ ...mapping, credit: e.target.value })} className={input} />
          <input type="text" placeholder="Account # column" aria-label="Account column" value={mapping.account}
            onChange={(e) => setMapping({ ...mapping, account: e.target.value })} className={input} />
          <input type="text" placeholder="Category column" aria-label="Category column" value={mapping.category}
            onChange={(e) => setMapping({ ...mapping, category: e.target.value })} className={input} />
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" onClick={() => run(false)} disabled={busy || !file || !accountId}
          className="rounded-md border border-accent-500 px-3 py-2 text-sm font-medium text-accent-500 hover:bg-surface-2 disabled:opacity-50">
          {busy ? "Working…" : "Preview"}
        </button>
        <button type="button" onClick={() => run(true)} disabled={busy || !file || !accountId || !preview}
          className="rounded-md bg-accent-500 px-3 py-2 text-sm font-medium text-surface-0 hover:bg-orange-500 disabled:opacity-50">
          Commit import
        </button>
        {preview && (
          <span className="text-sm text-text-secondary">
            {preview.committed
              ? `Imported ${preview.new} transactions` +
                (preview.transfersLinked ? `, linked ${preview.transfersLinked} transfer pair(s)` : "") + "."
              : `${preview.new} new, ${preview.duplicates} duplicate(s) of ${preview.total} — commit to import.`}
          </span>
        )}
      </div>

      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
};

export default ImportPanel;
