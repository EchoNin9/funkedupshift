// Pure JSON helpers shared (byte-identical) by the tools site and the SPA. Type-strippable TS only;
// deliberately does not import `yaml` (the YAML work happens in the components via a lazy import).

export interface FormatOptions {
  indent: 2 | 4 | "tab";
  sortKeys: boolean;
}

export interface DiffEntry {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Recursively sorts object keys; arrays keep their order (their elements are still sorted inside). */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isPlainObject(value)) {
    // fromEntries defines own properties, so a "__proto__" key survives instead of setting the prototype.
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeysDeep(value[k])]),
    );
  }
  return value;
}

// ponytail: JSON.parse reads numbers as doubles, so integers beyond 2^53 lose precision when re-formatted.
export function formatJson(text: string, opts: FormatOptions): string {
  let v: unknown = JSON.parse(text);
  if (opts.sortKeys) v = sortKeysDeep(v);
  return JSON.stringify(v, null, opts.indent === "tab" ? "\t" : opts.indent);
}

export function minifyJson(text: string, opts: { sortKeys: boolean }): string {
  let v: unknown = JSON.parse(text);
  if (opts.sortKeys) v = sortKeysDeep(v);
  return JSON.stringify(v);
}

function lineColFromPosition(text: string, pos: number): { line: number; column: number } {
  const p = Math.min(Math.max(pos, 0), text.length);
  let line = 1;
  let lastNl = -1;
  for (let i = text.indexOf("\n"); i !== -1 && i < p; i = text.indexOf("\n", i + 1)) {
    line++;
    lastNl = i;
  }
  return { line, column: p - lastNl };
}

/**
 * Line/column (1-based) of a JSON.parse failure, read from the engine's message.
 * V8: "... at position N" and newer "(line L column C)"; Firefox: "at line L column C of the JSON data".
 * Returns null when the message carries no location.
 */
export function jsonErrorLocation(text: string, err: unknown): { line: number; column: number } | null {
  const msg = err instanceof Error ? err.message : String(err);
  const lc = /line (\d+) column (\d+)/.exec(msg);
  if (lc) return { line: Number(lc[1]), column: Number(lc[2]) };
  const pos = /position (\d+)/.exec(msg);
  if (pos) return lineColFromPosition(text, Number(pos[1]));
  if (/Unexpected end of JSON/i.test(msg)) return lineColFromPosition(text, text.length);
  // Recent V8: `Unexpected token 'o', "...context..." is not valid JSON` has no number; find the snippet in the text.
  // ponytail: V8 shows up to 10 chars either side of the error, so an elided "..." start puts the error at snippet
  // offset 10; a snippet that starts at the text start is located by its first token occurrence (can be off by a few columns).
  const snip = /Unexpected token '(.*)', ([\s\S]*) is not valid JSON/.exec(msg);
  if (snip) {
    // The snippet is wrapped as "..." with an ellipsis outside the quotes on the elided side.
    const lead = snip[2].startsWith("...");
    const body = snip[2].replace(/^(\.\.\.)?"/, "").replace(/"(\.\.\.)?$/, "");
    const at = text.indexOf(body);
    if (at >= 0) {
      const off = lead ? 10 : Math.max(body.indexOf(snip[1]), 0);
      return lineColFromPosition(text, at + off);
    }
  }
  return null;
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const keyPath = (base: string, key: string) => (IDENT.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`);

/**
 * Semantic diff. Object key order is irrelevant. A type change (object / array / scalar) is "changed" at that path.
 * ponytail: arrays are compared index by index, so an insert at the front reports every later element as changed
 * (no move or insert detection).
 */
export function diffValues(a: unknown, b: unknown): DiffEntry[] {
  const out: DiffEntry[] = [];
  const walk = (x: unknown, y: unknown, path: string) => {
    if (Array.isArray(x) && Array.isArray(y)) {
      const n = Math.max(x.length, y.length);
      for (let i = 0; i < n; i++) {
        const p = `${path}[${i}]`;
        if (i >= x.length) out.push({ path: p, kind: "added", after: y[i] });
        else if (i >= y.length) out.push({ path: p, kind: "removed", before: x[i] });
        else walk(x[i], y[i], p);
      }
    } else if (isPlainObject(x) && isPlainObject(y)) {
      for (const k of Object.keys(x)) {
        if (Object.prototype.hasOwnProperty.call(y, k)) walk(x[k], y[k], keyPath(path, k));
        else out.push({ path: keyPath(path, k), kind: "removed", before: x[k] });
      }
      for (const k of Object.keys(y)) {
        if (!Object.prototype.hasOwnProperty.call(x, k)) out.push({ path: keyPath(path, k), kind: "added", after: y[k] });
      }
    } else if (!Object.is(x, y)) {
      out.push({ path, kind: "changed", before: x, after: y });
    }
  };
  walk(a, b, "$");
  return out;
}
