import { PLATFORM_RULES } from "./validation";

/** Compact colour + label metadata for the per-platform chip indicator. */
export interface PlatformMeta {
  label: string;
  /** Tailwind background-colour class for the platform dot/badge. */
  dot: string;
  /** 2-letter uppercase code shown at chip size, e.g. "BS", "IG". */
  short: string;
}

const PLATFORM_META: Record<string, PlatformMeta> = {
  bluesky: { label: "Bluesky", dot: "bg-sky-500", short: "BS" },
  instagram: { label: "Instagram", dot: "bg-fuchsia-500", short: "IG" },
};

const FALLBACK: PlatformMeta = { label: "Unknown", dot: "bg-text-tertiary", short: "?" };

/** Metadata for a target's platform. Unknown/missing platforms fail closed to a neutral dot rather than crashing. */
export function platformMeta(platform: string | undefined | null): PlatformMeta {
  if (!platform) return FALLBACK;
  const known = PLATFORM_META[platform];
  if (known) return known;
  const label = PLATFORM_RULES[platform]?.label ?? platform;
  return { label, dot: "bg-text-tertiary", short: platform.slice(0, 2).toUpperCase() };
}
