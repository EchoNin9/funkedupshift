import React, { useCallback, useEffect, useState } from "react";
import { useAuth, hasRole } from "../../shell/AuthContext";
import { AdminPageHeader } from "./AdminPageHeader";
import { fetchWithAuth } from "../../utils/api";
import { Alert } from "../../components";
import type { MerchProduct } from "../merch/MerchPage";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as unknown as { API_BASE_URL?: string }).API_BASE_URL;
  return raw ? raw.replace(/\/$/, "") : null;
}

const emptyForm = {
  id: "",
  title: "",
  description: "",
  priceCents: "",
  currency: "usd",
  gelatoProductUid: "",
  imageUrls: "",
  active: true,
};

const MerchAdminPage: React.FC = () => {
  const { user } = useAuth();
  const isSuper = hasRole(user ?? null, "superadmin");
  const [products, setProducts] = useState<MerchProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const base = getApiBaseUrl();
    if (!base) {
      setError("API URL not set.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetchWithAuth(`${base}/admin/merch/products`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as { error?: string }).error || "Failed to load");
      setProducts(Array.isArray((data as { products?: MerchProduct[] }).products) ? (data as { products: MerchProduct[] }).products : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSuper) load();
  }, [isSuper, load]);

  const editProduct = (p: MerchProduct) => {
    setForm({
      id: p.id,
      title: p.title,
      description: p.description || "",
      priceCents: String(p.priceCents),
      currency: p.currency || "usd",
      gelatoProductUid: p.gelatoProductUid || "",
      imageUrls: (p.imageUrls || []).join("\n"),
      active: p.active,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const base = getApiBaseUrl();
    if (!base) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    const price = parseInt(form.priceCents, 10);
    if (Number.isNaN(price) || price < 0) {
      setError("Enter a valid price in cents.");
      setSaving(false);
      return;
    }
    const imageUrls = form.imageUrls
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const body: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description.trim(),
      priceCents: price,
      currency: form.currency.trim() || "usd",
      gelatoProductUid: form.gelatoProductUid.trim(),
      imageUrls,
      active: form.active,
    };
    const isNew = !form.id;
    if (!isNew) body.id = form.id;
    try {
      const r = await fetchWithAuth(`${base}/admin/merch/products`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as { error?: string }).error || "Save failed");
      setMessage(isNew ? "Product created." : "Product updated.");
      setForm(emptyForm);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this product?")) return;
    const base = getApiBaseUrl();
    if (!base) return;
    setError(null);
    try {
      const r = await fetchWithAuth(`${base}/admin/merch/products`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as { error?: string }).error || "Delete failed");
      setMessage("Product deleted.");
      if (form.id === id) setForm(emptyForm);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    }
  };

  if (!isSuper) {
    return (
      <div className="space-y-4">
        <AdminPageHeader title="Merch admin" description="Superadmin only." />
        <p className="text-sm text-text-secondary">You do not have access to manage merch products.</p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <AdminPageHeader
        title="Merch products"
        description="Create catalog items, set Gelato product UIDs and at least one public HTTPS image URL used as the print file."
      />
      {error && <Alert variant="error">{error}</Alert>}
      {message && <Alert variant="success">{message}</Alert>}

      <form onSubmit={submit} className="rounded-xl border border-border-default bg-surface-1 p-6 space-y-4 max-w-xl">
        <h2 className="font-semibold text-text-primary">{form.id ? "Edit product" : "New product"}</h2>
        {form.id ? (
          <p className="text-xs text-text-tertiary">
            Editing <span className="font-mono">{form.id}</span>
          </p>
        ) : null}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Title</label>
          <input
            required
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="w-full rounded-md border border-border-default bg-surface-0 px-3 py-2 text-sm text-text-primary"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={3}
            className="w-full rounded-md border border-border-default bg-surface-0 px-3 py-2 text-sm text-text-primary"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Price (cents)</label>
            <input
              required
              type="number"
              min={0}
              value={form.priceCents}
              onChange={(e) => setForm((f) => ({ ...f, priceCents: e.target.value }))}
              className="w-full rounded-md border border-border-default bg-surface-0 px-3 py-2 text-sm text-text-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Currency</label>
            <input
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              className="w-full rounded-md border border-border-default bg-surface-0 px-3 py-2 text-sm text-text-primary"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Gelato product UID</label>
          <input
            value={form.gelatoProductUid}
            onChange={(e) => setForm((f) => ({ ...f, gelatoProductUid: e.target.value }))}
            placeholder="e.g. apparel_product_gca_t-shirt_…"
            className="w-full rounded-md border border-border-default bg-surface-0 px-3 py-2 text-sm text-text-primary"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Image URLs (one per line)</label>
          <textarea
            value={form.imageUrls}
            onChange={(e) => setForm((f) => ({ ...f, imageUrls: e.target.value }))}
            rows={3}
            className="w-full rounded-md border border-border-default bg-surface-0 px-3 py-2 text-sm text-text-primary font-mono text-xs"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
          />
          Active (visible in public store)
        </label>
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="btn-primary px-4 py-2 disabled:opacity-50">
            {saving ? "Saving…" : form.id ? "Update" : "Create"}
          </button>
          {form.id ? (
            <button
              type="button"
              onClick={() => setForm(emptyForm)}
              className="px-4 py-2 text-sm border border-border-default rounded-md text-text-secondary hover:bg-surface-2"
            >
              Cancel edit
            </button>
          ) : null}
        </div>
      </form>

      <div>
        <h2 className="font-semibold text-text-primary mb-3">All products</h2>
        {loading ? (
          <p className="text-sm text-text-tertiary">Loading…</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-text-secondary">No products yet.</p>
        ) : (
          <ul className="space-y-2">
            {products.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-default bg-surface-1 px-4 py-3"
              >
                <div>
                  <span className="font-medium text-text-primary">{p.title}</span>
                  <span className="text-text-tertiary text-sm ml-2">
                    {(p.priceCents / 100).toFixed(2)} {p.currency}
                  </span>
                  {!p.active && (
                    <span className="ml-2 text-xs text-amber-500 uppercase">inactive</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => editProduct(p)} className="text-sm text-accent-400">
                    Edit
                  </button>
                  <button type="button" onClick={() => remove(p.id)} className="text-sm text-red-400">
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default MerchAdminPage;
