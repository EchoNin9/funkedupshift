import React, { useEffect, useState } from "react";
import { Dialog } from "@headlessui/react";
import { UserCircleIcon } from "@heroicons/react/24/outline";
import { useImpersonation } from "./ImpersonationContext";
import { useAuth } from "./AuthContext";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

interface ImpersonationUser {
  username: string;
  email?: string;
  sub?: string;
}

interface ImpersonationRole {
  name: string;
  cognitoGroups?: string[];
  customGroups?: string[];
}

const ImpersonationSelector: React.FC = () => {
  const { user, refreshAuth } = useAuth();
  const { impersonation, setImpersonation, clearImpersonation } = useImpersonation();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<ImpersonationUser[]>([]);
  const [roles, setRoles] = useState<ImpersonationRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = getApiBaseUrl();

  useEffect(() => {
    if (!open || !apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    setLoading(true);
    setError(null);
    const load = async () => {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      if (!token) {
        setError("Not signed in");
        setLoading(false);
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };
      try {
        const [usersResp, rolesResp] = await Promise.all([
          fetch(`${apiBase}/admin/users?limit=100`, { headers }),
          fetch(`${apiBase}/admin/roles`, { headers })
        ]);
        const usersData = usersResp.ok ? await usersResp.json() : null;
        const rolesData = rolesResp.ok ? await rolesResp.json() : null;
        if (!usersResp.ok) throw new Error("Failed to load users");
        if (!rolesResp.ok) throw new Error("Failed to load roles");
        setUsers(usersData?.users ?? []);
        setRoles(rolesData?.roles ?? []);
      } catch (e: unknown) {
        setError((e as Error)?.message ?? "Failed to load");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [open, apiBase]);

  if (user?.role !== "superadmin") return null;

  const handleSelectUser = (u: ImpersonationUser) => {
    setImpersonation({
      type: "user",
      id: u.username,
      label: u.email || u.username
    });
    setOpen(false);
    refreshAuth();
  };

  const handleSelectRole = (r: ImpersonationRole) => {
    setImpersonation({
      type: "role",
      id: r.name,
      label: r.name
    });
    setOpen(false);
    refreshAuth();
  };

  const handleStop = () => {
    clearImpersonation();
    setOpen(false);
    refreshAuth();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20"
        title="Impersonate user or role"
      >
        <UserCircleIcon className="h-4 w-4" />
        {impersonation ? "Change" : "Impersonate"}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} className="relative z-50">
        <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="mx-auto max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-xl">
            <Dialog.Title className="text-lg font-semibold text-slate-100">User impersonation</Dialog.Title>
            <p className="mt-1 text-sm text-slate-400">View the site as another user or a defined role.</p>
            {error && (
              <div className="mt-2 rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
            )}
            {loading ? (
              <p className="mt-4 text-sm text-slate-500">Loading…</p>
            ) : (
              <div className="mt-4 space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-slate-300">Users</h3>
                  <p className="text-xs text-slate-500">Superadmins cannot be impersonated.</p>
                  <ul className="mt-2 max-h-40 overflow-y-auto space-y-1">
                    {users.map((u) => (
                      <li key={u.username}>
                        <button
                          type="button"
                          onClick={() => handleSelectUser(u)}
                          className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                        >
                          {u.email || u.username}
                        </button>
                      </li>
                    ))}
                    {users.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No users</li>}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-slate-300">Roles</h3>
                  <ul className="mt-2 max-h-40 overflow-y-auto space-y-1">
                    {roles.map((r) => (
                      <li key={r.name}>
                        <button
                          type="button"
                          onClick={() => handleSelectRole(r)}
                          className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                        >
                          {r.name}
                        </button>
                      </li>
                    ))}
                    {roles.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No roles defined</li>}
                  </ul>
                </div>
                {impersonation && (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="rounded-md border border-slate-600 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
                  >
                    Stop impersonating
                  </button>
                )}
              </div>
            )}
          </Dialog.Panel>
        </div>
      </Dialog>
    </>
  );
};

export default ImpersonationSelector;
