import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LockSimple } from "@phosphor-icons/react";
import { Alert, CopyButton } from "../../components";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { SegmentedControl } from "../../components/SegmentedControl";
import { useAuth } from "../../shell/AuthContext";
import { browserZone, describe, formatLocal, formatTimestamp, listTimeZones, nextRuns, parseExpression, parseTimestamp, type TsUnit } from "./crontime";

type Tab = "cron" | "timestamp";
const TABS: { id: Tab; label: string }[] = [
  { id: "cron", label: "Cron" },
  { id: "timestamp", label: "Timestamp" },
];

const EXAMPLES = ["*/15 * * * *", "0 9 * * 1-5", "0 0 1 * *", "cron(0 12 ? * 6L *)", "cron(0 8 ? * 2#1 *)", "rate(5 minutes)"];

const cardClass = "space-y-3.5 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-3.5 sm:p-4";
const labelClass = "block text-[13px] font-semibold text-text-secondary";
const inputClass = `rounded-ds-md border border-divider bg-surface-1 px-2.5 py-2 text-sm text-text-primary ${focusRing}`;
const cell = "border-b border-divider px-3 py-2 last:border-b-0";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/** Wide tables scroll inside this wrapper instead of stretching the page. */
const Table: React.FC<{ head?: React.ReactNode; children: React.ReactNode }> = ({ head, children }) => (
  <div className="overflow-x-auto rounded-ds-md border border-divider">
    <table className="w-full text-left text-sm">
      {head}
      <tbody>{children}</tbody>
    </table>
  </div>
);

const ZoneSelect: React.FC<{ zone: string; onChange: (z: string) => void }> = ({ zone, onChange }) => {
  const zones = useMemo(() => {
    const all = listTimeZones();
    return all.includes(zone) ? all : [zone, ...all];
  }, [zone]);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-[220px] flex-1 space-y-1.5">
        <span className={labelClass}>Time zone</span>
        <select value={zone} onChange={(e) => onChange(e.target.value)} className={`w-full ${inputClass}`}>
          {zones.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => onChange("UTC")} disabled={zone === "UTC"} className={buttonClasses("secondary", "md")}>
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
    <div className={cardClass}>
      <div className="space-y-1.5">
        <label htmlFor="cron-in" className={labelClass}>Cron expression, cron(...) or rate(...)</label>
        <input id="cron-in" type="text" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} placeholder="*/15 * * * *" className={`w-full font-mono ${inputClass}`} />
      </div>
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => setInput(ex)} className={`${buttonClasses("secondary", "md")} font-mono text-[12px]`}>
            {ex}
          </button>
        ))}
      </div>
      {view?.error && <Alert variant="error">{view.error}</Alert>}
      {parsed && (
        <>
          <p className="text-base font-semibold text-text-primary" role="status">{view?.text}</p>
          {parsed.kind === "rate" ? (
            <div role="status"><Alert variant="success">{result?.note}</Alert></div>
          ) : (
            <>
              <ZoneSelect zone={zone} onChange={setZoneChoice} />
              {parsed.kind === "eventbridge" && zoneChoice === null && (
                <p className="text-sm text-text-secondary">EventBridge rules run in UTC, so the preview uses UTC. Pick another zone if you use EventBridge Scheduler.</p>
              )}
              {result && result.runs.length > 0 && (
                <Table
                  head={
                    <thead>
                      <tr>
                        <th scope="col" className={`${cell} text-[13px] font-semibold text-text-secondary`}>#</th>
                        <th scope="col" className={`${cell} text-[13px] font-semibold text-text-secondary`}>{zone}</th>
                        <th scope="col" className={`${cell} text-[13px] font-semibold text-text-secondary`}>UTC</th>
                      </tr>
                    </thead>
                  }
                >
                  {result.runs.map((ms, i) => (
                    <tr key={ms}>
                      <th scope="row" className={`${cell} text-[13px] font-semibold text-text-secondary`}>{i + 1}</th>
                      <td className={`${cell} whitespace-nowrap font-mono text-[13px] text-text-primary`}>{formatLocal(ms, zone)}</td>
                      <td className={`${cell} whitespace-nowrap font-mono text-[13px] text-text-primary`}>{new Date(ms).toISOString()}</td>
                    </tr>
                  ))}
                </Table>
              )}
              {result?.note && <div role="status"><Alert variant="success">{result.note}</Alert></div>}
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
    <div className={cardClass}>
      <div className="space-y-1.5">
        <label htmlFor="ts-in" className={labelClass}>Epoch number or date</label>
        <input id="ts-in" type="text" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} placeholder="1700000000 or 2023-11-14T22:13:20Z" className={`w-full font-mono ${inputClass}`} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1.5">
          <span className={labelClass}>Number is in</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value as TsUnit)} className={inputClass}>
            <option value="auto">Auto-detect</option>
            <option value="s">Seconds</option>
            <option value="ms">Milliseconds</option>
          </select>
        </label>
        <button type="button" onClick={() => setInput(String(unit === "ms" ? Date.now() : Math.floor(Date.now() / 1000)))} className={buttonClasses("secondary", "md")}>
          Now
        </button>
      </div>
      <ZoneSelect zone={zone} onChange={setZoneChoice} />
      {error && <Alert variant="error">{error}</Alert>}
      {parsed && (
        <p className="text-sm text-text-secondary" role="status">
          {parsed.as === "date" ? "Read as a date. Without an offset, the browser's time zone applies." : `Read as ${parsed.as}${parsed.auto ? " (auto-detected)" : ""}.`}
        </p>
      )}
      {out && (
        <Table>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row" className={`${cell} text-[13px] font-semibold text-text-secondary`}>{k}</th>
              <td className={`${cell} break-all font-mono text-[13px] text-text-primary`}>{v}</td>
              <td className={`${cell} text-right`}><CopyButton text={v} /></td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
};

export default function CronPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("cron");
  const [zoneChoice, setZoneChoice] = useState<string | null>(null);

  const srTitle = <h1 className="sr-only">Cron &amp; Timestamps</h1>;

  if (!user) {
    return (
      <div className="space-y-4">
        {srTitle}
        <div className="flex flex-wrap items-center gap-4 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <LockSimple size={26} weight="regular" aria-hidden="true" className="text-accent-text" />
          <div className="min-w-[220px] flex-1">
            <div className="font-bold text-text-primary">Sign in to use Cron &amp; Timestamps</div>
            <div className="text-sm text-text-secondary">Runs locally — nothing ever leaves your browser.</div>
          </div>
          <Link to="/auth" className={buttonClasses("primary", "md")}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {srTitle}
      <p className="text-sm text-text-secondary">Runs locally — nothing leaves your browser.</p>
      <SegmentedControl options={TABS} value={tab} onChange={setTab} ariaLabel="Tool mode" />
      {tab === "cron" && <CronPanel zoneChoice={zoneChoice} setZoneChoice={setZoneChoice} />}
      {tab === "timestamp" && <TimestampPanel zoneChoice={zoneChoice} setZoneChoice={setZoneChoice} />}
    </div>
  );
}
