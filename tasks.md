# UI Overhaul — Task Tracker

## Completed

- [x] **Shell UI overhaul** — Dark refined theme (Linear/Vercel-inspired), new design system with CSS custom properties, responsive nav. Split Header into MobileHeader + DesktopHeaderBar + UserMenu. Restyled LeftSidebar with brand section and animated accordions. Inter-only typography, near-black zinc palette with blue accent. *(commit c210d69)*
- [x] **Media & Websites pages — Dribbble-style masonry grid** — Replaced search-first list views with visual-first masonry grids (CSS columns). Auto-load content on mount. Horizontal scrollable category pills, pill-shaped search bar, skeleton loading states, staggered Framer Motion card animations, hover effects. All slate-*/brand-* tokens migrated to semantic design system. *(commit 6d2d9be)*

## In Progress

- [ ] **Detail pages (MediaDetailPage + SiteDetailPage)** — Migrate old slate-* tokens to semantic tokens, align visual style with new masonry grid cards.

## Upcoming

- [ ] **HomePage immersive redesign** — Reference: humandestroyer.tilda.ws. Full-vh sections, 120px compressed uppercase type (-7px letter-spacing, 0.85 line-height), grain/parallax effects, #060606 dark, scroll-triggered fades, layered z-index depth.
- [ ] **Remaining feature page token migration (30+ files)** — Bulk slate-*/brand-* → semantic token migration. Batch by module:
  - Memes (7 files) — high visibility
  - Admin pages (11 files)
  - Squash (3 files)
  - Financial (2 files)
  - Websites admin (2 files)
  - Media admin (2 files)
  - Vehicles, Profile, Auth, Dashboard, etc.
- [ ] **Shared component library extraction** — Extract repeated patterns into reusable components: Card, DataTable, FormField, Badge, CategoryPills, SearchBar, SkeletonCard, etc.
- [ ] **Animation & polish pass** — Page transitions, staggered list reveals, skeleton loading states using Framer Motion.
- [ ] **Dark/light theme toggle** — CSS variables already in place. Needs toggle UI and second set of variable values.
- [ ] **Accessibility audit** — Focus states, ARIA labels, keyboard navigation, color contrast checks.

## UI References

- **Media & Websites grids** — [Dribbble](https://dribbble.com/) — masonry card grid, horizontal category pills, visual-first discovery layout
- **HomePage** — [Human Destroyer](https://humandestroyer.tilda.ws/) — immersive full-viewport dark sections, dramatic compressed typography, atmospheric depth with layered opacity/parallax
