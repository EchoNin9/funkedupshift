import React, { useState } from "react";
import { motion } from "framer-motion";
import { ServerIcon } from "@heroicons/react/24/outline";
import { Alert } from "../../components";
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

const th = "text-left px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary";
const td = "px-3 py-2 text-sm text-text-primary border-t border-border-default";

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

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-text-primary">DNS Lookup</h1>
        <p className="text-sm text-text-secondary">Sign in to look up DNS records.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <motion.h1
        className="text-2xl font-semibold tracking-tight text-text-primary flex items-center gap-2"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <ServerIcon className="h-6 w-6 text-accent" />
        DNS Lookup
      </motion.h1>
      <p className="text-sm text-text-secondary">
        Look up A, MX, TXT and other DNS records for any domain — mxtoolbox-style.
      </p>

      {formError && <Alert variant="error">{formError}</Alert>}

      <form onSubmit={handleSubmit} className="rounded-xl border border-border-default bg-surface-2/80 p-4 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="example.com (or an IP for PTR)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="flex-1 min-w-[220px] rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as TypeChoice)}
          className="rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary"
        >
          {DNS_RECORD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value="ALL">All types</option>
        </select>
        <button
          type="submit"
          disabled={running}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? "Looking up…" : "Lookup"}
        </button>
      </form>

      <div className="space-y-4">
        {sections.map((section) => (
          <div key={section.type} className="rounded-xl border border-border-default bg-surface-2/80 p-4">
            <h2 className="text-sm font-semibold text-accent mb-2">{section.type}</h2>
            {section.loading && <p className="text-sm text-text-tertiary">Looking up…</p>}
            {!section.loading && section.error && <Alert variant="error">{section.error}</Alert>}
            {!section.loading && section.result && section.result.status !== "ok" && (
              <p className="text-sm text-text-tertiary">
                {STATUS_LABEL[section.result.status] ?? section.result.status}
              </p>
            )}
            {!section.loading &&
              section.result &&
              section.result.status === "ok" &&
              (section.result.records.length === 0 ? (
                <p className="text-sm text-text-tertiary">No records found.</p>
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
          </div>
        ))}
      </div>
    </div>
  );
};

export default DnsPage;
