import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, WarningCircle } from "@phosphor-icons/react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./buttonClasses";

/**
 * CopyButton — copies `text` to the clipboard; shows "Copied" (1.8s) or "Copy failed" (2.5s).
 * Props: text: string, label?: string = "Copy", size?: ButtonSize = "sm", variant?: ButtonVariant = "secondary",
 *        className?: string. Status text is announced via aria-live="polite". Min width keeps layout stable.
 */
interface CopyButtonProps {
  text: string;
  label?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  className?: string;
}

export function CopyButton({ text, label = "Copy", size = "sm", variant = "secondary", className = "" }: CopyButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const handleCopy = useCallback(async () => {
    window.clearTimeout(timer.current);
    let next: "copied" | "failed" = "copied";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      next = "failed";
    }
    setStatus(next);
    timer.current = window.setTimeout(() => setStatus("idle"), next === "copied" ? 1800 : 2500);
  }, [text]);

  const icon =
    status === "copied" ? <Check size={16} weight="regular" aria-hidden="true" />
    : status === "failed" ? <WarningCircle size={16} weight="regular" aria-hidden="true" />
    : <Copy size={16} weight="regular" aria-hidden="true" />;

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`${buttonClasses(variant, size)} min-w-[92px] ${status === "failed" ? "text-danger" : ""} ${className}`}
    >
      {icon}
      <span aria-live="polite">{status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : label}</span>
    </button>
  );
}
