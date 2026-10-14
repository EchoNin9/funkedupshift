import React from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { CaretRight, Lock, PushPin } from "@phosphor-icons/react";
import { useAuth } from "../shell/AuthContext";
import {
  ADMIN_MODULES,
  LAUNCHER_GROUP_LABELS,
  PUBLIC_MODULES,
  canOpenModule,
  getLauncherGroups,
  getVisibleAdminModules,
  type LauncherGroupId,
} from "../config/modules";
import { usePins } from "../hooks/usePins";
import { useRecordRecentRoute } from "../hooks/useRecentRoutes";

type Icon = React.ComponentType<{ className?: string }>;
type Hue = "teal" | "violet" | "coral" | "amber";

export const GROUP_HUES: Record<LauncherGroupId, Hue> = { discover: "teal", tools: "violet", modules: "coral" };

interface Crumb {
  label: string;
  to: string;
}

/** What a routed path maps to: breadcrumb, header content and the "More in…" footer source. */
interface AppFrameInfo {
  kind: "public" | "admin" | "account";
  /** Middle crumbs between Home and the page title (Group, or Admin / Account). */
  trail: Crumb[];
  title: string;
  description: string;
  icon: Icon;
  hue: Hue;
  /** Set for launcher apps — drives the Pin button and the group footer. */
  publicId?: string;
  group?: LauncherGroupId;
  /** Admin module id to leave out of the admin footer. */
  adminId?: string;
}

/** Admin sub-routes that edit a record of a parent admin page. */
const ADMIN_EDIT_ROUTES: { path: string; adminId: string; title: string }[] = [
  { path: "/admin/sites/edit", adminId: "websites", title: "Edit site" },
  { path: "/admin/media/edit", adminId: "media", title: "Edit media" },
  { path: "/admin/users/edit", adminId: "membership", title: "Edit user" },
];

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(base + "/");

/** Map a pathname to its frame, or null for pages with no module entry (home, auth, privacy, shared pastes…). */
export function resolveAppFrame(rawPath: string): AppFrameInfo | null {
  const pathname = rawPath.length > 1 ? rawPath.replace(/\/+$/, "") : rawPath;
  const adminCrumb: Crumb = { label: "Admin", to: "/admin" };

  if (pathname === "/admin") {
    return {
      kind: "admin",
      trail: [],
      title: "Admin",
      description: "Manage content, people and settings across the site.",
      icon: ADMIN_MODULES[0].icon,
      hue: "amber",
    };
  }

  const edit = ADMIN_EDIT_ROUTES.find((r) => under(pathname, r.path));
  const adminMod = edit
    ? ADMIN_MODULES.find((m) => m.id === edit.adminId)
    : ADMIN_MODULES.filter((m) => under(pathname, m.path)).sort((a, b) => b.path.length - a.path.length)[0];
  if (adminMod) {
    return {
      kind: "admin",
      trail: [adminCrumb],
      title: edit?.title ?? adminMod.label,
      description: edit ? `Part of ${adminMod.label} admin.` : adminMod.description,
      icon: adminMod.icon,
      hue: "amber",
      adminId: adminMod.id,
    };
  }

  if (pathname === "/profile") {
    const profile = PUBLIC_MODULES.find((m) => m.id === "profile");
    if (!profile) return null;
    return {
      kind: "account",
      trail: [{ label: "Account", to: "/profile" }],
      title: "My Profile",
      description: profile.description,
      icon: profile.icon,
      hue: "teal",
    };
  }

  const mod = PUBLIC_MODULES.filter((m) => under(pathname, m.path)).sort((a, b) => b.path.length - a.path.length)[0];
  if (!mod) return null;
  return {
    kind: "public",
    trail: [{ label: LAUNCHER_GROUP_LABELS[mod.group], to: `/apps/${mod.group}` }],
    title: mod.label,
    description: mod.description,
    icon: mod.icon,
    hue: GROUP_HUES[mod.group],
    publicId: mod.id,
    group: mod.group,
  };
}

/** Home › … › Current. Every crumb is a link; the current one is bold and aria-current. */
export function Breadcrumb({ trail, current }: { trail: Crumb[]; current: string }) {
  const { pathname } = useLocation();
  const link = "rounded-ds-sm hover:text-text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  return (
    <nav aria-label="Breadcrumb" className="pt-7 text-[13px] text-text-secondary">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {[{ label: "Home", to: "/" }, ...trail].map((c) => (
          <li key={c.to + c.label} className="flex items-center gap-1.5">
            <Link to={c.to} className={link}>
              {c.label}
            </Link>
            <CaretRight className="h-3 w-3 text-text-tertiary" aria-hidden="true" />
          </li>
        ))}
        <li>
          <Link to={pathname} aria-current="page" className={`font-semibold text-text-primary ${link}`}>
            {current}
          </Link>
        </li>
      </ol>
    </nav>
  );
}

