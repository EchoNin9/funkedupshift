// Run: node --test src/web/tools-site/src/crontime.test.mjs (Node 22+ strips types; no build step).
// Every case uses a fixed instant and an explicit zone, never the machine's local zone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExpression, nextRuns, describe, parseTimestamp, formatTimestamp, rfc2822, relativeTime } from "./crontime.ts";

const T = (s) => Date.parse(s);
const runs = (expr, after, tz, n = 10) => nextRuns(parseExpression(expr), T(after), tz, n).runs.map((ms) => new Date(ms).toISOString());
const err = (expr) => {
  try {
    parseExpression(expr);
  } catch (e) {
    return e.message;
  }
  return null;
};

test("every 15 minutes", () => {
  assert.deepEqual(runs("*/15 * * * *", "2026-01-01T00:07:00Z", "UTC", 4), [
    "2026-01-01T00:15:00.000Z",
    "2026-01-01T00:30:00.000Z",
    "2026-01-01T00:45:00.000Z",
    "2026-01-01T01:00:00.000Z",
  ]);
});

test("a run exactly at `after` is excluded", () => {
  assert.equal(runs("0 * * * *", "2026-01-01T05:00:00Z", "UTC", 1)[0], "2026-01-01T06:00:00.000Z");
});

test("weekdays at 09:00 skip the weekend", () => {
  assert.deepEqual(runs("0 9 * * 1-5", "2026-01-02T10:00:00Z", "UTC", 2), ["2026-01-05T09:00:00.000Z", "2026-01-06T09:00:00.000Z"]);
});

test("Vixie OR: dom and dow both restricted", () => {
  // Feb 13 2026 is a Friday, so it matches both ways and appears once.
  assert.deepEqual(runs("0 0 13 * 5", "2026-02-01T00:00:00Z", "UTC", 3), ["2026-02-06T00:00:00.000Z", "2026-02-13T00:00:00.000Z", "2026-02-20T00:00:00.000Z"]);
});

test("dom restricted + dow star uses dom only", () => {
  assert.deepEqual(runs("0 0 13 * *", "2026-02-01T00:00:00Z", "UTC", 2), ["2026-02-13T00:00:00.000Z", "2026-03-13T00:00:00.000Z"]);
});

test("weekday 7 equals 0 (Sunday); names work", () => {
  const sun0 = runs("0 0 * * 0", "2026-01-01T00:00:00Z", "UTC", 2);
  assert.deepEqual(sun0, ["2026-01-04T00:00:00.000Z", "2026-01-11T00:00:00.000Z"]);
  assert.deepEqual(runs("0 0 * * 7", "2026-01-01T00:00:00Z", "UTC", 2), sun0);
  assert.deepEqual(runs("0 0 * * SUN", "2026-01-01T00:00:00Z", "UTC", 2), sun0);
  assert.equal(runs("0 0 * * MON", "2026-01-01T00:00:00Z", "UTC", 1)[0], "2026-01-05T00:00:00.000Z");
  assert.equal(runs("0 0 1 JAN *", "2026-01-01T00:00:00Z", "UTC", 1)[0], "2027-01-01T00:00:00.000Z");
});

test("macros", () => {
  assert.equal(runs("@hourly", "2026-01-01T00:30:00Z", "UTC", 1)[0], "2026-01-01T01:00:00.000Z");
  assert.equal(runs("@daily", "2026-01-01T00:30:00Z", "UTC", 1)[0], "2026-01-02T00:00:00.000Z");
  assert.equal(runs("@weekly", "2026-01-01T00:30:00Z", "UTC", 1)[0], "2026-01-04T00:00:00.000Z");
  assert.equal(runs("@monthly", "2026-01-01T00:30:00Z", "UTC", 1)[0], "2026-02-01T00:00:00.000Z");
  assert.equal(runs("@yearly", "2026-01-01T00:30:00Z", "UTC", 1)[0], "2027-01-01T00:00:00.000Z");
  assert.equal(describe(parseExpression("@annually")), describe(parseExpression("0 0 1 1 *")));
  assert.match(err("@sometimes"), /Macro/);
});

test("EventBridge last Friday of the month", () => {
  assert.deepEqual(runs("cron(0 12 ? * 6L *)", "2026-01-01T00:00:00Z", "UTC", 3), ["2026-01-30T12:00:00.000Z", "2026-02-27T12:00:00.000Z", "2026-03-27T12:00:00.000Z"]);
});

test("EventBridge first Monday (2#1)", () => {
  assert.deepEqual(runs("cron(0 8 ? * 2#1 *)", "2026-01-01T00:00:00Z", "UTC", 3), ["2026-01-05T08:00:00.000Z", "2026-02-02T08:00:00.000Z", "2026-03-02T08:00:00.000Z"]);
});

test("EventBridge last day of month (L)", () => {
  assert.deepEqual(runs("cron(0 0 L * ? *)", "2026-01-01T00:00:00Z", "UTC", 3), ["2026-01-31T00:00:00.000Z", "2026-02-28T00:00:00.000Z", "2026-03-31T00:00:00.000Z"]);
});

