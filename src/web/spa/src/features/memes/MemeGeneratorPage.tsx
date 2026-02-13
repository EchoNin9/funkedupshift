import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth, canAccessMemes } from "../../shell/AuthContext";

const FONTS = ["Impact", "Arial Black", "Comic Sans MS", "Georgia", "Verdana", "Times New Roman", "Courier New"];
const FIXED_ZONES = [
  { id: "top-left", x: 0.05, y: 0.05, align: "left" as CanvasTextAlign },
  { id: "top-center", x: 0.5, y: 0.05, align: "center" as CanvasTextAlign },
  { id: "top-right", x: 0.95, y: 0.05, align: "right" as CanvasTextAlign },
  { id: "center", x: 0.5, y: 0.5, align: "center" as CanvasTextAlign },
  { id: "bottom-left", x: 0.05, y: 0.95, align: "left" as CanvasTextAlign },
  { id: "bottom-center", x: 0.5, y: 0.95, align: "center" as CanvasTextAlign },
  { id: "bottom-right", x: 0.95, y: 0.95, align: "right" as CanvasTextAlign },
];

interface TextBox {
  zoneId: string;
  text: string;
  font: string;
  color: string;
  size: number;
}

const CANVAS_SIZE = 500;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

const MemeGeneratorPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [textBoxes, setTextBoxes] = useState<TextBox[]>([]);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [sizeMode, setSizeMode] = useState<"original" | "resize">("resize");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatingTitle, setGeneratingTitle] = useState(false);

  const fetchWithAuth = useCallback(async (url: string, options?: RequestInit) => {
    const w = window as any;
    if (!w.auth?.getAccessToken) throw new Error("Not signed in");
    const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
    if (!token) throw new Error("Not signed in");
    return fetch(url, { ...options, headers: { ...options?.headers, Authorization: `Bearer ${token}` } });
  }, []);

  const addTextBox = (zoneId: string) => {
    if (textBoxes.some((t) => t.zoneId === zoneId)) return;
    setTextBoxes((prev) => [...prev, { zoneId, text: "", font: FONTS[0], color: "#ffffff", size: 32 }]);
    setSelectedZone(zoneId);
  };

  const removeTextBox = (zoneId: string) => {
    setTextBoxes((prev) => prev.filter((t) => t.zoneId !== zoneId));
    if (selectedZone === zoneId) setSelectedZone(null);
  };

  const updateTextBox = (zoneId: string, updates: Partial<TextBox>) => {
    setTextBoxes((prev) => prev.map((t) => (t.zoneId === zoneId ? { ...t, ...updates } : t)));
  };

  const loadImageFromFile = (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      setError("File too large (max 10MB)");
      return;
    }
    const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"];
    if (!validTypes.includes(file.type)) {
      setError("Invalid image type");
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setImageSrc(reader.result as string);
    reader.readAsDataURL(file);
    setImageFile(file);
    setImageUrl("");
  };

  const loadImageFromUrl = async () => {
    const url = imageUrl.trim();
    if (!url) return;
    setError(null);
    try {
      const resp = await fetchWithAuth(`${getApiBaseUrl()}/memes/validate-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = (await resp.json()) as { valid?: boolean; error?: string };
      if (!data.valid) {
        setError(data.error || "Invalid image URL");
        return;
      }
      setImageSrc(url);
      setImageFile(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to validate URL");
    }
  };

  const generateTitle = async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setGeneratingTitle(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/memes/generate-title`, { method: "POST" });
      const data = (await resp.json()) as { title?: string };
      if (data.title) setTitle(data.title);
    } catch {
      setTitle(`Meme ${Date.now().toString(36)}`);
    } finally {
      setGeneratingTitle(false);
    }
  };

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageSrc) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      if (sizeMode === "resize") {
        const scale = Math.min(w / img.width, h / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = (w - dw) / 2;
        const dy = (h - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);
      } else {
        ctx.drawImage(img, 0, 0, w, h);
      }
      textBoxes.forEach((tb) => {
        const zone = FIXED_ZONES.find((z) => z.id === tb.zoneId);
        if (!zone || !tb.text) return;
        ctx.font = `${tb.size}px ${tb.font}`;
        ctx.fillStyle = tb.color;
        ctx.textAlign = zone.align;
        ctx.textBaseline = zone.y < 0.5 ? "top" : "bottom";
        const x = zone.x * w;
        const y = zone.y * h;
        ctx.fillText(tb.text, x, y);
      });
    };
    img.onerror = () => setError("Failed to load image");
    img.src = imageSrc;
  }, [imageSrc, textBoxes, sizeMode]);

  useEffect(() => drawCanvas(), [drawCanvas]);

  const handleSubmit = async () => {
    if (!imageSrc) {
      setError("Add an image first");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setError("API not configured");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/png", 0.95);
      });
      if (!blob) {
        throw new Error("Failed to export canvas");
      }
      const uploadResp = await fetchWithAuth(`${apiBase}/memes/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: "image/png" })
      });
      const uploadData = (await uploadResp.json()) as { uploadUrl?: string; key?: string };
      if (!uploadData.uploadUrl || !uploadData.key) {
        throw new Error((uploadData as { error?: string }).error || "Failed to get upload URL");
      }
      await fetch(uploadData.uploadUrl, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": "image/png" }
      });
      const createResp = await fetchWithAuth(`${apiBase}/memes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaKey,
          title: title.trim() || undefined,
          description: description.trim() || undefined,
          isPrivate: isPrivate,
          textBoxes,
          sizeMode,
          tags: []
        })
      });
      if (!createResp.ok) {
        const errData = (await createResp.json()) as { error?: string };
        throw new Error(errData.error || "Failed to save meme");
      }
      const createData = (await createResp.json()) as { id?: string };
      navigate(createData.id ? `/memes/${encodeURIComponent(createData.id)}` : "/memes");
    } catch (e: any) {
      setError(e?.message ?? "Failed to save meme");
    } finally {
      setIsSubmitting(false);
    }
  };

  const access = canAccessMemes(user);
  if (!user) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-slate-50">Meme Generator</h1>
        <div className="rounded-md border border-slate-700 bg-slate-900/60 px-4 py-3 text-slate-200">
          Sign in to create memes.
        </div>
      </div>
    );
  }
  if (!access) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-slate-50">Meme Generator</h1>
        <div className="rounded-md border border-slate-700 bg-slate-900/60 px-4 py-3 text-slate-200">
          You do not have access. Join the Memes custom group or contact an admin.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <Link to="/memes" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Memes
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Meme Generator</h1>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr,320px]">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <label className="block text-xs font-medium text-slate-400 mb-2">Image</label>
            <div className="flex flex-col gap-2">
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,image/bmp"
                onChange={(e) => e.target.files?.[0] && loadImageFromFile(e.target.files[0])}
                className="text-sm text-slate-300 file:mr-2 file:rounded file:border-0 file:bg-brand-orange file:px-3 file:py-1 file:text-slate-950"
              />
              <span className="text-xs text-slate-500">or</span>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="Paste image URL"
                  className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={loadImageFromUrl}
                  className="rounded-md bg-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-600"
                >
                  Load
                </button>
              </div>
            </div>
          </div>

          {imageSrc && (
            <>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-slate-400">Preview</label>
                  <select
                    value={sizeMode}
                    onChange={(e) => setSizeMode(e.target.value as "original" | "resize")}
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300"
                  >
                    <option value="resize">Resize to fit</option>
                    <option value="original">Original</option>
                  </select>
                </div>
                <canvas
                  ref={canvasRef}
                  width={CANVAS_SIZE}
                  height={CANVAS_SIZE}
                  className="w-full max-w-[500px] border border-slate-700 rounded-lg bg-slate-900"
                />
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <label className="block text-xs font-medium text-slate-400 mb-2">Text boxes (fixed zones)</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {FIXED_ZONES.map((zone) => {
                    const tb = textBoxes.find((t) => t.zoneId === zone.id);
                    return (
                      <div key={zone.id} className="rounded border border-slate-700 p-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-slate-400">{zone.id}</span>
                          {tb ? (
                            <button
                              type="button"
                              onClick={() => removeTextBox(zone.id)}
                              className="text-red-400 hover:text-red-300 text-xs"
                            >
                              Remove
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => addTextBox(zone.id)}
                              className="text-brand-orange hover:text-orange-400 text-xs"
                            >
                              Add
                            </button>
                          )}
                        </div>
                        {tb && (
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={tb.text}
                              onChange={(e) => updateTextBox(zone.id, { text: e.target.value })}
                              placeholder="Text"
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-50"
                            />
                            <select
                              value={tb.font}
                              onChange={(e) => updateTextBox(zone.id, { font: e.target.value })}
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-300"
                            >
                              {FONTS.map((f) => (
                                <option key={f} value={f}>{f}</option>
                              ))}
                            </select>
                            <div className="flex gap-1">
                              <input
                                type="color"
                                value={tb.color}
                                onChange={(e) => updateTextBox(zone.id, { color: e.target.value })}
                                className="h-6 w-8 cursor-pointer rounded border border-slate-700"
                              />
                              <input
                                type="number"
                                value={tb.size}
                                onChange={(e) => updateTextBox(zone.id, { size: Number(e.target.value) || 32 })}
                                min={12}
                                max={72}
                                className="w-14 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px] text-slate-50"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Title (optional)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Generate or type"
                  className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={generateTitle}
                  disabled={generatingTitle}
                  className="rounded-md bg-brand-orange px-3 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
                >
                  {generatingTitle ? "…" : "Generate"}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                rows={3}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="rounded border-slate-600"
              />
              Private (only you can see)
            </label>
          </div>

          {error && (
            <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!imageSrc || isSubmitting}
            className="w-full rounded-md bg-brand-orange px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Saving…" : "Save meme"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MemeGeneratorPage;
