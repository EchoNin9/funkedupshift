import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Dialog } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { StarIcon } from "@heroicons/react/24/solid";
import { useAuth, hasRole } from "../../shell/AuthContext";
import { fetchWithAuthOptional } from "../../utils/api";
import { Alert } from "../../components";

interface HighestRatedItem {
  type: "site" | "media";
  url?: string;
  id?: string;
  link: string;
  domain: string;
  title?: string;
  status: string;
  description?: string;
  logoUrl?: string;
  averageRating?: number;
}

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  if (!raw || raw === "API_URL_PLACEHOLDER" || !raw.startsWith("http")) return null;
  return raw.replace(/\/$/, "");
}

const HighestRatedPage: React.FC = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<HighestRatedItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<HighestRatedItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const apiBase = getApiBaseUrl();

    if (!apiBase) {
      setError(
        "API URL not set. For local dev, edit public/config.js and set window.API_BASE_URL to your staging API (e.g. terraform -chdir=infra output -raw apiInvokeUrl)."
      );
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const resp = await fetchWithAuthOptional(`${apiBase}/recommended/highest-rated`);
      const txt = await resp.text();
      if (!resp.ok) {
        throw new Error(txt || `HTTP ${resp.status}`);
      }
      if (txt.trim().startsWith("<")) {
        throw new Error(
          "API returned HTML instead of JSON. For local dev, set window.API_BASE_URL in public/config.js to your staging API URL (e.g. terraform -chdir=infra output -raw apiInvokeUrl)"
        );
      }
      let data: { sites?: HighestRatedItem[] };
      try {
        data = JSON.parse(txt) as { sites?: HighestRatedItem[] };
      } catch {
        throw new Error("API returned invalid JSON.");
      }
      const list = Array.isArray(data.sites) ? data.sites : [];
      setItems(list);
      setError(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load.";
      setError(msg);
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const canEdit = hasRole(user ?? null, "manager");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-warning">
        Highest rated
      </h1>
      <div className="rounded-xl border border-warning/60 bg-gradient-to-br from-amber-900/40 to-amber-950/60 p-4 shadow-lg">
        <p className="text-sm font-medium text-warning">
          Top sites and media rated by our community
        </p>
        <p className="mt-1 text-xs text-warning/80">
          Click a card below for more detail
        </p>
        {canEdit && (
          <p className="mt-2">
            <Link
              to="/admin/recommended?tab=highest-rated"
              className="text-warning hover:text-warning font-semibold text-sm"
            >
              Edit list
            </Link>
          </p>
        )}
      </div>

      {isLoading && (
        <p className="text-sm text-text-secondary">Loading…</p>
      )}

      {error && !items.length && (
        <Alert variant="error">{error}</Alert>
      )}

      {!isLoading && items.length === 0 && !error && (
        <p className="text-sm text-text-secondary">
          No items configured yet.{" "}
          {canEdit && (
            <Link
              to="/admin/recommended?tab=highest-rated"
              className="text-warning hover:text-warning"
            >
              Generate cache
            </Link>
          )}
        </p>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {items.map((item) => {
            const status = (item.status || "up").toLowerCase();
            const statusClass =
              status === "up"
                ? "border-warning/50 bg-warning/20 text-warning"
                : status === "degraded"
                ? "border-warning/50 bg-warning/15 text-warning"
                : "border-warning/50 bg-warning/15 text-warning";
            const hasDescription = (item.description || "").trim().length > 0;
            const displayTitle = item.title || item.domain;
            const isMedia = item.type === "media";
            const key = item.id || item.url || item.domain;
            return (
              <div
                key={key}
                className={`rounded-lg border p-4 text-left text-sm min-w-0 cursor-pointer transition-all duration-200 hover:scale-[1.01] hover:shadow-lg ${statusClass}`}
                onClick={() => setSelectedItem(item)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedItem(item);
                  }
                }}
              >
                <span className="relative group block">
                  {isMedia ? (
                    <Link
                      to={item.link}
                      className="font-semibold block hover:underline break-all"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {displayTitle}
                    </Link>
                  ) : (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold block hover:underline break-all"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {displayTitle}
                    </a>
                  )}
                  <span
                    className="absolute left-0 top-full mt-1 px-2 py-1.5 rounded bg-surface-2 border border-warning/60 text-xs text-warning break-all max-w-[280px] shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity z-10 pointer-events-none"
                    role="tooltip"
                  >
                    {isMedia ? item.link : item.link}
                  </span>
                </span>
                {item.averageRating != null && (
                  <div className="mt-1 flex items-center gap-0.5 text-warning">
                    <StarIcon className="h-3.5 w-3.5" />
                    <span className="font-medium">{item.averageRating}</span>
                  </div>
                )}
                {hasDescription && (
                  <div className="mt-2 text-xs text-warning/90 leading-relaxed break-words">
                    {item.description}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!selectedItem} onClose={() => setSelectedItem(null)} className="relative z-50">
        <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="mx-auto w-full max-w-xl rounded-xl border border-warning/60 bg-gradient-to-br from-amber-900/40 to-amber-950/60 p-6 shadow-xl">
            {selectedItem && (
              <div className="relative flex min-h-[12rem] items-center justify-center">
                <button
                  type="button"
                  onClick={() => setSelectedItem(null)}
                  className="absolute right-0 top-0 rounded p-1 text-warning hover:bg-warning/40 hover:text-warning"
                  aria-label="Close modal"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
                {selectedItem.logoUrl ? (
                  <img
                    src={selectedItem.logoUrl}
                    alt={selectedItem.title || selectedItem.domain}
                    className="max-h-48 max-w-full object-contain"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                    }}
                  />
                ) : (
                  <div className="h-24 w-24 rounded-lg border border-warning/60 bg-warning/40" />
                )}
              </div>
            )}
          </Dialog.Panel>
        </div>
      </Dialog>
    </div>
  );
};

export default HighestRatedPage;
