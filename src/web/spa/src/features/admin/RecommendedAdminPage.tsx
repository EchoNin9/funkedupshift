import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeftIcon, Bars3Icon } from "@heroicons/react/24/outline";
import { StarIcon } from "@heroicons/react/24/solid";
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

interface SiteEntry {
  type?: "site" | "media";
  url?: string;
  id?: string;
  description: string;
  title?: string;
  logoKey?: string;
  thumbnailKey?: string;
  averageRating?: number;
}

type TabId = "highlights" | "highestRated";

interface TabConfig {
  id: TabId;
  label: string;
  fetchPath: string;
  savePath: string;
  generatePath: string;
  generateLabel: string;
  listLabel: string;
  emptyMessage: string;
  generateSuccessMessage: string;
  saveSuccessMessage: string;
  buttonClass: string;
  viewPath: string;
}

const TABS: TabConfig[] = [
  {
    id: "highlights",
    label: "Highlights",
    fetchPath: "/admin/recommended/highlights/sites",
    savePath: "/admin/recommended/highlights/sites",
    generatePath: "/admin/recommended/highlights/generate",
    generateLabel: "Generate new cache",
    listLabel: "Highlights list",
    emptyMessage: "No highlights yet. Generate from the highlight category or add a URL above.",
    generateSuccessMessage: "Cache generated from sites in the highlight category.",
    saveSuccessMessage: "Highlights list saved.",
    buttonClass: "bg-violet-600 hover:bg-violet-500",
    viewPath: "/recommended/highlights",
  },
  {
    id: "highestRated",
    label: "Highest Rated",
    fetchPath: "/admin/recommended/highest-rated/sites",
    savePath: "/admin/recommended/highest-rated/sites",
    generatePath: "/admin/recommended/highest-rated/generate",
    generateLabel: "Generate new cache",
    listLabel: "Highest rated list",
    emptyMessage: "No items yet. Generate from top 14 by star rating or add a URL above.",
    generateSuccessMessage: "Cache generated from top 14 sites and media by star rating.",
    saveSuccessMessage: "Highest rated list saved.",
    buttonClass: "bg-amber-600 hover:bg-amber-500",
    viewPath: "/recommended/highest-rated",
  },
];

interface ListTabProps {
  config: TabConfig;
}

