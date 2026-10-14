import React, { useState } from "react";
import { fetchWithAuth } from "../../utils/api";
import { Player, apiError, getApiBaseUrl, inputCls, primaryBtn, secondaryBtn, smallBtn, dangerBtn } from "./squashShared";

interface Props {
  players: Player[];
  onChanged: () => void;
  onError: (msg: string | null) => void;
}

const PlayersTab: React.FC<Props> = ({ players, onChanged, onError }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setEditingId(null);
    setName("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      onError("Name is required.");
      return;
    }
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const payload: { name: string; id?: string } = { name: trimmed };
    if (editingId) payload.id = editingId;
    setSubmitting(true);
    onError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/squash/players`, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error(await apiError(resp));
      reset();
      onChanged();
    } catch (err: any) {
      onError(err?.message ?? "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this player?")) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      const resp = await fetchWithAuth(`${apiBase}/squash/players?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!resp.ok) throw new Error(await apiError(resp));
      onChanged();
    } catch (err: any) {
      onError(err?.message ?? "Delete failed");
    }
  };

  return (
    <>
      <section>
        <h2 className="text-base font-semibold text-text-primary mb-3">Players</h2>
        <form onSubmit={submit} className="space-y-4 max-w-md">
          <div>
            <label htmlFor="playerName" className="block text-xs font-semibold text-text-secondary mb-1">
              Name
            </label>
            <input
              type="text"
              id="playerName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Player name"
              className={inputCls}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={submitting} className={primaryBtn}>
              {editingId ? "Update player" : "Add player"}
            </button>
            <button type="button" onClick={reset} className={secondaryBtn}>
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
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(p.id);
                    setName(p.name || "");
                  }}
                  className={smallBtn}
                >
                  Edit
                </button>
                <button type="button" onClick={() => remove(p.id)} className={dangerBtn}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
};

export default PlayersTab;
