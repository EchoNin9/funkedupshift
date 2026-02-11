import React from "react";
import { Link } from "react-router-dom";

const HomePage: React.FC = () => {
  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-brand-orange/20 via-brand-navy/10 to-brand-teal/20 px-6 py-10">
        <div className="max-w-xl space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-200">
            Shared internet intelligence
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-50">
            Discover, rate, and enrich the sites that matter.
          </h1>
          <p className="text-sm text-slate-100/80">
            Funkedupshift is a living index of websites, media, and experiments – curated by admins, enriched
            by everyone.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              to="/websites"
              className="inline-flex items-center rounded-full border border-slate-500/60 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-slate-300/80"
            >
              Browse websites
            </Link>
            <Link
              to="/media"
              className="inline-flex items-center rounded-full border border-slate-500/60 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-slate-300/80"
            >
              Explore media
            </Link>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-60">
          <div className="absolute -inset-24 bg-[radial-gradient(circle_at_top,_#f97316_0,_transparent_55%),radial-gradient(circle_at_bottom,_#06d6a0_0,_transparent_55%)]" />
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 mb-2">Everyone</p>
          <p className="text-sm text-slate-200">
            Browse all sites and media without signing in. Ratings and metadata are public by design.
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 mb-2">Users</p>
          <p className="text-sm text-slate-200">
            Sign in to rate sites, add notes, and personalize your view of the internet.
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 mb-2">Admins</p>
          <p className="text-sm text-slate-200">
            Curate the corpus, manage categories and groups, and control branding from a single admin surface.
          </p>
        </div>
      </section>
    </div>
  );
};

export default HomePage;

