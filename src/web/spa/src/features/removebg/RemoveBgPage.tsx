import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DownloadSimple, LockSimple } from "@phosphor-icons/react";
import { Alert } from "../../components";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { useAuth } from "../../shell/AuthContext";
import { saveBlob } from "../../utils/saveFile";

// ---- client-side background removal ----
// Uses @imgly/background-removal (onnxruntime-wasm under the hood).
// Fully client-side — images never leave the browser: the file is decoded
// into a canvas, re-encoded to a Blob, handed to the library, and the
// resulting PNG never crosses the network. The one thing that DOES cross
// the network is the ~54MB segmentation model + wasm runtime, one time —
// and that's fetched from our own origin (see publicPath below), not
// IMG.LY's CDN. See scripts/fetch-imgly-assets.js, which pulls those files
// from IMG.LY's CDN at BUILD time and drops them in public/imgly/ so vite
// ships them from our own dist/.
// Duplicated in the tools-site app's src/RemoveBgTool.tsx — the two
// frontends deliberately don't import from each other (see the note atop
// src/web/tools-site/src/api.ts), so the small processing functions are
// carried in each place.

// Background removal holds several full-resolution buffers at once (source
// tensor, alpha mask, RGBA output), so this is lower than the other image
// tools' 8192 cap — keeps memory sane on mobile for a 4000px+ photo.
const MAX_DIMENSION = 4096;

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

function formatKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Maps the library's coarse compute:* progress keys to a friendly label.
const STEP_LABELS: Record<string, string> = {
  "compute:decode": "Decoding image…",
  "compute:inference": "Running the segmentation model…",
  "compute:mask": "Building the mask…",
  "compute:encode": "Encoding result…"
};

type Phase = "idle" | "downloading" | "processing" | "done" | "error";

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

interface FetchProgress {
  current: number;
  total: number;
}

const RemoveBgPage: React.FC = () => {
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [meta, setMeta] = useState<ImgMeta | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [downloadProgress, setDownloadProgress] = useState<Record<string, FetchProgress>>({});
  const [stepLabel, setStepLabel] = useState<string>("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = phase === "downloading" || phase === "processing";

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file || busy) return;
    setError(null);
    setPhase("idle");
    setDownloadProgress({});
    setStepLabel("");
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

  const handleRemove = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !meta || busy) return;
    setError(null);
    setDownloadProgress({});
    setStepLabel("");
    setPhase("downloading");
    try {
      const sourceBlob = await encodeCanvas(canvas, "image/png");
      const { removeBackground } = await import("@imgly/background-removal");
      const outBlob = await removeBackground(sourceBlob, {
        // Same-origin assets built by scripts/fetch-imgly-assets.js — never
        // IMG.LY's CDN. Trailing slash matters: it's resolved as a base URL.
        publicPath: `${window.location.origin}/imgly/`,
        model: "isnet_quint8", // the "small" model — smaller download, good enough for a hobby tool
        device: "cpu", // we only self-host the plain (non-WebGPU) wasm runtime
        output: { format: "image/png" },
        progress: (key: string, current: number, total: number) => {
          if (key.startsWith("fetch:")) {
            setPhase("downloading");
            setDownloadProgress((prev) => ({ ...prev, [key]: { current, total } }));
          } else {
            setPhase("processing");
            setStepLabel(STEP_LABELS[key] ?? "Processing…");
          }
        }
      });
      setResult((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { blob: outBlob, url: URL.createObjectURL(outBlob), width: meta.width, height: meta.height };
      });
      setPhase("done");
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not remove the background: ${err.message}`
          : "Could not remove the background from that image."
      );
      setPhase("error");
    }
  };

  const handleDownload = () => {
    if (!result) return;
    void saveBlob(result.blob, "background-removed.png").catch((e) => setError(e instanceof Error ? e.message : "Could not save the file."));
  };

  const progressEntries = Object.values(downloadProgress);
  const downloadedBytes = progressEntries.reduce((sum, p) => sum + p.current, 0);
  const totalBytes = progressEntries.reduce((sum, p) => sum + p.total, 0);
  const downloadPct = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;

  if (!user) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">Sign in to use the background removal tool.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Remove Background</h1>
      <p className="text-sm text-text-secondary">
        Processed locally — images never leave your browser. The segmentation model (~54 MB)
        downloads once from this site and is cached by your browser after that.
      </p>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-3.5 space-y-3">
        <label htmlFor="removebg-file" className="block text-[13px] font-semibold text-text-primary">
          Choose an image
        </label>
        <input
          id="removebg-file"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          disabled={busy}
          className={`block w-full text-sm text-text-secondary file:mr-3 file:cursor-pointer file:rounded-ds-md file:border-0 file:bg-accent file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-on-accent hover:file:bg-accent-600 motion-safe:file:transition-colors rounded-ds-md ${focusRing} disabled:opacity-50`}
        />
      </div>

      {/* Always mounted: handleFileChange draws in here before meta exists,
          so unmounting it while empty would leave canvasRef.current null on
          the first file pick. */}
      <div
        className="relative inline-block max-w-full overflow-hidden rounded-ds-lg border border-border-default bg-surface-1 leading-none"
        style={{ display: meta ? undefined : "none" }}
      >
        <canvas ref={canvasRef} className="block max-w-full h-auto" />
      </div>

      {meta && (
        <>
          {meta.downscaled && (
            <Alert variant="error">
              This image was larger than {MAX_DIMENSION}px on its long edge and was downscaled to fit.
            </Alert>
          )}

          <p className="text-xs text-text-tertiary">
            Original: {meta.width} × {meta.height} — {formatKB(meta.fileSize)}
          </p>

          <div className="rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-3.5">
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className={buttonClasses("primary", "md")}
            >
              {busy ? "Working…" : "Remove Background"}
            </button>
          </div>

          {phase === "downloading" && (
            <div className="rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-3.5 space-y-2">
              <p className="text-sm text-text-secondary">
                {totalBytes > 0
                  ? `Downloading segmentation model (one-time) — ${formatMB(downloadedBytes)} of ${formatMB(totalBytes)}`
                  : "Downloading segmentation model (one-time)…"}
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-accent motion-safe:transition-all motion-safe:duration-200"
                  style={{ width: `${downloadPct}%` }}
                />
              </div>
            </div>
          )}

          {phase === "processing" && (
            <div className="rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-3.5">
              <p className="text-sm text-text-secondary">{stepLabel || "Processing…"}</p>
            </div>
          )}

          {result && (
            <div className="rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-3.5 space-y-3">
              <div
                className="inline-block max-w-full overflow-hidden rounded-ds-lg border border-border-default leading-none"
                style={{
                  backgroundImage:
                    "linear-gradient(45deg, #444 25%, transparent 25%), linear-gradient(-45deg, #444 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #444 75%), linear-gradient(-45deg, transparent 75%, #444 75%)",
                  backgroundSize: "20px 20px",
                  backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
                  backgroundColor: "#2a2a2a"
                }}
              >
                <img src={result.url} alt="Background removed" className="block max-w-full h-auto" />
              </div>
              <p className="text-sm text-text-secondary">
                Result: {result.width} × {result.height} — {formatKB(result.blob.size)} — PNG
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

export default RemoveBgPage;
