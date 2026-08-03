/**
 * Date helpers for the social scheduler. No date library — native Date + Intl only.
 *
 * Timezone boundary: the API speaks UTC ISO-8601 with a trailing "Z". The UI
 * always displays local time. `scheduledAt` strings from the API are parsed
 * with `new Date(iso)` (which yields the correct instant regardless of TZ) and
 * then rendered with local formatting. Local `datetime-local` input values are
 * converted back to UTC with `.toISOString()` right before they leave the UI.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM" for the given date, in LOCAL time (used to bucket calendar days into API months). */
export function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function parseMonthKey(monthKey: string): { year: number; month: number } {
  const [y, m] = monthKey.split("-").map(Number);
  return { year: y, month: (m || 1) - 1 };
}

/** Shift a "YYYY-MM" key by `delta` months. */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const { year, month } = parseMonthKey(monthKey);
  const d = new Date(year, month + delta, 1);
  return monthKeyFromDate(d);
}

export function formatMonthLabel(monthKey: string): string {
  const { year, month } = parseMonthKey(monthKey);
  const d = new Date(year, month, 1);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** "YYYY-MM-DD" for a date in LOCAL time — used as a stable per-day bucket key. */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return localDayKey(a) === localDayKey(b);
}

/**
 * Build a Monday-start month grid: an array of weeks, each an array of 7 local
 * Date objects (midnight local), including leading/trailing days from the
 * adjacent months so every week is full.
 */
export function buildMonthGrid(monthKey: string): Date[][] {
  const { year, month } = parseMonthKey(monthKey);
  const firstOfMonth = new Date(year, month, 1);
  // getDay(): 0=Sun..6=Sat. Convert to Monday-start offset (0=Mon..6=Sun).
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - mondayOffset);

  const weeks: Date[][] = [];
  let cursor = gridStart;
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(cursor);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }
    weeks.push(week);
    // Stop once we've completed the month and filled its trailing week.
    if (cursor.getMonth() !== month && week[6].getMonth() !== month) break;
  }
  return weeks;
}

export const WEEKDAY_LABELS = (() => {
  // Monday-start weekday initials, locale-aware.
  const base = new Date(2024, 0, 1); // a Monday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2024, 0, 1 + i);
    return d.toLocaleDateString(undefined, { weekday: "short" });
  });
})();

/** <input type="datetime-local"> value (local time) -> UTC ISO-8601 string with a Z. Null if invalid. */
export function localInputToUtcIso(value: string): string | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/** UTC ISO string -> <input type="datetime-local"> value in LOCAL time. */
export function utcIsoToLocalInput(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Human label for a resolved UTC instant, e.g. "2026-08-02 18:00 UTC". */
export function formatUtcLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** Human label for a UTC ISO instant, rendered in local time. */
export function formatLocalDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Short local time only, e.g. "6:00 PM" — for calendar chips. */
export function formatLocalTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
