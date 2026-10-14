import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Dialog } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";
import { fetchWithAuthOptional } from "../../utils/api";
import { Alert } from "../../components";

interface OurPropertiesSite {
  url: string;
  domain: string;
  title?: string;
  status: string;
  responseTimeMs?: number;
  description?: string;
  logoUrl?: string;
}

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  if (!raw || raw === "API_URL_PLACEHOLDER" || !raw.startsWith("http")) return null;
  return raw.replace(/\/$/, "");
}

const OurPropertiesPage: React.FC = () => {
  const { user } = useAuth();
  const [sites, setSites] = useState<OurPropertiesSite[]>([]);
  const [selectedSite, setSelectedSite] = useState<OurPropertiesSite | null>(null);
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
      const resp = await fetchWithAuthOptional(`${apiBase}/recommended/highlights`);
      const txt = await resp.text();
      if (!resp.ok) {
        throw new Error(txt || `HTTP ${resp.status}`);
      }
      if (txt.trim().startsWith("<")) {
        throw new Error(
          "API returned HTML instead of JSON. For local dev, set window.API_BASE_URL in public/config.js to your staging API URL (e.g. terraform -chdir=infra output -raw apiInvokeUrl)"
        );
      }
      let data: { sites?: OurPropertiesSite[] };
      try {
        data = JSON.parse(txt) as { sites?: OurPropertiesSite[] };
      } catch {
        throw new Error("API returned invalid JSON.");
      }
      const list = Array.isArray(data.sites) ? data.sites : [];
      setSites(list);
      setError(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load.";
      setError(msg);
      setSites([]);
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
      <h1 className="text-2xl font-semibold tracking-tight text-hue-teal">
        Highlights and faves
      </h1>
      <div className="rounded-xl border border-hue-teal/40 bg-gradient-to-br from-hue-teal/10 to-surface-1/90 p-4 shadow-lg">
        <p className="text-sm font-medium text-text-primary">
          Our curated list of exceptional sites
        </p>
        <p className="mt-1 text-xs text-text-secondary">
          Click a card below for more detail
        </p>
        {canEdit && (
          <p className="mt-2">
            <Link
              to="/admin/recommended?tab=highlights"
              className="text-hue-teal hover:underline font-semibold text-sm"
            >
              Edit sites list
            </Link>
          </p>
        )}
      </div>

      {isLoading && (
        <p className="text-sm text-text-secondary">Loading…</p>
      )}

      {error && !sites.length && (
        <Alert variant="error">{error}</Alert>
      )}

      {!isLoading && sites.length === 0 && !error && (
        <p className="text-sm text-text-secondary">
          No sites configured yet.{" "}
          {canEdit && (
            <Link
              to="/admin/recommended?tab=highlights"
              className="text-hue-teal hover:underline"
            >
              Add sites
            </Link>
          )}
        </p>
      )}

      {sites.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {sites.map((s) => {
            const status = (s.status || "up").toLowerCase();
            const statusClass =
              status === "up"
                ? "border-hue-teal/60 bg-hue-teal/25 text-hue-teal"
                : status === "degraded"
                ? "border-hue-teal/45 bg-hue-teal/15 text-hue-teal"
                : "border-hue-teal/30 bg-hue-teal/10 text-hue-teal";
            const hasDescription = (s.description || "").trim().length > 0;
            const displayTitle = s.title || s.domain;
            const fullUrl = s.url || `https://${s.domain}`;
            return (
              <div
                key={s.url || s.domain}
                className={`rounded-lg border p-4 text-left text-sm min-w-0 cursor-pointer transition-all duration-200 hover:scale-[1.01] hover:shadow-lg ${statusClass}`}
                onClick={() => setSelectedSite(s)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedSite(s);
                  }
                }}
              >
                <span className="relative group block">
                  <a
                    href={fullUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold block hover:underline break-all"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {displayTitle}
                  </a>
                  <span
                    className="absolute left-0 top-full mt-1 px-2 py-1.5 rounded bg-surface-2 border border-hue-teal/40 text-xs text-hue-teal break-all max-w-[280px] shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity z-10 pointer-events-none"
                    role="tooltip"
                  >
                    {fullUrl}
                  </span>
                </span>
                {hasDescription && (
                  <div className="mt-2 text-xs text-text-secondary leading-relaxed break-words">
                    {s.description}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!selectedSite} onClose={() => setSelectedSite(null)} className="relative z-50">
        <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="mx-auto w-full max-w-xl rounded-xl border border-hue-teal/40 bg-gradient-to-br from-hue-teal/10 to-surface-1/90 p-6 shadow-xl">
            {selectedSite && (
              <div className="relative flex min-h-[12rem] items-center justify-center">
                <button
                  type="button"
                  onClick={() => setSelectedSite(null)}
                  className="absolute right-0 top-0 rounded p-1 text-hue-teal hover:bg-hue-teal/15 hover:text-text-primary"
                  aria-label="Close modal"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
                {selectedSite.logoUrl ? (
                  <img
                    src={selectedSite.logoUrl}
                    alt={selectedSite.title || selectedSite.domain}
                    className="max-h-48 max-w-full object-contain"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                    }}
                  />
                ) : (
                  <div className="h-24 w-24 rounded-lg border border-hue-teal/40 bg-hue-teal/10" />
                )}
              </div>
            )}
          </Dialog.Panel>
        </div>
      </Dialog>
    </div>
  );
};

export default OurPropertiesPage;
