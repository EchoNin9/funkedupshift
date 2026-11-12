// File Drop pure helpers (FUNK-76). Byte-identical copy lives at
// src/web/spa/src/features/files/filedrop.ts (CI drift guard) — edit both.
// Type-strippable TS only so node --test can import it directly.

export interface PartRange {
  partNumber: number;
  /** Inclusive byte offset. */
  start: number;
  /** Exclusive byte offset. */
  end: number;
}

/** Split `size` bytes into 1-based parts of `partSize`; the last is the remainder. */
export function partRanges(size: number, partSize: number): PartRange[] {
  const out: PartRange[] = [];
  for (let start = 0, n = 1; start < size; start += partSize, n++) {
    out.push({ partNumber: n, start, end: Math.min(start + partSize, size) });
  }
  return out;
}

const UNITS = ["B", "KB", "MB", "GB"];

/** 1024-based, one decimal above bytes: 1536 -> "1.5 KB". */
export function formatBytes(n: number): string {
  let value = Math.max(0, n);
  let i = 0;
  while (i < UNITS.length - 1 && value >= 1024) {
    value /= 1024;
    i++;
  }
  if (i === 0) return `${Math.round(value)} B`;
  // 1048575 B is 1023.999 KB: rounding would print "1024.0 KB", so bump the unit.
  if (Number(value.toFixed(1)) >= 1024 && i < UNITS.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${UNITS[i]}`;
}

/** Backoff before retry `attempt` (1-based): 1s, 2s, 4s. */
export function retryDelayMs(attempt: number): number {
  return 1000 * 2 ** (Math.max(1, attempt) - 1);
}

export function shareUrlFor(id: string): string {
  return `https://tools.e9.cx/f/${id}`;
}

function plural(n: number, unit: string): string {
  return `in ${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** "in 6 days" / "in 45 minutes" / "expired". Rounds down; under a minute is "in 1 minute". */
export function expiryLabel(expiresAtEpochSeconds: number, nowMs: number): string {
  const secs = Math.floor(expiresAtEpochSeconds - nowMs / 1000);
  if (secs <= 0) return "expired";
  if (secs < 3600) return plural(Math.max(1, Math.floor(secs / 60)), "minute");
  if (secs < 86400) return plural(Math.floor(secs / 3600), "hour");
  return plural(Math.floor(secs / 86400), "day");
}
