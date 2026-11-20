export interface SortableFeed {
  feedId: string;
  title: string;
  pinned: boolean;
  sortOrder: number;
}

export function sortFeeds<T extends SortableFeed>(feeds: T[]): T[] {
  return [...feeds].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
  });
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
  if (sorted[fromIdx].pinned !== sorted[toIdx].pinned) return null;

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
  const swapIdx = idx + delta;
  if (swapIdx < 0 || swapIdx >= sorted.length) return null;
  if (sorted[idx].pinned !== sorted[swapIdx].pinned) return null;

  const next = [...sorted];
  const tmp = next[idx];
  next[idx] = next[swapIdx];
  next[swapIdx] = tmp;
  return reassignSortOrder(next);
}

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
