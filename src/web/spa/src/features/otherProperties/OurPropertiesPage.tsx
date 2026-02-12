import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Dialog } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";

interface OurPropertiesSite {
  url: string;
  domain: string;
  status: string;
  responseTimeMs?: number;
  description?: string;
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
      const resp = await fetch(`${apiBase}/other-properties/our-properties`);
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
      <h1 className="text-2xl font-semibold tracking-tight text-violet-200">
        Our Properties
      </h1>
      <div className="rounded-xl border border-violet-800/60 bg-gradient-to-br from-violet-900/40 to-violet-950/60 p-4 shadow-lg">
        <p className="text-sm font-medium text-violet-100">
          Live status of our sites
        </p>
        <p className="mt-1 text-xs text-violet-200/80">
          Shows availability and response time for our properties
        </p>
        {canEdit && (
          <p className="mt-2">
            <Link
              to="/admin/other-properties/our-properties"
              className="text-violet-300 hover:text-violet-200 font-semibold text-sm"
            >
              Edit sites list
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
              to="/admin/other-properties/our-properties"
              className="text-violet-400 hover:text-violet-300"
            >
              Add sites
            </Link>
          )}
        </p>
      )}

      {sites.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {sites.map((s) => {
            const status = (s.status || "down").toLowerCase();
            const statusClass =
              status === "up"
                ? "border-violet-400/50 bg-violet-400/20 text-violet-200"
                : status === "degraded"
                ? "border-violet-500/50 bg-violet-500/15 text-violet-200"
                : "border-violet-600/50 bg-violet-600/15 text-violet-200";
            const rtStr =
              s.responseTimeMs != null ? `${s.responseTimeMs} ms` : null;
            const hasDescription = (s.description || "").trim().length > 0;
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
                <a
                  href={s.url || `https://${s.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold break-all block hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {s.domain}
                </a>
                <div className="mt-1 text-xs capitalize opacity-90">{status}</div>
                {rtStr && (
                  <div className="mt-0.5 text-[11px] opacity-75">{rtStr}</div>
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
          <Dialog.Panel className="mx-auto max-w-md w-full rounded-xl border border-violet-800/60 bg-gradient-to-br from-violet-900/40 to-violet-950/60 p-4 shadow-xl">
            {selectedSite && (
              <>
                <div className="flex items-start justify-between gap-2">
                  <Dialog.Title className="text-lg font-semibold text-violet-100">
                    {selectedSite.domain}
                  </Dialog.Title>
                  <button
                    type="button"
                    onClick={() => setSelectedSite(null)}
                    className="rounded p-1 text-violet-400 hover:bg-violet-800/40 hover:text-violet-200"
                    aria-label="Close modal"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  <p>
                    <span className="text-violet-400/90">Status:</span>{" "}
                    <span className="capitalize font-medium text-violet-200">{selectedSite.status}</span>
                  </p>
                  {selectedSite.responseTimeMs != null && (
                    <p>
                      <span className="text-violet-400/90">Response time:</span>{" "}
                      <span className="text-violet-200">{selectedSite.responseTimeMs} ms</span>
                    </p>
                  )}
                  <p>
                    <span className="text-violet-400/90">URL:</span>{" "}
                    <a
                      href={selectedSite.url || `https://${selectedSite.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-violet-300 hover:text-violet-200 hover:underline break-all"
                    >
                      {selectedSite.url || `https://${selectedSite.domain}`}
                    </a>
                  </p>
                  {(selectedSite.description || "").trim().length > 0 && (
                    <p>
                      <span className="text-violet-400/90 block mb-0.5">Description:</span>
                      <span className="text-violet-200">{selectedSite.description}</span>
                    </p>
                  )}
                </div>
              </>
            )}
          </Dialog.Panel>
        </div>
      </Dialog>
    </div>
  );
};

export default OurPropertiesPage;
