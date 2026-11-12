// Cron / EventBridge schedule parsing + epoch timestamp helpers. Pure logic, no DOM, no network.
// Type-strippable TS only (no enum / namespace / parameter properties) so node can run it directly.
// A byte-identical copy lives at src/web/spa/src/features/cron/crontime.ts (CI guards the drift).
// Every function that depends on "now" takes it as a parameter.

// ---------------------------------------------------------------------------
// Time zones (Intl only)

const dtfCache: Record<string, Intl.DateTimeFormat> = {};
const dtf = (tz: string): Intl.DateTimeFormat => {
  let f = dtfCache[tz];
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    dtfCache[tz] = f;
  }
  return f;
};

export interface Wall {
  y: number;
  mo: number; // 1-12
  d: number;
  h: number;
  mi: number;
  s: number;
}

/** Wall-clock fields of an instant in a zone. */
export function wallParts(ms: number, tz: string): Wall {
  const w: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(new Date(ms))) {
    if (p.type !== "literal") w[p.type] = Number(p.value);
  }
  return { y: w.year, mo: w.month, d: w.day, h: w.hour % 24, mi: w.minute, s: w.second };
}

/** Zone offset from UTC in ms at an instant (positive = east of UTC). */
export function offsetMs(utcMs: number, tz: string): number {
  const w = wallParts(utcMs, tz);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Wall-clock time (expressed as if it were UTC) to a real instant in the zone.
 * Returns null when the wall time does not exist (spring-forward gap); picks the first
 * occurrence when it is ambiguous (fall-back overlap).
 */
export function wallToUtc(wallMs: number, tz: string): number | null {
  const cands = [offsetMs(wallMs - 86400000, tz), offsetMs(wallMs + 86400000, tz)];
  let best: number | null = null;
  for (const o of cands) {
    const utc = wallMs - o;
    if (offsetMs(utc, tz) === o && (best === null || utc < best)) best = utc;
  }
  return best;
}

export function listTimeZones(): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as any).supportedValuesOf("timeZone") as string[];
  } catch {
    // older engine: UTC only
  }
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const offsetText = (offMs: number, colon: boolean): string => {
  const sign = offMs < 0 ? "-" : "+";
  const mins = Math.round(Math.abs(offMs) / 60000);
  return `${sign}${pad(Math.floor(mins / 60))}${colon ? ":" : ""}${pad(mins % 60)}`;
};

const weekdayOf = (w: Wall): number => new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay();

/** e.g. "Fri 2026-01-30 12:00:00 (UTC-08:00)" */
export function formatLocal(ms: number, tz: string): string {
  const w = wallParts(ms, tz);
  const off = offsetText(offsetMs(ms, tz), true);
  return `${WD_SHORT[weekdayOf(w)]} ${w.y}-${pad(w.mo)}-${pad(w.d)} ${pad(w.h)}:${pad(w.mi)}:${pad(w.s)} (UTC${off})`;
}

// ---------------------------------------------------------------------------
// Cron parsing

export interface DayField {
  /** true for `*` (or `?` in EventBridge): the field does not restrict the day */
  star: boolean;
  /** true for `?` in EventBridge */
  any: boolean;
}

export interface DomField extends DayField {
  days: Set<number>;
  last: boolean; // L
  lastWeekday: boolean; // LW
  nearest: number[]; // nW
}

export interface DowField extends DayField {
  days: Set<number>; // JS weekdays, 0 = Sunday
  lastOf: number[]; // nL -> JS weekday
  nth: [number, number][]; // d#n -> [JS weekday, n]
}

export interface Parsed {
  kind: "cron" | "eventbridge" | "rate";
  /** zone to preview in unless the user picks one (EventBridge rules run in UTC) */
  defaultZone: string | null;
  raw: string[];
  minutes: Set<number>;
  hours: Set<number>;
  months: Set<number>;
  years: Set<number> | null;
  dom: DomField;
  dow: DowField;
  rate: { value: number; unit: "minute" | "hour" | "day" } | null;
}

