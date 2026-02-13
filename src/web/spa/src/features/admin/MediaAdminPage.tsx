import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";
import { fetchWithAuth } from "../../utils/api";

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
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) {
        setCategoryDropdownOpen(false);
      }
    }
    if (categoryDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [categoryDropdownOpen]);

  const filteredCategories = categories.filter(
    (c) =>
      !selectedCategoryIds.includes(c.id) &&
      (!categorySearch.trim() || (c.name || "").toLowerCase().includes(categorySearch.toLowerCase()))
  );

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

  const addCategory = (id: string) => {
    if (!selectedCategoryIds.includes(id)) setSelectedCategoryIds([...selectedCategoryIds, id]);
    setCategorySearch("");
  };
  const removeCategory = (id: string) => {
    setSelectedCategoryIds(selectedCategoryIds.filter((x) => x !== id));
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
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Media</h1>
        <p className="text-sm text-slate-400">Manager or SuperAdmin access is required.</p>
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
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Media</h1>
        <p className="text-sm text-slate-400">Add media and manage media categories.</p>
      </header>

      <div className="flex gap-2 border-b border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setTab("add")}
          className={`px-4 py-2 rounded-md text-sm font-medium ${activeTab === "add" ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}
        >
          Add Media
        </button>
        <button
          type="button"
          onClick={() => setTab("categories")}
          className={`px-4 py-2 rounded-md text-sm font-medium ${activeTab === "categories" ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}
        >
          Media Categories
        </button>
      </div>

      {activeTab === "add" && (
        <form className="space-y-4 max-w-xl" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium text-slate-200 mb-1">Title (optional)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-200 mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              rows={3}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-200 mb-1">Image or video *</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm"
              onChange={onFileChange}
              className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-slate-100"
            />
            <p className="mt-1 text-xs text-slate-500">
              Videos get an auto-generated thumbnail from the 3–4 sec frame. Change it when editing.
            </p>
            {file?.type.startsWith("video/") && thumbnailFile && (
              <p className="mt-1 text-xs text-emerald-400">
                Custom thumbnail: {thumbnailFile.name}{" "}
                <button type="button" onClick={() => setShowThumbnailDialog(true)} className="text-brand-orange hover:underline">
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
                  className="rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl max-w-sm w-full mx-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h2 id="thumbnail-dialog-title" className="text-lg font-medium text-slate-100 mb-2">Add thumbnail</h2>
                  <p className="text-sm text-slate-400 mb-4">Choose a custom thumbnail image for this video (optional).</p>
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
                      className="rounded-md bg-slate-700 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
                    >
                      Choose file
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowThumbnailDialog(false)}
                      className="rounded-md border border-slate-600 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
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
                  <video src={filePreview} muted controls className="max-h-32 rounded-lg border border-slate-700" />
                ) : (
                  <img src={filePreview} alt="Preview" className="h-24 w-auto rounded-lg border border-slate-700 object-cover" />
                )}
              </div>
            )}
          </div>
          <div ref={categoryDropdownRef} className="relative">
            <label className="block text-sm font-medium text-slate-200 mb-1">Media categories (optional)</label>
            <input
              type="text"
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
              onFocus={() => setCategoryDropdownOpen(true)}
              placeholder="Search and select…"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
            />
            {categoryDropdownOpen && (
              <>
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
                {categories.length === 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    No categories.{" "}
                    <button type="button" onClick={() => setTab("categories")} className="text-brand-orange hover:underline">
                      Create media categories
                    </button>
                  </p>
                )}
              </>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {selectedCategoryIds.map((id) => {
                const c = categories.find((x) => x.id === id);
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-200"
                  >
                    {c?.name ?? id}
                    <button type="button" onClick={() => removeCategory(id)} className="hover:text-red-400" aria-label="Remove">
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
          <button
            type="submit"
            disabled={isSubmitting || !file}
            className="inline-flex items-center justify-center rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-500 disabled:opacity-50"
          >
            {isSubmitting ? "Uploading…" : "Add Media"}
          </button>
          {message && (
            <div className="rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</div>
          )}
          {error && (
            <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
          )}
        </form>
      )}

      {activeTab === "categories" && (
        <>
          <form className="space-y-3 max-w-md" onSubmit={handleCreateCategory}>
            <div>
              <label className="block text-sm font-medium text-slate-200 mb-1">New category name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Tutorials"
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-200 mb-1">Description (optional)</label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Optional description"
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
              />
            </div>
            <button
              type="submit"
              disabled={isCatSubmitting || !newName.trim()}
              className="inline-flex items-center justify-center rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-500 disabled:opacity-50"
            >
              {isCatSubmitting ? "Creating…" : "Create media category"}
            </button>
            {catMessage && (
              <div className="rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{catMessage}</div>
            )}
            {categoriesError && (
              <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-200">{categoriesError}</div>
            )}
          </form>

          <section>
            <h2 className="text-sm font-medium text-slate-300 mb-2">Existing media categories</h2>
            {categoriesLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : categories.length === 0 ? (
              <p className="text-sm text-slate-500">No media categories yet. Create one above.</p>
            ) : (
              <ul className="space-y-2">
                {categories.map((c) => (
                  <li key={c.id} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
                    {editingId === c.id ? (
                      <form onSubmit={handleUpdateCategory} className="space-y-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Name"
                          required
                          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
                          autoFocus
                        />
                        <input
                          type="text"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          placeholder="Description (optional)"
                          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
                        />
                        <div className="flex gap-2 flex-wrap">
                          <button
                            type="submit"
                            disabled={isUpdating || !editName.trim()}
                            className="rounded-md bg-brand-orange px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-orange-500 disabled:opacity-50"
                          >
                            {isUpdating ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
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
                          className="flex-1 min-w-0 text-left hover:bg-slate-800/50 rounded px-1 -mx-1 py-1 -my-1 transition-colors"
                        >
                          <span className="font-medium text-slate-200">{c.name}</span>
                          {c.description && <span className="text-slate-500 truncate max-w-xs ml-2">{c.description}</span>}
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
