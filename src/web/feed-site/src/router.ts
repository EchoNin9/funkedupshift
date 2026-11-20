export type Route =
  | { name: "home" }
  | { name: "feed"; feedId: string; day: string | null }
  | { name: "starred" }
  | { name: "settings" };

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDayString(raw: string | null | undefined): boolean {
  if (!raw || !DAY_RE.test(raw)) return false;
  const [, yStr, mStr, dStr] = DAY_RE.exec(raw)!;
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function safeDecode(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

export function parseRoute(pathname: string): Route {
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (clean === "/starred") return { name: "starred" };
  if (clean === "/settings") return { name: "settings" };

  if (clean.startsWith("/feed/")) {
    const rest = clean.slice("/feed/".length).split("/").filter(Boolean);
    if (rest.length >= 1) {
      const feedId = safeDecode(rest[0]);
      if (feedId) {
        const dayCandidate = rest[1] ? safeDecode(rest[1]) : null;
        return {
          name: "feed",
          feedId,
          day: isValidDayString(dayCandidate) ? dayCandidate : null,
        };
      }
    }
  }

  return { name: "home" };
}

export function buildFeedPath(feedId: string, day?: string | null): string {
  const base = `/feed/${encodeURIComponent(feedId)}`;
  if (day && isValidDayString(day)) {
    return `${base}/${day}`;
  }
  return base;
}
