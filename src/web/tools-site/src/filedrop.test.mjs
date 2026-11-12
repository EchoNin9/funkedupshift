// Run: node --test src/web/tools-site/src/filedrop.test.mjs (Node 22+ strips types; no build step).
import { test } from "node:test";
import assert from "node:assert/strict";
import { partRanges, formatBytes, retryDelayMs, shareUrlFor, expiryLabel } from "./filedrop.ts";

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const PART = 16 * MiB;

test("partRanges: 1 byte is one 1-byte part", () => {
  assert.deepEqual(partRanges(1, PART), [{ partNumber: 1, start: 0, end: 1 }]);
});

test("partRanges: exactly 16 MiB is one part", () => {
  assert.deepEqual(partRanges(PART, PART), [{ partNumber: 1, start: 0, end: PART }]);
});

test("partRanges: 16 MiB + 1 leaves a 1-byte tail part", () => {
  assert.deepEqual(partRanges(PART + 1, PART), [
    { partNumber: 1, start: 0, end: PART },
    { partNumber: 2, start: PART, end: PART + 1 }
  ]);
});

test("partRanges: 5 GiB is 320 contiguous parts summing to size", () => {
  const parts = partRanges(5 * GiB, PART);
  assert.equal(parts.length, 320);
  assert.equal(parts[0].start, 0);
  parts.forEach((p, i) => {
    assert.equal(p.partNumber, i + 1);
    if (i > 0) assert.equal(p.start, parts[i - 1].end);
  });
  assert.equal(parts[319].end, 5 * GiB);
  assert.equal(parts.reduce((s, p) => s + (p.end - p.start), 0), 5 * GiB);
});

test("formatBytes boundaries", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1048575), "1.0 MB");
  assert.equal(formatBytes(MiB), "1.0 MB");
  assert.equal(formatBytes(GiB), "1.0 GB");
  assert.equal(formatBytes(5 * GiB), "5.0 GB");
});

test("retryDelayMs backs off 1s, 2s, 4s", () => {
  assert.deepEqual([1, 2, 3].map(retryDelayMs), [1000, 2000, 4000]);
});

test("shareUrlFor", () => {
  assert.equal(shareUrlFor("abc_1"), "https://tools.e9.cx/f/abc_1");
});

test("expiryLabel", () => {
  const now = 1_700_000_000_000;
  const s = now / 1000;
  assert.equal(expiryLabel(s - 1, now), "expired");
  assert.equal(expiryLabel(s, now), "expired");
  assert.equal(expiryLabel(s + 30, now), "in 1 minute");
  assert.equal(expiryLabel(s + 45 * 60, now), "in 45 minutes");
  assert.equal(expiryLabel(s + 3 * 3600, now), "in 3 hours");
  assert.equal(expiryLabel(s + 6 * 86400 + 100, now), "in 6 days");
  assert.equal(expiryLabel(s + 86400, now), "in 1 day");
});
