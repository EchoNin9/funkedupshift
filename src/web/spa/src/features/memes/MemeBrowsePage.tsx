import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PencilSquareIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole, canAccessMemes } from "../../shell/AuthContext";

interface MemeItem {
  PK: string;
  title?: string;
  description?: string;
  averageRating?: number;
  mediaUrl?: string;
  thumbnailUrl?: string;
  tags?: string[];
  isPrivate?: boolean;
  userId?: string;
  createdAt?: string;
}

type SortKey = "newest" | "oldest" | "avgDesc" | "avgAsc" | "alphaAsc" | "alphaDesc";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

const MemeBrowsePage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<MemeItem[]>([]);
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [selectedTags, setSelectedTags] = useState<string[]>(() => {
    const t = searchParams.get("tagIds");
    return t ? t.split(",").filter(Boolean) : [];
  });
  const [tagMode, setTagMode] = useState<"and" | "or">(() => {
    const m = searchParams.get("tagMode");
    return m === "and" ? "and" : "or";
  });
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const [allTags, setAllTags] = useState<string[]>([]);

  const canRate = !!user;
  const canEditTags = !!user && (hasRole(user, "user") || hasRole(user, "manager") || hasRole(user, "superadmin"));

  const fetchWithAuth = useCallback(async (url: string, options?: RequestInit) => {
    const w = window as any;
    if (!w.auth?.getAccessToken) throw new Error("Not signed in");
    const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
    if (!token) throw new Error("Not signed in");
    const headers = { ...options?.headers, Authorization: `Bearer ${token}` };
    return fetch(url, { ...options, headers });
  }, []);

  const hasActiveSearch = search.trim().length > 0 || selectedTags.length > 0;

  useEffect(() => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    let cancelled = false;
    fetchWithAuth(`${apiBase}/memes/tags`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load tags"))))
      .then((data: { tags?: string[] }) => {
        if (cancelled) return;
        setAllTags((data.tags ?? []).sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [fetchWithAuth]);

  useEffect(() => {
    if (hasActiveSearch) {
      const next = new URLSearchParams();
      if (search.trim()) next.set("q", search.trim());
      if (selectedTags.length) {
        next.set("tagIds", selectedTags.join(","));
        next.set("tagMode", tagMode);
      }
      setSearchParams(next, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }, [hasActiveSearch, search, selectedTags, tagMode, setSearchParams]);

  useEffect(() => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setError("API URL not set.");
      return;
    }
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("limit", "20");
        if (search.trim()) params.set("q", search.trim());
        if (selectedTags.length > 0) {
          params.set("tagIds", selectedTags.join(","));
          params.set("tagMode", tagMode);
        }
        const resp = await fetchWithAuth(`${apiBase}/memes?${params.toString()}`);
        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${txt}`);
        }
        const data = (await resp.json()) as { memes?: MemeItem[] };
        if (cancelled) return;
        setItems(data.memes ?? []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load memes.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [search, selectedTags, tagMode, fetchWithAuth]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
      }
    }
    if (tagDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [tagDropdownOpen]);

  const filteredTagOptions = useMemo(() => {
    return allTags.filter(
      (t) =>
        !selectedTags.includes(t) &&
        (!tagSearch.trim() || t.toLowerCase().includes(tagSearch.toLowerCase()))
    );
  }, [allTags, selectedTags, tagSearch]);

  const sortedItems = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const titleA = (a.title || a.PK || "").toLowerCase();
      const titleB = (b.title || b.PK || "").toLowerCase();
      const avgA = typeof a.averageRating === "number" ? a.averageRating : 0;
      const avgB = typeof b.averageRating === "number" ? b.averageRating : 0;
      const createdA = a.createdAt || "";
      const createdB = b.createdAt || "";
      if (sort === "newest") {
        const cmp = createdB.localeCompare(createdA);
        if (cmp !== 0) return cmp;
        return titleA.localeCompare(titleB);
      }
      if (sort === "oldest") {
        const cmp = createdA.localeCompare(createdB);
        if (cmp !== 0) return cmp;
        return titleA.localeCompare(titleB);
      }
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

  const handleRate = async (memeId: string, rating: number) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      await fetchWithAuth(`${apiBase}/memes/stars`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memeId, rating })
      });
      setItems((prev) =>
        prev.map((m) => {
          if (m.PK === memeId) return { ...m, averageRating: rating };
          return m;
        })
      );
    } catch {
      /* ignore */
    }
  };

  const access = canAccessMemes(user);
  if (!user) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Memes</h1>
        <div className="rounded-md border border-slate-700 bg-slate-900/60 px-4 py-3 text-slate-200">
          Sign in to browse memes.
        </div>
      </div>
    );
  }
  if (!access) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Memes</h1>
        <div className="rounded-md border border-slate-700 bg-slate-900/60 px-4 py-3 text-slate-200">
          You do not have access to Memes. Join the Memes custom group or contact an admin.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Memes</h1>
        <p className="text-sm text-slate-400">
          Browse and rate memes. Latest 20 shown by default.
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
            placeholder="Search memes (title, description)…"
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
          <div ref={tagDropdownRef} className="relative flex-shrink-0 min-w-0 max-w-sm">
            <label htmlFor="meme-tag-filter" className="block text-xs font-medium text-slate-400 mb-1">
              Tags (filter by)
            </label>
            <input
              id="meme-tag-filter"
              type="text"
              value={tagSearch}
              onChange={(e) => setTagSearch(e.target.value)}
              onFocus={() => setTagDropdownOpen(true)}
              placeholder="Search and select tags…"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
              autoComplete="off"
            />
            {tagDropdownOpen && (
              <div
                className="absolute left-0 top-full z-10 mt-1 w-full max-h-48 overflow-auto rounded-md border border-slate-700 bg-slate-900 shadow-lg"
                role="listbox"
              >
                {filteredTagOptions.length > 0 ? (
                  filteredTagOptions.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      role="option"
                      onClick={() => {
                        setSelectedTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
                        setTagSearch("");
                      }}
                      className="block w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                    >
                      {tag}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-xs text-slate-500">No matching tags</div>
                )}
              </div>
            )}
            {selectedTags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {selectedTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => setSelectedTags((prev) => prev.filter((t) => t !== tag))}
                      className="hover:text-slate-100"
                      aria-label={`Remove ${tag}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <select
                  value={tagMode}
                  onChange={(e) => setTagMode(e.target.value as "and" | "or")}
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-[11px] text-slate-400"
                >
                  <option value="or">OR</option>
                  <option value="and">AND</option>
                </select>
              </div>
            )}
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs font-medium text-slate-400">Sort</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-50 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="avgDesc">Avg stars (high first)</option>
              <option value="avgAsc">Avg stars (low first)</option>
              <option value="alphaAsc">Title A–Z</option>
              <option value="alphaDesc">Title Z–A</option>
            </select>
            <span className="text-slate-500">
              {sortedItems.length === 0 ? "No memes" : `${sortedItems.length} memes`}
            </span>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-slate-400">Loading memes…</div>
      ) : (
        <>
          <ul className="space-y-3 mt-2">
            {sortedItems.map((m) => {
              const thumb = m.thumbnailUrl || m.mediaUrl;
              const title = m.title || m.PK || "Untitled";
              const detailLink = `/memes/${encodeURIComponent(m.PK)}`;
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
                      <span>🖼</span>
                    )}
                  </Link>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-semibold text-slate-50">
                        <Link to={detailLink} className="hover:text-brand-orange">
                          {title}
                        </Link>
                      </h2>
                      {m.isPrivate && (
                        <span className="inline-flex rounded-full bg-slate-900 px-2 py-0.5 text-[10px] uppercase text-slate-500">
                          Private
                        </span>
                      )}
                      {typeof m.averageRating === "number" && (
                        <span className="inline-flex rounded-full bg-slate-900 px-2 py-0.5 text-[11px] text-amber-300">
                          {m.averageRating.toFixed(1)}★
                        </span>
                      )}
                    </div>
                    {m.description && (
                      <p className="text-xs text-slate-300 line-clamp-3">{m.description}</p>
                    )}
                    {m.tags && m.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {m.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="pt-1 flex items-center gap-3">
                      {canEditTags && (
                        <Link
                          to={`/memes/${encodeURIComponent(m.PK)}/edit`}
                          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
                        >
                          <PencilSquareIcon className="h-3.5 w-3.5" />
                          Edit
                        </Link>
                      )}
                      {canRate && (
                        <label className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                          <span>Rate:</span>
                          <select
                            className="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px] text-slate-50"
                            onChange={(e) => {
                              const value = Number(e.target.value);
                              if (value >= 1 && value <= 5) handleRate(m.PK, value);
                            }}
                            defaultValue=""
                          >
                            <option value="">--</option>
                            <option value="5">5</option>
                            <option value="4">4</option>
                            <option value="3">3</option>
                            <option value="2">2</option>
                            <option value="1">1</option>
                          </select>
                        </label>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {sortedItems.length === 0 && !isLoading && (
            <div className="flex items-center justify-center min-h-[200px]">
              <p className="text-lg text-slate-500">
                {hasActiveSearch ? "No memes found." : "No memes yet. Create one!"}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MemeBrowsePage;
