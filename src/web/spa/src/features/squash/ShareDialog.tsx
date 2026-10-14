import React, { useEffect, useMemo, useState } from "react";
import { SegmentedControl } from "../../components/SegmentedControl";
import { CopyButton } from "../../components/CopyButton";
import { fetchWithAuth } from "../../utils/api";
import DateInput from "./DateInput";
import PlayerPicker from "./PlayerPicker";
import MatchSummary from "./MatchSummary";
import {
  Match,
  Player,
  SHARE_LIMIT,
  SearchFilters,
  Share,
  apiError,
  getApiBaseUrl,
  inputCls,
  primaryBtn,
  secondaryBtn,
  smallBtn,
  shareUrl
} from "./squashShared";

interface Props {
  /** Present when editing an existing share; absent when creating. */
  share?: Share;
  /** Current Matches-tab filters; used when creating. Edit mode seeds from share.filters. */
  filters?: SearchFilters;
  onClose: () => void;
  onSaved: () => void;
}

const MODE_OPTIONS = [
  { id: "snapshot" as const, label: "Snapshot" },
  { id: "live" as const, label: "Updates Live" }
];

const clampDays = (n: number) => (Number.isFinite(n) ? Math.min(90, Math.max(1, Math.round(n))) : 30);

const PREVIEW_ROWS = 5;

const buildFilters = (date: string, dateFrom: string, dateTo: string, playerIds: string[], playerMode: "and" | "or"): SearchFilters => ({
  ...(date ? { date } : {}),
  ...(dateFrom ? { dateFrom } : {}),
  ...(dateTo ? { dateTo } : {}),
  ...(playerIds.length ? { playerIds, playerMode } : {})
});

