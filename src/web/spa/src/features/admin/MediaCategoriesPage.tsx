import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

interface MediaCategory {
  id: string;
  name: string;
  description?: string;
}

const MediaCategoriesPage: React.FC = () => {
  const { user } = useAuth();
  const [categories, setCategories] = useState<MediaCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
      const resp = await fetch(`${apiBase}/media-categories`, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error(await resp.text());
      const data = (await resp.json()) as { categories?: { PK?: string; id?: string; name?: string; description?: string }[] };
      const list = (data.categories ?? []).map((c) => ({
        id: c.PK || c.id || "",
        name: c.name || c.PK || "",
        description: c.description
      }));
      setCategories(list);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load media categories.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canAccess) load();
  }, [canAccess]);

  const startEdit = (c: MediaCategory) => {
    setEditingId(c.id);
    setEditName(c.name);
    setEditDescription(c.description ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditDescription("");
    setUpdateError(null);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    setIsUpdating(true);
    setUpdateError(null);
    try {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      const resp = await fetch(`${apiBase}/media-categories`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: editingId,
          name: editName.trim(),
          description: editDescription.trim() || undefined
        })
      });
      if (!resp.ok) throw new Error(await resp.text());
      setCategories((prev) =>
        prev.map((cat) =>
          cat.id === editingId ? { ...cat, name: editName.trim(), description: editDescription.trim() || undefined } : cat
        )
      );
      cancelEdit();
    } catch (e: any) {
      setUpdateError(e?.message ?? "Failed to update media category.");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this media category? Media using it will lose this category.")) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    setDeletingId(id);
    try {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      const resp = await fetch(`${apiBase}/media-categories?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) throw new Error(await resp.text());
      setCategories((prev) => prev.filter((cat) => cat.id !== id));
      if (editingId === id) cancelEdit();
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete media category.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth?.getAccessToken) return;
    setIsSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
      const resp = await fetch(`${apiBase}/media-categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, description: newDescription.trim() })
      });
      if (!resp.ok) throw new Error(await resp.text());
      setNewName("");
      setNewDescription("");
      setMessage("Media category created.");
      load();
    } catch (e: any) {
      setError(e?.message ?? "Failed to create media category.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Media Categories</h1>
        <p className="text-sm text-slate-400">Manager or SuperAdmin access is required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/media"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Media
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Media Categories</h1>
        <p className="text-sm text-slate-400">Manage categories used when adding or editing media.</p>
      </header>

      <form className="space-y-3 max-w-md" onSubmit={handleCreate}>
        <div>
          <label className="block text-sm font-medium text-slate-200 mb-1">New category name</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Tutorials"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-200 mb-1">Description (optional)</label>
          <input
            type="text"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Optional description"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting || !newName.trim()}
          className="inline-flex items-center justify-center rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-500 disabled:opacity-50"
        >
          {isSubmitting ? "Creating…" : "Create media category"}
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
        <h2 className="text-sm font-medium text-slate-300 mb-2">Existing media categories</h2>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : categories.length === 0 ? (
          <p className="text-sm text-slate-500">No media categories yet. Create one above.</p>
        ) : (
          <ul className="space-y-2">
            {categories.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm"
              >
                {editingId === c.id ? (
                  <form onSubmit={handleUpdate} className="space-y-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Name"
                      required
                      className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
                      autoFocus
                    />
                    <input
                      type="text"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder="Description (optional)"
                      className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
                    />
                    <div className="flex gap-2 flex-wrap">
                      <button
                        type="submit"
                        disabled={isUpdating || !editName.trim()}
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
                        onClick={() => handleDelete(c.id)}
                        disabled={deletingId === c.id}
                        className="rounded-md border border-red-500/60 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {deletingId === c.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                    {updateError && (
                      <p className="text-xs text-red-400">{updateError}</p>
                    )}
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(c)}
                      className="flex-1 min-w-0 text-left hover:bg-slate-800/50 rounded px-1 -mx-1 py-1 -my-1 transition-colors"
                    >
                      <span className="font-medium text-slate-200">{c.name}</span>
                      {c.description && <span className="text-slate-500 truncate max-w-xs ml-2">{c.description}</span>}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id)}
                      disabled={deletingId === c.id}
                      className="rounded px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50 shrink-0"
                      aria-label="Delete category"
                    >
                      {deletingId === c.id ? "…" : "Delete"}
                    </button>
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

export default MediaCategoriesPage;
