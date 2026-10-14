import React, { useEffect, useState } from "react";
import { SegmentedControl } from "../../components/SegmentedControl";
import { CopyButton } from "../../components/CopyButton";
import { fetchWithAuth } from "../../utils/api";
import {
  SHARE_LIMIT,
  SearchFilters,
  Share,
  apiError,
  getApiBaseUrl,
  inputCls,
  primaryBtn,
  secondaryBtn,
  shareUrl
} from "./squashShared";

interface Props {
  /** Present when editing an existing share; absent when creating. */
  share?: Share;
  /** Current search filters on the Matches tab. */
  filters: SearchFilters;
  onClose: () => void;
  onSaved: () => void;
}

const MODE_OPTIONS = [
  { id: "snapshot" as const, label: "Snapshot" },
  { id: "live" as const, label: "Updates Live" }
];

const clampDays = (n: number) => (Number.isFinite(n) ? Math.min(90, Math.max(1, Math.round(n))) : 30);

const ShareDialog: React.FC<Props> = ({ share, filters, onClose, onSaved }) => {
  const editing = !!share;
  const [title, setTitle] = useState(share?.title ?? "");
  const [mode, setMode] = useState<"snapshot" | "live">(share?.mode ?? "snapshot");
  const [days, setDays] = useState(editing ? "" : "30");
  const [refresh, setRefresh] = useState(false);
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
      if (refresh) {
        body.refresh = true;
        body.filters = filters;
      }
    } else {
      body.filters = filters;
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
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border-default bg-surface-1 p-5">
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
            {editing && (
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} />
                Refresh from current search
              </label>
            )}
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
