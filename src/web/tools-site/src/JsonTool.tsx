import React, { useEffect, useRef, useState } from "react";
import { diffValues, formatJson, jsonErrorLocation, minifyJson, sortKeysDeep, type DiffEntry } from "./datafmt";

type Tab = "format" | "diff";
const TABS: { id: Tab; label: string }[] = [
  { id: "format", label: "Format" },
  { id: "diff", label: "Diff" },
];

interface Props {
  onBack: () => void;
}

type Mode = "json" | "yaml";
type Action = "format" | "minify" | "convert";
type Indent = "2" | "4" | "tab";
type Status = { ok: true; label: string } | { ok: false; message: string };

/** Validation auto-runs only below this size; bigger inputs wait for the button. */
const AUTO_LIMIT = 200 * 1024;
const MAX_DIFF_ROWS = 500;

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/** Loaded on first YAML action so `yaml` stays out of the main bundle. */
const loadYaml = () => import("yaml");

const withLoc = (loc: { line: number; column: number } | null, msg: string) => (loc ? `Line ${loc.line}, column ${loc.column}: ${msg}` : msg);

/** Parse text as JSON or YAML into a plain value. Throws an Error whose message includes line/column when known. */
async function parseAs(text: string, mode: Mode): Promise<unknown> {
  if (text.trim() === "") throw new Error("Input is empty.");
  if (mode === "json") {
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(withLoc(jsonErrorLocation(text, e), errText(e)));
    }
  }
  const YAML = await loadYaml();
  // The library's default maxAliasCount (100) caps alias expansion ("billion laughs"); left at the default on purpose.
  const doc = YAML.parseDocument(text);
  if (doc.errors.length > 0) {
    const err = doc.errors[0];
    const pos = err.linePos?.[0];
    throw new Error(withLoc(pos ? { line: pos.line, column: pos.col } : null, err.message.split(" at line ")[0]));
  }
  return doc.toJS();
}

/** Diff inputs are auto-detected: JSON first, then YAML. */
async function parseAuto(text: string, name: string): Promise<unknown> {
  try {
    return await parseAs(text, "json");
  } catch (jsonErr) {
    try {
      return await parseAs(text, "yaml");
    } catch (yamlErr) {
      if (text.trim() === "") throw new Error(`${name} is empty.`);
      throw new Error(`${name} is not valid JSON (${errText(jsonErr)}) or YAML (${errText(yamlErr)}).`);
    }
  }
}

/** Runs one Format tab action; returns the output text and its kind. */
async function runAction(text: string, mode: Mode, action: Action, indent: Indent, sortKeys: boolean): Promise<{ out: string; kind: Mode }> {
  const ind = indent === "tab" ? "tab" : (Number(indent) as 2 | 4);
  const target: Mode = action === "convert" ? (mode === "json" ? "yaml" : "json") : action === "minify" ? "json" : mode;
  if (mode === "json" && target === "json") {
    return { out: action === "minify" ? minifyJson(text, { sortKeys }) : formatJson(text, { indent: ind, sortKeys }), kind: "json" };
  }
  let value = await parseAs(text, mode);
  if (sortKeys) value = sortKeysDeep(value);
  if (target === "json") return { out: JSON.stringify(value, null, action === "minify" ? undefined : ind === "tab" ? "\t" : ind), kind: "json" };
  const YAML = await loadYaml();
  // YAML forbids tab indentation, so "tab" falls back to 2 spaces.
  return { out: YAML.stringify(value, { indent: ind === "tab" ? 2 : ind }), kind: "yaml" };
}

