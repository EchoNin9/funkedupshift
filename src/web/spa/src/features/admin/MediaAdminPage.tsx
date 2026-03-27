import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth, hasRole } from "../../shell/AuthContext";
import { AdminPageHeader } from "./AdminPageHeader";
import { AdminTabs } from "./AdminTabs";
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
  description?: string;
}

function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const MediaAdminPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab = tabParam === "categories" ? "categories" : "add";
  const [activeTab, setActiveTab] = useState<"add" | "categories">(initialTab);

  useEffect(() => {
    if (tabParam === "categories") setActiveTab("categories");
    else setActiveTab("add");
  }, [tabParam]);

  const setTab = (tab: "add" | "categories") => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === "categories") next.set("tab", "categories");
    else next.delete("tab");
    setSearchParams(next);
  };

  // Shared: categories for Add Media form
  const [categories, setCategories] = useState<MediaCategory[]>([]);

  // Add Media tab state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [showThumbnailDialog, setShowThumbnailDialog] = useState(false);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Categories tab state
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [isCatSubmitting, setIsCatSubmitting] = useState(false);
  const [catMessage, setCatMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canAccess = hasRole(user ?? null, "manager");

  useEffect(() => {
    if (!canAccess) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    (async () => {
      try {
        const resp = await fetchWithAuth(`${apiBase}/media-categories`);
      if (!resp.ok) return;
      const data = (await resp.json()) as { categories?: { PK?: string; id?: string; name?: string; description?: string }[] };
      const list = (data.categories ?? []).map((c) => ({
        id: c.PK || c.id || "",
        name: c.name || c.PK || "",
        description: c.description
      }));
      setCategories(list);
      } catch {
        /* ignore */
      }
    })();
  }, [canAccess]);

  const categoryOptions = categories.map((c) => ({ id: c.id, label: c.name }));

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    setThumbnailFile(null);
    setError(null);
    if (filePreview) {
      URL.revokeObjectURL(filePreview);
      setFilePreview(null);
    }
    if (f) {
      setFilePreview(URL.createObjectURL(f));
      if (f.type.startsWith("video/")) setShowThumbnailDialog(true);
    }
  };

  const thumbnailInputRef = useRef<HTMLInputElement>(null);

  const onThumbnailFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f && f.type.startsWith("image/")) {
      setThumbnailFile(f);
      setShowThumbnailDialog(false);
    }
    e.target.value = "";
  };

  const loadCategories = async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setCategoriesError("API URL not set.");
      setCategoriesLoading(false);
      return;
    }
    const w = window as any;
    if (!w.auth?.getAccessToken) {
      setCategoriesError("Sign in required.");
      setCategoriesLoading(false);
      return;
    }
    setCategoriesLoading(true);
    setCategoriesError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/media-categories`);
      if (!resp.ok) throw new Error(await resp.text());
      const data = (await resp.json()) as { categories?: { PK?: string; id?: string; name?: string; description?: string }[] };
      const list = (data.categories ?? []).map((c) => ({
        id: c.PK || c.id || "",
        name: c.name || c.PK || "",
        description: c.description
      }));
      setCategories(list);
    } catch (e: any) {
      setCategoriesError(e?.message ?? "Failed to load media categories.");
    } finally {
      setCategoriesLoading(false);
    }
  };

  useEffect(() => {
    if (canAccess && activeTab === "categories") loadCategories();
  }, [canAccess, activeTab]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Please select an image or video file.");
      return;
    }
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
    const mediaType = file.type.startsWith("video/") ? "video" : "image";
    const mediaId = `MEDIA#${uuidv4()}`;
    setIsSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const uploadResp = await fetchWithAuth(`${apiBase}/media/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaId,
          mediaType,
          contentType: file.type || (mediaType === "image" ? "image/png" : "video/mp4")
        })
      });
      if (!uploadResp.ok) throw new Error("Upload request failed");
      const { uploadUrl: putUrl, key } = (await uploadResp.json()) as { uploadUrl: string; key: string };
      const createResp = await fetchWithAuth(`${apiBase}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: mediaId,
          mediaKey: key,
          title: title.trim() || "Untitled",
          description: description.trim(),
          mediaType,
          categoryIds: selectedCategoryIds
        })
      });
      if (!createResp.ok) throw new Error(await createResp.text());
      const putResp = await fetch(putUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || (mediaType === "image" ? "image/png" : "video/mp4") },
        body: file
      });
      if (!putResp.ok) throw new Error("File upload failed");
      if (mediaType === "video" && thumbnailFile) {
        const thumbResp = await fetchWithAuth(`${apiBase}/media/thumbnail-upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaId, contentType: thumbnailFile.type || "image/jpeg" })
        });
        if (thumbResp.ok) {
          const { uploadUrl: thumbPutUrl, key: thumbKey } = (await thumbResp.json()) as { uploadUrl: string; key: string };
          const thumbPutResp = await fetch(thumbPutUrl, {
            method: "PUT",
            headers: { "Content-Type": thumbnailFile.type || "image/jpeg" },
            body: thumbnailFile
          });
          if (thumbPutResp.ok) {
            const updateResp = await fetchWithAuth(`${apiBase}/media`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: mediaId, thumbnailKey: thumbKey })
            });
            if (!updateResp.ok) {
              console.warn("Thumbnail uploaded but update failed");
            }
          }
        }
      }
      setMessage("Media added.");
      setTitle("");
      setDescription("");
      setFile(null);
      setThumbnailFile(null);
      if (filePreview) URL.revokeObjectURL(filePreview);
      setFilePreview(null);
      setSelectedCategoryIds([]);
      setTimeout(() => navigate("/media"), 1500);
    } catch (e: any) {
      setError(e?.message ?? "Failed to add media.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const startEdit = (c: MediaCategory) => {
    setEditingId(c.id);
    setEditName(c.name);
    setEditDescription(c.description ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditDescription("");
    setUpdateError(null);
  };

  const handleUpdateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    setIsUpdating(true);
    setUpdateError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/media-categories`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          name: editName.trim(),
          description: editDescription.trim() || undefined
        })
      });
      if (!resp.ok) throw new Error(await resp.text());
      setCategories((prev) =>
        prev.map((cat) =>
          cat.id === editingId ? { ...cat, name: editName.trim(), description: editDescription.trim() || undefined } : cat
        )
      );
      cancelEdit();
    } catch (e: any) {
      setUpdateError(e?.message ?? "Failed to update media category.");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!window.confirm("Delete this media category? Media using it will lose this category.")) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    setDeletingId(id);
    try {
      const resp = await fetchWithAuth(`${apiBase}/media-categories?id=${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      if (!resp.ok) throw new Error(await resp.text());
      setCategories((prev) => prev.filter((cat) => cat.id !== id));
      if (editingId === id) cancelEdit();
    } catch (e: any) {
      setCategoriesError(e?.message ?? "Failed to delete media category.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    setIsCatSubmitting(true);
    setCatMessage(null);
    setCategoriesError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/media-categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: newDescription.trim() })
      });
      if (!resp.ok) throw new Error(await resp.text());
      setNewName("");
      setNewDescription("");
      setCatMessage("Media category created.");
      loadCategories();
    } catch (e: any) {
      setCategoriesError(e?.message ?? "Failed to create media category.");
    } finally {
      setIsCatSubmitting(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Media</h1>
        <p className="text-sm text-text-secondary">Manager or SuperAdmin access is required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Media"
        description="Add media and manage media categories."
      />

      <AdminTabs
        tabs={[
          { id: "add", label: "Add Media" },
          { id: "categories", label: "Media Categories" },
        ]}
        activeId={activeTab}
        onSelect={(id) => setTab(id as "add" | "categories")}
      />

      {activeTab === "add" && (
        <form className="card p-6 space-y-4 max-w-xl" onSubmit={handleSubmit}>
          <FormField label="Title (optional)">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled"
              className="input-field"
            />
          </FormField>
          <FormField label="Description (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              rows={3}
              className="input-field resize-y"
            />
          </FormField>
          <FormField label="Image or video" required>
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm"
              onChange={onFileChange}
              className="block w-full text-xs text-text-secondary file:mr-3 file:rounded-md file:border-0 file:bg-surface-3 file:px-3 file:py-1.5 file:text-text-primary"
            />
            <p className="mt-1 text-xs text-text-primary0">
              Videos get an auto-generated thumbnail from the 3–4 sec frame. Change it when editing.
            </p>
            {file?.type.startsWith("video/") && thumbnailFile && (
              <p className="mt-1 text-xs text-emerald-400">
                Custom thumbnail: {thumbnailFile.name}{" "}
                <button type="button" onClick={() => setShowThumbnailDialog(true)} className="text-accent-500 hover:underline">
                  Change
                </button>
              </p>
            )}
            {showThumbnailDialog && file?.type.startsWith("video/") && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
                role="dialog"
                aria-modal="true"
                aria-labelledby="thumbnail-dialog-title"
                onClick={() => setShowThumbnailDialog(false)}
              >
                <div
                  className="rounded-lg border border-border-hover bg-surface-2 p-6 shadow-xl max-w-sm w-full mx-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h2 id="thumbnail-dialog-title" className="text-lg font-medium text-text-primary mb-2">Add thumbnail</h2>
                  <p className="text-sm text-text-secondary mb-4">Choose a custom thumbnail image for this video (optional).</p>
                  <input
                    ref={thumbnailInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    onChange={onThumbnailFileChange}
                    className="hidden"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => thumbnailInputRef.current?.click()}
                      className="rounded-md bg-surface-3 px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-3"
                    >
                      Choose file
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowThumbnailDialog(false)}
                      className="rounded-md border border-border-hover px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-3"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              </div>
            )}
            {filePreview && (
              <div className="mt-2">
                {file?.type.startsWith("video/") ? (
                  <video src={filePreview} muted controls className="max-h-32 rounded-lg border border-border-hover" />
                ) : (
                  <img src={filePreview} alt="Preview" className="h-24 w-auto rounded-lg border border-border-hover object-cover" />
                )}
              </div>
            )}
          </FormField>
          <FormField label="Media categories (optional)">
            <SearchableSelect
              options={categoryOptions}
              selected={selectedCategoryIds}
              onChange={setSelectedCategoryIds}
            />
            {categories.length === 0 && (
              <p className="mt-1 text-xs text-text-tertiary">
                No categories.{" "}
                <button type="button" onClick={() => setTab("categories")} className="text-accent-500 hover:underline">
                  Create media categories
                </button>
              </p>
            )}
          </FormField>
          <button
            type="submit"
            disabled={isSubmitting || !file}
            className="btn-primary disabled:opacity-50"
          >
            {isSubmitting ? "Uploading…" : "Add Media"}
          </button>
          {message && <Alert variant="success">{message}</Alert>}
          {error && <Alert variant="error">{error}</Alert>}
        </form>
      )}

      {activeTab === "categories" && (
        <>
          <form className="card p-6 space-y-3 max-w-md" onSubmit={handleCreateCategory}>
            <FormField label="New category name">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Tutorials"
                className="input-field w-full"
              />
            </FormField>
            <FormField label="Description (optional)">
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Optional description"
                className="input-field w-full"
              />
            </FormField>
            <button
              type="submit"
              disabled={isCatSubmitting || !newName.trim()}
              className="btn-primary disabled:opacity-50"
            >
              {isCatSubmitting ? "Creating…" : "Create media category"}
            </button>
            {catMessage && <Alert variant="success">{catMessage}</Alert>}
            {categoriesError && <Alert variant="error">{categoriesError}</Alert>}
          </form>

          <section className="card p-6 mt-6">
            <h2 className="text-sm font-medium text-text-secondary mb-2">Existing media categories</h2>
            {categoriesLoading ? (
              <p className="text-sm text-text-primary0">Loading…</p>
            ) : categories.length === 0 ? (
              <p className="text-sm text-text-primary0">No media categories yet. Create one above.</p>
            ) : (
              <ul className="space-y-2">
                {categories.map((c) => (
                  <li key={c.id} className="rounded-lg border border-border-default bg-surface-1 px-3 py-2 text-sm">
                    {editingId === c.id ? (
                      <form onSubmit={handleUpdateCategory} className="space-y-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Name"
                          required
                          className="input-field w-full"
                          autoFocus
                        />
                        <input
                          type="text"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          placeholder="Description (optional)"
                          className="input-field w-full"
                        />
                        <div className="flex gap-2 flex-wrap">
                          <button
                            type="submit"
                            disabled={isUpdating || !editName.trim()}
                            className="btn-primary text-sm !px-3 !py-1.5 disabled:opacity-50"
                          >
                            {isUpdating ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="btn-secondary text-sm !px-3 !py-1.5"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteCategory(c.id)}
                            disabled={deletingId === c.id}
                            className="rounded-md border border-red-500/60 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                          >
                            {deletingId === c.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                        {updateError && <p className="text-xs text-red-400">{updateError}</p>}
                      </form>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(c)}
                          className="flex-1 min-w-0 text-left hover:bg-surface-3 rounded px-1 -mx-1 py-1 -my-1 transition-colors"
                        >
                          <span className="font-medium text-text-primary">{c.name}</span>
                          {c.description && <span className="text-text-primary0 truncate max-w-xs ml-2">{c.description}</span>}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(c.id)}
                          disabled={deletingId === c.id}
                          className="rounded px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50 shrink-0"
                          aria-label="Delete category"
                        >
                          {deletingId === c.id ? "…" : "Delete"}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default MediaAdminPage;
