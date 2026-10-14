/**
 * buttonClasses(variant?, size?) -> class string for buttons/links styled as buttons.
 *   variant: "primary" | "secondary" | "ghost"   (default "secondary")
 *   size:    "sm" | "md" | "lg"                   (default "md")
 * Thin wrapper over the design-system .btn classes in styles.css. Works on <button> and <Link>.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

/** Ring-style focus indicator for custom (non-.btn) interactive elements. */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0";

const sizes: Record<ButtonSize, string> = { sm: " btn-sm", md: "", lg: " btn-lg" };

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md"): string {
  return `btn btn-${variant}${sizes[size]}`;
}
