import React, { useState } from "react";
import { calculate, contains, findOverlaps, split, type CalcResult } from "./cidr";

type Tab = "calc" | "split" | "overlap" | "contains";
const TABS: { id: Tab; label: string }[] = [
  { id: "calc", label: "Calculate" },
  { id: "split", label: "Split" },
  { id: "overlap", label: "Overlap" },
  { id: "contains", label: "Contains" },
];

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
    <div className="conv-panel">
      <div className="conv-field">
        <label htmlFor="cidr-in">CIDR block or address (IPv4 or IPv6)</label>
        <input id="cidr-in" type="text" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} placeholder="10.0.0.0/24 or 2001:db8::/32" />
      </div>
      <label className="muted">
        <input type="checkbox" checked={aws} onChange={(e) => setAws(e.target.checked)} /> AWS mode (IPv4: 5 reserved addresses per subnet, /16 to /28)
      </label>
      {error && <div className="banner banner-error">{error}</div>}
      {result?.note && <div className="banner" role="status">{result.note}</div>}
      {result && result.family === 4 && result.awsNote && <div className="banner banner-error" role="status">{result.awsNote}</div>}
      {result && (
        <Scroll>
          <table className="dns-table">
            <tbody>
              {rowsFor(result).map(([k, v, copy]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td className="dns-value">{v}</td>
                  <td>{copy && <CopyBtn value={v} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
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
    <div className="conv-panel">
      <div className="conv-field">
        <label htmlFor="split-in">Parent CIDR block</label>
        <input id="split-in" type="text" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
      </div>
      <div className="conv-row">
        <label className="conv-field">
          Split by
          <select value={mode} onChange={(e) => setMode(e.target.value as "prefix" | "count")}>
            <option value="prefix">Target prefix (/x)</option>
            <option value="count">Number of subnets</option>
          </select>
        </label>
        <label className="conv-field">
          {mode === "prefix" ? "Prefix length" : "Subnets"}
          <input type="number" min={0} value={num} onChange={(e) => setNum(e.target.value)} />
        </label>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {result?.note && <div className="banner" role="status">{result.note}</div>}
      {result && (
        <>
          <p className="muted" role="status">
            {result.parent} into /{result.prefix}: {result.total} subnets
            {BigInt(result.total) > BigInt(result.shown) ? ` (showing first ${result.shown} of ${result.total})` : ""}
          </p>
          <Scroll>
            <table className="dns-table">
              <tbody>
                {result.subnets.map((s, i) => (
                  <tr key={s}>
                    <th scope="row">{i + 1}</th>
                    <td className="dns-value">{s}</td>
                    <td><CopyBtn value={s} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
          <CopyBtn value={result.subnets.join("\n")} />
        </>
      )}
    </div>
  );
};

const OverlapPanel: React.FC = () => {
  const [text, setText] = useState("10.0.0.0/8\n10.1.0.0/16\n192.168.0.0/24");
  const r = text.trim() === "" ? null : findOverlaps(text);
  return (
    <div className="conv-panel">
      <div className="textshare-form">
        <label htmlFor="ov-in">CIDR blocks, one per line</label>
        <textarea id="ov-in" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={8} />
      </div>
      {r?.errors.map((e) => (
        <div key={e.line} className="banner banner-error">Line {e.line}: {e.message}</div>
      ))}
      {r && (
        <div role="status">
          {r.pairs.length === 0 ? (
            <div className="banner">No overlaps among {r.checked} valid blocks.</div>
          ) : (
            <Scroll>
              <table className="dns-table">
                <tbody>
                  {r.pairs.map((p, i) => (
                    <tr key={i}>
                      <td className="dns-value">{p.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroll>
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
    <div className="conv-panel">
      <div className="conv-row">
        <label className="conv-field">
          IP address
          <input type="text" value={ip} onChange={(e) => setIp(e.target.value)} spellCheck={false} />
        </label>
        <label className="conv-field">
          CIDR block
          <input type="text" value={cidr} onChange={(e) => setCidr(e.target.value)} spellCheck={false} />
        </label>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {result && (
        <div className={result.contains ? "banner" : "banner banner-error"} role="status">
          {result.contains ? "Yes. " : "No. "}
          {result.message}
        </div>
      )}
    </div>
  );
};

const CidrTool: React.FC<Props> = ({ onBack }) => {
  const [tab, setTab] = useState<Tab>("calc");
  return (
    <section className="tool-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="tool-heading">CIDR / Subnet Calculator</h1>
      <p className="muted local-notice">Everything below runs locally — nothing leaves your browser.</p>

      <div className="conv-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`conv-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "calc" && <CalcPanel />}
      {tab === "split" && <SplitPanel />}
      {tab === "overlap" && <OverlapPanel />}
      {tab === "contains" && <ContainsPanel />}
    </section>
  );
};

export default CidrTool;
