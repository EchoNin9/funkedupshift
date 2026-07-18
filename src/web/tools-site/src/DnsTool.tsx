import React, { useState } from "react";
import { DNS_RECORD_TYPES, DnsRecordType, DnsResult, dnsLookup, isAuthError } from "./api";

interface Props {
  onBack: () => void;
  onAuthError: () => void;
}

type TypeChoice = DnsRecordType | "ALL";

const STATUS_LABEL: Record<string, string> = {
  nxdomain: "Domain does not exist (NXDOMAIN).",
  noanswer: "No records of this type.",
  timeout: "Lookup timed out."
};

interface SectionState {
  type: DnsRecordType;
  loading: boolean;
  result: DnsResult | null;
  error: string | null;
}

const DnsTool: React.FC<Props> = ({ onBack, onAuthError }) => {
  const [name, setName] = useState("");
  const [type, setType] = useState<TypeChoice>("A");
  const [running, setRunning] = useState(false);
  const [sections, setSections] = useState<SectionState[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const runLookup = async (domain: string, t: DnsRecordType): Promise<SectionState> => {
    try {
      const result = await dnsLookup(domain, t);
      return { type: t, loading: false, result, error: null };
    } catch (err) {
      if (isAuthError(err)) throw err;
      return {
        type: t,
        loading: false,
        result: null,
        error: err instanceof Error ? err.message : "Lookup failed."
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
      if (isAuthError(err)) {
        onAuthError();
        return;
      }
      setFormError(err instanceof Error ? err.message : "Lookup failed.");
      setSections([]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="tool-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="tool-heading">DNS Lookup</h1>

      <form className="dns-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="example.com (or an IP for PTR)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <select value={type} onChange={(e) => setType(e.target.value as TypeChoice)}>
          {DNS_RECORD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value="ALL">All types</option>
        </select>
        <button type="submit" className="btn btn-primary" disabled={running}>
          {running ? "Looking up…" : "Lookup"}
        </button>
      </form>

      {formError && <div className="banner banner-error">{formError}</div>}

      <div className="dns-results">
        {sections.map((section) => (
          <div key={section.type} className="dns-section">
            <h2 className="dns-section-heading">{section.type}</h2>
            {section.loading && <p className="muted">Looking up…</p>}
            {!section.loading && section.error && <div className="banner banner-error">{section.error}</div>}
            {!section.loading && section.result && section.result.status !== "ok" && (
              <p className="muted dns-status-line">
                {STATUS_LABEL[section.result.status] ?? section.result.status}
              </p>
            )}
            {!section.loading && section.result && section.result.status === "ok" && (
              section.result.records.length === 0 ? (
                <p className="muted dns-status-line">No records found.</p>
              ) : (
                <table className="dns-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>TTL</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.result.records.map((rec, i) => (
                      <tr key={i}>
                        <td>{rec.record}</td>
                        <td>{rec.ttl}</td>
                        <td className="dns-value">{rec.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

export default DnsTool;
