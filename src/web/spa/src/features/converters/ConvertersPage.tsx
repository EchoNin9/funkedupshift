import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowsRightLeftIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../../shell/AuthContext";

// ---- pure client-side conversions ----
// Duplicated in the tools-site app's src/ConvertersTool.tsx — the two
// frontends deliberately don't import from each other (see the note atop
// src/web/tools-site/src/api.ts), so the conversion tables/helpers are
// carried in both places.

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "";
  return Number(n.toFixed(5)).toString();
}

function parseOrNull(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

// ---- temperature ----
function fromCelsius(c: number) {
  return { c, f: (c * 9) / 5 + 32, k: c + 273.15 };
}
type TempField = "c" | "f" | "k";
function celsiusFrom(field: TempField, value: number): number {
  if (field === "c") return value;
  if (field === "f") return ((value - 32) * 5) / 9;
  return value - 273.15;
}

// ---- units: table-driven, one {unit: factorToBase} map per dimension ----
interface Dimension {
  label: string;
  units: Record<string, number>;
}
const DIMENSIONS: Record<string, Dimension> = {
  length: {
    label: "Length",
    units: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.34 },
  },
  mass: {
    label: "Mass",
    units: { g: 1, kg: 1000, oz: 28.3495, lb: 453.592, stone: 453.592 * 14 },
  },
  volume: {
    label: "Volume (US)",
    units: { ml: 1, L: 1000, "fl oz": 29.5735, cup: 236.588, pint: 473.176, quart: 946.353, gallon: 3785.41 },
  },
};

function convertUnit(dim: Dimension, from: string, to: string, value: number): number {
  return (value * dim.units[from]) / dim.units[to];
}

// ---- date math (stdlib Date, UTC/date-only to dodge DST off-by-one) ----
function parseDateOnly(s: string): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function todayDateOnly(): Date {
  return parseDateOnly(new Date().toISOString().slice(0, 10))!;
}
function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function weekdayOf(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}
function addDays(d: Date, n: number): Date {
  const copy = new Date(d.getTime());
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function ageFromBirthdate(birth: Date, today: Date): number {
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const m = today.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

// ---- timezone (stdlib Intl.DateTimeFormat, DST handled for free) ----
const FAVORITE_ZONES = ["America/Vancouver", "Asia/Seoul", "UTC"];
const ALL_ZONES: string[] =
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : FAVORITE_ZONES;

interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}
function zonedParts(ms: number, timeZone: string): ZoneParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  let hour = get("hour");
  if (hour === 24) hour = 0;
  return { year: get("year"), month: get("month"), day: get("day"), hour, minute: get("minute") };
}
/** Converts a wall-clock time in `timeZone` to a UTC instant, via the
 * standard double-conversion trick: guess the instant is UTC, see how that
 * guess reads back in `timeZone`, and correct by the difference. */
function zonedTimeToUtcMs(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const asIfUtc = zonedParts(guess, timeZone);
  const asIfUtcMs = Date.UTC(asIfUtc.year, asIfUtc.month - 1, asIfUtc.day, asIfUtc.hour, asIfUtc.minute);
  return guess - (asIfUtcMs - guess);
}
function zonedWeekday(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(new Date(ms));
}
// ---- end shared conversions ----

type Tab = "temperature" | "units" | "date" | "timezone";
const TABS: { id: Tab; label: string }[] = [
  { id: "temperature", label: "Temperature" },
  { id: "units", label: "Units" },
  { id: "date", label: "Date math" },
  { id: "timezone", label: "Timezone" },
];

const pad2 = (n: number) => String(n).padStart(2, "0");

const fieldClass =
  "rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary";
const cardClass = "rounded-xl border border-border-default bg-surface-2/80 p-4 space-y-3";