const ShareDialog: React.FC<Props> = ({ share, filters: createFilters = {}, onClose, onSaved }) => {
  const editing = !!share;
  const [title, setTitle] = useState(share?.title ?? "");
  const [mode, setMode] = useState<"snapshot" | "live">(share?.mode ?? "snapshot");
  const [days, setDays] = useState(editing ? "" : "30");
  const [refresh, setRefresh] = useState(false);
  const saved = share?.filters;
  const [qDate, setQDate] = useState(saved?.date ?? "");
  const [qFrom, setQFrom] = useState(saved?.dateFrom ?? "");
  const [qTo, setQTo] = useState(saved?.dateTo ?? "");
  const [qIds, setQIds] = useState<string[]>(saved?.playerIds ?? []);
  const [qMode, setQMode] = useState<"and" | "or">(saved?.playerMode === "or" ? "or" : "and");
  const [editQuery, setEditQuery] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [preview, setPreview] = useState<{ total: number; rows: Match[] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const editFilters = useMemo(() => buildFilters(qDate, qFrom, qTo, qIds, qMode), [qDate, qFrom, qTo, qIds, qMode]);
  const savedFilters = useMemo(
    () => buildFilters(saved?.date ?? "", saved?.dateFrom ?? "", saved?.dateTo ?? "", saved?.playerIds ?? [], saved?.playerMode === "or" ? "or" : "and"),
    [saved]
  );
  const filtersChanged = JSON.stringify(editFilters) !== JSON.stringify(savedFilters);
  const filtersKey = JSON.stringify(editFilters);

  useEffect(() => {
    if (!editing) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    fetchWithAuth(`${apiBase}/squash/players`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { players?: Player[] }) => setPlayers((d.players ?? []).map((p) => ({ ...p, id: p.id || p.PK || "" }))))
      .catch(() => undefined);
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const f = JSON.parse(filtersKey) as SearchFilters;
    const params = new URLSearchParams();
    if (f.date) params.set("date", f.date);
    if (f.dateFrom) params.set("dateFrom", f.dateFrom);
    if (f.dateTo) params.set("dateTo", f.dateTo);
    if (f.playerIds?.length) {
      params.set("playerIds", f.playerIds.join(","));
      params.set("playerMode", f.playerMode ?? "and");
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    const ctrl = new AbortController();
    setPreviewLoading(true);
    const t = setTimeout(async () => {
      try {
        const resp = await fetchWithAuth(`${apiBase}/squash/matches${qs}`, { signal: ctrl.signal });
        if (!resp.ok) throw new Error(await apiError(resp));
        const data = (await resp.json()) as { matches?: Match[] };
        const all = [...(data.matches ?? [])].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        setPreview({ total: all.length, rows: all.slice(0, PREVIEW_ROWS) });
        setPreviewError(null);
        setPreviewLoading(false);
      } catch (e: any) {
        if (ctrl.signal.aborted) return;
        setPreviewError(e?.message ?? "Failed to load preview");
        setPreviewLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [editing, filtersKey]);

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name || id;
  const querySummary = (() => {
    const parts: string[] = [];
    if (editFilters.date) parts.push(editFilters.date);
    if (editFilters.dateFrom || editFilters.dateTo) parts.push(`${editFilters.dateFrom || "…"} → ${editFilters.dateTo || "…"}`);
    if (editFilters.playerIds?.length)
      parts.push(`players: ${editFilters.playerIds.map(nameOf).join(editFilters.playerMode === "or" ? " OR " : " AND ")}`);
    return parts.length ? parts.join(" · ") : "all matches";
  })();
  const [count, setCount] = useState<number | null>(editing ? 0 : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  useEffect(() => {
    if (editing) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    fetchWithAuth(`${apiBase}/squash/shares`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { count?: number; shares?: Share[] }) => setCount(d.count ?? d.shares?.length ?? 0))
      .catch(() => setCount(0));
  }, [editing]);

  const atLimit = !editing && count !== null && count >= SHARE_LIMIT;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const d = Number(days);
    if (days.trim() === "" && !editing) {
      setError("Enter a number of days between 1 and 90.");
      return;
    }
    if (days.trim() !== "" && (!Number.isInteger(d) || d < 1 || d > 90)) {
      setError("Days must be a whole number between 1 and 90.");
      return;
    }
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    const body: Record<string, unknown> = { title: title.trim(), mode };
    if (days.trim() !== "") body.expiresInDays = clampDays(d);
    if (editing) {
      body.id = share!.id;
      if (filtersChanged) body.filters = editFilters;
      if (refresh && mode === "snapshot") body.refresh = true;
    } else {
      body.filters = createFilters;
    }
    setBusy(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/squash/shares`, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (resp.status === 409) throw new Error(`Share limit reached (${SHARE_LIMIT}/${SHARE_LIMIT}). Delete a share first.`);
      if (!resp.ok) throw new Error(await apiError(resp, resp.status === 400 ? "Invalid share settings." : "Failed"));
      const data = (await resp.json().catch(() => ({}))) as { id?: string; share?: { id?: string } };
      onSaved();
      if (editing) onClose();
      else setCreatedId(data.id ?? data.share?.id ?? null);
    } catch (err: any) {
      setError(err?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={editing ? "Edit share" : "Share results"}>
      <div className={`w-full ${editing ? "max-w-3xl" : "max-w-md"} max-h-[90vh] overflow-y-auto space-y-4 rounded-lg border border-border-default bg-surface-1 p-5`}>
        <h2 className="text-base font-semibold text-text-primary">{editing ? "Edit share" : "Share results"}</h2>

        {createdId ? (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">Share created. Anyone with this link can view it:</p>
            <p className="break-all text-sm text-accent-text">{shareUrl(createdId)}</p>
            <div className="flex gap-2">
              <CopyButton text={shareUrl(createdId)} label="Copy link" />
              <button type="button" onClick={onClose} className={secondaryBtn}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className={editing ? "grid gap-4 sm:grid-cols-2" : "space-y-4"}>
            <div className="space-y-4">
            {atLimit && (
              <div className="rounded-md bg-warning/30 border border-warning/50 px-3 py-2 text-sm text-warning">
                You have reached the limit of {SHARE_LIMIT} active shares ({count}/{SHARE_LIMIT}). Delete one to create another.
              </div>
            )}
            {error && <div className="rounded-md bg-danger/20 border border-danger/20 px-3 py-2 text-sm text-danger">{error}</div>}
            <div>
              <label htmlFor="shareTitle" className="block text-xs font-semibold text-text-secondary mb-1">
                Title
              </label>
              <input
                id="shareTitle"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                disabled={atLimit}
                className={inputCls}
              />
            </div>
            <div>
              <span className="block text-xs font-semibold text-text-secondary mb-1">Type</span>
              <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={setMode} ariaLabel="Share type" size="sm" />
            </div>
            <div>
              <label htmlFor="shareDays" className="block text-xs font-semibold text-text-secondary mb-1">
                Expires in (days)
              </label>
              <input
                id="shareDays"
                type="number"
                min={1}
                max={90}
                step={1}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                onBlur={() => days.trim() !== "" && setDays(String(clampDays(Number(days))))}
                disabled={atLimit}
                className={`${inputCls} max-w-[8rem]`}
              />
              {editing && <p className="mt-1 text-xs text-text-tertiary">Leave blank to keep the current expiry.</p>}
            </div>
            {editing && mode === "snapshot" && (
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} />
                Refresh snapshot with latest matches
              </label>
            )}
            </div>
            {editing && (
              <div className="space-y-3 min-w-0">
                <div className="rounded-md border border-border-default bg-surface-2 px-3 py-2 text-sm text-text-secondary">
                  <span className="font-semibold text-text-primary">Query:</span> {querySummary}
                  <button type="button" onClick={() => setEditQuery((v) => !v)} className={`${smallBtn} ml-2`} aria-expanded={editQuery}>
                    {editQuery ? "Hide query" : "Edit query"}
                  </button>
                </div>
                {editQuery && (
                  <div className="space-y-3 rounded-md border border-border-default p-3">
                    <DateInput
                      id="shareQDate"
                      value={qDate}
                      onChange={(v) => {
                        setQDate(v);
                        if (v) {
                          setQFrom("");
                          setQTo("");
                        }
                      }}
                      label="Date (exact)"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <DateInput
                        id="shareQFrom"
                        value={qFrom}
                        onChange={(v) => {
                          setQFrom(v);
                          if (v) setQDate("");
                        }}
                        label="Date from"
                      />
                      <DateInput
                        id="shareQTo"
                        value={qTo}
                        onChange={(v) => {
                          setQTo(v);
                          if (v) setQDate("");
                        }}
                        label="Date to"
                      />
                    </div>
                    <PlayerPicker players={players} selectedIds={qIds} onChange={setQIds} mode={qMode} onModeChange={setQMode} className="" />
                  </div>
                )}
                <div>
                  <div className="text-xs font-semibold text-text-secondary mb-1">Preview</div>
                  {previewError ? (
                    <p className="text-sm text-danger">{previewError}</p>
                  ) : !preview ? (
                    <p className="text-sm text-text-tertiary">Loading…</p>
                  ) : (
                    <div className={previewLoading ? "opacity-60" : ""}>
                      {preview.total === 0 ? (
                        <p className="text-sm text-text-tertiary">No matches</p>
                      ) : (
                        <>
                          <ul className="list-none p-0 text-sm">
                            {preview.rows.map((m, i) => (
                              <li key={m.id || i} className="flex items-center gap-2 flex-wrap py-1.5 border-b border-border-default last:border-0">
                                <MatchSummary match={m} players={players} />
                              </li>
                            ))}
                          </ul>
                          <p className="mt-1 text-xs text-text-tertiary">
                            Showing {preview.rows.length} of {preview.total} matches
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={busy || atLimit} className={primaryBtn}>
                {editing ? "Save" : "Create share"}
              </button>
              <button type="button" onClick={onClose} className={secondaryBtn}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ShareDialog;
