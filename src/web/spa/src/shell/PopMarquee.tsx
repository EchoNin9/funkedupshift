import React from "react";

/** Default marquee string (client fallback). Keep in sync with the API's
 *  DEFAULT_BANNER_TEXT in src/lambda/api/handler.py. */
export const DEFAULT_BANNER =
  "WELCOME TO FUNKED UP SHIFT ✦ FRESH DROPS DAILY ✦ RATE ✦ CURATE ✦ VIBE";

/** Full-bleed neon marquee. Items split on ✦ and duplicated for a seamless -50% loop. (FUNK-3) */
export function PopMarquee({ text }: { text?: string }) {
  const items = (text || DEFAULT_BANNER)
    .split("✦")
    .map((s) => s.trim())
    .filter(Boolean);
  const seq = [...items, ...items];
  return (
    <div className="pop-marquee" role="presentation">
      <div className="pop-marquee__track" aria-hidden="true">
        {seq.map((it, i) => (
          <span key={i} className="pop-marquee__item">
            {it} ✦
          </span>
        ))}
      </div>
    </div>
  );
}

export default PopMarquee;
