/**
 * Minimal date helpers for the lipsync module. Unlike social/dateUtils.ts,
 * there's no calendar-grid concept here — just absolute timestamps.
 *
 * createdAt/updatedAt are ISO-8601 UTC strings. expiresAt is a DynamoDB TTL
 * attribute — epoch SECONDS, not milliseconds and not ISO — see the Data
 * model section of docs/lipsync-design.md.
 */

/** ISO-8601 UTC instant -> local human label, e.g. "Aug 16, 2026, 2:30 PM". */
export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
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

/** DynamoDB TTL epoch-seconds -> local human date label, e.g. "Nov 14, 2026". */
export function formatExpiry(epochSeconds: number | undefined): string {
  if (epochSeconds == null || !Number.isFinite(epochSeconds)) return "—";
  return new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * True once `expiresAt` is within the next N days — used to draw attention to
 * an approaching deletion. Retention is a compliance requirement (see
 * "Silent deletion of a user's work is a bug" in docs/lipsync-design.md), so
 * this is more than cosmetic.
 */
export function isExpiringSoon(epochSeconds: number | undefined, withinDays = 7): boolean {
  if (epochSeconds == null || !Number.isFinite(epochSeconds)) return false;
  const msRemaining = epochSeconds * 1000 - Date.now();
  return msRemaining > 0 && msRemaining <= withinDays * 24 * 60 * 60 * 1000;
}
