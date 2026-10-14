import { Link, Navigate, useParams } from "react-router-dom";
import { CaretDown, Lock } from "@phosphor-icons/react";
import { useAuth } from "../shell/AuthContext";
import { LAUNCHER_GROUP_LABELS, getLauncherGroups, type LauncherApp, type LauncherGroupId } from "../config/modules";
import { Breadcrumb, GROUP_HUES } from "./AppPage";

const GROUP_BLURBS: Record<LauncherGroupId, string> = {
  discover: "Browse the curated index, media and memes.",
  tools: "Small utilities for links, images, DNS and more.",
  modules: "Your private workspaces — money, vehicles, squash and more.",
};

const cardClass =
  "flex items-start gap-3.5 rounded-ds-lg border border-divider bg-surface-2 p-4 text-left transition-colors motion-reduce:transition-none";

function AppCard({ app, hue }: { app: LauncherApp; hue: string }) {
  const body = (
    <>
      <span className={`app-icon hue-${hue}`} style={{ width: 46, height: 46, borderRadius: 13 }}>
        <app.icon className="h-[23px] w-[23px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[15px] font-semibold text-text-primary">
          {app.label}
          {app.locked && <Lock className="h-3.5 w-3.5 shrink-0" weight="fill" aria-label="Locked" />}
        </span>
        <span className="mt-0.5 block text-[13px] text-text-secondary">{app.description}</span>
      </span>
    </>
  );
  if (!app.locked) return <Link to={app.path} className={`${cardClass} hover:bg-surface-3`}>{body}</Link>;
  if (app.lockReason === "guest") {
    return <Link to="/auth" title={`${app.label} — sign in to use`} className={`${cardClass} is-locked`}>{body}</Link>;
  }
  return (
    <div role="link" aria-disabled="true" title={`${app.label} — ask an admin for access`} className={`${cardClass} is-locked is-inert`}>
      {body}
    </div>
  );
}

/** /apps/:group — the group's header and a card grid of its apps (locked ones shown locked). */
export default function AppsSectionPage() {
  const { group } = useParams<{ group: string }>();
  const { user } = useAuth();
  const found = getLauncherGroups(user).find((g) => g.id === group);
  if (!found) return <Navigate to="/" replace />;
  const hue = GROUP_HUES[found.id];

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <Breadcrumb trail={[]} current={LAUNCHER_GROUP_LABELS[found.id]} />
      <header className="flex items-center gap-3.5 pb-7 pt-[18px]">
        <span className={`hue-${hue} hue-dot h-3.5 w-3.5 rounded-full`} aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="font-display text-[clamp(28px,3.5vw,36px)] font-semibold leading-tight tracking-[-0.035em] text-text-primary">
            {found.label}
          </h1>
          <p className="mt-0.5 text-sm text-text-secondary">{GROUP_BLURBS[found.id]}</p>
        </div>
      </header>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
        {found.apps.map((a) => (
          <AppCard key={a.id} app={a} hue={hue} />
        ))}
      </div>
    </div>
  );
}

/** /apps — every section on one page, each a native <details> (collapsed by default). */
export function AllAppsPage() {
  const { user } = useAuth();
  const groups = getLauncherGroups(user);

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <Breadcrumb trail={[]} current="All apps" />
      <header className="pb-7 pt-[18px]">
        <h1 className="font-display text-[clamp(28px,3.5vw,36px)] font-semibold leading-tight tracking-[-0.035em] text-text-primary">
          All apps
        </h1>
        <p className="mt-0.5 text-sm text-text-secondary">Every section — open one to see its apps.</p>
      </header>
      <div className="space-y-3">
        {groups.map((g) => {
          const hue = GROUP_HUES[g.id];
          return (
            <details key={g.id} className="group rounded-ds-lg border border-divider bg-surface-1">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
                <span className={`hue-${hue} hue-dot h-3 w-3 shrink-0 rounded-full`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="text-[15px] font-semibold text-text-primary">{g.label}</span>
                  <span className="ml-2 text-sm text-text-tertiary">{g.apps.length}</span>
                  <span className="block text-[13px] text-text-secondary">{GROUP_BLURBS[g.id]}</span>
                </span>
                <CaretDown
                  className="h-4 w-4 shrink-0 text-text-secondary transition-transform group-open:rotate-180 motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </summary>
              <div className="grid gap-4 px-4 pb-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
                {g.apps.map((a) => (
                  <AppCard key={a.id} app={a} hue={hue} />
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
