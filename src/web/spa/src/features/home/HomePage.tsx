import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRightIcon,
  EyeIcon,
  UserGroupIcon,
  ShieldCheckIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline";
import {
  useAuth,
  canAccessSquash,
  canAccessExpenses,
} from "../../shell/AuthContext";
import { useBranding } from "../../shell/BrandingContext";

/* ── Pointer parallax (disabled on touch / reduced-motion) ── */
function useParallax(active: boolean): { x: number; y: number } {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!active) return;
    const onMove = (e: MouseEvent) => {
      setTilt({
        x: (e.clientX / window.innerWidth - 0.5) * 14,
        y: (e.clientY / window.innerHeight - 0.5) * 14,
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [active]);
  return active ? tilt : { x: 0, y: 0 };
}

/* ── RGB-split glitch wordmark ── */
const GlitchWordmark: React.FC<{ text: string; tilt: { x: number; y: number }; animate: boolean }> = ({
  text, tilt, animate,
}) => {
  const layer = "absolute inset-0 select-none";
  return (
    <div className="relative inline-block max-w-full break-words font-display font-extrabold uppercase leading-[0.82] tracking-tight text-text-primary text-[clamp(3rem,13vw,9rem)]">
      <span
        aria-hidden
        className={layer}
        style={{
          color: "rgb(var(--color-n1))",
          mixBlendMode: "screen",
          transform: `translate(${-5 - tilt.x}px, ${tilt.y}px)`,
          animation: animate ? "pop-glitch-a 2.6s steps(2) infinite" : undefined,
        }}
      >
        {text}
      </span>
      <span
        aria-hidden
        className={layer}
        style={{
          color: "rgb(var(--color-n3))",
          mixBlendMode: "screen",
          transform: `translate(${5 + tilt.x}px, ${-tilt.y}px)`,
          animation: animate ? "pop-glitch-b 2.6s steps(2) infinite" : undefined,
        }}
      >
        {text}
      </span>
      <span className="relative">{text}</span>
    </div>
  );
};

/* ── Animated count-up hook ── */
function useCountUp(target: number, duration = 1.8, active = true): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    let start: number | null = null;
    let raf: number;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const progress = Math.min((ts - start) / (duration * 1000), 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, active]);
  return value;
}

/* ── Stats data (placeholder — swap with API data later) ── */
// TODO: Replace with `GET /stats` endpoint when available
const STATS = [
  { label: "Curated websites", value: 150, suffix: "+" },
  { label: "Media items", value: 85, suffix: "+" },
  { label: "Active users", value: 30, suffix: "+" },
  { label: "Ratings submitted", value: 1200, suffix: "+" },
];

/* ── Animation variants ── */
const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] },
  }),
};

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

/* ── "The Works" cards. Every card renders for every visitor; `locked`
   greys out cards the viewer can't access instead of hiding them, so the
   array is identical across auth states. ── */
type Work = { title: string; blurb: string; to: string; status: string; accent: string; locked: boolean };
function buildWorks(locked: { squash: boolean; expenses: boolean; financial: boolean }): Work[] {
  return [
    { title: "Websites", blurb: "The curated index. Browse, rate, and rank the sites that matter.", to: "/websites", status: "LIVE", accent: "", locked: false },
    { title: "Media", blurb: "A living gallery of clips, tracks, and oddities — all rateable.", to: "/media", status: "LIVE", accent: "card-accent-n3", locked: false },
    { title: "Internet Dashboard", blurb: "Live pulse of the domains we track, all on one screen.", to: "/internet-dashboard", status: "LIVE", accent: "card-accent-n2", locked: false },
    { title: "Memes", blurb: "Browse, rate, and generate the freshest dank.", to: "/memes", status: "LIVE", accent: "card-accent-n2", locked: false },
    { title: "Financial", blurb: "Watchlists and market data for the symbols you care about.", to: "/finances", status: "LIVE", accent: "card-accent-n4", locked: locked.financial },
    { title: "Squash", blurb: "Ladder, players, and match results for the crew.", to: "/squash", status: "MEMBERS", accent: "card-accent-n3", locked: locked.squash },
    { title: "Vehicle Expenses", blurb: "Log and track what your rides cost you.", to: "/vehicles-expenses", status: "MEMBERS", accent: "card-accent-n4", locked: locked.expenses },
    { title: "General Expenses", blurb: "Everything else that hits the books.", to: "/general-expenses", status: "MEMBERS", accent: "", locked: locked.expenses },
  ];
}

