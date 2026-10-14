import React, { useCallback, useEffect, useState } from "react";
import { CopyButton } from "../../components/CopyButton";
import { Badge } from "../../components";
import { fetchWithAuth } from "../../utils/api";
import ShareDialog from "./ShareDialog";
import { SHARE_LIMIT, SearchFilters, Share, apiError, dangerBtn, getApiBaseUrl, shareUrl, smallBtn } from "./squashShared";

interface Props {
  filters: SearchFilters;
  onError: (msg: string | null) => void;
}

const SharesTab: React.FC<Props> = ({ filters, onError }) => {
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Share | null>(null);

  const load = useCallback(async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      const resp = await fetchWithAuth(`${apiBase}/squash/shares`);
      if (!resp.ok) throw new Error(await apiError(resp));
      const data = (await resp.json()) as { shares?: Share[] };
      setShares(data.shares ?? []);
    } catch (e: any) {
      onError(e?.message ?? "Failed to load shares");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: string) => {
    if (!confirm("Delete this share? Its link will stop working.")) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      const resp = await fetchWithAuth(`${apiBase}/squash/shares?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!resp.ok) throw new Error(await apiError(resp));
      load();
    } catch (e: any) {
      onError(e?.message ?? "Delete failed");
    }
  };

  return (
    <section>
      <h2 className="text-base font-semibold text-text-primary mb-3">
        Shares <span className="text-sm font-normal text-text-tertiary">{shares.length}/{SHARE_LIMIT}</span>
      </h2>
      {loading ? (
        <p className="text-sm text-text-tertiary">Loading…</p>
      ) : shares.length === 0 ? (
        <p className="text-sm text-text-tertiary">No shares yet. Search for matches and use "Share results".</p>
      ) : (
        <ul className="list-none p-0">
          {shares.map((s) => {
            const url = shareUrl(s.id);
            return (
              <li key={s.id} className="flex items-center gap-2 flex-wrap py-2 border-b border-border-default last:border-0">
                <span className="font-semibold text-text-primary">{s.title || "Untitled"}</span>
                <Badge label={s.mode === "live" ? "Updates Live" : "Snapshot"} />
                {s.expiresAt && (
                  <span className="text-xs text-text-tertiary">
                    Expires {new Date(s.expiresAt * 1000).toLocaleDateString()}
                  </span>
                )}
                <a href={url} target="_blank" rel="noreferrer" className="text-sm text-accent-text break-all">
                  {url}
                </a>
                <CopyButton text={url} />
                <button type="button" onClick={() => setEditing(s)} className={smallBtn}>
                  Edit
                </button>
                <button type="button" onClick={() => remove(s.id)} className={dangerBtn}>
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <ShareDialog share={editing} filters={filters} onClose={() => setEditing(null)} onSaved={load} />
      )}
    </section>
  );
};

export default SharesTab;
