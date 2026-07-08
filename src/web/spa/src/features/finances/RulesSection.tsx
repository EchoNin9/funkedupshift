import React, { useCallback, useEffect, useState } from "react";
import { Alert } from "../../components";
import { apiGet, apiSend } from "./api";

export interface Rule {
  match: "contains" | "starts_with" | "equals";
  pattern: string;
  category: string;
  source?: string;
}

const MATCH_LABELS: { value: Rule["match"]; label: string }[] = [
  { value: "contains", label: "Contains" },
  { value: "starts_with", label: "Starts with" },
  { value: "equals", label: "Equals" },
];

const RulesSection: React.FC<{ categories: string[] }> = ({ categories }) => {
  const [rules, setRules] = useState<Rule[]>([]);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<{ rules: Rule[] }>("/finances/rules")
      .then((d) => setRules(d.rules))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const updateRule = (idx: number, patch: Partial<Rule>) => {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const moveRule = (idx: number, delta: -1 | 1) => {
    setRules((prev) => {
      const j = idx + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const removeRule = (idx: number) => {
    setRules((prev) => prev.filter((_, i) => i !== idx));
  };

  const addRule = () => {
    setRules((prev) => [...prev, { match: "contains", pattern: "", category: "", source: "manual" }]);
  };

  const saveRules = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = rules.filter((r) => r.pattern.trim() && r.category.trim());
      await apiSend("PUT", "/finances/rules", { rules: payload });
      load();
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const applyRules = async () => {
    setApplying(true);
    setError(null);
    setNotice(null);
    try {
      const d = await apiSend<{ updated: number }>("POST", "/finances/rules/apply");
      setNotice(`Recategorized ${d.updated} transactions.`);
    } catch (e: any) {
      setError(e?.message ?? "Apply failed");
    } finally {
      setApplying(false);
    }
  };

  const input = "rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary";

  return (
    <div className="rounded-xl border border-border-default bg-surface-1 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-medium text-text-primary">Category rules</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Rules run first-match-wins on new and imported transactions.
        </p>
      </div>

      <div className="space-y-2">
        {rules.map((r, idx) => (
          <div key={idx} className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Match mode"
              value={r.match}
              onChange={(e) => updateRule(idx, { match: e.target.value as Rule["match"] })}
              className={input}
            >
              {MATCH_LABELS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <input
              type="text"
              aria-label="Payee pattern"
              placeholder="Payee pattern"
              value={r.pattern}
              onChange={(e) => updateRule(idx, { pattern: e.target.value })}
              className={`${input} flex-1 min-w-[8rem]`}
            />
            <select
              aria-label="Category"
              value={r.category}
              onChange={(e) => updateRule(idx, { category: e.target.value })}
              className={input}
            >
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Move rule up"
              onClick={() => moveRule(idx, -1)}
              disabled={idx === 0}
              className="text-xs text-text-tertiary hover:text-text-primary disabled:opacity-50"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Move rule down"
              onClick={() => moveRule(idx, 1)}
              disabled={idx === rules.length - 1}
              className="text-xs text-text-tertiary hover:text-text-primary disabled:opacity-50"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => removeRule(idx)}
              className="text-xs text-text-tertiary hover:text-red-400"
            >
              Remove
            </button>
          </div>
        ))}
        {rules.length === 0 && (
          <p className="text-sm text-text-tertiary">No rules yet — add one below.</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={addRule}
          disabled={busy}
          className="rounded-md border border-accent-500 px-3 py-2 text-sm font-medium text-accent-500 disabled:opacity-50"
        >
          Add rule
        </button>
        <button
          type="button"
          onClick={saveRules}
          disabled={busy}
          className="rounded-md bg-accent-500 px-3 py-2 text-sm font-medium text-surface-0 hover:bg-orange-500 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save rules"}
        </button>
        <button
          type="button"
          onClick={applyRules}
          disabled={applying}
          className="rounded-md border border-accent-500 px-3 py-2 text-sm font-medium text-accent-500 disabled:opacity-50"
        >
          {applying ? "Applying…" : "Apply to uncategorized"}
        </button>
      </div>

      {notice && <p className="text-sm text-text-secondary">{notice}</p>}
      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
};

export default RulesSection;
