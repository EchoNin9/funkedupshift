import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert } from "../../components";
import { apiGet, apiSend, type Share, type SharedWithMe } from "./api";
import type { FinancesContext } from "./FinancesPage";

const SECTIONS = ["dashboard", "transactions", "budgets", "insights"] as const;

const SharingTab: React.FC<{ ctx: FinancesContext }> = () => {
  const [shares, setShares] = useState<Share[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<SharedWithMe[]>([]);
  const [email, setEmail] = useState("");
  const [sections, setSections] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<{ shares: Share[] }>("/finances/shares")
      .then((d) => setShares(d.shares))
      .catch((e: Error) => setError(e.message));
    apiGet<{ sharedWithMe: SharedWithMe[] }>("/finances/shared-with-me")
      .then((d) => setSharedWithMe(d.sharedWithMe))
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  const toggleSection = (s: string) =>
    setSections((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const grant = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("PUT", "/finances/shares", { email: email.trim(), sections });
      setEmail("");
      setSections([]);
      load();
    } catch (e: any) {
      setError(e?.message ?? "Share failed");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (s: Share) => {
    if (!window.confirm(`Revoke ${s.granteeEmail}'s access?`)) return;
    try {
      await apiSend("DELETE", `/finances/shares/${encodeURIComponent(s.granteeId)}`);
      load();
    } catch (e: any) {
      setError(e?.message ?? "Revoke failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border-default bg-surface-1 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-text-primary uppercase">Grant read-only access</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="email"
            aria-label="Grantee email"
            placeholder="user@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary"
          />
          {SECTIONS.map((s) => (
            <label key={s} className="flex items-center gap-1 text-sm text-text-secondary capitalize">
              <input type="checkbox" checked={sections.includes(s)} onChange={() => toggleSection(s)} />
              {s}
            </label>
          ))}
          <button
            type="button"
            onClick={grant}
            disabled={busy || !email.trim() || sections.length === 0}
            className="rounded-md bg-accent-500 px-3 py-2 text-sm font-medium text-surface-0 hover:bg-orange-500 disabled:opacity-50"
          >
            {busy ? "Sharing…" : "Share"}
          </button>
        </div>
        <p className="text-xs text-text-tertiary">
          The person must already have an account here. They can view the chosen sections but never edit.
        </p>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-text-primary uppercase">My grants</h2>
        {shares.length === 0 && <p className="text-sm text-text-tertiary">You haven&apos;t shared with anyone.</p>}
        {shares.map((s) => (
          <div key={s.granteeId}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border-default bg-surface-1 px-4 py-3">
            <span className="text-sm text-text-primary">{s.granteeEmail}</span>
            <span className="text-xs text-text-tertiary">{s.sections.join(", ")}</span>
            <button type="button" onClick={() => revoke(s)}
              className="ml-auto text-xs text-text-tertiary hover:text-red-400">
              Revoke
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-text-primary uppercase">Shared with me</h2>
        {sharedWithMe.length === 0 && <p className="text-sm text-text-tertiary">Nobody has shared finances with you.</p>}
        {sharedWithMe.map((s) => (
          <div key={s.ownerId}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border-default bg-surface-1 px-4 py-3">
            <span className="text-sm text-text-primary">{s.ownerEmail}</span>
            <span className="text-xs text-text-tertiary">{s.sections.join(", ")}</span>
            <Link
              to={`/finances?owner=${encodeURIComponent(s.ownerId)}&ownerEmail=${encodeURIComponent(s.ownerEmail)}`}
              className="ml-auto text-sm text-accent-500 hover:text-orange-400"
            >
              View
            </Link>
          </div>
        ))}
      </div>

      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
};

export default SharingTab;
