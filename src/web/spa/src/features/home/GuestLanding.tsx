import React from "react";
import { Link } from "react-router-dom";
import { MagnifyingGlass, SquaresFour } from "@phosphor-icons/react";
import { useAuth } from "../../shell/AuthContext";
import { useBranding } from "../../shell/BrandingContext";
import { useLauncher } from "../../shell/LauncherContext";
import { LAUNCHER_GROUP_LABELS, getLauncherGroups, type LauncherGroupId } from "../../config/modules";
import { GROUP_HUES } from "../../components/AppPage";
import { buttonClasses } from "../../components/buttonClasses";
import { AppCard } from "./AppTile";

const GROUP_BLURBS: Record<LauncherGroupId, string> = {
  discover: "Open to everyone.",
  tools: "Everyday utilities — free with an account.",
  modules: "Personal apps for invited groups.",
};

/** Site name as the hero H1: the word "up" in accent text, the last word on its own line, a final accent period. */
function HeroTitle({ siteName }: { siteName: string }) {
  // The brand is often stored as one word ("Funkedupshift"); render it as the prototype's "Funked up / shift.".
  const brand = siteName.trim().match(/^(.*funked)\s*(up)\s*(shift.*)$/i);
  if (brand) {
    return (
      <div className="font-display text-[clamp(52px,9vw,112px)] font-semibold leading-[0.9] tracking-[-0.05em] text-text-primary">
        {brand[1]} <span className="text-accent-text">{brand[2]}</span>
        <br />
        {brand[3]}
        <span className="text-accent">.</span>
      </div>
    );
  }
  const words = siteName.trim().split(/\s+/);
  const last = words.length > 1 ? words[words.length - 1] : null;
  const head = last ? words.slice(0, -1) : words;
  return (
    <div className="font-display text-[clamp(52px,9vw,112px)] font-semibold leading-[0.9] tracking-[-0.05em] text-text-primary">
      {head.map((w, i) => (
        <React.Fragment key={i}>
          {i > 0 && " "}
          {w.toLowerCase() === "up" ? <span className="text-accent-text">{w}</span> : w}
        </React.Fragment>
      ))}
      {last && (
        <>
          <br />
          {last}
        </>
      )}
      <span className="text-accent">.</span>
    </div>
  );
}

const GuestLanding: React.FC = () => {
  const { user } = useAuth();
  const { hero, siteName } = useBranding();
  const { openLauncher } = useLauncher();
  const groups = getLauncherGroups(user);

  return (
    <div className="relative mx-auto w-full max-w-[1180px]">
      {hero.imageUrl && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] bg-cover bg-center [mask-image:linear-gradient(to_bottom,black,transparent)]"
          style={{ backgroundImage: `url(${hero.imageUrl})`, opacity: (hero.imageOpacity ?? 25) / 100 }}
        />
      )}
      <section className="max-w-[880px] pb-10 pt-12 sm:pt-20">
        <ul className="mb-6 flex flex-wrap gap-2" aria-label="Sections">
          {groups.map((g) => (
            <li key={g.id} className={`hue-${GROUP_HUES[g.id]}`}>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-divider px-2.5 py-[3px] text-xs font-semibold text-text-primary">
                <span className="hue-dot h-2 w-2 rounded-full" aria-hidden="true" />
                {g.label}
              </span>
            </li>
          ))}
        </ul>
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-accent-text">{hero.tagline}</p>
        <h1 className="sr-only">{siteName}</h1>
        <div aria-hidden="true">
          <HeroTitle siteName={siteName} />
        </div>
        <p className="mt-6 max-w-[640px] font-display text-[clamp(20px,2.4vw,28px)] font-semibold leading-tight tracking-[-0.02em] text-text-primary">
          {hero.headline}
        </p>
        <p className="mt-3 max-w-[560px] text-[19px] leading-[1.5] text-text-secondary">{hero.subtext}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button type="button" onClick={() => openLauncher()} className={buttonClasses("primary", "lg")}>
            <SquaresFour className="h-5 w-5" aria-hidden="true" />
            Explore all apps
          </button>
          <Link to="/websites" className={buttonClasses("secondary", "lg")}>
            Browse websites
          </Link>
        </div>
        <button
          type="button"
          onClick={() => openLauncher({ focusSearch: true })}
          className="mt-5 flex w-full max-w-[560px] items-center gap-2.5 rounded-ds-md border border-divider bg-surface-2 px-3.5 py-3 text-left text-sm text-text-secondary hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <MagnifyingGlass className="h-[18px] w-[18px]" aria-hidden="true" />
          Search apps and tools
          <kbd className="ml-auto hidden rounded border border-divider px-1.5 text-xs sm:inline">⌘K</kbd>
        </button>
      </section>

      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`group-${g.id}`} className={`hue-${GROUP_HUES[g.id]} pb-10`}>
          <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="hue-dot h-[9px] w-[9px] self-center rounded-full" aria-hidden="true" />
            <h2 id={`group-${g.id}`} className="font-display text-2xl font-semibold tracking-[-0.03em] text-text-primary">
              <Link to={`/apps/${g.id}`} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                {LAUNCHER_GROUP_LABELS[g.id]}
              </Link>
            </h2>
            <p className="text-sm text-text-secondary">{GROUP_BLURBS[g.id]}</p>
          </header>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr))]">
            {g.apps.map((a) => (
              <AppCard key={a.id} app={a} hue={GROUP_HUES[g.id]} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

export default GuestLanding;
