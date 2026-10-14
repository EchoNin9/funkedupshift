import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "../../components";
import { CopyButton } from "../../components/CopyButton";
import { fetchWithAuthOptional } from "../../utils/api";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as { API_BASE_URL?: string }).API_BASE_URL;
  return raw ? raw.replace(/\/$/, "") : null;
}

interface IpWhoConnection {
  asn?: number;
  org?: string;
  isp?: string;
  domain?: string;
}

interface IpWhoTimezone {
  id?: string;
  abbr?: string;
  utc?: string;
  offset?: number;
  is_dst?: boolean;
}

interface IpWhoResponse {
  success?: boolean;
  message?: string;
  ip?: string;
  type?: string;
  continent?: string;
  country?: string;
  country_code?: string;
  region?: string;
  city?: string;
  postal?: string;
  latitude?: number;
  longitude?: number;
  is_eu?: boolean;
  calling_code?: string;
  connection?: IpWhoConnection;
  timezone?: IpWhoTimezone;
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
        renderer: String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? ""),
      };
    }
    return {
      vendor: String(gl.getParameter(gl.VENDOR) ?? ""),
      renderer: String(gl.getParameter(gl.RENDERER) ?? ""),
    };
  } catch {
    return null;
  }
}

function formatKv(rows: { label: string; value: string | number | boolean | null | undefined }[]) {
  return rows.filter((r) => r.value !== undefined && r.value !== null && String(r.value).length > 0);
}

const SectionCard: React.FC<{
  title: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, className, children }) => (
  <section className={`rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-4 ${className ?? ""}`}>
    <h2 className="font-heading text-base font-semibold text-text-primary">{title}</h2>
    {subtitle && <p className="mt-0.5 text-xs text-text-secondary">{subtitle}</p>}
    <dl className="mt-3 text-sm">{children}</dl>
  </section>
);

const Row: React.FC<{ label: string; value: string | number | boolean }> = ({ label, value }) => (
  <div className="grid grid-cols-1 gap-1 border-t border-[color:var(--color-divider)] py-2 first:border-0 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,11rem)_1fr] sm:gap-3">
    <dt className="text-xs font-medium text-text-secondary sm:text-sm">{label}</dt>
    <dd className="break-words font-mono text-xs text-text-primary sm:text-sm">{String(value)}</dd>
  </div>
);

