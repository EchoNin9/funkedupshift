import type { AuthUser } from "../shell/AuthContext";
import {
  hasRole,
  canAccessSquash,
  canAccessInvesting,
  canCreateMemes,
  canAccessExpenses,
} from "../shell/AuthContext";
import {
  ChartBar,
  CurrencyDollar,
  Gear,
  Globe,
  ImageSquare,
  Megaphone,
  Money,
  Palette,
  Truck,
  UsersThree,
  GlobeHemisphereWest,
  Images,
  Smiley,
  Pulse,
  Sparkle,
  Star,
  Fingerprint,
  LinkSimple,
  Key,
  Resize,
  Crop,
  SelectionBackground,
  HardDrives,
  Note,
  ArrowsLeftRight,
  VideoCamera,
  Wallet,
  ChartLineUp,
  Car,
  Receipt,
  Trophy,
  MagicWand,
  UserCircle,
} from "@phosphor-icons/react";

/** Public nav modules (sidebar/header links). */
export interface PublicModule {
  id: string;
  label: string;
  path: string;
  section: "discover" | "recommended" | "memes" | "squash" | "financial" | "vehicles" | "tools";
  minRole: "guest" | "user" | "manager" | "superadmin";
  /** Optional: custom visibility. If absent, uses hasRole(user, minRole). */
  visibility?: (user: AuthUser | null) => boolean;
  /** When true, show for any logged-in user regardless of role. */
  authOnly?: boolean;
  /** Launcher group (Discover / Tools / Modules). Drives the launcher, landing page, section pages and "More in…" footers. */
  group: LauncherGroupId;
  /** Phosphor icon. */
  icon: React.ComponentType<{ className?: string }>;
  /** One-line blurb for cards and launcher search. */
  description: string;
  /** False = reachable (nav, avatar menu, Squash page) but not a launcher tile. Default true. */
  launcher?: boolean;
}

export type LauncherGroupId = "discover" | "tools" | "modules";
export type LockReason = "guest" | "no-access";

/** Admin dashboard modules (cards on /admin). */
export interface AdminModule {
  id: string;
  label: string;
  path: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  minRole: "manager" | "superadmin";
}

export const PUBLIC_MODULES: PublicModule[] = [
  { id: "websites", label: "Websites", path: "/websites", section: "discover", minRole: "guest", group: "discover", icon: GlobeHemisphereWest, description: "The curated index — browse, rate and rank sites." },
  { id: "media", label: "Media", path: "/media", section: "discover", minRole: "guest", group: "discover", icon: Images, description: "A gallery of clips, tracks and oddities." },
  { id: "internet-dashboard", label: "Internet Dashboard", path: "/internet-dashboard", section: "discover", minRole: "guest", group: "discover", icon: Pulse, description: "Live pulse of the domains we track." },
  { id: "my-info", label: "My Info", path: "/my-info", section: "discover", minRole: "guest", group: "tools", icon: Fingerprint, description: "See what your browser, device, and network reveal about you." },
  { id: "profile", label: "Profile", path: "/profile", section: "discover", minRole: "user", authOnly: true, group: "discover", launcher: false, icon: UserCircle, description: "Your account details." },
  { id: "squash", label: "Squash", path: "/squash", section: "squash", minRole: "user", visibility: canAccessSquash, group: "modules", icon: Trophy, description: "Ladder, players and match results." },
  { id: "memes", label: "Memes", path: "/memes", section: "memes", minRole: "guest", group: "discover", icon: Smiley, description: "Browse and rate the freshest memes." },
  { id: "meme-generator", label: "Meme Generator", path: "/memes/create", section: "memes", minRole: "user", visibility: canCreateMemes, group: "modules", icon: MagicWand, description: "Make memes from templates." },
  { id: "finances", label: "Finances", path: "/finances", section: "financial", minRole: "user", authOnly: true, group: "modules", icon: Wallet, description: "Accounts, budgets, transactions and insights." },
  { id: "investing", label: "Investing", path: "/investing", section: "financial", minRole: "user", visibility: canAccessInvesting, group: "modules", icon: ChartLineUp, description: "Watchlists and market data." },
  { id: "vehicles-expenses", label: "Vehicles Expenses", path: "/vehicles-expenses", section: "vehicles", minRole: "user", visibility: canAccessExpenses, group: "modules", icon: Car, description: "Log and track what your rides cost." },
  { id: "general-expenses", label: "General expenses", path: "/general-expenses", section: "vehicles", minRole: "user", visibility: canAccessExpenses, group: "modules", icon: Receipt, description: "Everything else that hits the books." },
  { id: "tools", label: "URL Shortener", path: "/shortener", section: "tools", minRole: "user", authOnly: true, group: "tools", icon: LinkSimple, description: "Mint short links for long URLs." },
  { id: "passwordgen", label: "Password Generator", path: "/password", section: "tools", minRole: "user", authOnly: true, group: "tools", icon: Key, description: "Generate strong, random passwords in your browser." },
  { id: "imagetool", label: "Image Resizer", path: "/images", section: "tools", minRole: "user", authOnly: true, group: "tools", icon: Resize, description: "Resize and compress images." },
  { id: "croptool", label: "Crop Image", path: "/crop", section: "tools", minRole: "user", authOnly: true, group: "tools", icon: Crop, description: "Crop images to the size you need." },
  { id: "removebg", label: "Remove Background", path: "/removebg", section: "tools", minRole: "user", authOnly: true, group: "tools", icon: SelectionBackground, description: "Remove the background from a photo." },
  { id: "dnstool", label: "DNS Lookup", path: "/dns", section: "tools", minRole: "user", authOnly: true, group: "tools", icon: HardDrives, description: "Look up DNS records for any domain." },
  { id: "textshare", label: "Text Share", path: "/textshare", section: "tools", minRole: "user", authOnly: true, group: "tools", icon: Note, description: "Share text snippets with an expiring link." },
  { id: "converters", label: "Converters", path: "/converters", section: "tools", minRole: "user", authOnly: true, group: "tools", icon: ArrowsLeftRight, description: "Convert units, temperatures, and more." },
  { id: "lipsync", label: "Lipsync Studio", path: "/lipsync", section: "tools", minRole: "user", authOnly: true, group: "tools", icon: VideoCamera, description: "Generate AI talking-head clips from a photo or video plus audio." },
  { id: "highlights", label: "Highlights", path: "/recommended/highlights", section: "recommended", minRole: "guest", group: "discover", icon: Sparkle, description: "Hand-picked properties worth a look." },
  { id: "highest-rated", label: "Highest Rated", path: "/recommended/highest-rated", section: "recommended", minRole: "guest", group: "discover", icon: Star, description: "The top of the index, by rating." },
];

