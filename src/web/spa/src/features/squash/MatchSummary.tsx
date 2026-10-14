import React from "react";
import { Badge } from "../../components";
import { Match, Player } from "./squashShared";

/** Date, "winners vs losers", winner-first score and tags, as flex-row children. */
const MatchSummary: React.FC<{ match: Match; players: Player[] }> = ({ match: m, players }) => {
  const name = (id: string) => {
    const p = players.find((x) => x.id === id || x.PK === id);
    return p ? p.name || p.id || id : id;
  };
  const teamA = [name(m.teamAPlayer1Id || ""), name(m.teamAPlayer2Id || "")].filter(Boolean).join(" & ");
  const teamB = [name(m.teamBPlayer1Id || ""), name(m.teamBPlayer2Id || "")].filter(Boolean).join(" & ");
  const bWon = m.winningTeam === "B";
  const ga = m.teamAGames ?? 0;
  const gb = m.teamBGames ?? 0;
  return (
    <>
      <span className="font-semibold text-text-primary">{m.date || ""}</span>
      <span className="text-text-secondary">
        {bWon ? teamB : teamA} vs {bWon ? teamA : teamB}
      </span>
      <span className="italic text-text-secondary">{bWon ? `${gb}-${ga}` : `${ga}-${gb}`}</span>
      {(m.tags || []).length > 0 && (
        <span className="flex flex-wrap gap-1">
          {(m.tags || []).map((t) => (
            <Badge key={t} label={t} />
          ))}
        </span>
      )}
    </>
  );
};

export default MatchSummary;
