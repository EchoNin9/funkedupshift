import type { AuthUser } from "../shell/AuthContext";
import {
  hasRole,
  canAccessSquash,
  canModifySquash,
  canAccessFinancial,
  canAccessFinancialAdmin,
  canCreateMemes,
  canAccessExpenses,
} from "../shell/AuthContext";
import {
  GlobeAltIcon,
  PhotoIcon,
  ChartBarIcon,
  TrophyIcon,
  SparklesIcon,
  CurrencyDollarIcon,
  Cog6ToothIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

/** Public nav modules (sidebar/header links). */
export interface PublicModule {
  id: string;
  label: string;
  path: string;
  section: "discover" | "recommended" | "memes" | "squash" | "financial" | "vehicles";
  minRole: "guest" | "user" | "manager" | "superadmin";
  /** Optional: custom visibility. If absent, uses hasRole(user, minRole). */
  visibility?: (user: AuthUser | null) => boolean;
  /** When true, show for any logged-in user regardless of role. */
  authOnly?: boolean;
}

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
  { id: "websites", label: "Websites", path: "/websites", section: "discover", minRole: "guest" },
  { id: "media", label: "Media", path: "/media", section: "discover", minRole: "guest" },
  { id: "internet-dashboard", label: "Internet Dashboard", path: "/internet-dashboard", section: "discover", minRole: "guest" },
  { id: "profile", label: "Profile", path: "/profile", section: "discover", minRole: "user", authOnly: true },
  { id: "squash", label: "Squash", path: "/squash", section: "squash", minRole: "user", visibility: canAccessSquash },
  { id: "squash-admin", label: "Squash Admin", path: "/squash-admin", section: "squash", minRole: "manager", visibility: canModifySquash },
  { id: "memes", label: "Memes", path: "/memes", section: "memes", minRole: "guest" },
  { id: "meme-generator", label: "Meme Generator", path: "/memes/create", section: "memes", minRole: "user", visibility: canCreateMemes },
  { id: "financial", label: "Financial", path: "/financial", section: "financial", minRole: "guest", visibility: canAccessFinancial },
  { id: "financial-admin", label: "Financial Admin", path: "/admin/financial", section: "financial", minRole: "superadmin", visibility: canAccessFinancialAdmin },
  { id: "vehicles-expenses", label: "Vehicles Expenses", path: "/vehicles-expenses", section: "vehicles", minRole: "user", visibility: canAccessExpenses },
  { id: "highlights", label: "Highlights", path: "/recommended/highlights", section: "recommended", minRole: "guest" },
  { id: "highest-rated", label: "Highest Rated", path: "/recommended/highest-rated", section: "recommended", minRole: "guest" },
];

export const ADMIN_MODULES: AdminModule[] = [
  { id: "websites", label: "Websites", path: "/admin/websites", description: "Add and manage curated sites, categories, and logos.", icon: GlobeAltIcon, minRole: "manager" },
  { id: "media", label: "Media", path: "/admin/media", description: "Upload and organize media files.", icon: PhotoIcon, minRole: "manager" },
  { id: "internet-dashboard", label: "Internet Dashboard", path: "/admin/internet-dashboard", description: "Manage domains shown on the internet dashboard.", icon: ChartBarIcon, minRole: "superadmin" },
  { id: "recommended", label: "Recommended", path: "/admin/recommended", description: "Curate highlights and highest-rated lists.", icon: SparklesIcon, minRole: "manager" },
  { id: "membership", label: "Membership", path: "/admin/membership", description: "Manage custom groups and member access.", icon: UserGroupIcon, minRole: "manager" },
  { id: "branding", label: "Branding", path: "/admin/branding", description: "Set global logo and branding assets.", icon: Cog6ToothIcon, minRole: "superadmin" },
  { id: "financial", label: "Financial", path: "/admin/financial", description: "Manage default symbols and financial config.", icon: CurrencyDollarIcon, minRole: "superadmin" },
  { id: "squash", label: "Squash", path: "/squash-admin", description: "Manage squash players and matches.", icon: TrophyIcon, minRole: "manager" },
];

/** Sections for sidebar grouping, in display order. */
export const SECTIONS = ["discover", "recommended", "memes", "squash", "financial", "vehicles", "admin"] as const;

/** Filter public modules visible to the given user. */
export function getVisiblePublicModules(user: AuthUser | null): PublicModule[] {
  return PUBLIC_MODULES.filter((m) => {
    if (m.authOnly) return user !== null;
    if (m.visibility) return m.visibility(user);
    return hasRole(user, m.minRole);
  });
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
