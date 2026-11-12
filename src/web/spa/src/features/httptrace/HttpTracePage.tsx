import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Globe, LockSimple } from "@phosphor-icons/react";
import { Alert } from "../../components";
import { buttonClasses } from "../../components/buttonClasses";
import { FormCard } from "../../components/FormCard";
import { IconTextField } from "../../components/IconTextField";
import { useAuth } from "../../shell/AuthContext";
import { HttpHop, HttpTraceResult, httpTrace } from "./api";

const card = "rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-4";
const h2 = "mb-2 font-heading text-base font-semibold text-accent-text";

const statusCls = (s?: number) =>
  s == null || s >= 400 ? "text-danger border-danger" : s >= 300 ? "text-warning border-warning" : "text-success border-success";
const GRADE_CLS: Record<string, string> = {
  A: "text-success border-success",
  B: "text-success border-success",
  C: "text-warning border-warning",
  D: "text-warning border-warning",
  F: "text-danger border-danger",
};

const HeaderTable: React.FC<{ rows: [string, string][] }> = ({ rows }) => (
  <table className="mt-2 w-full table-fixed text-sm">
    <tbody>
      {rows.map(([k, v], i) => (
        <tr key={i} className="border-t border-[color:var(--color-divider)] align-top">
          <th className="w-2/5 break-all py-1 pr-3 text-left font-medium text-text-secondary">{k}</th>
          <td className="break-all py-1 font-mono text-xs text-text-primary">{v}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const HopEntry: React.FC<{ hop: HttpHop; index: number; next?: string | null }> = ({ hop, index, next }) => (
  <li className="mb-2 rounded-md border border-[color:var(--color-divider)] px-3 py-2">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className={`rounded-full border px-2.5 py-0.5 font-bold ${statusCls(hop.status)}`}>{hop.status ?? "Error"}</span>
      {hop.method && <span className="text-text-secondary">{hop.method}</span>}
      <span className="text-text-secondary">#{index + 1}</span>
      {hop.timeMs != null && <span className="text-text-secondary">{hop.timeMs} ms</span>}
      {hop.ip && <span className="text-text-secondary">{hop.ip}</span>}
    </div>
    <div className="my-1 break-all font-mono text-sm text-text-primary">{hop.url}</div>
    {hop.error && <Alert variant="error" className="my-1">{hop.error}</Alert>}
    {next && <div className="break-all font-mono text-sm text-text-secondary">&darr; {next}</div>}
    {hop.headers && (
      <details className="mt-1">
        <summary className="cursor-pointer text-sm text-text-primary">
          Headers ({hop.headers.length}
          {hop.truncated ? ", truncated" : ""})
        </summary>
        <HeaderTable rows={hop.headers} />
      </details>
    )}
  </li>
);

const HttpTracePage: React.FC = () => {
  const { user } = useAuth();
  const [url, setUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HttpTraceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit: React.FormEventHandler = async (e) => {
    e.preventDefault();
    const u = url.trim();
    if (!u) return;
    setError(null);
    setRunning(true);
    try {
      setResult(await httpTrace(u));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Trace failed.");
    } finally {
      setRunning(false);
    }
  };

  const srTitle = <h1 className="sr-only">HTTP Headers</h1>;

  if (!user) {
    return (
      <div className="space-y-4">
        {srTitle}
        <div className="flex flex-wrap items-center gap-4 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <LockSimple size={26} weight="regular" aria-hidden="true" className="text-accent-text" />
          <div className="min-w-[220px] flex-1">
            <div className="font-bold text-text-primary">Sign in to trace HTTP redirects</div>
            <div className="text-sm text-text-secondary">Redirect chain, security and caching headers for any public URL.</div>
          </div>
          <Link to="/auth" className={buttonClasses("primary", "md")}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const r = result;
  const cdnRows: [string, string][] = r?.cdn
    ? [
        ...(r.cdn.detected.length ? ([["CDN", r.cdn.detected.join(", ")]] as [string, string][]) : []),
        ...(r.cdn.server ? ([["Server", r.cdn.server]] as [string, string][]) : []),
        ...(r.cdn.poweredBy ? ([["X-Powered-By", r.cdn.poweredBy]] as [string, string][]) : []),
      ]
    : [];
  return (
    <div>
      {srTitle}
      <p className="mb-4 text-sm text-text-secondary">Trace a URL&apos;s redirect chain and check its security and caching headers.</p>

      {error && <Alert variant="error" className="mb-3">{error}</Alert>}

      <FormCard onSubmit={handleSubmit} className="flex flex-wrap gap-2.5">
        <IconTextField
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-label="URL"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          icon={<Globe size={18} weight="regular" />}
          wrapperClassName="flex-1 basis-[240px] min-w-0"
        />
        <button type="submit" disabled={running} className={`${buttonClasses("primary", "lg")} w-full sm:w-auto`}>
          {running ? "Tracing…" : "Trace"}
        </button>
      </FormCard>

      <div className="mt-6 space-y-4" aria-live="polite" aria-busy={running}>
        {running && (
          <div className="motion-safe:animate-pulse space-y-2" role="status">
            <span className="sr-only">Tracing…</span>
            <div className="h-3 w-2/3 rounded bg-surface-3" />
            <div className="h-3 w-1/2 rounded bg-surface-3" />
          </div>
        )}
        {!running && r && (
          <>
            <section className={card}>
              <h2 className={h2}>
                Redirect chain ({r.hops.length} {r.hops.length === 1 ? "hop" : "hops"}, {r.totalMs} ms)
              </h2>
              <ol>
                {r.hops.map((h, i) => (
                  <HopEntry key={i} hop={h} index={i} next={h.nextUrl && i < r.hops.length - 1 ? h.nextUrl : null} />
                ))}
              </ol>
              <p className="text-sm text-text-secondary">Stopped: {r.stopReason}</p>
            </section>
            {r.security && (
              <section className={card}>
                <h2 className={h2}>Security headers</h2>
                <div className="mb-3 flex items-center gap-3">
                  <span className={`rounded-full border px-3 py-0.5 text-lg font-bold ${GRADE_CLS[r.securityGrade ?? "F"]}`}>
                    {r.securityGrade}
                  </span>
                  <span className="text-sm text-text-secondary">of the final response</span>
                </div>
                <ul className="space-y-2 text-sm">
                  {r.security.map((s) => (
                    <li key={s.name} className="break-all">
                      <strong className={s.ok ? "text-success" : s.present ? "text-warning" : "text-danger"}>
                        {s.ok ? "OK" : s.present ? "Weak" : "Missing"}
                      </strong>{" "}
                      <span className="text-text-primary">{s.name}</span>
                      <div className="text-text-secondary">{s.note}</div>
                      {s.value && <div className="font-mono text-xs text-text-primary">{s.value}</div>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {r.cache && (
              <section className={card}>
                <h2 className={h2}>Caching</h2>
                {Object.keys(r.cache).length === 0 ? (
                  <p className="text-sm text-text-secondary">No caching headers.</p>
                ) : (
                  <HeaderTable rows={Object.entries(r.cache)} />
                )}
              </section>
            )}
            {r.cdn && (
              <section className={card}>
                <h2 className={h2}>CDN and server</h2>
                {cdnRows.length === 0 ? <p className="text-sm text-text-secondary">No CDN hints.</p> : <HeaderTable rows={cdnRows} />}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default HttpTracePage;
