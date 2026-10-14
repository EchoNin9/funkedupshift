/**
 * buttonClasses(variant?, size?) -> Tailwind class string for buttons/links styled as buttons.
 *   variant: "primary" | "secondary" | "ghost"   (default "secondary")
 *   size:    "sm" | "md" | "lg"                   (default "md"; lg = 48px tall)
 * Includes focus-visible ring + 150ms motion-safe transition + disabled styles.
 * Works on <button> and <Link>. Stand-in for the prototype's .btn classes (absent from styles.css).
 */
export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0";

const base =
  "inline-flex items-center justify-center gap-2 rounded-ds-md font-semibold whitespace-nowrap select-none " +
  "motion-safe:transition-colors motion-safe:duration-150 disabled:opacity-50 disabled:cursor-not-allowed " +
  focusRing;

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-600 border border-transparent",
  secondary:
    "bg-surface-3 text-text-primary border border-border-default hover:border-border-hover hover:bg-surface-3/70",
  ghost: "bg-transparent text-text-secondary border border-transparent hover:bg-surface-3 hover:text-text-primary",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-[13px]",
  md: "min-h-10 px-4 text-sm",
  lg: "min-h-12 px-6 text-[15px]",
};

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md"): string {
  return `${base} ${variants[variant]} ${sizes[size]}`;
}
