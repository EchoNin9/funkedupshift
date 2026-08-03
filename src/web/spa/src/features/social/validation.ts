/**
 * Platform validation registry. Bluesky is the only platform today; Instagram
 * (and others) slot in later by adding another entry here — nothing else in
 * the composer should need to change.
 */

export interface MediaDraftFile {
  name: string;
  type: string;
  size: number;
  /** Pixel dimensions, when known (images only). Undefined when unread/unreadable/video — aspect-ratio checks must skip rather than fail in that case. */
  width?: number;
  height?: number;
}

export interface PlatformDraft {
  /** The resolved text that will actually be posted for this account (base or override). */
  text: string;
  media: MediaDraftFile[];
}

export interface PlatformRules {
  label: string;
  maxGraphemes: number;
  /** Max media items (Instagram's carousel limit covers mixed image/video). */
  maxImages: number;
  maxImageBytes: number;
  allowedMime: string[];
  validate: (draft: PlatformDraft) => string[];
  /** At least one media item is required (Instagram can't publish text-only). */
  requiresMedia?: boolean;
  maxHashtags?: number;
  maxMentions?: number;
  /** Inclusive aspect-ratio (width / height) bounds for image media. */
  minAspectRatio?: number;
  maxAspectRatio?: number;
  /** Byte limit for video media, distinct from maxImageBytes. */
  maxVideoBytes?: number;
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
  instagram: {
    label: "Instagram",
    maxGraphemes: 2200,
    maxImages: 10,
    maxImageBytes: 8_000_000,
    maxVideoBytes: 300_000_000,
    allowedMime: ["image/jpeg", "video/mp4"],
    requiresMedia: true,
    maxHashtags: 30,
    maxMentions: 20,
    minAspectRatio: 0.8,
    maxAspectRatio: 1.91,
    validate(draft) {
      const rules = PLATFORM_RULES.instagram;
      const errors: string[] = [];
      const len = countGraphemes(draft.text);

      if (len > rules.maxGraphemes) {
        errors.push(`Text is ${len} characters — over the ${rules.maxGraphemes} limit.`);
      }

      const hashtags = draft.text.match(/#[^\s#@]+/g) ?? [];
      if (rules.maxHashtags != null && hashtags.length > rules.maxHashtags) {
        errors.push(`Too many hashtags (${hashtags.length}, max ${rules.maxHashtags}).`);
      }

      const mentions = draft.text.match(/@[^\s#@]+/g) ?? [];
      if (rules.maxMentions != null && mentions.length > rules.maxMentions) {
        errors.push(`Too many @ mentions (${mentions.length}, max ${rules.maxMentions}).`);
      }

      if (rules.requiresMedia && draft.media.length === 0) {
        errors.push("Instagram requires at least one photo or video — text-only posts aren't supported.");
      }

      if (draft.media.length > rules.maxImages) {
        errors.push(`Too many media items (${draft.media.length}, max ${rules.maxImages}).`);
      }

      for (const m of draft.media) {
        const isVideo = m.type.startsWith("video/");

        if (!rules.allowedMime.includes(m.type)) {
          errors.push(
            `${m.name}: unsupported file type${m.type ? ` (${m.type})` : ""} — Instagram needs JPEG images or MP4 video.`
          );
          continue;
        }

        if (isVideo) {
          if (rules.maxVideoBytes != null && m.size > rules.maxVideoBytes) {
            errors.push(`${m.name}: ${formatBytes(m.size)} — over the ${formatBytes(rules.maxVideoBytes)} video limit.`);
          }
        } else {
          if (m.size > rules.maxImageBytes) {
            errors.push(`${m.name}: ${formatBytes(m.size)} — over the ${formatBytes(rules.maxImageBytes)} limit.`);
          }
          if (
            rules.minAspectRatio != null &&
            rules.maxAspectRatio != null &&
            m.width &&
            m.height
          ) {
            const ratio = m.width / m.height;
            if (ratio < rules.minAspectRatio || ratio > rules.maxAspectRatio) {
              errors.push(
                `${m.name}: aspect ratio ${ratio.toFixed(2)}:1 is outside Instagram's 4:5–1.91:1 range.`
              );
            }
          }
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