test("EventBridge nearest weekday (15W)", () => {
  // Aug 15 2026 is a Saturday -> Fri Aug 14. Nov 15 2026 is a Sunday -> Mon Nov 16.
  assert.equal(runs("cron(0 0 15W * ? *)", "2026-08-01T00:00:00Z", "UTC", 1)[0], "2026-08-14T00:00:00.000Z");
  assert.equal(runs("cron(0 0 15W * ? *)", "2026-11-01T00:00:00Z", "UTC", 1)[0], "2026-11-16T00:00:00.000Z");
});

test("nearest weekday never crosses a month boundary", () => {
  // Aug 1 2026 is a Saturday -> Monday Aug 3 (not Fri Jul 31). Mar 31 2024 was a Sunday -> Fri Mar 29.
  assert.equal(runs("cron(0 0 1W * ? *)", "2026-08-01T00:00:00Z", "UTC", 1)[0], "2026-08-03T00:00:00.000Z");
  assert.equal(runs("cron(0 0 31W * ? *)", "2024-03-01T00:00:00Z", "UTC", 1)[0], "2024-03-29T00:00:00.000Z");
});

test("EventBridge year list and horizon", () => {
  const r = nextRuns(parseExpression("cron(0 0 29 2 ? 2028,2032)"), T("2026-01-01T00:00:00Z"), "UTC", 10);
  assert.deepEqual(r.runs.map((ms) => new Date(ms).toISOString()), ["2028-02-29T00:00:00.000Z"]);
  assert.match(r.note, /horizon/);
  assert.deepEqual(runs("cron(0 0 1 1 ? 2030)", "2026-01-01T00:00:00Z", "UTC"), ["2030-01-01T00:00:00.000Z"]);
});

test("EventBridge default zone is UTC, standard has none", () => {
  assert.equal(parseExpression("cron(0 12 ? * 6L *)").defaultZone, "UTC");
  assert.equal(parseExpression("0 12 * * *").defaultZone, null);
});

test("EventBridge validation", () => {
  assert.match(err("cron(0 0 1 * 1 *)"), /Day-of-month \/ Day-of-week/);
  assert.match(err("cron(0 0 ? * ? *)"), /Day-of-month \/ Day-of-week/);
  assert.match(err("cron(0 0 ? * 0 *)"), /Day-of-week: 0 is out of range 1–7/);
  assert.match(err("cron(0 0 ? * 8 *)"), /Day-of-week: 8 is out of range 1–7/);
  assert.match(err("cron(0 0 ? * 2#6 *)"), /Day-of-week/);
  assert.match(err("cron(0 0 ? * ? 1969)"), /Day-of-week|Year/);
  assert.match(err("cron(0 0 1 * ? 1969)"), /Year: 1969 is out of range 1970–2199/);
  assert.match(err("cron(0 0 1 * ?)"), /Field count: expected 6 fields inside cron\(\.\.\.\), got 5/);
  assert.equal(err("cron(0 0 1 * ? *)"), null);
});

test("EventBridge day-of-week numbers are 1-7 = SUN-SAT", () => {
  // 1 = Sunday: first run after Thu 2026-01-01 is Sun Jan 4.
  assert.equal(runs("cron(0 0 ? * 1 *)", "2026-01-01T00:00:00Z", "UTC", 1)[0], "2026-01-04T00:00:00.000Z");
  assert.equal(runs("cron(0 0 ? * SAT *)", "2026-01-01T00:00:00Z", "UTC", 1)[0], "2026-01-03T00:00:00.000Z");
});

test("rate()", () => {
  const p = parseExpression("rate(5 minutes)");
  assert.equal(describe(p), "Every 5 minutes");
  const r = nextRuns(p, T("2026-01-01T00:00:00Z"), "UTC");
  assert.deepEqual(r.runs, []);
  assert.equal(r.note, "Runs every 5 minutes, starting when the rule is created.");
  assert.equal(describe(parseExpression("rate(1 hour)")), "Every hour");
  assert.match(err("rate(1 minutes)"), /singular/);
  assert.match(err("rate(5 minute)"), /plural/);
  assert.match(err("rate(0 minutes)"), /positive/);
  assert.match(err("rate(5 weeks)"), /unit/);
});

test("DST spring-forward: nonexistent wall time is skipped (America/Vancouver)", () => {
  assert.deepEqual(runs("30 2 * * *", "2026-03-07T00:00:00-08:00", "America/Vancouver", 2), ["2026-03-07T10:30:00.000Z", "2026-03-09T09:30:00.000Z"]);
});

