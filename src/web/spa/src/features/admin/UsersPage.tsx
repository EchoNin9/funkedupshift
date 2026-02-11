import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";

const ROLE_DISPLAY: Record<string, string> = {
  admin: "SuperAdmin",
  manager: "Manager",
  user: "User"
};

const TZ_OPTIONS = [
  { value: -8, label: "UTC-8" },
  { value: -5, label: "UTC-5" },
  { value: 0, label: "UTC+0/GMT" }
];

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

function formatLastLogin(isoString: string, offsetHours: number, ip?: string): string {
  if (!isoString && !ip) return "—";
  if (!isoString) return ip ? `from ${ip}` : "—";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString + (ip ? ` from ${ip}` : "");
    const t = d.getTime() + (offsetHours || 0) * 3600000;
    const disp = new Date(t);
    const pad = (n: number) => (n < 10 ? "0" + n : "" + n);
    const y = disp.getUTCFullYear();
    const m = pad(disp.getUTCMonth() + 1);
    const day = pad(disp.getUTCDate());
    const h = pad(disp.getUTCHours());
    const min = pad(disp.getUTCMinutes());
    const opt = TZ_OPTIONS.find((o) => o.value === offsetHours);
    const label = opt ? opt.label : offsetHours < 0 ? "UTC" + offsetHours : "UTC+" + offsetHours;
    let text = `${y}-${m}-${day} ${h}:${min} ${label}`;
    if (ip) text += ` from ${ip}`;
    return text;
  } catch {
    return isoString + (ip ? ` from ${ip}` : "");
  }
}

interface User {
  username: string;
  email?: string;
  status?: string;
  lastLoginAt?: string;
  lastLoginIp?: string;
  cognitoGroups?: string[];
  customGroups?: string[];
}

const UsersPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paginationToken, setPaginationToken] = useState<string>("");
  const [tzOffset, setTzOffset] = useState(-8);

  const canAccess = hasRole(user ?? null, "manager");

  const loadUsers = async (nextToken?: string) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setError("API URL not set.");
      setLoading(false);
      return;
    }
    const w = window as any;
    if (!w.auth?.getAccessToken) {
      setError("Sign in required.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      let url = `${apiBase}/admin/users`;
      if (nextToken) url += `?paginationToken=${encodeURIComponent(nextToken)}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to load users");
      }
      const data = (await resp.json()) as { users?: User[]; paginationToken?: string };
      setUsers((prev) => (nextToken ? [...prev, ...(data.users ?? [])] : data.users ?? []));
      setPaginationToken(data.paginationToken ?? "");
    } catch (e: any) {
      setError(e?.message ?? "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const loadUserGroups = async (u: User): Promise<{ cognitoGroups: string[]; customGroups: string[] }> => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return { cognitoGroups: [], customGroups: [] };
    const w = window as any;
    if (!w.auth?.getAccessToken) return { cognitoGroups: [], customGroups: [] };
    try {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      const resp = await fetch(`${apiBase}/admin/users/${encodeURIComponent(u.username)}/groups`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) return { cognitoGroups: [], customGroups: [] };
      const d = (await resp.json()) as { cognitoGroups?: string[]; customGroups?: string[] };
      return {
        cognitoGroups: d.cognitoGroups ?? [],
        customGroups: d.customGroups ?? []
      };
    } catch {
      return { cognitoGroups: [], customGroups: [] };
    }
  };

  useEffect(() => {
    const stored = parseInt(sessionStorage.getItem("funkedupshift_lastlogin_tz") ?? "-8", 10);
    if (!isNaN(stored) && TZ_OPTIONS.some((o) => o.value === stored)) setTzOffset(stored);
  }, []);

  useEffect(() => {
    if (canAccess) loadUsers();
  }, [canAccess]);

  const handleLoadMore = () => {
    if (paginationToken) loadUsers(paginationToken);
  };

  const handleTzChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = parseInt(e.target.value, 10);
    setTzOffset(v);
    sessionStorage.setItem("funkedupshift_lastlogin_tz", String(v));
  };

  const handleRowClick = (u: User) => {
    navigate(
      `/admin/users/edit?username=${encodeURIComponent(u.username)}&email=${encodeURIComponent(u.email ?? "")}&status=${encodeURIComponent(u.status ?? "")}`
    );
  };

  const renderGroupBadges = (cognitoGroups: string[], customGroups: string[]) => {
    const items: React.ReactNode[] = [];
    (cognitoGroups || []).forEach((g) => {
      const display = ROLE_DISPLAY[g] || g;
      const cls =
        g === "admin" ? "bg-amber-500/20 text-amber-200" : g === "manager" ? "bg-blue-500/20 text-blue-200" : "bg-slate-600/30 text-slate-300";
      items.push(
        <span key={`c-${g}`} className={`inline-block px-2 py-0.5 rounded text-xs mr-1 ${cls}`}>
          {display}
        </span>
      );
    });
    (customGroups || []).forEach((g) => {
      items.push(
        <span key={`x-${g}`} className="inline-block px-2 py-0.5 rounded text-xs mr-1 bg-emerald-500/20 text-emerald-200">
          {g}
        </span>
      );
    });
    return items.length ? items : <span className="text-slate-500">—</span>;
  };

  if (!canAccess) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">User Management</h1>
        <p className="text-sm text-slate-400">Manager or SuperAdmin access is required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Home
      </Link>
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50">User Management</h1>
          <Link
            to="/admin/groups"
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            Manage Groups
          </Link>
        </div>
        <p className="text-sm text-slate-400">View and edit user roles and custom groups.</p>
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="tz-select" className="text-slate-500">
            Last login timezone:
          </label>
          <select
            id="tz-select"
            value={tzOffset}
            onChange={handleTzChange}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200 text-sm"
          >
            {TZ_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="min-w-full divide-y divide-slate-800">
          <thead className="bg-slate-900/80">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Email</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Last login</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">System Roles</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Custom Groups</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <UserRow
                  key={u.username}
                  user={u}
                  tzOffset={tzOffset}
                  formatLastLogin={formatLastLogin}
                  renderGroupBadges={renderGroupBadges}
                  loadUserGroups={loadUserGroups}
                  onClick={() => handleRowClick(u)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {paginationToken && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loading}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
};

interface UserRowProps {
  user: User;
  tzOffset: number;
  formatLastLogin: (iso: string, offset: number, ip?: string) => string;
  renderGroupBadges: (cognito: string[], custom: string[]) => React.ReactNode;
  loadUserGroups: (u: User) => Promise<{ cognitoGroups: string[]; customGroups: string[] }>;
  onClick: () => void;
}

const UserRow: React.FC<UserRowProps> = ({ user, tzOffset, formatLastLogin, renderGroupBadges, loadUserGroups, onClick }) => {
  const [groups, setGroups] = useState<{ cognitoGroups: string[]; customGroups: string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadUserGroups(user).then((g) => {
      if (!cancelled) setGroups(g);
    });
    return () => {
      cancelled = true;
    };
  }, [user.username]);

  return (
    <tr
      className="cursor-pointer hover:bg-slate-800/50 transition-colors"
      onClick={onClick}
    >
      <td className="px-4 py-3 text-sm text-slate-200">{user.email || user.username || "—"}</td>
      <td className="px-4 py-3 text-sm text-slate-400">{user.status || "—"}</td>
      <td className="px-4 py-3 text-sm text-slate-400">
        {formatLastLogin(user.lastLoginAt ?? "", tzOffset, user.lastLoginIp)}
      </td>
      <td className="px-4 py-3 text-sm">
        {groups ? renderGroupBadges(groups.cognitoGroups, []) : <span className="text-slate-500">…</span>}
      </td>
      <td className="px-4 py-3 text-sm">
        {groups ? renderGroupBadges([], groups.customGroups) : <span className="text-slate-500">…</span>}
      </td>
    </tr>
  );
};

export default UsersPage;
