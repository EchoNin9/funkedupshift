import React, { useState } from "react";
import { EmailAuthResult, SpfNode, emailAuthCheck, isAuthError } from "./api";

interface Props {
  onBack: () => void;
  onAuthError: () => void;
}

const CopyRecord: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; nothing to do */
    }
  };
  return (
    <div className="ea-record">
      <code className="dns-value">{text}</code>
      <button type="button" className="btn btn-ghost" onClick={copy}>
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
};

const TreeNode: React.FC<{ node: SpfNode }> = ({ node }) => (
  <li>
    <span className="ea-node-domain">
      {node.via ? `${node.via}: ` : ""}
      {node.domain}
    </span>
    {node.error && <span className="ea-sev-high"> — {node.error}</span>}
    {node.record && <div className="muted dns-value">{node.record}</div>}
    {node.children.length > 0 && (
      <ul className="ea-tree">
        {node.children.map((c, i) => (
          <TreeNode key={i} node={c} />
        ))}
      </ul>
    )}
  </li>
);

const Presence: React.FC<{ label: string; item: { present: boolean; record: string | null } }> = ({ label, item }) => (
  <p className="ea-presence">
    <strong>{label}:</strong> {item.present ? "present" : "not found"}
    {item.record && <code className="dns-value"> {item.record}</code>}
  </p>
);

const EmailAuthTool: React.FC<Props> = ({ onBack, onAuthError }) => {
  const [domain, setDomain] = useState("");
  const [selectors, setSelectors] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EmailAuthResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit: React.FormEventHandler = async (e) => {
    e.preventDefault();
    const d = domain.trim();
    if (!d) return;
    setError(null);
    setRunning(true);
    try {
      setResult(await emailAuthCheck(d, selectors.trim()));
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError();
        return;
      }
      setResult(null);
      setError(err instanceof Error ? err.message : "Check failed.");
    } finally {
      setRunning(false);
    }
  };

  const r = result;
  const dkimRows = r ? [...r.dkim].sort((a, b) => Number(b.found) - Number(a.found)) : [];

  return (
    <section className="tool-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="tool-heading">Email Auth Checker</h1>

      <form className="dns-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="example.com"
          aria-label="Domain"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          required
        />
        <input
          type="text"
          placeholder="DKIM selectors (optional, comma-separated)"
          aria-label="DKIM selectors"
          value={selectors}
          onChange={(e) => setSelectors(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={running}>
          {running ? "Checking…" : "Check"}
        </button>
      </form>

      {error && <div className="banner banner-error">{error}</div>}

      {r && (
        <div className="dns-results">
          {r.warnings.map((w, i) => (
            <div key={i} className="banner banner-warn">
              {w}
            </div>
          ))}

          <div className="ea-summary">
            <span className={`ea-grade ea-grade-${r.grade}`} aria-label={`Grade ${r.grade}`}>
              {r.grade}
            </span>
            <div>
              <h2 className="dns-section-heading">{r.domain}</h2>
              {r.fixes.length === 0 ? (
                <p className="muted dns-status-line">No fixes needed.</p>
              ) : (
                <ul className="ea-fixes">
                  {r.fixes.map((f, i) => (
                    <li key={i}>
                      <span className={`ea-sev ea-sev-${f.severity}`}>{f.severity}</span> {f.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="dns-section">
            <h2 className="dns-section-heading">SPF</h2>
            {r.spf.record ? (
              <>
                <CopyRecord text={r.spf.record} />
                <p className={r.spf.lookupCount > 10 ? "ea-sev-high" : "muted"}>
                  DNS lookups: {r.spf.lookupCount}/10
                </p>
                {r.spf.notes.map((n, i) => (
                  <p key={i} className="muted">{n}</p>
                ))}
                {r.spf.tree && (
                  <ul className="ea-tree ea-tree-root">
                    <TreeNode node={r.spf.tree} />
                  </ul>
                )}
              </>
            ) : (
              <p className="muted dns-status-line">No SPF record.</p>
            )}
          </div>

          <div className="dns-section">
            <h2 className="dns-section-heading">DMARC</h2>
            {r.dmarc.record ? (
              <>
                <CopyRecord text={r.dmarc.record} />
                <table className="dns-table">
                  <tbody>
                    {Object.entries(r.dmarc.tags).map(([k, v]) => (
                      <tr key={k}>
                        <td>{k}</td>
                        <td className="dns-value">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="muted dns-status-line">No DMARC record.</p>
            )}
          </div>

          <div className="dns-section">
            <h2 className="dns-section-heading">DKIM</h2>
            <div className="ea-scroll">
              <table className="dns-table">
                <thead>
                  <tr>
                    <th>Selector</th>
                    <th>Found</th>
                    <th>Type</th>
                    <th>Bits</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {dkimRows.map((k) => (
                    <tr key={k.selector} className={k.found ? "" : "muted"}>
                      <td>{k.selector}</td>
                      <td>{k.found ? "yes" : "no"}</td>
                      <td>{k.keyType ?? "—"}</td>
                      <td>{k.keyBits ?? "—"}</td>
                      <td>{k.warnings.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="dns-section">
            <h2 className="dns-section-heading">MX</h2>
            {r.mx.length === 0 ? (
              <p className="muted dns-status-line">No MX records.</p>
            ) : r.mx.some((m) => m.host === ".") ? (
              <p className="muted dns-status-line">Null MX: this domain does not accept mail.</p>
            ) : (
              <table className="dns-table">
                <thead>
                  <tr>
                    <th>Preference</th>
                    <th>Host</th>
                  </tr>
                </thead>
                <tbody>
                  {r.mx.map((m, i) => (
                    <tr key={i}>
                      <td>{m.preference}</td>
                      <td className="dns-value">{m.host}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="dns-section">
            <h2 className="dns-section-heading">Other records</h2>
            <Presence label="MTA-STS" item={r.mtaSts} />
            <Presence label="TLS-RPT" item={r.tlsRpt} />
            <Presence label="BIMI" item={r.bimi} />
          </div>
        </div>
      )}
    </section>
  );
};

export default EmailAuthTool;
