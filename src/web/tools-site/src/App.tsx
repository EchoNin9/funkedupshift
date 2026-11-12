import React, { useCallback, useEffect, useState } from "react";
import AuthView from "./AuthView";
import ShortenerTool from "./ShortenerTool";
import PasswordTool from "./PasswordTool";
import QrTool, { QrLink } from "./QrTool";
import ImageToolsTool from "./ImageToolsTool";
import DnsTool from "./DnsTool";
import EmailAuthTool from "./EmailAuthTool";
import SslTool from "./SslTool";
import HttpTraceTool from "./HttpTraceTool";
import TextShareTool from "./TextShareTool";
import ConvertersTool from "./ConvertersTool";
import EncodeTool from "./EncodeTool";
import HashTool from "./HashTool";
import CidrTool from "./CidrTool";
import CronTool from "./CronTool";
import JsonTool from "./JsonTool";
import MyInfoTool from "./MyInfoTool";

type View =
  | "landing"
  | "tool:shortener"
  | "tool:password"
  | "tool:qr"
  | "tool:imagetools"
  | "tool:dns"
  | "tool:pastebin"
  | "tool:converters"
  | "tool:encode"
  | "tool:hash"
  | "tool:cidr"
  | "tool:cron"
  | "tool:json"
  | "tool:emailauth"
  | "tool:ssl"
  | "tool:httptrace"
  | "tool:myinfo"
  | "auth";

/** Tools open even when signed out — currently just My Info, which calls a
 * public backend endpoint and reads the rest client-side. Every other tool
 * stays locked until sign-in. */
const ALWAYS_UNLOCKED_TOOL_IDS = new Set(["myinfo"]);

interface AuthState {
  checked: boolean;
  signedIn: boolean;
  email: string | null;
}

interface ToolDef {
  id: string;
  name: string;
  description: string;
  available: boolean;
}

const TOOLS: ToolDef[] = [
  { id: "shortener", name: "URL Shortener", description: "Mint short links and manage the ones you've made.", available: true },
  { id: "password", name: "Password Generator", description: "Generate strong passwords, right in your browser.", available: true },
  { id: "qr", name: "QR Codes", description: "Generate a QR code for any link or block of text.", available: true },
  { id: "pastebin", name: "Text Share", description: "Share text snippets with a link that expires.", available: true },
  { id: "imagetools", name: "Image Tools", description: "Resize, crop, remove backgrounds.", available: true },
  { id: "dns", name: "DNS Lookup", description: "Look up A, MX, TXT and other DNS records for any domain.", available: true },
  { id: "converters", name: "Converters", description: "Temperature, units, date math, and timezones, right in your browser.", available: true },
  { id: "encode", name: "Encode / Decode", description: "Decode JWTs and encode or decode Base64 and URL text, right in your browser.", available: true },
  { id: "hash", name: "Hash & UUID", description: "Hash text or files, check a download's checksum, and generate UUIDs and ULIDs, right in your browser.", available: true },
  { id: "cidr", name: "CIDR / Subnet Calculator", description: "IPv4 and IPv6 subnet math: ranges, splits, overlaps and AWS VPC sizing, right in your browser.", available: true },
  { id: "cron", name: "Cron & Timestamps", description: "Explain cron and EventBridge schedules, preview the next runs, and convert epoch timestamps, right in your browser.", available: true },
  { id: "json", name: "JSON / YAML", description: "Format, validate, convert and diff JSON and YAML, right in your browser.", available: true },
  { id: "emailauth", name: "Email Auth Checker", description: "Check a domain's SPF, DKIM and DMARC setup and get a prioritised fix list.", available: true },
  { id: "ssl", name: "SSL Certificate Checker", description: "Inspect a site's TLS certificate chain, expiry and trust.", available: true },
  { id: "httptrace", name: "HTTP Headers & Redirects", description: "Trace a URL's redirect chain and check its security and caching headers.", available: true },
  { id: "myinfo", name: "My Info", description: "See what your browser, device, and network reveal about you.", available: true }
];

