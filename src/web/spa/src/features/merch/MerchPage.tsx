import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ShoppingBagIcon } from "@heroicons/react/24/outline";
import { fetchWithAuthOptional } from "../../utils/api";
import { Alert } from "../../components";

export interface MerchProduct {
  id: string;
  title: string;
  description: string;
  imageUrls: string[];
  priceCents: number;
  currency: string;
  active: boolean;
  gelatoProductUid: string;
}

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as unknown as { API_BASE_URL?: string }).API_BASE_URL;
  return raw ? raw.replace(/\/$/, "") : null;
}

function formatPrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

const MerchPage: React.FC = () => {
  const [products, setProducts] = useState<MerchProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

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
      const r = await fetch(`${base}/merch/products`);
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as { products?: MerchProduct[] };
      setProducts(Array.isArray(data.products) ? data.products : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load products.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setQty = (id: string, q: number) => {
    setQuantities((prev) => {
      const next = { ...prev };
      if (q <= 0) delete next[id];
      else next[id] = Math.min(99, q);
      return next;
    });
  };

  const cartLines = useMemo(() => {
    return Object.entries(quantities)
      .filter(([, q]) => q > 0)
      .map(([productId, quantity]) => ({ productId, quantity }));
  }, [quantities]);

  const cartTotalCents = useMemo(() => {
    let t = 0;
    for (const { productId, quantity } of cartLines) {
      const p = products.find((x) => x.id === productId);
      if (p) t += p.priceCents * quantity;
    }
    return t;
  }, [cartLines, products]);

  const checkout = async () => {
    const base = getApiBaseUrl();
    if (!base || cartLines.length === 0) return;
    setCheckoutLoading(true);
    setCheckoutError(null);
    try {
      const r = await fetchWithAuthOptional(`${base}/merch/checkout/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cart: cartLines }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error((data as { error?: string }).error || `Checkout failed (${r.status})`);
      }
      const url = (data as { url?: string }).url;
      if (url) window.location.href = url;
      else throw new Error("No checkout URL returned.");
    } catch (e: unknown) {
      setCheckoutError(e instanceof Error ? e.message : "Checkout failed.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-text-primary tracking-tight flex items-center gap-2">
            <ShoppingBagIcon className="h-8 w-8 text-accent-500" aria-hidden />
            Merch store
          </h1>
          <p className="mt-1 text-sm text-text-secondary max-w-xl">
            Browse items and checkout securely with Stripe. Sign in is optional — guests can purchase too.
          </p>
        </div>
        <Link
          to="/merch/support"
          className="text-sm text-accent-400 hover:text-accent-300 transition-colors self-start sm:self-auto"
        >
          Help, feedback &amp; returns
        </Link>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {checkoutError && <Alert variant="error">{checkoutError}</Alert>}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : products.length === 0 ? (
        <p className="text-text-secondary text-sm">No products available yet. Check back soon.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <article
              key={p.id}
              className="rounded-xl border border-border-default bg-surface-1 overflow-hidden flex flex-col"
            >
              <div className="aspect-[4/3] bg-surface-2 flex items-center justify-center">
                {p.imageUrls?.[0] ? (
                  <img src={p.imageUrls[0]} alt="" className="w-full h-full object-cover" />
                ) : (
                  <ShoppingBagIcon className="w-16 h-16 text-text-tertiary" aria-hidden />
                )}
              </div>
              <div className="p-4 flex flex-col flex-1 gap-2">
                <h2 className="font-semibold text-text-primary">{p.title}</h2>
                {p.description ? (
                  <p className="text-sm text-text-secondary line-clamp-3">{p.description}</p>
                ) : null}
                <p className="text-lg font-medium text-accent-400">
                  {formatPrice(p.priceCents, p.currency)}
                </p>
                <div className="mt-auto flex items-center gap-2 pt-2">
                  <label className="sr-only" htmlFor={`qty-${p.id}`}>
                    Quantity for {p.title}
                  </label>
                  <input
                    id={`qty-${p.id}`}
                    type="number"
                    min={0}
                    max={99}
                    value={quantities[p.id] ?? 0}
                    onChange={(e) => setQty(p.id, parseInt(e.target.value, 10) || 0)}
                    className="w-20 rounded-md border border-border-default bg-surface-0 px-2 py-1.5 text-sm text-text-primary"
                  />
                  <span className="text-xs text-text-tertiary">Qty</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {cartLines.length > 0 && (
        <div className="sticky bottom-4 rounded-xl border border-border-default bg-surface-1 p-4 shadow-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-text-primary">
              {cartLines.length} line{cartLines.length === 1 ? "" : "s"} ·{" "}
              {formatPrice(cartTotalCents, products[0]?.currency || "usd")}
            </p>
            <p className="text-xs text-text-tertiary mt-0.5">Taxes and shipping calculated at checkout.</p>
          </div>
          <button
            type="button"
            onClick={() => checkout()}
            disabled={checkoutLoading}
            className="btn-primary px-6 py-2.5 disabled:opacity-50"
          >
            {checkoutLoading ? "Redirecting…" : "Checkout with Stripe"}
          </button>
        </div>
      )}
    </div>
  );
};

export default MerchPage;
