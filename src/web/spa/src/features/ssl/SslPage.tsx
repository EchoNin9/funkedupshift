import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Certificate, Globe, LockSimple } from "@phosphor-icons/react";
import { Alert } from "../../components";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { FormCard } from "../../components/FormCard";
import { IconTextField } from "../../components/IconTextField";
import { useAuth } from "../../shell/AuthContext";
import { SSL_PORTS, SslCert, SslResult, sslCheck } from "./api";

const card = "rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-4";
const h2 = "mb-2 font-heading text-base font-semibold text-accent-text";

const STATUS: Record<SslResult["status"], { label: string; cls: string }> = {
  ok: { label: "OK", cls: "text-success border-success" },
  warning: { label: "Expiring soon", cls: "text-warning border-warning" },
  error: { label: "Problem", cls: "text-danger border-danger" },
};

const fmtDate = (iso: string) => new Date(iso).toISOString().slice(0, 10);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-wrap gap-x-4 gap-y-0.5 py-1 text-sm">
    <dt className="w-32 flex-none text-text-secondary">{label}</dt>
    <dd className="min-w-0 flex-1 break-all text-text-primary">{children}</dd>
  </div>
);

const CertEntry: React.FC<{ cert: SslCert; index: number }> = ({ cert, index }) => {
  const sans = [...cert.sans.dns, ...cert.sans.ip];
  return (
    <details open={index === 0} className="mb-2 rounded-md border border-[color:var(--color-divider)] px-3 py-2">
      <summary className="cursor-pointer break-all text-sm text-text-primary">
        <strong>{index === 0 ? "Leaf" : `Chain #${index}`}</strong> {cert.subject}
      </summary>
      <dl className="mt-2">
        <Row label="Subject">{cert.subject}</Row>
        <Row label="Issuer">
          {cert.issuer}
          {cert.selfSigned && " (self-signed)"}
        </Row>
        <Row label="Valid">
          {fmtDate(cert.notBefore)} to {fmtDate(cert.notAfter)}
        </Row>
        <Row label="Serial">
          <span className="font-mono text-xs">{cert.serial}</span>
        </Row>
        <Row label="Signature">{cert.signatureHash ?? "n/a"}</Row>
        <Row label="Public key">
          {cert.keyType}
          {cert.keySize ? ` ${cert.keySize}-bit` : ""}
        </Row>
        <Row label="SANs">
          {sans.length === 0 ? (
            "none"
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {sans.map((n) => (
                <li key={n} className="rounded-full border border-[color:var(--color-divider)] px-2 py-0.5 text-xs">
                  {n}
                </li>
              ))}
            </ul>
          )}
        </Row>
      </dl>
    </details>
  );
};

const SslPage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [host, setHost] = useState(searchParams.get("host") ?? "");
  const [port, setPort] = useState(443);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SslResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (h: string, p: number) => {
    setError(null);
    setRunning(true);
    try {
      setResult(await sslCheck(h, p));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Check failed.");
    } finally {
      setRunning(false);
    }
  };

  const handleSubmit: React.FormEventHandler = (e) => {
    e.preventDefault();
    const h = host.trim();
    if (h) void run(h, port);
  };

  // Linked from DNS Lookup (?host=): run once on mount.
  const autoRan = useRef(false);
  useEffect(() => {
    const h = searchParams.get("host")?.trim();
    if (user && h && !autoRan.current) {
      autoRan.current = true;
      void run(h, 443);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const srTitle = <h1 className="sr-only">SSL Checker</h1>;

  if (!user) {
    return (
      <div className="space-y-4">
        {srTitle}
        <div className="flex flex-wrap items-center gap-4 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <LockSimple size={26} weight="regular" aria-hidden="true" className="text-accent-text" />
          <div className="min-w-[220px] flex-1">
            <div className="font-bold text-text-primary">Sign in to check SSL certificates</div>
            <div className="text-sm text-text-secondary">Chain, expiry and trust for any public host.</div>
          </div>
          <Link to="/auth" className={buttonClasses("primary", "md")}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const r = result;
  const st = r ? STATUS[r.status] : null;
  return (
    <div>
      {srTitle}
      <p className="mb-4 text-sm text-text-secondary">Inspect a site&apos;s TLS certificate chain, expiry and trust.</p>

      {error && <Alert variant="error" className="mb-3">{error}</Alert>}

      <FormCard onSubmit={handleSubmit} className="flex flex-wrap gap-2.5">
        <IconTextField
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-label="Host"
          placeholder="example.com"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          required
          icon={<Globe size={18} weight="regular" />}
          wrapperClassName="flex-1 basis-[240px] min-w-0"
        />
        <select
          aria-label="Port"
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
          className={`min-h-12 w-full rounded-ds-md border border-border-default bg-surface-0 px-3 text-[15px] text-text-primary hover:border-border-hover sm:w-auto ${focusRing}`}
        >
          {SSL_PORTS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button type="submit" disabled={running} className={`${buttonClasses("primary", "lg")} w-full sm:w-auto`}>
          {running ? "Checking…" : "Check"}
        </button>
      </FormCard>

      <div className="mt-6 space-y-4" aria-live="polite" aria-busy={running}>
        {running && (
          <div className="motion-safe:animate-pulse space-y-2" role="status">
            <span className="sr-only">Checking…</span>
            <div className="h-3 w-2/3 rounded bg-surface-3" />
            <div className="h-3 w-1/2 rounded bg-surface-3" />
          </div>
        )}
        {!running && r && st && (
          <>
            <section className={card}>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <span className={`rounded-full border px-3 py-0.5 text-sm font-bold ${st.cls}`}>{st.label}</span>
                <span className="text-sm text-text-secondary">
                  {r.daysLeft < 0 ? `Expired ${-r.daysLeft} days ago` : `${r.daysLeft} days left`}
                </span>
              </div>
              <dl>
                <Row label="Trusted">{r.trusted ? "Yes" : `No: ${r.trustError ?? "unknown reason"}`}</Row>
                <Row label="Hostname match">{r.hostnameMatch ? "Yes" : "No"}</Row>
                <Row label="TLS version">{r.tlsVersion}</Row>
                <Row label="Cipher">{r.cipher}</Row>
              </dl>
            </section>
            <section className={card}>
              <h2 className={h2}>
                <Certificate size={16} weight="regular" aria-hidden="true" className="mr-1 inline" />
                Certificate chain
              </h2>
              {r.chain.map((c, i) => (
                <CertEntry key={i} cert={c} index={i} />
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default SslPage;
