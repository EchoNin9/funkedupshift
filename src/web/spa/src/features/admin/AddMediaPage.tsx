import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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

function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const AddMediaPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [categories, setCategories] = useState<MediaCategory[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canAccess = hasRole(user ?? null, "manager");
  const categoryDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canAccess) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    (async () => {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      if (!token) return;
      const resp = await fetch(`${apiBase}/media-categories`, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) return;
      const data = (await resp.json()) as { categories?: { PK?: string; id?: string; name?: string }[] };
      const list = (data.categories ?? []).map((c) => ({ id: c.PK || c.id || "", name: c.name || c.PK || "" }));
      setCategories(list);
    })();
  }, [canAccess]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    setError(null);
    if (filePreview) {
      URL.revokeObjectURL(filePreview);
      setFilePreview(null);
    }
    if (f) setFilePreview(URL.createObjectURL(f));
  };

  const addCategory = (id: string) => {
    if (!selectedCategoryIds.includes(id)) setSelectedCategoryIds([...selectedCategoryIds, id]);
    setCategorySearch("");
    // Keep dropdown open for multi-select
  };
  const removeCategory = (id: string) => {
    setSelectedCategoryIds(selectedCategoryIds.filter((x) => x !== id));
  };

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
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      const uploadResp = await fetch(`${apiBase}/media/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          mediaId,
          mediaType,
          contentType: file.type || (mediaType === "image" ? "image/png" : "video/mp4")
        })
      });
      if (!uploadResp.ok) throw new Error("Upload request failed");
      const { uploadUrl: putUrl, key } = (await uploadResp.json()) as { uploadUrl: string; key: string };
      const putResp = await fetch(putUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || (mediaType === "image" ? "image/png" : "video/mp4") },
        body: file
      });
      if (!putResp.ok) throw new Error("File upload failed");
      const createResp = await fetch(`${apiBase}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
      setMessage("Media added.");
      setTitle("");
      setDescription("");
      setFile(null);
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

  if (!canAccess) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Add Media</h1>
        <p className="text-sm text-slate-400">Manager or SuperAdmin access is required to add media.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/media"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Media
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Add Media</h1>
        <p className="text-sm text-slate-400">Upload an image or video and add it to the media catalog.</p>
      </header>

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
                  No categories. <Link to="/admin/media-categories" className="text-brand-orange hover:underline">Create media categories</Link>.
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

export default AddMediaPage;
