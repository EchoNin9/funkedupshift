import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth, hasRole } from "../../shell/AuthContext";
import { fetchWithAuthOptional } from "../../utils/api";

const CACHE_KEY = "funkedupshift_internet_dashboard";
const CACHE_TTL_MS = 5 * 60 * 1000;

interface DashboardSite {
  domain: string;
  status: string;
  responseTimeMs?: number;
}

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

function getCachedSites(): DashboardSite[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.sites || !parsed?.lastFetchTime) return null;
    const age = Date.now() - new Date(parsed.lastFetchTime).getTime();
    if (age >= CACHE_TTL_MS) return null;
    return parsed.sites;
  } catch {
    return null;
  }
}

function setCachedSites(sites: DashboardSite[]): void {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ sites, lastFetchTime: new Date().toISOString() })
    );
  } catch {
    /* ignore */
  }
}

const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const [sites, setSites] = useState<DashboardSite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const apiBase = getApiBaseUrl();
    const cached = getCachedSites();

    if (cached && cached.length > 0) {
      setSites(cached);
      setIsLoading(false);
      setError(null);
      return;
    }

    if (!apiBase) {
      setError("API URL not set.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const resp = await fetchWithAuthOptional(`${apiBase}/internet-dashboard`);
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { sites?: DashboardSite[] };
      const list = Array.isArray(data.sites) ? data.sites : [];
      if (list.length > 0) {
        setCachedSites(list);
        setSites(list);
      } else {
        setError(cached?.length ? undefined : "No data returned.");
        if (cached?.length) setSites(cached);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load dashboard.";
      if (cached && cached.length > 0) {
        setSites(cached);
        setError(null);
      } else {
        setError(msg);
        setSites([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
        Internet dashboard
      </h1>
      <div className="rounded-xl border border-teal-800/60 bg-gradient-to-br from-teal-900/40 to-teal-950/60 p-4 shadow-lg">
        <p className="text-sm font-medium text-teal-100">
          Live status of popular sites
        </p>
        <p className="mt-1 text-xs text-teal-200/80">
          Refreshes when data is older than 5 minutes
        </p>
        {hasRole(user ?? null, "superadmin") && (
          <p className="mt-2">
            <Link to="/admin/internet-dashboard" className="text-brand-orange hover:text-orange-400 text-sm">
              Edit sites list
            </Link>
          </p>
        )}
      </div>

      {isLoading && (
        <p className="text-sm text-slate-400">Loading…</p>
      )}

      {error && !sites.length && (
        <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        {sites.map((s) => {
          const status = (s.status || "down").toLowerCase();
          const statusClass =
            status === "up"
              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
              : status === "degraded"
              ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
              : "border-red-500/50 bg-red-500/15 text-red-200";
          const rtStr =
            s.responseTimeMs != null ? `${s.responseTimeMs} ms` : null;
          return (
            <div
              key={s.domain}
              className={`rounded-lg border p-3 text-center text-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${statusClass}`}
            >
              <a
                href={`https://${s.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold break-all hover:underline block"
              >
                {s.domain}
              </a>
              <div className="mt-1 text-xs capitalize opacity-90">{status}</div>
              {rtStr && (
                <div className="mt-0.5 text-[11px] opacity-75">{rtStr}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DashboardPage;
