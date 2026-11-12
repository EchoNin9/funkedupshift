import React, { useState } from "react";
import { HttpHop, HttpTraceResult, httpTrace, isAuthError } from "./api";

interface Props {
  onBack: () => void;
  onAuthError: () => void;
}

const statusClass = (s?: number) => (s == null ? "err" : s >= 400 ? "err" : s >= 300 ? "redir" : "ok");

const HopEntry: React.FC<{ hop: HttpHop; index: number; next?: string | null }> = ({ hop, index, next }) => (
  <li className="http-hop">
    <div className="http-hop-head">
      <span className={`http-badge http-badge-${statusClass(hop.status)}`}>{hop.status ?? "Error"}</span>
      {hop.method && <span className="muted">{hop.method}</span>}
      <span className="muted">#{index + 1}</span>
      {hop.timeMs != null && <span className="muted">{hop.timeMs} ms</span>}
      {hop.ip && <span className="muted">{hop.ip}</span>}
    </div>
    <div className="http-url">{hop.url}</div>
    {hop.error && <div className="banner banner-error">{hop.error}</div>}
    {next && <div className="http-next">&darr; {next}</div>}
    {hop.headers && (
      <details>
        <summary>
          Headers ({hop.headers.length}
          {hop.truncated ? ", truncated" : ""})
        </summary>
        <table className="dns-table http-headers">
          <tbody>
            {hop.headers.map(([k, v], i) => (
              <tr key={i}>
                <th>{k}</th>
                <td className="dns-value">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    )}
  </li>
);

const KeyValues: React.FC<{ title: string; rows: [string, string][]; empty: string }> = ({ title, rows, empty }) => (
  <div>
    <h2 className="dns-section-heading">{title}</h2>
    {rows.length === 0 ? (
      <p className="muted">{empty}</p>
    ) : (
      <table className="dns-table http-headers">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td className="dns-value">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

const HttpTraceTool: React.FC<Props> = ({ onBack, onAuthError }) => {
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
      if (isAuthError(err)) {
        onAuthError();
        return;
      }
      setResult(null);
      setError(err instanceof Error ? err.message : "Trace failed.");
    } finally {
      setRunning(false);
    }
  };

  const r = result;
  const cdnRows: [string, string][] = r?.cdn
    ? [
        ...(r.cdn.detected.length ? ([["CDN", r.cdn.detected.join(", ")]] as [string, string][]) : []),
        ...(r.cdn.server ? ([["Server", r.cdn.server]] as [string, string][]) : []),
        ...(r.cdn.poweredBy ? ([["X-Powered-By", r.cdn.poweredBy]] as [string, string][]) : []),
      ]
    : [];
  return (
    <section className="tool-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="tool-heading">HTTP Headers &amp; Redirects</h1>

      <form className="dns-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="https://example.com"
          aria-label="URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button type="submit" className="btn btn-primary" disabled={running}>
          {running ? "Tracing…" : "Trace"}
        </button>
      </form>

      {error && <div className="banner banner-error">{error}</div>}

      {r && (
        <div className="dns-results">
          <div>
            <h2 className="dns-section-heading">
              Redirect chain ({r.hops.length} {r.hops.length === 1 ? "hop" : "hops"}, {r.totalMs} ms)
            </h2>
            <ol className="http-hops">
              {r.hops.map((h, i) => (
                <HopEntry key={i} hop={h} index={i} next={h.nextUrl && i < r.hops.length - 1 ? h.nextUrl : null} />
              ))}
            </ol>
            <p className="muted">Stopped: {r.stopReason}</p>
          </div>

          {r.security && (
            <div>
              <h2 className="dns-section-heading">Security headers</h2>
              <div className="http-grade-row">
                <span className={`http-grade http-grade-${r.securityGrade}`}>{r.securityGrade}</span>
                <span className="muted">of the final response</span>
              </div>
              <ul className="http-sec">
                {r.security.map((s) => (
                  <li key={s.name}>
                    <strong>{s.ok ? "OK" : s.present ? "Weak" : "Missing"}</strong> {s.name}
                    <div className="muted">{s.note}</div>
                    {s.value && <div className="dns-value">{s.value}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {r.cache && (
            <KeyValues title="Caching" rows={Object.entries(r.cache)} empty="No caching headers." />
          )}
          {r.cdn && <KeyValues title="CDN and server" rows={cdnRows} empty="No CDN hints." />}
        </div>
      )}
    </section>
  );
};

export default HttpTraceTool;
