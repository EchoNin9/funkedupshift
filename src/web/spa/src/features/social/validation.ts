/**
 * Platform validation registry. Bluesky is the only platform today; Instagram
 * (and others) slot in later by adding another entry here — nothing else in
 * the composer should need to change.
 */

export interface MediaDraftFile {
  name: string;
  type: string;
  size: number;
}

export interface PlatformDraft {
  /** The resolved text that will actually be posted for this account (base or override). */
  text: string;
  media: MediaDraftFile[];
}

export interface PlatformRules {
  label: string;
  maxGraphemes: number;
  maxImages: number;
  maxImageBytes: number;
  allowedMime: string[];
  validate: (draft: PlatformDraft) => string[];
}

/**
 * Count user-perceived characters. `String.length` counts UTF-16 code units
 * and badly over-counts emoji / combined glyphs, so prefer Intl.Segmenter
 * where available and fall back to a code-point-aware split.
 */
export function countGraphemes(str: string): number {
  const IntlAny = Intl as unknown as {
    Segmenter?: new (locale: string, opts: { granularity: string }) => {
      segment: (s: string) => Iterable<unknown>;
    };
  };
  if (typeof IntlAny.Segmenter === "function") {
    const segmenter = new IntlAny.Segmenter("en", { granularity: "grapheme" });
    let count = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _ of segmenter.segment(str)) count++;
    return count;
  }
  return [...str].length;
}

function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}KB`;
  return `${n}B`;
}

export const PLATFORM_RULES: Record<string, PlatformRules> = {
  bluesky: {
    label: "Bluesky",
    maxGraphemes: 300,
    maxImages: 4,
    maxImageBytes: 1_000_000,
    allowedMime: ["image/jpeg", "image/png", "image/webp"],
    validate(draft) {
      const rules = PLATFORM_RULES.bluesky;
      const errors: string[] = [];
      const len = countGraphemes(draft.text);

      if (len === 0) errors.push("Post text can't be empty.");
      if (len > rules.maxGraphemes) {
        errors.push(`Text is ${len} characters — over the ${rules.maxGraphemes} limit.`);
      }
      if (draft.media.length > rules.maxImages) {
        errors.push(`Too many images (${draft.media.length}, max ${rules.maxImages}).`);
      }
      for (const m of draft.media) {
        if (!rules.allowedMime.includes(m.type)) {
          errors.push(`${m.name}: unsupported file type${m.type ? ` (${m.type})` : ""}.`);
        }
        if (m.size > rules.maxImageBytes) {
          errors.push(`${m.name}: ${formatBytes(m.size)} — over the ${formatBytes(rules.maxImageBytes)} limit.`);
        }
      }
      return errors;
    },
  },
};

/** Validate a resolved draft against a platform's rules. Unknown platforms fail closed. */
export function validateForPlatform(platform: string, draft: PlatformDraft): string[] {
  const rules = PLATFORM_RULES[platform];
  if (!rules) return [`Unknown platform "${platform}" — can't validate.`];
  return rules.validate(draft);
}