const ZonePicker: React.FC<{ label: string; value: string; onChange: (z: string) => void }> = ({
  label,
  value,
  onChange,
}) => {
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? ALL_ZONES.filter((z) => z.toLowerCase().includes(f)) : ALL_ZONES;
    return list.includes(value) ? list : [value, ...list];
  }, [filter, value]);

  return (
    <div className="space-y-2">
      <label className="text-sm text-text-secondary">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {FAVORITE_ZONES.map((z) => (
          <button
            key={z}
            type="button"
            onClick={() => onChange(z)}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              value === z
                ? "border-accent-500 text-accent-400"
                : "border-border-hover text-text-tertiary hover:text-text-primary"
            }`}
          >
            {z}
          </button>
        ))}
      </div>
      <input
        type="text"
        placeholder="Filter zones…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className={`w-full ${fieldClass}`}
      />
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`w-full ${fieldClass}`}>
        {filtered.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>
    </div>
  );
};

const ConvertersPage: React.FC = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("temperature");

  // -- temperature --
  const [temp, setTemp] = useState({ c: "", f: "", k: "" });
  const handleTemp = (field: TempField, raw: string) => {
    if (raw.trim() === "") {
      setTemp({ c: "", f: "", k: "" });
      return;
    }
    const num = Number(raw);
    if (Number.isNaN(num)) return;
    const { c, f, k } = fromCelsius(celsiusFrom(field, num));
    const next = { c: formatNum(c), f: formatNum(f), k: formatNum(k) };
    next[field] = raw;
    setTemp(next);
  };

  // -- units --
  const [dimKey, setDimKey] = useState<keyof typeof DIMENSIONS>("length");
  const dimension = DIMENSIONS[dimKey];
  const unitNames = Object.keys(dimension.units);
  const [fromUnit, setFromUnit] = useState(unitNames[0]);
  const [toUnit, setToUnit] = useState(unitNames[1]);
  const [unitValue, setUnitValue] = useState("1");
  const selectDimension = (key: keyof typeof DIMENSIONS) => {
    setDimKey(key);
    const names = Object.keys(DIMENSIONS[key].units);
    setFromUnit(names[0]);
    setToUnit(names[1]);
  };
  const unitResult = useMemo(() => {
    const num = parseOrNull(unitValue);
    if (num === null) return "";
    return formatNum(convertUnit(dimension, fromUnit, toUnit, num));
  }, [unitValue, fromUnit, toUnit, dimension]);

  // -- date math --
  const [fromDate, setFromDate] = useState(formatDateOnly(todayDateOnly()));
  const [dayOffset, setDayOffset] = useState("0");
  const offsetResult = useMemo(() => {
    const base = parseDateOnly(fromDate);
    const n = parseOrNull(dayOffset);
    if (!base || n === null) return null;
    const result = addDays(base, Math.trunc(n));
    return { date: formatDateOnly(result), weekday: weekdayOf(result) };
  }, [fromDate, dayOffset]);

  const [dateA, setDateA] = useState(formatDateOnly(todayDateOnly()));
  const [dateB, setDateB] = useState(formatDateOnly(todayDateOnly()));
  const betweenResult = useMemo(() => {
    const a = parseDateOnly(dateA);
    const b = parseDateOnly(dateB);
    if (!a || !b) return null;
    return daysBetween(a, b);
  }, [dateA, dateB]);

  const [unixTs, setUnixTs] = useState(String(Math.floor(Date.now() / 1000)));
  const unixResult = useMemo(() => {
    const n = parseOrNull(unixTs);
    if (n === null) return null;
    const d = new Date(n * 1000);
    if (Number.isNaN(d.getTime())) return null;
    return { local: d.toLocaleString(), utc: d.toUTCString() };
  }, [unixTs]);

  const nowLocal = new Date();
  const [localDt, setLocalDt] = useState(
    `${nowLocal.getFullYear()}-${pad2(nowLocal.getMonth() + 1)}-${pad2(nowLocal.getDate())}T${pad2(
      nowLocal.getHours()
    )}:${pad2(nowLocal.getMinutes())}`
  );
  const localToUnix = useMemo(() => {
    if (!localDt) return null;
    const d = new Date(localDt);
    if (Number.isNaN(d.getTime())) return null;
    return Math.floor(d.getTime() / 1000);
  }, [localDt]);

  const [birthdate, setBirthdate] = useState("");
  const ageResult = useMemo(() => {
    const birth = parseDateOnly(birthdate);
    if (!birth) return null;
    return ageFromBirthdate(birth, todayDateOnly());
  }, [birthdate]);

  // -- timezone --
  const [tzDate, setTzDate] = useState(formatDateOnly(todayDateOnly()));
  const [tzTime, setTzTime] = useState(`${pad2(nowLocal.getHours())}:${pad2(nowLocal.getMinutes())}`);
  const [fromZone, setFromZone] = useState("America/Vancouver");
  const [toZone, setToZone] = useState("Asia/Seoul");
  const tzResult = useMemo(() => {
    if (!tzDate || !tzTime) return null;
    const [y, m, d] = tzDate.split("-").map(Number);
    const [hh, mm] = tzTime.split(":").map(Number);
    if ([y, m, d, hh, mm].some((n) => Number.isNaN(n))) return null;
    const utcMs = zonedTimeToUtcMs(y, m, d, hh, mm, fromZone);
    const parts = zonedParts(utcMs, toZone);
    const sourceDayNum = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
    const targetDayNum = Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
    return {
      time: `${pad2(parts.hour)}:${pad2(parts.minute)}`,
      date: `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`,
      weekday: zonedWeekday(utcMs, toZone),
      dayOffset: targetDayNum - sourceDayNum,
    };
  }, [tzDate, tzTime, fromZone, toZone]);

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-text-primary">Converters</h1>
        <p className="text-sm text-text-secondary">Sign in to use the converters.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <motion.h1
        className="text-2xl font-semibold tracking-tight text-text-primary flex items-center gap-2"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <ArrowsRightLeftIcon className="h-6 w-6 text-accent" />
        Converters
      </motion.h1>
      <p className="text-sm text-text-secondary">Runs locally — nothing leaves your browser.</p>

      <div className="flex flex-wrap gap-1 rounded-lg border border-border-hover bg-surface-2 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`min-h-[44px] flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-accent-500/20 text-accent-400"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-3"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "temperature" && (
        <div className={cardClass}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label htmlFor="conv-c" className="text-sm text-text-secondary">
                Celsius
              </label>
              <input
                id="conv-c"
                type="number"
                value={temp.c}
                onChange={(e) => handleTemp("c", e.target.value)}
                className={`w-full ${fieldClass}`}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="conv-f" className="text-sm text-text-secondary">
                Fahrenheit
              </label>
              <input
                id="conv-f"
                type="number"
                value={temp.f}
                onChange={(e) => handleTemp("f", e.target.value)}
                className={`w-full ${fieldClass}`}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="conv-k" className="text-sm text-text-secondary">
                Kelvin
              </label>
              <input
                id="conv-k"
                type="number"
                value={temp.k}
                onChange={(e) => handleTemp("k", e.target.value)}
                className={`w-full ${fieldClass}`}
              />
            </div>
          </div>
        </div>
      )}

      {tab === "units" && (
        <div className={cardClass}>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(DIMENSIONS) as (keyof typeof DIMENSIONS)[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => selectDimension(key)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  dimKey === key
                    ? "border-accent-500 text-accent-400"
                    : "border-border-hover text-text-tertiary hover:text-text-primary"
                }`}
              >
                {DIMENSIONS[key].label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              value={unitValue}
              onChange={(e) => setUnitValue(e.target.value)}
              className={`w-28 ${fieldClass}`}
            />
            <select value={fromUnit} onChange={(e) => setFromUnit(e.target.value)} className={fieldClass}>
              {unitNames.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <span className="text-text-tertiary">&rarr;</span>
            <input type="text" readOnly value={unitResult} className={`w-28 ${fieldClass}`} />
            <select value={toUnit} onChange={(e) => setToUnit(e.target.value)} className={fieldClass}>
              {unitNames.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {tab === "date" && (
        <div className="space-y-4">
          <div className={cardClass}>
            <h2 className="text-sm font-semibold text-accent">Days from a date</h2>
            <div className="flex flex-wrap gap-2">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className={fieldClass}
              />
              <input
                type="number"
                value={dayOffset}
                onChange={(e) => setDayOffset(e.target.value)}
                placeholder="days (negative = ago)"
                className={fieldClass}
              />
            </div>
            {offsetResult && (
              <p className="text-sm text-text-primary">
                {offsetResult.date} — {offsetResult.weekday}
              </p>
            )}
          </div>

          <div className={cardClass}>
            <h2 className="text-sm font-semibold text-accent">Days between two dates</h2>
            <div className="flex flex-wrap gap-2">
              <input type="date" value={dateA} onChange={(e) => setDateA(e.target.value)} className={fieldClass} />
              <input type="date" value={dateB} onChange={(e) => setDateB(e.target.value)} className={fieldClass} />
            </div>
            {betweenResult !== null && <p className="text-sm text-text-primary">{betweenResult} days</p>}
          </div>

          <div className={cardClass}>
            <h2 className="text-sm font-semibold text-accent">Unix timestamp &rarr; date</h2>
            <input
              type="number"
              value={unixTs}
              onChange={(e) => setUnixTs(e.target.value)}
              className={`w-full sm:w-64 ${fieldClass}`}
            />
            {unixResult && (
              <p className="text-sm text-text-primary">
                {unixResult.local}
                <br />
                <span className="text-text-tertiary">{unixResult.utc}</span>
              </p>
            )}
          </div>

          <div className={cardClass}>
            <h2 className="text-sm font-semibold text-accent">Date &rarr; Unix timestamp</h2>
            <input
              type="datetime-local"
              value={localDt}
              onChange={(e) => setLocalDt(e.target.value)}
              className={fieldClass}
            />
            {localToUnix !== null && <p className="text-sm text-text-primary">{localToUnix}</p>}
          </div>

          <div className={cardClass}>
            <h2 className="text-sm font-semibold text-accent">Age from birthdate</h2>
            <input
              type="date"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
              className={fieldClass}
            />
            {ageResult !== null && <p className="text-sm text-text-primary">{ageResult} years old</p>}
          </div>
        </div>
      )}

      {tab === "timezone" && (
        <div className={cardClass}>
          <div className="flex flex-wrap gap-2">
            <input type="date" value={tzDate} onChange={(e) => setTzDate(e.target.value)} className={fieldClass} />
            <input type="time" value={tzTime} onChange={(e) => setTzTime(e.target.value)} className={fieldClass} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ZonePicker label="From" value={fromZone} onChange={setFromZone} />
            <ZonePicker label="To" value={toZone} onChange={setToZone} />
          </div>
          {tzResult && (
            <div className="space-y-2">
              <p className="text-sm text-text-primary">
                {tzResult.time} on {tzResult.date} ({tzResult.weekday}) in {toZone}
              </p>
              {tzResult.dayOffset !== 0 && (
                <div className="rounded-md border border-accent-500/40 bg-accent-500/10 px-3 py-2 text-sm text-accent-400">
                  {tzResult.dayOffset > 0 ? "Next day" : "Previous day"} relative to the source date.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ConvertersPage;
