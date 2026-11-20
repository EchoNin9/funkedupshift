import React, { useCallback, useEffect, useRef, useState } from "react";
import AddFeedDialog from "./AddFeedDialog";
import {
  deleteFeed,
  listFeeds,
  refreshFeed,
  reorderFeeds,
  updateFeed,
  type Feed,
} from "./api";
import AuthView from "./AuthView";
import { DEFAULT_TZ } from "./dateFormat";
import { sortFeeds } from "./feedOrder";
import FeedDayView from "./FeedDayView";
import FeedListView from "./FeedListView";
import { buildFeedPath, parseRoute, type Route } from "./router";
import SettingsView from "./SettingsView";
import StarredView from "./StarredView";
import {
  applyThemePreference,
  computeQuickToggleTarget,
  readStoredTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "./theme";

interface AuthState {
  checked: boolean;
  signedIn: boolean;
  email: string | null;
}

const App: React.FC = () => {
  const [route, setRoute] = useState<Route>(() =>
    typeof window !== "undefined" ? parseRoute(window.location.pathname) : { name: "home" }
  );
  const [auth, setAuth] = useState<AuthState>({ checked: false, signedIn: false, email: null });
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedsLoading, setFeedsLoading] = useState(false);
  const [feedsError, setFeedsError] = useState<string | null>(null);
  const [userTz, setUserTz] = useState<string>(DEFAULT_TZ);
  const [addOpen, setAddOpen] = useState(false);

  const [themePref, setThemePref] = useState<ThemePreference>(() => readStoredTheme());
  const [osDark, setOsDark] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false
  );

  const authEpochRef = useRef(0);
  const signedInRef = useRef(false);
  signedInRef.current = auth.signedIn;
  const pendingPinsRef = useRef<Set<string>>(new Set());
  const orderSeqRef = useRef(0);

  const navigate = useCallback((path: string, replace: boolean = false) => {
    if (typeof window !== "undefined") {
      if (replace) {
        window.history.replaceState(null, "", path);
      } else {
        window.history.pushState(null, "", path);
      }
      setRoute(parseRoute(path));
    }
  }, []);

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    applyThemePreference(themePref);
  }, [themePref]);

  useEffect(() => {
    const mq =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    if (mq) {
      const onChange = (e: MediaQueryListEvent) => setOsDark(e.matches);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY || e.key === null) {
        setThemePref(readStoredTheme());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const refreshAuth = useCallback(() => {
    const epoch = authEpochRef.current;
    const w = window as unknown as {
      auth?: {
        isAuthenticated?: (cb: (ok: boolean) => void) => void;
        getCurrentUserEmail?: (cb: (email: string | null) => void) => void;
      };
    };
    if (!w.auth?.isAuthenticated) {
      setAuth({ checked: true, signedIn: false, email: null });
      return;
    }
    w.auth.isAuthenticated((signedIn) => {
      if (authEpochRef.current !== epoch) return;
      if (!signedIn) {
        setAuth({ checked: true, signedIn: false, email: null });
        return;
      }
      if (w.auth?.getCurrentUserEmail) {
        w.auth.getCurrentUserEmail((email) => {
          if (authEpochRef.current !== epoch) return;
          setAuth({ checked: true, signedIn: true, email });
        });
      } else {
        setAuth({ checked: true, signedIn: true, email: null });
      }
    });
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const handleAuthError = useCallback(() => {
    if (!signedInRef.current) return;
    authEpochRef.current += 1;
    setAddOpen(false);
    setAuth({ checked: true, signedIn: false, email: null });
    setSessionNotice("Your session expired — please sign in again.");
  }, []);

  const loadFeeds = useCallback(async () => {
    const epoch = authEpochRef.current;
    setFeedsLoading(true);
    setFeedsError(null);
    try {
      const res = await listFeeds();
      if (authEpochRef.current !== epoch) return;
      setFeeds(sortFeeds(res.feeds));
      setUserTz(res.tz || DEFAULT_TZ);
    } catch (err: unknown) {
      if (authEpochRef.current !== epoch) return;
      if ((err as { name?: string })?.name === "AuthExpiredError") {
        handleAuthError();
        return;
      }
      setFeedsError((err as { message?: string })?.message || "Failed to load feeds.");
    } finally {
      if (authEpochRef.current === epoch) setFeedsLoading(false);
    }
  }, [handleAuthError]);

  useEffect(() => {
    if (auth.signedIn) {
      void loadFeeds();
    }
  }, [auth.signedIn, loadFeeds]);

  const handleSignOut = () => {
    authEpochRef.current += 1;
    const w = window as unknown as { auth?: { signOut?: () => void } };
    w.auth?.signOut?.();
    setAddOpen(false);
    setAuth({ checked: true, signedIn: false, email: null });
    setFeeds([]);
    setSessionNotice(null);
    navigate("/", true);
  };

  const handleTogglePin = async (target: Feed) => {
    if (pendingPinsRef.current.has(target.feedId)) return;
    const epoch = authEpochRef.current;
    pendingPinsRef.current.add(target.feedId);
    const nextPinned = !target.pinned;
    setFeedsError(null);
    setFeeds((prev) =>
      sortFeeds(prev.map((f) => (f.feedId === target.feedId ? { ...f, pinned: nextPinned } : f)))
    );

    try {
      const res = await updateFeed(target.feedId, { pinned: nextPinned });
      if (authEpochRef.current !== epoch) return;
      setFeeds((prev) =>
        sortFeeds(prev.map((f) => (f.feedId === target.feedId ? res.feed : f)))
      );
    } catch (err: unknown) {
      if (authEpochRef.current !== epoch) return;
      setFeeds((prev) =>
        sortFeeds(prev.map((f) => (f.feedId === target.feedId ? { ...f, pinned: target.pinned } : f)))
      );
      if ((err as { name?: string })?.name === "AuthExpiredError") {
        handleAuthError();
        return;
      }
      setFeedsError((err as { message?: string })?.message || "Could not update pin.");
    } finally {
      pendingPinsRef.current.delete(target.feedId);
    }
  };

  const handleCommitOrder = async (nextFeeds: Feed[]) => {
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
      if ((err as { name?: string })?.name === "AuthExpiredError") {
        handleAuthError();
        return;
      }
      if (orderSeqRef.current === seq) {
        setFeedsError((err as { message?: string })?.message || "Could not save feed order.");
        void loadFeeds();
      }
    }
  };

  const handleRefreshFeed = async (target: Feed) => {
    const epoch = authEpochRef.current;
    setFeedsError(null);
    try {
      const res = await refreshFeed(target.feedId);
      if (authEpochRef.current !== epoch) return null;
      setFeeds((prev) =>
        sortFeeds(prev.map((f) => (f.feedId === target.feedId ? res.feed : f)))
      );
      return { feed: res.feed, notModified: res.notModified, itemsAdded: res.itemsAdded };
    } catch (err: unknown) {
      if (authEpochRef.current !== epoch) return null;
      if ((err as { name?: string })?.name === "AuthExpiredError") {
        handleAuthError();
        return null;
      }
      setFeedsError((err as { message?: string })?.message || "Feed refresh failed.");
      void loadFeeds();
      throw err;
    }
  };

  const handleRenameFeed = async (target: Feed, newTitle: string) => {
    const epoch = authEpochRef.current;
    setFeedsError(null);
    try {
      const res = await updateFeed(target.feedId, { title: newTitle });
      if (authEpochRef.current !== epoch) return;
      setFeeds((prev) =>
        sortFeeds(prev.map((f) => (f.feedId === target.feedId ? res.feed : f)))
      );
    } catch (err: unknown) {
      if (authEpochRef.current !== epoch) return;
      if ((err as { name?: string })?.name === "AuthExpiredError") {
        handleAuthError();
        return;
      }
      setFeedsError((err as { message?: string })?.message || "Could not rename feed.");
      throw err;
    }
  };

  const handleDeleteFeed = async (target: Feed) => {
    const epoch = authEpochRef.current;
    setFeedsError(null);
    try {
      await deleteFeed(target.feedId);
      if (authEpochRef.current !== epoch) return;
      setFeeds((prev) => prev.filter((f) => f.feedId !== target.feedId));
      if (route.name === "feed" && route.feedId === target.feedId) {
        navigate("/");
      }
    } catch (err: unknown) {
      if (authEpochRef.current !== epoch) return;
      if ((err as { name?: string })?.name === "AuthExpiredError") {
        handleAuthError();
        return;
      }
      setFeedsError((err as { message?: string })?.message || "Could not delete feed.");
      throw err;
    }
  };

  const handleFeedUpdated = useCallback((updated: Feed) => {
    setFeeds((prev) =>
      prev.some((f) => f.feedId === updated.feedId)
        ? sortFeeds(prev.map((f) => (f.feedId === updated.feedId ? updated : f)))
        : prev
    );
  }, []);

  const handleQuickThemeToggle = () => {
    setThemePref(computeQuickToggleTarget(themePref, osDark));
  };

  const activeFeed =
    route.name === "feed" ? feeds.find((f) => f.feedId === route.feedId) ?? null : null;

  return (
    <div className="app">
      <header className="site-header">
        <div className="header-inner">
          <a
            href="/"
            className="wordmark"
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              navigate("/");
            }}
          >
            feed<span className="wordmark-dot">.e9.cx</span>
          </a>

          {auth.signedIn && (
            <nav className="primary-nav" aria-label="Primary navigation">
              <a
                href="/"
                className={route.name === "home" || route.name === "feed" ? "nav-link is-active" : "nav-link"}
                aria-current={route.name === "home" ? "page" : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  navigate("/");
                }}
              >
                Feeds
              </a>
              <a
                href="/starred"
                className={route.name === "starred" ? "nav-link is-active" : "nav-link"}
                aria-current={route.name === "starred" ? "page" : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  navigate("/starred");
                }}
              >
                Starred
              </a>
              <a
                href="/settings"
                className={route.name === "settings" ? "nav-link is-active" : "nav-link"}
                aria-current={route.name === "settings" ? "page" : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  navigate("/settings");
                }}
              >
                Settings
              </a>
            </nav>
          )}

          <div className="header-actions">
            <button
              type="button"
              className="btn-theme-toggle"
              onClick={handleQuickThemeToggle}
              title="Toggle light/dark appearance"
            >
              <span className="theme-opt-dark" aria-hidden="true">
                ◐
              </span>
              <span className="theme-opt-light" aria-hidden="true">
                ☀
              </span>
              <span className="sr-only theme-opt-dark">Switch to dark theme</span>
              <span className="sr-only theme-opt-light">Switch to light theme</span>
            </button>

            {auth.signedIn && (
              <button type="button" className="btn-header" onClick={handleSignOut}>
                Sign out
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="main">
        {!auth.checked ? (
          <div className="loading-state">Checking session…</div>
        ) : !auth.signedIn ? (
          <AuthView
            notice={sessionNotice}
            onSuccess={() => {
              setSessionNotice(null);
              refreshAuth();
            }}
          />
        ) : route.name === "feed" ? (
          <FeedDayView
            key={route.feedId}
            feedId={route.feedId}
            routeDay={route.day}
            knownFeed={activeFeed}
            userTz={userTz}
            onSelectDay={(day, replace) => navigate(buildFeedPath(route.feedId, day), replace)}
            onBack={() => navigate("/")}
            onFeedUpdated={handleFeedUpdated}
            onTogglePin={handleTogglePin}
            onRefreshFeed={handleRefreshFeed}
            onRenameFeed={handleRenameFeed}
            onDeleteFeed={handleDeleteFeed}
            onAuthError={handleAuthError}
          />
        ) : route.name === "starred" ? (
          <StarredView
            onOpenArchive={(feedId, day) => navigate(buildFeedPath(feedId, day))}
            onAuthError={handleAuthError}
          />
        ) : route.name === "settings" ? (
          <SettingsView
            userEmail={auth.email}
            userTz={userTz}
            themePref={themePref}
            osDark={osDark}
            onChangeTheme={setThemePref}
            onTimezoneUpdated={(tz) => {
              setUserTz(tz);
              void loadFeeds();
            }}
            onSignOut={handleSignOut}
            onAuthError={handleAuthError}
          />
        ) : (
          <FeedListView
            feeds={feeds}
            loading={feedsLoading}
            error={feedsError}
            onRetryLoad={() => void loadFeeds()}
            onOpenFeed={(feedId) => navigate(buildFeedPath(feedId))}
            onOpenAdd={() => setAddOpen(true)}
            onOpenSettings={() => navigate("/settings")}
            onTogglePin={handleTogglePin}
            onCommitOrder={handleCommitOrder}
            onRefreshFeed={handleRefreshFeed}
            onRenameFeed={handleRenameFeed}
            onDeleteFeed={handleDeleteFeed}
          />
        )}
      </main>

      {auth.signedIn && (
        <AddFeedDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onCreated={(feed) => {
            setFeeds((prev) => sortFeeds([...prev, feed]));
            navigate(buildFeedPath(feed.feedId));
          }}
          onOpenExisting={(feedId) => navigate(buildFeedPath(feedId))}
          onAuthError={handleAuthError}
        />
      )}
    </div>
  );
};

export default App;
