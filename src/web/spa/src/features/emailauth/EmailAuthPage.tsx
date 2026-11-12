import React, { useState } from "react";
import { Link } from "react-router-dom";
import { EnvelopeSimple, Globe, Key, LockSimple } from "@phosphor-icons/react";
import { Alert, CopyButton } from "../../components";
import { buttonClasses } from "../../components/buttonClasses";
import { FormCard } from "../../components/FormCard";
import { IconTextField } from "../../components/IconTextField";
import { useAuth } from "../../shell/AuthContext";
import { EmailAuthResult, EmailAuthSeverity, SpfNode, emailAuthCheck } from "./api";

const th = "text-left px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-secondary";
const td = "px-3 py-2.5 text-sm text-text-primary border-t border-[color:var(--color-divider)]";
const card = "rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-4";
const h2 = "mb-2 font-heading text-base font-semibold text-accent-text";

const SEV_CLASS: Record<EmailAuthSeverity, string> = {
  high: "text-danger border-danger",
  medium: "text-warning border-warning",
  low: "text-text-secondary border-border-default",
};
const GRADE_CLASS: Record<string, string> = {
  A: "text-success",
  B: "text-success",
  C: "text-warning",
  D: "text-warning",
  F: "text-danger",
};

const RecordBox: React.FC<{ text: string }> = ({ text }) => (
  <div className="mb-2 flex items-start gap-2">
    <code className="min-w-0 flex-1 break-all font-mono text-xs text-text-primary">{text}</code>
    <CopyButton text={text} />
  </div>
);

const TreeNode: React.FC<{ node: SpfNode }> = ({ node }) => (
  <li className="mb-1.5 break-all text-sm">
    <span className="text-text-primary">
      {node.via ? `${node.via}: ` : ""}
      {node.domain}
    </span>
    {node.error && <span className="text-danger"> — {node.error}</span>}
    {node.record && <div className="font-mono text-xs text-text-secondary">{node.record}</div>}
    {node.children.length > 0 && (
      <ul className="mt-1 list-none border-l border-[color:var(--color-divider)] pl-4">
        {node.children.map((c, i) => (
          <TreeNode key={i} node={c} />
        ))}
      </ul>
    )}
  </li>
);

const Presence: React.FC<{ label: string; item: { present: boolean; record: string | null } }> = ({ label, item }) => (
  <p className="mb-1.5 text-sm text-text-secondary">
    <strong className="text-text-primary">{label}:</strong> {item.present ? "present" : "not found"}
    {item.record && <code className="break-all font-mono text-xs"> {item.record}</code>}
  </p>
);

