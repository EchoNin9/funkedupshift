import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  GlobeAltIcon,
  StarIcon,
  AdjustmentsHorizontalIcon,
  ArrowRightIcon,
  EyeIcon,
  UserGroupIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { useAuth, canAccessSquash, canAccessMemes } from "../../shell/AuthContext";
import { useBranding } from "../../shell/BrandingContext";

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

/* ── Feature cards data ── */
const FEATURES = [
  {
    icon: GlobeAltIcon,
    title: "Browse",
    description:
      "Explore a curated index of websites and media. Everything is public, searchable, and categorized.",
    gradient: "from-blue-500/20 via-transparent to-cyan-500/10",
    accentColor: "text-blue-400",
    link: "/websites",
    linkLabel: "Browse websites",
  },
  {
    icon: StarIcon,
    title: "Rate",
    description:
      "Sign in to star your favorites, leave ratings, and shape what rises to the top.",
    gradient: "from-amber-500/15 via-transparent to-orange-500/10",
    accentColor: "text-amber-400",
    link: "/media",
    linkLabel: "Explore media",
  },
  {
    icon: AdjustmentsHorizontalIcon,
    title: "Curate",
    description:
      "Admins manage categories, groups, and branding from a single surface. Full control, zero friction.",
    gradient: "from-violet-500/15 via-transparent to-purple-500/10",
    accentColor: "text-violet-400",
    link: "/admin",
    linkLabel: "Admin panel",
  },
];

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
  const { user } = useAuth();
  const { hero } = useBranding();
  const showSquash = canAccessSquash(user);
  const showMemes = canAccessMemes(user);

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 -mt-6">
      {/* ════════════════════════════════════════════════
          SECTION 1 — HERO (full viewport)
         ════════════════════════════════════════════════ */}
      <section className="relative min-h-[85vh] flex items-center overflow-hidden">
        {/* Grain texture overlay */}
        <div
          className="pointer-events-none absolute inset-0 z-10 opacity-[0.03]"
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

        {/* Atmospheric radial gradients */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_20%_80%,rgba(59,130,246,0.12),transparent)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_80%_20%,rgba(139,92,246,0.08),transparent)]" />
          <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-surface-0 to-transparent" />
        </div>

        {/* Hero content */}
        <div className="relative z-20 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 sm:py-32">
          <div className="max-w-3xl space-y-8">
            <motion.p
              className="text-xs sm:text-sm font-medium uppercase tracking-[0.3em] text-accent-400"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            >
              {hero.tagline}
            </motion.p>

            <motion.h1
              className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[0.95] text-text-primary"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.7,
                delay: 0.1,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {hero.headline}
            </motion.h1>

            <motion.p
              className="text-base sm:text-lg text-text-secondary max-w-xl leading-relaxed font-light"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.7,
                delay: 0.2,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {hero.subtext}
            </motion.p>

            <motion.div
              className="flex flex-wrap gap-4 pt-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.6,
                delay: 0.4,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <Link
                to="/websites"
                className="group inline-flex items-center gap-2 rounded-full bg-accent-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-accent-500/25 transition-all duration-200 hover:bg-accent-600 hover:shadow-accent-500/40 hover:-translate-y-0.5"
              >
                Browse websites
                <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                to="/media"
                className="inline-flex items-center gap-2 rounded-full border border-border-hover bg-white/5 px-6 py-3 text-sm font-medium text-text-primary backdrop-blur-sm transition-all duration-200 hover:bg-white/10 hover:border-text-tertiary hover:-translate-y-0.5"
              >
                Explore media
              </Link>
              <Link
                to="/internet-dashboard"
                className="inline-flex items-center gap-2 rounded-full border border-border-hover bg-white/5 px-6 py-3 text-sm font-medium text-text-primary backdrop-blur-sm transition-all duration-200 hover:bg-white/10 hover:border-text-tertiary hover:-translate-y-0.5"
              >
                Internet Dashboard
              </Link>
              <Link
                to="/my-info"
                className="inline-flex items-center gap-2 rounded-full border border-border-hover bg-white/5 px-6 py-3 text-sm font-medium text-text-primary backdrop-blur-sm transition-all duration-200 hover:bg-white/10 hover:border-text-tertiary hover:-translate-y-0.5"
              >
                My Info
              </Link>
              {showSquash && (
                <Link
                  to="/squash"
                  className="inline-flex items-center gap-2 rounded-full border border-border-hover bg-white/5 px-6 py-3 text-sm font-medium text-text-primary backdrop-blur-sm transition-all duration-200 hover:bg-white/10 hover:border-text-tertiary hover:-translate-y-0.5"
                >
                  Squash
                </Link>
              )}
              {showMemes && (
                <Link
                  to="/memes"
                  className="inline-flex items-center gap-2 rounded-full border border-border-hover bg-white/5 px-6 py-3 text-sm font-medium text-text-primary backdrop-blur-sm transition-all duration-200 hover:bg-white/10 hover:border-text-tertiary hover:-translate-y-0.5"
                >
                  Memes
                </Link>
              )}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          SECTION 2 — FEATURE CARDS
         ════════════════════════════════════════════════ */}
      <section className="relative py-24 sm:py-32">
        {/* Subtle background gradient */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_100%_60%_at_50%_0%,rgba(59,130,246,0.04),transparent)]" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            className="text-center mb-16"
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
              How it works
            </motion.p>
            <motion.h2
              className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-text-primary"
              variants={fadeUp}
              custom={1}
            >
              Three ways to engage
            </motion.h2>
          </motion.div>

          <motion.div
            className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={staggerContainer}
          >
            {FEATURES.map((feature, i) => (
              <motion.div
                key={feature.title}
                variants={scaleIn}
                className="group relative rounded-2xl border border-border-default bg-surface-1 p-8 transition-all duration-300 hover:border-border-hover hover:-translate-y-1 hover:shadow-2xl hover:shadow-black/20"
              >
                {/* Card gradient bg */}
                <div
                  className={`pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br ${feature.gradient} opacity-0 transition-opacity duration-300 group-hover:opacity-100`}
                />

                <div className="relative">
                  <div
                    className={`mb-6 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-surface-3 ${feature.accentColor} transition-colors`}
                  >
                    <feature.icon className="h-6 w-6" />
                  </div>

                  <h3 className="text-xl font-bold text-text-primary mb-3">
                    {feature.title}
                  </h3>

                  <p className="text-sm leading-relaxed text-text-secondary mb-6">
                    {feature.description}
                  </p>

                  <Link
                    to={feature.link}
                    className={`inline-flex items-center gap-1.5 text-sm font-medium ${feature.accentColor} transition-all group-hover:gap-2.5`}
                  >
                    {feature.linkLabel}
                    <ArrowRightIcon className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                  </Link>
                </div>
              </motion.div>
            ))}
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
