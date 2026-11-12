import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LockSimple } from "@phosphor-icons/react";
import { Alert, CopyButton } from "../../components";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { SegmentedControl } from "../../components/SegmentedControl";
import { useAuth } from "../../shell/AuthContext";
import { bytesToBase64, decodeBase64Text, decodeUrlText, encodeBase64Text, parseJwt } from "./codec";

// ponytail: file -> Base64 is capped at 5 MB; the whole file is read into memory and btoa'd on the main thread.
const MAX_FILE_BYTES = 5 * 1024 * 1024;

type Tab = "jwt" | "base64" | "url";
const TABS: { id: Tab; label: string }[] = [
  { id: "jwt", label: "JWT" },
  { id: "base64", label: "Base64" },
  { id: "url", label: "URL" },
];

const cardClass = "space-y-3.5 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-3.5 sm:p-4";
const labelClass = "block text-[13px] font-semibold text-text-secondary";
const areaClass = `w-full rounded-ds-md border border-divider bg-surface-1 p-2.5 font-mono text-[13px] text-text-primary ${focusRing}`;

const Output: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-2">
      <span className={labelClass}>{label}</span>
      <CopyButton text={value} />
    </div>
    <textarea readOnly aria-label={label} value={value} rows={Math.min(14, value.split("\n").length + 1)} className={areaClass} />
  </div>
);

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
    <div className={cardClass}>
      <div className="space-y-1.5">
        <label htmlFor={inputId} className={labelClass}>
          Input
        </label>
        <textarea id={inputId} value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} rows={6} className={areaClass} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {actions.map((a) => (
          <button key={a.label} type="button" className={buttonClasses("primary", "md")} onClick={() => run(a.run)}>
            {a.label}
          </button>
        ))}
        {extra}
        {fileHandler && (
          <label className="text-sm text-text-secondary">
            File to Base64 (max 5 MB): <input type="file" onChange={onFile} />
          </label>
        )}
      </div>
      {result.error && <Alert variant="error">{result.error}</Alert>}
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
    <div className={cardClass}>
      <div className="space-y-1.5">
        <label htmlFor="enc-jwt" className={labelClass}>
          JWT
        </label>
        <textarea id="enc-jwt" value={token} onChange={(e) => setToken(e.target.value)} spellCheck={false} rows={6} className={areaClass} />
      </div>
      <p className="text-sm text-text-secondary">Signature is not verified.</p>
      {parsed && "error" in parsed && <Alert variant="error">{parsed.error}</Alert>}
      {ok && (
        <>
          {ok.status && <p className="font-semibold text-text-primary">{ok.status}</p>}
          <Output label="Header" value={ok.header} />
          <Output label="Payload" value={ok.payload} />
          {ok.times.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-text-primary">
                <thead>
                  <tr className="text-text-secondary">
                    <th className="py-1 pr-3">Claim</th>
                    <th className="py-1 pr-3">Local time</th>
                    <th className="py-1">UTC</th>
                  </tr>
                </thead>
                <tbody>
                  {ok.times.map((t) => (
                    <tr key={t.claim}>
                      <td className="py-1 pr-3 font-mono">{t.claim}</td>
                      <td className="py-1 pr-3">{t.local}</td>
                      <td className="py-1 font-mono">{t.utc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={urlSafe} onChange={(e) => setUrlSafe(e.target.checked)} /> URL-safe
        </label>
      }
      fileHandler={fileToBase64}
    />
  );
};

export default function EncodePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("jwt");

  const srTitle = <h1 className="sr-only">Encode / Decode</h1>;

  if (!user) {
    return (
      <div className="space-y-4">
        {srTitle}
        <div className="flex flex-wrap items-center gap-4 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <LockSimple size={26} weight="regular" aria-hidden="true" className="text-accent-text" />
          <div className="min-w-[220px] flex-1">
            <div className="font-bold text-text-primary">Sign in to encode and decode</div>
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
      <SegmentedControl options={TABS} value={tab} onChange={setTab} ariaLabel="Encoding type" />
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
    </div>
  );
}
