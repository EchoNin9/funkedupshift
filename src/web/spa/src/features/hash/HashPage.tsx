import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LockSimple } from "@phosphor-icons/react";
import { Alert, CopyButton } from "../../components";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { SegmentedControl } from "../../components/SegmentedControl";
import { useAuth } from "../../shell/AuthContext";
import {
  digestAll, encodeUtf8, format, generate, hmacSha256, matchChecksum, readFileBytes,
  type GenKind, type HashResult, type OutFormat,
} from "./hashing";

type Tab = "hash" | "generate";
const TABS: { id: Tab; label: string }[] = [
  { id: "hash", label: "Hash" },
  { id: "generate", label: "Generate" },
];
const FORMATS: { id: OutFormat; label: string }[] = [
  { id: "hex", label: "Hex" },
  { id: "base64", label: "Base64" },
];
const KINDS: { id: GenKind; label: string }[] = [
  { id: "uuid4", label: "UUID v4" },
  { id: "uuid7", label: "UUID v7" },
  { id: "ulid", label: "ULID" },
];

const cardClass = "space-y-3.5 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-3.5 sm:p-4";
const labelClass = "block text-[13px] font-semibold text-text-secondary";
const areaClass = `w-full rounded-ds-md border border-divider bg-surface-1 p-2.5 font-mono text-[13px] text-text-primary ${focusRing}`;
const inputClass = `rounded-ds-md border border-divider bg-surface-1 px-2.5 py-2 text-sm text-text-primary ${focusRing}`;

const ValueRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-2">
      <span className={labelClass}>{label}</span>
      <CopyButton text={value} />
    </div>
    <div className="break-all rounded-ds-md border border-divider bg-surface-1 p-2.5 font-mono text-[13px] text-text-primary">{value}</div>
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
      className={cardClass}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        pickFile(e.dataTransfer.files[0]);
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="hash-text" className={labelClass}>
          Text (hashed as UTF-8)
        </label>
        <textarea id="hash-text" value={text} disabled={!!file} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={5} className={areaClass} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-text-secondary">
          Or choose / drop a file (max 1 GB):{" "}
          <input type="file" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {file && (
          <button type="button" className={buttonClasses("secondary", "md")} onClick={() => setFile(null)}>
            Clear file ({file.name})
          </button>
        )}
      </div>
      {progress !== null && <p className="text-sm text-text-secondary" role="status">Reading file… {progress}%</p>}
      {error && <Alert variant="error">{error}</Alert>}

      <SegmentedControl options={FORMATS} value={fmt} onChange={setFmt} ariaLabel="Output format" size="sm" />
      {results.map((r) => (
        <ValueRow key={r.label} label={r.label} value={format(r.bytes, fmt)} />
      ))}

      <div className="space-y-1.5">
        <label htmlFor="hash-expected" className={labelClass}>
          Compare with an expected checksum
        </label>
        <input id="hash-expected" type="text" value={expected} onChange={(e) => setExpected(e.target.value)} spellCheck={false} className={`w-full font-mono ${inputClass}`} />
      </div>
      {matched !== undefined && (
        <div role="status">
          <Alert variant={matched ? "success" : "error"}>{matched ? `Match (${matched})` : "No match"}</Alert>
        </div>
      )}

      <h2 className="pt-2 text-base font-bold text-text-primary">HMAC-SHA256</h2>
      <div className="space-y-1.5">
        <label htmlFor="hmac-msg" className={labelClass}>
          Message
        </label>
        <textarea id="hmac-msg" value={hmacMsg} onChange={(e) => setHmacMsg(e.target.value)} spellCheck={false} rows={3} className={areaClass} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="hmac-key" className={labelClass}>
          Key
        </label>
        <input id="hmac-key" type="text" value={hmacKey} onChange={(e) => setHmacKey(e.target.value)} spellCheck={false} className={`w-full font-mono ${inputClass}`} />
      </div>
      {hmac && <ValueRow label={`HMAC-SHA256 (${fmt === "hex" ? "Hex" : "Base64"})`} value={format(hmac, fmt)} />}
    </div>
  );
};

const GeneratePanel: React.FC = () => {
  const [kind, setKind] = useState<GenKind>("uuid4");
  const [count, setCount] = useState(1);
  const [out, setOut] = useState<string[]>([]);
  const clamp = (n: number) => Math.min(100, Math.max(1, Math.floor(n) || 1));
  return (
    <div className={cardClass}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1.5">
          <span className={labelClass}>Type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as GenKind)} className={inputClass}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className={labelClass}>Count (1–100)</span>
          <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} onBlur={() => setCount(clamp(count))} className={`w-24 ${inputClass}`} />
        </label>
        <button type="button" className={buttonClasses("primary", "md")} onClick={() => { setCount(clamp(count)); setOut(generate(kind, count)); }}>
          Generate
        </button>
      </div>
      {out.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className={labelClass}>Output</span>
            <CopyButton text={out.join("\n")} label="Copy all" />
          </div>
          <textarea readOnly aria-label="Generated IDs" value={out.join("\n")} rows={Math.min(14, out.length + 1)} className={areaClass} />
        </div>
      )}
    </div>
  );
};

export default function HashPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("hash");

  const srTitle = <h1 className="sr-only">Hash &amp; UUID</h1>;

  if (!user) {
    return (
      <div className="space-y-4">
        {srTitle}
        <div className="flex flex-wrap items-center gap-4 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <LockSimple size={26} weight="regular" aria-hidden="true" className="text-accent-text" />
          <div className="min-w-[220px] flex-1">
            <div className="font-bold text-text-primary">Sign in to hash and generate IDs</div>
            <div className="text-sm text-text-secondary">Runs locally — nothing ever leaves your browser.</div>
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
      <p className="text-sm text-text-secondary">Runs locally — nothing leaves your browser.</p>
      <SegmentedControl options={TABS} value={tab} onChange={setTab} ariaLabel="Hash or generate" />
      {tab === "hash" && <HashPanel />}
      {tab === "generate" && <GeneratePanel />}
    </div>
  );
}