test("DST fall-back: ambiguous wall time runs once, at the first occurrence", () => {
  const r = runs("30 1 * * *", "2026-10-31T12:00:00Z", "America/Vancouver", 3);
  // Oct 31 01:30 PDT already past; Nov 1 01:30 PDT = 08:30Z (first), then Nov 2 01:30 PST = 09:30Z.
  assert.deepEqual(r, ["2026-11-01T08:30:00.000Z", "2026-11-02T09:30:00.000Z", "2026-11-03T09:30:00.000Z"]);
});

test("zone changes the instant, not the wall time", () => {
  assert.equal(runs("0 9 * * *", "2026-01-01T00:00:00Z", "America/Vancouver", 1)[0], "2026-01-01T17:00:00.000Z");
  assert.equal(runs("0 9 * * *", "2026-01-01T00:00:00Z", "Asia/Kolkata", 1)[0], "2026-01-01T03:30:00.000Z");
});

test("never-matching schedule: zero runs, horizon note, fast", () => {
  const t0 = performance.now();
  const r = nextRuns(parseExpression("0 0 30 2 *"), T("2026-01-01T00:00:00Z"), "UTC", 10);
  assert.ok(performance.now() - t0 < 500);
  assert.deepEqual(r.runs, []);
  assert.match(r.note, /5-year search horizon/);
});

test("field errors name the field", () => {
  assert.match(err("61 * * * *"), /^Minute: 61 is out of range 0–59/);
  assert.match(err("0 24 * * *"), /^Hour: 24/);
  assert.match(err("0 0 32 * *"), /^Day-of-month: 32 is out of range 1–31/);
  assert.match(err("0 0 1 13 *"), /^Month: 13/);
  assert.match(err("0 0 1 * 8"), /^Day-of-week: 8/);
  assert.match(err("* * * *"), /^Field count: expected 5 fields or cron\(\.\.\.\) with 6, got 4/);
  assert.match(err("*/0 * * * *"), /^Minute: step/);
  assert.match(err("5-2 * * * *"), /^Minute: 5-2 is a reversed range/);
  assert.match(err(""), /Expression/);
});

test("descriptions", () => {
  assert.equal(describe(parseExpression("*/15 * * * *")), "Every 15 minutes");
  assert.equal(describe(parseExpression("0 9 * * 1-5")), "At 09:00, Monday through Friday");
  assert.equal(describe(parseExpression("0 0 1 * *")), "At 00:00 on day 1 of the month");
  const eb = describe(parseExpression("cron(0 12 ? * 6L *)"));
  assert.match(eb, /last Friday of the month/);
  assert.match(eb, /At 12:00/);
  assert.match(describe(parseExpression("0 0 13 * 5")), /day 13 of the month, or on Friday/);
  assert.match(describe(parseExpression("30 8,17 * * *")), /At 08:30, 17:30/);
});

test("timestamp: seconds vs milliseconds", () => {
  const s = parseTimestamp("1700000000");
  assert.equal(s.as, "seconds");
  assert.equal(s.auto, true);
  assert.equal(new Date(s.ms).toISOString(), "2023-11-14T22:13:20.000Z");
  const ms = parseTimestamp("1700000000000");
  assert.equal(ms.as, "milliseconds");
  assert.equal(ms.ms, s.ms);
  // override
  assert.equal(parseTimestamp("1700000000000", "s").as, "seconds");
  assert.equal(parseTimestamp("1700000000", "ms").ms, 1700000000);
  assert.equal(parseTimestamp("1700000000", "ms").auto, false);
});

test("timestamp: date strings and errors", () => {
  assert.equal(parseTimestamp("2023-11-14T22:13:20Z").ms, 1700000000000);
  assert.equal(parseTimestamp("2023-11-14T22:13:20Z").as, "date");
  assert.throws(() => parseTimestamp("not a date"), /Timestamp/);
  assert.throws(() => parseTimestamp(""), /Timestamp/);
});

test("timestamp: outputs", () => {
  const ms = 1700000000000;
  assert.equal(rfc2822(ms, "UTC"), "Tue, 14 Nov 2023 22:13:20 +0000");
  assert.equal(rfc2822(ms, "America/Vancouver"), "Tue, 14 Nov 2023 14:13:20 -0800");
  assert.equal(rfc2822(ms, "Asia/Kolkata"), "Wed, 15 Nov 2023 03:43:20 +0530");
  const o = formatTimestamp(ms, "UTC", ms);
  assert.equal(o.seconds, "1700000000");
  assert.equal(o.millis, "1700000000000");
  assert.equal(o.iso, "2023-11-14T22:13:20.000Z");
  assert.equal(o.local, "Tue 2023-11-14 22:13:20 (UTC+00:00)");
  assert.equal(o.relative, "now");
});

test("relative time picks the largest whole unit", () => {
  const now = 1700000000000;
  assert.equal(relativeTime(now - 2 * 3600e3, now), "2 hours ago");
  assert.equal(relativeTime(now + 3 * 86400e3, now), "in 3 days");
  assert.equal(relativeTime(now + 90e3, now), "in 1 minute");
  assert.equal(relativeTime(now - 400 * 86400e3, now), "last year");
});
