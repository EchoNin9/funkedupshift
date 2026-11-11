import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { isAuthError, saveQr } from "./api";

// ---- client-side QR code generator ----
// Duplicated in the SPA's src/features/qrcode/QrPage.tsx — this app
// deliberately does not import from src/web/spa (see the note atop api.ts),
// so the small generator logic is carried in both places.

type EcLevel = "L" | "M" | "Q" | "H";
const EC_LEVELS: EcLevel[] = ["L", "M", "Q", "H"];
const EC_INFO: Record<EcLevel, { label: string; hint: string }> = {
  L: { label: "L — Low (~7% recoverable)", hint: "Smallest code; best for clean, on-screen environments." },
  M: { label: "M — Medium (~15%)", hint: "Good default for most uses." },
  Q: { label: "Q — Quartile (~25%)", hint: "Better for printed or handled codes." },
  H: { label: "H — High (~30%)", hint: "Most robust — best with a logo or background image." },
};
const TOO_MUCH_DATA = "Too much data for this error-correction level — try L or shorten the text";
const MAX_IMAGE_DIM = 1024;
const SCAN_NOTE = "Test-scan before printing — busy images can make codes unreadable.";

type Source = HTMLCanvasElement;

interface Matrix {
  size: number;
  get(row: number, col: number): number;
}

interface Spec {
  matrix: Matrix;
  size: number;
  margin: number;
  fg: string;
  bg: string;
  image: Source | null;
  /** 0-100: how much of the image shows through the light modules. */
  visibility: number;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const canCopyImage = typeof ClipboardItem !== "undefined" && !!navigator.clipboard?.write;

function bgAlpha(spec: Spec): number {
  return spec.image ? 1 - spec.visibility / 100 : 1;
}

/** Draw the code on `canvas`: bg, optional cover-fit image, bg wash over
 * quiet zone + light modules, then opaque dark modules. */
function drawQr(canvas: HTMLCanvasElement, spec: Spec) {
  const { matrix, size, margin, fg, bg, image } = spec;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser.");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  if (image) {
    const scale = Math.max(size / image.width, size / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
    ctx.globalAlpha = bgAlpha(spec);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 1;
  }
  const total = matrix.size + margin * 2;
  const edge = (i: number) => Math.round((i * size) / total);
  ctx.fillStyle = fg;
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) {
      if (!matrix.get(r, c)) continue;
      const x0 = edge(c + margin);
      const y0 = edge(r + margin);
      ctx.fillRect(x0, y0, edge(c + margin + 1) - x0, edge(r + margin + 1) - y0);
    }
  }
}

/** SVG with the image embedded as a data URL (slice = cover) and dark
 * modules as merged horizontal runs. */