/* ── Role breakdown data ── */
const ROLES = [
  {
    icon: EyeIcon,
    label: "Everyone",
    description:
      "Browse all sites and media without signing in. Ratings and metadata are public by design.",
    accent: "border-emerald-500/30 bg-emerald-500/5",
    iconColor: "text-emerald-400",
    number: "01",
  },
  {
    icon: UserGroupIcon,
    label: "Users",
    description:
      "Sign in to rate sites, add notes, and personalize your view of the internet.",
    accent: "border-blue-500/30 bg-blue-500/5",
    iconColor: "text-blue-400",
    number: "02",
  },
  {
    icon: ShieldCheckIcon,
    label: "Admins",
    description:
      "Curate the corpus, manage categories and groups, and control branding from a single admin surface.",
    accent: "border-amber-500/30 bg-amber-500/5",
    iconColor: "text-amber-400",
    number: "03",
  },
];

/* ── Stats counter row (scroll-triggered) ── */
const StatCounter: React.FC<{ label: string; value: number; suffix: string; index: number; active: boolean }> = ({
  label, value, suffix, index, active,
}) => {
  const count = useCountUp(value, 1.8, active);
  return (
    <motion.div
      className="text-center"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay: index * 0.1, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className="block text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-text-primary tabular-nums">
        {count.toLocaleString()}{suffix}
      </span>
      <span className="mt-2 block text-sm font-medium text-text-tertiary uppercase tracking-widest">
        {label}
      </span>
    </motion.div>
  );
};

