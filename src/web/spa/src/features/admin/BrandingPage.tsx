import React, { useState } from "react";
import { useAuth, hasRole } from "../../shell/AuthContext";
import { fetchWithAuth } from "../../utils/api";
import { useBranding } from "../../shell/BrandingContext";

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
  const { logo } = useBranding();
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("Funkedupshift");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSuperAdmin = hasRole(user ?? null, "superadmin");

  if (!isSuperAdmin) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Branding</h1>
        <p className="text-sm text-slate-400">
          Only superadmin users can manage global branding assets.
        </p>
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
    <div className="space-y-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Branding</h1>
        <p className="text-sm text-slate-400">
          Upload a new global logo for Funkedupshift. This logo is used in the navigation bar and other
          shared surfaces.
        </p>
      </header>

      <form className="space-y-4 max-w-md" onSubmit={onSubmit}>
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
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
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
          className="inline-flex items-center justify-center rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-500 disabled:opacity-50"
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
    </div>
  );
};

export default BrandingPage;

