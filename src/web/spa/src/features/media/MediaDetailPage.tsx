import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeftIcon, PencilSquareIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";

interface MediaCategory {
  id: string;
  name: string;
}

interface MediaItem {
  PK: string;
  title?: string;
  description?: string;
  averageRating?: number;
  mediaType?: "image" | "video" | string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  categories?: MediaCategory[];
}

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

const MediaDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [item, setItem] = useState<MediaItem | null>(null);
  const [userRating, setUserRating] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canEdit = hasRole(user ?? null, "manager");
  const mediaId = id ? decodeURIComponent(id) : "";

  useEffect(() => {
    const apiBase = getApiBaseUrl();
    if (!apiBase || !mediaId) {
      setError(mediaId ? "API URL not set." : "Missing media id.");
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const resp = await fetch(`${apiBase}/media?id=${encodeURIComponent(mediaId)}`);
        if (resp.status === 404) {
          if (!cancelled) setItem(null);
          return;
        }
        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${txt}`);
        }
        const data = (await resp.json()) as { media?: MediaItem | MediaItem[] };
        if (cancelled) return;
        const media = Array.isArray(data.media) ? data.media[0] : data.media;
        setItem(media ?? null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load media.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  const handleRate = async (rating: number) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase || !item) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
    if (!token) return;
    await fetch(`${apiBase}/media/stars`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mediaId: item.PK, rating })
    }).then(() => setUserRating(rating)).catch(() => {});
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Link to="/media" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Media
        </Link>
        <div className="text-sm text-slate-400">Loading…</div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="space-y-4">
        <Link to="/media" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Media
        </Link>
        <div className="rounded-md border border-slate-700 bg-slate-900/60 px-4 py-3 text-slate-200">
          {error || "Media not found."}
        </div>
      </div>
    );
  }

  const title = item.title || item.PK || "Untitled";
  const isVideo = item.mediaType === "video";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/media" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Media
        </Link>
        {canEdit && (
          <Link
            to={`/admin/media/edit/${encodeURIComponent(item.PK)}`}
            className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
          >
            <PencilSquareIcon className="h-4 w-4" />
            Edit
          </Link>
        )}
      </div>

      <article className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
        <header className="p-4 sm:p-6 border-b border-slate-800">
          <h1 className="text-xl font-semibold tracking-tight text-slate-50">{title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {typeof item.averageRating === "number" && (
              <span className="inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-sm text-amber-300">
                {item.averageRating.toFixed(1)}★ average
              </span>
            )}
            <span className="inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-400">
              {isVideo ? "Video" : "Image"}
            </span>
          </div>
          {item.description && (
            <p className="mt-3 text-sm text-slate-300">{item.description}</p>
          )}
          {(item.categories?.length ?? 0) > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {item.categories!.map((c) => (
                <span
                  key={c.id}
                  className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
                >
                  {c.name}
                </span>
              ))}
            </div>
          )}
          {user && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {userRating !== null && (
                <span className="text-xs text-slate-400">Your rating: {userRating}★</span>
              )}
              <label className="inline-flex items-center gap-2 text-sm text-slate-400">
                <span>Rate:</span>
                <select
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-50"
                  value={userRating ?? ""}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (value >= 1 && value <= 5) handleRate(value);
                  }}
                >
                  <option value="">--</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
              </label>
            </div>
          )}
        </header>

        <div className="p-4 sm:p-6 bg-slate-900/40 flex justify-center items-center min-h-[200px]">
          {item.mediaUrl ? (
            isVideo ? (
              <video
                src={item.mediaUrl}
                controls
                className="max-w-full max-h-[70vh] rounded-lg border border-slate-700"
                playsInline
              />
            ) : (
              <img
                src={item.mediaUrl}
                alt={title}
                className="max-w-full max-h-[70vh] w-auto h-auto object-contain rounded-lg border border-slate-700"
              />
            )
          ) : (
            <p className="text-sm text-slate-500">No media URL available.</p>
          )}
        </div>
      </article>
    </div>
  );
};

export default MediaDetailPage;
