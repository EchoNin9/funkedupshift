import { useEffect, useState } from "react";

const QUERY = "(max-width: 640px)";

/** True at ≤640px — the same breakpoint styles.css uses for `.only-narrow` and the sheet rules. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/**
 * While `active`, tracks the visual viewport so a bottom sheet can sit above the soft keyboard.
 * Returns the gap between the layout-viewport bottom and the visual-viewport bottom, plus the
 * visible height; null when there is no keyboard (or no visualViewport support).
 */
export function useKeyboardInset(active: boolean): { bottom: number; height: number } | null {
  const [inset, setInset] = useState<{ bottom: number; height: number } | null>(null);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !vv) {
      setInset(null);
      return;
    }
    const update = () => {
      const bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setInset(bottom > 80 ? { bottom, height: vv.height } : null);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      setInset(null);
    };
  }, [active]);
  return inset;
}
