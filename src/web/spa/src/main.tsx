import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import AppLayout from "./shell/AppLayout";
import { ImpersonationProvider } from "./shell/ImpersonationContext";
import { AuthProvider } from "./shell/AuthContext";
import { BrandingProvider } from "./shell/BrandingContext";
import "./styles.css";

const rootEl = document.getElementById("root") as HTMLElement | null;

if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <ImpersonationProvider>
          <AuthProvider>
            <BrandingProvider>
              <AppLayout />
            </BrandingProvider>
          </AuthProvider>
        </ImpersonationProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
}

