import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import PublicTextView from "./PublicTextView";
import "./styles.css";

const rootEl = document.getElementById("root") as HTMLElement | null;

// No router in this app (see App.tsx's plain view-state machine) — a shared
// paste link (/t/<id>) is matched against the raw path before anything else
// mounts, and renders the public, unauthenticated viewer instead of App.
// The CloudFront distribution's 403/404 -> /index.html fallback (see
// infra/tools.tf aws_cloudfront_distribution.tools_site) is what makes a
// direct deep link to /t/<id> resolve to this bundle in the first place.
const textShareMatch = window.location.pathname.match(/^\/t\/([A-Za-z0-9_-]+)\/?$/);

if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(
    <React.StrictMode>
      {textShareMatch ? <PublicTextView id={textShareMatch[1]} /> : <App />}
    </React.StrictMode>
  );
}
