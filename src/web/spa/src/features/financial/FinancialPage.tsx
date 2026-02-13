import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth, canAccessFinancial, canAccessFinancialAdmin } from "../../shell/AuthContext";
import { fetchWithAuth } from "../../utils/api";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  source: string;
}

const FinancialPage: React.FC = () => {
  const { user } = useAuth();
  const access = canAccessFinancial(user);
  const canAdmin = canAccessFinancialAdmin(user);

  const [symbols, setSymbols] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote | null>>({});
  const [source, setSource] = useState<string>("yahoo");
  const [availableSources, setAvailableSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadWatchlist = useCallback(async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setLoading(true);
    setError(null);
    try {
      const [watchResp, configResp] = await Promise.all([
        fetchWithAuth(`${apiBase}/financial/watchlist`),
        fetchWithAuth(`${apiBase}/financial/config`)
      ]);
      const cfg = configResp.ok
        ? ((await configResp.json()) as { symbols?: string[]; source?: string; availableSources?: string[] })
        : { symbols: [] as string[], source: "yahoo", availableSources: ["yahoo"] as string[] };
      if (watchResp.ok) {
        const w = (await watchResp.json()) as { symbols?: string[] };
        const syms = w.symbols ?? [];
        setSymbols(syms.length > 0 ? syms : (cfg.symbols ?? []));
        setSource(cfg.source ?? "yahoo");
        setAvailableSources(cfg.availableSources ?? ["yahoo"]);
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load watchlist");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  const fetchQuotes = useCallback(async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase || symbols.length === 0) return;
    const next: Record<string, Quote | null> = {};
    for (const sym of symbols) {
      try {
        const resp = await fetchWithAuth(
          `${apiBase}/financial/quote?symbol=${encodeURIComponent(sym)}&source=${encodeURIComponent(source)}`
        );
        if (resp.ok) {
          const q = (await resp.json()) as Quote;
          next[sym] = q;
        } else {
          next[sym] = null;
        }
      } catch {
        next[sym] = null;
      }
    }
    setQuotes(next);
  }, [symbols, source, fetchWithAuth]);

  useEffect(() => {
    if (access) loadWatchlist();
  }, [access, loadWatchlist]);

  useEffect(() => {
    if (access && symbols.length > 0) fetchQuotes();
    else setQuotes({});
  }, [access, symbols, source, fetchQuotes]);

  const handleAddSymbol = () => {
    const s = newSymbol.trim().toUpperCase();
    if (!s || symbols.includes(s)) return;
    setSymbols((prev) => [...prev, s]);
    setNewSymbol("");
  };

  const handleRemoveSymbol = (s: string) => {
    setSymbols((prev) => prev.filter((x) => x !== s));
    setQuotes((prev) => {
      const next = { ...prev };
      delete next[s];
      return next;
    });
  };

  const handleSaveWatchlist = async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/financial/watchlist`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols })
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Failed to save");
      }
      setMessage("Watchlist saved.");
    } catch (e: any) {
      setError(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!access) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-slate-100">Financial</h1>
        <div className="rounded-md bg-amber-900/30 border border-amber-800/50 px-4 py-3 text-sm text-amber-200">
          You do not have access to the Financial section. Join the Financial custom group or contact an admin.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-100">Financial</h1>

      {canAdmin && (
        <p className="text-sm text-slate-400">
          <Link to="/admin/financial" className="text-brand-orange hover:text-orange-400">
            Financial Admin
          </Link>
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
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
            {availableSources.length > 1 && (
              <div className="ml-4">
                <label className="block text-xs text-slate-500 mb-1">Data source</label>
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
            )}
          </div>

          {symbols.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
              <table className="min-w-full divide-y divide-slate-800">
                <thead className="bg-slate-900/80">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Symbol</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">Price</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">Change</th>
                    <th className="px-4 py-3 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {symbols.map((sym) => {
                    const q = quotes[sym];
                    return (
                      <tr key={sym} className="hover:bg-slate-800/50">
                        <td className="px-4 py-3 text-sm font-medium text-slate-200">{sym}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-300">
                          {q ? `$${q.price.toFixed(2)}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-right">
                          {q ? (
                            <span className={q.change >= 0 ? "text-emerald-400" : "text-red-400"}>
                              {q.change >= 0 ? "+" : ""}
                              {q.change.toFixed(2)} ({q.changePercent >= 0 ? "+" : ""}
                              {q.changePercent.toFixed(2)}%)
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleRemoveSymbol(sym)}
                            className="text-slate-500 hover:text-red-400"
                            aria-label={`Remove ${sym}`}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {symbols.length > 0 && (
            <button
              type="button"
              onClick={handleSaveWatchlist}
              disabled={saving}
              className="rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-500 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save watchlist"}
            </button>
          )}

          {symbols.length === 0 && (
            <p className="text-sm text-slate-500">
              Add symbols above to build your watchlist. Default symbols from admin may appear when you first load.
            </p>
          )}
        </>
      )}

      {message && (
        <div className="rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
    </div>
  );
};

export default FinancialPage;