const MyInfoPage: React.FC = () => {
  const [ipData, setIpData] = useState<IpWhoResponse | null>(null);
  const [ipError, setIpError] = useState<string | null>(null);
  const [ipLoading, setIpLoading] = useState(true);
  const [hints, setHints] = useState<HighEntropyHints | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIpLoading(true);
      setIpError(null);
      const apiBase = getApiBaseUrl();
      if (!apiBase) {
        if (!cancelled) {
          setIpError("API URL not set.");
          setIpData(null);
          setIpLoading(false);
        }
        return;
      }
      try {
        const resp = await fetchWithAuthOptional(`${apiBase}/visitor-network-info`);
        const json = (await resp.json().catch(() => ({}))) as IpWhoResponse & { error?: string };
        if (cancelled) return;
        if (!resp.ok) {
          setIpError(json.message || json.error || `HTTP ${resp.status}`);
          setIpData(null);
          return;
        }
        if (!json.success) {
          setIpError(json.message || "Could not load network location.");
          setIpData(null);
        } else {
          setIpData(json);
        }
      } catch {
        if (!cancelled) {
          setIpError("Network lookup failed.");
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
      .getHighEntropyValues([
        "architecture",
        "bitness",
        "model",
        "platformVersion",
        "fullVersionList",
        "wow64",
      ])
      .then(setHints)
      .catch(() => setHints(null));
  }, []);

  const browserBlock = useMemo(() => {
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
        navigator.doNotTrack != null && navigator.doNotTrack !== ""
          ? String(navigator.doNotTrack)
          : "unspecified",
      hardwareConcurrency: navigator.hardwareConcurrency ?? "—",
      deviceMemory:
        "deviceMemory" in navigator && typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === "number"
          ? String((navigator as Navigator & { deviceMemory: number }).deviceMemory)
          : "—",
      maxTouchPoints: String(navigator.maxTouchPoints ?? 0),
      pdfViewerEnabled:
        "pdfViewerEnabled" in navigator
          ? String((navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled)
          : "—",
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
      wow64: hints?.wow64 != null ? String(hints.wow64) : "—",
    };
  }, [hints]);

  const screenBlock = useMemo(
    () => ({
      screen: `${screen.width} × ${screen.height}`,
      available: `${screen.availWidth} × ${screen.availHeight}`,
      colorDepth: String(screen.colorDepth),
      pixelDepth: String(screen.pixelDepth),
      devicePixelRatio: String(window.devicePixelRatio ?? 1),
      orientation:
        screen.orientation?.type ??
        ("orientation" in window && (window as Window & { orientation?: number }).orientation != null
          ? String((window as Window & { orientation: number }).orientation)
          : "—"),
    }),
    []
  );

  const timeBlock = useMemo(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date();
    return {
      timeZone: tz,
      local: now.toString(),
      localeString: now.toLocaleString(),
      utc: now.toUTCString(),
      offsetMinutes: String(-now.getTimezoneOffset()),
    };
  }, []);

  const copyPayload = useMemo(() => {
    return JSON.stringify(
      {
        network: ipData,
        browser: browserBlock,
        screen: screenBlock,
        time: timeBlock,
      },
      null,
      2
    );
  }, [ipData, browserBlock, screenBlock, timeBlock]);

  const networkRows = ipData
    ? formatKv([
        { label: "IP address", value: ipData.ip },
        { label: "IP type", value: ipData.type },
        { label: "Continent", value: ipData.continent },
        { label: "Country", value: ipData.country_code ? `${ipData.country} (${ipData.country_code})` : ipData.country },
        { label: "Region / state", value: ipData.region },
        { label: "City", value: ipData.city },
        { label: "Postal", value: ipData.postal },
        { label: "Coordinates", value: ipData.latitude != null && ipData.longitude != null ? `${ipData.latitude}, ${ipData.longitude}` : undefined },
        { label: "EU", value: ipData.is_eu != null ? (ipData.is_eu ? "Yes" : "No") : undefined },
        { label: "Calling code", value: ipData.calling_code ? `+${ipData.calling_code}` : undefined },
        { label: "ISP", value: ipData.connection?.isp },
        { label: "Organization", value: ipData.connection?.org },
        { label: "ASN", value: ipData.connection?.asn },
        { label: "Network domain", value: ipData.connection?.domain },
        { label: "Time zone (geo)", value: ipData.timezone?.id },
        { label: "UTC offset (geo)", value: ipData.timezone?.utc },
        { label: "TZ abbreviation", value: ipData.timezone?.abbr },
        { label: "DST (geo)", value: ipData.timezone?.is_dst != null ? (ipData.timezone.is_dst ? "Yes" : "No") : undefined },
      ])
    : [];

  return (
    <div className="space-y-4">
      <h1 className="sr-only">My info</h1>
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-[220px] flex-1 text-sm text-text-secondary">
          What this browser and connection reveal to the sites you visit.
        </p>
        <CopyButton text={copyPayload} label="Copy all as JSON" size="md" />
      </div>

      {ipError && <Alert variant="error">{ipError}</Alert>}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="h-full">
          <SectionCard
            title="Network & location"
            subtitle="Public IP and geo (server-side lookup)"
            className="h-full"
          >
            {ipLoading && (
              <div className="space-y-2 py-1" role="status"><span className="sr-only">Loading…</span>
                <div className="h-3 w-2/3 motion-safe:animate-pulse rounded bg-surface-3" />
                <div className="h-3 w-full motion-safe:animate-pulse rounded bg-surface-3" />
                <div className="h-3 w-5/6 motion-safe:animate-pulse rounded bg-surface-3" />
              </div>
            )}
            {!ipLoading && networkRows.length === 0 && (
              <p className="text-xs text-text-secondary">No network data.</p>
            )}
            {!ipLoading &&
              networkRows.map((r) => (
                <Row key={r.label} label={r.label} value={r.value as string | number | boolean} />
              ))}
          </SectionCard>
        </div>

        <div className="h-full">
          <SectionCard
            title="Browser & engine"
            subtitle="Navigator, client hints, connectivity"
            className="h-full"
          >
            {formatKv([
              { label: "User-Agent", value: browserBlock.userAgent },
              { label: "Client hint brands", value: browserBlock.brands },
              { label: "Platform", value: browserBlock.platform },
              { label: "Platform version", value: browserBlock.platformVersion },
              { label: "Mobile", value: browserBlock.mobile },
              { label: "Architecture", value: browserBlock.architecture },
              { label: "Bitness", value: browserBlock.bitness },
              { label: "Model", value: browserBlock.model },
              { label: "WoW64", value: browserBlock.wow64 },
              { label: "Vendor", value: browserBlock.vendor },
              { label: "Languages", value: browserBlock.languages },
              { label: "Cookies enabled", value: browserBlock.cookiesEnabled },
              { label: "Do Not Track", value: browserBlock.doNotTrack },
              { label: "On-line", value: browserBlock.onLine },
              { label: "PDF viewer", value: browserBlock.pdfViewerEnabled },
              { label: "Network type", value: browserBlock.effectiveType },
              { label: "Downlink (Mb/s est.)", value: browserBlock.downlinkMbps },
              { label: "RTT (ms est.)", value: browserBlock.rttMs },
              { label: "Save-Data", value: browserBlock.saveData },
              { label: "WebGL vendor", value: browserBlock.webglVendor },
              { label: "WebGL renderer", value: browserBlock.webglRenderer },
            ]).map((r) => (
              <Row key={r.label} label={r.label} value={r.value as string | number | boolean} />
            ))}
          </SectionCard>
        </div>

        <div className="h-full">
          <SectionCard title="Screen & display" className="h-full">
            {formatKv([
              { label: "Screen (CSS px)", value: screenBlock.screen },
              { label: "Available viewport", value: screenBlock.available },
              { label: "Color depth", value: screenBlock.colorDepth },
              { label: "Pixel depth", value: screenBlock.pixelDepth },
              { label: "Device pixel ratio", value: screenBlock.devicePixelRatio },
              { label: "Orientation", value: screenBlock.orientation },
            ]).map((r) => (
              <Row key={r.label} label={r.label} value={r.value as string | number | boolean} />
            ))}
          </SectionCard>
        </div>

        <div className="h-full">
          <SectionCard title="Device & input" className="h-full">
            {formatKv([
              { label: "Logical CPU cores", value: browserBlock.hardwareConcurrency },
              { label: "Device memory (GB est.)", value: browserBlock.deviceMemory },
              { label: "Max touch points", value: browserBlock.maxTouchPoints },
            ]).map((r) => (
              <Row key={r.label} label={r.label} value={r.value as string | number | boolean} />
            ))}
          </SectionCard>
        </div>

        <div className="md:col-span-2">
          <SectionCard title="Date & time" subtitle="From this device clock">
            {formatKv([
              { label: "IANA time zone", value: timeBlock.timeZone },
              { label: "UTC offset (minutes)", value: timeBlock.offsetMinutes },
              { label: "Locale string", value: timeBlock.localeString },
              { label: "Local (full)", value: timeBlock.local },
              { label: "UTC string", value: timeBlock.utc },
            ]).map((r) => (
              <Row key={r.label} label={r.label} value={r.value as string | number | boolean} />
            ))}
          </SectionCard>
        </div>
      </div>
    </div>
  );
};

export default MyInfoPage;