const ListTab: React.FC<ListTabProps> = ({ config }) => {
  const [sites, setSites] = useState<SiteEntry[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [displayOrder, setDisplayOrder] = useState<"custom" | "a-z" | "z-a">("custom");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [newUrl, setNewUrl] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sitesRef = useRef<SiteEntry[]>([]);

  useEffect(() => {
    sitesRef.current = sites;
  }, [sites]);

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
    if (!apiBase) return;
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}${config.fetchPath}`);
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to load");
      }
      const data = (await resp.json()) as { sites?: SiteEntry[]; updatedAt?: string | null };
      const list = Array.isArray(data.sites) ? data.sites : [];
      setSites(list.map((s) => {
        if (typeof s === "string") return { type: "site" as const, url: s, description: "" };
        const t = s.type || "site";
        if (t === "media") {
          return {
            type: "media" as const,
            id: s.id || "",
            description: s.description || "",
            title: s.title,
            thumbnailKey: s.thumbnailKey,
            averageRating: s.averageRating,
          };
        }
        return {
          type: "site" as const,
          url: s.url || "",
          description: s.description || "",
          title: s.title,
          logoKey: s.logoKey,
          averageRating: s.averageRating,
        };
      }));
      setUpdatedAt(data.updatedAt ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load sites.");
    }
  }, [fetchWithAuth, config.fetchPath]);

  useEffect(() => {
    loadSites();
  }, [loadSites]);

  const generateCache = async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setIsGenerating(true);
    setMessage(null);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}${config.generatePath}`, { method: "POST" });
      const data = (await resp.json()) as { sites?: SiteEntry[]; updatedAt?: string | null; error?: string };
      if (!resp.ok) throw new Error(data.error || "Failed to generate");
      const list = Array.isArray(data.sites) ? data.sites : [];
      setSites(list.map((s) => {
        if (typeof s === "string") return { type: "site" as const, url: s, description: "" };
        const t = s.type || "site";
        if (t === "media") {
          return {
            type: "media" as const,
            id: s.id || "",
            description: s.description || "",
            title: s.title,
            thumbnailKey: s.thumbnailKey,
            averageRating: s.averageRating,
          };
        }
        return {
          type: "site" as const,
          url: s.url || "",
          description: s.description || "",
          title: s.title,
          logoKey: s.logoKey,
          averageRating: s.averageRating,
        };
      }));
      setUpdatedAt(data.updatedAt ?? null);
      setMessage(config.generateSuccessMessage);
    } catch (e: any) {
      setError(e?.message ?? "Failed to generate cache.");
    } finally {
      setIsGenerating(false);
    }
  };

  const saveSites = async (updated: SiteEntry[]) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setIsSaving(true);
    setMessage(null);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        sites: updated.map((s) => {
          if (s.type === "media") {
            return {
              type: "media",
              id: s.id,
              description: s.description,
              ...(s.title && { title: s.title }),
              ...(s.thumbnailKey && { thumbnailKey: s.thumbnailKey }),
              ...(s.averageRating != null && { averageRating: s.averageRating }),
            };
          }
          return {
            type: "site",
            url: s.url,
            description: s.description,
            ...(s.title && { title: s.title }),
            ...(s.logoKey && { logoKey: s.logoKey }),
            ...(s.averageRating != null && { averageRating: s.averageRating }),
          };
        }),
      };
      const resp = await fetchWithAuth(`${apiBase}${config.savePath}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as { updatedAt?: string | null; error?: string };
      if (!resp.ok) throw new Error(data.error || "Failed to save");
      setSites(updated);
      setMessage(config.saveSuccessMessage);
      setUpdatedAt(data.updatedAt ?? null);
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
    if (sites.some((s) => s.url === url)) {
      setError("URL already in list.");
      return;
    }
    setNewUrl("");
    setError(null);
    saveSites([...sites, { type: "site" as const, url, description: "" }]);
  };

  const getDisplayKey = (entry: SiteEntry) =>
    entry.type === "media" ? (entry.title || entry.id || "").toLowerCase() : domainFromUrl(entry.url || "").toLowerCase();

  const displayedSites = useMemo(() => {
    if (displayOrder === "custom") return [...sites];
    const copy = [...sites];
    copy.sort((a, b) => {
      const da = getDisplayKey(a);
      const db = getDisplayKey(b);
      return displayOrder === "a-z" ? da.localeCompare(db) : db.localeCompare(da);
    });
    return copy;
  }, [sites, displayOrder]);

  const startEdit = (index: number) => {
    const entry = displayedSites[index];
    if (entry.type === "media") return;
    setEditingIndex(index);
    setEditingValue(entry.url || "");
  };

  const saveEdit = () => {
    if (editingIndex === null) return;
    const url = normalizeUrl(editingValue);
    if (!url) {
      setError("Invalid URL.");
      return;
    }
    const oldEntry = displayedSites[editingIndex];
    if (oldEntry.type === "media") return;
    if (sites.some((s) => s.type === "site" && s.url === url && s.url !== oldEntry.url)) {
      setError("URL already in list.");
      return;
    }
    setError(null);
    const updated = sites.map((s) => (s.type === "site" && s.url === oldEntry.url ? { ...s, url } : s));
    setSites(updated);
    saveSites(updated);
    setEditingIndex(null);
    setEditingValue("");
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditingValue("");
  };

  const updateDescription = (entry: SiteEntry, description: string) => {
    setSites((prev) =>
      prev.map((s) => {
        const match = s.type === "media" ? s.id === entry.id : s.url === entry.url;
        return match ? { ...s, description: description.slice(0, 255) } : s;
      })
    );
  };

  const saveDescription = () => {
    saveSites(sitesRef.current);
  };

  const handleDragStart = (index: number) => setDraggedIndex(index);
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };
  const handleDragLeave = () => setDragOverIndex(null);
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
  const handleRemove = (entry: SiteEntry) => {
    setError(null);
    saveSites(sites.filter((s) => (s.type === "media" ? s.id !== entry.id : s.url !== entry.url)));
  };

  const formattedDate = updatedAt
    ? new Date(updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-4 max-w-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-slate-200">
            {config.listLabel} ({sites.length})
          </h2>
          {formattedDate && (
            <span className="text-xs text-slate-500">Cache was last updated {formattedDate}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={config.viewPath}
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            View
          </Link>
          <button
            type="button"
            onClick={generateCache}
            disabled={isGenerating}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${config.buttonClass}`}
          >
            {isGenerating ? "Generating…" : config.generateLabel}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-slate-700 bg-slate-950 p-0.5">
          {(["custom", "a-z", "z-a"] as const).map((order) => (
            <button
              key={order}
              type="button"
              onClick={() => setDisplayOrder(order)}
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                displayOrder === order ? "bg-brand-orange text-slate-950" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {order === "custom" ? "Custom" : order === "a-z" ? "A–Z" : "Z–A"}
            </button>
          ))}
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
      <ul className="space-y-3">
        {displayedSites.map((entry, index) => (
          <li
            key={entry.id || entry.url || index}
            draggable={displayOrder === "custom" && editingIndex === null}
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDragLeave}
            onDragEnd={handleDragEnd}
            onDrop={(e) => handleDrop(e, index)}
            className={`flex flex-col gap-2 rounded-md border px-3 py-2 ${
              draggedIndex === index
                ? "border-brand-orange bg-slate-800 opacity-60"
                : dragOverIndex === index
                ? "border-brand-orange/70 bg-slate-800/80"
                : "border-slate-700 bg-slate-900"
            } ${displayOrder === "custom" && editingIndex === null ? "cursor-grab active:cursor-grabbing" : ""}`}
          >
            <div className="flex items-center gap-2">
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
                entry.type === "media" ? (
                  <span className="font-medium text-slate-200 break-all flex-1">
                    {entry.title || entry.id}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => startEdit(index)}
                    className="font-medium text-slate-200 break-all flex-1 text-left hover:text-brand-orange hover:underline"
                  >
                    {domainFromUrl(entry.url || "")}
                  </button>
                )
              )}
              {config.id === "highestRated" && entry.averageRating != null && (
                <span className="flex items-center gap-0.5 text-amber-400 text-xs">
                  <StarIcon className="h-3.5 w-3.5" />
                  {entry.averageRating}
                </span>
              )}
                <button
                  type="button"
                  onClick={() => handleRemove(entry)}
                  disabled={isSaving || editingIndex !== null}
                className="flex-shrink-0 rounded-md border border-red-500/60 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
            <div>
              <label htmlFor={`desc-${config.id}-${index}`} className="block text-xs font-medium text-slate-400 mb-0.5">
                Description
              </label>
              <input
                id={`desc-${config.id}-${index}`}
                type="text"
                value={entry.description}
                onChange={(e) => updateDescription(entry, e.target.value)}
                onBlur={saveDescription}
                maxLength={255}
                placeholder="One-line description (255 chars max)"
                disabled={isSaving}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange disabled:opacity-50"
              />
              <span className="text-[10px] text-slate-500">{entry.description.length}/255</span>
            </div>
          </li>
        ))}
      </ul>
      {displayedSites.length === 0 && (
        <p className="text-sm text-slate-500">{config.emptyMessage}</p>
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
  );
};

