import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import { useAuth, canAccessSquash, canAccessMemes } from "../../shell/AuthContext";

interface HomeMeme {
  PK: string;
  title?: string;
  thumbnailUrl?: string;
  mediaUrl?: string;
  averageRating?: number;
}

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

const CARD_MIN_W = 160;
const CARD_GAP = 16;
const ROWS_TO_SHOW = 2;

const HomePage: React.FC = () => {
  const { user } = useAuth();
  const showSquash = canAccessSquash(user);
  const showMemes = canAccessMemes(user);
  const [memes, setMemes] = useState<HomeMeme[]>([]);
  const [cols, setCols] = useState(4);
  const gridRef = useRef<HTMLDivElement>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  /* Fetch cached memes (public, no auth) */
  useEffect(() => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    let cancelled = false;
    fetch(`${apiBase}/memes/cache?limit=20`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { memes?: HomeMeme[] }) => {
        if (!cancelled) setMemes(data.memes ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /* Measure grid container to calculate column count */
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setCols(Math.max(1, Math.floor((w + CARD_GAP) / (CARD_MIN_W + CARD_GAP))));
    };
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [memes.length]);

  const visibleMemes = memes.slice(0, cols * ROWS_TO_SHOW);

  const handleCopyMediaUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      /* fallback */
    }
  };

  return (
    <div className="space-y-8">
      <section className="card relative overflow-hidden px-4 py-8 sm:px-6 sm:py-10">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-500/10 via-transparent to-brand-teal/10 pointer-events-none" />
        <div className="relative max-w-xl space-y-4">
          <motion.p
            className="text-xs font-semibold uppercase tracking-[0.25em] text-secondary-300"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            Shared internet intelligence
          </motion.p>
          <motion.h1
            className="text-3xl sm:text-4xl font-display font-bold text-gradient tracking-tight"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            Discover, rate, and enrich the sites that matter.
          </motion.h1>
          <motion.p
            className="text-sm text-secondary-300"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            A living index of websites, media, and experiments – curated by admins, enriched by everyone.
          </motion.p>
          <motion.div
            className="flex flex-wrap gap-3 pt-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            <Link to="/websites" className="btn-primary text-sm !px-4 !py-2">
              Browse websites
            </Link>
            <Link to="/media" className="btn-secondary text-sm !px-4 !py-2">
              Explore media
            </Link>
            <Link
              to="/internet-dashboard"
              className="btn-secondary text-sm !px-4 !py-2"
            >
              Internet Dashboard
            </Link>
            {showSquash && (
              <Link to="/squash" className="btn-secondary text-sm !px-4 !py-2">
                Squash
              </Link>
            )}
            {showMemes && (
              <Link to="/memes" className="btn-secondary text-sm !px-4 !py-2">
                Memes
              </Link>
            )}
          </motion.div>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-60">
          <div className="absolute -inset-24 bg-[radial-gradient(circle_at_top,_#f97316_0,_transparent_55%),radial-gradient(circle_at_bottom,_#06d6a0_0,_transparent_55%)]" />
        </div>
      </section>

      {/* ── Latest Memes Grid ── */}
      {memes.length > 0 && (
        <section className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Latest Memes</h2>
            <Link to="/memes" className="text-xs text-primary-400 hover:text-primary-300 transition-colors">
              View all &rarr;
            </Link>
          </div>
          <div
            ref={gridRef}
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN_W}px, 1fr))` }}
          >
            {visibleMemes.map((m) => {
              const thumb = m.thumbnailUrl || m.mediaUrl;
              const title = m.title || "Untitled";
              const isCopied = copiedUrl === m.mediaUrl;
              return (
                <motion.div
                  key={m.PK}
                  className="card group overflow-hidden flex flex-col hover:border-primary-500/50 transition-colors"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <Link
                    to={`/memes/${encodeURIComponent(m.PK)}`}
                    className="block aspect-square overflow-hidden bg-slate-900"
                  >
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={title}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-2xl text-slate-600">🖼</div>
                    )}
                  </Link>
                  <div className="p-2 space-y-1 flex-1 flex flex-col">
                    <Link
                      to={`/memes/${encodeURIComponent(m.PK)}`}
                      className="block truncate text-xs font-medium text-slate-200 hover:text-primary-400 transition-colors"
                    >
                      {title}
                    </Link>
                    <div className="flex items-center justify-between mt-auto pt-1">
                      {typeof m.averageRating === "number" ? (
                        <span className="text-[11px] text-amber-300">{m.averageRating.toFixed(1)}★</span>
                      ) : (
                        <span />
                      )}
                      {m.mediaUrl && (
                        <button
                          type="button"
                          onClick={() => handleCopyMediaUrl(m.mediaUrl!)}
                          className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                          title="Copy media URL"
                        >
                          {isCopied ? (
                            <span className="text-emerald-400">✓ Copied</span>
                          ) : (
                            <>
                              <ClipboardDocumentIcon className="h-3 w-3" />
                              <span>Copy URL</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Everyone", desc: "Browse all sites and media without signing in. Ratings and metadata are public by design." },
          { label: "Users", desc: "Sign in to rate sites, add notes, and personalize your view of the internet." },
          { label: "Admins", desc: "Curate the corpus, manage categories and groups, and control branding from a single admin surface." },
        ].map((item, i) => (
          <motion.div
            key={item.label}
            className="card p-4"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 * i }}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary-500 mb-2">{item.label}</p>
            <p className="text-sm text-secondary-200">{item.desc}</p>
          </motion.div>
        ))}
      </section>
    </div>
  );
};

export default HomePage;

