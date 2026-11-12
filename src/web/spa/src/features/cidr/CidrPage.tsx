import React, { useState } from "react";
import { Link } from "react-router-dom";
import { LockSimple } from "@phosphor-icons/react";
import { Alert, CopyButton } from "../../components";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { SegmentedControl } from "../../components/SegmentedControl";
import { useAuth } from "../../shell/AuthContext";
import { calculate, contains, findOverlaps, split, type CalcResult } from "./cidr";

type Tab = "calc" | "split" | "overlap" | "contains";
const TABS: { id: Tab; label: string }[] = [
  { id: "calc", label: "Calculate" },
  { id: "split", label: "Split" },
  { id: "overlap", label: "Overlap" },
  { id: "contains", label: "Contains" },
];

const cardClass = "space-y-3.5 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-3.5 sm:p-4";
const labelClass = "block text-[13px] font-semibold text-text-secondary";
const areaClass = `w-full rounded-ds-md border border-divider bg-surface-1 p-2.5 font-mono text-[13px] text-text-primary ${focusRing}`;
const inputClass = `rounded-ds-md border border-divider bg-surface-1 px-2.5 py-2 text-sm text-text-primary ${focusRing}`;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/** Wide tables scroll inside this wrapper instead of stretching the page. */
const Table: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="overflow-x-auto rounded-ds-md border border-divider">
    <table className="w-full text-left text-sm">
      <tbody>{children}</tbody>
    </table>
  </div>
);
const cell = "border-b border-divider px-3 py-2 last:border-b-0";

const rowsFor = (r: CalcResult): [string, string, boolean][] =>
  r.family === 4
    ? [
        ["Network", r.network, true],
        ["Broadcast", r.broadcast, true],
        ["Netmask", r.netmask, true],
        ["Wildcard", r.wildcard, true],
        ["Prefix", `/${r.prefix}`, false],
        ["Total addresses", r.total, true],
        ["First usable", r.firstUsable, true],
        ["Last usable", r.lastUsable, true],
        ["Usable addresses", r.usable, true],
      ]
    : [
        ["Network", r.network, true],
        ["Last address", r.last, true],
        ["Prefix", `/${r.prefix}`, false],
        ["Total addresses", r.total, true],
        ["As a power of two", r.totalPow, true],
      ];

