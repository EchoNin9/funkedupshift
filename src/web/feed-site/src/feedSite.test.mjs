import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, buildFeedPath, isValidDayString } from "./router.ts";
import { sortFeeds, reorderFeedList, nudgeFeed, slugifyTitle } from "./feedOrder.ts";
import {
  todayInTz,
  shiftCalendarDay,
  formatDayChip,
  formatDayHeading,
  formatRelativeTime,
  extractHost,
} from "./dateFormat.ts";
import { computeQuickToggleTarget } from "./theme.ts";
import { ALLOWED_HTML_ELEMENTS, isSafeHref } from "./sanitizeHtml.ts";

test("router parses and builds all feed-site paths", () => {
  assert.deepEqual(parseRoute("/"), { name: "home" });
  assert.deepEqual(parseRoute("/starred"), { name: "starred" });
  assert.deepEqual(parseRoute("/settings"), { name: "settings" });
  assert.deepEqual(parseRoute("/feed/abc-123"), { name: "feed", feedId: "abc-123", day: null });
  assert.deepEqual(parseRoute("/feed/abc-123/2026-11-19"), {
    name: "feed",
    feedId: "abc-123",
    day: "2026-11-19",
  });
  assert.deepEqual(parseRoute("/feed/abc-123/2026-02-31"), {
    name: "feed",
    feedId: "abc-123",
    day: null,
  });
  assert.deepEqual(parseRoute("/feed/a%20b/"), { name: "feed", feedId: "a b", day: null });
  assert.equal(buildFeedPath("id/1", "2026-11-19"), "/feed/id%2F1/2026-11-19");
  assert.equal(buildFeedPath("id1", "bad-day"), "/feed/id1");
  assert.equal(isValidDayString("2024-02-29"), true);
  assert.equal(isValidDayString("2025-02-29"), false);
  assert.equal(isValidDayString("0001-01-01"), false);
});

test("feedOrder sorts pinned first, reorders within pin group only, and nudges safely", () => {
  const feeds = [
    { feedId: "c", title: "Charlie", pinned: false, sortOrder: 1 },
    { feedId: "b", title: "Bravo", pinned: true, sortOrder: 2 },
    { feedId: "a", title: "Alpha", pinned: false, sortOrder: 0 },
    { feedId: "p", title: "PinFirst", pinned: true, sortOrder: 0 },
  ];

  const sorted = sortFeeds(feeds);
  assert.deepEqual(
    sorted.map((f) => f.feedId),
    ["p", "b", "a", "c"]
  );

  // Cross-group drag refused
  assert.equal(reorderFeedList(feeds, "a", "p"), null);

  // Reorder unpinned a <-> c
  const swapped = reorderFeedList(feeds, "c", "a");
  assert.ok(swapped);
  assert.deepEqual(
    swapped.map((f) => [f.feedId, f.sortOrder]),
    [
      ["p", 0],
      ["b", 1],
      ["c", 2],
      ["a", 3],
    ]
  );

  // Nudge within group & block boundary cross
  assert.equal(nudgeFeed(sorted, "b", 1), null); // would cross from pinned into unpinned
  const nudgedUp = nudgeFeed(sorted, "c", -1);
  assert.ok(nudgedUp);
  assert.deepEqual(
    nudgedUp.map((f) => f.feedId),
    ["p", "b", "c", "a"]
  );

  assert.equal(slugifyTitle("Mox · Todoist Daily!"), "mox-todoist-daily");
});

test("dateFormat computes timezone day chips and UTC-safe day headings", () => {
  const fixedNow = new Date("2026-11-19T07:30:00Z"); // 2026-11-18 23:30 PST in America/Los_Angeles
  assert.equal(todayInTz("America/Los_Angeles", fixedNow), "2026-11-18");
  assert.equal(todayInTz("UTC", fixedNow), "2026-11-19");

  assert.equal(shiftCalendarDay("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftCalendarDay("2024-03-01", -1), "2024-02-29");

  assert.deepEqual(formatDayChip("2026-11-18", "America/Los_Angeles", fixedNow), {
    primary: "Today",
    secondary: "Nov 18",
  });
  assert.deepEqual(formatDayChip("2026-11-17", "America/Los_Angeles", fixedNow), {
    primary: "Yesterday",
    secondary: "Nov 17",
  });
  assert.equal(formatDayHeading("2026-11-19"), "Thursday, November 19, 2026");

  assert.equal(formatRelativeTime("2026-11-19T07:15:00Z", fixedNow.getTime()), "15m ago");
  assert.equal(formatRelativeTime(null, fixedNow.getTime()), "Never");
  assert.equal(extractHost("https://www.example.com/feed.xml"), "example.com");
});

test("theme quick toggle removes stored override when returning to OS default", () => {
  // OS light, currently system -> user wants dark (persists "dark")
  assert.equal(computeQuickToggleTarget("system", false), "dark");
  // OS light, currently pinned dark -> user clicks back to light (returns "system", removes storage)
  assert.equal(computeQuickToggleTarget("dark", false), "system");
  // OS dark, currently system -> user wants light (persists "light")
  assert.equal(computeQuickToggleTarget("system", true), "light");
  // OS dark, currently pinned light -> user clicks back to dark (returns "system")
  assert.equal(computeQuickToggleTarget("light", true), "system");
});

test("sanitizeHtml policy strips images/scripts and blocks unsafe href schemes", () => {
  assert.equal(ALLOWED_HTML_ELEMENTS.includes("img"), false);
  assert.equal(ALLOWED_HTML_ELEMENTS.includes("script"), false);
  assert.equal(ALLOWED_HTML_ELEMENTS.includes("svg"), false);
  assert.equal(ALLOWED_HTML_ELEMENTS.includes("a"), true);

  assert.equal(isSafeHref("https://example.com"), true);
  assert.equal(isSafeHref("http://example.com"), true);
  assert.equal(isSafeHref("mailto:test@example.com"), true);
  assert.equal(isSafeHref("javascript:alert(1)"), false);
  assert.equal(isSafeHref("data:text/html,<script>"), false);
});
