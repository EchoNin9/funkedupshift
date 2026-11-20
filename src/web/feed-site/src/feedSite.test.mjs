import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, buildFeedPath, isValidDayString } from "./router.ts";
import {
  getFeedBlock,
  groupFeedsByBlock,
  isBlockVisible,
  normalizeSoloBlocks,
  nudgeFeed,
  readStoredSoloBlocks,
  reorderFeedList,
  slugifyTitle,
  SOLO_BLOCKS_STORAGE_KEY,
  sortFeeds,
  toggleSoloBlock,
  writeStoredSoloBlocks,
} from "./feedOrder.ts";
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

test("groupFeedsByBlock splits feeds into pinned, push, and websites blocks cleanly", () => {
  const feeds = [
    { feedId: "w2", title: "Web Two", kind: "atom", pinned: false, sortOrder: 3 },
    { feedId: "p1", title: "Mox Push", kind: "push", pinned: false, sortOrder: 1 },
    { feedId: "pin-push", title: "Pinned Push", kind: "push", pinned: true, sortOrder: 2 },
    { feedId: "w1", title: "Web One", kind: "rss", pinned: false, sortOrder: 0 },
    { feedId: "p2", title: "Rally Push", kind: "push", pinned: false, sortOrder: 4 },
    { feedId: "pin-web", title: "Pinned Web", kind: "json", pinned: true, sortOrder: 0 },
  ];

  assert.equal(getFeedBlock(feeds[2]), "pinned");
  assert.equal(getFeedBlock(feeds[1]), "push");
  assert.equal(getFeedBlock(feeds[0]), "websites");
  assert.equal(getFeedBlock(feeds[3]), "websites");

  const grouped = groupFeedsByBlock(feeds);
  assert.deepEqual(
    grouped.pinned.map((f) => f.feedId),
    ["pin-web", "pin-push"]
  );
  assert.deepEqual(
    grouped.push.map((f) => f.feedId),
    ["p1", "p2"]
  );
  assert.deepEqual(
    grouped.websites.map((f) => f.feedId),
    ["w1", "w2"]
  );
});

test("solo toggle helpers support single solo, combinations, reset, and all-3 normalization", () => {
  // Default empty list shows all blocks
  let active = [];
  assert.equal(isBlockVisible("pinned", active), true);
  assert.equal(isBlockVisible("push", active), true);
  assert.equal(isBlockVisible("websites", active), true);

  // Solo only push
  active = toggleSoloBlock(active, "push");
  assert.deepEqual(active, ["push"]);
  assert.equal(isBlockVisible("pinned", active), false);
  assert.equal(isBlockVisible("push", active), true);
  assert.equal(isBlockVisible("websites", active), false);

  // Combine push + pinned -> canonical order ["pinned", "push"]
  active = toggleSoloBlock(active, "pinned");
  assert.deepEqual(active, ["pinned", "push"]);
  assert.equal(isBlockVisible("pinned", active), true);
  assert.equal(isBlockVisible("push", active), true);
  assert.equal(isBlockVisible("websites", active), false);

  // Adding the 3rd block normalizes back to [] (All)
  active = toggleSoloBlock(active, "websites");
  assert.deepEqual(active, []);
  assert.equal(isBlockVisible("websites", active), true);

  // Solo websites, then untoggle back to [] (All)
  active = toggleSoloBlock(active, "websites");
  assert.deepEqual(active, ["websites"]);
  active = toggleSoloBlock(active, "websites");
  assert.deepEqual(active, []);

  assert.deepEqual(normalizeSoloBlocks(["websites", "bogus", "push", "push"]), ["push", "websites"]);
  assert.deepEqual(normalizeSoloBlocks(["websites", "push", "pinned"]), []);
});

test("solo block persistence round-trips cleanly via Storage interface", () => {
  const data = new Map();
  const fakeStorage = {
    getItem(k) {
      return data.has(k) ? data.get(k) : null;
    },
    setItem(k, v) {
      data.set(k, String(v));
    },
    removeItem(k) {
      data.delete(k);
    },
  };

  assert.deepEqual(readStoredSoloBlocks(fakeStorage), []);

  writeStoredSoloBlocks(["websites", "pinned"], fakeStorage);
  assert.equal(data.get(SOLO_BLOCKS_STORAGE_KEY), "pinned,websites");
  assert.deepEqual(readStoredSoloBlocks(fakeStorage), ["pinned", "websites"]);

  // Unknown tokens ignored on read
  data.set(SOLO_BLOCKS_STORAGE_KEY, "push,unknown,pinned");
  assert.deepEqual(readStoredSoloBlocks(fakeStorage), ["pinned", "push"]);

  // All 3 stored collapses to empty ("All")
  data.set(SOLO_BLOCKS_STORAGE_KEY, "pinned,push,websites");
  assert.deepEqual(readStoredSoloBlocks(fakeStorage), []);

  // Writing empty or 3-of-3 removes storage key
  writeStoredSoloBlocks(["pinned", "push", "websites"], fakeStorage);
  assert.equal(data.has(SOLO_BLOCKS_STORAGE_KEY), false);
});

test("reorderFeedList blocks push/websites crosses and nudgeFeed moves within interleaved blocks", () => {
  const feeds = [
    { feedId: "p1", title: "Push 1", kind: "push", pinned: false, sortOrder: 0 },
    { feedId: "w1", title: "Web 1", kind: "rss", pinned: false, sortOrder: 1 },
    { feedId: "p2", title: "Push 2", kind: "push", pinned: false, sortOrder: 2 },
    { feedId: "w2", title: "Web 2", kind: "atom", pinned: false, sortOrder: 3 },
  ];

  // Cross-block drag between push and websites is refused
  assert.equal(reorderFeedList(feeds, "p1", "w1"), null);

  // Nudging Push 1 down jumps past interleaved Web 1 to swap relative order with Push 2
  const nudgedDown = nudgeFeed(feeds, "p1", 1);
  assert.ok(nudgedDown);
  const afterDown = groupFeedsByBlock(nudgedDown);
  assert.deepEqual(
    afterDown.push.map((f) => f.feedId),
    ["p2", "p1"]
  );
  assert.deepEqual(
    afterDown.websites.map((f) => f.feedId),
    ["w1", "w2"]
  );

  // Nudging Push 2 up from already first-in-block returns null even with Web feeds ahead of it
  assert.equal(nudgeFeed(nudgedDown, "p2", -1), null);
});
