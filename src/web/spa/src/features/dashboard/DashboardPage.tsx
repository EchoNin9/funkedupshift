import React, { useEffect, useState } from "react";

interface DashboardData {
  ok?: boolean;
  sitesCount?: number;
  mediaCount?: number;
}

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

const DashboardPage: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setError("API URL not set.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${apiBase}/internet-dashboard`);
        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${txt}`);
        }
        const body = (await resp.json()) as DashboardData;
        if (!cancelled) setData(body);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load dashboard.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Internet dashboard</h1>
      {error && (
        <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 mb-1">API</p>
          <p className="text-sm text-slate-200">{data?.ok ? "Healthy" : "Unknown"}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 mb-1">Sites</p>
          <p className="text-sm text-slate-200">
            {typeof data?.sitesCount === "number" ? data?.sitesCount : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 mb-1">Media</p>
          <p className="text-sm text-slate-200">
            {typeof data?.mediaCount === "number" ? data?.mediaCount : "—"}
          </p>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;

