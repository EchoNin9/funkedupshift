import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeftIcon, PencilSquareIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole, canAccessMemes } from "../../shell/AuthContext";

interface MemeItem {
  PK: string;
  title?: string;
  description?: string;
  averageRating?: number;
  mediaUrl?: string;
  thumbnailUrl?: string;
  tags?: string[];
  isPrivate?: boolean;
  userId?: string;
}

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

const MemeDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [item, setItem] = useState<MemeItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canEditTags = !!user && (hasRole(user, "user") || hasRole(user, "manager") || hasRole(user, "superadmin"));
  const memeId = id ? decodeURIComponent(id) : "";

  const fetchWithAuth = React.useCallback(async (url: string) => {
    const w = window as any;
    if (!w.auth?.getAccessToken) throw new Error("Not signed in");
    const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
    if (!token) throw new Error("Not signed in");
    return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }, []);

  useEffect(() => {
    const apiBase = getApiBaseUrl();
    if (!apiBase || !memeId) {
      setError(memeId ? "API URL not set." : "Missing meme id.");
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const resp = await fetchWithAuth(`${apiBase}/memes?id=${encodeURIComponent(memeId)}`);
        if (resp.status === 404) {
          if (!cancelled) setItem(null);
          return;
        }
        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${txt}`);
        }
        const data = (await resp.json()) as { meme?: MemeItem };
        if (cancelled) return;
        setItem(data.meme ?? null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load meme.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [memeId, fetchWithAuth]);

  const handleRate = async (rating: number) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase || !item) return;
    try {
      const w = window as any;
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      const resp = await fetch(`${apiBase}/memes/stars`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ memeId: item.PK, rating })
      });
      if (resp.ok) {
        const data = (await resp.json()) as { averageRating?: number };
        setItem((prev) => (prev ? { ...prev, averageRating: data.averageRating ?? rating } : null));
      }
    } catch {
      /* ignore */
    }
  };

  const access = canAccessMemes(user);
  if (!user || !access) {
    return (
      <div className="space-y-6">
        <Link to="/memes" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Memes
        </Link>
        <div className="rounded-md border border-slate-700 bg-slate-900/60 px-4 py-3 text-slate-200">
          Sign in and join Memes group to view.
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Link to="/memes" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Memes
        </Link>
        <div className="text-sm text-slate-400">Loading…</div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="space-y-4">
        <Link to="/memes" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Memes
        </Link>
        <div className="rounded-md border border-slate-700 bg-slate-900/60 px-4 py-3 text-slate-200">
          {error || "Meme not found."}
        </div>
      </div>
    );
  }

  const title = item.title || item.PK || "Untitled";
  const imgUrl = item.mediaUrl || item.thumbnailUrl;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <Link to="/memes" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Memes
        </Link>
        {canEditTags && (
          <Link
            to={`/memes/${encodeURIComponent(item.PK)}/edit`}
            className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
          >
            <PencilSquareIcon className="h-4 w-4" />
            Edit
          </Link>
        )}
      </header>

      <div className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
        {imgUrl && (
          <img
            src={imgUrl}
            alt={title}
            className="w-full max-w-2xl mx-auto block"
          />
        )}
      </div>

      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-slate-50">{title}</h1>
        {item.isPrivate && (
          <span className="inline-flex rounded-full bg-slate-900 px-2 py-0.5 text-xs uppercase text-slate-500">
            Private
          </span>
        )}
        {item.description && (
          <p className="text-sm text-slate-300">{item.description}</p>
        )}
        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {user && (
          <div className="pt-2">
            <label className="inline-flex items-center gap-2 text-sm text-slate-400">
              <span>Rate:</span>
              <select
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-50"
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (value >= 1 && value <= 5) handleRate(value);
                }}
                defaultValue=""
              >
                <option value="">--</option>
                <option value="5">5</option>
                <option value="4">4</option>
                <option value="3">3</option>
                <option value="2">2</option>
                <option value="1">1</option>
              </select>
              {typeof item.averageRating === "number" && (
                <span className="text-amber-300">{item.averageRating.toFixed(1)}★</span>
              )}
            </label>
          </div>
        )}
      </div>
    </div>
  );
};

export default MemeDetailPage;
