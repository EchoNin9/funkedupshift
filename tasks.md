# UI Overhaul — Task Tracker

## Completed

- [x] **Shell UI overhaul** — Dark refined theme (Linear/Vercel-inspired), new design system with CSS custom properties, responsive nav. Split Header into MobileHeader + DesktopHeaderBar + UserMenu. Restyled LeftSidebar with brand section and animated accordions. Inter-only typography, near-black zinc palette with blue accent. *(commit c210d69)*
- [x] **Media & Websites pages — Dribbble-style masonry grid** — Replaced search-first list views with visual-first masonry grids (CSS columns). Auto-load content on mount. Horizontal scrollable category pills, pill-shaped search bar, skeleton loading states, staggered Framer Motion card animations, hover effects. All slate-*/brand-* tokens migrated to semantic design system. *(commit 6d2d9be)*

- [x] **Detail pages (MediaDetailPage + SiteDetailPage)** — Migrated old slate-* tokens to semantic tokens, aligned visual style with new masonry grid cards. *(commit 4ab57c2)*
- [x] **Memes, Squash, Vehicles, Financial token migration (13 files)** — All slate-*/brand-*/primary-* tokens replaced with semantic design system tokens across Memes (7 files), Squash (3 files), Vehicles (1 file — 90 replacements), Financial (2 files). Zero old tokens remaining. *(commit 7888fbc)*

- [x] **Complete token migration: all remaining feature pages (18 files)** — Admin (12 files), Auth, Profile, HomePage, Dashboard, HighestRatedPage, OurPropertiesPage. Zero old design tokens (slate-*/brand-*/primary-*/secondary-*/font-display) remain across the entire features directory. *(commit e8b6018)*

- [x] **HomePage immersive redesign** — Full-viewport hero (85vh) with grain texture overlay, editable bg image, radial gradient atmospherics, staggered Framer Motion text reveals, pill-shaped CTAs. Feature cards section (Browse/Rate/Curate) with hover-lift micro-interactions and gradient reveals. Role breakdown (Everyone/Users/Admins) with editorial numbered layout and alternating slide-in animations. CTA footer with gradient mesh. References: Human Destroyer, Figma, Revolut.

## Upcoming

- [ ] **Analytics dashboard + stats section** — Add site/media/user/rating counts API. Display animated counters on HomePage (scroll-triggered count-up). Requires backend analytics endpoints.
- [ ] **Shared component library extraction** — Extract repeated patterns into reusable components: Card, DataTable, FormField, Badge, CategoryPills, SearchBar, SkeletonCard, etc.
- [ ] **Animation & polish pass** — Page transitions, staggered list reveals, skeleton loading states using Framer Motion.
- [ ] **Dark/light theme toggle** — CSS variables already in place. Needs toggle UI and second set of variable values.
- [ ] **Accessibility audit** — Focus states, ARIA labels, keyboard navigation, color contrast checks.

## UI References

- **Media & Websites grids** — [Dribbble](https://dribbble.com/) — masonry card grid, horizontal category pills, visual-first discovery layout
- **HomePage** — [Human Destroyer](https://humandestroyer.tilda.ws/) — immersive full-viewport dark sections, dramatic compressed typography, atmospheric depth with layered opacity/parallax
- **HomePage** — [Revolut](https://www.revolut.com/) — bold full-bleed hero, stacked feature sections with distinct bg colors, animated counters, clean CTA rhythm
- **HomePage** — [Figma](https://www.figma.com/) — radial gradient depth layers, variable font weight hierarchy (300–700), hover micro-interactions (translateY + shadow), abstract gradient backgrounds, 5rem baseline spacing
