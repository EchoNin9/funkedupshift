import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole, canAccessMemes } from "../../shell/AuthContext";

interface MemeItem {
  PK: string;
  title?: string;
  description?: string;
  tags?: string[];
  isPrivate?: boolean;
  userId?: string;
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
  const [tagInput, setTagInput] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const memeId = id ? decodeURIComponent(id) : "";

  const fetchWithAuth = useCallback(async (url: string, options?: RequestInit) => {
    const w = window as any;
    if (!w.auth?.getAccessToken) throw new Error("Not signed in");
    const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
    if (!token) throw new Error("Not signed in");
    return fetch(url, { ...options, headers: { ...options?.headers, Authorization: `Bearer ${token}` } });
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
  }, [memeId, fetchWithAuth]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
      }
    }
    if (tagDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [tagDropdownOpen]);

  const filteredTagOptions = useMemo(() => {
    return allTags.filter(
      (t) =>
        !tags.includes(t) &&
        (!tagInput.trim() || t.toLowerCase().includes(tagInput.toLowerCase()))
    );
  }, [allTags, tags, tagInput]);

  const addTag = (tag: string) => {
    const t = tag.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  };

  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

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
      navigate(`/memes/${encodeURIComponent(item.PK)}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const access = canAccessMemes(user);
  const canEdit = !!user && (hasRole(user, "user") || hasRole(user, "manager") || hasRole(user, "superadmin"));

  if (!user || !access) {
    return (
      <div className="space-y-6">
        <Link to="/memes" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Memes
        </Link>
        <div className="rounded-md border border-slate-700 bg-slate-900/60 px-4 py-3 text-slate-200">
          Sign in and join Memes group to edit.
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

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <Link to={`/memes/${encodeURIComponent(item.PK)}`} className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Meme
        </Link>
        <h1 className="text-xl font-semibold text-slate-50">Edit meme</h1>
      </header>

      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-4 max-w-xl">
        <div ref={tagDropdownRef} className="relative">
          <label className="block text-xs font-medium text-slate-400 mb-1">Tags</label>
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onFocus={() => setTagDropdownOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const t = tagInput.trim();
                if (t && allTags.includes(t)) addTag(t);
              }
            }}
            placeholder="Search and select tags (existing only)"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500"
            autoComplete="off"
          />
          {tagDropdownOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 w-full max-h-48 overflow-auto rounded-md border border-slate-700 bg-slate-900 shadow-lg">
              {filteredTagOptions.length > 0 ? (
                filteredTagOptions.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => addTag(tag)}
                    className="block w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                  >
                    {tag}
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-xs text-slate-500">No matching tags (only existing tags)</div>
              )}
            </div>
          )}
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    className="hover:text-slate-100"
                    aria-label={`Remove ${t}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            className="rounded border-slate-600"
          />
          Private (only you can see)
        </label>

        {error && (
          <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-500 disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
};

export default EditMemePage;
