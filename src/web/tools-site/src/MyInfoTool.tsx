import React, { useEffect, useMemo, useState } from "react";
import { IpWhoResponse, fetchVisitorNetworkInfo } from "./api";

// Ported from src/web/spa/src/features/myinfo/MyInfoPage.tsx — this app
// deliberately does not import from src/web/spa (see the note atop api.ts),
// so the client-side detection logic is carried in both places. Styled to
// match this app's house tool components (DnsTool.tsx etc) rather than the
// SPA's card/motion look.

interface Props {
  onBack: () => void;
}

interface HighEntropyHints {
  architecture?: string;
  bitness?: string;
  model?: string;
  platformVersion?: string;
  fullVersionList?: { brand: string; version: string }[];
  wow64?: boolean;
}

/** Client Hints / Network Information — not in all TS lib.dom versions. */
type NavigatorExtras = Navigator & {
  userAgentData?: {
    brands?: { brand: string; version: string }[];
    mobile?: boolean;
    platform?: string;
    getHighEntropyValues?: (keys: string[]) => Promise<HighEntropyHints>;
  };
  connection?: {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  };
};

function readWebGl(): { vendor: string; renderer: string } | null {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return null;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (dbg) {
      return {
        vendor: String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) ?? ""),
        renderer: String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? "")
      };
    }
    return {
      vendor: String(gl.getParameter(gl.VENDOR) ?? ""),
      renderer: String(gl.getParameter(gl.RENDERER) ?? "")
    };
  } catch {
    return null;
  }
}

interface KvRow {
  label: string;
  value: string | number | boolean | null | undefined;
}

function kvRows(rows: KvRow[]): { label: string; value: string }[] {
  return rows
    .filter((r) => r.value !== undefined && r.value !== null && String(r.value).length > 0)
    .map((r) => ({ label: r.label, value: String(r.value) }));
}