export const ADMIN_MODULES: AdminModule[] = [
  { id: "websites", label: "Websites", path: "/admin/websites", description: "Add and manage curated sites, categories, and logos.", icon: Globe, minRole: "manager" },
  { id: "media", label: "Media", path: "/admin/media", description: "Upload and organize media files.", icon: ImageSquare, minRole: "manager" },
  { id: "internet-dashboard", label: "Internet Dashboard", path: "/admin/internet-dashboard", description: "Manage domains shown on the internet dashboard.", icon: ChartBar, minRole: "superadmin" },
  { id: "recommended", label: "Recommended", path: "/admin/recommended", description: "Curate highlights and highest-rated lists.", icon: Sparkle, minRole: "manager" },
  { id: "membership", label: "Membership", path: "/admin/membership", description: "Manage custom groups and member access.", icon: UsersThree, minRole: "manager" },
  { id: "branding", label: "Branding", path: "/admin/branding", description: "Set global logo and branding assets.", icon: Gear, minRole: "superadmin" },
  { id: "themes", label: "Themes", path: "/admin/themes", description: "Colour themes and the site-wide default theme and mode.", icon: Palette, minRole: "superadmin" },
  { id: "stats", label: "Stats", path: "/admin/stats", description: "View app statistics and per-user click paths.", icon: ChartBar, minRole: "superadmin" },
  { id: "social", label: "Social Scheduler", path: "/social", description: "Schedule and publish posts to connected social accounts.", icon: Megaphone, minRole: "superadmin" },
  { id: "lipsync-budgets", label: "Lipsync Budgets", path: "/admin/lipsync-budgets", description: "Review the fal balance and manage each user's lipsync spend budget.", icon: Money, minRole: "superadmin" },
];

/** Sections for sidebar grouping, in display order. */
export const SECTIONS = ["discover", "recommended", "memes", "squash", "financial", "vehicles", "tools", "admin"] as const;

/** Can this user open the module? (authOnly → any signed-in user; else visibility(); else hasRole(minRole).) */
export function canOpenModule(m: PublicModule, user: AuthUser | null): boolean {
  if (m.authOnly) return user !== null;
  if (m.visibility) return m.visibility(user);
  return hasRole(user, m.minRole);
}

/** Filter public modules visible to the given user. */
export function getVisiblePublicModules(user: AuthUser | null): PublicModule[] {
  return PUBLIC_MODULES.filter((m) => canOpenModule(m, user));
}

/** A launcher tile: the module plus its lock state for this user. */
export interface LauncherApp extends PublicModule {
  locked: boolean;
  /** "guest" → signed out (tile sends them to sign-in); "no-access" → signed in but not allowed (inert). */
  lockReason?: LockReason;
}

export interface LauncherGroup {
  id: LauncherGroupId;
  label: string;
  apps: LauncherApp[];
}

export const LAUNCHER_GROUP_LABELS: Record<LauncherGroupId, string> = {
  discover: "Discover",
  tools: "Tools",
  modules: "Modules",
};

