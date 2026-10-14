import React from "react";
import { Link } from "react-router-dom";
import { Lock } from "@phosphor-icons/react";
import type { LauncherApp } from "../../config/modules";

export type Hue = "teal" | "violet" | "coral" | "amber";

/** Landing-page app card (README §4): 42px icon tile, name, description; locked cards send guests to sign in and are inert otherwise. */
export function AppCard({ app, hue }: { app: LauncherApp; hue: Hue }) {
  const card =
    "relative flex items-start gap-3.5 rounded-ds-lg border border-divider bg-surface-2 p-[18px] text-left " +
    "motion-safe:transition-[transform,border-color] motion-safe:duration-150 hover:border-border-strong motion-safe:hover:-translate-y-0.5 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  const body = (
    <>
      <span className={`app-icon hue-${hue}`} style={{ width: 42, height: 42, borderRadius: 12 }}>
        <app.icon className="h-[22px] w-[22px]" />
      </span>
      <span className={`min-w-0 flex-1 ${app.locked ? "pt-4" : ""}`}>
        <span className="block text-[15px] font-bold text-text-primary">{app.label}</span>
        <span className="mt-0.5 block text-[13px] leading-[1.45] text-text-secondary">{app.description}</span>
      </span>
      {app.locked && (
        <span className="absolute right-3.5 top-3 inline-flex items-center gap-1 text-xs font-semibold text-text-secondary">
          <Lock className="h-3 w-3" weight="fill" aria-hidden="true" />
          {app.lockReason === "guest" ? "Sign in" : "No access"}
        </span>
      )}
    </>
  );
  if (!app.locked) return <Link to={app.path} className={card}>{body}</Link>;
  if (app.lockReason === "guest") {
    return <Link to="/auth" title={`${app.label} — sign in to use`} className={`${card} is-locked`}>{body}</Link>;
  }
  return (
    <div role="link" aria-disabled="true" title={`${app.label} — ask an admin for access`} className={`${card} is-locked is-inert`}>
      {body}
    </div>
  );
}
