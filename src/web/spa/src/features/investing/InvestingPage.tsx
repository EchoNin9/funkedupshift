import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useAuth, canAccessInvesting } from "../../shell/AuthContext";
import { fetchWithAuth } from "../../utils/api";
import { Alert } from "../../components";
import CandleChart, { Candle } from "./CandleChart";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  exchDisp: string;
  quoteType: string;
}

interface TickerData {
  symbol: string;
  meta: { price: number | null; currency: string | null; exchangeName: string | null; name: string };
  candles: Candle[];
  pe: { trailingPE: number | null; forwardPE: number | null };
}

const EXCLUDED_EXCHANGES_KEY = "investing.excludedExchanges";
const COMMODITY_CHIPS = ["GLD", "SLV", "GC=F", "SI=F"];
const RANGES = ["1mo", "6mo", "1y", "5y"] as const;

function loadExcluded(): string[] {
  try {
    const raw = localStorage.getItem(EXCLUDED_EXCHANGES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

const InvestingPage: React.FC = () => {
  const { user } = useAuth();
  const allowed = canAccessInvesting(user);

  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [aiResults, setAiResults] = useState(false);
  const [excluded, setExcluded] = useState<string[]>(loadExcluded);
  const [tracker, setTracker] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]>("1y");
  const [ticker, setTicker] = useState<TickerData | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiBase = getApiBaseUrl();

  useEffect(() => {
    if (!allowed || !apiBase) return;
    fetchWithAuth(`${apiBase}/investing/tracker`)
      .then((r) => (r.ok ? r.json() : { symbols: [] }))
      .then((d: { symbols?: string[] }) => setTracker(d.symbols ?? []))
      .catch(() => {});
  }, [allowed, apiBase]);

  useEffect(() => {
    if (!allowed || !apiBase || !selected) return;
    let cancelled = false;
    setBusy("ticker");
    setError(null);
    fetchWithAuth(`${apiBase}/investing/ticker?symbol=${encodeURIComponent(selected)}&range=${range}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No data");
        return r.json() as Promise<TickerData>;
      })
      .then((d) => {
        if (!cancelled) setTicker(d);
      })
      .catch((e: any) => {
        if (!cancelled) {
          setTicker(null);
          setError(e?.message ?? "Failed to load ticker");
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, apiBase, selected, range]);

  const runSearch = useCallback(
    async (ai: boolean) => {
      if (!apiBase || !query.trim()) return;
      setBusy(ai ? "suggest" : "search");
      setError(null);
      try {
        const resp = ai
          ? await fetchWithAuth(`${apiBase}/investing/suggest`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query: query.trim() }),
            })
          : await fetchWithAuth(`${apiBase}/investing/search?q=${encodeURIComponent(query.trim())}`);
        if (!resp.ok) {
          throw new Error(((await resp.json().catch(() => ({}))) as { error?: string }).error ?? "Search failed");
        }
        const d = (await resp.json()) as { results?: SearchResult[] };
        setResults(d.results ?? []);
        setAiResults(ai);
      } catch (e: any) {
        setError(e?.message ?? "Search failed");
      } finally {
        setBusy(null);
      }
    },
    [apiBase, query]
  );

  const saveTracker = useCallback(
    async (next: string[]) => {
      setTracker(next);
      if (!apiBase) return;
      try {
        await fetchWithAuth(`${apiBase}/investing/tracker`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols: next }),
        });
      } catch {
        setError("Failed to save tracker");
      }
    },
    [apiBase]
  );

  const toggleExchange = (ex: string) => {
    setExcluded((prev) => {
      const next = prev.includes(ex) ? prev.filter((e) => e !== ex) : [...prev, ex];
      try {
        localStorage.setItem(EXCLUDED_EXCHANGES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const viewSymbol = (sym: string) => {
    setSelected(sym);
    setAnalysis(null);
  };

  const analyze = async () => {
    if (!apiBase || !selected) return;
    setBusy("analyze");
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/investing/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: selected }),
      });
      if (!resp.ok) {
        throw new Error(((await resp.json().catch(() => ({}))) as { error?: string }).error ?? "Analysis failed");
      }
      const d = (await resp.json()) as { analysis: string };
      setAnalysis(d.analysis);
    } catch (e: any) {
      setError(e?.message ?? "Analysis failed");
    } finally {
      setBusy(null);
    }
  };

  if (!allowed) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-text-primary">Investing</h1>
        <p className="text-sm text-text-secondary">
          You need to be a member of the Financial group to access Investing. Contact an admin.
        </p>
      </div>
    );
  }

  const exchanges = [...new Set(results.map((r) => r.exchDisp).filter(Boolean))];
  const visibleResults = results.filter((r) => !excluded.includes(r.exchDisp));

  return (
    <div className="space-y-6">
      <motion.h1
        className="text-xl font-semibold text-text-primary"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        Investing
      </motion.h1>

      {/* Research */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="grow max-w-md">
          <label htmlFor="investingQuery" className="block text-xs text-text-tertiary mb-1">
            Research stocks &amp; commodities
          </label>
          <input
            id="investingQuery"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), runSearch(false))}
            placeholder="Company name, ticker, or ask AI: undervalued gold miners"
            className="w-full rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary"
          />
        </div>
        <button
          type="button"
          onClick={() => runSearch(false)}
          disabled={!query.trim() || busy === "search"}
          className="rounded-md bg-accent-500 px-3 py-2 text-sm font-medium text-surface-0 hover:bg-orange-500 disabled:opacity-50"
        >
          {busy === "search" ? "Searching…" : "Search"}
        </button>
        <button
          type="button"
          onClick={() => runSearch(true)}
          disabled={!query.trim() || busy === "suggest"}
          className="rounded-md border border-accent-500 px-3 py-2 text-sm font-medium text-accent-500 hover:bg-surface-2 disabled:opacity-50"
        >
          {busy === "suggest" ? "Asking AI…" : "AI Suggest"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-text-tertiary">Gold &amp; silver:</span>
        {COMMODITY_CHIPS.map((sym) => (
          <button
            key={sym}
            type="button"
            onClick={() => viewSymbol(sym)}
            className="rounded-full border border-border-hover bg-surface-1 px-3 py-1 text-xs text-text-primary hover:bg-surface-2"
          >
            {sym}
          </button>
        ))}
      </div>

      {exchanges.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-text-tertiary">Exchanges:</span>
          {exchanges.map((ex) => {
            const off = excluded.includes(ex);
            return (
              <button
                key={ex}
                type="button"
                onClick={() => toggleExchange(ex)}
                aria-pressed={!off}
                className={`rounded-full border px-3 py-1 text-xs ${
                  off
                    ? "border-border-default text-text-tertiary line-through"
                    : "border-accent-500 text-text-primary"
                }`}
              >
                {ex}
              </button>
            );
          })}
        </div>
      )}

      {results.length > 0 && (
        <div className="rounded-xl border border-border-default bg-surface-1 overflow-x-auto">
          <table className="min-w-full divide-y divide-border-default">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Symbol</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Exchange</th>
                <th className="px-4 py-3 w-32" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {visibleResults.map((r) => (
                <tr key={r.symbol} className="hover:bg-surface-3">
                  <td className="px-4 py-3 text-sm font-medium text-text-primary">{r.symbol}</td>
                  <td className="px-4 py-3 text-sm text-text-secondary">{r.name}</td>
                  <td className="px-4 py-3 text-sm text-text-secondary">{r.exchDisp}</td>
                  <td className="px-4 py-3 text-sm text-right space-x-3">
                    <button type="button" onClick={() => viewSymbol(r.symbol)} className="text-accent-500 hover:text-orange-400">
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => !tracker.includes(r.symbol) && saveTracker([...tracker, r.symbol])}
                      disabled={tracker.includes(r.symbol)}
                      className="text-accent-500 hover:text-orange-400 disabled:text-text-tertiary"
                    >
                      {tracker.includes(r.symbol) ? "Tracked" : "Track"}
                    </button>
                  </td>
                </tr>
              ))}
              {visibleResults.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-sm text-text-tertiary">
                    All results are on excluded exchanges.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {aiResults && (
            <p className="px-4 py-2 text-xs text-text-tertiary border-t border-border-default">
              AI suggestions validated against Yahoo Finance.
            </p>
          )}
        </div>
      )}

      {/* Detail */}
      {selected && (
        <motion.div
          className="rounded-xl border border-border-default bg-surface-1 p-4 space-y-4"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold text-text-primary">
              {ticker?.meta.name ?? selected}{" "}
              <span className="text-sm font-normal text-text-tertiary">
                {selected}
                {ticker?.meta.exchangeName ? ` · ${ticker.meta.exchangeName}` : ""}
              </span>
            </h2>
            <div className="ml-auto flex gap-1">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={`rounded-md px-2 py-1 text-xs ${
                    range === r ? "bg-accent-500 text-surface-0" : "text-text-secondary hover:bg-surface-2"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {busy === "ticker" ? (
            <div className="h-72 animate-pulse rounded bg-surface-3" />
          ) : ticker ? (
            <>
              <CandleChart candles={ticker.candles} />
              <div className="flex flex-wrap gap-6 text-sm">
                <span className="text-text-secondary">
                  Price:{" "}
                  <span className="text-text-primary font-medium">
                    {ticker.meta.price != null ? `${ticker.meta.price} ${ticker.meta.currency ?? ""}` : "—"}
                  </span>
                </span>
                <span className="text-text-secondary">
                  Trailing P/E:{" "}
                  <span className="text-text-primary font-medium">{ticker.pe.trailingPE?.toFixed(1) ?? "—"}</span>
                </span>
                <span className="text-text-secondary">
                  Forward P/E:{" "}
                  <span className="text-text-primary font-medium">{ticker.pe.forwardPE?.toFixed(1) ?? "—"}</span>
                </span>
                <button
                  type="button"
                  onClick={analyze}
                  disabled={busy === "analyze"}
                  className="ml-auto rounded-md border border-accent-500 px-3 py-1 text-xs font-medium text-accent-500 hover:bg-surface-2 disabled:opacity-50"
                >
                  {busy === "analyze" ? "Analyzing…" : "AI Analyze"}
                </button>
                <button
                  type="button"
                  onClick={() => !tracker.includes(selected) && saveTracker([...tracker, selected])}
                  disabled={tracker.includes(selected)}
                  className="rounded-md bg-accent-500 px-3 py-1 text-xs font-medium text-surface-0 hover:bg-orange-500 disabled:opacity-50"
                >
                  {tracker.includes(selected) ? "Tracked" : "Track"}
                </button>
              </div>
              {analysis && (
                <p className="rounded-md bg-surface-2 p-3 text-sm text-text-secondary whitespace-pre-wrap">{analysis}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-text-tertiary">No chart data for {selected}.</p>
          )}
        </motion.div>
      )}

      {/* Tracker */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-text-primary uppercase">My tracker</h2>
        {tracker.length === 0 ? (
          <p className="text-sm text-text-tertiary">Nothing tracked yet. Search above and hit Track.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tracker.map((sym) => (
              <span
                key={sym}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                  selected === sym ? "border-accent-500 text-text-primary" : "border-border-hover text-text-secondary"
                }`}
              >
                <button type="button" onClick={() => viewSymbol(sym)} className="hover:text-accent-500">
                  {sym}
                </button>
                <button
                  type="button"
                  onClick={() => saveTracker(tracker.filter((s) => s !== sym))}
                  className="text-text-tertiary hover:text-red-400"
                  aria-label={`Stop tracking ${sym}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
};

export default InvestingPage;
