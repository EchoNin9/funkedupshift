import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Dialog } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { StarIcon } from "@heroicons/react/24/solid";
import { useAuth, hasRole } from "../../shell/AuthContext";

interface HighestRatedSite {
  url: string;
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
  const [sites, setSites] = useState<HighestRatedSite[]>([]);
  const [selectedSite, setSelectedSite] = useState<HighestRatedSite | null>(null);
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
      const resp = await fetch(`${apiBase}/recommended/highest-rated`);
      const txt = await resp.text();
      if (!resp.ok) {
        throw new Error(txt || `HTTP ${resp.status}`);
      }
      if (txt.trim().startsWith("<")) {
        throw new Error(
          "API returned HTML instead of JSON. For local dev, set window.API_BASE_URL in public/config.js to your staging API URL (e.g. terraform -chdir=infra output -raw apiInvokeUrl)"
        );
      }
      let data: { sites?: HighestRatedSite[] };
      try {
        data = JSON.parse(txt) as { sites?: HighestRatedSite[] };
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
      <h1 className="text-2xl font-semibold tracking-tight text-amber-200">
        Highest rated
      </h1>
      <div className="rounded-xl border border-amber-800/60 bg-gradient-to-br from-amber-900/40 to-amber-950/60 p-4 shadow-lg">
        <p className="text-sm font-medium text-amber-100">
          Top 14 sites by community star ratings
        </p>
        <p className="mt-1 text-xs text-amber-200/80">
          Click a card below for more detail
        </p>
        {canEdit && (
          <p className="mt-2">
            <Link
              to="/admin/recommended/highest-rated"
              className="text-amber-300 hover:text-amber-200 font-semibold text-sm"
            >
              Edit list
            </Link>
          </p>
        )}
      </div>

      {isLoading && (
        <p className="text-sm text-slate-400">Loading…</p>
      )}

      {error && !sites.length && (
        <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      {!isLoading && sites.length === 0 && !error && (
        <p className="text-sm text-slate-400">
          No sites configured yet.{" "}
          {canEdit && (
            <Link
              to="/admin/recommended/highest-rated"
              className="text-amber-400 hover:text-amber-300"
            >
              Generate cache
            </Link>
          )}
        </p>
      )}

      {sites.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {sites.map((s) => {
            const status = (s.status || "up").toLowerCase();
            const statusClass =
              status === "up"
                ? "border-amber-400/50 bg-amber-400/20 text-amber-200"
                : status === "degraded"
                ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
                : "border-amber-600/50 bg-amber-600/15 text-amber-200";
            const hasDescription = (s.description || "").trim().length > 0;
            const displayTitle = s.title || s.domain;
            const fullUrl = s.url || `https://${s.domain}`;
            return (
              <div
                key={s.url || s.domain}
                className={`rounded-lg border p-3 text-center text-sm min-w-0 cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${statusClass}`}
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
                    className="font-semibold block hover:underline truncate w-full"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {displayTitle}
                  </a>
                  <span
                    className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 px-2 py-1.5 rounded bg-slate-900 border border-amber-700/60 text-xs text-amber-200 break-all max-w-[240px] shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity z-10 pointer-events-none"
                    role="tooltip"
                  >
                    {fullUrl}
                  </span>
                </span>
                {s.averageRating != null && (
                  <div className="mt-1 flex items-center justify-center gap-0.5 text-amber-300">
                    <StarIcon className="h-3.5 w-3.5" />
                    <span className="font-medium">{s.averageRating}</span>
                  </div>
                )}
                {hasDescription && (
                  <div
                    className="mt-0.5 text-[11px] truncate w-full opacity-90"
                    title={s.description}
                  >
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
          <Dialog.Panel className="mx-auto w-full max-w-xl rounded-xl border border-amber-800/60 bg-gradient-to-br from-amber-900/40 to-amber-950/60 p-6 shadow-xl">
            {selectedSite && (
              <>
                <div className="flex items-start justify-between gap-4">
                  <header className="flex flex-wrap gap-4 min-w-0 flex-1">
                    <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg border border-amber-700/60 bg-amber-900/40">
                      {selectedSite.logoUrl ? (
                        <img
                          src={selectedSite.logoUrl}
                          alt=""
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <Dialog.Title className="text-2xl font-semibold tracking-tight text-amber-100">
                        {selectedSite.title || selectedSite.domain}
                      </Dialog.Title>
                      <a
                        href={selectedSite.url || `https://${selectedSite.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-base text-amber-300 hover:text-amber-200 hover:underline"
                      >
                        {selectedSite.url || `https://${selectedSite.domain}`}
                      </a>
                      {selectedSite.averageRating != null && (
                        <div className="flex items-center gap-1 text-amber-300">
                          <StarIcon className="h-4 w-4" />
                          <span className="font-semibold">{selectedSite.averageRating}</span>
                          <span className="text-xs text-amber-200/80">/ 5</span>
                        </div>
                      )}
                    </div>
                  </header>
                  <button
                    type="button"
                    onClick={() => setSelectedSite(null)}
                    className="rounded p-1 text-amber-400 hover:bg-amber-800/40 hover:text-amber-200 flex-shrink-0"
                    aria-label="Close modal"
                  >
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>
                {(selectedSite.description || "").trim().length > 0 && (
                  <div className="mt-4">
                    <p className="text-base text-amber-200">{selectedSite.description}</p>
                  </div>
                )}
              </>
            )}
          </Dialog.Panel>
        </div>
      </Dialog>
    </div>
  );
};

export default HighestRatedPage;
