import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "framer-motion";
import { BrowserRouter } from "react-router-dom";
import AppLayout from "./shell/AppLayout";
import { PlatformProvider } from "./shell/PlatformContext";
import { ImpersonationProvider } from "./shell/ImpersonationContext";
import { AuthProvider } from "./shell/AuthContext";
import { BrandingProvider } from "./shell/BrandingContext";
import { applyTheme, getTheme } from "./shell/theme";
import "./styles.css";

// Apply persisted Neon Pop theme before first paint (default dark).
applyTheme(getTheme());

const rootEl = document.getElementById("root") as HTMLElement | null;

if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(
    <React.StrictMode>
      <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <PlatformProvider>
          <ImpersonationProvider>
            <AuthProvider>
              <BrandingProvider>
                <AppLayout />
              </BrandingProvider>
            </AuthProvider>
          </ImpersonationProvider>
        </PlatformProvider>
      </BrowserRouter>
      </MotionConfig>
    </React.StrictMode>
  );
}

