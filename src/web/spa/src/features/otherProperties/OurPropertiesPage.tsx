import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Dialog } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";

const SOFT_GREEN = "#3d7a3d";

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
  return raw ? raw.replace(/\/$/, "") : null;
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
      setError("API URL not set.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const resp = await fetch(`${apiBase}/other-properties/our-properties`);
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { sites?: OurPropertiesSite[] };
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
      <h1 className="text-2xl font-semibold tracking-tight" style={{ color: SOFT_GREEN }}>
        Our Properties
      </h1>
      <div className="rounded-xl border-2 p-4 shadow-lg" style={{ borderColor: SOFT_GREEN, background: SOFT_GREEN }}>
        <p className="text-sm font-medium text-[#000000]">
          Live status of our sites
        </p>
        <p className="mt-1 text-xs text-[#000000]/90">
          Shows availability and response time for our properties
        </p>
        {canEdit && (
          <p className="mt-2">
            <Link
              to="/admin/other-properties/our-properties"
              className="text-[#000000] hover:text-[#e50203] font-semibold text-sm"
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
              className="text-brand-orange hover:text-orange-400"
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
            const statusBorderBg =
              status === "up"
                ? { borderColor: SOFT_GREEN, background: SOFT_GREEN }
                : status === "degraded"
                ? { borderColor: "#fdde13", background: "#fdde13" }
                : { borderColor: "#e50203", background: "#e50203" };
            const rtStr =
              s.responseTimeMs != null ? `${s.responseTimeMs} ms` : null;
            const hasDescription = (s.description || "").trim().length > 0;
            return (
              <div
                key={s.url || s.domain}
                className="rounded-lg border-2 p-3 text-center text-sm min-w-0 cursor-pointer text-[#000000]"
                style={statusBorderBg}
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
                  className="font-semibold break-all block text-[#000000] hover:text-[#e50203] hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {s.domain}
                </a>
                <div className="mt-1 text-xs capitalize font-medium">{status}</div>
                {rtStr && (
                  <div className="mt-0.5 text-[11px] font-medium">{rtStr}</div>
                )}
                {hasDescription && (
                  <div
                    className="mt-0.5 text-[11px] truncate w-full font-medium"
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
          <Dialog.Panel className="mx-auto max-w-md w-full rounded-xl border-2 border-slate-700 bg-slate-900 p-4 shadow-xl">
            {selectedSite && (
              <>
                <div className="flex items-start justify-between gap-2">
                  <Dialog.Title className="text-lg font-semibold text-slate-100">
                    {selectedSite.domain}
                  </Dialog.Title>
                  <button
                    type="button"
                    onClick={() => setSelectedSite(null)}
                    className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    aria-label="Close modal"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  <p>
                    <span className="text-slate-500">Status:</span>{" "}
                    <span className="capitalize font-medium text-slate-200">{selectedSite.status}</span>
                  </p>
                  {selectedSite.responseTimeMs != null && (
                    <p>
                      <span className="text-slate-500">Response time:</span>{" "}
                      <span className="text-slate-200">{selectedSite.responseTimeMs} ms</span>
                    </p>
                  )}
                  <p>
                    <span className="text-slate-500">URL:</span>{" "}
                    <a
                      href={selectedSite.url || `https://${selectedSite.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#e50203] hover:underline break-all"
                    >
                      {selectedSite.url || `https://${selectedSite.domain}`}
                    </a>
                  </p>
                  {(selectedSite.description || "").trim().length > 0 && (
                    <p>
                      <span className="text-slate-500 block mb-0.5">Description:</span>
                      <span className="text-slate-200">{selectedSite.description}</span>
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
