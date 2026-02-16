import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth, canAccessFinancialAdmin } from "../../../shell/AuthContext";
import { AdminPageHeader } from "../../admin/AdminPageHeader";
import { AdminTabs } from "../../admin/AdminTabs";
import { fetchWithAuth } from "../../../utils/api";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

type TabId = "overview" | "members" | "symbols";

const FinancialAdminPage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: TabId =
    tabParam === "members" ? "members" : tabParam === "symbols" ? "symbols" : "overview";
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  const [symbols, setSymbols] = useState<string[]>([]);
  const [source, setSource] = useState<string>("yahoo");
  const [symbolsLoading, setSymbolsLoading] = useState(false);
  const [symbolsSaving, setSymbolsSaving] = useState(false);
  const [symbolsError, setSymbolsError] = useState<string | null>(null);
  const [symbolsMessage, setSymbolsMessage] = useState<string | null>(null);
  const [newSymbol, setNewSymbol] = useState("");
  const [availableSources] = useState(["yahoo", "alpha_vantage"]);

  useEffect(() => {
    if (tabParam === "members") setActiveTab("members");
    else if (tabParam === "symbols") setActiveTab("symbols");
    else setActiveTab("overview");
  }, [tabParam]);

  const setTab = (tab: TabId) => {
    setActiveTab(tab);
    const params = tab === "overview" ? {} : { tab };
    setSearchParams(params, { replace: true });
  };


  const loadDefaultSymbols = useCallback(async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setSymbolsLoading(true);
    setSymbolsError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/financial/default-symbols`);
      if (!resp.ok) throw new Error("Failed to load");
      const data = (await resp.json()) as { symbols?: string[]; source?: string };
      setSymbols(data.symbols ?? []);
      setSource(data.source ?? "yahoo");
    } catch (e: any) {
      setSymbolsError(e?.message ?? "Failed to load");
    } finally {
      setSymbolsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "symbols") loadDefaultSymbols();
  }, [activeTab, loadDefaultSymbols]);

  const handleAddSymbol = () => {
    const s = newSymbol.trim().toUpperCase();
    if (!s || symbols.includes(s)) return;
    setSymbols((prev) => [...prev, s]);
    setNewSymbol("");
  };

  const handleRemoveSymbol = (s: string) => {
    setSymbols((prev) => prev.filter((x) => x !== s));
  };

  const handleSaveSymbols = async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setSymbolsSaving(true);
    setSymbolsError(null);
    setSymbolsMessage(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/financial/default-symbols`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols, source })
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Failed to save");
      }
      setSymbolsMessage("Default symbols saved.");
    } catch (e: any) {
      setSymbolsError(e?.message ?? "Failed to save");
    } finally {
      setSymbolsSaving(false);
    }
  };

  const canAccess = canAccessFinancialAdmin(user);

  if (!canAccess) {
    return (
      <div className="space-y-6">
        <AdminPageHeader title="Financial Admin" description="SuperAdmin access is required." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Financial Admin"
        description="Manage Financial section settings, members, and data sources."
        actions={
          <Link to="/financial" className="btn-secondary text-sm !px-4 !py-2">
            View Financial
          </Link>
        }
      />

      <AdminTabs
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "symbols", label: "Tracked Symbols" },
          { id: "members", label: "Members" },
        ]}
        activeId={activeTab}
        onSelect={(id) => setTab(id as TabId)}
      />

      {activeTab === "overview" && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-sm text-slate-400">
          <p className="mb-2">Admin configuration:</p>
          <ul className="list-disc list-inside space-y-1 text-slate-500">
            <li>
              <strong>Tracked symbols</strong> – Default symbols for new users&apos; watchlists
            </li>
            <li>
              <strong>Data source</strong> – Yahoo Finance (no key) or Alpha Vantage (API key in Terraform)
            </li>
          </ul>
        </div>
      )}

      {activeTab === "symbols" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label htmlFor="newSymbol" className="block text-xs text-slate-500 mb-1">
                Add symbol
              </label>
              <input
                id="newSymbol"
                type="text"
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddSymbol())}
                placeholder="AAPL"
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 w-24"
              />
            </div>
            <button
              type="button"
              onClick={handleAddSymbol}
              disabled={!newSymbol.trim()}
              className="rounded-md bg-brand-orange px-3 py-2 text-sm font-medium text-slate-950 hover:bg-orange-500 disabled:opacity-50"
            >
              Add
            </button>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Default data source</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50"
            >
              {availableSources.map((s) => (
                <option key={s} value={s}>
                  {s === "yahoo" ? "Yahoo Finance" : "Alpha Vantage"}
                </option>
              ))}
            </select>
          </div>

          {symbols.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {symbols.map((s) => (
                <li
                  key={s}
                  className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-200"
                >
                  {s}
                  <button
                    type="button"
                    onClick={() => handleRemoveSymbol(s)}
                    className="text-slate-500 hover:text-red-400"
                    aria-label={`Remove ${s}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={handleSaveSymbols}
            disabled={symbolsSaving || symbolsLoading}
            className="rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-500 disabled:opacity-50"
          >
            {symbolsSaving ? "Saving…" : "Save defaults"}
          </button>

          {symbolsMessage && (
            <div className="rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {symbolsMessage}
            </div>
          )}
          {symbolsError && (
            <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {symbolsError}
            </div>
          )}
        </div>
      )}

      {activeTab === "members" && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-sm text-slate-400">
          <p className="mb-2">
            Financial access is RBAC-based: guests view default symbols (session-only custom symbols); logged-in users can save their watchlist. No custom group required.
          </p>
        </div>
      )}
    </div>
  );
};

export default FinancialAdminPage;
