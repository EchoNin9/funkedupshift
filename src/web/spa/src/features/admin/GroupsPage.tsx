import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

interface Group {
  name: string;
  description?: string;
  permissions?: string[];
}

const GroupsPage: React.FC = () => {
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  const canAccess = hasRole(user ?? null, "manager");

  const load = async () => {
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
      const resp = await fetch(`${apiBase}/admin/groups`, { headers: { Authorization: `Bearer ${token}` } });
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
      setError(e?.message ?? "Failed to load groups");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canAccess) load();
  }, [canAccess]);

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

  const handleCreate = async (e: React.FormEvent) => {
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
    setError(null);
    try {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      const resp = await fetch(`${apiBase}/admin/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
      load();
    } catch (e: any) {
      setError(e?.message ?? "Failed to create group");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
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
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      const resp = await fetch(`${apiBase}/admin/groups/${encodeURIComponent(editingName)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ description: editDescription, permissions })
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to update group");
      }
      setGroups((prev) =>
        prev.map((g) =>
          g.name === editingName
            ? { ...g, description: editDescription, permissions }
            : g
        )
      );
      cancelEdit();
    } catch (e: any) {
      setUpdateError(e?.message ?? "Failed to update group");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!window.confirm(`Delete group "${name}"? Members will lose access.`)) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    setDeletingName(name);
    try {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      const resp = await fetch(`${apiBase}/admin/groups/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to delete group");
      }
      setGroups((prev) => prev.filter((g) => g.name !== name));
      if (editingName === name) cancelEdit();
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete group");
    } finally {
      setDeletingName(null);
    }
  };

  if (!canAccess) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">RBAC Groups</h1>
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
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50">RBAC Groups</h1>
          <Link
            to="/admin/users"
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            User Management
          </Link>
        </div>
        <p className="text-sm text-slate-400">Create and manage custom groups. Assign groups to users from the user edit page.</p>
      </header>

      <form className="space-y-3 max-w-md" onSubmit={handleCreate}>
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
          <div className="rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {message}
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
      </form>

      <section>
        <h2 className="text-sm font-medium text-slate-300 mb-2">Custom groups</h2>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-slate-500">No custom groups yet. Create one above.</p>
        ) : (
          <ul className="space-y-2">
            {groups.map((g) => (
              <li
                key={g.name}
                className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm"
              >
                {editingName === g.name ? (
                  <form onSubmit={handleUpdate} className="space-y-2">
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
                        onClick={() => handleDelete(g.name)}
                        disabled={deletingName === g.name}
                        className="rounded-md border border-red-500/60 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {deletingName === g.name ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                    {updateError && (
                      <p className="text-xs text-red-400">{updateError}</p>
                    )}
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-slate-200">{g.name}</span>
                      {g.description && (
                        <span className="text-slate-500 ml-2">{g.description}</span>
                      )}
                      {g.permissions && g.permissions.length > 0 && (
                        <div className="text-xs text-slate-500 mt-1">
                          Permissions: {g.permissions.join(", ")}
                        </div>
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
                        onClick={() => handleDelete(g.name)}
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
    </div>
  );
};

export default GroupsPage;
