import React from "react";

/** Default banner string; FUNK-11 will feed the live value from BrandingContext. */
export const DEFAULT_BANNER =
  "EXPENSES ✦ FINANCE ✦ MERCH ✦ MEDIA ✦ SQUASH ✦ DASHBOARD ✦ CATALOG";

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
