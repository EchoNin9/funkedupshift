import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

// ---- client-side QR code generator ----
// Duplicated in the SPA's src/features/qrcode/QrPage.tsx — this app
// deliberately does not import from src/web/spa (see the note atop api.ts),
// so the small generator logic is carried in both places.

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

interface Props {
  onBack: () => void;
}

const QrTool: React.FC<Props> = ({ onBack }) => {
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

  // Debounced live preview. The canvas stays mounted at all times (CLAUDE.md
  // gotcha #4) and is hidden with CSS when there is nothing valid to show.
  useEffect(() => {
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
  }, [text, hasText, ec, size, margin, fg, bg]);

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

  return (
    <section className="tool-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="tool-heading">QR Codes</h1>
      <p className="muted local-notice">Generated locally — nothing ever leaves your browser.</p>

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
                {l}
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

      <div className="pwgen-field">
        <label htmlFor="qr-size">Size: {size}px</label>
        <input id="qr-size" type="range" min={128} max={1024} step={32} value={size} onChange={(e) => setSize(Number(e.target.value))} />
      </div>
      <div className="pwgen-field">
        <label htmlFor="qr-margin">Margin: {margin} modules</label>
        <input id="qr-margin" type="range" min={0} max={10} value={margin} onChange={(e) => setMargin(Number(e.target.value))} />
      </div>

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
      </div>
    </section>
  );
};

export default QrTool;
