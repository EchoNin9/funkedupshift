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

/* ── 5-star row from an average rating ── */
const Stars: React.FC<{ avg?: number }> = ({ avg }) => {
  const filled = Math.round(avg ?? 0);
  return (
    <span className="pop-stars text-sm" aria-label={avg ? `${avg.toFixed(1)} out of 5` : "unrated"}>
      {"★★★★★".slice(0, filled)}
      <span className="empty">{"★★★★★".slice(filled)}</span>
    </span>
  );
};

/* Diagonal-striped neon placeholder for posters with no artwork. */
const STRIPE_BG =
  "repeating-linear-gradient(45deg, rgb(var(--color-surface-3)) 0 14px, rgb(var(--color-surface-2)) 14px 28px)";

/* Real media types in this app are image/video (the spec's Film/Shows/Albums model doesn't exist).
   ponytail: client-side type filter over the fetched list; server still does search/category filtering. */
const TYPE_FILTERS = [
  { key: "all", label: "All" },
  { key: "image", label: "Image" },
  { key: "video", label: "Video" },
] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number]["key"];

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
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
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

  /* ── Client-side type filter (image/video) over the sorted list ── */
  const displayedItems = useMemo(() => {
    if (typeFilter === "all") return sortedItems;
    return sortedItems.filter((m) =>
      typeFilter === "video" ? m.mediaType === "video" : m.mediaType !== "video"
    );
  }, [sortedItems, typeFilter]);

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

  /* ── Skeleton poster cards for loading state ── */
  const skeletonCards = Array.from({ length: 12 }).map((_, i) => (
    <div key={i} className="overflow-hidden rounded-lg border-[3px] border-border-default bg-surface-2">
      <div className="aspect-[2/3] w-full animate-pulse bg-surface-3" />
      <div className="p-2.5 space-y-2">
        <div className="h-3.5 w-3/4 animate-pulse rounded bg-surface-3" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-surface-3" />
      </div>
    </div>
  ));

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
      <motion.header
        className="space-y-3"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="space-y-1">
          <h1 className="text-3xl sm:text-4xl font-display font-extrabold uppercase tracking-tight text-text-primary">
            The Library
          </h1>
          <p className="text-sm text-text-secondary">
            {displayedItems.length} {displayedItems.length === 1 ? "item" : "items"} — images and videos from across Funkedupshift.
          </p>
        </div>
        {/* Type filter pills */}
        <div className="flex flex-wrap gap-2">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTypeFilter(t.key)}
              className={`rounded-full border-2 px-3.5 py-1 text-xs font-display font-extrabold uppercase tracking-tight transition-colors ${
                typeFilter === t.key
                  ? "border-ink bg-accent text-ink"
                  : "border-border-default text-text-secondary hover:border-n3 hover:text-text-primary"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </motion.header>

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
          placeholder="Search the library by title or description..."
          className="input-field pl-11"
        />
      </form>

      {/* ── Sort + count + AND/OR toggle row ── */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium text-text-primary">Sort:</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="input-field w-auto text-xs"
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
          {displayedItems.length === 0 && !isLoading ? "" : `${displayedItems.length} items`}
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
              className={`flex-shrink-0 rounded-full border-2 px-3.5 py-1 text-xs font-display font-extrabold uppercase tracking-tight transition-colors ${
                selectedCategoryIds.length === 0
                  ? "border-ink bg-accent text-ink"
                  : "border-border-default text-text-secondary hover:border-n3 hover:text-text-primary"
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
                  className={`flex-shrink-0 rounded-full border-2 px-3.5 py-1 text-xs font-display font-extrabold uppercase tracking-tight transition-colors ${
                    isActive
                      ? "border-ink bg-accent text-ink"
                      : "border-border-default text-text-secondary hover:border-n3 hover:text-text-primary"
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
            className="input-field mt-2 max-w-xs text-xs"
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

      {/* ── Content: skeleton / empty / poster grid ── */}
      {isLoading ? (
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
          {skeletonCards}
        </div>
      ) : displayedItems.length === 0 ? (
        <div className="flex items-center justify-center min-h-[280px]">
          <p className="text-lg font-light text-text-tertiary tracking-wide">
            {items.length === 0 && !error
              ? "No media found. Try adjusting your search or filters."
              : "No results match your current filters."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
          {displayedItems.map((m, index) => {
            const thumb = m.thumbnailUrl || (m.mediaType === "image" ? m.mediaUrl : undefined);
            const title = m.title || m.PK || "Untitled";
            const mediaTypeLabel = m.mediaType === "video" ? "Video" : "Image";
            const detailLink = `/media/${encodeURIComponent(m.PK)}`;

            return (
              <motion.div
                key={m.PK}
                className="group flex flex-col"
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                custom={index}
              >
                <Link
                  to={detailLink}
                  className="card overflow-hidden p-0 no-underline"
                >
                  {/* ── Poster (aspect 2/3) ── */}
                  <div className="relative aspect-[2/3] overflow-hidden">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={title}
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div
                        className="absolute inset-0 flex items-center justify-center text-3xl text-text-tertiary"
                        style={{ background: STRIPE_BG }}
                      >
                        {m.mediaType === "video" ? "\u25B6" : "\uD83D\uDCF7"}
                      </div>
                    )}
                    {/* Type badge */}
                    <span className="pop-badge absolute left-2 top-2 !px-2 !py-0.5 text-[10px]">
                      {mediaTypeLabel}
                    </span>
                  </div>

                  {/* ── Card body ── */}
                  <div className="p-2.5 space-y-1.5 border-t-[3px] border-text-primary">
                    <h2 className="text-sm font-display font-extrabold uppercase tracking-tight text-text-primary line-clamp-2">
                      {title}
                    </h2>

                    {typeof m.averageRating === "number"
                      ? <Stars avg={m.averageRating} />
                      : <span className="text-[11px] text-text-tertiary">Unrated</span>}

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
