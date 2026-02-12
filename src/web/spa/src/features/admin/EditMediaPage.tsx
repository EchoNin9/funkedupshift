import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

interface MediaCategory {
  id: string;
  name: string;
}

const EditMediaPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<"image" | "video" | string>("image");
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [categories, setCategories] = useState<MediaCategory[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canAccess = hasRole(user ?? null, "manager");
  const mediaId = id ? decodeURIComponent(id) : "";

  useEffect(() => {
    if (!canAccess || !mediaId) {
      setLoading(false);
      return;
    }
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setError("API URL not set.");
      setLoading(false);
      return;
    }
    const w = window as any;
    if (!w.auth?.getAccessToken) {
      setError("Sign in required.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      if (!token || cancelled) return;
      const mediaResp = await fetch(`${apiBase}/media?id=${encodeURIComponent(mediaId)}`);
      if (mediaResp.status === 404 || !mediaResp.ok) {
        if (!cancelled) setError("Media not found.");
        setLoading(false);
        return;
      }
      const mediaData = (await mediaResp.json()) as { media?: Record<string, unknown> | Record<string, unknown>[] };
      const item = Array.isArray(mediaData.media) ? mediaData.media[0] : mediaData.media;
      if (cancelled || !item) {
        setLoading(false);
        return;
      }
      const rec = item as Record<string, unknown>;
      setTitle((rec.title as string) ?? "");
      setDescription((rec.description as string) ?? "");
      setMediaUrl((rec.mediaUrl as string) || null);
      setThumbnailUrl((rec.thumbnailUrl as string) || null);
      setMediaType((rec.mediaType as string) || "image");
      setSelectedCategoryIds(Array.isArray(rec.categoryIds) ? (rec.categoryIds as string[]) : []);
      const catResp = await fetch(`${apiBase}/media-categories`, { headers: { Authorization: `Bearer ${token}` } });
      if (catResp.ok && !cancelled) {
        const catData = (await catResp.json()) as { categories?: { PK?: string; id?: string; name?: string }[] };
        setCategories((catData.categories ?? []).map((c) => ({ id: c.PK || c.id || "", name: c.name || c.PK || "" })));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [canAccess, mediaId]);

  const addCategory = (cid: string) => {
    if (!selectedCategoryIds.includes(cid)) setSelectedCategoryIds([...selectedCategoryIds, cid]);
    setCategorySearch("");
    setCategoryDropdownOpen(false);
  };
  const removeCategory = (cid: string) => {
    setSelectedCategoryIds(selectedCategoryIds.filter((x) => x !== cid));
  };

  const filteredCategories = categories.filter(
    (c) =>
      !selectedCategoryIds.includes(c.id) &&
      (!categorySearch.trim() || (c.name || "").toLowerCase().includes(categorySearch.toLowerCase()))
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mediaId) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setError("API URL not set.");
      return;
    }
    const w = window as any;
    if (!w.auth?.getAccessToken) {
      setError("Sign in required.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      const resp = await fetch(`${apiBase}/media`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: mediaId,
          title: title.trim() || "Untitled",
          description: description.trim(),
          categoryIds: selectedCategoryIds
        })
      });
      if (!resp.ok) throw new Error(await resp.text());
      setMessage("Media updated.");
      setTimeout(() => navigate("/media"), 1200);
    } catch (e: any) {
      setError(e?.message ?? "Failed to update media.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegenerateThumbnail = async () => {
    if (!mediaId) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    setIsRegenerating(true);
    setError(null);
    setMessage(null);
    try {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      const resp = await fetch(`${apiBase}/media/regenerate-thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mediaId })
      });
      if (!resp.ok) throw new Error(await resp.text());
      setMessage("Thumbnail regeneration started. New thumbnail will appear in a few seconds.");
      setTimeout(async () => {
        const refresh = await fetch(`${apiBase}/media?id=${encodeURIComponent(mediaId)}`);
        if (refresh.ok) {
          const d = (await refresh.json()) as { media?: { thumbnailUrl?: string } };
          if (d?.media?.thumbnailUrl) setThumbnailUrl(d.media.thumbnailUrl);
        }
      }, 6000);
    } catch (e: any) {
      setError(e?.message ?? "Failed to regenerate thumbnail.");
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleDelete = async () => {
    if (!mediaId) return;
    if (!window.confirm("Delete this media item? This cannot be undone.")) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    setIsDeleting(true);
    setError(null);
    try {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      const resp = await fetch(`${apiBase}/media?id=${encodeURIComponent(mediaId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) throw new Error(await resp.text());
      navigate("/media");
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete media.");
    } finally {
      setIsDeleting(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Edit Media</h1>
        <p className="text-sm text-slate-400">Manager or SuperAdmin access is required.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Link to="/media" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Media
        </Link>
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    );
  }

  if (error && !title && !description) {
    return (
      <div className="space-y-4">
        <Link to="/media" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Media
        </Link>
        <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/media" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Media
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Edit Media</h1>
        <p className="text-sm text-slate-400">Update title, description, and categories. The file itself cannot be changed here.</p>
      </header>

      {mediaUrl && (
        <section className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden max-w-2xl">
          <p className="px-4 py-2 text-xs font-medium text-slate-400 border-b border-slate-800">Current media</p>
          <div className="p-4 flex justify-center items-center bg-slate-900/40 min-h-[160px]">
            {mediaType === "video" ? (
              <video
                src={mediaUrl}
                controls
                className="max-w-full max-h-[50vh] rounded-lg border border-slate-700"
                playsInline
              />
            ) : (
              <img
                src={mediaUrl}
                alt={title || "Media"}
                className="max-w-full max-h-[50vh] w-auto h-auto object-contain rounded-lg border border-slate-700"
              />
            )}
          </div>
          {mediaType === "video" && (
            <div className="px-4 py-3 border-t border-slate-800 space-y-2">
              <p className="text-xs font-medium text-slate-400">Thumbnail</p>
              <div className="flex flex-wrap items-center gap-3">
                {thumbnailUrl && (
                  <img
                    src={thumbnailUrl}
                    alt="Thumbnail"
                    className="h-16 w-auto rounded border border-slate-700 object-cover"
                  />
                )}
                <button
                  type="button"
                  onClick={handleRegenerateThumbnail}
                  disabled={isRegenerating}
                  className="rounded-md border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  {isRegenerating ? "Regenerating…" : "Take screenshot"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <form className="space-y-4 max-w-xl" onSubmit={handleSubmit}>
        <div>
          <label className="block text-sm font-medium text-slate-200 mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-200 mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
          />
        </div>
        <div className="relative">
          <label className="block text-sm font-medium text-slate-200 mb-1">Media categories</label>
          <input
            type="text"
            value={categorySearch}
            onChange={(e) => setCategorySearch(e.target.value)}
            onFocus={() => setCategoryDropdownOpen(true)}
            placeholder="Search and select…"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
          />
          {categoryDropdownOpen && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-auto rounded-md border border-slate-700 bg-slate-900 shadow-lg">
              {filteredCategories.length ? (
                filteredCategories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => addCategory(c.id)}
                    className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                  >
                    {c.name}
                  </button>
                ))
              ) : (
                <p className="px-3 py-2 text-xs text-slate-500">No matches</p>
              )}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {selectedCategoryIds.map((cid) => {
              const c = categories.find((x) => x.id === cid);
              return (
                <span
                  key={cid}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-200"
                >
                  {c?.name ?? cid}
                  <button type="button" onClick={() => removeCategory(cid)} className="hover:text-red-400" aria-label="Remove">
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-500 disabled:opacity-50"
          >
            {isSubmitting ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting || isSubmitting}
            className="rounded-md border border-red-500/60 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
          >
            {isDeleting ? "Deleting…" : "Delete entry"}
          </button>
        </div>
        {message && (
          <div className="rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {message}
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
      </form>
    </div>
  );
};

export default EditMediaPage;
