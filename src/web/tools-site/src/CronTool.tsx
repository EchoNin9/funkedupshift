import React, { useMemo, useState } from "react";
import { browserZone, describe, formatLocal, formatTimestamp, listTimeZones, nextRuns, parseExpression, parseTimestamp, type TsUnit } from "./crontime";

type Tab = "cron" | "timestamp";
const TABS: { id: Tab; label: string }[] = [
  { id: "cron", label: "Cron" },
  { id: "timestamp", label: "Timestamp" },
];

const EXAMPLES = ["*/15 * * * *", "0 9 * * 1-5", "0 0 1 * *", "cron(0 12 ? * 6L *)", "cron(0 8 ? * 2#1 *)", "rate(5 minutes)"];

interface Props {
  onBack: () => void;
}

const CopyBtn: React.FC<{ value: string }> = ({ value }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard denied — the text is visible and selectable
    }
  };
  return (
    <button type="button" className="btn btn-ghost" onClick={copy}>
      {copied ? "Copied!" : "Copy"}
    </button>
  );
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/** Wide tables scroll inside this wrapper instead of stretching the 780px column. */
const Scroll: React.FC<{ children: React.ReactNode }> = ({ children }) => <div style={{ overflowX: "auto" }}>{children}</div>;

const ZoneSelect: React.FC<{ zone: string; onChange: (z: string) => void }> = ({ zone, onChange }) => {
  const zones = useMemo(() => {
    const all = listTimeZones();
    return all.includes(zone) ? all : [zone, ...all];
  }, [zone]);
  return (
    <div className="conv-row">
      <label className="conv-field">
        Time zone
        <select value={zone} onChange={(e) => onChange(e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
      </label>
      <button type="button" className="btn btn-ghost" onClick={() => onChange("UTC")} disabled={zone === "UTC"}>
        Use UTC
      </button>
    </div>
  );
};

interface PanelProps {
  /** user's explicit zone choice, or null to use the default */
  zoneChoice: string | null;
  setZoneChoice: (z: string) => void;
}

const CronPanel: React.FC<PanelProps> = ({ zoneChoice, setZoneChoice }) => {
  const [input, setInput] = useState("0 9 * * 1-5");
  const view = useMemo(() => {
    if (input.trim() === "") return null;
    try {
      const parsed = parseExpression(input);
      return { parsed, text: describe(parsed), error: null as string | null };
    } catch (e) {
      return { parsed: null, text: "", error: errMsg(e) };
    }
  }, [input]);
  const parsed = view?.parsed ?? null;
  const zone = zoneChoice ?? parsed?.defaultZone ?? browserZone();
  const result = useMemo(() => (parsed ? nextRuns(parsed, Date.now(), zone, 10) : null), [parsed, zone]);
  return (
    <div className="conv-panel">
      <div className="conv-field">
        <label htmlFor="cron-in">Cron expression, cron(...) or rate(...)</label>
        <input id="cron-in" type="text" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} placeholder="*/15 * * * *" />
      </div>
      <div className="conv-row">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="btn btn-ghost" onClick={() => setInput(ex)}>
            {ex}
          </button>
        ))}
      </div>
      {view?.error && <div className="banner banner-error">{view.error}</div>}
      {parsed && (
        <>
          <p role="status">
            <strong>{view?.text}</strong>
          </p>
          {parsed.kind === "rate" ? (
            <div className="banner" role="status">{result?.note}</div>
          ) : (
            <>
              <ZoneSelect zone={zone} onChange={setZoneChoice} />
              {parsed.kind === "eventbridge" && zoneChoice === null && (
                <p className="muted">EventBridge rules run in UTC, so the preview uses UTC. Pick another zone if you use EventBridge Scheduler.</p>
              )}
              {result && result.runs.length > 0 && (
                <Scroll>
                  <table className="dns-table">
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">{zone}</th>
                        <th scope="col">UTC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.runs.map((ms, i) => (
                        <tr key={ms}>
                          <th scope="row">{i + 1}</th>
                          <td className="dns-value">{formatLocal(ms, zone)}</td>
                          <td className="dns-value">{new Date(ms).toISOString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Scroll>
              )}
              {result?.note && <div className="banner" role="status">{result.note}</div>}
            </>
          )}
        </>
      )}
    </div>
  );
};

const TimestampPanel: React.FC<PanelProps> = ({ zoneChoice, setZoneChoice }) => {
  const [input, setInput] = useState(() => String(Math.floor(Date.now() / 1000)));
  const [unit, setUnit] = useState<TsUnit>("auto");
  const zone = zoneChoice ?? browserZone();
  let parsed: ReturnType<typeof parseTimestamp> | null = null;
  let error: string | null = null;
  if (input.trim() !== "") {
    try {
      parsed = parseTimestamp(input, unit);
    } catch (e) {
      error = errMsg(e);
    }
  }
  const out = parsed ? formatTimestamp(parsed.ms, zone, Date.now()) : null;
  const rows: [string, string][] = out
    ? [
        ["Epoch seconds", out.seconds],
        ["Epoch milliseconds", out.millis],
        ["ISO 8601 (UTC)", out.iso],
        ["RFC 2822", out.rfc2822],
        [`Local (${zone})`, out.local],
        ["Relative", out.relative],
      ]
    : [];
  return (
    <div className="conv-panel">
      <div className="conv-field">
        <label htmlFor="ts-in">Epoch number or date</label>
        <input id="ts-in" type="text" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} placeholder="1700000000 or 2023-11-14T22:13:20Z" />
      </div>
      <div className="conv-row">
        <label className="conv-field">
          Number is in
          <select value={unit} onChange={(e) => setUnit(e.target.value as TsUnit)}>
            <option value="auto">Auto-detect</option>
            <option value="s">Seconds</option>
            <option value="ms">Milliseconds</option>
          </select>
        </label>
        <button type="button" className="btn btn-ghost" onClick={() => setInput(String(unit === "ms" ? Date.now() : Math.floor(Date.now() / 1000)))}>
          Now
        </button>
      </div>
      <ZoneSelect zone={zone} onChange={setZoneChoice} />
      {error && <div className="banner banner-error">{error}</div>}
      {parsed && (
        <p className="muted" role="status">
          {parsed.as === "date" ? "Read as a date. Without an offset, the browser's time zone applies." : `Read as ${parsed.as}${parsed.auto ? " (auto-detected)" : ""}.`}
        </p>
      )}
      {out && (
        <Scroll>
          <table className="dns-table">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td className="dns-value">{v}</td>
                  <td><CopyBtn value={v} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      )}
    </div>
  );
};

const CronTool: React.FC<Props> = ({ onBack }) => {
  const [tab, setTab] = useState<Tab>("cron");
  const [zoneChoice, setZoneChoice] = useState<string | null>(null);
  return (
    <section className="tool-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="tool-heading">Cron &amp; Timestamps</h1>
      <p className="muted local-notice">Everything below runs locally — nothing leaves your browser.</p>

      <div className="conv-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`conv-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "cron" && <CronPanel zoneChoice={zoneChoice} setZoneChoice={setZoneChoice} />}
      {tab === "timestamp" && <TimestampPanel zoneChoice={zoneChoice} setZoneChoice={setZoneChoice} />}
    </section>
  );
};

export default CronTool;