const RecommendedAdminPage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: TabId =
    tabParam === "highest-rated" || tabParam === "highestRated" ? "highestRated" : "highlights";
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  useEffect(() => {
    if (tabParam === "highest-rated" || tabParam === "highestRated") {
      setActiveTab("highestRated");
    } else {
      setActiveTab("highlights");
    }
  }, [tabParam]);

  const setTab = (tab: TabId) => {
    setActiveTab(tab);
    setSearchParams({ tab: tab === "highestRated" ? "highest-rated" : tab }, { replace: true });
  };

  const canEdit = hasRole(user ?? null, "manager");
  const config = TABS.find((t) => t.id === activeTab) ?? TABS[0];

  if (!canEdit) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Recommended Admin</h1>
        <p className="text-sm text-slate-400">
          Only Manager or SuperAdmin users can edit the recommended caches.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/recommended/highlights"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Recommended
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Recommended Admin</h1>
        <p className="text-sm text-slate-400">
          Manage highlighted and highest-rated site lists. Generate from categories or star ratings, or edit manually.
        </p>
      </header>

      <div className="flex gap-2 border-b border-slate-800 pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium ${
              activeTab === t.id ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "highlights" && <ListTab config={TABS[0]} />}
      {activeTab === "highestRated" && <ListTab config={TABS[1]} />}
    </div>
  );
};

export default RecommendedAdminPage;
