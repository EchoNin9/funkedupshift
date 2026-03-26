import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth, canModifySquash } from "../../shell/AuthContext";
import DateInput from "./DateInput";
import { fetchWithAuth } from "../../utils/api";

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
  userId?: string;
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

interface AdminUser {
  username?: string;
  email?: string;
  sub?: string;
}

const PAGE_SIZE = 10;

const SquashAdminPage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<"matches" | "players">("matches");

  // Matches tab state
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
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerDropdownOpen, setPlayerDropdownOpen] = useState(false);
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [matchDate, setMatchDate] = useState("");
  const [matchTeamAP1, setMatchTeamAP1] = useState("");
  const [matchTeamAP2, setMatchTeamAP2] = useState("");
  const [matchTeamBP1, setMatchTeamBP1] = useState("");
  const [matchTeamBP2, setMatchTeamBP2] = useState("");
  const [matchWinningTeam, setMatchWinningTeam] = useState<"A" | "B">("A");
  const [matchLoserGames, setMatchLoserGames] = useState(0);
  const [isMatchSubmitting, setIsMatchSubmitting] = useState(false);
  const [isMatchesLoading, setIsMatchesLoading] = useState(false);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">(() => {
    const s = searchParams.get("sortOrder");
    return s === "oldest" ? "oldest" : "newest";
  });
  const [playerMode, setPlayerMode] = useState<"and" | "or">(() => {
    const m = searchParams.get("playerMode");
    return m === "or" ? "or" : "and";
  });
  const playerDropdownRef = useRef<HTMLDivElement>(null);

  // Players tab state
  const [players, setPlayers] = useState<Player[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [playerFormName, setPlayerFormName] = useState("");
  const [playerFormEmail, setPlayerFormEmail] = useState("");
  const [playerFormUserId, setPlayerFormUserId] = useState("");
  const [isPlayerSubmitting, setIsPlayerSubmitting] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canModify = canModifySquash(user);


  const getPlayerName = (id: string) => {
    const p = allPlayers.find((x) => x.id === id || x.PK === id);
    return p ? p.name || p.id || id : id;
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
      const list = (data.players ?? []).map((p) => ({ ...p, id: p.id || p.PK || "" }));
      setAllPlayers(list);
      setPlayers(list);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load players");
    }
  };

  const loadAdminUsers = async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/users?limit=60`);
      if (!resp.ok) return;
      const data = (await resp.json()) as { users?: AdminUser[] };
      setAdminUsers(data.users ?? []);
    } catch {
      setAdminUsers([]);
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
    setIsMatchesLoading(true);
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
      setIsMatchesLoading(false);
    }
  };

  const clearMatchSearch = () => {
    setSearchDate("");
    setSearchDateFrom("");
    setSearchDateTo("");
    setSelectedPlayerIds([]);
    setPlayerMode("and");
    setPlayerSearch("");
    setHasSearched(false);
    setAllMatches([]);
    setCurrentPage(1);
    setSearchParams({}, { replace: true });
  };

  const addPlayerFilter = (id: string) => {
    if (!selectedPlayerIds.includes(id)) setSelectedPlayerIds([...selectedPlayerIds, id]);
    setPlayerSearch("");
  };

  const removePlayerFilter = (id: string) => {
    setSelectedPlayerIds(selectedPlayerIds.filter((x) => x !== id));
  };

  const filteredPlayerOptions = allPlayers.filter(
    (p) =>
      !selectedPlayerIds.includes(p.id) &&
      (!playerSearch.trim() || (p.name || "").toLowerCase().includes(playerSearch.toLowerCase()))
  );

  const selectedInForm = [matchTeamAP1, matchTeamAP2, matchTeamBP1, matchTeamBP2];
  const playerOptionsFor = (field: "p1" | "p2" | "p3" | "p4") => {
    const idx = field === "p1" ? 0 : field === "p2" ? 1 : field === "p3" ? 2 : 3;
    const others = selectedInForm.filter((_, i) => i !== idx);
    return allPlayers.filter((p) => !others.includes(p.id));
  };

  const handleMatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchDate || !matchTeamAP1 || !matchTeamAP2 || !matchTeamBP1 || !matchTeamBP2) {
      setError("All fields are required.");
      return;
    }
    const ids = [matchTeamAP1, matchTeamAP2, matchTeamBP1, matchTeamBP2];
    if (new Set(ids).size !== 4) {
      setError("Each player can only be on one team.");
      return;
    }
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const teamAGames = matchWinningTeam === "A" ? 3 : matchLoserGames;
    const teamBGames = matchWinningTeam === "B" ? 3 : matchLoserGames;
    const payload = {
      date: matchDate,
      teamAPlayer1Id: matchTeamAP1,
      teamAPlayer2Id: matchTeamAP2,
      teamBPlayer1Id: matchTeamBP1,
      teamBPlayer2Id: matchTeamBP2,
      winningTeam: matchWinningTeam,
      teamAGames,
      teamBGames
    };
    const method = editingMatchId ? "PUT" : "POST";
    if (editingMatchId) (payload as any).id = editingMatchId;
    setIsMatchSubmitting(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/squash/matches`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed");
      }
      setEditingMatchId(null);
      setMatchDate("");
      setMatchTeamAP1("");
      setMatchTeamAP2("");
      setMatchTeamBP1("");
      setMatchTeamBP2("");
      setMatchWinningTeam("A");
      setMatchLoserGames(0);
      searchMatches();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setIsMatchSubmitting(false);
    }
  };

  const cancelMatchEdit = () => {
    setEditingMatchId(null);
    setMatchDate("");
    setMatchTeamAP1("");
    setMatchTeamAP2("");
    setMatchTeamBP1("");
    setMatchTeamBP2("");
    setMatchWinningTeam("A");
    setMatchLoserGames(0);
  };

  const startEditMatch = (m: Match) => {
    const id = m.id || (m as any).PK?.replace?.("SQUASH#MATCH#", "") || "";
    setEditingMatchId(id);
    setMatchDate(m.date || "");
    setMatchTeamAP1(m.teamAPlayer1Id || "");
    setMatchTeamAP2(m.teamAPlayer2Id || "");
    setMatchTeamBP1(m.teamBPlayer1Id || "");
    setMatchTeamBP2(m.teamBPlayer2Id || "");
    setMatchWinningTeam((m.winningTeam as "A" | "B") || "A");
    setMatchLoserGames(m.winningTeam === "A" ? (m.teamBGames ?? 0) : (m.teamAGames ?? 0));
  };

  const deleteMatch = async (id: string) => {
    if (!confirm("Delete this match?")) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      const resp = await fetchWithAuth(`${apiBase}/squash/matches?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed");
      }
      searchMatches();
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
    }
  };

  const handlePlayerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = playerFormName.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const payload: { name: string; email?: string; userId?: string; id?: string } = {
      name,
      email: playerFormEmail.trim() || undefined,
      userId: playerFormUserId || undefined
    };
    const method = editingPlayerId ? "PUT" : "POST";
    if (editingPlayerId) payload.id = editingPlayerId;
    setIsPlayerSubmitting(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/squash/players`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed");
      }
      setEditingPlayerId(null);
      setPlayerFormName("");
      setPlayerFormEmail("");
      setPlayerFormUserId("");
      loadPlayers();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setIsPlayerSubmitting(false);
    }
  };

  const cancelPlayerEdit = () => {
    setEditingPlayerId(null);
    setPlayerFormName("");
    setPlayerFormEmail("");
    setPlayerFormUserId("");
  };

  const startEditPlayer = (p: Player) => {
    setEditingPlayerId(p.id);
    setPlayerFormName(p.name || "");
    setPlayerFormEmail(p.email || "");
    setPlayerFormUserId(p.userId || "");
  };

  const deletePlayer = async (id: string) => {
    if (!confirm("Delete this player?")) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      const resp = await fetchWithAuth(`${apiBase}/squash/players?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed");
      }
      loadPlayers();
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
    }
  };

  useEffect(() => {
    if (canModify) {
      loadPlayers();
      if (activeTab === "players") loadAdminUsers();
    }
  }, [canModify, activeTab]);

  const hasUrlSearchParams =
    searchParams.get("date") ||
    searchParams.get("dateFrom") ||
    searchParams.get("dateTo") ||
    searchParams.get("playerIds");
  useEffect(() => {
    if (!canModify || !hasUrlSearchParams) return;
    searchMatches();
  }, []);

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

  const sortedMatches = useMemo(() => {
    const copy = [...allMatches];
    copy.sort((a, b) => {
      const da = a.date || "";
      const db = b.date || "";
      return sortOrder === "newest" ? db.localeCompare(da) : da.localeCompare(db);
    });
    return copy;
  }, [allMatches, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(sortedMatches.length / PAGE_SIZE));
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageMatches = sortedMatches.slice(start, start + PAGE_SIZE);

  const renderMatchScore = (m: Match) => {
    const ga = m.teamAGames ?? 0;
    const gb = m.teamBGames ?? 0;
    return m.winningTeam === "A" ? `${ga}-${gb}` : `${gb}-${ga}`;
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
        <h1 className="text-xl font-semibold text-text-primary">Squash Admin</h1>
        <div className="rounded-md bg-red-900/30 border border-red-800/50 px-4 py-3 text-sm text-red-200">
          Sign in required. <Link to="/auth" className="underline hover:text-red-100">Sign in</Link>
        </div>
      </div>
    );
  }

  if (!canModify) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-text-primary">Squash Admin</h1>
        <div className="rounded-md bg-amber-900/30 border border-amber-800/50 px-4 py-3 text-sm text-amber-200">
          Squash Admin requires manager (in Squash group) or SuperAdmin access.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">Squash Admin</h1>

      <p className="text-sm text-text-secondary">
        <Link to="/squash" className="text-accent-500 hover:text-orange-400">
          Squash
        </Link>
      </p>

      {(message || error) && (
        <div
          className={`rounded-md px-4 py-3 text-sm ${error ? "bg-red-900/30 border border-red-800/50 text-red-200" : "bg-emerald-900/30 border border-emerald-800/50 text-emerald-200"}`}
        >
          {error || message}
        </div>
      )}

      <div className="flex gap-2 border-b border-border-default pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("matches")}
          className={`px-4 py-2 rounded-md text-sm font-medium ${activeTab === "matches" ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:text-text-primary transition-colors"}`}
        >
          Matches
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("players")}
          className={`px-4 py-2 rounded-md text-sm font-medium ${activeTab === "players" ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:text-text-primary transition-colors"}`}
        >
          Players
        </button>
      </div>

      {activeTab === "matches" && (
        <>
          <section>
            <h2 className="text-base font-semibold text-text-primary mb-3">Add match</h2>
            <form onSubmit={handleMatchSubmit} className="grid grid-cols-2 gap-4 max-w-2xl">
              <div className="col-span-2">
                <DateInput
                  id="matchDate"
                  value={matchDate}
                  onChange={setMatchDate}
                  label="Date"
                  required
                />
              </div>
              <div>
                <label htmlFor="matchTeamAP1" className="block text-xs font-semibold text-text-secondary mb-1">
                  Team A – Player 1
                </label>
                <select
                  id="matchTeamAP1"
                  value={matchTeamAP1}
                  onChange={(e) => setMatchTeamAP1(e.target.value)}
                  className="block w-full rounded-md border border-border-hover bg-surface-2 px-3 py-2 text-sm text-text-primary focus:border-accent-500 focus:outline-none"
                >
                  <option value="">— Select —</option>
                  {playerOptionsFor("p1").map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="matchTeamAP2" className="block text-xs font-semibold text-text-secondary mb-1">
                  Team A – Player 2
                </label>
                <select
                  id="matchTeamAP2"
                  value={matchTeamAP2}
                  onChange={(e) => setMatchTeamAP2(e.target.value)}
                  className="block w-full rounded-md border border-border-hover bg-surface-2 px-3 py-2 text-sm text-text-primary focus:border-accent-500 focus:outline-none"
                >
                  <option value="">— Select —</option>
                  {playerOptionsFor("p2").map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="matchTeamBP1" className="block text-xs font-semibold text-text-secondary mb-1">
                  Team B – Player 1
                </label>
                <select
                  id="matchTeamBP1"
                  value={matchTeamBP1}
                  onChange={(e) => setMatchTeamBP1(e.target.value)}
                  className="block w-full rounded-md border border-border-hover bg-surface-2 px-3 py-2 text-sm text-text-primary focus:border-accent-500 focus:outline-none"
                >
                  <option value="">— Select —</option>
                  {playerOptionsFor("p3").map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="matchTeamBP2" className="block text-xs font-semibold text-text-secondary mb-1">
                  Team B – Player 2
                </label>
                <select
                  id="matchTeamBP2"
                  value={matchTeamBP2}
                  onChange={(e) => setMatchTeamBP2(e.target.value)}
                  className="block w-full rounded-md border border-border-hover bg-surface-2 px-3 py-2 text-sm text-text-primary focus:border-accent-500 focus:outline-none"
                >
                  <option value="">— Select —</option>
                  {playerOptionsFor("p4").map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="matchWinningTeam" className="block text-xs font-semibold text-text-secondary mb-1">
                  Winning team
                </label>
                <select
                  id="matchWinningTeam"
                  value={matchWinningTeam}
                  onChange={(e) => setMatchWinningTeam(e.target.value as "A" | "B")}
                  className="block w-full rounded-md border border-border-hover bg-surface-2 px-3 py-2 text-sm text-text-primary focus:border-accent-500 focus:outline-none"
                >
                  <option value="A">Team A</option>
                  <option value="B">Team B</option>
                </select>
              </div>
              <div>
                <label htmlFor="matchLoserGames" className="block text-xs font-semibold text-text-secondary mb-1">
                  Games won by losing team
                </label>
                <select
                  id="matchLoserGames"
                  value={matchLoserGames}
                  onChange={(e) => setMatchLoserGames(parseInt(e.target.value, 10))}
                  className="block w-full rounded-md border border-border-hover bg-surface-2 px-3 py-2 text-sm text-text-primary focus:border-accent-500 focus:outline-none"
                >
                  <option value={0}>0</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </div>
              <div className="col-span-2 flex gap-2">
                <button
                  type="submit"
                  disabled={isMatchSubmitting}
                  className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-surface-0 hover:bg-orange-500 disabled:opacity-50"
                >
                  {editingMatchId ? "Update match" : "Add match"}
                </button>
                <button
                  type="button"
                  onClick={cancelMatchEdit}
                  className="rounded-md border border-border-default px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-3 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>

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
              <div className="relative max-w-[14rem] min-w-[12rem]" ref={playerDropdownRef}>
                <label className="block text-xs font-semibold text-text-secondary mb-1">Filter by players</label>
                <input
                  type="text"
                  value={playerSearch}
                  onChange={(e) => setPlayerSearch(e.target.value)}
                  onFocus={() => setPlayerDropdownOpen(true)}
                  placeholder="Search players..."
                  autoComplete="off"
                  className="block w-full rounded-md border border-border-hover bg-surface-2 px-3 py-2 text-sm text-text-primary focus:border-accent-500 focus:outline-none"
                />
                {playerDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-surface-2 border border-border-hover rounded-md max-h-48 overflow-y-auto scrollbar-thin z-10">
                    {filteredPlayerOptions.length ? (
                      filteredPlayerOptions.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => addPlayerFilter(p.id)}
                          className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-surface-3 transition-colors"
                        >
                          {p.name || p.id}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-text-tertiary">No matches</div>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedPlayerIds.map((id) => (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-3 text-text-primary text-xs"
                    >
                      {getPlayerName(id)}
                      <button type="button" onClick={() => removePlayerFilter(id)} className="text-text-secondary hover:text-text-primary transition-colors" aria-label="Remove">
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                {selectedPlayerIds.length > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-text-tertiary">Match:</span>
                    <div className="inline-flex rounded-md border border-border-hover bg-surface-1 p-0.5">
                      <button
                        type="button"
                        onClick={() => setPlayerMode("and")}
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          playerMode === "and" ? "bg-accent-500 text-surface-0" : "text-text-secondary hover:text-text-primary transition-colors"
                        }`}
                      >
                        AND
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlayerMode("or")}
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          playerMode === "or" ? "bg-accent-500 text-surface-0" : "text-text-secondary hover:text-text-primary transition-colors"
                        }`}
                      >
                        OR
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={searchMatches}
                  disabled={isMatchesLoading}
                  className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-surface-0 hover:bg-orange-500 disabled:opacity-50"
                >
                  {isMatchesLoading ? "Searching…" : "Search"}
                </button>
                <button
                  type="button"
                  onClick={clearMatchSearch}
                  className="rounded-md border border-border-default px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-3 transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
          </section>

          <section>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <h2 className="text-base font-semibold text-text-primary">Search results</h2>
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
              <div className="rounded-md border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-secondary mb-3">
                {sortedMatches.length === 0 ? "No results" : `${sortedMatches.length} results`}
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
                  {pageMatches.map((m) => {
                    const id = m.id || (m as any).PK?.replace?.("SQUASH#MATCH#", "") || "";
                    const teamA = [getPlayerName(m.teamAPlayer1Id || ""), getPlayerName(m.teamAPlayer2Id || "")].filter(Boolean).join(" & ");
                    const teamB = [getPlayerName(m.teamBPlayer1Id || ""), getPlayerName(m.teamBPlayer2Id || "")].filter(Boolean).join(" & ");
                    return (
                      <li key={id} className="flex items-center gap-2 flex-wrap py-2 border-b border-border-default last:border-0">
                        <span className="font-semibold text-text-primary">{m.date || ""}</span>
                        <span className="text-text-secondary">
                          {teamA} vs {teamB}
                        </span>
                        <span className="italic text-text-secondary">{renderMatchScore(m)}</span>
                        <button
                          type="button"
                          onClick={() => startEditMatch(m)}
                          className="rounded-md border border-border-default px-2 py-1 text-xs text-text-secondary hover:bg-surface-3 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteMatch(id)}
                          className="rounded-md border border-red-800/50 px-2 py-1 text-xs text-red-300 hover:bg-red-900/30"
                        >
                          Delete
                        </button>
                      </li>
                    );
                  })}
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
                          <span key={`ellipsis-${i}`} className="px-1 text-text-tertiary">…</span>
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

      {activeTab === "players" && (
        <>
          <section>
            <h2 className="text-base font-semibold text-text-primary mb-3">Players</h2>
            <form onSubmit={handlePlayerSubmit} className="space-y-4 max-w-md">
              <div>
                <label htmlFor="playerName" className="block text-xs font-semibold text-text-secondary mb-1">
                  Name
                </label>
                <input
                  type="text"
                  id="playerName"
                  value={playerFormName}
                  onChange={(e) => setPlayerFormName(e.target.value)}
                  required
                  placeholder="Player name"
                  className="block w-full rounded-md border border-border-hover bg-surface-2 px-3 py-2 text-sm text-text-primary focus:border-accent-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="playerEmail" className="block text-xs font-semibold text-text-secondary mb-1">
                  Email (optional)
                </label>
                <input
                  type="email"
                  id="playerEmail"
                  value={playerFormEmail}
                  onChange={(e) => setPlayerFormEmail(e.target.value)}
                  placeholder="player@example.com"
                  className="block w-full rounded-md border border-border-hover bg-surface-2 px-3 py-2 text-sm text-text-primary focus:border-accent-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="playerUserId" className="block text-xs font-semibold text-text-secondary mb-1">
                  Link to user (optional)
                </label>
                <select
                  id="playerUserId"
                  value={playerFormUserId}
                  onChange={(e) => setPlayerFormUserId(e.target.value)}
                  className="block w-full rounded-md border border-border-hover bg-surface-2 px-3 py-2 text-sm text-text-primary focus:border-accent-500 focus:outline-none"
                >
                  <option value="">— None —</option>
                  {adminUsers.map((u) => (
                    <option key={u.sub || u.username} value={u.sub || ""}>
                      {u.email || u.username || u.sub}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isPlayerSubmitting}
                  className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-surface-0 hover:bg-orange-500 disabled:opacity-50"
                >
                  {editingPlayerId ? "Update player" : "Add player"}
                </button>
                <button
                  type="button"
                  onClick={cancelPlayerEdit}
                  className="rounded-md border border-border-default px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-3 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary mb-3">Player list</h2>
            {players.length === 0 ? (
              <p className="text-sm text-text-tertiary">No players yet. Add players above.</p>
            ) : (
              <ul className="list-none p-0">
                {players.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 flex-wrap py-2 border-b border-border-default last:border-0">
                    <span className="font-semibold text-text-primary">{p.name || p.id}</span>
                    {p.email && <span className="text-text-tertiary text-sm">({p.email})</span>}
                    <button
                      type="button"
                      onClick={() => startEditPlayer(p)}
                      className="rounded-md border border-border-default px-2 py-1 text-xs text-text-secondary hover:bg-surface-3 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePlayer(p.id)}
                      className="rounded-md border border-red-800/50 px-2 py-1 text-xs text-red-300 hover:bg-red-900/30"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default SquashAdminPage;
