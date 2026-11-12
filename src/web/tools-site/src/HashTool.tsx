import React, { useEffect, useState } from "react";
import {
  digestAll, encodeUtf8, format, generate, hmacSha256, matchChecksum, readFileBytes,
  type GenKind, type HashResult, type OutFormat,
} from "./hashing";

type Tab = "hash" | "generate";
const TABS: { id: Tab; label: string }[] = [
  { id: "hash", label: "Hash" },
  { id: "generate", label: "Generate" },
];

interface Props {
  onBack: () => void;
}

const CopyBtn: React.FC<{ value: string; label?: string }> = ({ value, label = "Copy" }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard denied — the text is visible and selectable
    }
  };
  return (
    <button type="button" className="btn btn-ghost" onClick={copy}>
      {copied ? "Copied!" : label}
    </button>
  );
};

const FormatToggle: React.FC<{ value: OutFormat; onChange: (f: OutFormat) => void }> = ({ value, onChange }) => (
  <div className="conv-tabs" role="group" aria-label="Output format">
    {(["hex", "base64"] as OutFormat[]).map((f) => (
      <button key={f} type="button" aria-pressed={value === f} className={`conv-tab${value === f ? " active" : ""}`} onClick={() => onChange(f)}>
        {f === "hex" ? "Hex" : "Base64"}
      </button>
    ))}
  </div>
);

const HashPanel: React.FC = () => {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fmt, setFmt] = useState<OutFormat>("hex");
  const [results, setResults] = useState<HashResult[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expected, setExpected] = useState("");
  const [hmacMsg, setHmacMsg] = useState("");
  const [hmacKey, setHmacKey] = useState("");
  const [hmac, setHmac] = useState<Uint8Array | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    setProgress(null);
    (async () => {
      try {
        let bytes: Uint8Array;
        if (file) {
          setProgress(0);
          bytes = await readFileBytes(file, (p) => live && setProgress(p));
        } else if (text !== "") {
          bytes = encodeUtf8(text);
        } else {
          if (live) setResults([]);
          return;
        }
        const r = await digestAll(bytes);
        if (live) {
          setResults(r);
          setProgress(null);
        }
      } catch (e) {
        if (live) {
          setResults([]);
          setProgress(null);
          setError(e instanceof Error ? e.message : "Could not hash the input.");
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [text, file]);

  useEffect(() => {
    let live = true;
    if (hmacMsg === "" || hmacKey === "") setHmac(null);
    else hmacSha256(hmacMsg, hmacKey).then((b) => live && setHmac(b)).catch(() => live && setHmac(null));
    return () => {
      live = false;
    };
  }, [hmacMsg, hmacKey]);

  const pickFile = (f: File | undefined) => {
    if (f) setFile(f);
  };
  const matched = expected.trim() === "" || results.length === 0 ? undefined : matchChecksum(expected, results);

  return (
    <div
      className="conv-panel"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        pickFile(e.dataTransfer.files[0]);
      }}
    >
      <div className="textshare-form">
        <label htmlFor="hash-text">Text (hashed as UTF-8)</label>
        <textarea id="hash-text" value={text} disabled={!!file} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      </div>
      <div className="textshare-controls">
        <label className="muted">
          Or choose / drop a file (max 1 GB): <input type="file" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {file && (
          <button type="button" className="btn btn-ghost" onClick={() => setFile(null)}>
            Clear file ({file.name})
          </button>
        )}
      </div>
      {progress !== null && <p className="muted" role="status">Reading file… {progress}%</p>}
      {error && <div className="banner banner-error">{error}</div>}

      <FormatToggle value={fmt} onChange={setFmt} />
      {results.map((r) => {
        const v = format(r.bytes, fmt);
        return (
          <div key={r.label} className="textshare-form">
            <div className="textshare-controls">
              <strong>{r.label}</strong>
              <CopyBtn value={v} />
            </div>
            <div className="pwgen-password" style={{ wordBreak: "break-all" }}>{v}</div>
          </div>
        );
      })}

      <div className="textshare-form">
        <label htmlFor="hash-expected">Compare with an expected checksum</label>
        <input id="hash-expected" type="text" value={expected} onChange={(e) => setExpected(e.target.value)} spellCheck={false} />
      </div>
      {matched !== undefined && (
        <div className={matched ? "banner" : "banner banner-error"} role="status">
          {matched ? `Match (${matched})` : "No match"}
        </div>
      )}

      <h2>HMAC-SHA256</h2>
      <div className="textshare-form">
        <label htmlFor="hmac-msg">Message</label>
        <textarea id="hmac-msg" value={hmacMsg} onChange={(e) => setHmacMsg(e.target.value)} spellCheck={false} rows={3} />
        <label htmlFor="hmac-key">Key</label>
        <input id="hmac-key" type="text" value={hmacKey} onChange={(e) => setHmacKey(e.target.value)} spellCheck={false} />
      </div>
      {hmac && (
        <div className="textshare-form">
          <div className="textshare-controls">
            <strong>HMAC-SHA256 ({fmt === "hex" ? "Hex" : "Base64"})</strong>
            <CopyBtn value={format(hmac, fmt)} />
          </div>
          <div className="pwgen-password" style={{ wordBreak: "break-all" }}>{format(hmac, fmt)}</div>
        </div>
      )}
    </div>
  );
};

const KINDS: { id: GenKind; label: string }[] = [
  { id: "uuid4", label: "UUID v4" },
  { id: "uuid7", label: "UUID v7" },
  { id: "ulid", label: "ULID" },
];

const GeneratePanel: React.FC = () => {
  const [kind, setKind] = useState<GenKind>("uuid4");
  const [count, setCount] = useState(1);
  const [out, setOut] = useState<string[]>([]);
  const clamp = (n: number) => Math.min(100, Math.max(1, Math.floor(n) || 1));
  return (
    <div className="conv-panel">
      <div className="textshare-controls">
        <label>
          Type{" "}
          <select value={kind} onChange={(e) => setKind(e.target.value as GenKind)}>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>
        <label>
          Count (1–100){" "}
          <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} onBlur={() => setCount(clamp(count))} />
        </label>
        <button type="button" className="btn btn-primary" onClick={() => { setCount(clamp(count)); setOut(generate(kind, count)); }}>
          Generate
        </button>
      </div>
      {out.length > 0 && (
        <div className="textshare-form">
          <div className="textshare-controls">
            <strong>Output</strong>
            <CopyBtn value={out.join("\n")} label="Copy all" />
          </div>
          <textarea readOnly aria-label="Generated IDs" value={out.join("\n")} rows={Math.min(14, out.length + 1)} />
        </div>
      )}
    </div>
  );
};

const HashTool: React.FC<Props> = ({ onBack }) => {
  const [tab, setTab] = useState<Tab>("hash");
  return (
    <section className="tool-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="tool-heading">Hash &amp; UUID</h1>
      <p className="muted local-notice">Everything below runs locally — nothing leaves your browser.</p>

      <div className="conv-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`conv-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "hash" && <HashPanel />}
      {tab === "generate" && <GeneratePanel />}
    </section>
  );
};

export default HashTool;
