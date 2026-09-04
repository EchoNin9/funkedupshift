/**
 * Money helpers for the lipsync module. Every amount the API returns is an
 * integer number of cents (see docs/lipsync-design.md's "Budgets and spend
 * control" section) -- never floats, and never do float maths on money.
 * These helpers are the one place cents get turned into a "$X.XX" string or
 * back; call sites should never reach for a raw `toFixed(2)`.
 */

/**
 * Integer cents -> "$12.53" (or "-$12.53" for a negative amount). Rounds to
 * the nearest cent, which is a no-op for the already-integer values this API
 * returns -- the rounding exists only as a defensive backstop.
 *
 * Returns "—" for a missing/non-finite value so callers can pass an
 * optional field straight through without a null check at every call site.
 */
export function formatCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  const rounded = Math.round(cents);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const formatted = `$${dollars.toLocaleString()}.${String(remainder).padStart(2, "0")}`;
  return negative ? `-${formatted}` : formatted;
}

/**
 * Same as `formatCents`, but floors instead of rounds and clamps negative
 * values to zero. Use this specifically for a "remaining budget" figure --
 * see the edge case in the lipsync budgets spec: never display a remaining
 * amount that reads as more than the user actually has.
 */
export function formatCentsRemaining(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  if (cents <= 0) return formatCents(0);
  return formatCents(Math.floor(cents));
}

/**
 * Dollar-input string (e.g. from an admin's "12.50" text field) -> integer
 * cents, or null when the input isn't a valid non-negative amount. Rounds
 * rather than truncates so "12.505" (a typo, but not our job to reject)
 * lands on the nearer cent instead of silently dropping it.
 */
export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim().replace(/^\$/, "");
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Integer cents -> a bare dollar string for a number input's value, e.g. 1250 -> "12.50". */
export function centsToDollarsInput(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}
