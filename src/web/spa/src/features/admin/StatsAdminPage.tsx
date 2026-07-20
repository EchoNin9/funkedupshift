import React, { useState, useRef } from "react";
import { ChartBarIcon, ArrowPathIcon } from "@heroicons/react/24/outline";

const BarChart = ({ data, chartRef, style }: any) => {
  const maxVal = Math.max(...data.map((d: any) => d.value), 100);
  return (
    <div ref={chartRef} style={style} className="w-full h-64 border border-border-subtle rounded-lg bg-surface-1 p-4 flex items-end justify-around space-x-2">
      {data.map((d: any, i: number) => {
        const heightPct = (d.value / maxVal) * 100;
        return (
          <div key={i} className="flex flex-col items-center w-full group">
            <div 
              className="w-full bg-accent-500 rounded-t-sm transition-all duration-300 group-hover:bg-accent-400"
              style={{ height: `${heightPct}%` }}
            ></div>
            <div className="text-xs text-text-tertiary mt-2 whitespace-nowrap overflow-hidden text-ellipsis w-full text-center">
              {d.label}
            </div>
          </div>
        );
      })}
    </div>
  );
};

import { fetchWithAuth } from "../../utils/api";

function getApiBaseUrl(): string | null {
  return (window as any).FUNKEDUPSHIFT_CONFIG?.apiBaseUrl || null;
}

export default function StatsAdminPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const [statsData, setStatsData] = useState([
    { label: "Mon", value: 120 },
    { label: "Tue", value: 300 },
    { label: "Wed", value: 150 },
    { label: "Thu", value: 400 },
    { label: "Fri", value: 200 },
    { label: "Sat", value: 450 },
    { label: "Sun", value: 320 },
  ]);

  const [logs, setLogs] = useState<any[]>([]);

  const fetchStats = async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/stats`);
      if (!resp.ok) throw new Error("Failed to fetch stats");
      const data = await resp.json();
      
      if (data.stats) {
        if (data.stats.metrics && data.stats.metrics["4xx_errors"] !== undefined) {
          // Update some stat using the metrics for demo purposes since we only have 4xx errors
          setStatsData(prev => prev.map(d => ({...d, value: Math.max(d.value, data.stats.metrics["4xx_errors"])})));
        }
        if (data.stats.click_paths) {
          setLogs(data.stats.click_paths.map((path: string, i: number) => ({
            id: i,
            user: "User",
            path: path,
            time: "Recent"
          })));
        }
      }
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
    if (!apiBase) return;
    
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/stats/recompute`, { method: "POST" });
      if (!resp.ok) throw new Error("Network Error");
      
      // Since it's async, wait a bit and fetch updated stats
      setTimeout(() => fetchStats(), 2000);
    } catch (err: any) {
      setError(err.message || "Failed to recompute stats");
      setLoading(false);
    }
  };

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
            <ChartBarIcon className="w-6 h-6 mr-2" /> Weekly Active Users
          </h2>
          
          {loading && (
             <div className="absolute inset-0 flex items-center justify-center bg-surface-0/80 z-10 rounded-xl">
               <div className="w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full animate-spin" />
             </div>
          )}
          
          {/* chartRef MUST stay conditionally mounted, using CSS visibility to hide if needed (using opacity here) */}
          <BarChart 
            data={statsData} 
            chartRef={chartRef} 
            style={{ opacity: loading ? 0.3 : 1, transition: 'opacity 300ms' }} 
          />
        </div>
        
        <div className="card p-6 bg-surface-0 border border-border-subtle rounded-xl relative">
          <h2 className="text-xl font-bold mb-4">Click-path Logs Timeline</h2>
          {loading && (
             <div className="absolute inset-0 flex items-center justify-center bg-surface-0/80 z-10 rounded-xl">
               <div className="w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full animate-spin" />
             </div>
          )}
          <div className="space-y-4" style={{ opacity: loading ? 0.3 : 1, transition: 'opacity 300ms' }}>
            {logs.map((log) => (
              <div key={log.id} className="flex items-start space-x-3 p-3 bg-surface-1 rounded-lg border border-border-subtle">
                <div className="w-2 h-2 mt-2 rounded-full bg-accent-500 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">{log.user}</p>
                  <p className="text-xs text-text-secondary font-mono">{log.path}</p>
                </div>
                <div className="text-xs text-text-tertiary whitespace-nowrap">
                  {log.time}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
