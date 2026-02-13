import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";
import { fetchWithAuth } from "../../utils/api";

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

const EditSitePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [descriptionAiGenerated, setDescriptionAiGenerated] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagsInput, setTagsInput] = useState("");
  const [scrapedContent, setScrapedContent] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [deleteLogo, setDeleteLogo] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoImageUrl, setLogoImageUrl] = useState("");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isGeneratingDesc, setIsGeneratingDesc] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canAccess = hasRole(user ?? null, "manager");
  const siteId = id ? decodeURIComponent(id) : "";

  useEffect(() => {
    if (!canAccess || !siteId) {
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
        const siteResp = await fetchWithAuth(`${apiBase}/sites?id=${encodeURIComponent(siteId)}`);
      if (siteResp.status === 404 || !siteResp.ok) {
        if (!cancelled) setError("Site not found.");
        return;
      }
      const siteData = (await siteResp.json()) as { site?: Record<string, unknown> };
      const site = siteData.site;
      if (cancelled || !site) return;
      setUrl((site.url as string) ?? "");
      setTitle((site.title as string) ?? "");
      setDescription((site.description as string) ?? "");
      setDescriptionAiGenerated(!!site.descriptionAiGenerated);
      setTags(Array.isArray(site.tags) ? (site.tags as string[]) : []);
      setTagsInput("");
      setScrapedContent((site.scrapedContent as string) ?? "");
      setLogoUrl((site.logoUrl as string) || null);
      setSelectedCategoryIds(Array.isArray(site.categoryIds) ? (site.categoryIds as string[]) : []);
      const catResp = await fetchWithAuth(`${apiBase}/categories`);
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
  }, [canAccess, siteId]);

  const onLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setLogoFile(file ?? null);
    setLogoImageUrl("");
    setLogoError(null);
    setDeleteLogo(false);
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

  const addCategory = (cid: string) => {
    if (!selectedCategoryIds.includes(cid)) setSelectedCategoryIds([...selectedCategoryIds, cid]);
    setCategorySearch("");
    setCategoryDropdownOpen(false);
  };
  const removeCategory = (cid: string) => {
    setSelectedCategoryIds(selectedCategoryIds.filter((x) => x !== cid));
  };
  const addTag = () => {
    const t = tagsInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagsInput("");
  };
  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

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
      const resp = await fetchWithAuth(`${apiBase}/sites/generate-description`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    if (!siteId) return;
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
      let logoKey: string | null = null;
      if (logoFile) {
        const uploadResp = await fetchWithAuth(`${apiBase}/sites/logo-upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteId, contentType: logoFile.type || "image/png" })
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
      } else if (logoImageUrl.trim()) {
        const importResp = await fetchWithAuth(`${apiBase}/sites/logo-from-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteId, imageUrl: logoImageUrl.trim() })
        });
        if (!importResp.ok) {
          const errBody = await importResp.json().catch(() => ({}));
          throw new Error((errBody as { error?: string }).error || await importResp.text());
        }
        const importData = (await importResp.json()) as { key?: string };
        if (importData.key) logoKey = importData.key;
      }
      const payload: Record<string, unknown> = {
        id: siteId,
        url: url.trim(),
        title: title.trim() || url.trim(),
        description: description.trim(),
        descriptionAiGenerated: descriptionAiGenerated,
        categoryIds: selectedCategoryIds,
        tags,
        scrapedContent: scrapedContent.trim() || undefined
      };
      if (deleteLogo) payload.deleteLogo = true;
      else if (logoKey) payload.logoKey = logoKey;
      const resp = await fetchWithAuth(`${apiBase}/sites`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error(await resp.text());
      setMessage("Site updated.");
      if (logoPreview) URL.revokeObjectURL(logoPreview);
      setLogoFile(null);
      setLogoPreview(null);
      setLogoImageUrl("");
      setTimeout(() => navigate(`/websites/${encodeURIComponent(siteId)}`), 1200);
    } catch (e: any) {
      setError(e?.message ?? "Failed to update site.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!siteId) return;
    if (!window.confirm("Delete this site? This cannot be undone.")) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    setIsDeleting(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/sites`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: siteId })
      });
      if (!resp.ok) throw new Error(await resp.text());
      navigate("/websites");
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete site.");
    } finally {
      setIsDeleting(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Edit Site</h1>
        <p className="text-sm text-slate-400">Manager or SuperAdmin access is required.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Link to="/websites" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Websites
        </Link>
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    );
  }

  if (error && !url && !title) {
    return (
      <div className="space-y-4">
        <Link to="/websites" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Websites
        </Link>
        <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to={`/websites/${encodeURIComponent(siteId)}`}
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to site
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Edit Site</h1>
        <p className="text-sm text-slate-400">Update URL, title, description, logo, categories, and scraped content.</p>
      </header>

      <form className="space-y-4 max-w-xl" onSubmit={handleSubmit}>
        <div>
          <label className="block text-sm font-medium text-slate-200 mb-1">URL *</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
          />
        </div>
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
          <label className="mt-2 block inline-flex items-center gap-2 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={descriptionAiGenerated}
              onChange={(e) => setDescriptionAiGenerated(e.target.checked)}
            />
            AI-generated summary
          </label>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-200 mb-1">Logo</label>
          {logoUrl && !deleteLogo && !logoPreview && (
            <div className="mb-2 flex items-center gap-2">
              <img src={logoUrl} alt="Current logo" className="h-12 w-12 rounded-lg border border-slate-700 object-cover" />
              <label className="text-xs text-slate-400">
                <input type="checkbox" checked={deleteLogo} onChange={(e) => setDeleteLogo(e.target.checked)} />
                <span className="ml-1">Remove logo</span>
              </label>
            </div>
          )}
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
              <img src={logoPreview} alt="New logo" className="h-16 w-16 rounded-lg border border-slate-700 object-cover" />
            </div>
          )}
          {logoError && <p className="mt-1 text-xs text-red-400">{logoError}</p>}
        </div>
        <div className="relative">
          <label className="block text-sm font-medium text-slate-200 mb-1">Categories</label>
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
        <div>
          <label className="block text-sm font-medium text-slate-200 mb-1">Tags</label>
          <div className="flex flex-wrap gap-1 mb-2">
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-200"
              >
                {t}
                <button type="button" onClick={() => removeTag(t)} className="hover:text-red-400" aria-label="Remove">
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
              placeholder="Add tag"
              className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
            />
            <button type="button" onClick={addTag} className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">
              Add
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-200 mb-1">Scraped content (optional)</label>
          <textarea
            value={scrapedContent}
            onChange={(e) => setScrapedContent(e.target.value)}
            rows={6}
            placeholder="Paste or edit scraped content (e.g. README, about page)"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono text-slate-50 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
          />
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

export default EditSitePage;
