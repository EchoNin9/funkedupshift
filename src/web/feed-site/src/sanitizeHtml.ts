export const ALLOWED_HTML_ELEMENTS: string[] = [
  "p",
  "br",
  "a",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "span",
  "div",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

export const ALLOWED_HTML_ATTRS: string[] = ["href", "title", "target", "rel"];

export function isSafeHref(rawHref: string | null | undefined): boolean {
  if (!rawHref) return false;
  const trimmed = rawHref.trim().toLowerCase();
  return (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("mailto:")
  );
}

type DomPurifyLike = {
  sanitize: (dirty: string, config: Record<string, unknown>) => string;
};

let domPurifyPromise: Promise<DomPurifyLike> | null = null;

function loadDOMPurify(): Promise<DomPurifyLike> {
  if (!domPurifyPromise) {
    domPurifyPromise = import("dompurify").then((mod) => (mod.default ?? mod) as unknown as DomPurifyLike);
  }
  return domPurifyPromise;
}

export async function safeSetHTML(
  el: HTMLElement,
  rawHtml: string,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) return;
  if (!rawHtml) {
    el.textContent = "";
    return;
  }

  if (typeof Element !== "undefined" && "setHTML" in Element.prototype) {
    (el as unknown as { setHTML: (html: string, opts?: unknown) => void }).setHTML(rawHtml, {
      sanitizer: {
        elements: ALLOWED_HTML_ELEMENTS,
        attributes: ALLOWED_HTML_ATTRS,
      },
    });
  } else {
    const DOMPurify = await loadDOMPurify();
    if (signal?.aborted) return;
    el.innerHTML = DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [...ALLOWED_HTML_ELEMENTS, "#text"],
      ALLOWED_ATTR: ALLOWED_HTML_ATTRS,
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: false,
    });
  }

  if (signal?.aborted) return;
  for (const anchor of el.querySelectorAll("a")) {
    const href = anchor.getAttribute("href");
    if (!isSafeHref(href)) {
      anchor.removeAttribute("href");
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
    } else {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    }
  }
}
