import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Globe, LockSimple } from "@phosphor-icons/react";
import { Alert } from "../../components";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { FormCard } from "../../components/FormCard";
import { IconTextField } from "../../components/IconTextField";
import { useAuth } from "../../shell/AuthContext";
import { DNS_RECORD_TYPES, DnsRecordType, DnsResult, dnsLookup } from "./api";

type TypeChoice = DnsRecordType | "ALL";

const STATUS_LABEL: Record<string, string> = {
  nxdomain: "Domain does not exist (NXDOMAIN).",
  noanswer: "No records of this type.",
  timeout: "Lookup timed out.",
};

interface SectionState {
  type: DnsRecordType;
  loading: boolean;
  result: DnsResult | null;
  error: string | null;
}

const th = "text-left px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-secondary";
const td = "px-3 py-2.5 text-sm text-text-primary border-t border-[color:var(--color-divider)]";

const DnsPage: React.FC = () => {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [type, setType] = useState<TypeChoice>("ALL");
  const [running, setRunning] = useState(false);
  const [sections, setSections] = useState<SectionState[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const runLookup = async (domain: string, t: DnsRecordType): Promise<SectionState> => {
    try {
      const result = await dnsLookup(domain, t);
      return { type: t, loading: false, result, error: null };
    } catch (err) {
      return {
        type: t,
        loading: false,
        result: null,
        error: err instanceof Error ? err.message : "Lookup failed.",
      };
    }
  };

  const handleSubmit: React.FormEventHandler = async (e) => {
    e.preventDefault();
    const domain = name.trim();
    if (!domain) return;
    setFormError(null);
    setRunning(true);

    const types: DnsRecordType[] = type === "ALL" ? DNS_RECORD_TYPES : [type];
    setSections(types.map((t) => ({ type: t, loading: true, result: null, error: null })));

    try {
      const settled = await Promise.allSettled(types.map((t) => runLookup(domain, t)));
      const next: SectionState[] = settled.map((outcome, i) =>
        outcome.status === "fulfilled"
          ? outcome.value
          : { type: types[i], loading: false, result: null, error: "Lookup failed." }
      );
      setSections(next);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Lookup failed.");
      setSections([]);
    } finally {
      setRunning(false);
    }
  };

  const srTitle = <h1 className="sr-only">DNS Lookup</h1>;

  if (!user) {
    return (
      <div className="space-y-4">
        {srTitle}
        <div className="flex flex-wrap items-center gap-4 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <LockSimple size={26} weight="regular" aria-hidden="true" className="text-accent-text" />
          <div className="min-w-[220px] flex-1">
            <div className="font-bold text-text-primary">Sign in to look up DNS records</div>
            <div className="text-sm text-text-secondary">A, MX, TXT and more for any domain.</div>
          </div>
          <Link to="/auth" className={buttonClasses("primary", "md")}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      {srTitle}
      <p className="mb-4 text-sm text-text-secondary">
        Look up A, MX, TXT and other DNS records for any domain — mxtoolbox-style.
      </p>

      {formError && <Alert variant="error" className="mb-3">{formError}</Alert>}

      <FormCard onSubmit={handleSubmit} className="flex flex-wrap gap-2.5">
        <IconTextField
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-label="Domain name (or an IP for PTR)"
          placeholder="example.com (or an IP for PTR)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          icon={<Globe size={18} weight="regular" />}
          wrapperClassName="flex-1 basis-[240px] min-w-0"
        />
        <select
          aria-label="Record type"
          value={type}
          onChange={(e) => setType(e.target.value as TypeChoice)}
          className={`min-h-12 w-full rounded-ds-md border border-border-default bg-surface-0 px-3 text-[15px] text-text-primary hover:border-border-hover sm:w-auto ${focusRing}`}
        >
          {DNS_RECORD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value="ALL">All types</option>
        </select>
        <button type="submit" disabled={running} className={`${buttonClasses("primary", "lg")} w-full sm:w-auto`}>
          {running ? "Looking up…" : "Lookup"}
        </button>
      </FormCard>

      <div className="mt-6 space-y-4" aria-live="polite" aria-busy={running}>
        {sections.map((section) => (
          <section
            key={section.type}
            className="rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-4"
          >
            <h2 className="mb-2 font-heading text-base font-semibold text-accent-text">{section.type}</h2>
            {section.loading && (
              <div className="motion-safe:animate-pulse space-y-2" role="status">
                <span className="sr-only">Looking up…</span>
                <div className="h-3 w-2/3 rounded bg-surface-3" />
                <div className="h-3 w-1/2 rounded bg-surface-3" />
              </div>
            )}
            {!section.loading && section.error && <Alert variant="error">{section.error}</Alert>}
            {!section.loading && section.result && section.result.status !== "ok" && (
              <p className="text-sm text-text-secondary">
                {STATUS_LABEL[section.result.status] ?? section.result.status}
              </p>
            )}
            {!section.loading &&
              section.result &&
              section.result.status === "ok" &&
              (section.result.records.length === 0 ? (
                <p className="text-sm text-text-secondary">No records found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className={th}>Type</th>
                        <th className={th}>TTL</th>
                        <th className={th}>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.result.records.map((rec, i) => (
                        <tr key={i}>
                          <td className={td}>{rec.record}</td>
                          <td className={td}>{rec.ttl}</td>
                          <td className={`${td} break-all font-mono text-xs`}>{rec.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
};

export default DnsPage;