const EmailAuthPage: React.FC = () => {
  const { user } = useAuth();
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
      setResult(null);
      setError(err instanceof Error ? err.message : "Check failed.");
    } finally {
      setRunning(false);
    }
  };

  const srTitle = <h1 className="sr-only">Email Auth Checker</h1>;

  if (!user) {
    return (
      <div className="space-y-4">
        {srTitle}
        <div className="flex flex-wrap items-center gap-4 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <LockSimple size={26} weight="regular" aria-hidden="true" className="text-accent-text" />
          <div className="min-w-[220px] flex-1">
            <div className="font-bold text-text-primary">Sign in to check email authentication</div>
            <div className="text-sm text-text-secondary">SPF, DKIM and DMARC for any domain.</div>
          </div>
          <Link to="/auth" className={buttonClasses("primary", "md")}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const r = result;
  const dkimRows = r ? [...r.dkim].sort((a, b) => Number(b.found) - Number(a.found)) : [];

  return (
    <div>
      {srTitle}
      <p className="mb-4 text-sm text-text-secondary">
        Check a domain&apos;s SPF, DKIM and DMARC setup and get a prioritised fix list.
      </p>

      {error && <Alert variant="error" className="mb-3">{error}</Alert>}

      <FormCard onSubmit={handleSubmit} className="flex flex-wrap gap-2.5">
        <IconTextField
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-label="Domain"
          placeholder="example.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          required
          icon={<Globe size={18} weight="regular" />}
          wrapperClassName="flex-1 basis-[240px] min-w-0"
        />
        <IconTextField
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-label="DKIM selectors"
          placeholder="DKIM selectors (optional, comma-separated)"
          value={selectors}
          onChange={(e) => setSelectors(e.target.value)}
          icon={<Key size={18} weight="regular" />}
          wrapperClassName="flex-1 basis-[240px] min-w-0"
        />
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
        {!running && r && (
          <>
            {r.warnings.map((w, i) => (
              <div key={i} className="rounded-md border border-warning px-3 py-2 text-sm text-warning">
                {w}
              </div>
            ))}

            <section className={`${card} flex items-start gap-4`}>
              <div
                aria-label={`Grade ${r.grade}`}
                className={`grid h-14 w-14 flex-none place-items-center rounded-ds-lg border-2 border-current font-heading text-3xl font-bold ${GRADE_CLASS[r.grade]}`}
              >
                {r.grade}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className={h2}>
                  <EnvelopeSimple size={16} weight="regular" aria-hidden="true" className="mr-1 inline" />
                  {r.domain}
                </h2>
                {r.fixes.length === 0 ? (
                  <p className="text-sm text-text-secondary">No fixes needed.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm text-text-primary">
                    {r.fixes.map((f, i) => (
                      <li key={i}>
                        <span
                          className={`mr-2 inline-block min-w-[4.2rem] rounded border px-1.5 py-0.5 text-center text-[11px] font-bold uppercase ${SEV_CLASS[f.severity]}`}
                        >
                          {f.severity}
                        </span>
                        {f.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className={card}>
              <h2 className={h2}>SPF</h2>
              {r.spf.record ? (
                <>
                  <RecordBox text={r.spf.record} />
                  <p className={`mb-2 text-sm ${r.spf.lookupCount > 10 ? "text-danger" : "text-text-secondary"}`}>
                    DNS lookups: {r.spf.lookupCount}/10
                  </p>
                  {r.spf.notes.map((n, i) => (
                    <p key={i} className="mb-2 text-sm text-text-secondary">{n}</p>
                  ))}
                  {r.spf.tree && (
                    <ul className="list-none">
                      <TreeNode node={r.spf.tree} />
                    </ul>
                  )}
                </>
              ) : (
                <p className="text-sm text-text-secondary">No SPF record.</p>
              )}
            </section>

            <section className={card}>
              <h2 className={h2}>DMARC</h2>
              {r.dmarc.record ? (
                <>
                  <RecordBox text={r.dmarc.record} />
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <tbody>
                        {Object.entries(r.dmarc.tags).map(([k, v]) => (
                          <tr key={k}>
                            <td className={td}>{k}</td>
                            <td className={`${td} break-all font-mono text-xs`}>{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="text-sm text-text-secondary">No DMARC record.</p>
              )}
            </section>

            <section className={card}>
              <h2 className={h2}>DKIM</h2>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={th}>Selector</th>
                      <th className={th}>Found</th>
                      <th className={th}>Type</th>
                      <th className={th}>Bits</th>
                      <th className={th}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dkimRows.map((k) => (
                      <tr key={k.selector} className={k.found ? "" : "opacity-60"}>
                        <td className={td}>{k.selector}</td>
                        <td className={td}>{k.found ? "yes" : "no"}</td>
                        <td className={td}>{k.keyType ?? "—"}</td>
                        <td className={td}>{k.keyBits ?? "—"}</td>
                        <td className={td}>{k.warnings.join("; ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={card}>
              <h2 className={h2}>MX</h2>
              {r.mx.length === 0 ? (
                <p className="text-sm text-text-secondary">No MX records.</p>
              ) : r.mx.some((m) => m.host === ".") ? (
                <p className="text-sm text-text-secondary">Null MX: this domain does not accept mail.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className={th}>Preference</th>
                        <th className={th}>Host</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.mx.map((m, i) => (
                        <tr key={i}>
                          <td className={td}>{m.preference}</td>
                          <td className={`${td} break-all font-mono text-xs`}>{m.host}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className={card}>
              <h2 className={h2}>Other records</h2>
              <Presence label="MTA-STS" item={r.mtaSts} />
              <Presence label="TLS-RPT" item={r.tlsRpt} />
              <Presence label="BIMI" item={r.bimi} />
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default EmailAuthPage;