const StatsSection: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const callbackRef = React.useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsVisible(true); observer.disconnect(); } },
      { rootMargin: "-80px" }
    );
    observer.observe(node);
  }, []);

  return (
    <section ref={callbackRef} className="relative py-20 sm:py-24 overflow-hidden">
      {/* Divider line */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border-hover to-transparent" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-12">
          {STATS.map((stat, i) => (
            <StatCounter
              key={stat.label}
              label={stat.label}
              value={stat.value}
              suffix={stat.suffix}
              index={i}
              active={isVisible}
            />
          ))}
        </div>
      </div>

      {/* Bottom divider */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border-hover to-transparent" />
    </section>
  );
};

const HomePage: React.FC = () => {
  const { user, isLoading } = useAuth();
  const { hero, siteName } = useBranding();
  // While auth is still resolving, don't flash the locked state — render
  // cards as unlocked/neutral until we know the real access level.
  const works = buildWorks({
    squash: !isLoading && !canAccessSquash(user),
    expenses: !isLoading && !canAccessExpenses(user),
    financial: !isLoading && !user,
  });

  const reduce = useReducedMotion();
  // Parallax/glitch only with a fine pointer (mouse) and motion allowed — off on touch/reduced-motion.
  const [finePointer, setFinePointer] = useState(false);
  useEffect(() => {
    setFinePointer(window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  }, []);
  const motionOk = !reduce && finePointer;
  const tilt = useParallax(motionOk);

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 -mt-6">
      {/* ════════════════════════════════════════════════
          SECTION 1 — HERO (full viewport)
         ════════════════════════════════════════════════ */}
      <section className="relative min-h-[74vh] flex items-center overflow-hidden">
        {/* Grain texture overlay */}
        <div
          className="pointer-events-none absolute inset-0 z-10 opacity-[0.04]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          }}
        />

        {/* Editable hero background image */}
        {hero.imageUrl && (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(${hero.imageUrl})`,
              opacity: (hero.imageOpacity ?? 25) / 100,
            }}
          />
        )}

        {/* Floating sticker badges (decorative) */}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-20 hidden sm:block">
          <span className="pop-badge pop-pulse absolute left-[8%] top-[22%] -rotate-12">Fresh</span>
          <span className="pop-badge pop-pulse absolute right-[10%] top-[30%] rotate-6" style={{ background: "rgb(var(--color-n3))", animationDelay: ".4s" }}>Loud</span>
          <span className="pop-badge pop-pulse absolute right-[22%] bottom-[16%] -rotate-6" style={{ background: "rgb(var(--color-n2))", animationDelay: ".8s" }}>Funky</span>
        </div>

        {/* Hero content */}
        <div className="relative z-30 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="max-w-3xl space-y-7">
            <motion.p
              className="text-xs sm:text-sm font-display font-extrabold uppercase tracking-[0.3em] text-accent"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            >
              {hero.tagline}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            >
              <h1 className="sr-only">{siteName}</h1>
              <GlitchWordmark text={siteName} tilt={tilt} animate={motionOk} />
            </motion.div>

            <motion.p
              className="text-xl sm:text-2xl font-display font-bold tracking-tight text-text-primary max-w-xl"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              {hero.headline}
            </motion.p>

            <motion.p
              className="text-base sm:text-lg text-text-secondary max-w-xl leading-relaxed"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              {hero.subtext}
            </motion.p>

            <motion.div
              className="flex flex-wrap items-center gap-4 pt-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <button
                type="button"
                onClick={() => document.getElementById("works")?.scrollIntoView({ behavior: "smooth" })}
                className="btn-primary"
              >
                Enter the funk
                <span aria-hidden>↓</span>
              </button>
              <Link to="/websites" className="btn-secondary">
                Browse websites
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          SECTION 2 — "THE WORKS" GRID
         ════════════════════════════════════════════════ */}
      <section id="works" className="relative py-24 sm:py-32 scroll-mt-20">
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            className="mb-14"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={staggerContainer}
          >
            <motion.p
              className="text-xs font-display font-extrabold uppercase tracking-[0.3em] text-accent mb-4"
              variants={fadeUp}
              custom={0}
            >
              The Works
            </motion.p>
            <motion.h2
              className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-text-primary"
              variants={fadeUp}
              custom={1}
            >
              Everything in the shift
            </motion.h2>
          </motion.div>

          <motion.div
            className="grid gap-7 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={staggerContainer}
          >
            {works.map((w, i) => {
              // Guests get routed to sign in; logged-in users without access
              // are inert (no navigation) with a "no access" hint.
              const guestLocked = w.locked && !user;
              const inertLocked = w.locked && !!user;
              const cardClass = `card ${w.accent} group flex h-full flex-col p-6 no-underline ${
                w.locked ? "opacity-50 grayscale cursor-not-allowed" : ""
              }`;

              const cardBody = (
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-display font-extrabold text-2xl text-text-tertiary tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="pop-pill">{w.status}</span>
                  </div>

                  <h3 className="mt-5 flex items-center gap-2 text-xl font-display font-extrabold uppercase tracking-tight text-text-primary">
                    {w.title}
                    {w.locked && (
                      <LockClosedIcon className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
                    )}
                  </h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-text-secondary">
                    {w.blurb}
                  </p>

                  {w.locked ? (
                    <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-display font-extrabold uppercase tracking-tight text-text-tertiary">
                      {user ? "No access" : "Sign in to unlock"}
                    </span>
                  ) : (
                    <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-display font-extrabold uppercase tracking-tight text-accent transition-all group-hover:gap-2.5">
                      Open
                      <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </span>
                  )}
                </>
              );

              return (
                <motion.div key={w.title} variants={scaleIn} style={{ rotate: i % 2 === 0 ? -1 : 1 }}>
                  {inertLocked ? (
                    <div
                      className={cardClass}
                      title="You don't have access to this module"
                      aria-disabled="true"
                    >
                      {cardBody}
                    </div>
                  ) : (
                    <Link
                      to={guestLocked ? "/auth" : w.to}
                      className={cardClass}
                      title={guestLocked ? "Sign in to unlock" : undefined}
                    >
                      {cardBody}
                    </Link>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          SECTION 2.5 — STATS COUNTERS
         ════════════════════════════════════════════════ */}
      <StatsSection />

      {/* ════════════════════════════════════════════════
          SECTION 3 — ROLE BREAKDOWN (editorial)
         ════════════════════════════════════════════════ */}
      <section className="relative py-24 sm:py-32 overflow-hidden">
        {/* Atmospheric gradient */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_80%_50%,rgba(139,92,246,0.06),transparent)]" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            className="mb-16"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={staggerContainer}
          >
            <motion.p
              className="text-xs font-medium uppercase tracking-[0.3em] text-text-tertiary mb-4"
              variants={fadeUp}
              custom={0}
            >
              Access levels
            </motion.p>
            <motion.h2
              className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-text-primary max-w-lg"
              variants={fadeUp}
              custom={1}
            >
              Built for everyone, powered by community
            </motion.h2>
          </motion.div>

          <div className="space-y-6">
            {ROLES.map((role, i) => (
              <motion.div
                key={role.label}
                initial={{ opacity: 0, x: i % 2 === 0 ? -30 : 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{
                  duration: 0.6,
                  delay: i * 0.1,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className={`group flex flex-col sm:flex-row items-start gap-6 rounded-2xl border p-6 sm:p-8 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/10 ${role.accent}`}
              >
                {/* Number */}
                <span className="text-5xl sm:text-6xl font-black text-white/[0.04] select-none shrink-0 leading-none">
                  {role.number}
                </span>

                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-3">
                    <role.icon className={`h-5 w-5 ${role.iconColor}`} />
                    <h3 className="text-lg font-bold text-text-primary">
                      {role.label}
                    </h3>
                  </div>
                  <p className="text-sm leading-relaxed text-text-secondary max-w-lg">
                    {role.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          SECTION 4 — CTA FOOTER
         ════════════════════════════════════════════════ */}
      <section className="relative py-24 sm:py-32 overflow-hidden">
        {/* Grain */}
        <div
          className="pointer-events-none absolute inset-0 z-10 opacity-[0.025]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          }}
        />

        {/* Gradient mesh */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_50%,rgba(59,130,246,0.08),transparent)]" />
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border-hover to-transparent" />
        </div>

        <motion.div
          className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={staggerContainer}
        >
          <motion.h2
            className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-text-primary mb-6"
            variants={fadeUp}
            custom={0}
          >
            Ready to explore?
          </motion.h2>

          <motion.p
            className="text-base sm:text-lg text-text-secondary max-w-md mx-auto mb-10 font-light"
            variants={fadeUp}
            custom={1}
          >
            Jump into the index. No sign-up required to browse — create an
            account when you want to rate and curate.
          </motion.p>

          <motion.div
            className="flex flex-wrap justify-center gap-4"
            variants={fadeUp}
            custom={2}
          >
            <Link
              to="/websites"
              className="group inline-flex items-center gap-2 rounded-full bg-accent-500 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-accent-500/25 transition-all duration-200 hover:bg-accent-600 hover:shadow-accent-500/40 hover:-translate-y-0.5"
            >
              Get started
              <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            {!user && (
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 rounded-full border border-border-hover bg-white/5 px-8 py-3.5 text-sm font-medium text-text-primary backdrop-blur-sm transition-all duration-200 hover:bg-white/10 hover:border-text-tertiary hover:-translate-y-0.5"
              >
                Sign in
              </Link>
            )}
          </motion.div>
        </motion.div>
      </section>
    </div>
  );
};

export default HomePage;
