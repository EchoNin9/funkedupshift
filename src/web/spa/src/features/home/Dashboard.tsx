import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PushPin, SquaresFour } from "@phosphor-icons/react";
import { useAuth } from "../../shell/AuthContext";
import { userDisplayName } from "../../shell/AccountMenu";
import { LAUNCHER_GROUP_LABELS, PUBLIC_MODULES, canOpenModule, getVisibleAdminModules } from "../../config/modules";
import { GROUP_HUES, resolveAppFrame } from "../../components/AppPage";
import { buttonClasses } from "../../components/buttonClasses";
import { CopyButton } from "../../components/CopyButton";
import { ListCard, ListEmpty, ListRow } from "../../components/ListCard";
import { usePins } from "../../hooks/usePins";
import { useRecentRoutes } from "../../hooks/useRecentRoutes";
import { listLinks, type ShortLink } from "../tools/api";
import type { Hue } from "./AppTile";

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const SHORT_LINK_COUNT = 5;

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** No first name or username in the auth user yet, so fall back to the email's local part. */

function timeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function IconTile({ icon: Icon, hue, size }: { icon: React.ComponentType<{ className?: string }>; hue: Hue; size: number }) {
  return (
    <span className={`app-icon hue-${hue}`} style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}>
      <Icon className={size > 40 ? "h-[22px] w-[22px]" : "h-5 w-5"} />
    </span>
  );
}

const cardCls = "rounded-ds-lg border border-divider bg-surface-2 p-5";

function RecentLinks() {
  const [links, setLinks] = useState<ShortLink[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    listLinks()
      .then((p) => !cancelled && setLinks(p.items.slice(0, SHORT_LINK_COUNT)))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className={cardCls} aria-labelledby="home-links" aria-busy={!links && !failed}>
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 id="home-links" className="font-display text-lg font-semibold tracking-[-0.02em] text-text-primary">
          Recent short links
        </h2>
        <Link to="/shortener" className={buttonClasses("ghost", "sm")}>
          Open shortener →
        </Link>
      </header>
      {failed ? (
        <ListEmpty>Couldn’t load your links right now.</ListEmpty>
      ) : !links ? (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 rounded-ds-md bg-surface-3 motion-safe:animate-pulse" />
          ))}
        </div>
      ) : links.length === 0 ? (
        <ListEmpty>No short links yet.</ListEmpty>
      ) : (
        <ListCard className="!rounded-ds-md !bg-transparent">
          {links.map((l) => (
            <ListRow key={l.code} className="flex items-center gap-3 !py-2.5">
              <div className="min-w-0 flex-1">
                <a href={l.shortUrl} target="_blank" rel="noreferrer" className={`block truncate text-sm font-semibold text-accent-text hover:underline ${focus}`}>
                  {l.shortUrl.replace(/^https?:\/\//, "")}
                </a>
                <span className="block truncate text-xs text-text-secondary">{l.url}</span>
              </div>
              <CopyButton text={l.shortUrl} />
            </ListRow>
          ))}
        </ListCard>
      )}
    </section>
  );
}

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const { pins } = usePins();
  const recent = useRecentRoutes();
  // Computed once per mount; no re-check while the page stays open.
  const [now] = useState(() => new Date());

  const pinned = useMemo(
    () =>
      pins
        .map((id) => PUBLIC_MODULES.find((m) => m.id === id))
        .filter((m): m is NonNullable<typeof m> => !!m && m.launcher !== false && canOpenModule(m, user)),
    [pins, user]
  );

  // Recents the user can still open; hide anything they lost access to.
  const recents = useMemo(() => {
    const adminIds = new Set(getVisibleAdminModules(user).map((m) => m.id));
    return recent.flatMap((r) => {
      const f = resolveAppFrame(r.path);
      if (!f) return [];
      const ok =
        f.kind === "public" ? PUBLIC_MODULES.some((m) => m.id === f.publicId && canOpenModule(m, user))
        : f.kind === "admin" ? (f.adminId ? adminIds.has(f.adminId) : adminIds.size > 0)
        : !!user;
      return ok ? [{ ...r, frame: f }] : [];
    });
  }, [recent, user]);

  if (!user) return null;
  const nowMs = now.getTime();
  const name = userDisplayName(user);
  const date = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-8 pt-8 sm:pt-[52px]">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-text-secondary">{date}</p>
          <h1 className="mt-1 break-words font-display text-[clamp(36px,5vw,54px)] font-semibold leading-[1.05] tracking-[-0.04em] text-text-primary">
            {greeting(now)}
            {name ? `, ${name}` : ""}.
          </h1>
        </div>
        <Link to="/apps/discover" className={buttonClasses("secondary", "md")}>
          <SquaresFour className="h-[18px] w-[18px]" aria-hidden="true" />
          All apps
        </Link>
      </header>

      <section aria-labelledby="home-pinned" className="pb-8">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="home-pinned" className="text-[13px] font-bold uppercase tracking-[0.06em] text-text-secondary">
            Pinned
          </h2>
          <p className="text-[13px] text-text-secondary">Pin any app with the pin button in its page header, or right from the launcher.</p>
        </div>
        {pinned.length === 0 ? (
          <div className="flex items-center gap-2 rounded-ds-md border border-dashed border-border-strong px-4 py-6 text-sm text-text-secondary">
            <PushPin className="h-4 w-4" aria-hidden="true" />
            No pinned apps yet.
          </div>
        ) : (
          <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,180px),1fr))]">
            {pinned.map((m) => (
              <Link
                key={m.id}
                to={m.path}
                className={`flex items-center gap-3 rounded-ds-md border border-divider bg-surface-2 p-3 motion-safe:transition-colors hover:border-border-strong ${focus}`}
              >
                <IconTile icon={m.icon} hue={GROUP_HUES[m.group]} size={38} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-text-primary">{m.label}</span>
                  <span className="block text-xs text-text-secondary">{LAUNCHER_GROUP_LABELS[m.group]}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 pb-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr))]">
        <RecentLinks />
        <section className={cardCls} aria-labelledby="home-recent">
          <h2 id="home-recent" className="mb-3 font-display text-lg font-semibold tracking-[-0.02em] text-text-primary">
            Recently used
          </h2>
          {recents.length === 0 ? (
            <ListEmpty>Apps you open will show up here.</ListEmpty>
          ) : (
            <ul className="-mx-2">
              {recents.map((r) => (
                <li key={r.path}>
                  <Link to={r.path} className={`flex items-center gap-3 rounded-ds-md px-2 py-2 hover:bg-surface-3 ${focus}`}>
                    <IconTile icon={r.frame.icon} hue={r.frame.hue} size={34} />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{r.frame.title}</span>
                    <span className="shrink-0 text-xs text-text-secondary">{timeAgo(r.at, nowMs)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};

export default Dashboard;
