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
  "image/webp"
] as const;

const BrandingPage: React.FC = () => {
  const { user } = useAuth();
  const { logo, hero } = useBranding();
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("Funkedupshift");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [heroTagline, setHeroTagline] = useState(hero.tagline);
  const [heroHeadline, setHeroHeadline] = useState(hero.headline);
  const [heroSubtext, setHeroSubtext] = useState(hero.subtext);
  const [heroOpacity, setHeroOpacity] = useState(hero.imageOpacity);
  const [heroFile, setHeroFile] = useState<File | null>(null);
  const [heroPreviewUrl, setHeroPreviewUrl] = useState<string | null>(null);
  const [heroSubmitting, setHeroSubmitting] = useState(false);
  const [heroMessage, setHeroMessage] = useState<string | null>(null);
  const [heroError, setHeroError] = useState<string | null>(null);

  useEffect(() => {
    setHeroTagline(hero.tagline);
    setHeroHeadline(hero.headline);
    setHeroSubtext(hero.subtext);
    setHeroOpacity(hero.imageOpacity);
  }, [hero.tagline, hero.headline, hero.subtext, hero.imageOpacity]);

  const isSuperAdmin = hasRole(user ?? null, "superadmin");

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

  const onHeroTextSave = async (e: React.FormEvent) => {
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
        body: JSON.stringify({
          heroTagline: heroTagline,
          heroHeadline: heroHeadline,
          heroSubtext: heroSubtext,
          heroImageOpacity: heroOpacity,
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `Save failed with ${resp.status}`);
      }
      setHeroMessage("Hero text and opacity saved.");
    } catch (err: any) {
      setHeroError(err?.message ?? "Failed to save hero.");
    } finally {
      setHeroSubmitting(false);
    }
  };

  const onHeroImageUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setHeroError(null);
    setHeroMessage(null);
    if (!heroFile) {
      setHeroError("Choose an image file first.");
      return;
    }
    const contentType = heroFile.type || "image/png";
    if (!allowedTypes.includes(contentType as any)) {
      setHeroError("Hero image must be PNG, JPEG, GIF, or WEBP.");
      return;
    }
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setHeroError("API URL not configured.");
      return;
    }
    setHeroSubmitting(true);
    try {
      const metaResp = await fetchWithAuth(`${apiBase}/branding/hero-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType }),
      });
      if (!metaResp.ok) {
        const txt = await metaResp.text();
        throw new Error(txt || `Request failed with ${metaResp.status}`);
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
      setHeroMessage("Hero image saved. Refresh the home page to see it.");
      setHeroFile(null);
      if (heroPreviewUrl) {
        URL.revokeObjectURL(heroPreviewUrl);
        setHeroPreviewUrl(null);
      }
      window.location.reload();
    } catch (err: any) {
      setHeroError(err?.message ?? "Failed to upload hero image.");
    } finally {
      setHeroSubmitting(false);
    }
  };

  const onHeroImageRemove = async () => {
    setHeroError(null);
    setHeroMessage(null);
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setHeroError("API URL not configured.");
      return;
    }
    setHeroSubmitting(true);
    try {
      const resp = await fetchWithAuth(`${apiBase}/branding/hero-image`, { method: "DELETE" });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `Remove failed with ${resp.status}`);
      }
      setHeroMessage("Hero image removed.");
      window.location.reload();
    } catch (err: any) {
      setHeroError(err?.message ?? "Failed to remove hero image.");
    } finally {
      setHeroSubmitting(false);
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
    if (!allowedTypes.includes(contentType as any)) {
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
        body: JSON.stringify({ contentType, alt })
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
        headers: {
          "Content-Type": contentType
        },
        body: file
      });
      if (!uploadResp.ok) {
        throw new Error(`Upload failed with ${uploadResp.status}`);
      }

      setMessage("Logo updated. It may take a moment for caches to refresh.");
    } catch (err: any) {
      setError(err?.message ?? "Failed to update logo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Branding"
        description="Upload a new global logo. Used in the navigation bar and shared surfaces."
      />

      <form className="card p-6 space-y-4 max-w-md" onSubmit={onSubmit}>
        <div className="space-y-1 text-sm">
          <label className="block text-slate-200">Logo image</label>
          {logo && !previewUrl && (
            <div className="space-y-1 mb-3">
              <p className="text-slate-200">Current logo</p>
              <div className="inline-flex items-center rounded-lg border border-slate-800 bg-slate-950 p-2">
                <img
                  src={logo.url}
                  alt={logo.alt}
                  className="h-12 w-auto rounded-md object-contain"
                />
              </div>
            </div>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
            onChange={onFileChange}
            className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-100 hover:file:bg-slate-700"
          />
          <p className="text-xs text-slate-500">
            PNG, JPEG, GIF, or WEBP. Recommended square or horizontal layout.
          </p>
        </div>

        <div className="space-y-1 text-sm">
          <label className="block text-slate-200">Alt text</label>
          <input
            type="text"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            className="input-field"
          />
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

        <button
          type="submit"
          disabled={isSubmitting || !file}
          className="btn-primary disabled:opacity-50"
        >
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

      <form className="card p-6 space-y-4 max-w-2xl" onSubmit={onHeroTextSave}>
        <h2 className="text-lg font-semibold text-slate-100">Hero section</h2>
        <p className="text-sm text-slate-400">
          Edit the home page hero text and background image. Text uses fallbacks when empty.
        </p>

        <div className="space-y-1 text-sm">
          <label className="block text-slate-200">Tagline</label>
          <input
            type="text"
            value={heroTagline}
            onChange={(e) => setHeroTagline(e.target.value)}
            placeholder={DEFAULT_HERO_TAGLINE}
            className="input-field"
          />
        </div>
        <div className="space-y-1 text-sm">
          <label className="block text-slate-200">Headline</label>
          <input
            type="text"
            value={heroHeadline}
            onChange={(e) => setHeroHeadline(e.target.value)}
            placeholder={DEFAULT_HERO_HEADLINE}
            className="input-field"
          />
        </div>
        <div className="space-y-1 text-sm">
          <label className="block text-slate-200">Subtext</label>
          <textarea
            value={heroSubtext}
            onChange={(e) => setHeroSubtext(e.target.value)}
            placeholder={DEFAULT_HERO_SUBTEXT}
            className="input-field min-h-[4rem]"
            rows={3}
          />
        </div>
        <div className="space-y-1 text-sm">
          <label className="block text-slate-200">Background image opacity ({heroOpacity}%)</label>
          <input
            type="range"
            min={0}
            max={100}
            value={heroOpacity}
            onChange={(e) => setHeroOpacity(parseInt(e.target.value, 10))}
            className="w-full"
          />
        </div>
        <button
          type="submit"
          disabled={heroSubmitting}
          className="btn-primary disabled:opacity-50"
        >
          {heroSubmitting ? "Saving…" : "Save hero text & opacity"}
        </button>

        <div className="border-t border-slate-700 pt-4 mt-4 space-y-4">
          <label className="block text-slate-200">Hero background image</label>
          {hero.imageUrl && !heroPreviewUrl && (
            <div className="space-y-1">
              <p className="text-slate-200">Current image</p>
              <div className="inline-flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950 p-2">
                <img
                  src={hero.imageUrl}
                  alt=""
                  className="h-24 w-auto max-w-[12rem] rounded-md object-cover"
                />
                <button
                  type="button"
                  onClick={onHeroImageRemove}
                  disabled={heroSubmitting}
                  className="btn-secondary text-sm !px-3 !py-1.5 disabled:opacity-50"
                >
                  Remove image
                </button>
              </div>
            </div>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
            onChange={onHeroFileChange}
            className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-100 hover:file:bg-slate-700"
          />
          {heroFile && (
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center rounded-lg border border-slate-800 bg-slate-950 p-2">
                <img src={heroPreviewUrl!} alt="" className="h-24 w-auto max-w-[12rem] rounded-md object-cover" />
              </div>
              <button
                type="button"
                onClick={onHeroImageUpload}
                disabled={heroSubmitting}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {heroSubmitting ? "Uploading…" : "Upload hero image"}
              </button>
            </div>
          )}
        </div>

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
    </div>
  );
};

export default BrandingPage;

