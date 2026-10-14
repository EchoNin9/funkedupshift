import React from "react";
import { Link } from "react-router-dom";
import { Wrench } from "@phosphor-icons/react";
import { PUBLIC_MODULES } from "../../config/modules";
import { Breadcrumb, GROUP_HUES } from "../../components/AppPage";
import { focusRing } from "../../components/buttonClasses";

// The tools directory: every "tools" section module, plus My Info (which
// otherwise lives in the "discover" section — it stays there too, this just
// also surfaces it here since it's a visitor-info tool in its own right).
const MY_INFO_MODULE = PUBLIC_MODULES.find((m) => m.id === "my-info");
const TOOL_CARDS = [
  ...PUBLIC_MODULES.filter((m) => m.section === "tools"),
  ...(MY_INFO_MODULE ? [MY_INFO_MODULE] : []),
];

const hue = GROUP_HUES.tools;

// Same card pattern as AppsSectionPage (/apps/tools).
const cardClass =
  "flex items-start gap-3.5 rounded-ds-lg border border-divider bg-surface-2 p-4 text-left hover:bg-surface-3 motion-safe:transition-colors motion-reduce:transition-none " +
  focusRing;

export default function ToolsIndexPage() {
  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <Breadcrumb trail={[]} current="Tools" />
      <header className="flex items-center gap-3.5 pb-7 pt-[18px]">
        <span className={`hue-${hue} hue-dot h-3.5 w-3.5 rounded-full`} aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="font-display text-[clamp(28px,3.5vw,36px)] font-semibold leading-tight tracking-[-0.035em] text-text-primary">
            Tools
          </h1>
          <p className="mt-0.5 text-sm text-text-secondary">Small utilities for links, images, DNS and more.</p>
        </div>
      </header>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
        {TOOL_CARDS.map((mod) => {
          const Icon = mod.icon ?? Wrench;
          return (
            <Link key={mod.id} to={mod.path} className={cardClass}>
              <span className={`app-icon hue-${hue}`} style={{ width: 46, height: 46, borderRadius: 13 }}>
                <Icon className="h-[23px] w-[23px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-text-primary">{mod.label}</span>
                <span className="mt-0.5 block text-[13px] text-text-secondary">{mod.description}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