interface FieldDef {
  name: string;
  lo: number;
  hi: number;
  labels?: string[];
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const F_MIN: FieldDef = { name: "Minute", lo: 0, hi: 59 };
const F_HOUR: FieldDef = { name: "Hour", lo: 0, hi: 23 };
const F_DOM: FieldDef = { name: "Day-of-month", lo: 1, hi: 31 };
const F_MONTH: FieldDef = { name: "Month", lo: 1, hi: 12, labels: MONTH_NAMES };
const F_DOW: FieldDef = { name: "Day-of-week", lo: 0, hi: 7, labels: [...DOW_NAMES, "Sunday"] };
const F_DOW_EB: FieldDef = { name: "Day-of-week", lo: 1, hi: 7, labels: DOW_NAMES };
const F_YEAR: FieldDef = { name: "Year", lo: 1970, hi: 2199 };

const valueOf = (tok: string, def: FieldDef): number => {
  if (/^\d+$/.test(tok)) return Number(tok);
  if (def.labels && tok.length === 3) {
    const i = def.labels.findIndex((l) => l.slice(0, 3).toUpperCase() === tok.toUpperCase());
    if (i >= 0) return def.lo + i;
  }
  throw new Error(`${def.name}: '${tok}' is not a valid value`);
};

const inRange = (v: number, def: FieldDef) => {
  if (v < def.lo || v > def.hi) throw new Error(`${def.name}: ${v} is out of range ${def.lo}–${def.hi}`);
};

/** Parses a list/range/step field into a set of values. */
function parseSet(text: string, def: FieldDef): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    if (part === "") throw new Error(`${def.name}: empty list item in '${text}'`);
    const [base, stepS, ...extra] = part.split("/");
    if (extra.length) throw new Error(`${def.name}: '${part}' has more than one step`);
    let a: number;
    let b: number;
    if (base === "*") {
      a = def.lo;
      b = def.hi;
    } else if (base.includes("-")) {
      const [x, y, ...r] = base.split("-");
      if (r.length) throw new Error(`${def.name}: '${base}' is not a valid range`);
      a = valueOf(x, def);
      b = valueOf(y, def);
    } else {
      a = valueOf(base, def);
      b = stepS !== undefined ? def.hi : a;
    }
    inRange(a, def);
    inRange(b, def);
    if (a > b) throw new Error(`${def.name}: ${a}-${b} is a reversed range`);
    let step = 1;
    if (stepS !== undefined) {
      if (!/^\d+$/.test(stepS) || Number(stepS) < 1) throw new Error(`${def.name}: step '${stepS}' must be a positive whole number`);
      step = Number(stepS);
    }
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}

const fullSet = (lo: number, hi: number) => {
  const s = new Set<number>();
  for (let v = lo; v <= hi; v++) s.add(v);
  return s;
};

const emptyDom = (): DomField => ({ star: false, any: false, days: new Set(), last: false, lastWeekday: false, nearest: [] });
const emptyDow = (): DowField => ({ star: false, any: false, days: new Set(), lastOf: [], nth: [] });

const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

function parseRate(text: string): Parsed {
  const m = /^rate\(\s*(\S+)\s+(\S+)\s*\)$/i.exec(text);
  if (!m) throw new Error("Rate: expected rate(value unit), e.g. rate(5 minutes)");
  if (!/^\d+$/.test(m[1]) || Number(m[1]) < 1) throw new Error(`Rate: value '${m[1]}' must be a positive whole number`);
  const value = Number(m[1]);
  const unit = m[2].toLowerCase();
  const base = unit.replace(/s$/, "");
  if (base !== "minute" && base !== "hour" && base !== "day") throw new Error(`Rate: unit '${m[2]}' must be minute(s), hour(s) or day(s)`);
  if (value === 1 && unit !== base) throw new Error(`Rate: use '${base}' (singular) when the value is 1, not '${m[2]}'`);
  if (value > 1 && unit === base) throw new Error(`Rate: use '${base}s' (plural) when the value is greater than 1, not '${m[2]}'`);
  return {
    kind: "rate",
    defaultZone: "UTC",
    raw: [],
    minutes: new Set(),
    hours: new Set(),
    months: new Set(),
    years: null,
    dom: { ...emptyDom(), star: true },
    dow: { ...emptyDow(), star: true },
    rate: { value, unit: base },
  };
}