const KvTable: React.FC<{ rows: { label: string; value: string }[] }> = ({ rows }) => {
  if (rows.length === 0) return <p className="muted dns-status-line">No data.</p>;
  return (
    <table className="dns-table">
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td>{r.label}</td>
            <td className="dns-value">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const MyInfoTool: React.FC<Props> = ({ onBack }) => {
  const [ipData, setIpData] = useState<IpWhoResponse | null>(null);
  const [ipError, setIpError] = useState<string | null>(null);
  const [ipLoading, setIpLoading] = useState(true);
  const [hints, setHints] = useState<HighEntropyHints | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIpLoading(true);
      setIpError(null);
      try {
        const json = await fetchVisitorNetworkInfo();
        if (cancelled) return;
        if (!json.success) {
          setIpError(json.message || "Could not load network location.");
          setIpData(null);
        } else {
          setIpData(json);
        }
      } catch (err) {
        if (!cancelled) {
          setIpError(err instanceof Error ? err.message : "Network lookup failed.");
          setIpData(null);
        }
      } finally {
        if (!cancelled) setIpLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nav = navigator as NavigatorExtras;
    const ua = nav.userAgentData;
    if (!ua?.getHighEntropyValues) return;
    ua
      .getHighEntropyValues(["architecture", "bitness", "model", "platformVersion", "fullVersionList", "wow64"])
      .then(setHints)
      .catch(() => setHints(null));
  }, []);

  const networkRows = useMemo(
    () =>
      kvRows([
        { label: "IP address", value: ipData?.ip },
        { label: "IP type", value: ipData?.type },
        { label: "Continent", value: ipData?.continent },
        {
          label: "Country",
          value: ipData?.country_code ? `${ipData.country} (${ipData.country_code})` : ipData?.country
        },
        { label: "Region / state", value: ipData?.region },
        { label: "City", value: ipData?.city },
        { label: "Postal", value: ipData?.postal },
        {
          label: "Coordinates",
          value:
            ipData?.latitude != null && ipData?.longitude != null
              ? `${ipData.latitude}, ${ipData.longitude}`
              : undefined
        },
        { label: "EU", value: ipData?.is_eu != null ? (ipData.is_eu ? "Yes" : "No") : undefined },
        { label: "Calling code", value: ipData?.calling_code ? `+${ipData.calling_code}` : undefined },
        { label: "ISP", value: ipData?.connection?.isp },
        { label: "Organization", value: ipData?.connection?.org },
        { label: "ASN", value: ipData?.connection?.asn },
        { label: "Network domain", value: ipData?.connection?.domain },
        { label: "Time zone (geo)", value: ipData?.timezone?.id },
        { label: "UTC offset (geo)", value: ipData?.timezone?.utc },
        { label: "TZ abbreviation", value: ipData?.timezone?.abbr },
        {
          label: "DST (geo)",
          value: ipData?.timezone?.is_dst != null ? (ipData.timezone.is_dst ? "Yes" : "No") : undefined
        }
      ]),
    [ipData]
  );

  const browserData = useMemo(() => {
    const nav = navigator as NavigatorExtras;
    const uaData = nav.userAgentData;
    const brands =
      hints?.fullVersionList?.map((b) => `${b.brand} ${b.version}`).join(", ") ||
      uaData?.brands?.map((b) => `${b.brand} ${b.version}`).join(", ") ||
      "";
    const conn = nav.connection;
    const webgl = readWebGl();
    return {
      userAgent: navigator.userAgent,
      brands: brands || "—",
      platform: uaData?.platform ?? navigator.platform ?? "—",
      mobile: String(uaData?.mobile ?? /Mobi|Android/i.test(navigator.userAgent)),
      languages: navigator.languages?.join(", ") || navigator.language,
      cookiesEnabled: String(navigator.cookieEnabled),
      doNotTrack:
        navigator.doNotTrack != null && navigator.doNotTrack !== "" ? String(navigator.doNotTrack) : "unspecified",
      hardwareConcurrency: navigator.hardwareConcurrency ?? "—",
      deviceMemory:
        "deviceMemory" in navigator && typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === "number"
          ? String((navigator as Navigator & { deviceMemory: number }).deviceMemory)
          : "—",
      maxTouchPoints: String(navigator.maxTouchPoints ?? 0),
      vendor: navigator.vendor || "—",
      onLine: String(navigator.onLine),
      effectiveType: conn?.effectiveType ?? "—",
      downlinkMbps: conn?.downlink != null ? `${conn.downlink}` : "—",
      rttMs: conn?.rtt != null ? `${conn.rtt}` : "—",
      saveData: conn?.saveData != null ? String(conn.saveData) : "—",
      webglVendor: webgl?.vendor ?? "—",
      webglRenderer: webgl?.renderer ?? "—",
      architecture: hints?.architecture ?? "—",
      bitness: hints?.bitness ?? "—",
      model: hints?.model ?? "—",
      platformVersion: hints?.platformVersion ?? "—",
      wow64: hints?.wow64 != null ? String(hints.wow64) : "—"
    };
  }, [hints]);

  const browserRows = useMemo(
    () =>
      kvRows([
        { label: "User-Agent", value: browserData.userAgent },
        { label: "Client hint brands", value: browserData.brands },
        { label: "Platform", value: browserData.platform },
        { label: "Platform version", value: browserData.platformVersion },
        { label: "Mobile", value: browserData.mobile },
        { label: "Architecture", value: browserData.architecture },
        { label: "Bitness", value: browserData.bitness },
        { label: "Model", value: browserData.model },
        { label: "WoW64", value: browserData.wow64 },
        { label: "Vendor", value: browserData.vendor },
        { label: "Languages", value: browserData.languages },
        { label: "Cookies enabled", value: browserData.cookiesEnabled },
        { label: "Do Not Track", value: browserData.doNotTrack },
        { label: "On-line", value: browserData.onLine },
        { label: "Network type", value: browserData.effectiveType },
        { label: "Downlink (Mb/s est.)", value: browserData.downlinkMbps },
        { label: "RTT (ms est.)", value: browserData.rttMs },
        { label: "Save-Data", value: browserData.saveData },
        { label: "WebGL vendor", value: browserData.webglVendor },
        { label: "WebGL renderer", value: browserData.webglRenderer }
      ]),
    [browserData]
  );

  const deviceRows = useMemo(
    () =>
      kvRows([
        { label: "Logical CPU cores", value: browserData.hardwareConcurrency },
        { label: "Device memory (GB est.)", value: browserData.deviceMemory },
        { label: "Max touch points", value: browserData.maxTouchPoints }
      ]),
    [browserData]
  );

  const screenRows = useMemo(
    () =>
      kvRows([
        { label: "Screen (CSS px)", value: `${screen.width} × ${screen.height}` },
        { label: "Available viewport", value: `${screen.availWidth} × ${screen.availHeight}` },
        { label: "Color depth", value: screen.colorDepth },
        { label: "Pixel depth", value: screen.pixelDepth },
        { label: "Device pixel ratio", value: window.devicePixelRatio ?? 1 },
        { label: "Orientation", value: screen.orientation?.type }
      ]),
    []
  );

  const timeData = useMemo(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date();
    return {
      timeZone: tz,
      offsetMinutes: -now.getTimezoneOffset(),
      localeString: now.toLocaleString(),
      local: now.toString(),
      utc: now.toUTCString()
    };
  }, []);

  const timeRows = useMemo(
    () =>
      kvRows([
        { label: "IANA time zone", value: timeData.timeZone },
        { label: "UTC offset (minutes)", value: timeData.offsetMinutes },
        { label: "Locale string", value: timeData.localeString },
        { label: "Local (full)", value: timeData.local },
        { label: "UTC string", value: timeData.utc }
      ]),
    [timeData]
  );

  const copyPayload = useMemo(
    () =>
      JSON.stringify(
        {
          network: ipData,
          browser: browserData,
          screen: screenRows,
          time: timeData
        },
        null,
        2
      ),
    [ipData, browserData, screenRows, timeData]
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyPayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard permission denied — the tables are still visible on-screen
    }
  };

  return (
    <section className="tool-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="tool-heading">My Info</h1>
      <p className="muted local-notice">
        Everything below except network &amp; location is read straight from your browser — nothing is stored.
      </p>

      <button type="button" className="btn btn-ghost" onClick={handleCopy}>
        {copied ? "Copied!" : "Copy all as JSON"}
      </button>

      <div className="dns-results">
        <div className="dns-section">
          <h2 className="dns-section-heading">Network &amp; location</h2>
          {ipLoading && <p className="muted">Looking up…</p>}
          {!ipLoading && ipError && <div className="banner banner-error">{ipError}</div>}
          {!ipLoading && !ipError && <KvTable rows={networkRows} />}
        </div>

        <div className="dns-section">
          <h2 className="dns-section-heading">Browser &amp; engine</h2>
          <KvTable rows={browserRows} />
        </div>

        <div className="dns-section">
          <h2 className="dns-section-heading">Screen &amp; display</h2>
          <KvTable rows={screenRows} />
        </div>

        <div className="dns-section">
          <h2 className="dns-section-heading">Device &amp; input</h2>
          <KvTable rows={deviceRows} />
        </div>

        <div className="dns-section">
          <h2 className="dns-section-heading">Date &amp; time</h2>
          <KvTable rows={timeRows} />
        </div>
      </div>
    </section>
  );
};

export default MyInfoTool;
