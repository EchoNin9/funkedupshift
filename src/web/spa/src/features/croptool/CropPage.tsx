import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DownloadSimple, LockSimple, Scissors } from "@phosphor-icons/react";
import { Alert } from "../../components";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { useAuth } from "../../shell/AuthContext";
import { saveBlob } from "../../utils/saveFile";

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
    void saveBlob(result.blob, `crop.${ext}`).catch((e) => setError(e instanceof Error ? e.message : "Could not save the file."));
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
        <p className="text-sm text-text-secondary">Sign in to use the crop tool.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Crop Image</h1>
      <p className="text-sm text-text-secondary">Processed locally — images never leave your browser.</p>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-3.5 space-y-3">
        <label htmlFor="croptool-file" className="block text-[13px] font-semibold text-text-primary">
          Choose an image
        </label>
        <input
          id="croptool-file"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className={`block w-full text-sm text-text-secondary file:mr-3 file:cursor-pointer file:rounded-ds-md file:border-0 file:bg-accent file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-on-accent hover:file:bg-accent-600 motion-safe:file:transition-colors rounded-ds-md ${focusRing}`}
        />
      </div>

      {/* Always mounted: handleFileChange draws in here before meta exists,
          so unmounting it while empty would leave canvasRef.current null on
          the first file pick. */}
      <div
        className="relative inline-block max-w-full overflow-hidden rounded-ds-lg border border-border-default bg-surface-1 leading-none"
        style={{ display: meta ? undefined : "none" }}
      >
        <canvas
          ref={canvasRef}
          className="block max-w-full h-auto touch-none cursor-crosshair"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
        />
        {selection && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-accent bg-accent/15"
            style={selStyle()}
          />
        )}
      </div>

      {meta && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-secondary">
            <span className="flex items-center gap-1.5">
              <Scissors size={16} weight="regular" aria-hidden="true" />
              {hasSelection
                ? `Selection: ${Math.round(selection!.w)} × ${Math.round(selection!.h)}`
                : "Drag on the image to select a crop region."}
            </span>
            <button
              type="button"
              onClick={handleReset}
              disabled={!selection}
              className={buttonClasses("secondary", "sm")}
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

          <div className="rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-3.5 space-y-3">
            <div>
              <label htmlFor="croptool-format" className="mb-1.5 block text-[13px] font-semibold text-text-primary">
                Output format
              </label>
              <select
                id="croptool-format"
                value={format}
                onChange={(e) => setFormat(e.target.value as Format)}
                className={`min-h-12 w-full rounded-ds-md border border-border-default bg-surface-0 px-3 text-[15px] text-text-primary hover:border-border-hover motion-safe:transition-colors ${focusRing}`}
              >
                <option value="image/webp">WebP</option>
                <option value="image/jpeg">JPEG</option>
              </select>
            </div>

            <button
              type="button"
              onClick={handleCrop}
              disabled={processing || !hasSelection}
              className={buttonClasses("primary", "md")}
            >
              {processing ? "Cropping…" : "Crop"}
            </button>
          </div>

          {result && (
            <div className="rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-3.5 space-y-3">
              <p className="text-sm text-text-secondary">
                Result: {result.width} × {result.height} — {formatKB(result.blob.size)}
              </p>
              <button
                type="button"
                onClick={handleDownload}
                className={buttonClasses("primary", "md")}
              >
                <DownloadSimple size={16} weight="regular" aria-hidden="true" />
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
