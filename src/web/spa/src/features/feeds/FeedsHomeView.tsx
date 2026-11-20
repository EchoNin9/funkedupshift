import React, { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowsClockwise,
  ArrowUp,
  DotsSixVertical,
  GearSix,
  PencilSimple,
  Plus,
  PushPin,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { Alert } from "../../components/Alert";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import type { Feed } from "./api";
import { extractHost, formatRelativeTime } from "./dateFormat";
import { FeedModal } from "./FeedModal";
import {
  FEED_BLOCK_LABELS,
  FEED_BLOCK_ORDER,
  getFeedBlock,
  groupFeedsByBlock,
  isBlockVisible,
  nudgeFeed,
  reorderFeedList,
  type FeedBlock,
} from "./feedOrder";
import { useFeedsContext } from "./FeedsLayout";

function kindBadgeClass(kind: Feed["kind"]): string {
  if (kind === "push") {
    return "bg-accent/15 text-accent-text border-accent/25";
  }
  return "bg-surface-3 text-text-secondary border-[color:var(--color-divider)]";
}

export const FeedsHomeView: React.FC = () => {
  const {
    feeds,
    feedsLoading,
    feedsError,
    soloBlocks,
    loadFeeds,
    toggleSoloBlock,
    resetSoloBlocks,
    togglePin,
    commitOrder,
    refreshFeed,
    renameFeed,
    deleteFeed,
    openAddModal,
  } = useFeedsContext();

  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [refreshingIds, setRefreshingIds] = useState<Record<string, boolean>>({});
  const [refreshBadges, setRefreshBadges] = useState<Record<string, string>>({});
  const [renameTarget, setRenameTarget] = useState<Feed | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Feed | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const listRegionId = useId();
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  const hasFeeds = feeds.length > 0;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Roving-tabindex fallback strictly when native `focusgroup` is unsupported.
  useEffect(() => {
    const bar = toolbarRef.current;
    if (!hasFeeds || !bar || "focusGroup" in HTMLElement.prototype) return;

    const items = Array.from(bar.querySelectorAll<HTMLButtonElement>("button"));
    if (items.length === 0) return;

    const existingZero = items.findIndex((b) => b.tabIndex === 0);
    const activeIdx = existingZero >= 0 ? existingZero : 0;
    items.forEach((b, i) => {
      b.tabIndex = i === activeIdx ? 0 : -1;
    });

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (target instanceof HTMLButtonElement && items.includes(target)) {
        items.forEach((b) => {
          b.tabIndex = b === target ? 0 : -1;
        });
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement;
      const idx = active instanceof HTMLButtonElement ? items.indexOf(active) : -1;
      if (idx < 0) return;

      const rtl = getComputedStyle(bar).direction === "rtl";
      let nextIdx = -1;
      if (e.key === "ArrowRight") {
        nextIdx = (idx + (rtl ? -1 : 1) + items.length) % items.length;
      } else if (e.key === "ArrowLeft") {
        nextIdx = (idx + (rtl ? 1 : -1) + items.length) % items.length;
      } else if (e.key === "Home") {
        nextIdx = 0;
      } else if (e.key === "End") {
        nextIdx = items.length - 1;
      }

      if (nextIdx >= 0) {
        e.preventDefault();
        items[nextIdx].focus();
      }
    };

    bar.addEventListener("focusin", onFocusIn);
    bar.addEventListener("keydown", onKeyDown);
    return () => {
      bar.removeEventListener("focusin", onFocusIn);
      bar.removeEventListener("keydown", onKeyDown);
    };
  }, [hasFeeds]);

  const grouped = groupFeedsByBlock(feeds);
  const visibleBlocks = FEED_BLOCK_ORDER.filter(
    (block) => isBlockVisible(block, soloBlocks) && grouped[block].length > 0
  );

  const handleDropOn = async (targetFeed: Feed) => {
    const sourceId = dragId;
    setDragId(null);
    setOverId(null);
    if (!sourceId || sourceId === targetFeed.feedId) return;
    const reordered = reorderFeedList(feeds, sourceId, targetFeed.feedId);
    if (reordered) {
      await commitOrder(reordered);
    }
  };

  const handleNudge = async (feedId: string, delta: -1 | 1) => {
    const reordered = nudgeFeed(feeds, feedId, delta);
    if (reordered) {
      await commitOrder(reordered);
    }
  };

  const handleRefresh = async (feed: Feed) => {
    setRefreshingIds((prev) => ({ ...prev, [feed.feedId]: true }));
    try {
      const res = await refreshFeed(feed);
      if (res && mountedRef.current) {
        const msg = res.itemsAdded > 0 ? `+${res.itemsAdded} new` : "Up to date";
        setRefreshBadges((prev) => ({ ...prev, [feed.feedId]: msg }));
      }
    } catch {
      // FeedsLayout sets feedsError banner cleanly
    } finally {
      if (mountedRef.current) {
        setRefreshingIds((prev) => ({ ...prev, [feed.feedId]: false }));
      }
    }
  };

  const submitRename: React.FormEventHandler = async (e) => {
    e.preventDefault();
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed.length > 120) return;
    setRenameSaving(true);
    setRenameError(null);
    try {
      await renameFeed(renameTarget, trimmed);
      if (mountedRef.current) {
        setRenameTarget(null);
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        setRenameError((err as { message?: string })?.message || "Could not rename feed.");
      }
    } finally {
      if (mountedRef.current) setRenameSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    setDeleteError(null);
    try {
      await deleteFeed(deleteTarget);
      if (mountedRef.current) {
        setDeleteTarget(null);
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        setDeleteError((err as { message?: string })?.message || "Could not delete feed.");
      }
    } finally {
      if (mountedRef.current) setDeleteSaving(false);
    }
  };

  const chipBtnClass = `inline-flex min-h-[32px] items-center gap-1 rounded-ds-sm border border-[color:var(--color-divider)] bg-surface-1 px-2.5 py-1 text-xs font-semibold text-text-secondary transition-colors hover:border-[color:var(--color-border-strong)] hover:bg-surface-3 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`;

  const renderGroup = (groupFeeds: Feed[], sectionLabel: string, blockKey: FeedBlock) => (
    <section key={blockKey} className="space-y-2.5" aria-label={sectionLabel}>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
        {sectionLabel}
      </h2>
      <ul className="space-y-2.5">
        {groupFeeds.map((feed, idx) => {
          const canMoveUp = idx > 0;
          const canMoveDown = idx < groupFeeds.length - 1;
          const isOver = overId === feed.feedId && dragId !== feed.feedId;
          const isDragging = dragId === feed.feedId;
          const isRefreshing = !!refreshingIds[feed.feedId];
          const badge = refreshBadges[feed.feedId];
          const subLabel =
            feed.kind === "push"
              ? `push/${feed.slug || "archive"}`
              : extractHost(feed.siteUrl || feed.url) || feed.url || "";

          return (
            <li
              key={feed.feedId}
              draggable={groupFeeds.length > 1}
              onDragStart={(e) => {
                setDragId(feed.feedId);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", feed.feedId);
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                const dragged = feeds.find((f) => f.feedId === dragId);
                if (!dragged || getFeedBlock(dragged) !== getFeedBlock(feed)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overId !== feed.feedId) setOverId(feed.feedId);
              }}
              onDragLeave={(e) => {
                if (
                  overId === feed.feedId &&
                  !e.currentTarget.contains(e.relatedTarget as Node | null)
                ) {
                  setOverId(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                void handleDropOn(feed);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              className={`flex flex-col gap-3 rounded-ds-lg border bg-surface-2 p-3.5 transition-colors sm:flex-row sm:items-center ${
                isDragging ? "opacity-55" : ""
              } ${
                isOver
                  ? "border-accent ring-2 ring-accent/30"
                  : "border-[color:var(--color-divider)] hover:border-[color:var(--color-border-strong)]"
              }`}
            >
              <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:items-center">
                {groupFeeds.length > 1 && (
                  <div className="flex shrink-0 items-center gap-1 pt-0.5 sm:pt-0">
                    <span
                      className="cursor-grab text-text-tertiary active:cursor-grabbing"
                      aria-hidden="true"
                      title="Drag to reorder"
                    >
                      <DotsSixVertical size={16} weight="bold" />
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        className={`grid h-6 w-6 place-items-center rounded border border-[color:var(--color-divider)] bg-surface-1 text-text-secondary transition-colors hover:border-[color:var(--color-border-strong)] hover:bg-surface-3 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35 ${focusRing}`}
                        onClick={() => void handleNudge(feed.feedId, -1)}
                        disabled={!canMoveUp}
                        aria-label={`Move ${feed.title} up`}
                        title="Move up"
                      >
                        <ArrowUp size={12} weight="bold" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={`grid h-6 w-6 place-items-center rounded border border-[color:var(--color-divider)] bg-surface-1 text-text-secondary transition-colors hover:border-[color:var(--color-border-strong)] hover:bg-surface-3 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35 ${focusRing}`}
                        onClick={() => void handleNudge(feed.feedId, 1)}
                        disabled={!canMoveDown}
                        aria-label={`Move ${feed.title} down`}
                        title="Move down"
                      >
                        <ArrowDown size={12} weight="bold" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                )}

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/feeds/feed/${encodeURIComponent(feed.feedId)}`}
                      draggable={false}
                      className={`min-w-0 break-words font-display text-base font-semibold text-text-primary hover:text-accent-text hover:underline ${focusRing} rounded-sm`}
                    >
                      {feed.title}
                    </Link>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide ${kindBadgeClass(feed.kind)}`}
                    >
                      {feed.kind}
                    </span>
                    {feed.todayCount > 0 && (
                      <span className="inline-flex items-center rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent-text">
                        {feed.todayCount} today
                      </span>
                    )}
                    {badge && (
                      <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
                        {badge}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                    {subLabel && (
                      <span className="max-w-full truncate font-mono text-[11px] text-text-tertiary">
                        {subLabel}
                      </span>
                    )}
                    <span>
                      {feed.kind === "push" ? "Last push " : "Fetched "}
                      {formatRelativeTime(feed.lastFetchedAt)}
                    </span>
                    {feed.lastItemAt && (
                      <span>Latest entry {formatRelativeTime(feed.lastItemAt)}</span>
                    )}
                  </div>

                  {feed.lastError && (
                    <p
                      className="m-0 flex items-center gap-1.5 text-xs text-danger"
                      title={feed.lastError}
                    >
                      <WarningCircle size={14} weight="fill" className="shrink-0" aria-hidden="true" />
                      <span className="truncate">Fetch issue: {feed.lastError}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:justify-end">
                <button
                  type="button"
                  onClick={() => void togglePin(feed)}
                  aria-pressed={feed.pinned}
                  title={feed.pinned ? "Unpin feed" : "Pin feed to top"}
                  className={
                    feed.pinned
                      ? `inline-flex min-h-[32px] items-center gap-1 rounded-ds-sm border border-accent/40 bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent-text transition-colors hover:bg-accent/25 ${focusRing}`
                      : chipBtnClass
                  }
                >
                  <PushPin
                    size={13}
                    weight={feed.pinned ? "fill" : "regular"}
                    aria-hidden="true"
                  />
                  <span>{feed.pinned ? "Pinned" : "Pin"}</span>
                </button>

                {feed.kind !== "push" && (
                  <button
                    type="button"
                    className={chipBtnClass}
                    onClick={() => void handleRefresh(feed)}
                    disabled={isRefreshing}
                    title="Fetch latest items now"
                  >
                    <ArrowsClockwise
                      size={13}
                      weight="bold"
                      className={isRefreshing ? "motion-safe:animate-spin" : ""}
                      aria-hidden="true"
                    />
                    <span>{isRefreshing ? "Refreshing…" : "Refresh"}</span>
                  </button>
                )}

                <button
                  type="button"
                  className={chipBtnClass}
                  onClick={() => {
                    setRenameError(null);
                    setRenameTarget(feed);
                    setRenameValue(feed.title);
                  }}
                >
                  <PencilSimple size={13} weight="regular" aria-hidden="true" />
                  <span>Rename</span>
                </button>

                <button
                  type="button"
                  className={`inline-flex min-h-[32px] items-center gap-1 rounded-ds-sm border border-danger/35 bg-surface-1 px-2.5 py-1 text-xs font-semibold text-danger transition-colors hover:bg-danger/10 ${focusRing}`}
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteTarget(feed);
                  }}
                >
                  <Trash size={13} weight="regular" aria-hidden="true" />
                  <span>Delete</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );

  return (
    <div className="space-y-5">
      {feedsError && (
        <Alert variant="error" className="flex flex-wrap items-center justify-between gap-2">
          <span>{feedsError}</span>
          <button
            type="button"
            className="font-semibold underline underline-offset-2 hover:opacity-80"
            onClick={() => void loadFeeds()}
          >
            Retry
          </button>
        </Alert>
      )}

      {feedsLoading && feeds.length === 0 ? (
        <div
          className="flex min-h-[28vh] items-center justify-center rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-8 text-sm text-text-secondary"
          role="status"
        >
          Loading your feeds…
        </div>
      ) : feeds.length === 0 ? (
        <section className="space-y-3 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <h2 className="font-display text-lg font-semibold text-text-primary">
            Your reader is empty
          </h2>
          <p className="m-0 max-w-xl text-sm text-text-secondary">
            Add any website, RSS/Atom/JSON feed URL, or create a push archive for daily summaries
            from Mox, qwer, and Rally.
          </p>
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button type="button" className={buttonClasses("primary", "md")} onClick={openAddModal}>
              <Plus size={15} weight="bold" aria-hidden="true" />
              <span>Add your first feed</span>
            </button>
            <Link to="/feeds/settings" className={buttonClasses("secondary", "md")}>
              <GearSix size={15} weight="regular" aria-hidden="true" />
              <span>Configure API keys</span>
            </Link>
          </div>
        </section>
      ) : (
        <>
          <div
            ref={toolbarRef}
            role="toolbar"
            {...({ focusgroup: "toolbar wrap" } as Record<string, string>)}
            aria-label="Filter feed blocks"
            aria-controls={listRegionId}
            className="feeds-filter-toolbar"
          >
            <button
              type="button"
              className="feeds-filter-toggle"
              aria-pressed={soloBlocks.length === 0}
              onClick={resetSoloBlocks}
            >
              <span>All</span>{" "}
              <span className="feeds-filter-count">{feeds.length}</span>
            </button>
            <span role="separator" aria-orientation="vertical" className="feeds-toolbar-sep" />
            <div role="group" aria-label="Solo feed blocks" className="feeds-filter-toggle-group">
              {FEED_BLOCK_ORDER.map((block) => (
                <button
                  key={block}
                  type="button"
                  className="feeds-filter-toggle"
                  aria-pressed={soloBlocks.includes(block)}
                  onClick={() => toggleSoloBlock(block)}
                >
                  <span>{FEED_BLOCK_LABELS[block]}</span>{" "}
                  <span className="feeds-filter-count">{grouped[block].length}</span>
                </button>
              ))}
            </div>
          </div>

          <div id={listRegionId} className="space-y-6">
            {visibleBlocks.length > 0 ? (
              visibleBlocks.map((block) =>
                renderGroup(grouped[block], FEED_BLOCK_LABELS[block], block)
              )
            ) : (
              <section className="space-y-3 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
                <h2 className="font-display text-lg font-semibold text-text-primary">
                  No matching feeds
                </h2>
                <p className="m-0 text-sm text-text-secondary">
                  No feeds in {soloBlocks.map((b) => FEED_BLOCK_LABELS[b]).join(" + ")} yet.
                </p>
                <div className="pt-1">
                  <button
                    type="button"
                    className={buttonClasses("secondary", "sm")}
                    onClick={resetSoloBlocks}
                  >
                    Show all feeds
                  </button>
                </div>
              </section>
            )}
          </div>
        </>
      )}

      <FeedModal
        open={renameTarget !== null}
        onClose={() => {
          if (!renameSaving) {
            setRenameError(null);
            setRenameTarget(null);
          }
        }}
        title="Rename feed"
        closedBy={renameSaving ? "none" : "any"}
      >
        <form className="flex flex-col gap-3.5" onSubmit={submitRename}>
          <div className="field">
            <label htmlFor="feeds-rename-input">Feed title</label>
            <input
              id="feeds-rename-input"
              type="text"
              maxLength={120}
              className="input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              disabled={renameSaving}
              data-autofocus=""
              autoFocus
              required
            />
          </div>
          {renameError && <Alert variant="error">{renameError}</Alert>}
          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              className={buttonClasses("secondary", "md")}
              onClick={() => {
                setRenameError(null);
                setRenameTarget(null);
              }}
              disabled={renameSaving}
            >
              Cancel
            </button>
            <button type="submit" className={buttonClasses("primary", "md")} disabled={renameSaving}>
              {renameSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </FeedModal>

      <FeedModal
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleteSaving) {
            setDeleteError(null);
            setDeleteTarget(null);
          }
        }}
        title="Delete feed?"
        closedBy={deleteSaving ? "none" : "closerequest"}
      >
        <p className="m-0 text-sm text-text-secondary">
          Delete <strong className="text-text-primary">{deleteTarget?.title}</strong> and its
          archived items? Any items you starred remain in your Starred list.
        </p>
        {deleteError && <Alert variant="error">{deleteError}</Alert>}
        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            className={buttonClasses("secondary", "md")}
            onClick={() => {
              setDeleteError(null);
              setDeleteTarget(null);
            }}
            disabled={deleteSaving}
            data-autofocus=""
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className={`inline-flex items-center justify-center gap-2 rounded-ds-md bg-danger px-3.5 py-2 text-sm font-semibold text-on-danger transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
            onClick={() => void confirmDelete()}
            disabled={deleteSaving}
          >
            {deleteSaving ? "Deleting…" : "Delete feed"}
          </button>
        </div>
      </FeedModal>
    </div>
  );
};

export default FeedsHomeView;
