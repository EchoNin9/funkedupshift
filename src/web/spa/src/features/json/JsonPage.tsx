import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LockSimple } from "@phosphor-icons/react";
import { Alert, CopyButton } from "../../components";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { SegmentedControl } from "../../components/SegmentedControl";
import { useAuth } from "../../shell/AuthContext";
import { diffValues, formatJson, jsonErrorLocation, minifyJson, sortKeysDeep, type DiffEntry } from "./datafmt";

type Tab = "format" | "diff";
const TABS: { id: Tab; label: string }[] = [
  { id: "format", label: "Format" },
  { id: "diff", label: "Diff" },
];

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

const cardClass = "space-y-3.5 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-3.5 sm:p-4";
const labelClass = "block text-[13px] font-semibold text-text-secondary";
const inputClass = `rounded-ds-md border border-divider bg-surface-1 px-2.5 py-2 text-sm text-text-primary ${focusRing}`;
const areaClass = `w-full resize-y font-mono text-[13px] ${inputClass}`;

const DIFF_COLOR: Record<DiffEntry["kind"], string> = {
  added: "border-l-success",
  removed: "border-l-danger",
  changed: "border-l-warning",
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
    <div className={cardClass}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1.5">
          <span className={labelClass}>Input is</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={inputClass}>
            <option value="json">JSON</option>
            <option value="yaml">YAML</option>
          </select>
        </label>
        <label className="space-y-1.5">
          <span className={labelClass}>Indent</span>
          <select value={indent} onChange={(e) => setIndent(e.target.value as Indent)} className={inputClass}>
            <option value="2">2 spaces</option>
            <option value="4">4 spaces</option>
            <option value="tab">Tab</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={sortKeys} onChange={(e) => setSortKeys(e.target.checked)} />
          Sort keys
        </label>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="fmt-in" className={labelClass}>Input</label>
        <textarea id="fmt-in" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} rows={10} placeholder='{"hello": "world"}' className={areaClass} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => run("format")} disabled={busy} className={buttonClasses("primary", "md")}>Format</button>
        <button type="button" onClick={() => run("minify")} disabled={busy || mode !== "json"} className={buttonClasses("secondary", "md")}>Minify</button>
        <button type="button" onClick={() => run("convert")} disabled={busy} className={buttonClasses("secondary", "md")}>
          Convert to {mode === "json" ? "YAML" : "JSON"}
        </button>
      </div>
      {large && <p className="text-sm text-text-secondary" role="status">Large input — press Format.</p>}
      {status?.ok === true && <div role="status"><Alert variant="success">{status.label}</Alert></div>}
      {status?.ok === false && <div role="alert"><Alert variant="error">{status.message}</Alert></div>}
      <div className="space-y-1.5">
        <label htmlFor="fmt-out" className={labelClass}>Output</label>
        <textarea id="fmt-out" value={output} readOnly spellCheck={false} rows={10} className={areaClass} />
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={output} />
        <button type="button" onClick={() => download(output, outKind)} disabled={output === ""} className={buttonClasses("secondary", "md")}>
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
    <div className={cardClass}>
      <p className="text-sm text-text-secondary">Each side can be JSON or YAML; the format is detected automatically.</p>
      <div className="space-y-1.5">
        <label htmlFor="diff-a" className={labelClass}>Input A</label>
        <textarea id="diff-a" value={a} onChange={(e) => setA(e.target.value)} spellCheck={false} rows={8} className={areaClass} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="diff-b" className={labelClass}>Input B</label>
        <textarea id="diff-b" value={b} onChange={(e) => setB(e.target.value)} spellCheck={false} rows={8} className={areaClass} />
      </div>
      <button type="button" onClick={compare} disabled={busy} className={buttonClasses("primary", "md")}>Compare</button>
      {error && <div role="alert"><Alert variant="error">{error}</Alert></div>}
      {result && result.length === 0 && <div role="status"><Alert variant="success">No differences.</Alert></div>}
      {result && result.length > 0 && (
        <div role="status" className="space-y-2">
          <p className="text-sm text-text-secondary">
            {result.length} difference{result.length === 1 ? "" : "s"}
            {result.length > MAX_DIFF_ROWS ? ` (showing the first ${MAX_DIFF_ROWS})` : ""}
          </p>
          <ul className="space-y-2">
            {result.slice(0, MAX_DIFF_ROWS).map((d, i) => (
              <li key={i} className={`break-all rounded-ds-md border border-divider border-l-4 bg-surface-1 px-3 py-2 ${DIFF_COLOR[d.kind]}`}>
                <span className="text-[11px] font-semibold uppercase text-text-secondary">{d.kind}</span>{" "}
                <code className="font-mono text-[13px] text-text-primary">{d.path}</code>
                {d.kind !== "added" && <div className="font-mono text-[13px] text-text-primary">- {show(d.before)}</div>}
                {d.kind !== "removed" && <div className="font-mono text-[13px] text-text-primary">+ {show(d.after)}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default function JsonPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("format");

  const srTitle = <h1 className="sr-only">JSON / YAML</h1>;

  if (!user) {
    return (
      <div className="space-y-4">
        {srTitle}
        <div className="flex flex-wrap items-center gap-4 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <LockSimple size={26} weight="regular" aria-hidden="true" className="text-accent-text" />
          <div className="min-w-[220px] flex-1">
            <div className="font-bold text-text-primary">Sign in to use JSON / YAML</div>
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
      <SegmentedControl options={TABS} value={tab} onChange={setTab} ariaLabel="Tool mode" />
      {tab === "format" && <FormatPanel />}
      {tab === "diff" && <DiffPanel />}
    </div>
  );
}
