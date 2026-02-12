import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

const InternetDashboardAdminPage: React.FC = () => {
  const { user } = useAuth();
  const [sites, setSites] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSuperAdmin = hasRole(user ?? null, "superadmin");

  const fetchWithAuth = useCallback(async (url: string, options?: RequestInit) => {
    const w = window as any;
    if (!w.auth?.getAccessToken) throw new Error("Not signed in");
    const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
    if (!token) throw new Error("Not signed in");
    const headers = { ...options?.headers, Authorization: `Bearer ${token}` };
    return fetch(url, { ...options, headers });
  }, []);

  const loadSites = useCallback(async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setError("API URL not set.");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/internet-dashboard/sites`);
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to load");
      }
      const data = (await resp.json()) as { sites?: string[] };
      setSites(Array.isArray(data.sites) ? data.sites : []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load sites.");
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    if (isSuperAdmin) loadSites();
  }, [isSuperAdmin, loadSites]);

  const saveSites = async (updated: string[]) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setIsSaving(true);
    setMessage(null);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/internet-dashboard/sites`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sites: updated }),
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to save");
      }
      setSites(updated);
      setMessage("Sites list saved.");
    } catch (e: any) {
      setError(e?.message ?? "Failed to save.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const domain = newDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!domain) return;
    if (sites.includes(domain)) {
      setError("Domain already in list.");
      return;
    }
    const updated = [...sites, domain];
    setNewDomain("");
    setError(null);
    saveSites(updated);
  };

  const handleRemove = (domain: string) => {
    const updated = sites.filter((s) => s !== domain);
    if (updated.length === 0) {
      setError("At least one site is required.");
      return;
    }
    setError(null);
    saveSites(updated);
  };

  if (!isSuperAdmin) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Internet Dashboard</h1>
        <p className="text-sm text-slate-400">
          Only SuperAdmin users can edit the dashboard sites list.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Internet Dashboard</h1>
        <p className="text-sm text-slate-400">Loading sites…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/internet-dashboard"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Internet Dashboard
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Internet Dashboard</h1>
        <p className="text-sm text-slate-400">
          Edit the list of sites shown on the Internet Dashboard. Only SuperAdmin can change this.
        </p>
      </header>

      <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-4 max-w-2xl">
        <h2 className="text-base font-semibold text-slate-200">Sites list ({sites.length})</h2>

        <form onSubmit={handleAdd} className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[12rem]">
            <label htmlFor="newDomain" className="block text-xs font-medium text-slate-400 mb-1">
              Add domain
            </label>
            <input
              id="newDomain"
              type="text"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="example.com"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
            />
          </div>
          <button
            type="submit"
            disabled={isSaving || !newDomain.trim()}
            className="rounded-md bg-brand-orange px-4 py-2 text-sm font-medium text-slate-950 hover:bg-orange-500 disabled:opacity-50"
          >
            Add
          </button>
        </form>

        <ul className="space-y-2">
          {sites.map((domain) => (
            <li
              key={domain}
              className="flex items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-2"
            >
              <span className="font-medium text-slate-200 break-all">{domain}</span>
              <button
                type="button"
                onClick={() => handleRemove(domain)}
                disabled={isSaving || sites.length <= 1}
                className="flex-shrink-0 rounded-md border border-red-500/60 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

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
      </section>
    </div>
  );
};

export default InternetDashboardAdminPage;
