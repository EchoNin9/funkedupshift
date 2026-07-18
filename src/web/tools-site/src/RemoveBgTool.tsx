import React, { useEffect, useRef, useState } from "react";

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
// Duplicated in the SPA's src/features/removebg/RemoveBgPage.tsx — the two
// frontends deliberately don't import from each other (see the note atop
// api.ts), so the small processing functions are carried in each place.

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

interface Props {
  onBack: () => void;
}

const RemoveBgTool: React.FC<Props> = ({ onBack }) => {
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
    const a = document.createElement("a");
    a.href = result.url;
    a.download = "background-removed.png";
    a.click();
  };

  const progressEntries = Object.values(downloadProgress);
  const downloadedBytes = progressEntries.reduce((sum, p) => sum + p.current, 0);
  const totalBytes = progressEntries.reduce((sum, p) => sum + p.total, 0);
  const downloadPct = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;

  return (
    <section className="tool-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="tool-heading">Remove Background</h1>
      <p className="muted local-notice">
        Processed locally — images never leave your browser. The segmentation model
        (~54 MB) downloads once from this site and is cached by your browser after that.
      </p>

      <div className="imgtool-field">
        <label htmlFor="removebg-file">Choose an image</label>
        <input id="removebg-file" type="file" accept="image/*" onChange={handleFileChange} disabled={busy} />
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {/* Always mounted: handleFileChange draws in here before meta exists,
          so unmounting it while empty would leave canvasRef.current null on
          the first file pick. */}
      <div className="imgtool-canvas-wrap" style={{ display: meta ? undefined : "none" }}>
        <canvas ref={canvasRef} className="imgtool-canvas" />
      </div>

      {meta && (
        <>
          {meta.downscaled && (
            <div className="banner banner-warn">
              This image was larger than {MAX_DIMENSION}px on its long edge and was downscaled to fit.
            </div>
          )}

          <p className="muted imgtool-before">
            Original: {meta.width} × {meta.height} — {formatKB(meta.fileSize)}
          </p>

          <div className="imgtool-controls">
            <button type="button" className="btn btn-primary" onClick={handleRemove} disabled={busy}>
              {busy ? "Working…" : "Remove Background"}
            </button>
          </div>

          {phase === "downloading" && (
            <div className="banner banner-info">
              <p>
                {totalBytes > 0
                  ? `Downloading segmentation model (one-time) — ${formatMB(downloadedBytes)} of ${formatMB(totalBytes)}`
                  : "Downloading segmentation model (one-time)…"}
              </p>
              <div className="imgtool-progress-track">
                <div className="imgtool-progress-fill" style={{ width: `${downloadPct}%` }} />
              </div>
            </div>
          )}

          {phase === "processing" && (
            <div className="banner banner-info">
              <p>{stepLabel || "Processing…"}</p>
            </div>
          )}

          {result && (
            <div className="imgtool-result">
              <div className="imgtool-checkerboard">
                <img src={result.url} alt="Background removed" />
              </div>
              <p>
                Result: {result.width} × {result.height} — {formatKB(result.blob.size)} — PNG
              </p>
              <button type="button" className="btn btn-primary" onClick={handleDownload}>
                Download
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default RemoveBgTool;
