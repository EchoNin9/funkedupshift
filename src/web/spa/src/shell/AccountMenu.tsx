import React, { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { MoonStars, SignOut, Sun, UserCircle, type Icon } from "@phosphor-icons/react";
import { getVisibleAdminModules } from "../config/modules";
import { useAuth } from "./AuthContext";
import ImpersonationSelector from "./ImpersonationSelector";
import { getTheme, toggleTheme, type Theme } from "./theme";

export function userInitials(email: string): string {
  const local = (email || "").split("@")[0] || "";
  const parts = local.split(/[._\-+\s]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return (letters || "?").toUpperCase();
}

const rowClass =
  "flex w-full items-center gap-3 rounded-lg px-2.5 py-[9px] text-left text-sm text-text-primary hover:bg-surface-2";

function Row({ icon: IconCmp, children, trailing }: { icon: Icon; children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <>
      <IconCmp size={18} className="h-[18px] w-[18px] shrink-0 text-text-secondary" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </>
  );
}

interface AccountMenuProps {
  onClose: () => void;
  /** Element to refocus when the menu closes (the avatar button). */
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}

/** Fixed-position account popover (README §3). Rendered only while open. */
export function AccountMenu({ onClose, returnFocusTo }: AccountMenuProps) {
  const { user, signOut } = useAuth();
  const menuRef = useRef<HTMLDivElement>(null);
  const [theme, setThemeState] = React.useState<Theme>(getTheme);

  // Esc closes — unless the key landed inside a nested dialog (impersonation picker).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as Node | null;
      if (t && t !== document.body && menuRef.current && !menuRef.current.contains(t)) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    const back = returnFocusTo?.current;
    return () => back?.focus();
  }, [returnFocusTo]);

  if (!user) return null;
  const adminModules = getVisibleAdminModules(user);
  const isAdmin = user.role === "superadmin";
  const roleLabel = isAdmin ? "Admin" : user.role === "manager" ? "Manager" : "User";
  const name = user.email.split("@")[0];

  return (
    <>
      <div className="fixed inset-0 z-[49]" onClick={onClose} aria-hidden="true" />
      <div
        ref={menuRef}
        role="menu"
        aria-label="Account"
        className="account-menu overflow-y-auto rounded-2xl border bg-surface-1 p-2 shadow-ds-lg scrollbar-thin"
        style={{ borderColor: "var(--color-divider)" }}
      >
        <div className="flex items-center gap-3 px-2.5 pb-3 pt-2">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full font-display text-sm font-semibold text-white"
            style={{ background: "linear-gradient(135deg, rgb(var(--color-hue-violet)), rgb(var(--color-hue-coral)))" }}
            aria-hidden="true"
          >
            {userInitials(user.email)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-text-primary">{name}</p>
            <p className="truncate text-xs text-text-secondary">{user.email}</p>
          </div>
          <span className="tag tag-accent shrink-0">{roleLabel}</span>
        </div>

        <Link to="/profile" role="menuitem" onClick={onClose} className={rowClass}>
          <Row icon={UserCircle}>Profile</Row>
        </Link>

        <div className="mt-1 border-t pt-1" style={{ borderColor: "var(--color-divider)" }}>
          <p className="px-2.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-text-tertiary">Appearance</p>
          <button type="button" role="menuitem" onClick={() => setThemeState(toggleTheme())} className={rowClass}>
            <Row
              icon={theme === "dark" ? MoonStars : Sun}
              trailing={<span className="text-xs text-text-secondary">{theme === "dark" ? "Dark" : "Light"}</span>}
            >
              Theme
            </Row>
          </button>
        </div>

        {(adminModules.length > 0 || isAdmin) && (
          <div className="mt-1 border-t pt-1" style={{ borderColor: "var(--color-divider)" }}>
            <p className="px-2.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-text-tertiary">Admin</p>
            {adminModules.map((m) => (
              <Link key={m.id} to={m.path} role="menuitem" onClick={onClose} className={rowClass}>
                <Row icon={m.icon as unknown as Icon}>{m.label}</Row>
              </Link>
            ))}
            {/* Superadmin-only (renders null for everyone else): opens its own dialog, so the menu stays open. */}
            <div className="px-0.5">
              <ImpersonationSelector />
            </div>
          </div>
        )}

        <div className="mt-1 border-t pt-1" style={{ borderColor: "var(--color-divider)" }}>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              signOut();
            }}
            className={`${rowClass} !text-danger`}
          >
            <SignOut size={18} className="shrink-0" />
            <span className="flex-1">Sign out</span>
          </button>
        </div>
      </div>
    </>
  );
}

export default AccountMenu;
