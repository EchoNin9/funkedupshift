import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PencilSquareIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";

interface MediaCategory {
  id: string;
  name: string;
}

interface MediaItem {
  PK: string;
  title?: string;
  description?: string;
  averageRating?: number;
  mediaType?: "image" | "video" | string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  categories?: MediaCategory[];
}

type SortKey = "avgDesc" | "avgAsc" | "alphaAsc" | "alphaDesc";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

const PAGE_SIZE = 10;

const MediaPage: React.FC = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [categoryMode, setCategoryMode] = useState<"and" | "or">("and");
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [sort, setSort] = useState<SortKey>("avgDesc");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRate = !!user;
  const canEdit = hasRole(user ?? null, "manager");
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const [allCategoriesCache, setAllCategoriesCache] = useState<MediaCategory[]>([]);

  const availableCategories = useMemo(() => {
    const byId = new Map<string | undefined, MediaCategory>();
    items.forEach((m) => {
      (m.categories || []).forEach((c) => {
        if (c.id && !byId.has(c.id)) byId.set(c.id, c);
      });
    });
    return Array.from(byId.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [items]);

  useEffect(() => {
    if (selectedCategoryIds.length === 0 && availableCategories.length > 0) {
      setAllCategoriesCache(availableCategories);
    }
  }, [selectedCategoryIds.length, availableCategories]);

  const categoriesForDropdown = useMemo(() => {
    if (categoryMode === "or" && allCategoriesCache.length > 0) {
      return allCategoriesCache;
    }
    return availableCategories;
  }, [categoryMode, allCategoriesCache, availableCategories]);

  const filteredCategoryOptions = useMemo(() => {
    return categoriesForDropdown.filter(
      (c) =>
        !selectedCategoryIds.includes(c.id) &&
        (!categorySearch.trim() || (c.name || "").toLowerCase().includes(categorySearch.toLowerCase()))
    );
  }, [categoriesForDropdown, selectedCategoryIds, categorySearch]);

  const hasActiveSearch = search.trim().length > 0 || selectedCategoryIds.length > 0;

  useEffect(() => {
    if (!hasActiveSearch) {
      setItems([]);
      setPage(1);
      setIsLoading(false);
      setError(null);
      return;
    }
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setError("API URL not set. Deploy via CI or set window.API_BASE_URL in config.js.");
      return;
    }
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("limit", "100");
        if (search.trim()) params.set("q", search.trim());
        if (selectedCategoryIds.length > 0) {
          params.set("categoryIds", selectedCategoryIds.join(","));
          params.set("categoryMode", categoryMode);
        }
        const resp = await fetch(`${apiBase}/media?${params.toString()}`);
        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${txt}`);
        }
        const data = (await resp.json()) as { media?: MediaItem[] };
        if (cancelled) return;
        setItems(data.media ?? []);
        setPage(1);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load media.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [hasActiveSearch, search, selectedCategoryIds, categoryMode]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) {
        setCategoryDropdownOpen(false);
      }
    }
    if (categoryDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [categoryDropdownOpen]);

  const sortedItems = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const titleA = (a.title || a.PK || "").toLowerCase();
      const titleB = (b.title || b.PK || "").toLowerCase();
      const avgA = typeof a.averageRating === "number" ? a.averageRating : 0;
      const avgB = typeof b.averageRating === "number" ? b.averageRating : 0;
      if (sort === "avgDesc") {
        if (avgB !== avgA) return avgB - avgA;
        return titleA.localeCompare(titleB);
      }
      if (sort === "avgAsc") {
        if (avgA !== avgB) return avgA - avgB;
        return titleA.localeCompare(titleB);
      }
      if (sort === "alphaAsc") return titleA.localeCompare(titleB);
      if (sort === "alphaDesc") return titleB.localeCompare(titleA);
      return 0;
    });
    return copy;
  }, [items, sort]);

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE));
  const pageItems = sortedItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleRate = async (mediaId: string, rating: number) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth || typeof w.auth.getAccessToken !== "function") return;
    const token: string | null = await new Promise((resolve) => {
      w.auth.getAccessToken((t: string | null) => resolve(t));
    });
    if (!token) return;
    await fetch(`${apiBase}/media/stars`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ mediaId, rating })
    }).catch(() => {});
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Media</h1>
        <p className="text-sm text-slate-400">
          Images and videos attached to sites and experiments across Funkedupshift.
        </p>
      </header>

      <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-4" aria-label="Search and filter">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(search.trim());
          }}
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search media by title or description…"
            className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-500"
          >
            Search
          </button>
        </form>

        <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6">
          <div ref={categoryDropdownRef} className="relative flex-shrink-0 min-w-0 max-w-sm">
            <label htmlFor="media-category-filter" className="block text-xs font-medium text-slate-400 mb-1">
              Categories (filter by)
            </label>
            <input
              id="media-category-filter"
              type="text"
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
              onFocus={() => setCategoryDropdownOpen(true)}
              placeholder="Search and select categories…"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
              autoComplete="off"
            />
            {categoryDropdownOpen && (
              <div
                className="absolute left-0 top-full z-10 mt-1 w-full max-h-48 overflow-auto rounded-md border border-slate-700 bg-slate-900 shadow-lg"
                role="listbox"
                aria-label="Category options"
              >
                {filteredCategoryOptions.length > 0 ? (
                  filteredCategoryOptions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="option"
                      onClick={() => {
                        setSelectedCategoryIds((prev) => (prev.includes(c.id) ? prev : [...prev, c.id]));
                        setCategorySearch("");
                        // Keep dropdown open for multi-select (same as add media page)
                      }}
                      className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                    >
                      {c.name}
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-2 text-xs text-slate-500">
                    {categoriesForDropdown.length === 0 ? "Search media first to load categories." : "No matches or all selected."}
                  </p>
                )}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {selectedCategoryIds.map((cid) => {
                const c = categoriesForDropdown.find((x) => x.id === cid) ?? availableCategories.find((x) => x.id === cid);
                return (
                  <span
                    key={cid}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-200"
                  >
                    {c?.name ?? cid}
                    <button
                      type="button"
                      onClick={() => setSelectedCategoryIds((prev) => prev.filter((id) => id !== cid))}
                      className="hover:text-red-400"
                      aria-label="Remove category filter"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
            {selectedCategoryIds.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-slate-500">Match:</span>
                <div className="inline-flex rounded-md border border-slate-700 bg-slate-950 p-0.5">
                  <button
                    type="button"
                    onClick={() => setCategoryMode("and")}
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      categoryMode === "and" ? "bg-brand-orange text-slate-950" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    AND
                  </button>
                  <button
                    type="button"
                    onClick={() => setCategoryMode("or")}
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      categoryMode === "or" ? "bg-brand-orange text-slate-950" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    OR
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3 items-center text-xs text-slate-400">
            <span className="font-medium text-slate-200">Sort:</span>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as SortKey);
                setPage(1);
              }}
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-50 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
            >
              <option value="avgDesc">Avg stars (high first)</option>
              <option value="avgAsc">Avg stars (low first)</option>
              <option value="alphaAsc">Title A–Z</option>
              <option value="alphaDesc">Title Z–A</option>
            </select>
            <span className="text-slate-500">
              {!hasActiveSearch ? "" : sortedItems.length === 0 ? "No media found." : `${sortedItems.length} items`}
            </span>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      {!hasActiveSearch ? (
        <div className="flex items-center justify-center min-h-[280px]">
          <p className="text-2xl sm:text-3xl font-light text-slate-500/80 tracking-wide animate-pulse">
            Enter search term or select categories
          </p>
        </div>
      ) : isLoading ? (
        <div className="text-sm text-slate-400">Loading media…</div>
      ) : (
        <ul className="space-y-3">
          {pageItems.map((m) => {
            const thumb = m.thumbnailUrl || (m.mediaType === "image" ? m.mediaUrl : undefined);
            const title = m.title || m.PK || "Untitled";
            const mediaTypeLabel = m.mediaType === "video" ? "Video" : "Image";
            const detailLink = `/media/${encodeURIComponent(m.PK)}`;
            return (
              <li
                key={m.PK}
                className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3"
              >
                <Link
                  to={detailLink}
                  className="h-16 w-24 flex-shrink-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 flex items-center justify-center text-xl hover:border-slate-600"
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                      }}
                    />
                  ) : (
                    <span>{m.mediaType === "video" ? "▶" : "📷"}</span>
                  )}
                </Link>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-semibold text-slate-50">
                      <Link to={detailLink} className="hover:text-brand-orange">
                        {title}
                      </Link>
                    </h2>
                    {typeof m.averageRating === "number" && (
                      <span className="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[11px] text-amber-300">
                        {m.averageRating.toFixed(1)}★
                      </span>
                    )}
                    <span className="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                      {mediaTypeLabel}
                    </span>
                  </div>
                  {m.description && (
                    <p className="text-xs text-slate-300 line-clamp-3">{m.description}</p>
                  )}
                  {m.categories && m.categories.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {m.categories.map((c) => (
                        <span
                          key={c.id}
                          className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300"
                        >
                          {c.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {canEdit && (
                    <div className="pt-1">
                      <Link
                        to={`/admin/media/edit/${encodeURIComponent(m.PK)}`}
                        className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
                      >
                        <PencilSquareIcon className="h-3.5 w-3.5" />
                        Edit
                      </Link>
                    </div>
                  )}
                  {canRate && (
                    <div className="pt-1">
                      <label className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                        <span>Rate:</span>
                        <select
                          className="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px] text-slate-50"
                          onChange={(e) => {
                            const value = Number(e.target.value);
                            if (value >= 1 && value <= 5) {
                              handleRate(m.PK, value);
                            }
                          }}
                          defaultValue=""
                        >
                          <option value="">--</option>
                          <option value="1">1</option>
                          <option value="2">2</option>
                          <option value="3">3</option>
                          <option value="4">4</option>
                          <option value="5">5</option>
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasActiveSearch && totalPages > 1 && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200 disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-slate-500">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default MediaPage;

