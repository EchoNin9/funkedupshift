/** True if matchTags satisfies the selected tag filter (AND/OR). No selection = always true. */
export function matchesTagFilter(matchTags: string[] | undefined, selected: string[], mode: "and" | "or"): boolean {
  if (selected.length === 0) return true;
  const tags = matchTags || [];
  if (tags.length === 0) return false;
  const set = new Set(tags);
  return mode === "and" ? selected.every((t) => set.has(t)) : selected.some((t) => set.has(t));
}
