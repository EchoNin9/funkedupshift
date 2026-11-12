import React, { useMemo, useState } from "react";
import { bytesToBase64, decodeBase64Text, decodeUrlText, encodeBase64Text, parseJwt } from "./codec";

// ponytail: file -> Base64 is capped at 5 MB; the whole file is read into memory and btoa'd on the main thread.
const MAX_FILE_BYTES = 5 * 1024 * 1024;

type Tab = "jwt" | "base64" | "url";
const TABS: { id: Tab; label: string }[] = [
  { id: "jwt", label: "JWT" },
  { id: "base64", label: "Base64" },
  { id: "url", label: "URL" },
];

interface Props {
  onBack: () => void;
}

const Output: React.FC<{ label: string; value: string }> = ({ label, value }) => {
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
    <div className="textshare-form">
      <div className="textshare-controls">
        <strong>{label}</strong>
        <button type="button" className="btn btn-ghost" onClick={copy}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <textarea readOnly value={value} rows={Math.min(14, value.split("\n").length + 1)} aria-label={label} />
    </div>
  );
};

interface Result {
  text: string;
  error: string | null;
}

/** Shared by the Base64 and URL tabs: input + actions computed on click, never per keystroke. */
const TextPanel: React.FC<{
  inputId: string;
  actions: { label: string; run: (input: string) => string }[];
  extra?: React.ReactNode;
  fileHandler?: (file: File) => Promise<string>;
}> = ({ inputId, actions, extra, fileHandler }) => {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<Result>({ text: "", error: null });

  const run = (fn: (s: string) => string) => {
    if (input === "") return setResult({ text: "", error: null });
    try {
      setResult({ text: fn(input), error: null });
    } catch (e) {
      setResult({ text: "", error: e instanceof Error ? e.message : "Something went wrong." });
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !fileHandler) return;
    try {
      setResult({ text: await fileHandler(file), error: null });
    } catch (err) {
      setResult({ text: "", error: err instanceof Error ? err.message : "Could not read the file." });
    }
  };

  return (
    <div className="conv-panel">
      <div className="textshare-form">
        <label htmlFor={inputId}>Input</label>
        <textarea id={inputId} value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
      </div>
      <div className="textshare-controls">
        {actions.map((a) => (
          <button key={a.label} type="button" className="btn btn-primary" onClick={() => run(a.run)}>
            {a.label}
          </button>
        ))}
        {extra}
        {fileHandler && (
          <label className="muted">
            File to Base64 (max 5 MB): <input type="file" onChange={onFile} />
          </label>
        )}
      </div>
      {result.error && <div className="banner banner-error">{result.error}</div>}
      {result.text !== "" && <Output label="Output" value={result.text} />}
    </div>
  );
};

const JwtPanel: React.FC = () => {
  const [token, setToken] = useState("");
  const parsed = useMemo(() => {
    if (token.trim() === "") return null;
    try {
      return { ok: parseJwt(token) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Could not decode the token." };
    }
  }, [token]);
  const ok = parsed && "ok" in parsed ? parsed.ok : null;

  return (
    <div className="conv-panel">
      <div className="textshare-form">
        <label htmlFor="enc-jwt">JWT</label>
        <textarea id="enc-jwt" value={token} onChange={(e) => setToken(e.target.value)} spellCheck={false} />
      </div>
      <p className="muted">Signature is not verified.</p>
      {parsed && "error" in parsed && <div className="banner banner-error">{parsed.error}</div>}
      {ok && (
        <>
          {ok.status && <p><strong>{ok.status}</strong></p>}
          <Output label="Header" value={ok.header} />
          <Output label="Payload" value={ok.payload} />
          {ok.times.length > 0 && (
            <table className="dns-table">
              <thead>
                <tr><th>Claim</th><th>Local time</th><th>UTC</th></tr>
              </thead>
              <tbody>
                {ok.times.map((t) => (
                  <tr key={t.claim}>
                    <td>{t.claim}</td>
                    <td>{t.local}</td>
                    <td className="dns-value">{t.utc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Output label="Signature (raw)" value={ok.signature} />
        </>
      )}
    </div>
  );
};

const Base64Panel: React.FC = () => {
  const [urlSafe, setUrlSafe] = useState(false);
  const fileToBase64 = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) throw new Error("File is too large: the limit is 5 MB.");
    return bytesToBase64(new Uint8Array(await file.arrayBuffer()), urlSafe);
  };
  return (
    <TextPanel
      inputId="enc-b64"
      actions={[
        { label: "Encode", run: (s) => encodeBase64Text(s, urlSafe) },
        { label: "Decode", run: decodeBase64Text },
      ]}
      extra={
        <label>
          <input type="checkbox" checked={urlSafe} onChange={(e) => setUrlSafe(e.target.checked)} /> URL-safe
        </label>
      }
      fileHandler={fileToBase64}
    />
  );
};

const EncodeTool: React.FC<Props> = ({ onBack }) => {
  const [tab, setTab] = useState<Tab>("jwt");
  return (
    <section className="tool-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="tool-heading">Encode / Decode</h1>
      <p className="muted local-notice">Everything below runs locally — nothing leaves your browser.</p>

      <div className="conv-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`conv-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "jwt" && <JwtPanel />}
      {tab === "base64" && <Base64Panel />}
      {tab === "url" && (
        <TextPanel
          inputId="enc-url"
          actions={[
            { label: "Encode", run: encodeURIComponent },
            { label: "Decode", run: decodeUrlText },
          ]}
        />
      )}
    </section>
  );
};

export default EncodeTool;
