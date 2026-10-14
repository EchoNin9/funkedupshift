import React, { useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { House, MagnifyingGlass, SquaresFour, UserCircle, type Icon } from "@phosphor-icons/react";
import { useAuth } from "./AuthContext";
import { useLauncher } from "./LauncherContext";
import { AccountMenu } from "./AccountMenu";

interface TabProps {
  icon: Icon;
  label: string;
  active?: boolean;
}

function TabInner({ icon: IconCmp, label, active }: TabProps) {
  return (
    <>
      <IconCmp size={23} weight={active ? "fill" : "regular"} aria-hidden="true" />
      <span>{label}</span>
    </>
  );
}

/**
 * Mobile (≤640px) bottom tab bar (README §8): Home · Apps · Search · Account (Sign in for guests).
 * Apps opens the launcher sheet without the keyboard; Search opens it with the input focused.
 */
export function TabBar() {
  const { user, isLoading } = useAuth();
  const { open: launcherOpen, focusSearch, openLauncher, closeLauncher } = useLauncher();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const accountRef = useRef<HTMLButtonElement>(null);
  const signedIn = !!user && user.role !== "guest";

  const appsActive = launcherOpen && !focusSearch;
  const searchActive = launcherOpen && focusSearch;
  const homeActive = pathname === "/" && !launcherOpen && !menuOpen;
  const accountActive = menuOpen || (!launcherOpen && (pathname.startsWith("/profile") || (!signedIn && pathname === "/auth")));

  const cls = (active: boolean) => `tab ${active ? "is-active" : ""}`;
  // Tapping Apps/Search while the sheet is already in that mode closes it again.
  const toggle = (search: boolean) => (launcherOpen && focusSearch === search ? closeLauncher() : openLauncher({ focusSearch: search }));

  return (
    <>
      <nav className="tabbar only-narrow" aria-label="Primary">
        <Link to="/" className={cls(homeActive)} aria-current={pathname === "/" ? "page" : undefined}>
          <TabInner icon={House} label="Home" active={homeActive} />
        </Link>
        <button
          type="button"
          className={cls(appsActive)}
          onClick={() => {
            setMenuOpen(false);
            toggle(false);
          }}
          aria-haspopup="dialog"
          aria-expanded={appsActive}
        >
          <TabInner icon={SquaresFour} label="Apps" active={appsActive} />
        </button>
        <button
          type="button"
          className={cls(searchActive)}
          onClick={() => {
            setMenuOpen(false);
            toggle(true);
          }}
          aria-haspopup="dialog"
          aria-expanded={searchActive}
        >
          <TabInner icon={MagnifyingGlass} label="Search" active={searchActive} />
        </button>
        {signedIn ? (
          <button
            ref={accountRef}
            type="button"
            className={cls(accountActive)}
            onClick={() => {
              closeLauncher();
              setMenuOpen((v) => !v);
            }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <TabInner icon={UserCircle} label="Account" active={accountActive} />
          </button>
        ) : (
          <Link to="/auth" className={cls(accountActive)} aria-busy={isLoading || undefined}>
            <TabInner icon={UserCircle} label={isLoading ? "…" : "Sign in"} active={accountActive} />
          </Link>
        )}
      </nav>
      {/* Outside the nav: its backdrop-filter would otherwise become the containing block of the fixed sheet. */}
      <AnimatePresence>
        {signedIn && menuOpen && <AccountMenu onClose={() => setMenuOpen(false)} returnFocusTo={accountRef} />}
      </AnimatePresence>
    </>
  );
}

export default TabBar;
