import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth, hasRole } from "../../shell/AuthContext";
import { AdminPageHeader } from "./AdminPageHeader";
import { fetchWithAuth } from "../../utils/api";
import { Alert, FormField, SearchableSelect } from "../../components";

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
  const [isUploadingThumb, setIsUploadingThumb] = useState(false);
  const [isDeletingThumb, setIsDeletingThumb] = useState(false);
  const [categories, setCategories] = useState<MediaCategory[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
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
      try {
        const mediaResp = await fetchWithAuth(`${apiBase}/media?id=${encodeURIComponent(mediaId)}`);
      if (mediaResp.status === 404 || !mediaResp.ok) {
        if (!cancelled) setError("Media not found.");
        return;
      }
      const mediaData = (await mediaResp.json()) as { media?: Record<string, unknown> | Record<string, unknown>[] };
      const item = Array.isArray(mediaData.media) ? mediaData.media[0] : mediaData.media;
      if (cancelled || !item) return;
      const rec = item as Record<string, unknown>;
      setTitle((rec.title as string) ?? "");
      setDescription((rec.description as string) ?? "");
      setMediaUrl((rec.mediaUrl as string) || null);
      setThumbnailUrl((rec.thumbnailUrl as string) || null);
      setMediaType((rec.mediaType as string) || "image");
      setSelectedCategoryIds(Array.isArray(rec.categoryIds) ? (rec.categoryIds as string[]) : []);
      const catResp = await fetchWithAuth(`${apiBase}/media-categories`);
      if (catResp.ok && !cancelled) {
        const catData = (await catResp.json()) as { categories?: { PK?: string; id?: string; name?: string }[] };
        setCategories((catData.categories ?? []).map((c) => ({ id: c.PK || c.id || "", name: c.name || c.PK || "" })));
      }
      } catch (e: unknown) {
        if (!cancelled) setError((e as Error)?.message ?? "Failed to load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canAccess, mediaId]);

  const categoryOptions = categories.map(c => ({ id: c.id, label: c.name }));

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
      const resp = await fetchWithAuth(`${apiBase}/media`, {
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

  const handleUploadThumbnail = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !mediaId) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image (PNG, JPEG, GIF, WebP).");
      return;
    }
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    setIsUploadingThumb(true);
    setError(null);
    setMessage(null);
    try {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      const uploadResp = await fetchWithAuth(`${apiBase}/media/thumbnail-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mediaId, contentType: file.type || "image/png" })
      });
      if (!uploadResp.ok) throw new Error("Upload request failed");
      const { uploadUrl: putUrl, key } = (await uploadResp.json()) as { uploadUrl: string; key: string };
      const putResp = await fetch(putUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/png" },
        body: file
      });
      if (!putResp.ok) throw new Error("File upload failed");
      const updateResp = await fetchWithAuth(`${apiBase}/media`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: mediaId, thumbnailKey: key })
      });
      if (!updateResp.ok) throw new Error(await updateResp.text());
      const refreshResp = await fetchWithAuth(`${apiBase}/media?id=${encodeURIComponent(mediaId)}`);
      if (refreshResp.ok) {
        const d = (await refreshResp.json()) as { media?: { thumbnailUrl?: string } };
        const m = Array.isArray(d.media) ? d.media[0] : d.media;
        if (m?.thumbnailUrl) setThumbnailUrl(m.thumbnailUrl);
      }
      setMessage("Logo/thumbnail updated.");
    } catch (e: any) {
      setError(e?.message ?? "Failed to upload thumbnail.");
    } finally {
      setIsUploadingThumb(false);
      e.target.value = "";
    }
  };

  const handleDeleteThumbnail = async () => {
    if (!mediaId) return;
    if (!window.confirm("Remove the custom logo/thumbnail? You can regenerate from video or upload a new one.")) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    setIsDeletingThumb(true);
    setError(null);
    setMessage(null);
    try {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      const resp = await fetchWithAuth(`${apiBase}/media`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: mediaId, deleteThumbnail: true })
      });
      if (!resp.ok) throw new Error(await resp.text());
      setThumbnailUrl(null);
      setMessage("Logo/thumbnail removed.");
    } catch (e: any) {
      setError(e?.message ?? "Failed to remove thumbnail.");
    } finally {
      setIsDeletingThumb(false);
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
      const resp = await fetchWithAuth(`${apiBase}/media/regenerate-thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mediaId })
      });
      if (!resp.ok) throw new Error(await resp.text());
      setMessage("Thumbnail regeneration started. New thumbnail will appear in 30–60 seconds.");
      const pollForThumbnail = async (attempt: number) => {
        if (attempt > 6) return;
        await new Promise((r) => setTimeout(r, 10000));
        const refresh = await fetchWithAuth(`${apiBase}/media?id=${encodeURIComponent(mediaId)}`);
        if (refresh.ok) {
          const d = (await refresh.json()) as { media?: { thumbnailUrl?: string } };
          const m = Array.isArray(d.media) ? d.media[0] : d.media;
          if (m?.thumbnailUrl) {
            setThumbnailUrl(m.thumbnailUrl);
            setMessage("Thumbnail updated.");
            return;
          }
        }
        pollForThumbnail(attempt + 1);
      };
      pollForThumbnail(1);
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
      const resp = await fetchWithAuth(`${apiBase}/media?id=${encodeURIComponent(mediaId)}`, {
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
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Edit Media</h1>
        <p className="text-sm text-text-secondary">Manager or SuperAdmin access is required.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <AdminPageHeader title="Edit Media" />
        <p className="text-sm text-text-secondary">Loading…</p>
      </div>
    );
  }

  if (error && !title && !description) {
    return (
      <div className="space-y-6">
        <AdminPageHeader title="Edit Media" />
        <Alert variant="error">{error}</Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Edit Media"
        description="Update title, description, and categories. The file itself cannot be changed here."
        actions={
          <Link to={`/media/${encodeURIComponent(mediaId)}`} className="btn-secondary text-sm !px-4 !py-2">
            View media
          </Link>
        }
      />

      {mediaUrl && (
        <section className="card overflow-hidden max-w-2xl">
          <p className="px-4 py-2 text-xs font-medium text-text-secondary border-b border-border-default">Current media</p>
          <div className="p-4 flex justify-center items-center bg-surface-2 min-h-[160px]">
            {mediaType === "video" ? (
              <video
                src={mediaUrl}
                controls
                className="max-w-full max-h-[50vh] rounded-lg border border-border-hover"
                playsInline
              />
            ) : (
              <img
                src={mediaUrl}
                alt={title || "Media"}
                className="max-w-full max-h-[50vh] w-auto h-auto object-contain rounded-lg border border-border-hover"
              />
            )}
          </div>
          {mediaType === "video" && (
            <div className="px-4 py-3 border-t border-border-default space-y-2">
              <p className="text-xs font-medium text-text-secondary">Logo / Thumbnail</p>
              <div className="flex flex-wrap items-center gap-3">
                {thumbnailUrl && (
                  <img
                    src={thumbnailUrl}
                    alt="Thumbnail"
                    className="h-16 w-auto rounded border border-border-hover object-cover"
                  />
                )}
                <button
                  type="button"
                  onClick={handleRegenerateThumbnail}
                  disabled={isRegenerating}
                  className="rounded-md border border-border-hover px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-surface-3 disabled:opacity-50"
                >
                  {isRegenerating ? "Regenerating…" : "Take screenshot"}
                </button>
                <label className="cursor-pointer rounded-md border border-border-hover px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-surface-3">
                  {isUploadingThumb ? "Uploading…" : "Add logo"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    className="hidden"
                    onChange={handleUploadThumbnail}
                    disabled={isUploadingThumb}
                  />
                </label>
                {thumbnailUrl && (
                  <button
                    type="button"
                    onClick={handleDeleteThumbnail}
                    disabled={isDeletingThumb}
                    className="rounded-md border border-red-500/60 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                  >
                    {isDeletingThumb ? "Removing…" : "Delete logo"}
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      <form className="card p-6 space-y-4 max-w-xl" onSubmit={handleSubmit}>
        <FormField label="Title">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input-field"
          />
        </FormField>
        <FormField label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="input-field resize-y"
          />
        </FormField>
        <FormField label="Media categories">
          <SearchableSelect options={categoryOptions} selected={selectedCategoryIds} onChange={setSelectedCategoryIds} />
        </FormField>
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary disabled:opacity-50"
          >
            {isSubmitting ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting || isSubmitting}
            className="btn-secondary border-red-500/60 text-red-400 hover:bg-red-500/20 disabled:opacity-50"
          >
            {isDeleting ? "Deleting…" : "Delete entry"}
          </button>
        </div>
        {message && <Alert variant="success">{message}</Alert>}
        {error && <Alert variant="error">{error}</Alert>}
      </form>
    </div>
  );
};

export default EditMediaPage;
