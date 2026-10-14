import React, { useState } from "react";
import { useLocation } from "react-router-dom";
import { MegaphoneSimple, X } from "@phosphor-icons/react";
import { useAuth } from "./AuthContext";
import { useBranding } from "./BrandingContext";
import { DEFAULT_BANNER } from "./PopMarquee";

const DISMISS_KEY = "funkedupshift_banner_dismissed";

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Home-page-only scrolling updates strip (README 1b). Signed-in users can hide it until their next session. */
export function UpdatesBanner() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { bannerText } = useBranding();
  const [dismissed, setDismissed] = useState(readDismissed);

  const signedIn = !!user && user.role !== "guest";
  if (pathname !== "/" || (signedIn && dismissed)) return null;

  const items = (bannerText || DEFAULT_BANNER)
    .split("✦")
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) return null;
  const seq = [...items, ...items];

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div
      className="flex h-10 items-center gap-3 border-b px-5"
      style={{
        background: "color-mix(in srgb, rgb(var(--color-accent)) 14%, rgb(var(--color-surface-0)))",
        borderColor: "var(--color-divider)",
      }}
      role="region"
      aria-label="Site updates"
    >
      <span className="tag tag-accent shrink-0">
        <MegaphoneSimple size={14} weight="fill" aria-hidden="true" />
        Updates
      </span>
      <div className="marquee min-w-0 flex-1 text-sm text-text-primary">
        <div className="marquee-track">
          {seq.map((it, i) => (
            <span key={i} className="whitespace-nowrap pr-6" aria-hidden={i >= items.length ? "true" : undefined}>
              {it} <span className="pl-6 text-accent-text">✦</span>
            </span>
          ))}
        </div>
      </div>
      {signedIn && (
        <button
          type="button"
          onClick={dismiss}
          title="Hide until your next visit"
          aria-label="Hide updates until your next visit"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-surface-2 hover:text-text-primary"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

export default UpdatesBanner;
