import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ArrowUpRight, GearSix, Plus, Rss, Star } from "@phosphor-icons/react";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { useAuth } from "../../shell/AuthContext";
import { AddFeedDialog } from "./AddFeedDialog";
import {
  AuthExpiredError,
  deleteFeed as deleteFeedApi,
  listFeeds,
  refreshFeed as refreshFeedApi,
  reorderFeeds,
  updateFeed,
  type Feed,
} from "./api";
import { DEFAULT_TZ } from "./dateFormat";
import {
  readStoredSoloBlocks,
  SOLO_BLOCKS_STORAGE_KEY,
  sortFeeds,
  toggleSoloBlock as toggleSoloBlockState,
  writeStoredSoloBlocks,
  type FeedBlock,
} from "./feedOrder";
import "./feeds.css";

export interface FeedsContextValue {
  feeds: Feed[];
  feedsLoading: boolean;
  feedsError: string | null;
  userTz: string;
  soloBlocks: FeedBlock[];
  addOpen: boolean;
  loadFeeds: (options?: { preserveError?: boolean }) => Promise<void>;
  toggleSoloBlock: (block: FeedBlock) => void;
  resetSoloBlocks: () => void;
  togglePin: (target: Feed, options?: { suppressLayoutError?: boolean }) => Promise<string | null>;
  commitOrder: (nextFeeds: Feed[]) => Promise<void>;
  refreshFeed: (
    target: Feed,
    options?: { suppressLayoutError?: boolean }
  ) => Promise<{ feed: Feed; notModified: boolean; itemsAdded: number } | null>;
  renameFeed: (target: Feed, newTitle: string) => Promise<void>;
  deleteFeed: (target: Feed) => Promise<boolean>;
  handleFeedUpdated: (updated: Feed) => void;
  handleTimezoneUpdated: (tz: string) => void;
  openAddModal: () => void;
  handleAuthError: () => void;
}

const FeedsContext = createContext<FeedsContextValue | undefined>(undefined);

export function useFeedsContext(): FeedsContextValue {
  const ctx = useContext(FeedsContext);
  if (!ctx) {
    throw new Error("useFeedsContext must be used within FeedsLayout");
  }
  return ctx;
}

function isAuthExpired(err: unknown): boolean {
  return (
    err instanceof AuthExpiredError ||
    (err as { name?: string } | null | undefined)?.name === "AuthExpiredError"
  );
}

export interface FeedsLayoutProps {
  showMobileHeading?: boolean;
}

