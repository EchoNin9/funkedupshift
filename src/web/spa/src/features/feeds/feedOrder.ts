export type FeedBlock = "pinned" | "push" | "websites";

export const FEED_BLOCK_ORDER: readonly FeedBlock[] = ["pinned", "push", "websites"];

export const FEED_BLOCK_LABELS: Record<FeedBlock, string> = {
  pinned: "Pinned",
  push: "Push",
  websites: "Websites",
};

export const SOLO_BLOCKS_STORAGE_KEY = "feed_site_solo_blocks";

export interface SortableFeed {
  feedId: string;
  title: string;
  pinned: boolean;
  sortOrder: number;
  kind?: string;
}

export function getFeedBlock(feed: Pick<SortableFeed, "pinned" | "kind">): FeedBlock {
  if (feed.pinned) return "pinned";
  if (feed.kind === "push") return "push";
  return "websites";
}

export function sortFeeds<T extends SortableFeed>(feeds: T[]): T[] {
  return [...feeds].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
  });
}

export function groupFeedsByBlock<T extends SortableFeed>(feeds: T[]): Record<FeedBlock, T[]> {
  const grouped: Record<FeedBlock, T[]> = {
    pinned: [],
    push: [],
    websites: [],
  };
  for (const feed of sortFeeds(feeds)) {
    grouped[getFeedBlock(feed)].push(feed);
  }
  return grouped;
}

export function normalizeSoloBlocks(blocks: Iterable<string>): FeedBlock[] {
  const seen = new Set<FeedBlock>();
  for (const raw of blocks) {
    const trimmed = raw.trim();
    if (trimmed === "pinned" || trimmed === "push" || trimmed === "websites") {
      seen.add(trimmed);
    }
  }
  if (seen.size === 0 || seen.size === FEED_BLOCK_ORDER.length) {
    return [];
  }
  return FEED_BLOCK_ORDER.filter((block) => seen.has(block));
}

export function toggleSoloBlock(current: readonly FeedBlock[], block: FeedBlock): FeedBlock[] {
  if (current.includes(block)) {
    return normalizeSoloBlocks(current.filter((b) => b !== block));
  }
  return normalizeSoloBlocks([...current, block]);
}

export function isBlockVisible(block: FeedBlock, soloBlocks: readonly FeedBlock[]): boolean {
  return soloBlocks.length === 0 || soloBlocks.includes(block);
}

export function readStoredSoloBlocks(
  storage: Pick<Storage, "getItem"> | null | undefined = undefined
): FeedBlock[] {
  try {
    const store =
      storage === undefined ? (typeof window !== "undefined" ? window.localStorage : null) : storage;
    const raw = store?.getItem(SOLO_BLOCKS_STORAGE_KEY);
    if (!raw) return [];
    return normalizeSoloBlocks(raw.split(","));
  } catch {
    return [];
  }
}

export function writeStoredSoloBlocks(
  blocks: readonly FeedBlock[],
  storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined = undefined
): void {
  const normalized = normalizeSoloBlocks(blocks);
  try {
    const store =
      storage === undefined ? (typeof window !== "undefined" ? window.localStorage : null) : storage;
    if (!store) return;
    if (normalized.length === 0) {
      store.removeItem(SOLO_BLOCKS_STORAGE_KEY);
    } else {
      store.setItem(SOLO_BLOCKS_STORAGE_KEY, normalized.join(","));
    }
  } catch {
    // Ignore storage write errors in restricted privacy contexts
  }
}

function reassignSortOrder<T extends SortableFeed>(ordered: T[]): T[] {
  return ordered.map((feed, idx) => ({ ...feed, sortOrder: idx }));
}

export function reorderFeedList<T extends SortableFeed>(
  feeds: T[],
  draggedId: string,
  targetId: string
): T[] | null {
  if (!draggedId || !targetId || draggedId === targetId) return null;
  const sorted = sortFeeds(feeds);
  const fromIdx = sorted.findIndex((f) => f.feedId === draggedId);
  const toIdx = sorted.findIndex((f) => f.feedId === targetId);
  if (fromIdx < 0 || toIdx < 0) return null;
  if (getFeedBlock(sorted[fromIdx]) !== getFeedBlock(sorted[toIdx])) return null;

  const next = [...sorted];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return reassignSortOrder(next);
}

export function nudgeFeed<T extends SortableFeed>(
  feeds: T[],
  feedId: string,
  delta: -1 | 1
): T[] | null {
  const sorted = sortFeeds(feeds);
  const idx = sorted.findIndex((f) => f.feedId === feedId);
  if (idx < 0) return null;

  const block = getFeedBlock(sorted[idx]);
  let targetIdx = -1;
  for (let i = idx + delta; i >= 0 && i < sorted.length; i += delta) {
    if (getFeedBlock(sorted[i]) === block) {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx < 0) return null;

  return reorderFeedList(sorted, feedId, sorted[targetIdx].feedId);
}

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
