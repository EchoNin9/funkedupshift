import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftIcon, Bars3Icon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

const InternetDashboardAdminPage: React.FC = () => {
  const { user } = useAuth();
  const [sites, setSites] = useState<string[]>([]);
  const [displayOrder, setDisplayOrder] = useState<"custom" | "a-z" | "z-a">("custom");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
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

  const displayedSites = useMemo(() => {
    if (displayOrder === "custom") return [...sites];
    const copy = [...sites];
    copy.sort((a, b) => (displayOrder === "a-z" ? a.localeCompare(b) : b.localeCompare(a)));
    return copy;
  }, [sites, displayOrder]);

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    setDragOverIndex(null);
    if (displayOrder !== "custom" || draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      return;
    }
    const reordered = [...displayedSites];
    const [removed] = reordered.splice(draggedIndex, 1);
    reordered.splice(dropIndex, 0, removed);
    setSites(reordered);
    saveSites(reordered);
    setDraggedIndex(null);
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
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-slate-200">Sites list ({sites.length})</h2>
          <div className="inline-flex rounded-md border border-slate-700 bg-slate-950 p-0.5">
            <button
              type="button"
              onClick={() => setDisplayOrder("custom")}
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                displayOrder === "custom" ? "bg-brand-orange text-slate-950" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Custom
            </button>
            <button
              type="button"
              onClick={() => setDisplayOrder("a-z")}
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                displayOrder === "a-z" ? "bg-brand-orange text-slate-950" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              A–Z
            </button>
            <button
              type="button"
              onClick={() => setDisplayOrder("z-a")}
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                displayOrder === "z-a" ? "bg-brand-orange text-slate-950" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Z–A
            </button>
          </div>
        </div>

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
          {displayedSites.map((domain, index) => (
            <li
              key={domain}
              draggable={displayOrder === "custom"}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDragEnd={handleDragEnd}
              onDrop={(e) => handleDrop(e, index)}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 ${
                draggedIndex === index
                  ? "border-brand-orange bg-slate-800 opacity-60"
                  : dragOverIndex === index
                  ? "border-brand-orange/70 bg-slate-800/80"
                  : "border-slate-700 bg-slate-900"
              } ${displayOrder === "custom" ? "cursor-grab active:cursor-grabbing" : ""}`}
            >
              {displayOrder === "custom" && (
                <Bars3Icon className="h-4 w-4 flex-shrink-0 text-slate-500" aria-hidden />
              )}
              <span className="font-medium text-slate-200 break-all flex-1">{domain}</span>
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
