import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
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
            <Link
              to="/internet-dashboard"
              className="inline-flex items-center rounded-full border border-slate-500/60 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-slate-300/80"
            >
              Internet Dashboard
            </Link>
            {showSquash && (
              <Link
                to="/squash"
                className="inline-flex items-center rounded-full border border-slate-500/60 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-slate-300/80"
              >
                Squash
              </Link>
            )}
            {showMemes && (
              <Link
                to="/memes"
                className="inline-flex items-center rounded-full border border-slate-500/60 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-slate-300/80"
              >
                Memes
              </Link>
            )}
          </div>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-60">
          <div className="absolute -inset-24 bg-[radial-gradient(circle_at_top,_#f97316_0,_transparent_55%),radial-gradient(circle_at_bottom,_#06d6a0_0,_transparent_55%)]" />
        </div>
      </section>

      {/* ── Latest Memes Grid ── */}
      {memes.length > 0 && (
        <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Latest Memes</h2>
            <Link to="/memes" className="text-xs text-brand-orange hover:text-orange-400">
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
                <div
                  key={m.PK}
                  className="group rounded-lg border border-slate-800 bg-slate-900/60 overflow-hidden flex flex-col"
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
                      className="block truncate text-xs font-medium text-slate-200 hover:text-brand-orange"
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
                </div>
              );
            })}
          </div>
        </section>
      )}

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

