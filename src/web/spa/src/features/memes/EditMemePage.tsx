import React, { useEffect, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth, canCreateMemes, canEditAnyMeme } from "../../shell/AuthContext";
import { Alert } from "../../components";
import AddTagInput from "./AddTagInput";
import ShareMemeBox from "./ShareMemeBox";
import { fetchWithAuth } from "../../utils/api";

interface MemeItem {
  PK: string;
  title?: string;
  description?: string;
  tags?: string[];
  isPrivate?: boolean;
  userId?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
}

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

const EditMemePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [item, setItem] = useState<MemeItem | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [isPrivate, setIsPrivate] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const memeId = id ? decodeURIComponent(id) : "";

  const canEdit = !!(user && (canCreateMemes(user) || canEditAnyMeme(user)));

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
        const [memeResp, tagsResp] = await Promise.all([
          fetchWithAuth(`${apiBase}/memes?id=${encodeURIComponent(memeId)}`),
          fetchWithAuth(`${apiBase}/memes/tags`)
        ]);
        if (memeResp.status === 404 || !memeResp.ok) {
          if (!cancelled) setItem(null);
          return;
        }
        const memeData = (await memeResp.json()) as { meme?: MemeItem };
        const tagsData = (await tagsResp.json()) as { tags?: string[] };
        if (cancelled) return;
        setItem(memeData.meme ?? null);
        setTags(memeData.meme?.tags ?? []);
        setIsPrivate(memeData.meme?.isPrivate ?? false);
        setAllTags((tagsData.tags ?? []).sort((a, b) => a.localeCompare(b)));
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load meme.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [memeId]);

  const initialIsPrivate = useRef<boolean | null>(null);
  useEffect(() => {
    if (item && initialIsPrivate.current === null) initialIsPrivate.current = item.isPrivate ?? false;
  }, [item]);

  const handleSave = async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase || !item) return;
    setIsSaving(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/memes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.PK,
          tags,
          isPrivate
        })
      });
      if (!resp.ok) {
        const errData = (await resp.json()) as { error?: string };
        throw new Error(errData.error || "Failed to save");
      }
      const tagOnly = initialIsPrivate.current === (isPrivate ?? false);
      try {
        sessionStorage.setItem(
          "memes_my_cache_invalidate",
          JSON.stringify({ memeId: item.PK, tagOnly, tags })
        );
      } catch {
        /* ignore */
      }
      navigate(`/memes/${encodeURIComponent(item.PK)}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  if (!user || !canEdit) {
    return (
      <div className="space-y-6">
        <Link to="/memes" className="inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Memes
        </Link>
        <div className="rounded-md border border-border-hover bg-surface-2 px-4 py-3 text-text-primary">
          Sign in and join Memes group to edit.
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Link to="/memes" className="inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Memes
        </Link>
        <div className="text-sm text-text-secondary">Loading…</div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="space-y-4">
        <Link to="/memes" className="inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Memes
        </Link>
        <div className="rounded-md border border-border-hover bg-surface-2 px-4 py-3 text-text-primary">
          {error || "Meme not found."}
        </div>
      </div>
    );
  }

  const imgUrl = item.mediaUrl || item.thumbnailUrl;
  const title = item.title || item.PK || "Untitled";

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <Link to={`/memes/${encodeURIComponent(item.PK)}`} className="inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Meme
        </Link>
        <h1 className="text-xl font-semibold text-text-primary">Edit meme</h1>
      </header>

      <div className="rounded-xl border border-border-default bg-surface-1 overflow-hidden min-h-[200px] flex items-center justify-center p-4">
        {imgUrl ? (
          <>
            <img
              src={imgUrl}
              alt={title}
              className="w-full max-w-2xl mx-auto block object-contain max-h-[70vh]"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
                const next = (e.currentTarget as HTMLImageElement).nextElementSibling;
                if (next) (next as HTMLElement).classList.remove("hidden");
              }}
            />
            <div className="hidden py-12 text-text-tertiary" aria-hidden>Image failed to load</div>
          </>
        ) : (
          <div className="py-12 text-text-tertiary">No image</div>
        )}
      </div>

      <ShareMemeBox memeId={item.PK} title={title} />

      <div className="rounded-xl border border-border-default bg-surface-1 p-4 space-y-4 max-w-xl">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Tags</label>
          <AddTagInput
            tags={tags}
            onTagsChange={setTags}
            allTags={allTags}
            fetchTags={async (q) => {
              const apiBase = getApiBaseUrl();
              if (!apiBase) return [];
              const r = await fetchWithAuth(`${apiBase}/memes/tags?q=${encodeURIComponent(q)}`);
              if (!r.ok) return [];
              const d = (await r.json()) as { tags?: string[] };
              return d.tags ?? [];
            }}
            placeholder="Type to suggest or create tag, Tab to autocomplete"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            className="rounded border-border-default"
          />
          Private (only you can see)
        </label>

        {error && (
          <Alert variant="error">{error}</Alert>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-md bg-accent-500 px-4 py-2 text-sm font-semibold text-surface-0 hover:bg-orange-500 disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
};

export default EditMemePage;
