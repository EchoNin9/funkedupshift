import React from "react";

/** Default marquee string (client fallback). Keep in sync with the API's
 *  DEFAULT_BANNER_TEXT in src/lambda/api/handler.py. */
export const DEFAULT_BANNER =
  "WELCOME TO FUNKED UP SHIFT ✦ FRESH DROPS DAILY ✦ RATE ✦ CURATE ✦ VIBE";

/** Scrolling text strip. Items split on ✦ and duplicated for a seamless -50% loop.
 *  Pauses on hover; the animation is disabled under prefers-reduced-motion (styles.css). */
export function Marquee({ text, className = "" }: { text?: string; className?: string }) {
  const items = (text || DEFAULT_BANNER)
    .split("✦")
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) return null;
  const seq = [...items, ...items];
  return (
    <div className={`marquee min-w-0 text-sm text-text-primary ${className}`} role="presentation">
      <div className="marquee-track">
        {seq.map((it, i) => (
          <span key={i} className="whitespace-nowrap pr-6" aria-hidden={i >= items.length ? "true" : undefined}>
            {it} <span className="pl-6 text-accent-text">✦</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default Marquee;
