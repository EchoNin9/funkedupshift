import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ScissorsIcon, ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import { Alert } from "../../components";
import { useAuth } from "../../shell/AuthContext";

// ---- client-side image crop ----
// Crop is also carried inside ImagePage.tsx (Image Resizer, which crops as
// part of its downsize flow) and duplicated again in the tools-site app's
// src/CropTool.tsx — the two frontends deliberately don't import from each
// other (see the note atop src/web/tools-site/src/api.ts), so the small
// processing functions are carried in each place.

const MAX_DIMENSION = 8192; // cap the working canvas's long edge

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Decodes a File into an HTMLImageElement. Rejects on non-image type or a
 * file the browser can't decode. */
function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("That doesn't look like an image file."));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode that image."));
    };
    img.src = url;
  });
}

/** Draws a decoded image into the given canvas, downscaling so the long edge
 * never exceeds MAX_DIMENSION. Returns whether it downscaled. */
function drawSourceIntoCanvas(img: HTMLImageElement, canvas: HTMLCanvasElement): boolean {
  let { naturalWidth: width, naturalHeight: height } = img;
  let downscaled = false;
  const longEdge = Math.max(width, height);
  if (longEdge > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / longEdge;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    downscaled = true;
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas isn't supported in this browser.");
  ctx.drawImage(img, 0, 0, width, height);
  return downscaled;
}

/** Crops a region out of a source canvas into a new offscreen canvas. */
function cropCanvas(source: HTMLCanvasElement, crop: CropRect): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(crop.w));
  out.height = Math.max(1, Math.round(crop.h));
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas isn't supported in this browser.");
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
  return out;
}

function encodeCanvas(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image."))),
      mime,
      1
    );
  });
}
// ---- end shared image logic ----

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function formatKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

type Format = "image/webp" | "image/jpeg";

interface ImgMeta {
  width: number;
  height: number;
  downscaled: boolean;
  fileSize: number;
}

interface Result {
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

const CropPage: React.FC = () => {
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const [meta, setMeta] = useState<ImgMeta | null>(null);
  const [selection, setSelection] = useState<CropRect | null>(null);
  const [format, setFormat] = useState<Format>("image/webp");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    setError(null);
    setSelection(null);
    setResult((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    try {
      const img = await loadImageFile(file);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const downscaled = drawSourceIntoCanvas(img, canvas);
      setMeta({ width: canvas.width, height: canvas.height, downscaled, fileSize: file.size });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load that image.");
    }
  };

  const pointToCanvas = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: clamp((clientX - rect.left) * scaleX, 0, canvas.width),
      y: clamp((clientY - rect.top) * scaleY, 0, canvas.height)
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!meta) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointToCanvas(e.clientX, e.clientY);
    dragStartRef.current = p;
    setSelection({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragStartRef.current) return;
    const start = dragStartRef.current;
    const p = pointToCanvas(e.clientX, e.clientY);
    setSelection({
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x),
      h: Math.abs(p.y - start.y)
    });
  };

  const handlePointerUp = () => {
    if (!dragStartRef.current) return;
    dragStartRef.current = null;
    setSelection((prev) => (prev && prev.w >= 2 && prev.h >= 2 ? prev : null));
  };

  const handleReset = () => setSelection(null);

  const handleCrop = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !meta || !selection || selection.w < 2 || selection.h < 2) return;
    setProcessing(true);
    setError(null);
    try {
      const target = cropCanvas(canvas, selection);
      const blob = await encodeCanvas(target, format);
      setResult((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { blob, url: URL.createObjectURL(blob), width: target.width, height: target.height };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not crop that image.");
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const ext = format === "image/webp" ? "webp" : "jpg";
    const a = document.createElement("a");
    a.href = result.url;
    a.download = `crop.${ext}`;
    a.click();
  };

  const selStyle = (): React.CSSProperties | undefined => {
    if (!selection || !meta) return undefined;
    return {
      left: `${(selection.x / meta.width) * 100}%`,
      top: `${(selection.y / meta.height) * 100}%`,
      width: `${(selection.w / meta.width) * 100}%`,
      height: `${(selection.h / meta.height) * 100}%`
    };
  };

  const hasSelection = !!selection && selection.w >= 2 && selection.h >= 2;

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-text-primary">Crop Image</h1>
        <p className="text-sm text-text-secondary">Sign in to use the crop tool.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <motion.h1
        className="text-2xl font-semibold tracking-tight text-text-primary flex items-center gap-2"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <ScissorsIcon className="h-6 w-6 text-accent" />
        Crop Image
      </motion.h1>
      <p className="text-sm text-text-secondary">Processed locally — images never leave your browser.</p>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="rounded-xl border border-border-default bg-surface-2/80 p-4 space-y-3">
        <label htmlFor="croptool-file" className="block text-sm text-text-secondary">
          Choose an image
        </label>
        <input
          id="croptool-file"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="block w-full text-sm text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-accent-500 file:px-3 file:py-2 file:text-xs file:font-medium file:text-white hover:file:bg-accent-600 file:cursor-pointer"
        />
      </div>

      {/* Always mounted: handleFileChange draws in here before meta exists,
          so unmounting it while empty would leave canvasRef.current null on
          the first file pick. */}
      <div
        className="relative inline-block max-w-full overflow-hidden rounded-xl border border-border-default bg-surface-1 leading-none"
        style={{ display: meta ? undefined : "none" }}
      >
        <canvas
          ref={canvasRef}
          className="block max-w-full h-auto touch-none cursor-crosshair"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        {selection && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-accent bg-accent-500/15"
            style={selStyle()}
          />
        )}
      </div>

      {meta && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-secondary">
            <span className="flex items-center gap-1.5">
              <ScissorsIcon className="h-4 w-4" />
              {hasSelection
                ? `Selection: ${Math.round(selection!.w)} × ${Math.round(selection!.h)}`
                : "Drag on the image to select a crop region."}
            </span>
            <button
              type="button"
              onClick={handleReset}
              disabled={!selection}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-hover bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reset
            </button>
          </div>

          {meta.downscaled && (
            <Alert variant="error">
              This image was larger than {MAX_DIMENSION}px on its long edge and was downscaled to fit.
            </Alert>
          )}

          <p className="text-xs text-text-tertiary">
            Original: {meta.width} × {meta.height} — {formatKB(meta.fileSize)}
          </p>

          <div className="rounded-xl border border-border-default bg-surface-2/80 p-4 space-y-3">
            <div>
              <label htmlFor="croptool-format" className="block text-sm text-text-secondary mb-1">
                Output format
              </label>
              <select
                id="croptool-format"
                value={format}
                onChange={(e) => setFormat(e.target.value as Format)}
                className="w-full rounded-lg border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary"
              >
                <option value="image/webp">WebP</option>
                <option value="image/jpeg">JPEG</option>
              </select>
            </div>

            <button
              type="button"
              onClick={handleCrop}
              disabled={processing || !hasSelection}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent-500 px-3 py-2 text-xs font-medium text-white hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing ? "Cropping…" : "Crop"}
            </button>
          </div>

          {result && (
            <div className="rounded-xl border border-border-default bg-surface-2/80 p-4 space-y-3">
              <p className="text-sm text-text-secondary">
                Result: {result.width} × {result.height} — {formatKB(result.blob.size)}
              </p>
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent-500 px-3 py-2 text-xs font-medium text-white hover:bg-accent-600 transition-colors"
              >
                <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                Download
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default CropPage;
