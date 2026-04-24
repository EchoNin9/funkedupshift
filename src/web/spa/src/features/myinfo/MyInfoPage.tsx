import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import { Alert, fadeUpStaggered, stagger } from "../../components";

const IP_WHO_URL = "https://ipwho.is/";

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
  accent: "teal" | "slate" | "violet";
  children: React.ReactNode;
}> = ({ title, subtitle, accent, children }) => {
  const border =
    accent === "teal"
      ? "border-teal-800/60 from-teal-900/40 to-teal-950/60"
      : accent === "violet"
      ? "border-violet-800/50 from-violet-900/35 to-violet-950/55"
      : "border-border-default from-surface-2/80 to-surface-1/90";
  return (
    <div
      className={`rounded-xl border bg-gradient-to-br p-4 shadow-lg ${border}`}
    >
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-text-tertiary">{subtitle}</p>}
      <dl className="mt-3 space-y-2 text-sm">{children}</dl>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string | number | boolean }> = ({ label, value }) => (
  <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,11rem)_1fr] gap-1 sm:gap-3 border-b border-border-subtle/60 pb-2 last:border-0 last:pb-0">
    <dt className="text-text-tertiary text-xs sm:text-sm font-medium">{label}</dt>
    <dd className="text-text-primary break-words font-mono text-xs sm:text-sm">{String(value)}</dd>
  </div>
);

const MyInfoPage: React.FC = () => {
  const [ipData, setIpData] = useState<IpWhoResponse | null>(null);
  const [ipError, setIpError] = useState<string | null>(null);
  const [ipLoading, setIpLoading] = useState(true);
  const [hints, setHints] = useState<HighEntropyHints | null>(null);
  const [copyDone, setCopyDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIpLoading(true);
      setIpError(null);
      try {
        const resp = await fetch(IP_WHO_URL, { credentials: "omit" });
        const json = (await resp.json()) as IpWhoResponse;
        if (cancelled) return;
        if (!json.success) {
          setIpError(json.message || "Could not load network location.");
          setIpData(null);
        } else {
          setIpData(json);
        }
      } catch {
        if (!cancelled) {
          setIpError("Network lookup failed (offline, blocked, or ad blocker).");
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

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(copyPayload);
      setCopyDone(true);
      window.setTimeout(() => setCopyDone(false), 2000);
    } catch {
      setCopyDone(false);
    }
  }, [copyPayload]);

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <motion.h1
          className="text-2xl font-semibold tracking-tight text-text-primary"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          My info
        </motion.h1>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-hover bg-surface-2 px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface-3 transition-colors"
        >
          <ClipboardDocumentIcon className="h-4 w-4" />
          {copyDone ? "Copied" : "Copy all as JSON"}
        </button>
      </div>

      <motion.div
        className="rounded-xl border border-teal-800/60 bg-gradient-to-br from-teal-900/40 to-teal-950/60 p-4 shadow-lg"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
      >
        <p className="text-sm font-medium text-teal-100">
          Connection, location, and this browser
        </p>
        <p className="mt-1 text-xs text-teal-200/80 leading-relaxed">
          Browser and device details are read locally in your browser (similar to{" "}
          <a
            href="https://getmybrowser.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-400 hover:underline"
          >
            getmybrowser.com
          </a>
          ). Public IP and approximate location are requested over HTTPS from{" "}
          <a href={IP_WHO_URL} target="_blank" rel="noopener noreferrer" className="text-accent-400 hover:underline">
            ipwho.is
          </a>{" "}
          so we can mirror what tools like{" "}
          <a
            href="https://www.whatismyip.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-400 hover:underline"
          >
            whatismyip.com
          </a>{" "}
          show, without sending that data through our servers.
        </p>
      </motion.div>

      {ipError && <Alert variant="error">{ipError}</Alert>}

      <motion.div
        className="grid gap-3 md:grid-cols-2"
        initial="hidden"
        animate="visible"
        variants={stagger(0.05)}
      >
        <motion.div variants={fadeUpStaggered} custom={0}>
          <SectionCard
            title="Network & location"
            subtitle="From your public IP (HTTPS lookup)"
            accent="teal"
          >
            {ipLoading && (
              <div className="space-y-2 py-1">
                <div className="h-3 w-2/3 animate-pulse rounded bg-teal-900/50" />
                <div className="h-3 w-full animate-pulse rounded bg-teal-900/40" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-teal-900/40" />
              </div>
            )}
            {!ipLoading && networkRows.length === 0 && (
              <p className="text-xs text-text-tertiary">No network data.</p>
            )}
            {!ipLoading &&
              networkRows.map((r) => (
                <Row key={r.label} label={r.label} value={r.value as string | number | boolean} />
              ))}
          </SectionCard>
        </motion.div>

        <motion.div variants={fadeUpStaggered} custom={1}>
          <SectionCard title="Browser & engine" subtitle="Navigator, client hints, connectivity" accent="slate">
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
        </motion.div>

        <motion.div variants={fadeUpStaggered} custom={2}>
          <SectionCard title="Screen & display" accent="slate">
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
        </motion.div>

        <motion.div variants={fadeUpStaggered} custom={3}>
          <SectionCard title="Device & input" accent="violet">
            {formatKv([
              { label: "Logical CPU cores", value: browserBlock.hardwareConcurrency },
              { label: "Device memory (GB est.)", value: browserBlock.deviceMemory },
              { label: "Max touch points", value: browserBlock.maxTouchPoints },
            ]).map((r) => (
              <Row key={r.label} label={r.label} value={r.value as string | number | boolean} />
            ))}
          </SectionCard>
        </motion.div>

        <motion.div variants={fadeUpStaggered} custom={4} className="md:col-span-2">
          <SectionCard title="Date & time" subtitle="From this device clock" accent="slate">
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
        </motion.div>
      </motion.div>
    </div>
  );
};

export default MyInfoPage;