function PinButton({ id }: { id: string }) {
  const { isPinned, togglePin } = usePins();
  const pinned = isPinned(id);
  return (
    <button
      type="button"
      onClick={() => togglePin(id)}
      aria-pressed={pinned}
      className="btn-secondary !px-3 !py-2 shrink-0"
    >
      <PushPin className="h-[18px] w-[18px] text-accent-text" weight={pinned ? "fill" : "regular"} aria-hidden="true" />
      {pinned ? "Pinned" : "Pin"}
    </button>
  );
}

const chipBase = "btn-secondary !gap-2.5 !py-1.5 !pl-1.5 !pr-3.5";

function IconTile({ icon: Icon, hue, size, iconSize, radius }: { icon: Icon; hue: Hue; size: number; iconSize: string; radius: number }) {
  return (
    <span className={`app-icon hue-${hue}`} style={{ width: size, height: size, borderRadius: radius }}>
      <Icon className={iconSize} />
    </span>
  );
}

/** "More in {Group}" / "More in Admin": the other apps as chips, locked ones greyed. */
function MoreIn({ info }: { info: AppFrameInfo }) {
  const { user } = useAuth();

  if (info.kind === "admin") {
    const others = getVisibleAdminModules(user).filter((m) => m.id !== info.adminId);
    if (others.length === 0) return null;
    return (
      <Chips label="More in Admin">
        {others.map((m) => (
          <Link key={m.id} to={m.path} className={chipBase}>
            <IconTile icon={m.icon} hue="amber" size={26} iconSize="h-4 w-4" radius={8} />
            {m.label}
          </Link>
        ))}
      </Chips>
    );
  }

  if (info.kind !== "public" || !info.group) return null;
  const apps = (getLauncherGroups(user).find((g) => g.id === info.group)?.apps ?? []).filter((a) => a.id !== info.publicId);
  if (apps.length === 0) return null;
  return (
    <Chips label={`More in ${LAUNCHER_GROUP_LABELS[info.group]}`}>
      {apps.map((a) => {
        const inner = (
          <>
            <IconTile icon={a.icon} hue={info.hue} size={26} iconSize="h-4 w-4" radius={8} />
            {a.label}
            {a.locked && <Lock className="h-3.5 w-3.5" weight="fill" aria-hidden="true" />}
          </>
        );
        if (!a.locked) return <Link key={a.id} to={a.path} className={chipBase}>{inner}</Link>;
        if (a.lockReason === "guest") {
          return <Link key={a.id} to="/auth" title={`${a.label} — sign in to use`} className={`${chipBase} is-locked`}>{inner}</Link>;
        }
        return (
          <span key={a.id} role="link" aria-disabled="true" title={`${a.label} — ask an admin for access`} className={`${chipBase} is-locked is-inert`}>
            {inner}
          </span>
        );
      })}
    </Chips>
  );
}

function Chips({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <footer className="mt-12 border-t border-divider pt-6">
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-text-secondary">{label}</h2>
      <div className="flex flex-wrap gap-2">{children}</div>
    </footer>
  );
}

/**
 * Standard page frame: breadcrumb, icon-tile header (title + description from config), Pin button, "More in…" footer.
 * Resolves its module from the current path, so it can wrap a route table; paths with no module entry render unframed.
 */
export default function AppPage({ children }: { children?: React.ReactNode }) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const info = resolveAppFrame(pathname);
  if (!info) return <>{children}</>;

  const pub = info.publicId ? PUBLIC_MODULES.find((m) => m.id === info.publicId) : undefined;
  const canPin = !!user && !!pub && pub.launcher !== false && canOpenModule(pub, user);

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <Breadcrumb trail={info.trail} current={info.title} />
      <header className="flex flex-wrap items-center gap-4 pb-7 pt-[18px]">
        <IconTile icon={info.icon} hue={info.hue} size={54} iconSize="h-7 w-7" radius={14} />
        <div className="min-w-0 flex-1 basis-60">
          <h1 className="font-display text-[clamp(28px,3.5vw,36px)] font-semibold leading-tight tracking-[-0.035em] text-text-primary">
            {info.title}
          </h1>
          <p className="mt-0.5 text-sm text-text-secondary">{info.description}</p>
        </div>
        {canPin && info.publicId && <PinButton id={info.publicId} />}
      </header>
      {children}
      <MoreIn info={info} />
    </div>
  );
}

/** Pathless layout route: frames whatever child route matched. Nest it inside any route guard so denied users never see it. */
export function AppPageLayout() {
  useRecordRecentRoute(useLocation().pathname);
  return (
    <AppPage>
      <Outlet />
    </AppPage>
  );
}
