import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Alert, Badge } from "../../components";

interface PublicMatch {
  date?: string;
  teamA?: string[];
  teamB?: string[];
  winningTeam?: string;
  teamAGames?: number;
  teamBGames?: number;
  tags?: string[];
}

interface PublicShare {
  title: string;
  mode: "snapshot" | "live";
  expiresAt: number;
  matches: PublicMatch[];
}

/** Public, unauthenticated viewer for a shared squash result set. No useAuth;
 * plain fetch (the API route has no authorizer). */
const SquashSharePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [share, setShare] = useState<PublicShare | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const raw = (window as any).API_BASE_URL as string | undefined;
    const base = raw ? raw.replace(/\/$/, "") : "";
    if (!id) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    fetch(`${base}/squash/public/${encodeURIComponent(id)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("not found");
        return (await r.json()) as PublicShare;
      })
      .then((d) => !cancelled && setShare(d))
      .catch(() => !cancelled && setNotFound(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const row = (m: PublicMatch, i: number) => {
    const a = (m.teamA || []).join(" & ");
    const b = (m.teamB || []).join(" & ");
    const ga = m.teamAGames ?? 0;
    const gb = m.teamBGames ?? 0;
    const bWon = m.winningTeam === "B";
    return (
      <li key={i} className="flex items-center gap-2 flex-wrap py-2 border-b border-border-default last:border-0">
        <span className="font-semibold text-text-primary">{m.date || ""}</span>
        <span className="text-text-secondary">
          {bWon ? b : a} vs {bWon ? a : b}
        </span>
        <span className="italic text-text-secondary">{bWon ? `${gb}-${ga}` : `${ga}-${gb}`}</span>
        {(m.tags || []).length > 0 && (
          <span className="flex flex-wrap gap-1">
            {(m.tags || []).map((t) => (
              <Badge key={t} label={t} />
            ))}
          </span>
        )}
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {loading && <p role="status" className="text-sm text-text-secondary">Loading…</p>}
      {!loading && notFound && <Alert variant="error">Share expired or not found</Alert>}
      {!loading && share && (
        <>
          <h1 className="font-heading text-[24px] font-semibold tracking-[-0.02em] text-text-primary">{share.title}</h1>
          <p className="text-xs text-text-secondary">
            {share.mode === "live" ? "Updates live" : "Snapshot"} · Expires{" "}
            {new Date(share.expiresAt * 1000).toLocaleDateString()}
          </p>
          {share.matches.length === 0 ? (
            <p className="py-2 text-text-secondary">No matches.</p>
          ) : (
            <ul className="list-none p-0">{share.matches.map(row)}</ul>
          )}
        </>
      )}
    </div>
  );
};

export default SquashSharePage;