const CalcPanel: React.FC = () => {
  const [input, setInput] = useState("10.0.0.0/24");
  const [aws, setAws] = useState(false);
  let result: CalcResult | null = null;
  let error: string | null = null;
  if (input.trim() !== "") {
    try {
      result = calculate(input, aws);
    } catch (e) {
      error = errMsg(e);
    }
  }
  return (
    <div className={cardClass}>
      <div className="space-y-1.5">
        <label htmlFor="cidr-in" className={labelClass}>CIDR block or address (IPv4 or IPv6)</label>
        <input id="cidr-in" type="text" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} placeholder="10.0.0.0/24 or 2001:db8::/32" className={`w-full font-mono ${inputClass}`} />
      </div>
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input type="checkbox" checked={aws} onChange={(e) => setAws(e.target.checked)} />
        AWS mode (IPv4: 5 reserved addresses per subnet, /16 to /28)
      </label>
      {error && <Alert variant="error">{error}</Alert>}
      {result?.note && <div role="status"><Alert variant="success">{result.note}</Alert></div>}
      {result && result.family === 4 && result.awsNote && <div role="status"><Alert variant="error">{result.awsNote}</Alert></div>}
      {result && (
        <Table>
          {rowsFor(result).map(([k, v, copy]) => (
            <tr key={k}>
              <th scope="row" className={`${cell} text-[13px] font-semibold text-text-secondary`}>{k}</th>
              <td className={`${cell} break-all font-mono text-[13px] text-text-primary`}>{v}</td>
              <td className={`${cell} text-right`}>{copy && <CopyButton text={v} />}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
};

const SplitPanel: React.FC = () => {
  const [input, setInput] = useState("10.0.0.0/16");
  const [mode, setMode] = useState<"prefix" | "count">("prefix");
  const [num, setNum] = useState("18");
  let result: ReturnType<typeof split> | null = null;
  let error: string | null = null;
  if (input.trim() !== "" && num.trim() !== "") {
    try {
      const n = Number(num);
      result = split(input, mode === "prefix" ? { prefix: n } : { count: n });
    } catch (e) {
      error = errMsg(e);
    }
  }
  return (
    <div className={cardClass}>
      <div className="space-y-1.5">
        <label htmlFor="split-in" className={labelClass}>Parent CIDR block</label>
        <input id="split-in" type="text" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} className={`w-full font-mono ${inputClass}`} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1.5">
          <span className={labelClass}>Split by</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as "prefix" | "count")} className={inputClass}>
            <option value="prefix">Target prefix (/x)</option>
            <option value="count">Number of subnets</option>
          </select>
        </label>
        <label className="space-y-1.5">
          <span className={labelClass}>{mode === "prefix" ? "Prefix length" : "Subnets"}</span>
          <input type="number" min={0} value={num} onChange={(e) => setNum(e.target.value)} className={`w-28 ${inputClass}`} />
        </label>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      {result?.note && <div role="status"><Alert variant="success">{result.note}</Alert></div>}
      {result && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-text-secondary" role="status">
              {result.parent} into /{result.prefix}: {result.total} subnets
              {BigInt(result.total) > BigInt(result.shown) ? ` (showing first ${result.shown} of ${result.total})` : ""}
            </p>
            <CopyButton text={result.subnets.join("\n")} label="Copy all" />
          </div>
          <Table>
            {result.subnets.map((s, i) => (
              <tr key={s}>
                <th scope="row" className={`${cell} text-[13px] font-semibold text-text-secondary`}>{i + 1}</th>
                <td className={`${cell} break-all font-mono text-[13px] text-text-primary`}>{s}</td>
                <td className={`${cell} text-right`}><CopyButton text={s} /></td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
};

const OverlapPanel: React.FC = () => {
  const [text, setText] = useState("10.0.0.0/8\n10.1.0.0/16\n192.168.0.0/24");
  const r = text.trim() === "" ? null : findOverlaps(text);
  return (
    <div className={cardClass}>
      <div className="space-y-1.5">
        <label htmlFor="ov-in" className={labelClass}>CIDR blocks, one per line</label>
        <textarea id="ov-in" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={8} className={areaClass} />
      </div>
      {r?.errors.map((e) => (
        <Alert key={e.line} variant="error">Line {e.line}: {e.message}</Alert>
      ))}
      {r && (
        <div role="status">
          {r.pairs.length === 0 ? (
            <Alert variant="success">No overlaps among {r.checked} valid blocks.</Alert>
          ) : (
            <Table>
              {r.pairs.map((p, i) => (
                <tr key={i}>
                  <td className={`${cell} break-all font-mono text-[13px] text-text-primary`}>{p.message}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}
    </div>
  );
};

const ContainsPanel: React.FC = () => {
  const [ip, setIp] = useState("10.0.0.77");
  const [cidr, setCidr] = useState("10.0.0.0/24");
  let result: ReturnType<typeof contains> | null = null;
  let error: string | null = null;
  if (ip.trim() !== "" && cidr.trim() !== "") {
    try {
      result = contains(ip, cidr);
    } catch (e) {
      error = errMsg(e);
    }
  }
  return (
    <div className={cardClass}>
      <div className="flex flex-wrap gap-3">
        <label className="min-w-[200px] flex-1 space-y-1.5">
          <span className={labelClass}>IP address</span>
          <input type="text" value={ip} onChange={(e) => setIp(e.target.value)} spellCheck={false} className={`w-full font-mono ${inputClass}`} />
        </label>
        <label className="min-w-[200px] flex-1 space-y-1.5">
          <span className={labelClass}>CIDR block</span>
          <input type="text" value={cidr} onChange={(e) => setCidr(e.target.value)} spellCheck={false} className={`w-full font-mono ${inputClass}`} />
        </label>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      {result && (
        <div role="status">
          <Alert variant={result.contains ? "success" : "error"}>
            {result.contains ? "Yes. " : "No. "}
            {result.message}
          </Alert>
        </div>
      )}
    </div>
  );
};

export default function CidrPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("calc");

  const srTitle = <h1 className="sr-only">CIDR / Subnet Calculator</h1>;

  if (!user) {
    return (
      <div className="space-y-4">
        {srTitle}
        <div className="flex flex-wrap items-center gap-4 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <LockSimple size={26} weight="regular" aria-hidden="true" className="text-accent-text" />
          <div className="min-w-[220px] flex-1">
            <div className="font-bold text-text-primary">Sign in to use the CIDR calculator</div>
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
      <SegmentedControl options={TABS} value={tab} onChange={setTab} ariaLabel="Calculator mode" />
      {tab === "calc" && <CalcPanel />}
      {tab === "split" && <SplitPanel />}
      {tab === "overlap" && <OverlapPanel />}
      {tab === "contains" && <ContainsPanel />}
    </div>
  );
}