function buildImageSvg(spec: Spec): string {
  const { matrix, size, margin, fg, bg, image } = spec;
  const total = matrix.size + margin * 2;
  let imageTag = "";
  if (image) {
    const flat = document.createElement("canvas");
    flat.width = image.width;
    flat.height = image.height;
    const fctx = flat.getContext("2d");
    if (fctx) {
      fctx.fillStyle = bg;
      fctx.fillRect(0, 0, flat.width, flat.height);
      fctx.drawImage(image, 0, 0);
    }
    const href = flat.toDataURL("image/jpeg", 0.9);
    imageTag =
      `<image href="${href}" x="0" y="0" width="${total}" height="${total}" preserveAspectRatio="xMidYMid slice"/>` +
      `<rect width="${total}" height="${total}" fill="${bg}" fill-opacity="${bgAlpha(spec)}"/>`;
  }
  let path = "";
  for (let r = 0; r < matrix.size; r++) {
    let c = 0;
    while (c < matrix.size) {
      if (!matrix.get(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < matrix.size && matrix.get(r, c)) c++;
      path += `M${start + margin} ${r + margin}h${c - start}v1h-${c - start}z`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${bg}"/>${imageTag}<path d="${path}" fill="${fg}"/></svg>`
  );
}

/** Decode a user-picked file and downscale (cover-agnostic, aspect kept) so
 * huge photos don't stall rendering. Everything stays in the browser. */
async function loadImage(file: File): Promise<Source> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");
  let bitmap: CanvasImageSource & { width: number; height: number; close?: () => void };
  let objectUrl: string | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(file);
    } else {
      objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      bitmap = img;
    }
  } catch {
    throw new Error("Couldn't read that image — try a PNG or JPEG.");
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

/** A short link the QR tool is bound to (set when opened from the shortener). */
export interface QrLink {
  code: string;
  shortUrl: string;
}

interface Props {
  onBack: () => void;
  /** When set: text is prefilled with link.shortUrl and a "Save to link" action appears. */
  link?: QrLink | null;
  onAuthError?: () => void;
}

const QrTool: React.FC<Props> = ({ onBack, link = null, onAuthError }) => {
  const [text, setText] = useState(link?.shortUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [ec, setEc] = useState<EcLevel>("M");
  const [size, setSize] = useState(256);
  const [margin, setMargin] = useState(4);
  const [fg, setFg] = useState("#000000");
  const [bg, setBg] = useState("#ffffff");
  const [image, setImage] = useState<Source | null>(null);
  const [visibility, setVisibility] = useState(30);
  const [imageError, setImageError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadToken = useRef(0);

  const byteLength = useMemo(() => new TextEncoder().encode(text).length, [text]);
  const sameColor = fg.toLowerCase() === bg.toLowerCase();
  const hasText = text.length > 0;

  // Debounced live preview. The canvas stays mounted at all times (CLAUDE.md
  // gotcha #4) and is hidden with CSS when there is nothing valid to show.
  useEffect(() => {
    if (!hasText) {
      setReady(false);
      setError(null);
      return;
    }
    const t = window.setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        const matrix = QRCode.create(text, { errorCorrectionLevel: ec }).modules;
        drawQr(canvas, { matrix, size, margin, fg, bg, image, visibility });
        setReady(true);
        setError(null);
      } catch (err) {
        setReady(false);
        const msg = err instanceof Error ? err.message : "";
        setError(/too big|capacity|data/i.test(msg) ? TOO_MUCH_DATA : msg || "Could not generate a QR code.");
      }
    }, 150);
    return () => window.clearTimeout(t);
  }, [text, hasText, ec, size, margin, fg, bg, image, visibility]);

  const canAct = hasText && ready && !error;

  const handlePng = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) downloadBlob(blob, "qrcode.png");
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !link) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not render the QR image.");
      await saveQr(link.code, blob);
      setSaveMsg({ kind: "ok", text: "Saved to link." });
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError?.();
        return;
      }
      setSaveMsg({ kind: "error", text: err instanceof Error ? err.message : "Failed to save QR code." });
    } finally {
      setSaving(false);
    }
  };

  const handleSvg = async () => {
    let svg: string;
    if (image) {
      const matrix = QRCode.create(text, { errorCorrectionLevel: ec }).modules;
      svg = buildImageSvg({ matrix, size, margin, fg, bg, image, visibility });
    } else {
      svg = await QRCode.toString(text, {
        type: "svg",
        errorCorrectionLevel: ec,
        width: size,
        margin,
        color: { dark: fg, light: bg },
      });
    }
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "qrcode.svg");
  };

  const handleCopy = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return;
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard permission denied — the download buttons still work
    }
  };

  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    const token = ++loadToken.current;
    try {
      const img = await loadImage(file);
      if (token !== loadToken.current) return;
      setImage(img);
      setImageError(null);
      setEc("H"); // busy backgrounds need maximum error correction
    } catch (err) {
      if (token !== loadToken.current) return;
      setImageError(err instanceof Error ? err.message : "Couldn't read that image.");
    }
  };

  const removeImage = () => {
    loadToken.current++;
    setImage(null);
    setImageError(null);
  };

  return (
    <section className="tool-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="tool-heading">QR Codes</h1>
      <p className="muted local-notice">
        {link
          ? "Generated locally — the image only leaves your browser if you press Save to link."
          : "Generated locally — nothing ever leaves your browser."}
      </p>
      {link && (
        <p className="qr-saving-for">
          Saving for <code>{link.shortUrl}</code>
        </p>
      )}

      <div className="textshare-form">
        <textarea
          aria-label="Text or URL to encode"
          placeholder="Paste a URL or type any text…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <p className="muted">{byteLength} byte{byteLength === 1 ? "" : "s"}</p>

      <div className="textshare-controls">
        <label>
          Error correction{" "}
          <select value={ec} onChange={(e) => setEc(e.target.value as EcLevel)}>
            {EC_LEVELS.map((l) => (
              <option key={l} value={l}>
                {EC_INFO[l].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Foreground <input type="color" value={fg} onChange={(e) => setFg(e.target.value)} />
        </label>
        <label>
          Background <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
        </label>
      </div>
      <p className="muted">{EC_INFO[ec].hint}</p>

      <div className="pwgen-field">
        <label htmlFor="qr-size">Size: {size}px</label>
        <input id="qr-size" type="range" min={128} max={1024} step={32} value={size} onChange={(e) => setSize(Number(e.target.value))} />
      </div>
      <div className="pwgen-field">
        <label htmlFor="qr-margin">Margin: {margin} modules</label>
        <input id="qr-margin" type="range" min={0} max={10} value={margin} onChange={(e) => setMargin(Number(e.target.value))} />
      </div>

      <div className="pwgen-field">
        <label htmlFor="qr-image">Background image (optional — stays in your browser)</label>
        <input id="qr-image" type="file" accept="image/*" onChange={handleImageFile} />
      </div>
      {image && (
        <>
          <div className="pwgen-field">
            <label htmlFor="qr-visibility">Image visibility: {visibility}%</label>
            <input id="qr-visibility" type="range" min={0} max={100} value={visibility} onChange={(e) => setVisibility(Number(e.target.value))} />
          </div>
          <div className="textshare-controls">
            <button type="button" className="btn btn-ghost" onClick={removeImage}>
              Remove image
            </button>
          </div>
          <p className="muted">{SCAN_NOTE}</p>
        </>
      )}
      {imageError && <div className="banner banner-error">{imageError}</div>}

      {sameColor && (
        <div className="banner banner-warn">Foreground and background are the same colour — the code won&apos;t be scannable.</div>
      )}
      {error && <div className="banner banner-error">{error}</div>}
      {!hasText && <p className="muted">Enter some text above to generate a QR code.</p>}

      <div style={{ margin: "1rem 0" }}>
        <canvas
          ref={canvasRef}
          aria-label="QR code preview"
          style={{ display: canAct ? "block" : "none", maxWidth: "100%", height: "auto" }}
        />
      </div>

      <div className="textshare-controls">
        <button type="button" className="btn btn-primary" onClick={handlePng} disabled={!canAct}>
          Download PNG
        </button>
        <button type="button" className="btn btn-ghost" onClick={handleSvg} disabled={!canAct}>
          Download SVG
        </button>
        {canCopyImage && (
          <button type="button" className="btn btn-ghost" onClick={handleCopy} disabled={!canAct}>
            {copied ? "Copied!" : "Copy image"}
          </button>
        )}
        {link && (
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!canAct || saving}>
            {saving ? "Saving…" : "Save to link"}
          </button>
        )}
      </div>
      {saveMsg && (
        <div className={`banner ${saveMsg.kind === "ok" ? "banner-info" : "banner-error"}`} role="status">
          {saveMsg.text}
        </div>
      )}
    </section>
  );
};

export default QrTool;
