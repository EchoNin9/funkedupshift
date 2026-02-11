import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth, canAccessSquash, canModifySquash } from "../../shell/AuthContext";
import DateInput from "./DateInput";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

interface Player {
  id: string;
  PK?: string;
  name?: string;
  email?: string;
}

interface Match {
  id?: string;
  date?: string;
  teamAPlayer1Id?: string;
  teamAPlayer2Id?: string;
  teamBPlayer1Id?: string;
  teamBPlayer2Id?: string;
  winningTeam?: string;
  teamAGames?: number;
  teamBGames?: number;
}

const PAGE_SIZE = 10;

const SquashPage: React.FC = () => {
  const { user } = useAuth();
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [allMatches, setAllMatches] = useState<Match[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchDate, setSearchDate] = useState("");
  const [searchDateFrom, setSearchDateFrom] = useState("");
  const [searchDateTo, setSearchDateTo] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerDropdownOpen, setPlayerDropdownOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const playerDropdownRef = useRef<HTMLDivElement>(null);

  const access = canAccessSquash(user);
  const canModify = canModifySquash(user);

  const playerName = (id: string) => {
    const p = allPlayers.find((x) => x.id === id || x.PK === id);
    return p ? p.name || p.id || id : id;
  };

  const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
    const w = window as any;
    if (!w.auth?.getAccessToken) throw new Error("Not signed in");
    const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
    if (!token) throw new Error("Not signed in");
    const headers = { ...options.headers, Authorization: `Bearer ${token}` };
    return fetch(url, { ...options, headers });
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
    if (selectedPlayerIds.length) params.set("playerIds", selectedPlayerIds.join(","));
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
    setPlayerSearch("");
    setHasSearched(false);
    setAllMatches([]);
    setCurrentPage(1);
  };

  const addPlayer = (id: string) => {
    if (!selectedPlayerIds.includes(id)) setSelectedPlayerIds([...selectedPlayerIds, id]);
    setPlayerSearch("");
  };

  const removePlayer = (id: string) => {
    setSelectedPlayerIds(selectedPlayerIds.filter((x) => x !== id));
  };

  const filteredPlayerOptions = allPlayers.filter(
    (p) =>
      !selectedPlayerIds.includes(p.id) &&
      (!playerSearch.trim() || (p.name || "").toLowerCase().includes(playerSearch.toLowerCase()))
  );

  useEffect(() => {
    if (access) loadPlayers();
  }, [access]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (playerDropdownRef.current && !playerDropdownRef.current.contains(e.target as Node)) {
        setPlayerDropdownOpen(false);
      }
    }
    if (playerDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [playerDropdownOpen]);

  const totalPages = Math.max(1, Math.ceil(allMatches.length / PAGE_SIZE));
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageMatches = allMatches.slice(start, start + PAGE_SIZE);

  const renderScore = (m: Match) => {
    const ga = m.teamAGames ?? 0;
    const gb = m.teamBGames ?? 0;
    const leftGames = m.winningTeam === "B" ? gb : ga;
    const rightGames = m.winningTeam === "B" ? ga : gb;
    return `${leftGames}-${rightGames}`;
  };

  const renderMatchRow = (m: Match) => {
    const teamA = [playerName(m.teamAPlayer1Id || ""), playerName(m.teamAPlayer2Id || "")].filter(Boolean).join(" & ");
    const teamB = [playerName(m.teamBPlayer1Id || ""), playerName(m.teamBPlayer2Id || "")].filter(Boolean).join(" & ");
    const leftTeam = m.winningTeam === "B" ? teamB : teamA;
    const rightTeam = m.winningTeam === "B" ? teamA : teamB;
    return (
      <li key={m.id || m.date + leftTeam} className="flex items-center gap-2 flex-wrap py-2 border-b border-slate-800 last:border-0">
        <span className="font-semibold text-slate-200">{m.date || ""}</span>
        <span className="text-slate-300">
          {leftTeam} vs {rightTeam}
        </span>
        <span className="italic text-slate-400">{renderScore(m)}</span>
      </li>
    );
  };

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
        <h1 className="text-xl font-semibold text-slate-100">Squash Doubles</h1>
        <div className="rounded-md bg-red-900/30 border border-red-800/50 px-4 py-3 text-sm text-red-200">
          Sign in required. <Link to="/auth" className="underline hover:text-red-100">Sign in</Link>
        </div>
      </div>
    );
  }

  if (!access) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-slate-100">Squash Doubles</h1>
        <div className="rounded-md bg-amber-900/30 border border-amber-800/50 px-4 py-3 text-sm text-amber-200">
          You do not have access to the Squash section. Join the Squash group or contact an admin.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-100">Squash Doubles</h1>

      {canModify && (
        <p className="text-sm text-slate-400">
          <Link to="/squash-admin" className="text-brand-orange hover:text-orange-400">
            Squash Admin
          </Link>
        </p>
      )}

      {(message || error) && (
        <div
          className={`rounded-md px-4 py-3 text-sm ${error ? "bg-red-900/30 border border-red-800/50 text-red-200" : "bg-emerald-900/30 border border-emerald-800/50 text-emerald-200"}`}
        >
          {error || message}
        </div>
      )}

      <section>
        <h2 className="text-base font-semibold text-slate-200 mb-3">Search matches</h2>
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
          <div className="relative max-w-[14rem] min-w-[12rem]" ref={playerDropdownRef}>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Filter by players</label>
            <input
              type="text"
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
              onFocus={() => setPlayerDropdownOpen(true)}
              placeholder="Search players..."
              autoComplete="off"
              className="block w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-brand-orange focus:outline-none"
            />
            {playerDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-md max-h-48 overflow-y-auto z-10">
                {filteredPlayerOptions.length ? (
                  filteredPlayerOptions.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addPlayer(p.id)}
                      className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                    >
                      {p.name || p.id}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-sm text-slate-500">No matches</div>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-1 mt-1">
              {selectedPlayerIds.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-700 text-slate-200 text-xs"
                >
                  {playerName(id)}
                  <button
                    type="button"
                    onClick={() => removePlayer(id)}
                    className="text-slate-400 hover:text-slate-100"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={searchMatches}
              disabled={isLoading}
              className="rounded-md bg-brand-orange px-4 py-2 text-sm font-medium text-slate-950 hover:bg-orange-500 disabled:opacity-50"
            >
              {isLoading ? "Searching…" : "Search"}
            </button>
            <button
              type="button"
              onClick={clearSearch}
              className="rounded-md border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
            >
              Clear
            </button>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-slate-200 mb-3">Results</h2>
        {!hasSearched ? (
          <p className="text-sm text-slate-500">Enter search criteria and click Search to find matches.</p>
        ) : pageMatches.length === 0 ? (
          <ul className="list-none p-0">
            <li className="py-2 text-slate-400">No matches found.</li>
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
                  className="rounded-md border border-slate-600 px-3 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 hover:bg-slate-800"
                >
                  Prev
                </button>
                <span className="flex items-center gap-1">
                  {pageNums.map((p, i) =>
                    p === "…" ? (
                      <span key={`ellipsis-${i}`} className="px-1 text-slate-500">
                        …
                      </span>
                    ) : p === currentPage ? (
                      <span key={p} className="min-w-[2rem] px-2 py-1 text-center font-semibold text-slate-200">
                        {p}
                      </span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setCurrentPage(p as number)}
                        className="min-w-[2rem] rounded px-2 py-1 text-sm text-slate-300 hover:bg-slate-800 border border-slate-600"
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
                  className="rounded-md border border-slate-600 px-3 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 hover:bg-slate-800"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};

export default SquashPage;
