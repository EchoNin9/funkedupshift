import React, { useCallback, useEffect, useState } from "react";
import AuthView from "./AuthView";
import ShortenerTool from "./ShortenerTool";
import PasswordTool from "./PasswordTool";
import ImageToolsTool from "./ImageToolsTool";
import DnsTool from "./DnsTool";
import TextShareTool from "./TextShareTool";
import ConvertersTool from "./ConvertersTool";
import MyInfoTool from "./MyInfoTool";

type View =
  | "landing"
  | "tool:shortener"
  | "tool:password"
  | "tool:imagetools"
  | "tool:dns"
  | "tool:pastebin"
  | "tool:converters"
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
  { id: "qr", name: "QR Codes", description: "Generate a QR code for any link or block of text.", available: false },
  { id: "pastebin", name: "Text Share", description: "Share text snippets with a link that expires.", available: true },
  { id: "imagetools", name: "Image Tools", description: "Resize, crop, remove backgrounds.", available: true },
  { id: "dns", name: "DNS Lookup", description: "Look up A, MX, TXT and other DNS records for any domain.", available: true },
  { id: "converters", name: "Converters", description: "Temperature, units, date math, and timezones, right in your browser.", available: true },
  { id: "myinfo", name: "My Info", description: "See what your browser, device, and network reveal about you.", available: true }
];

const App: React.FC = () => {
  const [view, setView] = useState<View>("landing");
  const [auth, setAuth] = useState<AuthState>({ checked: false, signedIn: false, email: null });
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

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

  const goLanding = () => setView("landing");

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
          <ShortenerTool onBack={goLanding} onAuthError={handleAuthError} />
        )}

        {view === "tool:password" && auth.signedIn && <PasswordTool onBack={goLanding} />}

        {view === "tool:imagetools" && auth.signedIn && <ImageToolsTool onBack={goLanding} />}

        {view === "tool:dns" && auth.signedIn && (
          <DnsTool onBack={goLanding} onAuthError={handleAuthError} />
        )}

        {view === "tool:pastebin" && auth.signedIn && (
          <TextShareTool onBack={goLanding} onAuthError={handleAuthError} />
        )}

        {view === "tool:converters" && auth.signedIn && <ConvertersTool onBack={goLanding} />}

        {/* Unlocked while signed out — public backend endpoint + client-side reads only. */}
        {view === "tool:myinfo" && <MyInfoTool onBack={goLanding} />}
      </main>
    </div>
  );
};

export default App;
