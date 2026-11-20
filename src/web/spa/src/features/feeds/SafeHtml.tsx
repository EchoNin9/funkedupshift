import React, { useEffect, useRef } from "react";
import { safeSetHTML } from "./sanitizeHtml";

export interface SafeHtmlProps {
  html: string;
  className?: string;
}

/**
 * Renders untrusted pre-sanitized HTML using Element.setHTML when available,
 * falling back to DOMPurify. The container div stays mounted across renders
 * so async fallback sanitizer resolution always writes to a live DOM node.
 */
export const SafeHtml: React.FC<SafeHtmlProps> = ({ html, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ac = new AbortController();

    void safeSetHTML(el, html, ac.signal).catch(() => {
      if (!ac.signal.aborted && containerRef.current) {
        containerRef.current.textContent = "";
      }
    });

    return () => {
      ac.abort();
    };
  }, [html]);

  return <div ref={containerRef} className={className} />;
};

export default SafeHtml;
