import React, { useState } from "react";
import { ChartBarIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { fetchWithAuth } from "../../utils/api";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

interface DailyStats {
  date?: string;
  s3_log_lines?: number;
  metrics?: { [k: string]: number };
  click_paths?: string[];
}

export default function StatsAdminPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DailyStats | null>(null);

  const fetchStats = async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setError("API base URL not configured");
      setLoading(false);
      return;
    }
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/stats`);
      if (!resp.ok) throw new Error("Failed to fetch stats");
      const data = await resp.json();
      setStats(data.stats && Object.keys(data.stats).length > 0 ? data.stats : null);
    } catch (err: any) {
      setError(err.message || "Failed to load stats");
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchStats();
  }, []);

  const handleRecompute = async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setError("API base URL not configured");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/stats/recompute`, { method: "POST" });
      if (!resp.ok) throw new Error("Failed to trigger recompute");
      // Collector runs async; give it a moment then refetch (which clears loading).
      setTimeout(() => fetchStats(), 2000);
    } catch (err: any) {
      setError(err.message || "Failed to recompute stats");
      setLoading(false);
    }
  };

  const emptyState = (
    <p className="text-sm text-text-tertiary">
      No data yet — run Recompute or wait for the daily collector.
    </p>
  );

  return (
    <div className="container-max">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-extrabold uppercase tracking-tight text-text-primary">
            Statistics
          </h1>
          <p className="mt-2 text-text-secondary">
            View app statistics and per-user click paths.
          </p>
        </div>
        <button
          onClick={handleRecompute}
          disabled={loading}
          className="btn-primary flex items-center space-x-2 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg disabled:opacity-50"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <ArrowPathIcon className="w-5 h-5" />
          )}
          <span>{loading ? "Recomputing..." : "Recompute"}</span>
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        <div className="card p-6 bg-surface-0 border border-border-subtle rounded-xl relative">
          <h2 className="text-xl font-bold mb-4 flex items-center">
            <ChartBarIcon className="w-6 h-6 mr-2" />
            Daily Snapshot{stats?.date ? ` — ${stats.date}` : ""}
          </h2>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-0/80 z-10 rounded-xl">
              <div className="w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          <div style={{ opacity: loading ? 0.3 : 1, transition: "opacity 300ms" }}>
            {!stats ? (
              emptyState
            ) : (
              <dl className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-surface-1 rounded-lg border border-border-subtle">
                  <dt className="text-xs uppercase text-text-tertiary">CDN log lines</dt>
                  <dd className="text-2xl font-bold text-text-primary">{stats.s3_log_lines ?? 0}</dd>
                </div>
                <div className="p-4 bg-surface-1 rounded-lg border border-border-subtle">
                  <dt className="text-xs uppercase text-text-tertiary">API 4xx errors</dt>
                  <dd className="text-2xl font-bold text-text-primary">{stats.metrics?.["4xx_errors"] ?? 0}</dd>
                </div>
              </dl>
            )}
          </div>
        </div>

        <div className="card p-6 bg-surface-0 border border-border-subtle rounded-xl relative">
          <h2 className="text-xl font-bold mb-4">Click-path Logs Timeline</h2>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-0/80 z-10 rounded-xl">
              <div className="w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          <div className="space-y-4" style={{ opacity: loading ? 0.3 : 1, transition: "opacity 300ms" }}>
            {(stats?.click_paths ?? []).length === 0
              ? emptyState
              : (stats!.click_paths as string[]).map((path, i) => (
                  <div key={i} className="flex items-start space-x-3 p-3 bg-surface-1 rounded-lg border border-border-subtle">
                    <div className="w-2 h-2 mt-2 rounded-full bg-accent-500 flex-shrink-0" />
                    <p className="text-xs text-text-secondary font-mono flex-1">{path}</p>
                  </div>
                ))}
          </div>
        </div>
      </div>
    </div>
  );
}
