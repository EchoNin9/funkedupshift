import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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

const chipClass = (name: string) => {
  if (name === "admin") return "bg-amber-500/20 text-amber-200";
  if (name === "manager") return "bg-blue-500/20 text-blue-200";
  if (name === "user") return "bg-slate-600/30 text-slate-300";
  return "bg-emerald-500/20 text-emerald-200";
};

const EditUserPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const username = searchParams.get("username") ?? "";
  const emailParam = searchParams.get("email") ?? "";
  const statusParam = searchParams.get("status") ?? "";

  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userData, setUserData] = useState<{
    email: string;
    status: string;
    lastLoginAt: string;
    lastLoginIp: string;
    cognitoGroups: string[];
    customGroups: string[];
  } | null>(null);
  const [allCustomGroups, setAllCustomGroups] = useState<string[]>([]);
  const [selectedSystemRoles, setSelectedSystemRoles] = useState<string[]>([]);
  const [selectedCustomGroups, setSelectedCustomGroups] = useState<string[]>([]);
  const [customGroupSearch, setCustomGroupSearch] = useState("");
  const [customDropdownOpen, setCustomDropdownOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tzOffset, setTzOffset] = useState(-8);

  const canAccess = hasRole(user ?? null, "manager");
  const isSuperAdmin = user?.groups?.includes("admin") ?? false;

  // Only SuperAdmin can add/remove admin or manager; managers can only add/remove user
  const systemRoleOptions = isSuperAdmin ? ["admin", "manager", "user"] : ["user"];

  const load = async () => {
    if (!username) return;
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
      const [groupsResp, allGroupsResp] = await Promise.all([
        fetch(`${apiBase}/admin/users/${encodeURIComponent(username)}/groups`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`${apiBase}/admin/groups`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      if (!groupsResp.ok) {
        const d = await groupsResp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to load user");
      }
      const groupsData = (await groupsResp.json()) as {
        username?: string;
        cognitoGroups?: string[];
        customGroups?: string[];
        lastLoginAt?: string;
        lastLoginIp?: string;
      };
      const allGroupsData = (await allGroupsResp.json()) as { groups?: { name?: string; PK?: string }[] };
      const customList = (allGroupsData.groups ?? []).map((g) => g.name ?? (g.PK ?? "").replace("GROUP#", "")).filter(Boolean);
      setUserData({
        email: groupsData.username ?? username,
        status: statusParam,
        lastLoginAt: groupsData.lastLoginAt ?? "",
        lastLoginIp: groupsData.lastLoginIp ?? "",
        cognitoGroups: groupsData.cognitoGroups ?? [],
        customGroups: groupsData.customGroups ?? []
      });
      setSelectedSystemRoles([...(groupsData.cognitoGroups ?? [])]);
      setSelectedCustomGroups([...(groupsData.customGroups ?? [])]);
      setAllCustomGroups(customList);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load user");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const stored = parseInt(sessionStorage.getItem("funkedupshift_lastlogin_tz") ?? "-8", 10);
    if (!isNaN(stored) && TZ_OPTIONS.some((o) => o.value === stored)) setTzOffset(stored);
  }, []);

  useEffect(() => {
    if (canAccess && username) load();
  }, [canAccess, username]);

  const addSystemRole = (name: string) => {
    if (name && !selectedSystemRoles.includes(name)) {
      setSelectedSystemRoles((prev) => [...prev, name]);
    }
  };

  const removeSystemRole = (name: string) => {
    setSelectedSystemRoles((prev) => prev.filter((x) => x !== name));
  };

  const addCustomGroup = (name: string) => {
    if (name && !selectedCustomGroups.includes(name)) {
      setSelectedCustomGroups((prev) => [...prev, name]);
      setCustomGroupSearch("");
      setCustomDropdownOpen(false);
    }
  };

  const removeCustomGroup = (name: string) => {
    setSelectedCustomGroups((prev) => prev.filter((x) => x !== name));
  };

  const customGroupOptions = allCustomGroups.filter((g) => {
    if (selectedCustomGroups.includes(g)) return false;
    if (!customGroupSearch.trim()) return true;
    return g.toLowerCase().includes(customGroupSearch.toLowerCase().trim());
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;

    const currentCognito = userData?.cognitoGroups ?? [];
    const currentCustom = userData?.customGroups ?? [];
    let toAddCognito = selectedSystemRoles.filter((g) => !currentCognito.includes(g));
    let toRemoveCognito = currentCognito.filter((g) => !selectedSystemRoles.includes(g));
    // Managers can only add/remove "user" role; admin/manager require SuperAdmin
    if (!isSuperAdmin) {
      toAddCognito = toAddCognito.filter((g) => g === "user");
      toRemoveCognito = toRemoveCognito.filter((g) => g === "user");
    }
    const toAddCustom = selectedCustomGroups.filter((g) => !currentCustom.includes(g));
    const toRemoveCustom = currentCustom.filter((g) => !selectedCustomGroups.includes(g));

    setIsSubmitting(true);
    setSaveError(null);
    try {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      const opts = { headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } };
      const enc = encodeURIComponent;

      const promises: Promise<Response>[] = [];
      toAddCognito.forEach((g) =>
        promises.push(fetch(`${apiBase}/admin/users/${enc(username)}/groups`, { method: "POST", ...opts, body: JSON.stringify({ groupName: g }) }))
      );
      toRemoveCognito.forEach((g) =>
        promises.push(fetch(`${apiBase}/admin/users/${enc(username)}/groups/${enc(g)}`, { method: "DELETE", headers: opts.headers }))
      );
      toAddCustom.forEach((g) =>
        promises.push(fetch(`${apiBase}/admin/users/${enc(username)}/groups`, { method: "POST", ...opts, body: JSON.stringify({ groupName: g }) }))
      );
      toRemoveCustom.forEach((g) =>
        promises.push(fetch(`${apiBase}/admin/users/${enc(username)}/groups/${enc(g)}`, { method: "DELETE", headers: opts.headers }))
      );

      const results = await Promise.all(promises);
      const failed = results.find((r) => !r.ok);
      if (failed) {
        const d = await failed.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to save");
      }
      window.alert("Changes saved");
      navigate("/admin/users");
    } catch (e: any) {
      setSaveError(e?.message ?? "Failed to save");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTzChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = parseInt(e.target.value, 10);
    setTzOffset(v);
    sessionStorage.setItem("funkedupshift_lastlogin_tz", String(v));
  };

  if (!canAccess) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Edit User</h1>
        <p className="text-sm text-slate-400">Manager or SuperAdmin access is required.</p>
      </div>
    );
  }

  if (!username) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Edit User</h1>
        <p className="text-sm text-slate-400">Missing username in URL.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Edit User</h1>
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  if (error || !userData) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Edit User</h1>
        <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error ?? "Failed to load user"}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/admin/users"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to users
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Edit User</h1>
        <p className="text-sm text-slate-400">Adjust system roles and custom groups.</p>
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

      <form onSubmit={handleSave} className="space-y-6 max-w-2xl">
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
          <h2 className="text-sm font-medium text-slate-300 mb-3">User info</h2>
          <table className="text-sm">
            <tbody>
              <tr>
                <td className="py-1 pr-4 font-medium text-slate-400 w-28">Email</td>
                <td className="py-1 text-slate-200">{emailParam || userData.email}</td>
              </tr>
              <tr>
                <td className="py-1 pr-4 font-medium text-slate-400">Status</td>
                <td className="py-1 text-slate-200">{statusParam || userData.status || "—"}</td>
              </tr>
              <tr>
                <td className="py-1 pr-4 font-medium text-slate-400">Last login</td>
                <td className="py-1 text-slate-200">
                  {formatLastLogin(userData.lastLoginAt, tzOffset, userData.lastLoginIp)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-200">System roles</label>
          <select
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 w-full max-w-xs"
            onChange={(e) => {
              const v = e.target.value;
              if (v) addSystemRole(v);
              e.target.value = "";
            }}
          >
            <option value="">Select role to add…</option>
            {systemRoleOptions
              .filter((r) => !selectedSystemRoles.includes(r))
              .map((r) => (
                <option key={r} value={r}>
                  {ROLE_DISPLAY[r] ?? r}
                </option>
              ))}
          </select>
          <div className="flex flex-wrap gap-2 mt-2">
            {selectedSystemRoles.map((name) => {
              const canRemove = isSuperAdmin || name === "user";
              return (
                <span
                  key={name}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm ${chipClass(name)}`}
                >
                  {ROLE_DISPLAY[name] ?? name}
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => removeSystemRole(name)}
                      className="ml-0.5 hover:text-red-300"
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-200">Custom groups</label>
          {allCustomGroups.length === 0 ? (
            <p className="text-sm text-slate-500">
              No custom groups. <Link to="/admin/groups" className="text-brand-orange hover:underline">Create groups</Link>.
            </p>
          ) : (
            <>
              <div className="relative max-w-xs">
                <input
                  type="text"
                  value={customGroupSearch}
                  onChange={(e) => {
                    setCustomGroupSearch(e.target.value);
                    setCustomDropdownOpen(true);
                  }}
                  onFocus={() => setCustomDropdownOpen(true)}
                  placeholder="Search or select groups…"
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500"
                />
                {customDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setCustomDropdownOpen(false)}
                      aria-hidden="true"
                    />
                    <div className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded border border-slate-700 bg-slate-900 shadow-lg z-20">
                      {customGroupOptions.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-slate-500">No matches</div>
                      ) : (
                        customGroupOptions.map((g) => (
                          <button
                            key={g}
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                            onClick={() => addCustomGroup(g)}
                          >
                            {g}
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {selectedCustomGroups.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-sm bg-emerald-500/20 text-emerald-200"
                  >
                    {name}
                    <button
                      type="button"
                      onClick={() => removeCustomGroup(name)}
                      className="ml-0.5 hover:text-red-300"
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-500 disabled:opacity-50"
          >
            {isSubmitting ? "Saving…" : "Save"}
          </button>
          <Link
            to="/admin/users"
            className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </Link>
        </div>
        {saveError && (
          <p className="text-sm text-red-400">{saveError}</p>
        )}
      </form>
    </div>
  );
};

export default EditUserPage;
