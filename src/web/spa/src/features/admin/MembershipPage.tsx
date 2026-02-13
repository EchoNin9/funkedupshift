import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";
import { fetchWithAuth } from "../../utils/api";

const ROLE_DISPLAY: Record<string, string> = {
  admin: "SuperAdmin",
  manager: "Manager",
  user: "User"
};

const COGNITO_SYSTEM_GROUPS = ["admin", "manager", "user"];

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

interface Group {
  name: string;
  description?: string;
  permissions?: string[];
}

interface Role {
  name: string;
  cognitoGroups?: string[];
  customGroups?: string[];
}

const MembershipPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab = tabParam === "groups" ? "groups" : tabParam === "roles" ? "roles" : "users";
  const [activeTab, setActiveTab] = useState<"users" | "groups" | "roles">(initialTab);

  useEffect(() => {
    if (tabParam === "groups") setActiveTab("groups");
    else if (tabParam === "roles") setActiveTab("roles");
    else setActiveTab("users");
  }, [tabParam]);

  const setTab = (tab: "users" | "groups" | "roles") => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === "groups") next.set("tab", "groups");
    else if (tab === "roles") next.set("tab", "roles");
    else next.delete("tab");
    setSearchParams(next);
  };

  // Users tab state
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [paginationToken, setPaginationToken] = useState<string>("");
  const [tzOffset, setTzOffset] = useState(-8);

  // Groups tab state
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPermissions, setNewPermissions] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editPermissions, setEditPermissions] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  // Roles tab state (SuperAdmin only)
  const [roles, setRoles] = useState<Role[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleCognito, setNewRoleCognito] = useState<string[]>([]);
  const [newRoleCustom, setNewRoleCustom] = useState<string[]>([]);
  const [isRoleSubmitting, setIsRoleSubmitting] = useState(false);
  const [roleMessage, setRoleMessage] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editRoleCognito, setEditRoleCognito] = useState<string[]>([]);
  const [editRoleCustom, setEditRoleCustom] = useState<string[]>([]);
  const [isRoleUpdating, setIsRoleUpdating] = useState(false);
  const [roleUpdateError, setRoleUpdateError] = useState<string | null>(null);
  const [deletingRole, setDeletingRole] = useState<string | null>(null);

  const canAccess = hasRole(user ?? null, "manager");
  const isSuperAdmin = user?.role === "superadmin";

  const loadUsers = async (nextToken?: string) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setUsersError("API URL not set.");
      setUsersLoading(false);
      return;
    }
    const w = window as any;
    if (!w.auth?.getAccessToken) {
      setUsersError("Sign in required.");
      setUsersLoading(false);
      return;
    }
    setUsersLoading(true);
    setUsersError(null);
    try {
      let url = `${apiBase}/admin/users`;
      if (nextToken) url += `?paginationToken=${encodeURIComponent(nextToken)}`;
      const resp = await fetchWithAuth(url);
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to load users");
      }
      const data = (await resp.json()) as { users?: User[]; paginationToken?: string };
      setUsers((prev) => (nextToken ? [...prev, ...(data.users ?? [])] : data.users ?? []));
      setPaginationToken(data.paginationToken ?? "");
    } catch (e: any) {
      setUsersError(e?.message ?? "Failed to load users");
    } finally {
      setUsersLoading(false);
    }
  };

  const loadUserGroups = async (u: User): Promise<{ cognitoGroups: string[]; customGroups: string[] }> => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return { cognitoGroups: [], customGroups: [] };
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/users/${encodeURIComponent(u.username)}/groups`);
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

  const loadGroups = async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setGroupsError("API URL not set.");
      setGroupsLoading(false);
      return;
    }
    const w = window as any;
    if (!w.auth?.getAccessToken) {
      setGroupsError("Sign in required.");
      setGroupsLoading(false);
      return;
    }
    setGroupsLoading(true);
    setGroupsError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/groups`);
      if (!resp.ok) throw new Error(await resp.text());
      const data = (await resp.json()) as { groups?: { name?: string; PK?: string; description?: string; permissions?: string[] }[] };
      const list = (data.groups ?? []).map((g) => ({
        name: g.name ?? (g.PK ?? "").replace("GROUP#", ""),
        description: g.description,
        permissions: Array.isArray(g.permissions) ? g.permissions : []
      }));
      list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      setGroups(list);
    } catch (e: any) {
      setGroupsError(e?.message ?? "Failed to load groups");
    } finally {
      setGroupsLoading(false);
    }
  };

  useEffect(() => {
    const stored = parseInt(sessionStorage.getItem("funkedupshift_lastlogin_tz") ?? "-8", 10);
    if (!isNaN(stored) && TZ_OPTIONS.some((o) => o.value === stored)) setTzOffset(stored);
  }, []);

  useEffect(() => {
    if (canAccess && activeTab === "users") loadUsers();
  }, [canAccess, activeTab]);

  useEffect(() => {
    if (canAccess && (activeTab === "groups" || activeTab === "roles")) loadGroups();
  }, [canAccess, activeTab]);

  const loadRoles = async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setRolesError("API URL not set.");
      setRolesLoading(false);
      return;
    }
    const w = window as any;
    if (!w.auth?.getAccessToken) {
      setRolesError("Sign in required.");
      setRolesLoading(false);
      return;
    }
    setRolesLoading(true);
    setRolesError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/roles`);
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to load roles");
      }
      const data = (await resp.json()) as { roles?: Role[] };
      setRoles(data.roles ?? []);
    } catch (e: any) {
      setRolesError(e?.message ?? "Failed to load roles");
    } finally {
      setRolesLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin && activeTab === "roles") loadRoles();
  }, [isSuperAdmin, activeTab]);

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

  const startEdit = (g: Group) => {
    setEditingName(g.name);
    setEditDescription(g.description ?? "");
    setEditPermissions((g.permissions ?? []).join(", "));
    setUpdateError(null);
  };

  const cancelEdit = () => {
    setEditingName(null);
    setEditDescription("");
    setEditPermissions("");
    setUpdateError(null);
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    const permissions = newPermissions
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    setIsSubmitting(true);
    setMessage(null);
    setGroupsError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: newDescription.trim(), permissions })
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to create group");
      }
      setNewName("");
      setNewDescription("");
      setNewPermissions("");
      setMessage("Group created.");
      loadGroups();
    } catch (e: any) {
      setGroupsError(e?.message ?? "Failed to create group");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingName) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    const permissions = editPermissions
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    setIsUpdating(true);
    setUpdateError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/groups/${encodeURIComponent(editingName)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: editDescription, permissions })
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to update group");
      }
      setGroups((prev) =>
        prev.map((g) =>
          g.name === editingName ? { ...g, description: editDescription, permissions } : g
        )
      );
      cancelEdit();
    } catch (e: any) {
      setUpdateError(e?.message ?? "Failed to update group");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteGroup = async (name: string) => {
    if (!window.confirm(`Delete group "${name}"? Members will lose access.`)) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    setDeletingName(name);
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/groups/${encodeURIComponent(name)}`, {
        method: "DELETE"
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to delete group");
      }
      setGroups((prev) => prev.filter((g) => g.name !== name));
      if (editingName === name) cancelEdit();
    } catch (e: any) {
      setGroupsError(e?.message ?? "Failed to delete group");
    } finally {
      setDeletingName(null);
    }
  };

  const handleTzChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = parseInt(e.target.value, 10);
    setTzOffset(v);
    sessionStorage.setItem("funkedupshift_lastlogin_tz", String(v));
  };

  const toggleCognito = (g: string, list: string[], setter: (v: string[]) => void) => {
    if (list.includes(g)) setter(list.filter((x) => x !== g));
    else setter([...list, g]);
  };
  const toggleCustom = (g: string, list: string[], setter: (v: string[]) => void) => {
    if (list.includes(g)) setter(list.filter((x) => x !== g));
    else setter([...list, g]);
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newRoleName.trim();
    if (!name) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    setIsRoleSubmitting(true);
    setRoleMessage(null);
    setRolesError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, cognitoGroups: newRoleCognito, customGroups: newRoleCustom })
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to create role");
      }
      setNewRoleName("");
      setNewRoleCognito([]);
      setNewRoleCustom([]);
      setRoleMessage("Role created.");
      loadRoles();
    } catch (e: any) {
      setRolesError(e?.message ?? "Failed to create role");
    } finally {
      setIsRoleSubmitting(false);
    }
  };

  const startEditRole = (r: Role) => {
    setEditingRole(r.name);
    setEditRoleCognito(r.cognitoGroups ?? []);
    setEditRoleCustom(r.customGroups ?? []);
    setRoleUpdateError(null);
  };
  const cancelEditRole = () => {
    setEditingRole(null);
    setEditRoleCognito([]);
    setEditRoleCustom([]);
    setRoleUpdateError(null);
  };

  const handleUpdateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRole) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    setIsRoleUpdating(true);
    setRoleUpdateError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/roles/${encodeURIComponent(editingRole)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cognitoGroups: editRoleCognito, customGroups: editRoleCustom })
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to update role");
      }
      setRoles((prev) =>
        prev.map((r) =>
          r.name === editingRole ? { ...r, cognitoGroups: editRoleCognito, customGroups: editRoleCustom } : r
        )
      );
      cancelEditRole();
    } catch (e: any) {
      setRoleUpdateError(e?.message ?? "Failed to update role");
    } finally {
      setIsRoleUpdating(false);
    }
  };

  const handleDeleteRole = async (name: string) => {
    if (!window.confirm(`Delete role "${name}"?`)) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    setDeletingRole(name);
    try {
      const resp = await fetchWithAuth(`${apiBase}/admin/roles/${encodeURIComponent(name)}`, {
        method: "DELETE"
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to delete role");
      }
      setRoles((prev) => prev.filter((r) => r.name !== name));
      if (editingRole === name) cancelEditRole();
    } catch (e: any) {
      setRolesError(e?.message ?? "Failed to delete role");
    } finally {
      setDeletingRole(null);
    }
  };

  if (!canAccess) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Membership</h1>
        <p className="text-sm text-slate-400">Manager or SuperAdmin access is required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Home
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Membership</h1>
        <p className="text-sm text-slate-400">Manage users and groups.</p>
      </header>

      <div className="flex gap-2 border-b border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setTab("users")}
          className={`px-4 py-2 rounded-md text-sm font-medium ${activeTab === "users" ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}
        >
          Users
        </button>
        <button
          type="button"
          onClick={() => setTab("groups")}
          className={`px-4 py-2 rounded-md text-sm font-medium ${activeTab === "groups" ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}
        >
          Groups
        </button>
        {isSuperAdmin && (
          <button
            type="button"
            onClick={() => setTab("roles")}
            className={`px-4 py-2 rounded-md text-sm font-medium ${activeTab === "roles" ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}
          >
            Roles
          </button>
        )}
      </div>

      {activeTab === "users" && (
        <>
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

          {usersError && (
            <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-200">{usersError}</div>
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
                {usersLoading && users.length === 0 ? (
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
                onClick={() => loadUsers(paginationToken)}
                disabled={usersLoading}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                {usersLoading ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}

      {activeTab === "groups" && (
        <>
          <form className="space-y-3 max-w-md" onSubmit={handleCreateGroup}>
            <h2 className="text-sm font-medium text-slate-300">Create group</h2>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name (alphanumeric, underscore, hyphen)"
              required
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
            />
            <input
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Description (optional)"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
            />
            <input
              type="text"
              value={newPermissions}
              onChange={(e) => setNewPermissions(e.target.value)}
              placeholder="Permissions (comma-separated, e.g. media:edit, sites:add)"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
            />
            <button
              type="submit"
              disabled={isSubmitting || !newName.trim()}
              className="inline-flex items-center justify-center rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-500 disabled:opacity-50"
            >
              {isSubmitting ? "Creating…" : "Create"}
            </button>
            {message && (
              <div className="rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</div>
            )}
            {groupsError && (
              <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-200">{groupsError}</div>
            )}
          </form>

          <section>
            <h2 className="text-sm font-medium text-slate-300 mb-2">Custom groups</h2>
            {groupsLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-slate-500">No custom groups yet. Create one above.</p>
            ) : (
              <ul className="space-y-2">
                {groups.map((g) => (
                  <li key={g.name} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
                    {editingName === g.name ? (
                      <form onSubmit={handleUpdateGroup} className="space-y-2">
                        <span className="font-medium text-slate-200">{g.name}</span>
                        <input
                          type="text"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          placeholder="Description (optional)"
                          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
                        />
                        <input
                          type="text"
                          value={editPermissions}
                          onChange={(e) => setEditPermissions(e.target.value)}
                          placeholder="Permissions (comma-separated)"
                          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
                        />
                        <div className="flex gap-2 flex-wrap">
                          <button
                            type="submit"
                            disabled={isUpdating}
                            className="rounded-md bg-brand-orange px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-orange-500 disabled:opacity-50"
                          >
                            {isUpdating ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteGroup(g.name)}
                            disabled={deletingName === g.name}
                            className="rounded-md border border-red-500/60 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                          >
                            {deletingName === g.name ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                        {updateError && <p className="text-xs text-red-400">{updateError}</p>}
                      </form>
                    ) : (
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-slate-200">{g.name}</span>
                          {g.description && <span className="text-slate-500 ml-2">{g.description}</span>}
                          {g.permissions && g.permissions.length > 0 && (
                            <div className="text-xs text-slate-500 mt-1">Permissions: {g.permissions.join(", ")}</div>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEdit(g)}
                            className="rounded-md border border-slate-700 px-2 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteGroup(g.name)}
                            disabled={deletingName === g.name}
                            className="rounded-md border border-red-500/60 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                          >
                            {deletingName === g.name ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {activeTab === "roles" && isSuperAdmin && (
        <>
          <form className="space-y-3 max-w-md" onSubmit={handleCreateRole}>
            <h2 className="text-sm font-medium text-slate-300">Create role</h2>
            <p className="text-xs text-slate-500">Define a named role by selecting Cognito groups and custom groups. Use for impersonation.</p>
            <input
              type="text"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder="Role name (e.g. Squash Manager)"
              required
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
            />
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Cognito groups</label>
              <div className="flex flex-wrap gap-2">
                {COGNITO_SYSTEM_GROUPS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggleCognito(g, newRoleCognito, setNewRoleCognito)}
                    className={`rounded-md px-2 py-1 text-xs font-medium ${
                      newRoleCognito.includes(g) ? "bg-blue-500/30 text-blue-200" : "border border-slate-600 text-slate-400 hover:bg-slate-800"
                    }`}
                  >
                    {ROLE_DISPLAY[g] || g}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Custom groups</label>
              <div className="flex flex-wrap gap-2">
                {groups.map((g) => (
                  <button
                    key={g.name}
                    type="button"
                    onClick={() => toggleCustom(g.name, newRoleCustom, setNewRoleCustom)}
                    className={`rounded-md px-2 py-1 text-xs font-medium ${
                      newRoleCustom.includes(g.name) ? "bg-emerald-500/30 text-emerald-200" : "border border-slate-600 text-slate-400 hover:bg-slate-800"
                    }`}
                  >
                    {g.name}
                  </button>
                ))}
                {groups.length === 0 && <span className="text-xs text-slate-500">Create groups first.</span>}
              </div>
            </div>
            <button
              type="submit"
              disabled={isRoleSubmitting || !newRoleName.trim()}
              className="inline-flex items-center justify-center rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-500 disabled:opacity-50"
            >
              {isRoleSubmitting ? "Creating…" : "Create"}
            </button>
            {roleMessage && (
              <div className="rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{roleMessage}</div>
            )}
            {rolesError && (
              <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-200">{rolesError}</div>
            )}
          </form>

          <section>
            <h2 className="text-sm font-medium text-slate-300 mb-2">Defined roles</h2>
            {rolesLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : roles.length === 0 ? (
              <p className="text-sm text-slate-500">No roles yet. Create one above.</p>
            ) : (
              <ul className="space-y-2">
                {roles.map((r) => (
                  <li key={r.name} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
                    {editingRole === r.name ? (
                      <form onSubmit={handleUpdateRole} className="space-y-2">
                        <span className="font-medium text-slate-200">{r.name}</span>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Cognito groups</label>
                          <div className="flex flex-wrap gap-2">
                            {COGNITO_SYSTEM_GROUPS.map((g) => (
                              <button
                                key={g}
                                type="button"
                                onClick={() => toggleCognito(g, editRoleCognito, setEditRoleCognito)}
                                className={`rounded-md px-2 py-1 text-xs ${editRoleCognito.includes(g) ? "bg-blue-500/30 text-blue-200" : "border border-slate-600 text-slate-400"}`}
                              >
                                {ROLE_DISPLAY[g] || g}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Custom groups</label>
                          <div className="flex flex-wrap gap-2">
                            {groups.map((g) => (
                              <button
                                key={g.name}
                                type="button"
                                onClick={() => toggleCustom(g.name, editRoleCustom, setEditRoleCustom)}
                                className={`rounded-md px-2 py-1 text-xs ${editRoleCustom.includes(g.name) ? "bg-emerald-500/30 text-emerald-200" : "border border-slate-600 text-slate-400"}`}
                              >
                                {g.name}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={isRoleUpdating}
                            className="rounded-md bg-brand-orange px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-orange-500 disabled:opacity-50"
                          >
                            {isRoleUpdating ? "Saving…" : "Save"}
                          </button>
                          <button type="button" onClick={cancelEditRole} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRole(r.name)}
                            disabled={deletingRole === r.name}
                            className="rounded-md border border-red-500/60 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                          >
                            {deletingRole === r.name ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                        {roleUpdateError && <p className="text-xs text-red-400">{roleUpdateError}</p>}
                      </form>
                    ) : (
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-slate-200">{r.name}</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(r.cognitoGroups ?? []).map((g) => (
                              <span key={`c-${g}`} className="inline-block px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-200">
                                {ROLE_DISPLAY[g] || g}
                              </span>
                            ))}
                            {(r.customGroups ?? []).map((g) => (
                              <span key={`x-${g}`} className="inline-block px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-200">
                                {g}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button type="button" onClick={() => startEditRole(r)} className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRole(r.name)}
                            disabled={deletingRole === r.name}
                            className="rounded-md border border-red-500/60 px-2 py-1 text-xs text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                          >
                            {deletingRole === r.name ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
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
    <tr className="cursor-pointer hover:bg-slate-800/50 transition-colors" onClick={onClick}>
      <td className="px-4 py-3 text-sm text-slate-200">{user.email || user.username || "—"}</td>
      <td className="px-4 py-3 text-sm text-slate-400">{user.status || "—"}</td>
      <td className="px-4 py-3 text-sm text-slate-400">{formatLastLogin(user.lastLoginAt ?? "", tzOffset, user.lastLoginIp)}</td>
      <td className="px-4 py-3 text-sm">{groups ? renderGroupBadges(groups.cognitoGroups, []) : <span className="text-slate-500">…</span>}</td>
      <td className="px-4 py-3 text-sm">{groups ? renderGroupBadges([], groups.customGroups) : <span className="text-slate-500">…</span>}</td>
    </tr>
  );
};

export default MembershipPage;
