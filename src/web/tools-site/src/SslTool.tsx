import React, { useState } from "react";
import { SSL_PORTS, SslCert, SslResult, isAuthError, sslCheck } from "./api";

interface Props {
  onBack: () => void;
  onAuthError: () => void;
  /** Prefills the host (e.g. from a DNS Lookup result). */
  initialHost?: string;
}

const STATUS_LABEL = { ok: "OK", warning: "Expiring soon", error: "Problem" } as const;

const fmtDate = (iso: string) => new Date(iso).toISOString().slice(0, 10);

const CertEntry: React.FC<{ cert: SslCert; index: number; open: boolean }> = ({ cert, index, open }) => (
  <details className="ssl-cert" open={open}>
    <summary>
      <strong>{index === 0 ? "Leaf" : `Chain #${index}`}</strong> {cert.subject}
    </summary>
    <dl className="ssl-fields">
      <dt>Subject</dt>
      <dd>{cert.subject}</dd>
      <dt>Issuer</dt>
      <dd>
        {cert.issuer}
        {cert.selfSigned && " (self-signed)"}
      </dd>
      <dt>Valid</dt>
      <dd>
        {fmtDate(cert.notBefore)} to {fmtDate(cert.notAfter)}
      </dd>
      <dt>Serial</dt>
      <dd>{cert.serial}</dd>
      <dt>Signature</dt>
      <dd>{cert.signatureHash ?? "n/a"}</dd>
      <dt>Public key</dt>
      <dd>
        {cert.keyType}
        {cert.keySize ? ` ${cert.keySize}-bit` : ""}
      </dd>
      <dt>SANs</dt>
      <dd>
        {cert.sans.dns.length + cert.sans.ip.length === 0 ? (
          "none"
        ) : (
          <ul className="ssl-sans">
            {[...cert.sans.dns, ...cert.sans.ip].map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </dd>
    </dl>
  </details>
);

const SslTool: React.FC<Props> = ({ onBack, onAuthError, initialHost }) => {
  const [host, setHost] = useState(initialHost ?? "");
  const [port, setPort] = useState(443);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SslResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit: React.FormEventHandler = async (e) => {
    e.preventDefault();
    const h = host.trim();
    if (!h) return;
    setError(null);
    setRunning(true);
    try {
      setResult(await sslCheck(h, port));
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
  return (
    <section className="tool-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="tool-heading">SSL Certificate Checker</h1>

      <form className="dns-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="example.com"
          aria-label="Host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          required
        />
        <select aria-label="Port" value={port} onChange={(e) => setPort(Number(e.target.value))}>
          {SSL_PORTS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary" disabled={running}>
          {running ? "Checking…" : "Check"}
        </button>
      </form>

      {error && <div className="banner banner-error">{error}</div>}

      {r && (
        <div className="dns-results">
          <div className="ssl-summary">
            <span className={`ssl-badge ssl-badge-${r.status}`}>{STATUS_LABEL[r.status]}</span>
            <span className="muted">
              {r.daysLeft < 0 ? `Expired ${-r.daysLeft} days ago` : `${r.daysLeft} days left`}
            </span>
          </div>
          <dl className="ssl-fields">
            <dt>Trusted</dt>
            <dd>{r.trusted ? "Yes" : `No: ${r.trustError ?? "unknown reason"}`}</dd>
            <dt>Hostname match</dt>
            <dd>{r.hostnameMatch ? "Yes" : "No"}</dd>
            <dt>TLS version</dt>
            <dd>{r.tlsVersion}</dd>
            <dt>Cipher</dt>
            <dd>{r.cipher}</dd>
          </dl>
          <div>
            <h2 className="dns-section-heading">Certificate chain</h2>
            {r.chain.map((c, i) => (
              <CertEntry key={i} cert={c} index={i} open={i === 0} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

export default SslTool;
