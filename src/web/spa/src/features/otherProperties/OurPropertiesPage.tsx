import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
  return raw ? raw.replace(/\/$/, "") : null;
}

const OurPropertiesPage: React.FC = () => {
  const { user } = useAuth();
  const [sites, setSites] = useState<OurPropertiesSite[]>([]);
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
      <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "#fdde13" }}>
        Our Properties
      </h1>
      <div className="rounded-xl border-2 border-[#14a113] bg-[#000000] p-4 shadow-lg" style={{ background: "linear-gradient(135deg, #000000 0%, #14a11322 50%, #fdde1322 75%, #e5020322 100%)" }}>
        <p className="text-sm font-medium text-[#fdde13]">
          Live status of our sites
        </p>
        <p className="mt-1 text-xs text-[#14a113]/90">
          Shows availability and response time for our properties
        </p>
        {canEdit && (
          <p className="mt-2">
            <Link
              to="/admin/other-properties/our-properties"
              className="text-[#e50203] hover:text-[#14a113] font-semibold text-sm"
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
            const statusStyles =
              status === "up"
                ? { borderColor: "#14a113", background: "#14a113", color: "#ffffff" }
                : status === "degraded"
                ? { borderColor: "#fdde13", background: "#fdde13", color: "#000000" }
                : { borderColor: "#e50203", background: "#e50203", color: "#ffffff" };
            const rtStr =
              s.responseTimeMs != null ? `${s.responseTimeMs} ms` : null;
            const hasDescription = (s.description || "").trim().length > 0;
            return (
              <div
                key={s.url || s.domain}
                className="rounded-lg border-2 p-3 text-center text-sm min-w-0"
                style={statusStyles}
              >
                <a
                  href={s.url || `https://${s.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold break-all hover:underline block text-inherit"
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
    </div>
  );
};

export default OurPropertiesPage;
