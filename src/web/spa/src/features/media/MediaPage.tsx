import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PencilSquareIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { useAuth, hasRole } from "../../shell/AuthContext";
import { fetchWithAuthOptional } from "../../utils/api";
import { Alert } from "../../components";

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

const MediaPage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(() => {
    const ids = searchParams.get("categoryIds");
    return ids ? ids.split(",").filter(Boolean) : [];
  });
  const [categoryMode, setCategoryMode] = useState<"and" | "or">(() => {
    const m = searchParams.get("categoryMode");
    return m === "or" ? "or" : "and";
  });
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [sort, setSort] = useState<SortKey>("avgDesc");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRate = !!user;
  const canEdit = hasRole(user ?? null, "manager");
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const [allCategories, setAllCategories] = useState<MediaCategory[]>([]);

  /* ── Fetch categories on mount ── */
  useEffect(() => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    let cancelled = false;
    fetchWithAuthOptional(`${apiBase}/media-categories`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load categories"))))
      .then((data: { categories?: { PK?: string; id?: string; name?: string }[] }) => {
        if (cancelled) return;
        const list = (data.categories ?? []).map((c) => ({
          id: c.PK || c.id || "",
          name: c.name || c.PK || ""
        }));
        list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setAllCategories(list);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const categoriesForDropdown = useMemo(() => {
    if (categoryMode === "or" && allCategories.length > 0) return allCategories;
    const fromItems = new Map<string, MediaCategory>();
    items.forEach((m) =>
      (m.categories || []).forEach((c) => {
        if (c.id && !fromItems.has(c.id)) fromItems.set(c.id, c);
      })
    );
    const combined = [...allCategories];
    fromItems.forEach((c) => {
      if (!combined.some((x) => x.id === c.id)) combined.push(c);
    });
    combined.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return combined;
  }, [allCategories, categoryMode, items]);

  const filteredCategoryOptions = useMemo(() => {
    return categoriesForDropdown.filter(
      (c) =>
        !selectedCategoryIds.includes(c.id) &&
        (!categorySearch.trim() || (c.name || "").toLowerCase().includes(categorySearch.toLowerCase()))
    );
  }, [categoriesForDropdown, selectedCategoryIds, categorySearch]);

  /* ── Sync URL search params ── */
  useEffect(() => {
    const next = new URLSearchParams();
    if (search.trim()) next.set("q", search.trim());
    if (selectedCategoryIds.length) {
      next.set("categoryIds", selectedCategoryIds.join(","));
      next.set("categoryMode", categoryMode);
    }
    setSearchParams(next, { replace: true });
  }, [search, selectedCategoryIds, categoryMode, setSearchParams]);

  /* ── Fetch media on mount and whenever filters change ── */
  useEffect(() => {
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
        const resp = await fetchWithAuthOptional(`${apiBase}/media?${params.toString()}`);
        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${txt}`);
        }
        const data = (await resp.json()) as { media?: MediaItem[] };
        if (cancelled) return;
        setItems(data.media ?? []);
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
  }, [search, selectedCategoryIds, categoryMode]);

  /* ── Close category dropdown on outside click ── */
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

  /* ── Sort ── */
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

  /* ── Rate handler ── */
  const handleRate = async (mediaId: string, rating: number) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth || typeof w.auth.getAccessToken !== "function") return;
    const token: string | null = await new Promise((resolve) => {
      w.auth.getAccessToken((t: string | null) => resolve(t));
    });
    if (!token) return;
    await fetchWithAuthOptional(`${apiBase}/media/stars`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ mediaId, rating })
    }).catch(() => {});
  };

  /* ── Toggle a category pill ── */
  const toggleCategory = (id: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((cid) => cid !== id) : [...prev, id]
    );
  };

  /* ── Skeleton cards for loading state ── */
  const skeletonCards = Array.from({ length: 12 }).map((_, i) => {
    const heights = ["h-40", "h-56", "h-48", "h-64", "h-44", "h-52"];
    const h = heights[i % heights.length];
    return (
      <div key={i} className="break-inside-avoid mb-4">
        <div className="overflow-hidden rounded-xl bg-surface-2 border border-border-default">
          <div className={`${h} w-full animate-pulse bg-surface-3`} />
          <div className="p-3 space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-surface-3" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-surface-3" />
            <div className="flex gap-1">
              <div className="h-5 w-12 animate-pulse rounded-full bg-surface-3" />
              <div className="h-5 w-16 animate-pulse rounded-full bg-surface-3" />
            </div>
          </div>
        </div>
      </div>
    );
  });

  /* ── Card entrance animation variants ── */
  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { delay: i * 0.04, duration: 0.35, ease: "easeOut" },
    }),
  };

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Media</h1>
        <p className="text-sm text-text-secondary">
          Images and videos attached to sites and experiments across Funkedupshift.
        </p>
      </header>

      {/* ── Search bar (pill-shaped) ── */}
      <form
        className="relative max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(search.trim());
        }}
      >
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-text-tertiary" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search media by title or description..."
          className="w-full rounded-full border border-border-default bg-surface-2 py-2.5 pl-11 pr-4 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 transition-colors"
        />
      </form>

      {/* ── Sort + count + AND/OR toggle row ── */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium text-text-primary">Sort:</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-md border border-border-default bg-surface-2 px-2 py-1 text-xs text-text-primary focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          >
            <option value="avgDesc">Avg stars (high first)</option>
            <option value="avgAsc">Avg stars (low first)</option>
            <option value="alphaAsc">Title A-Z</option>
            <option value="alphaDesc">Title Z-A</option>
          </select>
        </div>

        {selectedCategoryIds.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-text-tertiary">Match:</span>
            <div className="inline-flex rounded-md border border-border-default bg-surface-1 p-0.5">
              <button
                type="button"
                onClick={() => setCategoryMode("and")}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  categoryMode === "and" ? "bg-accent-500 text-surface-1" : "text-text-secondary hover:text-text-primary"
                }`}
              >
                AND
              </button>
              <button
                type="button"
                onClick={() => setCategoryMode("or")}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  categoryMode === "or" ? "bg-accent-500 text-surface-1" : "text-text-secondary hover:text-text-primary"
                }`}
              >
                OR
              </button>
            </div>
          </div>
        )}

        <span className="text-text-tertiary">
          {sortedItems.length === 0 && !isLoading ? "" : `${sortedItems.length} items`}
        </span>
      </div>

      {/* ── Horizontal scrollable category pills ── */}
      {allCategories.length > 0 && (
        <div className="relative" ref={categoryDropdownRef}>
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin pb-1">
            {/* "All" pill */}
            <button
              type="button"
              onClick={() => setSelectedCategoryIds([])}
              className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                selectedCategoryIds.length === 0
                  ? "bg-accent-500 text-surface-1"
                  : "bg-surface-2 text-text-secondary border border-border-default hover:border-border-hover hover:text-text-primary"
              }`}
            >
              All
            </button>
            {allCategories.map((c) => {
              const isActive = selectedCategoryIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCategory(c.id)}
                  className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-accent-500 text-surface-1"
                      : "bg-surface-2 text-text-secondary border border-border-default hover:border-border-hover hover:text-text-primary"
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>

          {/* Hidden category search input - still accessible for programmatic multi-select */}
          <input
            id="media-category-filter"
            type="text"
            value={categorySearch}
            onChange={(e) => setCategorySearch(e.target.value)}
            onFocus={() => setCategoryDropdownOpen(true)}
            placeholder="Search categories..."
            className="mt-2 w-full max-w-xs rounded-full border border-border-default bg-surface-2 px-3 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 transition-colors"
            autoComplete="off"
          />
          {categoryDropdownOpen && (
            <div
              className="absolute left-0 top-full z-10 mt-1 w-full max-w-xs max-h-48 overflow-auto scrollbar-thin rounded-xl border border-border-hover bg-surface-2 shadow-lg shadow-black/20"
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
                    }}
                    className="block w-full min-h-[44px] flex items-center px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-3 transition-colors"
                  >
                    {c.name}
                  </button>
                ))
              ) : (
                <p className="px-3 py-2 text-xs text-text-tertiary">
                  {categoriesForDropdown.length === 0 ? "No categories yet." : "No matches or all selected."}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <Alert variant="error" className="text-xs">{error}</Alert>
      )}

      {/* ── Content: skeleton / empty / masonry grid ── */}
      {isLoading ? (
        <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4">
          {skeletonCards}
        </div>
      ) : sortedItems.length === 0 ? (
        <div className="flex items-center justify-center min-h-[280px]">
          <p className="text-lg font-light text-text-tertiary tracking-wide">
            {items.length === 0 && !error
              ? "No media found. Try adjusting your search or filters."
              : "No results match your current filters."}
          </p>
        </div>
      ) : (
        <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4">
          {sortedItems.map((m, index) => {
            const thumb = m.thumbnailUrl || (m.mediaType === "image" ? m.mediaUrl : undefined);
            const title = m.title || m.PK || "Untitled";
            const mediaTypeLabel = m.mediaType === "video" ? "Video" : "Image";
            const detailLink = `/media/${encodeURIComponent(m.PK)}`;

            return (
              <motion.div
                key={m.PK}
                className="break-inside-avoid mb-4 group"
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                custom={index}
              >
                <Link
                  to={detailLink}
                  className="block overflow-hidden rounded-xl bg-surface-2 border border-border-default hover:border-border-hover transition-all hover:shadow-lg hover:shadow-black/20"
                >
                  {/* ── Image ── */}
                  <div className="overflow-hidden">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={title}
                        className="w-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-40 bg-surface-3 text-3xl text-text-tertiary">
                        {m.mediaType === "video" ? "\u25B6" : "\uD83D\uDCF7"}
                      </div>
                    )}
                  </div>

                  {/* ── Card body ── */}
                  <div className="p-3 space-y-1.5">
                    <h2 className="text-sm font-semibold text-text-primary line-clamp-2 group-hover:text-accent-400 transition-colors">
                      {title}
                    </h2>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {typeof m.averageRating === "number" && (
                        <span className="inline-flex items-center rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-amber-300">
                          {m.averageRating.toFixed(1)}{"\u2605"}
                        </span>
                      )}
                      <span className="inline-flex items-center rounded-full bg-surface-3 px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-secondary">
                        {mediaTypeLabel}
                      </span>
                    </div>

                    {m.categories && m.categories.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {m.categories.map((c) => (
                          <span
                            key={c.id}
                            className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-text-secondary"
                          >
                            {c.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>

                {/* ── Edit / Rate controls (below the card) ── */}
                {(canEdit || canRate) && (
                  <div className="flex items-center gap-3 mt-1.5 px-1">
                    {canEdit && (
                      <Link
                        to={`/admin/media/edit/${encodeURIComponent(m.PK)}`}
                        className="inline-flex items-center gap-1 text-[11px] text-text-secondary hover:text-accent-400 transition-colors"
                      >
                        <PencilSquareIcon className="h-3.5 w-3.5" />
                        Edit
                      </Link>
                    )}
                    {canRate && (
                      <label className="inline-flex items-center gap-1 text-[11px] text-text-secondary">
                        <span>Rate:</span>
                        <select
                          className="rounded border border-border-default bg-surface-2 px-1 py-0.5 text-[11px] text-text-primary focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                          onChange={(e) => {
                            const value = Number(e.target.value);
                            if (value >= 1 && value <= 5) {
                              handleRate(m.PK, value);
                            }
                          }}
                          defaultValue=""
                          onClick={(e) => e.preventDefault()}
                        >
                          <option value="">--</option>
                          <option value="1">1</option>
                          <option value="2">2</option>
                          <option value="3">3</option>
                          <option value="4">4</option>
                          <option value="5">5</option>
                        </select>
                      </label>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MediaPage;
