import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftIcon, Bars3Icon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith("http://") || s.toLowerCase().startsWith("https://")) return s;
  return `https://${s.replace(/^https?:\/\//i, "")}`;
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}

const OurPropertiesAdminPage: React.FC = () => {
  const { user } = useAuth();
  const [sites, setSites] = useState<string[]>([]);
  const [displayOrder, setDisplayOrder] = useState<"custom" | "a-z" | "z-a">("custom");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [newUrl, setNewUrl] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canEdit = hasRole(user ?? null, "manager");

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
      const resp = await fetchWithAuth(`${apiBase}/admin/other-properties/our-properties/sites`);
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
    if (canEdit) loadSites();
  }, [canEdit, loadSites]);

  const saveSites = async (updated: string[]) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setIsSaving(true);
    setMessage(null);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/other-properties/our-properties/sites`, {
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
    const url = normalizeUrl(newUrl);
    if (!url) return;
    if (sites.includes(url)) {
      setError("URL already in list.");
      return;
    }
    const updated = [...sites, url];
    setNewUrl("");
    setError(null);
    saveSites(updated);
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setEditingValue(displayedSites[index]);
  };

  const saveEdit = () => {
    if (editingIndex === null) return;
    const url = normalizeUrl(editingValue);
    if (!url) {
      setError("Invalid URL.");
      return;
    }
    const oldUrl = displayedSites[editingIndex];
    if (sites.filter((u) => u === url).length > (url === oldUrl ? 1 : 0)) {
      setError("URL already in list.");
      return;
    }
    setError(null);
    const updated = sites.map((u) => (u === oldUrl ? url : u));
    setSites(updated);
    saveSites(updated);
    setEditingIndex(null);
    setEditingValue("");
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditingValue("");
  };

  const displayedSites = useMemo(() => {
    if (displayOrder === "custom") return [...sites];
    const copy = [...sites];
    copy.sort((a, b) => {
      const da = domainFromUrl(a);
      const db = domainFromUrl(b);
      return displayOrder === "a-z" ? da.localeCompare(db) : db.localeCompare(da);
    });
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
    setError(null);
    saveSites(updated);
  };

  if (!canEdit) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Our Properties</h1>
        <p className="text-sm text-slate-400">
          Only Manager or SuperAdmin users can edit the our properties sites list.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Our Properties</h1>
        <p className="text-sm text-slate-400">Loading sites…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/other-properties/our-properties"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Our Properties
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Our Properties</h1>
        <p className="text-sm text-slate-400">
          Edit the list of sites shown on the Our Properties dashboard. Manager or SuperAdmin can change this.
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
            <label htmlFor="newUrl" className="block text-xs font-medium text-slate-400 mb-1">
              Add URL
            </label>
            <input
              id="newUrl"
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://example.com or example.com"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
            />
          </div>
          <button
            type="submit"
            disabled={isSaving || !newUrl.trim()}
            className="rounded-md bg-brand-orange px-4 py-2 text-sm font-medium text-slate-950 hover:bg-orange-500 disabled:opacity-50"
          >
            Add
          </button>
        </form>

        <ul className="space-y-2">
          {displayedSites.map((url, index) => (
            <li
              key={url}
              draggable={displayOrder === "custom" && editingIndex === null}
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
              } ${displayOrder === "custom" && editingIndex === null ? "cursor-grab active:cursor-grabbing" : ""}`}
            >
              {displayOrder === "custom" && (
                <Bars3Icon className="h-4 w-4 flex-shrink-0 text-slate-500" aria-hidden />
              )}
              {editingIndex === index ? (
                <input
                  type="text"
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onBlur={saveEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit();
                    if (e.key === "Escape") cancelEdit();
                  }}
                  autoFocus
                  className="flex-1 rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-50 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit(index)}
                  className="font-medium text-slate-200 break-all flex-1 text-left hover:text-brand-orange hover:underline"
                >
                  {domainFromUrl(url)}
                </button>
              )}
              <button
                type="button"
                onClick={() => handleRemove(url)}
                disabled={isSaving || editingIndex !== null}
                className="flex-shrink-0 rounded-md border border-red-500/60 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        {displayedSites.length === 0 && (
          <p className="text-sm text-slate-500">No sites yet. Add a URL above.</p>
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
      </section>
    </div>
  );
};

export default OurPropertiesAdminPage;