function download(text: string, kind: Mode) {
  const url = URL.createObjectURL(new Blob([text], { type: kind === "json" ? "application/json" : "application/yaml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `output.${kind === "json" ? "json" : "yaml"}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const show = (v: unknown) => {
  const s = v === undefined ? "undefined" : JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
};

const CopyBtn: React.FC<{ value: string }> = ({ value }) => {
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
      {copied ? "Copied!" : "Copy"}
    </button>
  );
};

const FormatPanel: React.FC = () => {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("json");
  const [indent, setIndent] = useState<Indent>("2");
  const [sortKeys, setSortKeys] = useState(false);
  const [output, setOutput] = useState("");
  const [outKind, setOutKind] = useState<Mode>("json");
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const large = input.length >= AUTO_LIMIT;

  // Debounced validation, only while the input is small.
  useEffect(() => {
    const id = ++seq.current;
    if (input.trim() === "" || input.length >= AUTO_LIMIT) {
      setStatus(null);
      return;
    }
    const t = setTimeout(() => {
      parseAs(input, mode).then(
        () => id === seq.current && setStatus({ ok: true, label: `Valid ${mode === "json" ? "JSON" : "YAML"}` }),
        (e) => id === seq.current && setStatus({ ok: false, message: errText(e) }),
      );
    }, 300);
    return () => clearTimeout(t);
  }, [input, mode]);

  const run = async (action: Action) => {
    const id = ++seq.current;
    setBusy(true);
    try {
      const r = await runAction(input, mode, action, indent, sortKeys);
      if (id !== seq.current) return;
      setOutput(r.out);
      setOutKind(r.kind);
      setStatus({ ok: true, label: `Valid ${mode === "json" ? "JSON" : "YAML"}` });
    } catch (e) {
      if (id !== seq.current) return;
      setOutput("");
      setStatus({ ok: false, message: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="conv-panel">
      <div className="conv-row">
        <label className="conv-field">
          Input is
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="json">JSON</option>
            <option value="yaml">YAML</option>
          </select>
        </label>
        <label className="conv-field">
          Indent
          <select value={indent} onChange={(e) => setIndent(e.target.value as Indent)}>
            <option value="2">2 spaces</option>
            <option value="4">4 spaces</option>
            <option value="tab">Tab</option>
          </select>
        </label>
        <label className="conv-field">
          Sort keys
          <input type="checkbox" checked={sortKeys} onChange={(e) => setSortKeys(e.target.checked)} />
        </label>
      </div>
      <div className="textshare-form">
        <label htmlFor="fmt-in" className="conv-field">Input</label>
        <textarea id="fmt-in" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} rows={10} placeholder='{"hello": "world"}' />
      </div>
      <div className="conv-row">
        <button type="button" className="btn" onClick={() => run("format")} disabled={busy}>Format</button>
        <button type="button" className="btn btn-ghost" onClick={() => run("minify")} disabled={busy || mode !== "json"}>Minify</button>
        <button type="button" className="btn btn-ghost" onClick={() => run("convert")} disabled={busy}>
          Convert to {mode === "json" ? "YAML" : "JSON"}
        </button>
      </div>
      {large && <p className="muted" role="status">Large input — press Format.</p>}
      {status?.ok === true && <div className="banner" role="status">{status.label}</div>}
      {status?.ok === false && <div className="banner banner-error" role="alert">{status.message}</div>}
      <div className="textshare-form">
        <label htmlFor="fmt-out" className="conv-field">Output</label>
        <textarea id="fmt-out" value={output} readOnly spellCheck={false} rows={10} />
      </div>
      <div className="conv-row">
        <CopyBtn value={output} />
        <button type="button" className="btn btn-ghost" onClick={() => download(output, outKind)} disabled={output === ""}>
          Download .{outKind}
        </button>
      </div>
    </div>
  );
};

const DiffPanel: React.FC = () => {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [result, setResult] = useState<DiffEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const compare = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const [x, y] = [await parseAuto(a, "Input A"), await parseAuto(b, "Input B")];
      setResult(diffValues(x, y));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="conv-panel">
      <p className="muted">Each side can be JSON or YAML; the format is detected automatically.</p>
      <div className="textshare-form">
        <label htmlFor="diff-a" className="conv-field">Input A</label>
        <textarea id="diff-a" value={a} onChange={(e) => setA(e.target.value)} spellCheck={false} rows={8} />
        <label htmlFor="diff-b" className="conv-field">Input B</label>
        <textarea id="diff-b" value={b} onChange={(e) => setB(e.target.value)} spellCheck={false} rows={8} />
      </div>
      <div className="conv-row">
        <button type="button" className="btn" onClick={compare} disabled={busy}>Compare</button>
      </div>
      {error && <div className="banner banner-error" role="alert">{error}</div>}
      {result && result.length === 0 && <div className="banner" role="status">No differences.</div>}
      {result && result.length > 0 && (
        <div role="status">
          <p className="muted">{result.length} difference{result.length === 1 ? "" : "s"}{result.length > MAX_DIFF_ROWS ? ` (showing the first ${MAX_DIFF_ROWS})` : ""}</p>
          <ul className="diff-list">
            {result.slice(0, MAX_DIFF_ROWS).map((d, i) => (
              <li key={i} className={`diff-item diff-${d.kind}`}>
                <span className="diff-kind">{d.kind}</span> <code className="diff-path">{d.path}</code>
                {d.kind !== "added" && <div className="diff-val">- {show(d.before)}</div>}
                {d.kind !== "removed" && <div className="diff-val">+ {show(d.after)}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const JsonTool: React.FC<Props> = ({ onBack }) => {
  const [tab, setTab] = useState<Tab>("format");
  return (
    <section className="tool-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="tool-heading">JSON / YAML</h1>
      <p className="muted local-notice">Everything below runs locally — nothing leaves your browser.</p>

      <div className="conv-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`conv-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "format" && <FormatPanel />}
      {tab === "diff" && <DiffPanel />}
    </section>
  );
};

export default JsonTool;