const App: React.FC = () => {
  const [view, setView] = useState<View>("landing");
  const [auth, setAuth] = useState<AuthState>({ checked: false, signedIn: false, email: null });
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  // Set when the QR tool is opened from a shortener row; null for standalone use.
  const [qrLink, setQrLink] = useState<QrLink | null>(null);
  const [sslHost, setSslHost] = useState("");

  const refreshAuth = useCallback(() => {
    const w = window as any;
    if (!w.auth?.isAuthenticated) {
      setAuth({ checked: true, signedIn: false, email: null });
      return;
    }
    w.auth.isAuthenticated((signedIn: boolean) => {
      if (!signedIn) {
        setAuth({ checked: true, signedIn: false, email: null });
        return;
      }
      if (w.auth.getCurrentUserEmail) {
        w.auth.getCurrentUserEmail((email: string | null) => {
          setAuth({ checked: true, signedIn: true, email });
        });
      } else {
        setAuth({ checked: true, signedIn: true, email: null });
      }
    });
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const goLanding = () => {
    setQrLink(null);
    setSslHost("");
    setView("landing");
  };

  const handleSignOut = () => {
    const w = window as any;
    w.auth?.signOut?.();
    setAuth({ checked: true, signedIn: false, email: null });
    setSessionNotice(null);
    setView("landing");
  };

  const handleAuthSuccess = () => {
    setSessionNotice(null);
    refreshAuth();
    setView("landing");
  };

  const handleAuthError = () => {
    setAuth({ checked: true, signedIn: false, email: null });
    setSessionNotice("Your session expired — please sign in again.");
    setView("auth");
  };

  const openTool = (tool: ToolDef) => {
    const unlocked = auth.signedIn || ALWAYS_UNLOCKED_TOOL_IDS.has(tool.id);
    if (!unlocked) {
      setSessionNotice(null);
      setView("auth");
      return;
    }
    if (!tool.available) return; // coming-soon cards stay disabled even when authed
    setQrLink(null);
    setSslHost("");
    setView(`tool:${tool.id}` as View);
  };

  return (
    <div className="app">
      <header className="site-header">
        <button className="wordmark" onClick={goLanding} type="button">
          Echo9 Tools
        </button>
        <div className="header-right">
          {auth.signedIn ? (
            <>
              <span className="header-email">{auth.email ?? "Signed in"}</span>
              <button className="btn btn-ghost" onClick={handleSignOut} type="button">
                Sign out
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => setView("auth")} type="button">
              Sign in
            </button>
          )}
        </div>
      </header>

      <main className="main">
        {view === "landing" && (
          <section className="landing">
            <h1 className="landing-title">A small directory of tools.</h1>
            <p className="landing-subtitle">
              {auth.signedIn ? "Pick one to get started." : "Sign in to unlock them."}
            </p>
            <div className="tool-grid">
              {TOOLS.map((tool) => {
                const unlocked = auth.signedIn || ALWAYS_UNLOCKED_TOOL_IDS.has(tool.id);
                const locked = !unlocked;
                const clickable = unlocked && tool.available;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    className={`tool-card${locked ? " locked" : ""}${!clickable ? " disabled" : ""}`}
                    onClick={() => openTool(tool)}
                    aria-disabled={!clickable && !locked}
                  >
                    {locked && (
                      <span className="lock-badge" aria-hidden="true">
                        &#128274;
                      </span>
                    )}
                    <span className="tool-name">{tool.name}</span>
                    <span className="tool-desc">{tool.description}</span>
                    {!tool.available && <span className="soon-badge">Coming soon</span>}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {view === "auth" && (
          <AuthView notice={sessionNotice} onSuccess={handleAuthSuccess} onBack={goLanding} />
        )}

        {view === "tool:shortener" && auth.signedIn && (
          <ShortenerTool
            onBack={goLanding}
            onAuthError={handleAuthError}
            onOpenQr={(link) => {
              setQrLink(link);
              setView("tool:qr");
            }}
          />
        )}

        {view === "tool:password" && auth.signedIn && <PasswordTool onBack={goLanding} />}

        {view === "tool:qr" && auth.signedIn && (
          <QrTool
            key={qrLink?.code ?? "standalone"}
            link={qrLink}
            onBack={qrLink ? () => { setQrLink(null); setView("tool:shortener"); } : goLanding}
            onAuthError={handleAuthError}
          />
        )}

        {view === "tool:imagetools" && auth.signedIn && <ImageToolsTool onBack={goLanding} />}

        {view === "tool:dns" && auth.signedIn && (
          <DnsTool
            onBack={goLanding}
            onAuthError={handleAuthError}
            onCheckSsl={(h) => {
              setSslHost(h);
              setView("tool:ssl");
            }}
          />
        )}

        {view === "tool:pastebin" && auth.signedIn && (
          <TextShareTool onBack={goLanding} onAuthError={handleAuthError} />
        )}

        {view === "tool:converters" && auth.signedIn && <ConvertersTool onBack={goLanding} />}
        {view === "tool:encode" && auth.signedIn && <EncodeTool onBack={goLanding} />}
        {view === "tool:hash" && auth.signedIn && <HashTool onBack={goLanding} />}
        {view === "tool:cidr" && auth.signedIn && <CidrTool onBack={goLanding} />}
        {view === "tool:cron" && auth.signedIn && <CronTool onBack={goLanding} />}
        {view === "tool:json" && auth.signedIn && <JsonTool onBack={goLanding} />}
        {view === "tool:emailauth" && auth.signedIn && (
          <EmailAuthTool onBack={goLanding} onAuthError={handleAuthError} />
        )}
        {view === "tool:ssl" && auth.signedIn && (
          <SslTool key={sslHost} onBack={goLanding} onAuthError={handleAuthError} initialHost={sslHost} />
        )}
        {view === "tool:httptrace" && auth.signedIn && (
          <HttpTraceTool onBack={goLanding} onAuthError={handleAuthError} />
        )}

        {/* Unlocked while signed out — public backend endpoint + client-side reads only. */}
        {view === "tool:myinfo" && <MyInfoTool onBack={goLanding} />}
      </main>
    </div>
  );
};

export default App;
