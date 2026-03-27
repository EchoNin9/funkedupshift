import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PencilSquareIcon, LinkIcon } from "@heroicons/react/24/outline";
import { useAuth, canAccessMemes, canRateMemes, canCreateMemes, canEditAnyMeme } from "../../shell/AuthContext";
import { Alert, useClickOutside } from "../../components";
import ShareMemePopover from "./ShareMemePopover";
import { fetchWithAuthOptional } from "../../utils/api";

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

const MY_MEMES_INVALIDATE_KEY = "memes_my_cache_invalidate";

const MemeBrowsePage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") || "all") === "mine" ? "mine" : "all";
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
  const myMemesCacheRef = useRef<MemeItem[] | null>(null);
  const [invalidateMyCache, setInvalidateMyCache] = useState(false);

  const canRate = canRateMemes(user);
  const canCreate = canCreateMemes(user);
  const canEditAny = canEditAnyMeme(user);
  const showMyMemes = user && canCreateMemes(user);
  const canEditMeme = (m: MemeItem) => canEditAny || (canCreate && m.userId === user?.userId);

  const hasActiveSearch = search.trim().length > 0 || selectedTags.length > 0;

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(MY_MEMES_INVALIDATE_KEY);
      if (!raw) return;
      sessionStorage.removeItem(MY_MEMES_INVALIDATE_KEY);
      const data = JSON.parse(raw) as { memeId?: string; tagOnly?: boolean; tags?: string[] };
      if (data.tagOnly && data.memeId && data.tags) {
        const updated = (myMemesCacheRef.current ?? []).map((m) =>
          m.PK === data.memeId ? { ...m, tags: data.tags } : m
        );
        myMemesCacheRef.current = updated;
        if (tab === "mine") {
          let filtered = updated;
          if (selectedTags.length > 0) {
            filtered = tagMode === "and"
              ? updated.filter((m) => selectedTags.every((t) => (m.tags ?? []).includes(t)))
              : updated.filter((m) => selectedTags.some((t) => (m.tags ?? []).includes(t)));
          }
          setItems(filtered);
        }
      } else {
        setInvalidateMyCache(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    let cancelled = false;
    fetchWithAuthOptional(`${apiBase}/memes/tags`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load tags"))))
      .then((data: { tags?: string[] }) => {
        if (cancelled) return;
        setAllTags((data.tags ?? []).sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const next = new URLSearchParams();
    if (tab === "mine") next.set("tab", "mine");
    if (hasActiveSearch) {
      if (search.trim()) next.set("q", search.trim());
      if (selectedTags.length) {
        next.set("tagIds", selectedTags.join(","));
        next.set("tagMode", tagMode);
      }
    }
    setSearchParams(next, { replace: true });
  }, [tab, hasActiveSearch, search, selectedTags, tagMode, setSearchParams]);

  useEffect(() => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setError("API URL not set.");
      return;
    }
    let cancelled = false;

    if (tab === "mine" && showMyMemes) {
      const cached = myMemesCacheRef.current;
      const hasTagFilter = selectedTags.length > 0;
      if (cached && !invalidateMyCache && !search.trim()) {
        setInvalidateMyCache(false);
        let filtered = cached;
        if (hasTagFilter) {
          if (tagMode === "and") {
            filtered = cached.filter((m) => selectedTags.every((t) => (m.tags ?? []).includes(t)));
          } else {
            filtered = cached.filter((m) => selectedTags.some((t) => (m.tags ?? []).includes(t)));
          }
        }
        setItems(filtered);
        setIsLoading(false);
        return;
      }
    }

    async function load() {
      setIsLoading(true);
      setError(null);
      const useMine = tab === "mine" && showMyMemes;
      try {
        const params = new URLSearchParams();
        params.set("limit", useMine ? "100" : "20");
        if (useMine) params.set("mine", "1");
        if (search.trim()) params.set("q", search.trim());
        if (selectedTags.length > 0 && !useMine) {
          params.set("tagIds", selectedTags.join(","));
          params.set("tagMode", tagMode);
        }
        const basePath = user ? "/memes" : "/memes/cache";
        const resp = await fetchWithAuthOptional(`${apiBase}${basePath}?${params.toString()}`);
        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${txt}`);
        }
        const data = (await resp.json()) as { memes?: MemeItem[] };
        if (cancelled) return;
        const list = data.memes ?? [];
        if (useMine) {
          myMemesCacheRef.current = list;
          setInvalidateMyCache(false);
          if (selectedTags.length > 0) {
            const filtered = tagMode === "and"
              ? list.filter((m) => selectedTags.every((t) => (m.tags ?? []).includes(t)))
              : list.filter((m) => selectedTags.some((t) => (m.tags ?? []).includes(t)));
            setItems(filtered);
          } else {
            setItems(list);
          }
        } else {
          setItems(list);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load memes.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [tab, search, selectedTags, tagMode, invalidateMyCache, showMyMemes, user]);

  useClickOutside(tagDropdownRef, useCallback(() => setTagDropdownOpen(false), []), tagDropdownOpen);

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
      await fetchWithAuthOptional(`${apiBase}/memes/stars`, {
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

  if (user && !canAccessMemes(user)) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Memes</h1>
        <div className="rounded-md border border-border-hover bg-surface-2 px-4 py-3 text-text-primary">
          You do not have access to Memes. Join the Memes custom group or contact an admin.
        </div>
      </div>
    );
  }

  const setTab = (t: "all" | "mine") => {
    const next = new URLSearchParams(searchParams);
    if (t === "mine") next.set("tab", "mine");
    else next.delete("tab");
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (tab === "mine" && !showMyMemes) {
      setSearchParams((p) => {
        const next = new URLSearchParams(p);
        next.delete("tab");
        return next;
      }, { replace: true });
    }
  }, [tab, showMyMemes, setSearchParams]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Memes</h1>
          {showMyMemes && (
            <div className="flex rounded-lg border border-border-hover bg-surface-2 p-0.5">
              <button
                type="button"
                onClick={() => setTab("all")}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  tab === "all" ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:text-text-primary"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setTab("mine")}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  tab === "mine" ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:text-text-primary"
                }`}
              >
                My Memes
              </button>
            </div>
          )}
        </div>
        <p className="text-sm text-text-secondary">
          {tab === "mine"
            ? "Your memes, newest first. Filter by tags below."
            : user
              ? "Browse and rate memes. Latest 20 shown by default."
              : "The latest user created memes. Sign in to rate or create."}
        </p>
      </header>

      {user && (
      <section className="rounded-xl border border-border-default bg-surface-1 p-4 space-y-4" aria-label="Search and filter">
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
            className="flex-1 rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-md bg-accent-500 px-4 py-2 text-sm font-semibold text-surface-0 hover:bg-orange-500"
          >
            Search
          </button>
        </form>

        <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6">
          <div ref={tagDropdownRef} className="relative flex-shrink-0 min-w-0 max-w-sm">
            <label htmlFor="meme-tag-filter" className="block text-xs font-medium text-text-secondary mb-1">
              Tags (filter by)
            </label>
            <input
              id="meme-tag-filter"
              type="text"
              value={tagSearch}
              onChange={(e) => setTagSearch(e.target.value)}
              onFocus={() => setTagDropdownOpen(true)}
              placeholder="Search and select tags…"
              className="w-full rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              autoComplete="off"
            />
            {tagDropdownOpen && (
              <div
                className="absolute left-0 top-full z-10 mt-1 w-full max-h-48 overflow-auto scrollbar-thin rounded-md border border-border-hover bg-surface-2 shadow-lg"
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
                      className="block w-full text-left px-3 py-2 text-sm text-text-primary transition-colors hover:bg-surface-3"
                    >
                      {tag}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-xs text-text-tertiary">No matching tags</div>
                )}
              </div>
            )}
            {selectedTags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {selectedTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-xs text-text-secondary"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => setSelectedTags((prev) => prev.filter((t) => t !== tag))}
                      className="transition-colors hover:text-text-primary"
                      aria-label={`Remove ${tag}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <select
                  value={tagMode}
                  onChange={(e) => setTagMode(e.target.value as "and" | "or")}
                  className="rounded border border-border-hover bg-surface-1 px-2 py-0.5 text-[11px] text-text-secondary"
                >
                  <option value="or">OR</option>
                  <option value="and">AND</option>
                </select>
              </div>
            )}
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs font-medium text-text-secondary">Sort</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-md border border-border-hover bg-surface-1 px-2 py-1 text-xs text-text-primary focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="avgDesc">Avg stars (high first)</option>
              <option value="avgAsc">Avg stars (low first)</option>
              <option value="alphaAsc">Title A–Z</option>
              <option value="alphaDesc">Title Z–A</option>
            </select>
            <span className="text-text-tertiary">
              {sortedItems.length === 0 ? "No memes" : `${sortedItems.length} memes`}
            </span>
          </div>
        </div>
      </section>
      )}

      {error && (
        <Alert variant="error">{error}</Alert>
      )}

      {isLoading ? (
        <div className="text-sm text-text-secondary">Loading memes…</div>
      ) : (
        <>
          <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-4 mt-2">
            {sortedItems.map((m) => {
              const thumb = m.thumbnailUrl || m.mediaUrl;
              const title = m.title || m.PK || "Untitled";
              const detailLink = `/memes/${encodeURIComponent(m.PK)}`;
              return (
                <div
                  key={m.PK}
                  className="break-inside-avoid mb-4 rounded-xl border border-border-default bg-surface-1 overflow-hidden transition-transform hover:scale-[1.02]"
                >
                  <Link
                    to={detailLink}
                    className="block w-full overflow-hidden bg-surface-2"
                  >
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        className="w-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                        }}
                      />
                    ) : (
                      <div className="flex h-32 items-center justify-center text-xl">🖼</div>
                    )}
                  </Link>
                  <div className="p-3 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-semibold text-text-primary">
                        <Link to={detailLink} className="transition-colors hover:text-accent-400">
                          {title}
                        </Link>
                      </h2>
                      {m.isPrivate && (
                        <span className="inline-flex rounded-full bg-surface-2 px-2 py-0.5 text-[10px] uppercase text-text-tertiary">
                          Private
                        </span>
                      )}
                      {typeof m.averageRating === "number" && (
                        <span className="inline-flex rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-amber-300">
                          {m.averageRating.toFixed(1)}★
                        </span>
                      )}
                    </div>
                    {m.description && (
                      <p className="text-xs text-text-secondary line-clamp-3">{m.description}</p>
                    )}
                    {m.tags && m.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {m.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-secondary"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="pt-1 flex items-center gap-3 flex-wrap">
                      <ShareMemePopover
                        memeId={m.PK}
                        title={title}
                        trigger={
                          <>
                            <LinkIcon className="h-3.5 w-3.5" />
                            Share
                          </>
                        }
                      />
                      {canEditMeme(m) && (
                        <Link
                          to={`/memes/${encodeURIComponent(m.PK)}/edit`}
                          className="inline-flex items-center gap-1 text-[11px] text-text-secondary transition-colors hover:text-text-primary"
                        >
                          <PencilSquareIcon className="h-3.5 w-3.5" />
                          Edit
                        </Link>
                      )}
                      {canRate && (
                        <label className="inline-flex items-center gap-1 text-[11px] text-text-secondary">
                          <span>Rate:</span>
                          <select
                            className="rounded border border-border-hover bg-surface-1 px-1 py-0.5 text-[11px] text-text-primary"
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
                </div>
              );
            })}
          </div>
          {sortedItems.length === 0 && !isLoading && (
            <div className="flex items-center justify-center min-h-[200px]">
              <p className="text-lg text-text-tertiary">
                {tab === "mine"
                  ? hasActiveSearch
                    ? "No memes match the selected tags."
                    : "You haven't created any memes yet. Create one!"
                  : hasActiveSearch
                    ? "No memes found."
                    : "No memes yet. Create one!"}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MemeBrowsePage;
