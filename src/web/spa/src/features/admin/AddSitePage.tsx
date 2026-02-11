import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

interface Category {
  id: string;
  name: string;
}

const MIN_LOGO_SIZE = 100;
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

const AddSitePage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [descriptionAiGenerated, setDescriptionAiGenerated] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoImageUrl, setLogoImageUrl] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingDesc, setIsGeneratingDesc] = useState(false);
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
      const resp = await fetch(`${apiBase}/categories`, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) return;
      const data = (await resp.json()) as { categories?: { PK?: string; id?: string; name?: string }[] };
      const list = (data.categories ?? []).map((c) => ({ id: c.PK || c.id || "", name: c.name || c.PK || "" }));
      setCategories(list);
    })();
  }, [canAccess]);

  const onLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setLogoFile(file ?? null);
    if (file) setLogoImageUrl("");
    setLogoError(null);
    if (logoPreview) {
      URL.revokeObjectURL(logoPreview);
      setLogoPreview(null);
    }
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError("Logo must be 5 MB or smaller.");
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth < MIN_LOGO_SIZE || img.naturalHeight < MIN_LOGO_SIZE) {
        setLogoError("Logo must be at least 100×100 pixels.");
        return;
      }
      setLogoError(null);
      setLogoPreview(URL.createObjectURL(file));
    };
    img.onerror = () => setLogoError("Please choose a valid image file.");
    img.src = URL.createObjectURL(file);
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

  const handleGenerateDescription = async () => {
    const u = url.trim();
    if (!u) {
      setError("Enter URL first.");
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
    setIsGeneratingDesc(true);
    setError(null);
    try {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      const resp = await fetch(`${apiBase}/sites/generate-description`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: u })
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = (await resp.json()) as { description?: string };
      setDescription(data.description ?? "");
      setDescriptionAiGenerated(true);
    } catch (e: any) {
      setError(e?.message ?? "Failed to generate description.");
    } finally {
      setIsGeneratingDesc(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = url.trim();
    if (!u) {
      setError("URL is required.");
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
    if (logoFile && logoError) return;
    setIsSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      let logoKey: string | null = null;
      if (logoImageUrl.trim()) {
        const importResp = await fetch(`${apiBase}/sites/logo-from-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ siteId: "new", imageUrl: logoImageUrl.trim() })
        });
        if (!importResp.ok) {
          const errBody = await importResp.json().catch(() => ({}));
          throw new Error((errBody as { error?: string }).error || await importResp.text());
        }
        const importData = (await importResp.json()) as { key?: string };
        if (importData.key) logoKey = importData.key;
      } else if (logoFile) {
        const uploadResp = await fetch(`${apiBase}/sites/logo-upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ siteId: "new", contentType: logoFile.type || "image/png" })
        });
        if (!uploadResp.ok) throw new Error("Logo upload request failed");
        const { uploadUrl: putUrl, key } = (await uploadResp.json()) as { uploadUrl: string; key: string };
        const putResp = await fetch(putUrl, {
          method: "PUT",
          headers: { "Content-Type": logoFile.type || "image/png" },
          body: logoFile
        });
        if (!putResp.ok) throw new Error("Logo upload failed");
        logoKey = key;
      }
      const payload: Record<string, unknown> = {
        url: u,
        title: title.trim() || u,
        description: description.trim(),
        categoryIds: selectedCategoryIds
      };
      if (descriptionAiGenerated) payload.descriptionAiGenerated = true;
      if (logoKey) payload.logoKey = logoKey;
      const createResp = await fetch(`${apiBase}/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (!createResp.ok) throw new Error(await createResp.text());
      const data = (await createResp.json()) as { title?: string; url?: string };
      setMessage(`Site added: ${data.title || data.url || u}`);
      setUrl("");
      setTitle("");
      setDescription("");
      setDescriptionAiGenerated(false);
      setLogoFile(null);
      if (logoPreview) URL.revokeObjectURL(logoPreview);
      setLogoPreview(null);
      setSelectedCategoryIds([]);
      setTimeout(() => navigate("/websites"), 1500);
    } catch (e: any) {
      setError(e?.message ?? "Failed to add site.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Add Site</h1>
        <p className="text-sm text-slate-400">Manager or SuperAdmin access is required to add sites.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/websites"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Websites
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Add Site</h1>
        <p className="text-sm text-slate-400">Add a new website to the catalog. URL is required.</p>
      </header>

      <form className="space-y-4 max-w-xl" onSubmit={handleSubmit}>
        <div>
          <label className="block text-sm font-medium text-slate-200 mb-1">URL *</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            required
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-200 mb-1">Title (optional)</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Display title"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-200 mb-1">Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDescriptionAiGenerated(false);
            }}
            placeholder="Short description"
            rows={4}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
          />
          <button
            type="button"
            onClick={handleGenerateDescription}
            disabled={isGeneratingDesc || !url.trim()}
            className="mt-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            {isGeneratingDesc ? "Generating…" : "Generate AI description"}
          </button>
          {descriptionAiGenerated && (
            <span className="ml-2 text-xs uppercase tracking-wide text-slate-500">AI summary</span>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-200 mb-1">Logo (optional, min 100×100, max 5 MB)</label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={onLogoChange}
            className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-slate-100"
          />
          <p className="mt-2 text-xs text-slate-500">Or paste image URL (image will be copied to S3 on save):</p>
          <input
            type="url"
            value={logoImageUrl}
            onChange={(e) => {
              setLogoImageUrl(e.target.value);
              if (e.target.value.trim()) setLogoFile(null);
            }}
            placeholder="https://example.com/logo.png"
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
          />
          {logoPreview && (
            <div className="mt-2">
              <img src={logoPreview} alt="Preview" className="h-16 w-16 rounded-lg border border-slate-700 object-cover" />
            </div>
          )}
          {logoError && <p className="mt-1 text-xs text-red-400">{logoError}</p>}
        </div>
        <div ref={categoryDropdownRef} className="relative">
          <label className="block text-sm font-medium text-slate-200 mb-1">Categories (optional)</label>
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
                  No categories. <Link to="/admin/categories" className="text-brand-orange hover:underline">Create categories</Link>.
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
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-500 disabled:opacity-50"
        >
          {isSubmitting ? "Adding…" : "Add Site"}
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

export default AddSitePage;