function parseStandard(fields: string[]): Parsed {
  const [fMin, fHour, fDom, fMonth, fDow] = fields;
  const dom = emptyDom();
  dom.star = fDom.startsWith("*"); // Vixie: a leading `*` means "unrestricted" even with a step
  dom.days = parseSet(fDom, F_DOM);
  const dow = emptyDow();
  dow.star = fDow.startsWith("*");
  for (const v of parseSet(fDow, F_DOW)) dow.days.add(v % 7); // 7 == Sunday
  return {
    kind: "cron",
    defaultZone: null,
    raw: fields,
    minutes: parseSet(fMin, F_MIN),
    hours: parseSet(fHour, F_HOUR),
    months: parseSet(fMonth, F_MONTH),
    years: null,
    dom,
    dow,
    rate: null,
  };
}

function parseEventBridge(fields: string[]): Parsed {
  const [fMin, fHour, fDom, fMonth, fDow, fYear] = fields;
  const names = ["Minute", "Hour", "Month", "Year"];
  [fMin, fHour, fMonth, fYear].forEach((f, i) => {
    if (f === "?") throw new Error(`${names[i]}: '?' is only allowed in day-of-month or day-of-week`);
  });
  if (fDom === "?" && fDow === "?") throw new Error("Day-of-month / Day-of-week: exactly one must be '?' (both are '?')");
  if (fDom !== "?" && fDow !== "?") throw new Error("Day-of-month / Day-of-week: EventBridge requires exactly one of them to be '?'");

  const dom = emptyDom();
  if (fDom === "?") {
    dom.any = dom.star = true;
    dom.days = fullSet(1, 31);
  } else {
    const plain: string[] = [];
    for (const item of fDom.split(",")) {
      let m: RegExpExecArray | null;
      if (item === "L") dom.last = true;
      else if (item === "LW") dom.lastWeekday = true;
      else if ((m = /^(\d+)W$/.exec(item))) {
        const n = Number(m[1]);
        inRange(n, F_DOM);
        dom.nearest.push(n);
      } else plain.push(item);
    }
    if (plain.length) dom.days = parseSet(plain.join(","), F_DOM);
    dom.star = fDom === "*";
  }

  const dow = emptyDow();
  if (fDow === "?") {
    dow.any = dow.star = true;
    dow.days = fullSet(0, 6);
  } else {
    const plain: string[] = [];
    for (const item of fDow.split(",")) {
      let m: RegExpExecArray | null;
      if (item === "L") plain.push("7"); // bare L in day-of-week means Saturday (7)
      else if ((m = /^([A-Za-z0-9]+)L$/.exec(item))) {
        const v = valueOf(m[1], F_DOW_EB);
        inRange(v, F_DOW_EB);
        dow.lastOf.push(v - 1);
      } else if (item.includes("#")) {
        const [d, n, ...r] = item.split("#");
        if (r.length || !/^\d+$/.test(n)) throw new Error(`Day-of-week: '${item}' is not a valid day#occurrence`);
        const v = valueOf(d, F_DOW_EB);
        inRange(v, F_DOW_EB);
        if (Number(n) < 1 || Number(n) > 5) throw new Error(`Day-of-week: occurrence ${n} in '${item}' is out of range 1–5`);
        dow.nth.push([v - 1, Number(n)]);
      } else plain.push(item);
    }
    if (plain.length) for (const v of parseSet(plain.join(","), F_DOW_EB)) dow.days.add(v - 1);
    dow.star = fDow === "*";
  }

  return {
    kind: "eventbridge",
    defaultZone: "UTC",
    raw: fields,
    minutes: parseSet(fMin, F_MIN),
    hours: parseSet(fHour, F_HOUR),
    months: parseSet(fMonth, F_MONTH),
    years: fYear === "*" ? null : parseSet(fYear, F_YEAR),
    dom,
    dow,
    rate: null,
  };
}