/** Every launchable app in Discover / Tools / Modules order — locked ones included, flagged with why. */
export function getLauncherGroups(user: AuthUser | null): LauncherGroup[] {
  const isGuest = !user; // signed-in "guest" role (no Cognito group) sees "No access", not "Sign in"
  return (Object.keys(LAUNCHER_GROUP_LABELS) as LauncherGroupId[]).map((id) => ({
    id,
    label: LAUNCHER_GROUP_LABELS[id],
    apps: PUBLIC_MODULES.filter((m) => m.group === id && m.launcher !== false).map((m) => {
      const locked = !canOpenModule(m, user);
      return { ...m, locked, lockReason: locked ? (isGuest ? "guest" : "no-access") : undefined };
    }),
  }));
}

/** Group public modules by section (admin items come from ADMIN_MODULES). */
export function getPublicModulesBySection(user: AuthUser | null): Record<string, PublicModule[]> {
  const visible = getVisiblePublicModules(user);
  const bySection: Record<string, PublicModule[]> = {};
  for (const m of visible) {
    if (!bySection[m.section]) bySection[m.section] = [];
    bySection[m.section].push(m);
  }
  return bySection;
}

/** Filter admin modules visible to the given user. */
export function getVisibleAdminModules(user: AuthUser | null): AdminModule[] {
  if (!user) return [];
  return ADMIN_MODULES.filter((m) => hasRole(user, m.minRole));
}

/** Link for sidebar flyouts. */
export interface ModuleLink {
  path: string;
  label: string;
}

/** Admin Home sidebar modules (Branding, Membership, Websites, etc.) – excludes Squash/Financial which live under Modules. */
const ADMIN_HOME_IDS = ["branding", "themes", "membership", "websites", "media", "internet-dashboard", "recommended", "stats", "social", "lipsync-budgets"] as const;

/** Admin modules for the Admin Home sidebar section, in display order. */
export function getAdminHomeModules(user: AuthUser | null): AdminModule[] {
  const visible = getVisibleAdminModules(user);
  const order = ADMIN_HOME_IDS;
  return order
    .map((id) => visible.find((m) => m.id === id))
    .filter((m): m is AdminModule => m != null);
}

/** Module group for sidebar (Memes, Expenses, Squash, Financial). */
export interface ModuleGroup {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  getLinks: (user: AuthUser | null) => ModuleLink[];
  isVisible: (user: AuthUser | null) => boolean;
}

const MODULE_GROUPS: ModuleGroup[] = [
  {
    id: "memes",
    label: "Memes",
    icon: ImageSquare,
    isVisible: () => true,
    getLinks: (u) => {
      const links: ModuleLink[] = [{ path: "/memes", label: "Memes Page" }];
      if (canCreateMemes(u)) links.push({ path: "/memes/create", label: "Meme Generator" });
      return links;
    },
  },
  {
    id: "expenses",
    label: "Expenses",
    icon: Truck,
    isVisible: canAccessExpenses,
    getLinks: () => [
      { path: "/vehicles-expenses", label: "Vehicle expenses" },
      { path: "/general-expenses", label: "General expenses" },
    ],
  },
  {
    id: "squash",
    label: "Squash",
    icon: Trophy,
    isVisible: (u) => canAccessSquash(u),
    getLinks: (u) => {
      const links: ModuleLink[] = [];
      if (canAccessSquash(u)) links.push({ path: "/squash", label: "Squash" });
      return links;
    },
  },
  {
    id: "financial",
    label: "Financial",
    icon: CurrencyDollar,
    isVisible: (u) => !!u?.userId,
    getLinks: (u) => {
      const links: ModuleLink[] = [{ path: "/finances", label: "Finances" }];
      if (canAccessInvesting(u)) links.push({ path: "/investing", label: "Investing" });
      return links;
    },
  },
  {
    id: "tools",
    label: "Tools",
    icon: LinkSimple,
    // Visible to guests too — the /tools landing grid and My Info are usable
    // signed-out; the remaining links open their own in-component sign-in
    // prompt when a guest clicks through (see ShortenerPage.tsx etc).
    isVisible: () => true,
    getLinks: () => [
      { path: "/tools", label: "Tools" },
      { path: "/shortener", label: "URL Shortener" },
      { path: "/password", label: "Password Generator" },
      { path: "/images", label: "Image Resizer" },
      { path: "/crop", label: "Crop Image" },
      { path: "/removebg", label: "Remove Background" },
      { path: "/dns", label: "DNS Lookup" },
      { path: "/textshare", label: "Text Share" },
      { path: "/converters", label: "Converters" },
      { path: "/my-info", label: "My Info" },
      { path: "/lipsync", label: "Lipsync Studio" },
    ],
  },
];

/** Module groups visible to the user for the sidebar. Each group's own
 *  isVisible decides guest access (only "tools" currently opts in — the rest
 *  gate on !!user internally via their canAccess* helpers). */
export function getVisibleModuleGroups(user: AuthUser | null): ModuleGroup[] {
  return MODULE_GROUPS.filter((g) => g.isVisible(user) && g.getLinks(user).length > 0);
}
