import React, { useEffect, useState } from "react";
import DateInput from "./DateInput";
import AddTagInput from "../memes/AddTagInput";
import { fetchWithAuth } from "../../utils/api";
import { Match, Player, apiError, getApiBaseUrl, inputCls, primaryBtn, secondaryBtn } from "./squashShared";

interface Props {
  players: Player[];
  allTags: string[];
  /** Match being edited, or null to add a new one. */
  editing: Match | null;
  onDone: () => void;
  onCancel: () => void;
  onError: (msg: string | null) => void;
}

const MatchForm: React.FC<Props> = ({ players, allTags, editing, onDone, onCancel, onError }) => {
  const [date, setDate] = useState("");
  const [ids, setIds] = useState<string[]>(["", "", "", ""]); // A1, A2, B1, B2
  const [winningTeam, setWinningTeam] = useState<"A" | "B">("A");
  const [loserGames, setLoserGames] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setDate("");
    setIds(["", "", "", ""]);
    setWinningTeam("A");
    setLoserGames(0);
    setTags([]);
  };

  useEffect(() => {
    if (!editing) {
      reset();
      return;
    }
    setDate(editing.date || "");
    setIds([
      editing.teamAPlayer1Id || "",
      editing.teamAPlayer2Id || "",
      editing.teamBPlayer1Id || "",
      editing.teamBPlayer2Id || ""
    ]);
    setWinningTeam((editing.winningTeam as "A" | "B") || "A");
    setLoserGames(editing.winningTeam === "A" ? (editing.teamBGames ?? 0) : (editing.teamAGames ?? 0));
    setTags(editing.tags || []);
  }, [editing]);

  const setId = (i: number, v: string) => setIds((prev) => prev.map((x, j) => (j === i ? v : x)));
  const optionsFor = (i: number) => {
    const others = ids.filter((_, j) => j !== i);
    return players.filter((p) => !others.includes(p.id));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || ids.some((x) => !x)) {
      onError("All fields are required.");
      return;
    }
    if (new Set(ids).size !== 4) {
      onError("Each player can only be on one team.");
      return;
    }
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const payload: Record<string, unknown> = {
      date,
      teamAPlayer1Id: ids[0],
      teamAPlayer2Id: ids[1],
      teamBPlayer1Id: ids[2],
      teamBPlayer2Id: ids[3],
      winningTeam,
      teamAGames: winningTeam === "A" ? 3 : loserGames,
      teamBGames: winningTeam === "B" ? 3 : loserGames,
      tags
    };
    if (editing) payload.id = editing.id;
    setSubmitting(true);
    onError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/squash/matches`, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error(await apiError(resp));
      reset();
      onDone();
    } catch (err: any) {
      onError(err?.message ?? "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  const labels = ["Team A – Player 1", "Team A – Player 2", "Team B – Player 1", "Team B – Player 2"];

  return (
    <section>
      <h2 className="text-base font-semibold text-text-primary mb-3">{editing ? "Edit match" : "Add match"}</h2>
      <form onSubmit={submit} className="grid grid-cols-2 gap-4 max-w-2xl">
        <div className="col-span-2">
          <DateInput id="matchDate" value={date} onChange={setDate} label="Date" required />
        </div>
        {labels.map((label, i) => (
          <div key={label}>
            <label htmlFor={`matchPlayer${i}`} className="block text-xs font-semibold text-text-secondary mb-1">
              {label}
            </label>
            <select id={`matchPlayer${i}`} value={ids[i]} onChange={(e) => setId(i, e.target.value)} className={inputCls}>
              <option value="">— Select —</option>
              {optionsFor(i).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.id}
                </option>
              ))}
            </select>
          </div>
        ))}
        <div>
          <label htmlFor="matchWinningTeam" className="block text-xs font-semibold text-text-secondary mb-1">
            Winning team
          </label>
          <select
            id="matchWinningTeam"
            value={winningTeam}
            onChange={(e) => setWinningTeam(e.target.value as "A" | "B")}
            className={inputCls}
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
            value={loserGames}
            onChange={(e) => setLoserGames(parseInt(e.target.value, 10))}
            className={inputCls}
          >
            <option value={0}>0</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-text-secondary mb-1">Tags</label>
          <AddTagInput tags={tags} onTagsChange={setTags} allTags={allTags} placeholder="Add tags..." />
        </div>
        <div className="col-span-2 flex gap-2">
          <button type="submit" disabled={submitting} className={primaryBtn}>
            {editing ? "Update match" : "Add match"}
          </button>
          <button
            type="button"
            onClick={() => {
              reset();
              onCancel();
            }}
            className={secondaryBtn}
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
};

export default MatchForm;