export const FeedsLayout: React.FC<FeedsLayoutProps> = ({ showMobileHeading = false }) => {
  const { user, refreshAuth } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedsLoading, setFeedsLoading] = useState(true);
  const [feedsError, setFeedsError] = useState<string | null>(null);
  const [userTz, setUserTz] = useState<string>(DEFAULT_TZ);
  const [soloBlocks, setSoloBlocks] = useState<FeedBlock[]>(() => readStoredSoloBlocks());
  const [addOpen, setAddOpen] = useState(false);

  const authEpochRef = useRef(0);
  const pendingPinsRef = useRef<Set<string>>(new Set());
  const orderSeqRef = useRef(0);

  useEffect(() => {
    writeStoredSoloBlocks(soloBlocks);
  }, [soloBlocks]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SOLO_BLOCKS_STORAGE_KEY || e.key === null) {
        setSoloBlocks(readStoredSoloBlocks());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleAuthError = useCallback(() => {
    authEpochRef.current += 1;
    setAddOpen(false);
    void refreshAuth();
    navigate("/auth");
  }, [navigate, refreshAuth]);

  const loadFeeds = useCallback(
    async (options?: { preserveError?: boolean }) => {
      const epoch = authEpochRef.current;
      setFeedsLoading(true);
      if (!options?.preserveError) {
        setFeedsError(null);
      }
      try {
        const res = await listFeeds();
        if (authEpochRef.current !== epoch) return;
        setFeeds(sortFeeds(res.feeds));
        setUserTz(res.tz || DEFAULT_TZ);
      } catch (err: unknown) {
        if (authEpochRef.current !== epoch) return;
        if (isAuthExpired(err)) {
          handleAuthError();
          return;
        }
        setFeedsError((err as { message?: string })?.message || "Failed to load feeds.");
      } finally {
        if (authEpochRef.current === epoch) setFeedsLoading(false);
      }
    },
    [handleAuthError]
  );

  useEffect(() => {
    if (user?.userId) {
      authEpochRef.current += 1;
      void loadFeeds();
    }
  }, [user?.userId, loadFeeds]);

  const toggleSoloBlock = useCallback((block: FeedBlock) => {
    setSoloBlocks((prev) => toggleSoloBlockState(prev, block));
  }, []);

  const resetSoloBlocks = useCallback(() => {
    setSoloBlocks([]);
  }, []);

  const togglePin = useCallback(
    async (
      target: Feed,
      options?: { suppressLayoutError?: boolean }
    ): Promise<string | null> => {
      if (pendingPinsRef.current.has(target.feedId)) return null;
      const epoch = authEpochRef.current;
      pendingPinsRef.current.add(target.feedId);
      const nextPinned = !target.pinned;
      if (!options?.suppressLayoutError) {
        setFeedsError(null);
      }
      setFeeds((prev) =>
        sortFeeds(prev.map((f) => (f.feedId === target.feedId ? { ...f, pinned: nextPinned } : f)))
      );

      try {
        const res = await updateFeed(target.feedId, { pinned: nextPinned });
        if (authEpochRef.current !== epoch) return null;
        setFeeds((prev) =>
          sortFeeds(prev.map((f) => (f.feedId === target.feedId ? res.feed : f)))
        );
        return null;
      } catch (err: unknown) {
        if (authEpochRef.current !== epoch) return null;
        setFeeds((prev) =>
          sortFeeds(
            prev.map((f) => (f.feedId === target.feedId ? { ...f, pinned: target.pinned } : f))
          )
        );
        if (isAuthExpired(err)) {
          handleAuthError();
          return null;
        }
        const msg = (err as { message?: string })?.message || "Could not update pin.";
        if (!options?.suppressLayoutError) {
          setFeedsError(msg);
        }
        return msg;
      } finally {
        pendingPinsRef.current.delete(target.feedId);
      }
    },
    [handleAuthError]
  );

  const commitOrder = useCallback(
    async (nextFeeds: Feed[]) => {
      const seq = ++orderSeqRef.current;
      const epoch = authEpochRef.current;
      const orderMap = new Map(nextFeeds.map((f, idx) => [f.feedId, idx]));
      setFeedsError(null);
      setFeeds((prev) =>
        sortFeeds(
          prev.map((f) =>
            orderMap.has(f.feedId) ? { ...f, sortOrder: orderMap.get(f.feedId)! } : f
          )
        )
      );
      try {
        await reorderFeeds(nextFeeds.map((f) => f.feedId));
      } catch (err: unknown) {
        if (authEpochRef.current !== epoch) return;
        if (isAuthExpired(err)) {
          handleAuthError();
          return;
        }
        if (orderSeqRef.current === seq) {
          setFeedsError((err as { message?: string })?.message || "Could not save feed order.");
          void loadFeeds({ preserveError: true });
        }
      }
    },
    [handleAuthError, loadFeeds]
  );

  const refreshFeed = useCallback(
    async (target: Feed, options?: { suppressLayoutError?: boolean }) => {
      const epoch = authEpochRef.current;
      if (!options?.suppressLayoutError) {
        setFeedsError(null);
      }
      try {
        const res = await refreshFeedApi(target.feedId);
        if (authEpochRef.current !== epoch) return null;
        setFeeds((prev) =>
          sortFeeds(prev.map((f) => (f.feedId === target.feedId ? res.feed : f)))
        );
        return { feed: res.feed, notModified: res.notModified, itemsAdded: res.itemsAdded };
      } catch (err: unknown) {
        if (authEpochRef.current !== epoch) return null;
        if (isAuthExpired(err)) {
          handleAuthError();
          return null;
        }
        if (!options?.suppressLayoutError) {
          setFeedsError((err as { message?: string })?.message || "Feed refresh failed.");
          void loadFeeds({ preserveError: true });
        }
        throw err;
      }
    },
    [handleAuthError, loadFeeds]
  );

  const renameFeed = useCallback(
    async (target: Feed, newTitle: string) => {
      const epoch = authEpochRef.current;
      try {
        const res = await updateFeed(target.feedId, { title: newTitle });
        if (authEpochRef.current !== epoch) return;
        setFeeds((prev) =>
          sortFeeds(prev.map((f) => (f.feedId === target.feedId ? res.feed : f)))
        );
      } catch (err: unknown) {
        if (authEpochRef.current !== epoch) return;
        if (isAuthExpired(err)) {
          handleAuthError();
          return;
        }
        throw err;
      }
    },
    [handleAuthError]
  );

  const deleteFeed = useCallback(
    async (target: Feed): Promise<boolean> => {
      const epoch = authEpochRef.current;
      try {
        await deleteFeedApi(target.feedId);
        if (authEpochRef.current !== epoch) return false;
        setFeeds((prev) => prev.filter((f) => f.feedId !== target.feedId));
        const match = /^\/feeds\/feed\/([^/]+)/.exec(location.pathname);
        if (match) {
          let currentFeedId = match[1];
          try {
            currentFeedId = decodeURIComponent(match[1]);
          } catch {
            // Keep raw segment if malformed percent-encoding
          }
          if (currentFeedId === target.feedId) {
            navigate("/feeds");
          }
        }
        return true;
      } catch (err: unknown) {
        if (authEpochRef.current !== epoch) return false;
        if (isAuthExpired(err)) {
          handleAuthError();
          return false;
        }
        throw err;
      }
    },
    [handleAuthError, location.pathname, navigate]
  );

  const handleFeedUpdated = useCallback((updated: Feed) => {
    setFeeds((prev) =>
      prev.some((f) => f.feedId === updated.feedId)
        ? sortFeeds(prev.map((f) => (f.feedId === updated.feedId ? updated : f)))
        : prev
    );
  }, []);

  const handleTimezoneUpdated = useCallback(
    (tz: string) => {
      setUserTz(tz);
      void loadFeeds();
    },
    [loadFeeds]
  );

  const openAddModal = useCallback(() => {
    setAddOpen(true);
  }, []);

  const contextValue = useMemo<FeedsContextValue>(
    () => ({
      feeds,
      feedsLoading,
      feedsError,
      userTz,
      soloBlocks,
      addOpen,
      loadFeeds,
      toggleSoloBlock,
      resetSoloBlocks,
      togglePin,
      commitOrder,
      refreshFeed,
      renameFeed,
      deleteFeed,
      handleFeedUpdated,
      handleTimezoneUpdated,
      openAddModal,
      handleAuthError,
    }),
    [
      feeds,
      feedsLoading,
      feedsError,
      userTz,
      soloBlocks,
      addOpen,
      loadFeeds,
      toggleSoloBlock,
      resetSoloBlocks,
      togglePin,
      commitOrder,
      refreshFeed,
      renameFeed,
      deleteFeed,
      handleFeedUpdated,
      handleTimezoneUpdated,
      openAddModal,
      handleAuthError,
    ]
  );

  const pathname = location.pathname;
  const isFeedsActive =
    pathname === "/feeds" || pathname === "/feeds/" || pathname.startsWith("/feeds/feed/");
  const isStarredActive = pathname === "/feeds/starred" || pathname.startsWith("/feeds/starred/");
  const isSettingsActive =
    pathname === "/feeds/settings" || pathname.startsWith("/feeds/settings/");

  const navLinkClass = (active: boolean) =>
    `inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${focusRing} ${
      active
        ? "bg-accent/15 text-accent-text"
        : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
    }`;

  return (
    <FeedsContext.Provider value={contextValue}>
      <div className="space-y-5">
        {showMobileHeading && (
          <h1 className="font-heading text-2xl font-bold text-text-primary">Feeds</h1>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider pb-3">
          <nav className="flex flex-wrap items-center gap-1.5" aria-label="Feeds navigation">
            <Link
              to="/feeds"
              className={navLinkClass(isFeedsActive)}
              aria-current={pathname === "/feeds" || pathname === "/feeds/" ? "page" : undefined}
            >
              <Rss size={15} weight={isFeedsActive ? "fill" : "regular"} aria-hidden="true" />
              <span>Feeds</span>
            </Link>
            <Link
              to="/feeds/starred"
              className={navLinkClass(isStarredActive)}
              aria-current={isStarredActive ? "page" : undefined}
            >
              <Star size={15} weight={isStarredActive ? "fill" : "regular"} aria-hidden="true" />
              <span>Starred</span>
            </Link>
            <Link
              to="/feeds/settings"
              className={navLinkClass(isSettingsActive)}
              aria-current={isSettingsActive ? "page" : undefined}
            >
              <GearSix size={15} weight={isSettingsActive ? "fill" : "regular"} aria-hidden="true" />
              <span>Settings</span>
            </Link>
          </nav>

          <div className="flex flex-wrap items-center gap-2.5">
            <a
              href="https://feed.e9.cx"
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex min-h-[36px] items-center gap-1 rounded-ds-md px-2 text-xs font-medium text-text-tertiary transition-colors hover:text-text-secondary ${focusRing}`}
            >
              <span>feed.e9.cx</span>
              <ArrowUpRight size={13} weight="regular" aria-hidden="true" />
            </a>
            <button
              type="button"
              className={buttonClasses("primary", "sm")}
              onClick={openAddModal}
            >
              <Plus size={15} weight="bold" aria-hidden="true" />
              <span>Add feed</span>
            </button>
          </div>
        </div>

        <Outlet />

        <AddFeedDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onCreated={(feed) => {
            setFeeds((prev) =>
              sortFeeds([...prev.filter((f) => f.feedId !== feed.feedId), feed])
            );
            navigate(`/feeds/feed/${encodeURIComponent(feed.feedId)}`);
          }}
          onOpenExisting={(feedId) => navigate(`/feeds/feed/${encodeURIComponent(feedId)}`)}
          onAuthError={handleAuthError}
        />
      </div>
    </FeedsContext.Provider>
  );
};

export default FeedsLayout;
