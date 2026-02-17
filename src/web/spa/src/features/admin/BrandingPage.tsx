import React, { useEffect, useState } from "react";
import { useAuth, hasRole } from "../../shell/AuthContext";
import { AdminPageHeader } from "./AdminPageHeader";
import { fetchWithAuth } from "../../utils/api";
import {
  useBranding,
  DEFAULT_HERO_TAGLINE,
  DEFAULT_HERO_HEADLINE,
  DEFAULT_HERO_SUBTEXT,
} from "../../shell/BrandingContext";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

const allowedTypes = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
] as const;

interface Theme {
  id: string;
  name: string;
}

const BrandingPage: React.FC = () => {
  const { user } = useAuth();
  const {
    logo,
    heroTagline,
    heroHeadline,
    heroSubtext,
    heroImageUrl,
    heroOpacity,
    refreshBranding,
  } = useBranding();
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("Funkedupshift");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hero texts
  const [tagline, setTagline] = useState(heroTagline);
  const [headline, setHeadline] = useState(heroHeadline);
  const [subtext, setSubtext] = useState(heroSubtext);
  const [heroFile, setHeroFile] = useState<File | null>(null);
  const [heroPreviewUrl, setHeroPreviewUrl] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(heroOpacity);
  const [heroSubmitting, setHeroSubmitting] = useState(false);
  const [heroMessage, setHeroMessage] = useState<string | null>(null);
  const [heroError, setHeroError] = useState<string | null>(null);

  // Themes
  const [themes, setThemes] = useState<Theme[]>([]);
  const [activeThemeId, setActiveThemeId] = useState<string | null>(null);
  const [newThemeName, setNewThemeName] = useState("");
  const [themeSubmitting, setThemeSubmitting] = useState(false);
  const [themeMessage, setThemeMessage] = useState<string | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);

  const isSuperAdmin = hasRole(user ?? null, "superadmin");

  useEffect(() => {
    setTagline(heroTagline);
    setHeadline(heroHeadline);
    setSubtext(heroSubtext);
    setOpacity(heroOpacity);
  }, [heroTagline, heroHeadline, heroSubtext, heroOpacity]);

  useEffect(() => {
    const apiBase = getApiBaseUrl();
    if (!apiBase || !isSuperAdmin) return;
    Promise.all([
      fetch(`${apiBase}/branding/themes`).then((r) => (r.ok ? r.json() : { themes: [] })),
      fetch(`${apiBase}/branding/active-theme`).then((r) => (r.ok ? r.json() : { themeId: null })),
    ]).then(([themesData, activeData]) => {
      setThemes(themesData.themes ?? []);
      setActiveThemeId(activeData.themeId ?? null);
    });
  }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return (
      <div className="space-y-6">
        <AdminPageHeader title="Branding" description="Only superadmin users can manage global branding assets." />
      </div>
    );
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    setMessage(null);
    setError(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (f) {
      setPreviewUrl(URL.createObjectURL(f));
    }
  };

  const onHeroFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setHeroFile(f ?? null);
    setHeroMessage(null);
    setHeroError(null);
    if (heroPreviewUrl) {
      URL.revokeObjectURL(heroPreviewUrl);
      setHeroPreviewUrl(null);
    }
    if (f) {
      setHeroPreviewUrl(URL.createObjectURL(f));
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!file) {
      setError("Choose an image file first.");
      return;
    }

    const contentType = file.type || "image/png";
    if (!allowedTypes.includes(contentType as (typeof allowedTypes)[number])) {
      setError("Logo must be PNG, JPEG, GIF, or WEBP.");
      return;
    }

    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setError("API URL not configured.");
      return;
    }

    const w = window as any;
    if (!w.auth || typeof w.auth.getAccessToken !== "function") {
      setError("Auth not initialized.");
      return;
    }

    setIsSubmitting(true);
    try {
      const metaResp = await fetchWithAuth(`${apiBase}/branding/logo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType, alt }),
      });
      if (!metaResp.ok) {
        const txt = await metaResp.text();
        throw new Error(txt || `Metadata request failed with ${metaResp.status}`);
      }
      const meta = await metaResp.json();
      if (!meta.uploadUrl) {
        throw new Error("uploadUrl missing from response.");
      }

      const uploadResp = await fetch(meta.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!uploadResp.ok) {
        throw new Error(`Upload failed with ${uploadResp.status}`);
      }

      setMessage("Logo updated. It may take a moment for caches to refresh.");
      await refreshBranding();
    } catch (err: any) {
      setError(err?.message ?? "Failed to update logo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const onHeroTextsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHeroError(null);
    setHeroMessage(null);
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setHeroError("API URL not configured.");
      return;
    }
    setHeroSubmitting(true);
    try {
      const resp = await fetchWithAuth(`${apiBase}/branding/hero`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagline, headline, subtext, opacity }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to update hero texts.");
      }
      setHeroMessage("Hero texts updated.");
      await refreshBranding();
    } catch (err: any) {
      setHeroError(err?.message ?? "Failed to update.");
    } finally {
      setHeroSubmitting(false);
    }
  };

  const onHeroImageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHeroError(null);
    setHeroMessage(null);
    if (!heroFile) {
      setHeroError("Choose an image file first.");
      return;
    }
    const contentType = heroFile.type || "image/png";
    if (!allowedTypes.includes(contentType as (typeof allowedTypes)[number])) {
      setHeroError("Image must be PNG, JPEG, GIF, or WEBP.");
      return;
    }
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setHeroError("API URL not configured.");
      return;
    }
    setHeroSubmitting(true);
    try {
      const metaResp = await fetchWithAuth(`${apiBase}/branding/hero`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType }),
      });
      if (!metaResp.ok) {
        const txt = await metaResp.text();
        throw new Error(txt || "Failed to get upload URL.");
      }
      const meta = await metaResp.json();
      if (!meta.uploadUrl) {
        throw new Error("uploadUrl missing from response.");
      }
      const uploadResp = await fetch(meta.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: heroFile,
      });
      if (!uploadResp.ok) {
        throw new Error(`Upload failed with ${uploadResp.status}`);
      }
      setHeroMessage("Hero background image updated.");
      setHeroFile(null);
      if (heroPreviewUrl) {
        URL.revokeObjectURL(heroPreviewUrl);
        setHeroPreviewUrl(null);
      }
      await refreshBranding();
    } catch (err: any) {
      setHeroError(err?.message ?? "Failed to update hero image.");
    } finally {
      setHeroSubmitting(false);
    }
  };

  const onActiveThemeChange = async (themeId: string | null) => {
    setThemeError(null);
    setThemeMessage(null);
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      const resp = await fetchWithAuth(`${apiBase}/branding/active-theme`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: themeId || "" }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to set theme.");
      }
      setActiveThemeId(themeId);
      setThemeMessage("Active theme updated.");
    } catch (err: any) {
      setThemeError(err?.message ?? "Failed to set theme.");
    }
  };

  const onAddTheme = async (e: React.FormEvent) => {
    e.preventDefault();
    setThemeError(null);
    setThemeMessage(null);
    const name = newThemeName.trim();
    if (!name) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setThemeSubmitting(true);
    try {
      const resp = await fetchWithAuth(`${apiBase}/branding/themes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to create theme.");
      }
      const data = (await resp.json()) as Theme;
      setThemes((prev) => [...prev, data]);
      setNewThemeName("");
      setThemeMessage(`Theme "${data.name}" created.`);
    } catch (err: any) {
      setThemeError(err?.message ?? "Failed to create theme.");
    } finally {
      setThemeSubmitting(false);
    }
  };

  const onDeleteTheme = async (themeId: string) => {
    if (themeId === activeThemeId) {
      setThemeError("Cannot delete the theme currently in use.");
      return;
    }
    setThemeError(null);
    setThemeMessage(null);
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      const resp = await fetchWithAuth(`${apiBase}/branding/themes/${encodeURIComponent(themeId)}`, {
        method: "DELETE",
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to delete theme.");
      }
      setThemes((prev) => prev.filter((t) => t.id !== themeId));
      setThemeMessage("Theme deleted.");
    } catch (err: any) {
      setThemeError(err?.message ?? "Failed to delete theme.");
    }
  };

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Branding"
        description="Manage global logo, hero section, and themes."
      />

      {/* Logo */}
      <form className="card p-6 space-y-4 max-w-md" onSubmit={onSubmit}>
        <h2 className="text-sm font-semibold text-slate-200">Logo</h2>
        <div className="space-y-1 text-sm">
          <label className="block text-slate-200">Logo image</label>
          {logo && !previewUrl && (
            <div className="space-y-1 mb-3">
              <p className="text-slate-200">Current logo</p>
              <div className="inline-flex items-center rounded-lg border border-slate-800 bg-slate-950 p-2">
                <img src={logo.url} alt={logo.alt} className="h-12 w-auto rounded-md object-contain" />
              </div>
            </div>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
            onChange={onFileChange}
            className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-100 hover:file:bg-slate-700"
          />
          <p className="text-xs text-slate-500">PNG, JPEG, GIF, or WEBP. Recommended square or horizontal layout.</p>
        </div>
        <div className="space-y-1 text-sm">
          <label className="block text-slate-200">Alt text</label>
          <input type="text" value={alt} onChange={(e) => setAlt(e.target.value)} className="input-field" />
        </div>
        {previewUrl && (
          <div className="space-y-1 text-sm">
            <p className="text-slate-200">Preview</p>
            <div className="inline-flex items-center rounded-lg border border-slate-800 bg-slate-950 p-2">
              <img src={previewUrl} alt="Preview" className="h-12 w-auto rounded-md object-contain" />
              <span className="ml-3 text-xs text-slate-400 truncate max-w-[12rem]">{file?.name}</span>
            </div>
          </div>
        )}
        <button type="submit" disabled={isSubmitting || !file} className="btn-primary disabled:opacity-50">
          {isSubmitting ? "Updating…" : "Update logo"}
        </button>
        {message && (
          <div className="rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            {message}
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}
      </form>

      {/* Hero texts */}
      <form className="card p-6 space-y-4 max-w-md" onSubmit={onHeroTextsSubmit}>
        <h2 className="text-sm font-semibold text-slate-200">Hero section text</h2>
        <p className="text-xs text-slate-500">Edit the text displayed on the homepage hero.</p>
        <div className="space-y-1 text-sm">
          <label className="block text-slate-200">Tagline</label>
          <input
            type="text"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder={DEFAULT_HERO_TAGLINE}
            className="input-field"
          />
        </div>
        <div className="space-y-1 text-sm">
          <label className="block text-slate-200">Headline</label>
          <input
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder={DEFAULT_HERO_HEADLINE}
            className="input-field"
          />
        </div>
        <div className="space-y-1 text-sm">
          <label className="block text-slate-200">Subtext</label>
          <textarea
            value={subtext}
            onChange={(e) => setSubtext(e.target.value)}
            placeholder={DEFAULT_HERO_SUBTEXT}
            className="input-field min-h-[80px]"
            rows={3}
          />
        </div>
        <button type="submit" disabled={heroSubmitting} className="btn-primary disabled:opacity-50">
          {heroSubmitting ? "Saving…" : "Save hero text"}
        </button>
        {heroMessage && (
          <div className="rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            {heroMessage}
          </div>
        )}
        {heroError && (
          <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {heroError}
          </div>
        )}
      </form>

      {/* Hero background image */}
      <form className="card p-6 space-y-4 max-w-md" onSubmit={onHeroImageSubmit}>
        <h2 className="text-sm font-semibold text-slate-200">Hero background image</h2>
        <p className="text-xs text-slate-500">Image displayed behind the hero text. Adjust opacity below.</p>
        {heroImageUrl && !heroPreviewUrl && (
          <div className="space-y-1">
            <p className="text-slate-200">Current image</p>
            <div className="rounded-lg border border-slate-800 overflow-hidden max-h-32">
              <img src={heroImageUrl} alt="Hero background" className="w-full h-32 object-cover" />
            </div>
          </div>
        )}
        <div className="space-y-1 text-sm">
          <label className="block text-slate-200">Image opacity</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="text-xs text-slate-400 w-12">{Math.round(opacity * 100)}%</span>
          </div>
        </div>
        <div className="space-y-1 text-sm">
          <label className="block text-slate-200">Upload new image</label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
            onChange={onHeroFileChange}
            className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-100 hover:file:bg-slate-700"
          />
        </div>
        {heroPreviewUrl && (
          <div className="space-y-1 text-sm">
            <p className="text-slate-200">Preview</p>
            <div className="rounded-lg border border-slate-800 overflow-hidden max-h-32">
              <img src={heroPreviewUrl} alt="Preview" className="w-full h-32 object-cover" />
            </div>
          </div>
        )}
        <button type="submit" disabled={heroSubmitting || !heroFile} className="btn-primary disabled:opacity-50">
          {heroSubmitting ? "Uploading…" : "Update hero image"}
        </button>
      </form>

      {/* Save opacity when it changes - include in hero texts form or add separate save for opacity */}
      {/* Actually opacity is in the hero texts form - we need to include it. Let me add opacity to onHeroTextsSubmit. Done - we're passing opacity in the body. Good. */}

      {/* Themes */}
      <div className="card p-6 space-y-4 max-w-md">
        <h2 className="text-sm font-semibold text-slate-200">Themes</h2>
        <p className="text-xs text-slate-500">Select the active theme. Add or delete themes below.</p>
        <div className="space-y-1 text-sm">
          <label className="block text-slate-200">Active theme</label>
          <select
            value={activeThemeId ?? ""}
            onChange={(e) => onActiveThemeChange(e.target.value || null)}
            className="input-field"
          >
            <option value="">Default (none)</option>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <form onSubmit={onAddTheme} className="flex gap-2">
          <input
            type="text"
            value={newThemeName}
            onChange={(e) => setNewThemeName(e.target.value)}
            placeholder="New theme name"
            className="input-field flex-1"
          />
          <button type="submit" disabled={themeSubmitting || !newThemeName.trim()} className="btn-primary disabled:opacity-50">
            Add
          </button>
        </form>
        {themes.length > 0 && (
          <ul className="space-y-2">
            {themes.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-sm">
                <span className="text-slate-200">{t.name}</span>
                <button
                  type="button"
                  onClick={() => onDeleteTheme(t.id)}
                  disabled={t.id === activeThemeId}
                  className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t.id === activeThemeId ? "In use" : "Delete"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {themeMessage && (
          <div className="rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            {themeMessage}
          </div>
        )}
        {themeError && (
          <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {themeError}
          </div>
        )}
      </div>
    </div>
  );
};

export default BrandingPage;
