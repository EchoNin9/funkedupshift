import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

interface Category {
  id: string;
  name: string;
  description?: string;
}

const CategoriesPage: React.FC = () => {
  const { user } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
      const resp = await fetch(`${apiBase}/categories`, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error(await resp.text());
      const data = (await resp.json()) as { categories?: { PK?: string; id?: string; name?: string; description?: string }[] };
      const list = (data.categories ?? []).map((c) => ({
        id: c.PK || c.id || "",
        name: c.name || c.PK || "",
        description: c.description
      }));
      setCategories(list);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load categories.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canAccess) load();
  }, [canAccess]);

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
      const resp = await fetch(`${apiBase}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, description: newDescription.trim() })
      });
      if (!resp.ok) throw new Error(await resp.text());
      setNewName("");
      setNewDescription("");
      setMessage("Category created.");
      load();
    } catch (e: any) {
      setError(e?.message ?? "Failed to create category.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Categories</h1>
        <p className="text-sm text-slate-400">Manager or SuperAdmin access is required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/websites"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Websites
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Site Categories</h1>
        <p className="text-sm text-slate-400">Manage categories used when adding or editing sites.</p>
      </header>

      <form className="space-y-3 max-w-md" onSubmit={handleCreate}>
        <div>
          <label className="block text-sm font-medium text-slate-200 mb-1">New category name</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Developer tools"
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
          {isSubmitting ? "Creating…" : "Create category"}
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
        <h2 className="text-sm font-medium text-slate-300 mb-2">Existing categories</h2>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : categories.length === 0 ? (
          <p className="text-sm text-slate-500">No categories yet. Create one above.</p>
        ) : (
          <ul className="space-y-2">
            {categories.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200"
              >
                <span className="font-medium">{c.name}</span>
                {c.description && <span className="text-slate-500 truncate max-w-xs ml-2">{c.description}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default CategoriesPage;