export function parseExpression(input: string): Parsed {
  const text = input.trim();
  if (text === "") throw new Error("Expression: enter a cron expression, cron(...) or rate(...)");
  if (/^rate\(/i.test(text)) return parseRate(text);
  if (/^cron\(/i.test(text)) {
    if (!text.endsWith(")")) throw new Error("Expression: cron( is missing its closing )");
    const inner = text.slice(5, -1).trim();
    const fields = inner === "" ? [] : inner.split(/\s+/);
    if (fields.length !== 6) throw new Error(`Field count: expected 6 fields inside cron(...), got ${fields.length}`);
    return parseEventBridge(fields);
  }
  let body = text;
  if (text.startsWith("@")) {
    const macro = MACROS[text.toLowerCase()];
    if (!macro) throw new Error(`Macro: '${text}' is not one of ${Object.keys(MACROS).join(", ")}`);
    body = macro;
  }
  const fields = body.split(/\s+/);
  if (fields.length !== 5) throw new Error(`Field count: expected 5 fields or cron(...) with 6, got ${fields.length}`);
  return parseStandard(fields);
}

// ---------------------------------------------------------------------------
// Day matching

const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
const wdOf = (y: number, mo: number, d: number) => new Date(Date.UTC(y, mo - 1, d)).getUTCDay();

/** Day of the month nearest to day n that is Mon-Fri, staying inside the month. */
function nearestWeekday(n: number, y: number, mo: number): number | null {
  const dim = daysInMonth(y, mo);
  if (n > dim) return null;
  const wd = wdOf(y, mo, n);
  if (wd >= 1 && wd <= 5) return n;
  if (wd === 6) return n - 1 >= 1 ? n - 1 : n + 2; // Saturday: Friday, or Monday the 3rd
  return n + 1 <= dim ? n + 1 : n - 2; // Sunday: Monday, or Friday the 29th/30th
}

function lastWeekdayOfMonth(y: number, mo: number): number {
  const dim = daysInMonth(y, mo);
  const wd = wdOf(y, mo, dim);
  return wd === 6 ? dim - 1 : wd === 0 ? dim - 2 : dim;
}

function dayMatches(p: Parsed, y: number, mo: number, d: number): boolean {
  const dim = daysInMonth(y, mo);
  const wd = wdOf(y, mo, d);
  const domOk =
    p.dom.days.has(d) ||
    (p.dom.last && d === dim) ||
    (p.dom.lastWeekday && d === lastWeekdayOfMonth(y, mo)) ||
    p.dom.nearest.some((n) => nearestWeekday(n, y, mo) === d);
  const dowOk =
    p.dow.days.has(wd) ||
    (p.dow.lastOf.includes(wd) && d + 7 > dim) ||
    p.dow.nth.some(([w, n]) => w === wd && Math.ceil(d / 7) === n);
  // Vixie: both fields restricted -> either matches; otherwise both must (the `*` side is always true).
  return !p.dom.star && !p.dow.star ? domOk || dowOk : domOk && dowOk;
}

// ---------------------------------------------------------------------------
// Next runs

const HORIZON_YEARS = 5;

export interface RunList {
  /** epoch ms, ascending */
  runs: number[];
  note?: string;
}

/**
 * Next `count` runs strictly after `after`, evaluated in wall-clock space of `tz`.
 * ponytail: search horizon is 5 years of wall-clock time; sparse schedules (Feb 29, a year list
 * that is further out) return fewer runs plus a note instead of scanning further.
 */
export function nextRuns(p: Parsed, after: number | Date, tz: string, count = 10): RunList {
  if (p.kind === "rate" && p.rate) {
    const unit = p.rate.value === 1 ? p.rate.unit : `${p.rate.unit}s`;
    return { runs: [], note: `Runs every ${p.rate.value === 1 ? "" : p.rate.value + " "}${unit}, starting when the rule is created.` };
  }
  const t = Number(after);
  const start = wallParts(t, tz);
  const startDay = Date.UTC(start.y, start.mo - 1, start.d);
  const endWall = Date.UTC(start.y + HORIZON_YEARS, start.mo - 1, start.d, start.h, start.mi);
  const mins = [...p.minutes].sort((a, b) => a - b);
  const hrs = [...p.hours].sort((a, b) => a - b);
  const runs: number[] = [];
  let done = false;
  outer: for (let y = start.y; y <= start.y + HORIZON_YEARS; y++) {
    if (p.years && !p.years.has(y)) continue;
    for (let mo = 1; mo <= 12; mo++) {
      if (!p.months.has(mo)) continue;
      if (Date.UTC(y, mo, 1) <= startDay) continue; // month already over
      const dim = daysInMonth(y, mo);
      for (let d = 1; d <= dim; d++) {
        const dayMs = Date.UTC(y, mo - 1, d);
        if (dayMs < startDay) continue;
        if (dayMs > endWall) break outer;
        if (!dayMatches(p, y, mo, d)) continue;
        for (const h of hrs) {
          for (const m of mins) {
            const wall = dayMs + h * 3600000 + m * 60000;
            if (wall > endWall) break outer;
            const utc = wallToUtc(wall, tz);
            if (utc === null || utc <= t) continue; // DST gap, or already past
            runs.push(utc);
            if (runs.length >= count) {
              done = true;
              break outer;
            }
          }
        }
      }
    }
  }
  if (done) return { runs };
  const until = new Date(endWall).toISOString().slice(0, 10);
  const note =
    runs.length === 0
      ? `No runs found within the ${HORIZON_YEARS}-year search horizon (until ${until}). This schedule may never match, or its next run is further out.`
      : `Only ${runs.length} run${runs.length === 1 ? "" : "s"} found within the ${HORIZON_YEARS}-year search horizon (until ${until}); later runs are not shown.`;
  return { runs, note };
}

// ---------------------------------------------------------------------------
// Plain-English description

const plainList = (s: string) => /^\d+(,\d+)*$/.test(s);

const label = (v: number, def: FieldDef) => (def.labels ? def.labels[v - def.lo] ?? String(v) : String(v));

/** Field-by-field text for one field: "1 through 5", "every 5 minutes", "Monday, Friday". */
function fieldText(raw: string, def: FieldDef, unit = ""): string {
  const every = (n: string) => `every ${n}${unit ? " " + unit + (n === "1" ? "" : "s") : ""}`;
  return raw
    .split(",")
    .map((part) => {
      const [base, step] = part.split("/");
      if (base === "*") return step ? every(step) : "every value";
      let a: string;
      let b: string | null = null;
      if (base.includes("-")) {
        const [x, y] = base.split("-");
        a = label(valueOf(x, def), def);
        b = label(valueOf(y, def), def);
      } else {
        a = label(valueOf(base, def), def);
        if (step) b = label(def.hi, def);
      }
      const span = b ? `${a} through ${b}` : a;
      return step ? `${every(step)} from ${span}` : span;
    })
    .join(", ");
}

function timeText(p: Parsed): string {
  const [fMin, fHour] = p.raw;
  if (plainList(fMin) && plainList(fHour) && p.minutes.size * p.hours.size <= 12) {
    const times: string[] = [];
    for (const h of [...p.hours].sort((a, b) => a - b)) for (const m of [...p.minutes].sort((a, b) => a - b)) times.push(`${pad(h)}:${pad(m)}`);
    return `At ${times.join(", ")}`;
  }
  const step = /^\*\/(\d+)$/.exec(fMin);
  const ft = fieldText(fMin, F_MIN, "minute");
  const minText = fMin === "*" ? "every minute" : step ? (step[1] === "1" ? "every minute" : `every ${step[1]} minutes`) : (ft.startsWith("every") ? ft : `at minute ${ft}`);
  const cap = minText[0].toUpperCase() + minText.slice(1);
  if (fHour === "*") return fMin === "*" || step ? cap : `${cap} past every hour`;
  return `${cap}, past hour ${fieldText(fHour, F_HOUR, "hour")}`;
}

const ordinal = ["", "first", "second", "third", "fourth", "fifth"];

function domText(p: Parsed): string | null {
  if (p.raw[2] === "*" || p.raw[2] === "?") return null;
  const parts: string[] = [];
  if (p.raw[2] && p.dom.days.size) {
    const plain = p.raw[2]
      .split(",")
      .filter((i) => i !== "L" && i !== "LW" && !/^\d+W$/.test(i))
      .join(",");
    const days = fieldText(plain, F_DOM, "day");
    parts.push(plain.includes("/") ? `${days} of the month` : plain.includes(",") || plain.includes("-") ? `days ${days} of the month` : `day ${days} of the month`);
  }
  if (p.dom.last) parts.push("the last day of the month");
  if (p.dom.lastWeekday) parts.push("the last weekday of the month");
  for (const n of p.dom.nearest) parts.push(`the weekday nearest day ${n} of the month`);
  return "on " + parts.join(", and on ");
}

function dowText(p: Parsed): string | null {
  if (p.raw[4] === "*" || p.raw[4] === "?") return null;
  const eb = p.kind === "eventbridge";
  const def = eb ? F_DOW_EB : F_DOW;
  const parts: string[] = [];
  const plain = p.raw[4]
    .split(",")
    .filter((i) => !(eb && (i.includes("#") || (i !== "L" && /L$/.test(i)))))
    .map((i) => (eb && i === "L" ? "7" : i))
    .join(",");
  if (plain) {
    const txt = fieldText(plain, def, "day");
    parts.push(/^[A-Za-z]+ through [A-Za-z]+$/.test(txt) ? txt : "on " + txt);
  }
  for (const wd of p.dow.lastOf) parts.push(`on the last ${DOW_NAMES[wd]} of the month`);
  for (const [wd, n] of p.dow.nth) parts.push(`on the ${ordinal[n]} ${DOW_NAMES[wd]} of the month`);
  return parts.join(", and ");
}

/** English description of a parsed expression. Correct rather than literary. */
export function describe(p: Parsed): string {
  if (p.kind === "rate" && p.rate) {
    const { value, unit } = p.rate;
    return value === 1 ? `Every ${unit}` : `Every ${value} ${unit}s`;
  }
  let out = timeText(p);
  const dom = domText(p);
  const dow = dowText(p);
  if (dom && dow) out += ` ${dom}, ${p.dom.star || p.dow.star ? "and" : "or"} ${dow}`; // Vixie: both restricted -> either matches
  else if (dom) out += ` ${dom}`;
  else if (dow) out += `, ${dow}`;
  const monthRaw = p.raw[3];
  const monthText = monthRaw === "*" ? null : `in ${fieldText(monthRaw, F_MONTH, "month")}`;
  if (monthText) out += `, ${monthText}`;
  if (p.kind === "eventbridge" && p.raw[5] !== "*") out += `, in ${fieldText(p.raw[5], F_YEAR, "year")}`;
  if (!dom && !dow && !monthText && (p.raw[5] === undefined || p.raw[5] === "*") && !out.startsWith("Every")) out += ", every day";
  return out;
}

// ---------------------------------------------------------------------------
// Timestamps

export type TsUnit = "auto" | "s" | "ms";

export interface ParsedTs {
  ms: number;
  /** how the input was read */
  as: "seconds" | "milliseconds" | "date";
  /** true when seconds-vs-milliseconds was auto-detected */
  auto: boolean;
}

export function parseTimestamp(input: string, unit: TsUnit = "auto"): ParsedTs {
  const text = input.trim();
  if (text === "") throw new Error("Timestamp: enter an epoch number or a date");
  let res: ParsedTs;
  if (/^[-+]?\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    const secs = unit === "auto" ? Math.abs(n) < 1e11 : unit === "s";
    res = { ms: Math.round(secs ? n * 1000 : n), as: secs ? "seconds" : "milliseconds", auto: unit === "auto" };
  } else {
    // ponytail: strings without an offset (e.g. 2026-01-01T10:00) follow Date.parse, i.e. the browser's zone.
    const ms = Date.parse(text);
    if (Number.isNaN(ms)) throw new Error(`Timestamp: could not read '${text}' as an epoch number or date`);
    res = { ms, as: "date", auto: false };
  }
  if (!Number.isFinite(res.ms) || Math.abs(res.ms) > 8.64e15) throw new Error("Timestamp: value is outside the supported date range");
  return res;
}

export function rfc2822(ms: number, tz: string): string {
  const w = wallParts(ms, tz);
  return `${WD_SHORT[weekdayOf(w)]}, ${pad(w.d)} ${MON_SHORT[w.mo - 1]} ${w.y} ${pad(w.h)}:${pad(w.mi)}:${pad(w.s)} ${offsetText(offsetMs(ms, tz), false)}`;
}

const REL_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86400],
  ["month", 30 * 86400],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** "in 3 days" / "2 hours ago", using the largest whole unit. */
export function relativeTime(ms: number, nowMs: number): string {
  const diff = Math.round((ms - nowMs) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, secs] of REL_UNITS) {
    if (Math.abs(diff) >= secs) return rtf.format(Math.trunc(diff / secs), unit);
  }
  return rtf.format(0, "second");
}

export interface TsOutputs {
  seconds: string;
  millis: string;
  iso: string;
  rfc2822: string;
  local: string;
  relative: string;
}

export function formatTimestamp(ms: number, tz: string, nowMs: number): TsOutputs {
  return {
    seconds: String(Math.floor(ms / 1000)),
    millis: String(ms),
    iso: new Date(ms).toISOString(),
    rfc2822: rfc2822(ms, tz),
    local: formatLocal(ms, tz),
    relative: relativeTime(ms, nowMs),
  };
}
