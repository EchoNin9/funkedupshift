import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth, canCreateMemes } from "../../shell/AuthContext";
import AddTagInput from "./AddTagInput";
import { fetchWithAuth } from "../../utils/api";

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
const MAX_OUTPUT_DIM = 2048;
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
  const textBoxesRef = useRef<TextBox[]>([]);
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
  const [tags, setTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);

  const addTextBox = (zoneId: string) => {
    const prev = textBoxesRef.current;
    if (prev.some((t) => t.zoneId === zoneId)) return;
    const next = [...prev, { zoneId, text: "", font: FONTS[0], color: "#ffffff", size: 32 }];
    textBoxesRef.current = next;
    setTextBoxes(next);
    setSelectedZone(zoneId);
  };

  const removeTextBox = (zoneId: string) => {
    const prev = textBoxesRef.current;
    const next = prev.filter((t) => t.zoneId !== zoneId);
    textBoxesRef.current = next;
    setTextBoxes(next);
    if (selectedZone === zoneId) setSelectedZone(null);
  };

  const updateTextBox = (zoneId: string, updates: Partial<TextBox>) => {
    const prev = textBoxesRef.current;
    const next = prev.map((t) => (t.zoneId === zoneId ? { ...t, ...updates } : t));
    textBoxesRef.current = next;
    setTextBoxes(next);
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
      const resp = await fetchWithAuth(`${getApiBaseUrl()}/memes/import-from-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = (await resp.json()) as { presignedUrl?: string; error?: string };
      if (!data.presignedUrl) {
        setError(data.error || "Failed to load image from URL");
        return;
      }
      setImageSrc(data.presignedUrl);
      setImageFile(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load image from URL");
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

  const drawCanvas = useCallback((): Promise<void> => {
    const canvas = canvasRef.current;
    if (!canvas || !imageSrc) return Promise.resolve();
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        // Image drawing bounds (used for text positioning)
        let imgX = 0, imgY = 0, imgW = w, imgH = h;

        if (sizeMode === "resize") {
          // Resize to fit: stretch image to fill the entire box
          ctx.drawImage(img, 0, 0, w, h);
        } else {
          // Original: preserve aspect ratio, longest side touches box border
          const scale = Math.min(w / img.width, h / img.height);
          imgW = img.width * scale;
          imgH = img.height * scale;
          imgX = (w - imgW) / 2;
          imgY = (h - imgH) / 2;
          ctx.drawImage(img, imgX, imgY, imgW, imgH);
        }

        // Draw text relative to image bounds so preview matches saved output
        const textScale = sizeMode === "original"
          ? Math.min(imgW, imgH) / CANVAS_SIZE
          : 1;
        textBoxesRef.current.forEach((tb) => {
          const zone = FIXED_ZONES.find((z) => z.id === tb.zoneId);
          if (!zone || !tb.text) return;
          ctx.font = `${Math.round(tb.size * textScale)}px ${tb.font}`;
          ctx.fillStyle = tb.color;
          ctx.textAlign = zone.align;
          ctx.textBaseline = zone.y < 0.5 ? "top" : "bottom";
          const x = imgX + zone.x * imgW;
          const y = imgY + zone.y * imgH;
          ctx.fillText(tb.text, x, y);
        });
        resolve();
      };
      img.onerror = () => {
        setError("Failed to load image");
        reject(new Error("Failed to load image"));
      };
      img.src = imageSrc;
    });
  }, [imageSrc, textBoxes, sizeMode]);

  useEffect(() => {
    drawCanvas().catch(() => {});
  }, [drawCanvas]);

  useEffect(() => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    let cancelled = false;
    fetch(`${apiBase}/memes/tags`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load tags"))))
      .then((data: { tags?: string[] }) => {
        if (cancelled) return;
        setAllTags((data.tags ?? []).sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async () => {
    if (!imageSrc) {
      setError("Add an image first");
      return;
    }
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setError("API not configured");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      let blob: Blob | null;

      if (sizeMode === "original") {
        // Export at the image's original aspect ratio
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.crossOrigin = "anonymous";
          i.onload = () => resolve(i);
          i.onerror = () => reject(new Error("Failed to load image"));
          i.src = imageSrc!;
        });
        const dimScale = Math.min(1, MAX_OUTPUT_DIM / Math.max(img.width, img.height));
        const outW = Math.round(img.width * dimScale);
        const outH = Math.round(img.height * dimScale);

        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = outW;
        exportCanvas.height = outH;
        const ctx = exportCanvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, outW, outH);

        // Draw text overlays scaled proportionally
        const textScale = Math.min(outW, outH) / CANVAS_SIZE;
        textBoxesRef.current.forEach((tb) => {
          const zone = FIXED_ZONES.find((z) => z.id === tb.zoneId);
          if (!zone || !tb.text) return;
          ctx.font = `${Math.round(tb.size * textScale)}px ${tb.font}`;
          ctx.fillStyle = tb.color;
          ctx.textAlign = zone.align;
          ctx.textBaseline = zone.y < 0.5 ? "top" : "bottom";
          ctx.fillText(tb.text, zone.x * outW, zone.y * outH);
        });

        blob = await new Promise<Blob | null>((resolve) => {
          exportCanvas.toBlob((b) => resolve(b), "image/png", 0.95);
        });
      } else {
        // Resize to fit: export the square canvas as-is
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Canvas not available");
        await drawCanvas();
        await new Promise((r) => requestAnimationFrame(r));
        blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((b) => resolve(b), "image/png", 0.95);
        });
      }

      if (!blob) throw new Error("Failed to export canvas");

      const uploadResp = await fetchWithAuth(`${apiBase}/memes/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: "image/png" })
      });
      const uploadData = (await uploadResp.json()) as { uploadUrl?: string; key?: string };
      if (!uploadData.uploadUrl || !uploadData.key) {
        throw new Error((uploadData as { error?: string }).error || "Failed to get upload URL");
      }
      const mediaKey = uploadData.key;
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
          textBoxes: textBoxesRef.current,
          sizeMode,
          tags
        })
      });
      if (!createResp.ok) {
        const errData = (await createResp.json()) as { error?: string };
        throw new Error(errData.error || "Failed to save meme");
      }
      const createData = (await createResp.json()) as { id?: string };
      try {
        sessionStorage.setItem("memes_my_cache_invalidate", JSON.stringify({ tagOnly: false }));
      } catch {
        /* ignore */
      }
      navigate(createData.id ? `/memes/${encodeURIComponent(createData.id)}` : "/memes");
    } catch (e: any) {
      setError(e?.message ?? "Failed to save meme");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canCreate = canCreateMemes(user) || !!user?.impersonated;
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
  if (!canCreate) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-slate-50">Meme Generator</h1>
        <div className="rounded-md border border-slate-700 bg-slate-900/60 px-4 py-3 text-slate-200">
          Meme creator access required (user + Memes group). Join the Memes custom group or contact an admin.
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
                  <div className="flex rounded-md border border-slate-700 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setSizeMode("resize")}
                      className={`px-3 py-1 text-xs transition-colors ${
                        sizeMode === "resize"
                          ? "bg-brand-orange text-slate-950 font-medium"
                          : "bg-slate-950 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Resize to fit
                    </button>
                    <button
                      type="button"
                      onClick={() => setSizeMode("original")}
                      className={`px-3 py-1 text-xs transition-colors ${
                        sizeMode === "original"
                          ? "bg-brand-orange text-slate-950 font-medium"
                          : "bg-slate-950 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Original
                    </button>
                  </div>
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
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Tags</label>
              <AddTagInput
                tags={tags}
                onTagsChange={setTags}
                allTags={allTags}
                fetchTags={async (q) => {
                  const apiBase = getApiBaseUrl();
                  if (!apiBase) return [];
                  const r = await fetchWithAuth(`${apiBase}/memes/tags?q=${encodeURIComponent(q)}`);
                  if (!r.ok) return [];
                  const d = (await r.json()) as { tags?: string[] };
                  return d.tags ?? [];
                }}
                placeholder="Type to suggest or create tag, Tab to autocomplete"
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
