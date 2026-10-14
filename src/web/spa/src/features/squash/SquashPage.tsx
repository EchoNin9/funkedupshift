import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth, canAccessSquash } from "../../shell/AuthContext";
import DateInput from "./DateInput";
import { fetchWithAuth } from "../../utils/api";
import PlayerPicker from "./PlayerPicker";
import MatchSummary from "./MatchSummary";
import TagFilterBar from "./TagFilterBar";
import { matchesTagFilter } from "./tagFilter";
import MatchForm from "./MatchForm";
import PlayersTab from "./PlayersTab";
import SharesTab from "./SharesTab";
import ShareDialog from "./ShareDialog";
import { Match, Player, SearchFilters, apiError, buildFilters, dangerBtn, getApiBaseUrl, smallBtn } from "./squashShared";

const PAGE_SIZE = 10;

const SquashPage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>(() => {
    const ids = searchParams.get("playerIds");
    return ids ? ids.split(",").filter(Boolean) : [];
  });
  const [allMatches, setAllMatches] = useState<Match[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchDate, setSearchDate] = useState(() => searchParams.get("date") ?? "");
  const [searchDateFrom, setSearchDateFrom] = useState(() => searchParams.get("dateFrom") ?? "");
  const [searchDateTo, setSearchDateTo] = useState(() => searchParams.get("dateTo") ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">(() => {
    const s = searchParams.get("sortOrder");
    return s === "oldest" ? "oldest" : "newest";
  });
  const [playerMode, setPlayerMode] = useState<"and" | "or">(() => {
    const m = searchParams.get("playerMode");
    return m === "or" ? "or" : "and";
  });
  const [activeTab, setActiveTab] = useState<"matches" | "players" | "shares">("matches");
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagFilterMode, setTagFilterMode] = useState<"and" | "or">("or");

  const access = canAccessSquash(user);

  const currentFilters: SearchFilters = buildFilters(
    searchDate,
    searchDateFrom,
    searchDateTo,
    selectedPlayerIds,
    playerMode,
    sortOrder,
    tagFilters,
    tagFilterMode
  );

  const deleteMatch = async (id: string) => {
    if (!confirm("Delete this match?")) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      const resp = await fetchWithAuth(`${apiBase}/squash/matches?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!resp.ok) throw new Error(await apiError(resp));
      searchMatches();
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
    }
  };

  const loadPlayers = async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      const resp = await fetchWithAuth(`${apiBase}/squash/players`);
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed");
      }
      const data = (await resp.json()) as { players?: Player[] };
      const list = (data.players ?? []).map((p) => ({
        ...p,
        id: p.id || p.PK || ""
      }));
      setAllPlayers(list);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load players");
    }
  };

  const searchMatches = async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const params = new URLSearchParams();
    if (searchDate) params.set("date", searchDate);
    if (searchDateFrom) params.set("dateFrom", searchDateFrom);
    if (searchDateTo) params.set("dateTo", searchDateTo);
    if (selectedPlayerIds.length) {
      params.set("playerIds", selectedPlayerIds.join(","));
      params.set("playerMode", playerMode);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    setIsLoading(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/squash/matches${qs}`);
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed");
      }
      const data = (await resp.json()) as { matches?: Match[] };
      setAllMatches(data.matches ?? []);
      setHasSearched(true);
      setCurrentPage(1);
      const next = new URLSearchParams();
      if (searchDate) next.set("date", searchDate);
      if (searchDateFrom) next.set("dateFrom", searchDateFrom);
      if (searchDateTo) next.set("dateTo", searchDateTo);
      if (selectedPlayerIds.length) {
        next.set("playerIds", selectedPlayerIds.join(","));
        next.set("playerMode", playerMode);
      }
      next.set("sortOrder", sortOrder);
      setSearchParams(next, { replace: true });
    } catch (e: any) {
      setError(e?.message ?? "Failed to search matches");
    } finally {
      setIsLoading(false);
    }
  };

  const clearSearch = () => {
    setSearchDate("");
    setSearchDateFrom("");
    setSearchDateTo("");
    setSelectedPlayerIds([]);
    setPlayerMode("and");
    setHasSearched(false);
    setAllMatches([]);
    setCurrentPage(1);
    setSearchParams({}, { replace: true });
  };

  useEffect(() => {
    if (access) loadPlayers();
  }, [access]);

  const hasUrlSearchParams =
    searchParams.get("date") ||
    searchParams.get("dateFrom") ||
    searchParams.get("dateTo") ||
    searchParams.get("playerIds");
  useEffect(() => {
    if (!access || !hasUrlSearchParams) return;
    searchMatches();
  }, []);

  const sortedMatches = useMemo(() => {
    const copy = [...allMatches];
    copy.sort((a, b) => {
      const da = a.date || "";
      const db = b.date || "";
      return sortOrder === "newest" ? db.localeCompare(da) : da.localeCompare(db);
    });
    return copy;
  }, [allMatches, sortOrder]);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const m of allMatches) {
      for (const t of m.tags || []) set.add(t);
    }
    return Array.from(set).sort();
  }, [allMatches]);

  const toggleTagFilter = (tag: string) => {
    setTagFilters((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
    setCurrentPage(1);
  };

  const clearTagFilters = () => {
    setTagFilters([]);
    setTagFilterMode("or");
  };

  const tagFilteredMatches = useMemo(
    () => sortedMatches.filter((m) => matchesTagFilter(m.tags, tagFilters, tagFilterMode)),
    [sortedMatches, tagFilters, tagFilterMode]
  );

  const totalPages = Math.max(1, Math.ceil(tagFilteredMatches.length / PAGE_SIZE));
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageMatches = tagFilteredMatches.slice(start, start + PAGE_SIZE);

  const renderMatchRow = (m: Match) => (
    <li key={m.id || m.date} className="flex items-center gap-2 flex-wrap py-2 border-b border-border-default last:border-0">
      <MatchSummary match={m} players={allPlayers} />
      <button type="button" onClick={() => setEditingMatch(m)} className={smallBtn}>
        Edit
      </button>
      <button type="button" onClick={() => deleteMatch(m.id || "")} className={dangerBtn}>
        Delete
      </button>
    </li>
  );

  const pageNums: (number | string)[] = [];
  if (totalPages <= 7) {
    for (let p = 1; p <= totalPages; p++) pageNums.push(p);
  } else {
    const cur = currentPage;
    pageNums.push(1);
    if (cur > 3) pageNums.push("…");
    for (let i = Math.max(2, cur - 1); i <= Math.min(totalPages - 1, cur + 1); i++) {
      if (!pageNums.includes(i)) pageNums.push(i);
    }
    if (cur < totalPages - 2) pageNums.push("…");
    if (totalPages > 1) pageNums.push(totalPages);
  }

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-text-primary">Squash Doubles</h1>
        <div className="rounded-md bg-danger/20 border border-danger/20 px-4 py-3 text-sm text-danger">
          Sign in required. <Link to="/auth" className="underline hover:text-danger">Sign in</Link>
        </div>
      </div>
    );
  }

  if (!access) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-text-primary">Squash Doubles</h1>
        <div className="rounded-md bg-warning/30 border border-warning/50 px-4 py-3 text-sm text-warning">
          You do not have access to the Squash section. Join the Squash group or contact an admin.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">Squash Doubles</h1>

      {(message || error) && (
        <div
          className={`rounded-md px-4 py-3 text-sm ${error ? "bg-danger/20 border border-danger/20 text-danger" : "bg-success/30 border border-success/50 text-success"}`}
        >
          {error || message}
        </div>
      )}

      <div className="flex gap-2 border-b border-border-default pb-2">
        {(["matches", "players", "shares"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium capitalize ${activeTab === t ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:text-text-primary transition-colors"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {activeTab === "players" && <PlayersTab players={allPlayers} onChanged={loadPlayers} onError={setError} />}
      {activeTab === "shares" && <SharesTab onError={setError} />}

      {activeTab === "matches" && (
        <>
          <MatchForm
            players={allPlayers}
            allTags={availableTags}
            editing={editingMatch}
            onDone={() => {
              setEditingMatch(null);
              searchMatches();
            }}
            onCancel={() => setEditingMatch(null)}
            onError={setError}
          />

      <section>
        <h2 className="text-base font-semibold text-text-primary mb-3">Search matches</h2>
        <div className="flex flex-wrap gap-4 items-end">
          <DateInput
            id="searchDate"
            value={searchDate}
            onChange={setSearchDate}
            label="Date (exact)"
            className="max-w-[12rem]"
          />
          <DateInput
            id="searchDateFrom"
            value={searchDateFrom}
            onChange={setSearchDateFrom}
            label="Date from"
            className="max-w-[12rem]"
          />
          <DateInput
            id="searchDateTo"
            value={searchDateTo}
            onChange={setSearchDateTo}
            label="Date to"
            className="max-w-[12rem]"
          />
          <PlayerPicker
            players={allPlayers}
            selectedIds={selectedPlayerIds}
            onChange={setSelectedPlayerIds}
            mode={playerMode}
            onModeChange={setPlayerMode}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={searchMatches}
              disabled={isLoading}
              className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-400 disabled:opacity-50"
            >
              {isLoading ? "Searching…" : "Search"}
            </button>
            <button
              type="button"
              onClick={clearSearch}
              className="rounded-md border border-border-default px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-3 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="text-base font-semibold text-text-primary">Results</h2>
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            disabled={!hasSearched}
            className="rounded-md border border-border-default px-3 py-1 text-xs font-medium text-text-secondary hover:bg-surface-3 transition-colors disabled:opacity-50"
          >
            Share results
          </button>
          {hasSearched && sortedMatches.length > 0 && (
            <div className="inline-flex rounded-md border border-border-hover bg-surface-1 p-0.5">
              <button
                type="button"
                onClick={() => setSortOrder("newest")}
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  sortOrder === "newest" ? "bg-accent-500 text-surface-0" : "text-text-secondary hover:text-text-primary transition-colors"
                }`}
              >
                Newest first
              </button>
              <button
                type="button"
                onClick={() => setSortOrder("oldest")}
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  sortOrder === "oldest" ? "bg-accent-500 text-surface-0" : "text-text-secondary hover:text-text-primary transition-colors"
                }`}
              >
                Oldest first
              </button>
            </div>
          )}
        </div>
        {hasSearched && (
          <TagFilterBar
            availableTags={availableTags}
            selectedTags={tagFilters}
            onToggleTag={toggleTagFilter}
            mode={tagFilterMode}
            onModeChange={setTagFilterMode}
            onClear={clearTagFilters}
          />
        )}
        {hasSearched && (
          <div className="rounded-md border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-secondary mb-3">
            {tagFilteredMatches.length === 0 ? "No results" : `${tagFilteredMatches.length} results`}
          </div>
        )}
        {!hasSearched ? (
          <div className="flex items-center justify-center min-h-[280px]">
            <p className="text-2xl sm:text-3xl font-light text-text-tertiary/80 tracking-wide animate-pulse">
              Enter search criteria and click Search to find matches.
            </p>
          </div>
        ) : pageMatches.length === 0 ? (
          <ul className="list-none p-0">
            <li className="py-2 text-text-secondary">No matches found.</li>
          </ul>
        ) : (
          <>
            <ul className="list-none p-0">
              {pageMatches.map(renderMatchRow)}
            </ul>
            {totalPages > 1 && (
              <div className="flex items-center gap-2 mt-4 flex-wrap">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="rounded-md border border-border-default px-3 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed text-text-secondary hover:bg-surface-3 transition-colors"
                >
                  Prev
                </button>
                <span className="flex items-center gap-1">
                  {pageNums.map((p, i) =>
                    p === "…" ? (
                      <span key={`ellipsis-${i}`} className="px-1 text-text-tertiary">
                        …
                      </span>
                    ) : p === currentPage ? (
                      <span key={p} className="min-w-[2rem] px-2 py-1 text-center font-semibold text-text-primary">
                        {p}
                      </span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setCurrentPage(p as number)}
                        className="min-w-[2rem] rounded px-2 py-1 text-sm text-text-secondary hover:bg-surface-3 transition-colors border border-border-default"
                      >
                        {p}
                      </button>
                    )
                  )}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-md border border-border-default px-3 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed text-text-secondary hover:bg-surface-3 transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </section>
        </>
      )}

      {shareOpen && (
        <ShareDialog
          filters={currentFilters}
          onClose={() => setShareOpen(false)}
          onSaved={() => undefined}
        />
      )}
    </div>
  );
};

export default SquashPage;
