export const DEFAULT_TZ = "America/Los_Angeles";

export function todayInTz(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  const safeTz = (tz || "").trim() || DEFAULT_TZ;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: safeTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  }
}

function parseUtcNoon(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

export function shiftCalendarDay(day: string, deltaDays: number): string {
  const dt = parseUtcNoon(day);
  if (!dt) return day;
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatDayChip(
  day: string,
  tz: string = DEFAULT_TZ,
  now: Date = new Date()
): { primary: string; secondary: string } {
  const utcNoon = parseUtcNoon(day);
  if (!utcNoon) return { primary: day, secondary: "" };

  const shortDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(utcNoon);

  const today = todayInTz(tz, now);
  if (day === today) return { primary: "Today", secondary: shortDate };
  if (day === shiftCalendarDay(today, -1)) return { primary: "Yesterday", secondary: shortDate };

  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
  }).format(utcNoon);
  return { primary: weekday, secondary: shortDate };
}

export function formatDayHeading(day: string): string {
  const utcNoon = parseUtcNoon(day);
  if (!utcNoon) return day;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(utcNoon);
}

export function formatItemTime(iso: string | undefined | null, tz: string = DEFAULT_TZ): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const safeTz = (tz || "").trim() || DEFAULT_TZ;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: safeTz,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: DEFAULT_TZ,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(ms));
  }
}

export function formatRelativeTime(iso: string | undefined | null, nowMs: number = Date.now()): string {
  if (!iso) return "Never";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const diffSec = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const dt = new Date(ms);
  const sameYear = dt.getUTCFullYear() === new Date(nowMs).getUTCFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(dt);
}

export function extractHost(rawUrl: string | undefined | null): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}
