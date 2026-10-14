import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "framer-motion";
import { BrowserRouter } from "react-router-dom";
import AppLayout from "./shell/AppLayout";
import { PlatformProvider } from "./shell/PlatformContext";
import { ImpersonationProvider } from "./shell/ImpersonationContext";
import { AuthProvider } from "./shell/AuthContext";
import { BrandingProvider } from "./shell/BrandingContext";
import { ThemeProvider } from "./shell/ThemeProvider";
import { initTheme } from "./shell/theme";
import "./styles.css";

// Apply the cached theme + mode before first paint (no flash of the wrong theme).
initTheme();

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
              <ThemeProvider>
                <BrandingProvider>
                  <AppLayout />
                </BrandingProvider>
              </ThemeProvider>
            </AuthProvider>
          </ImpersonationProvider>
        </PlatformProvider>
      </BrowserRouter>
      </MotionConfig>
    </React.StrictMode>
  );
}

