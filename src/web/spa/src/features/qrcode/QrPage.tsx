import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LockSimple } from "@phosphor-icons/react";
import QRCode from "qrcode";
import { Alert } from "../../components";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { useAuth } from "../../shell/AuthContext";

// ---- client-side QR code generator ----
// Duplicated in tools-site's src/QrTool.tsx — the two apps never import from
// each other, so the small generator logic is carried in both places.

type EcLevel = "L" | "M" | "Q" | "H";
const EC_LEVELS: EcLevel[] = ["L", "M", "Q", "H"];
const TOO_MUCH_DATA = "Too much data for this error-correction level — try L or shorten the text";

function qrOptions(ec: EcLevel, size: number, margin: number, fg: string, bg: string) {
  return { errorCorrectionLevel: ec, width: size, margin, color: { dark: fg, light: bg } };
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

const input = `rounded-ds-md border border-border-default bg-surface-0 px-3 text-[15px] text-text-primary placeholder:text-text-tertiary hover:border-border-hover motion-safe:transition-colors motion-safe:duration-150 ${focusRing}`;
const card = "space-y-3 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-3.5";
const labelCls = "flex items-center gap-2 text-sm font-semibold text-text-primary";

const QrPage: React.FC = () => {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [ec, setEc] = useState<EcLevel>("M");
  const [size, setSize] = useState(256);
  const [margin, setMargin] = useState(4);
  const [fg, setFg] = useState("#000000");
  const [bg, setBg] = useState("#ffffff");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const byteLength = useMemo(() => new TextEncoder().encode(text).length, [text]);
  const sameColor = fg.toLowerCase() === bg.toLowerCase();
  const hasText = text.length > 0;

  // Debounced live preview. The canvas stays mounted whenever the form is
  // shown (CLAUDE.md gotcha #4) and is hidden with CSS when nothing is valid.
  useEffect(() => {
    if (!user) return;
    if (!hasText) {
      setReady(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        await QRCode.toCanvas(canvas, text, qrOptions(ec, size, margin, fg, bg));
        if (cancelled) return;
        setReady(true);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setReady(false);
        const msg = err instanceof Error ? err.message : "";
        setError(/too big|capacity|data/i.test(msg) ? TOO_MUCH_DATA : msg || "Could not generate a QR code.");
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [user, text, hasText, ec, size, margin, fg, bg]);

  const canAct = hasText && ready && !error;

  const handlePng = async () => {
    const url = await QRCode.toDataURL(text, qrOptions(ec, size, margin, fg, bg));
    const blob = await (await fetch(url)).blob();
    downloadBlob(blob, "qrcode.png");
  };

  const handleSvg = async () => {
    const svg = await QRCode.toString(text, { ...qrOptions(ec, size, margin, fg, bg), type: "svg" });
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

  const srTitle = <h1 className="sr-only">QR Codes</h1>;

  if (!user) {
    return (
      <div className="space-y-4">
        {srTitle}
        <div className="flex flex-wrap items-center gap-4 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <LockSimple size={26} weight="regular" aria-hidden="true" className="text-accent-text" />
          <div className="min-w-[220px] flex-1">
            <div className="font-bold text-text-primary">Sign in to generate QR codes</div>
            <div className="text-sm text-text-secondary">Generated locally — nothing ever leaves your browser.</div>
          </div>
          <Link to="/auth" className={buttonClasses("primary", "md")}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {srTitle}
      <p className="text-sm text-text-secondary">Generated locally — nothing ever leaves your browser.</p>

      <div className={card}>
        <textarea
          aria-label="Text or URL to encode"
          placeholder="Paste a URL or type any text…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className={`${input} w-full resize-y py-3 font-mono text-[13px]`}
        />
        <p className="text-[13px] text-text-secondary">
          {byteLength} byte{byteLength === 1 ? "" : "s"}
        </p>
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className={labelCls}>
            Error correction
            <select value={ec} onChange={(e) => setEc(e.target.value as EcLevel)} className={`${input} min-h-10`}>
              {EC_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            Foreground
            <input type="color" value={fg} onChange={(e) => setFg(e.target.value)} className={`h-10 w-12 cursor-pointer ${focusRing}`} />
          </label>
          <label className={labelCls}>
            Background
            <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className={`h-10 w-12 cursor-pointer ${focusRing}`} />
          </label>
        </div>
        <div>
          <label htmlFor="qr-size" className="mb-2 flex justify-between text-sm font-semibold text-text-primary">
            <span>Size</span>
            <span className="font-mono text-accent-text">{size}px</span>
          </label>
          <input
            id="qr-size"
            type="range"
            min={128}
            max={1024}
            step={32}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className={`h-6 w-full accent-[rgb(var(--color-accent))] ${focusRing}`}
          />
        </div>
        <div>
          <label htmlFor="qr-margin" className="mb-2 flex justify-between text-sm font-semibold text-text-primary">
            <span>Margin</span>
            <span className="font-mono text-accent-text">{margin}</span>
          </label>
          <input
            id="qr-margin"
            type="range"
            min={0}
            max={10}
            value={margin}
            onChange={(e) => setMargin(Number(e.target.value))}
            className={`h-6 w-full accent-[rgb(var(--color-accent))] ${focusRing}`}
          />
        </div>
      </div>

      {sameColor && (
        <p className="text-sm text-warning">Foreground and background are the same colour — the code won&apos;t be scannable.</p>
      )}
      {error && <Alert variant="error">{error}</Alert>}
      {!hasText && <p className="text-sm text-text-tertiary">Enter some text above to generate a QR code.</p>}

      <canvas
        ref={canvasRef}
        aria-label="QR code preview"
        className={canAct ? "block h-auto max-w-full rounded-ds-md" : "hidden"}
      />

      <div className="flex flex-wrap gap-2.5">
        <button type="button" onClick={handlePng} disabled={!canAct} className={buttonClasses("primary", "lg")}>
          Download PNG
        </button>
        <button type="button" onClick={handleSvg} disabled={!canAct} className={buttonClasses("secondary", "lg")}>
          Download SVG
        </button>
        {canCopyImage && (
          <button type="button" onClick={handleCopy} disabled={!canAct} className={buttonClasses("secondary", "lg")}>
            {copied ? "Copied!" : "Copy image"}
          </button>
        )}
      </div>
    </div>
  );
};

export default QrPage;
