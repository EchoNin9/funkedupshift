/**
 * Shared Framer Motion animation presets.
 *
 * Import these instead of defining one-off variants in every page.
 * All durations use the same ease curve for a cohesive feel.
 */
import type { Variants, Transition } from "framer-motion";

/* ── Shared ease curve (smooth deceleration) ── */
export const ease = [0.22, 1, 0.36, 1] as const;

/* ── Reusable transition shorthand ── */
export const spring: Transition = { type: "spring", stiffness: 260, damping: 24 };

/* ── Fade + slide up (most common) ── */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease },
  },
};

/* ── Fade + slide up with custom index delay (for grid cards) ── */
export const fadeUpStaggered: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.04, duration: 0.35, ease },
  }),
};

/* ── Scale-in (for cards, modals) ── */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.4, ease },
  },
};

/* ── Stagger container — wrap children that use child variants ── */
export const stagger = (staggerMs = 0.06): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: staggerMs } },
});

/* ── Page-level transition (enter / exit) ── */
export const pageTransition: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2, ease } },
};

/* ── Slide-in from left or right (for alternating rows) ── */
export const slideIn = (direction: "left" | "right" = "left"): Variants => ({
  hidden: { opacity: 0, x: direction === "left" ? -30 : 30 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.5, ease },
  },
});

/* ── Viewport trigger defaults for whileInView ── */
export const viewportOnce = { once: true, margin: "-60px" as any };
