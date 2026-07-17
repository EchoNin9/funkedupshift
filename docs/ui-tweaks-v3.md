# UI Tweaks v3 — task tracker

Status doc for the "UI Tweaks v3" work. **Check items off as they land.** A new
agent resuming this session: read this file top to bottom, then continue from the
first unchecked task. Work on `development` (auto-deploys staging); user verifies
on staging before Done.

Exploration already done (2026-07-17); the file map below is current as of then —
re-verify only if something doesn't match.

## File map (from exploration)

- Home card grid: `src/web/spa/src/features/home/HomePage.tsx` — hardcoded
  `buildWorks(showSquash, showExpenses)` array, gated cards filtered out via
  `show` flag. Grid wrapper has `key={works.length}` to replay the one-shot
  `whileInView` animation when late-mounting gated cards appear.
- Sidebar: `src/web/spa/src/shell/LeftSidebar.tsx`, mounted from
  `src/web/spa/src/shell/AppLayout.tsx`. Currently `hidden md:flex`, returns
  `null` for guests / users without module or admin access. `AppLayout` computes
  `showSidebar` independently for the `md:pl-60` content offset — keep both in sync.
- Module/link config: `src/web/spa/src/config/modules.ts`
  (`PUBLIC_MODULES`, `ADMIN_MODULES`, `getVisibleModuleGroups`,
  `getVisibleAdminModules`).
- Auth: `src/web/spa/src/shell/AuthContext.tsx` — `useAuth()` → `{ user, isLoading }`;
  exported helpers `hasRole`, `canAccessSquash`, `canAccessExpenses`,
  `canAccessInvesting`, etc. Roles: guest < user < manager < superadmin.
- Websites: `src/web/spa/src/features/websites/WebsitesPage.tsx` — fetches
  `GET /sites?limit=100`, auto-fill grid, no pagination.
- Media: `src/web/spa/src/features/media/MediaPage.tsx` — fetches
  `GET /media?limit=100`, poster grid `minmax(180px,1fr)` `aspect-[2/3]`,
  client-side type filter, no pagination.
- Mobile/native uses a separate shell: `src/web/spa/src/shell/MobileAppShell.tsx`
  (own `<Routes>`). Check whether each change needs mirroring there.

## Decisions (made, don't re-litigate unless user objects)

- **Greyed-out card/link UX:** gated items render for everyone; if the viewer
  lacks access they get reduced opacity + a lock hint, and click routes to
  `/auth` (guest) or is inert with a "no access" tooltip (logged-in without the
  group). Card list becomes identical for all viewers → the `key={works.length}`
  animation-unstick hack becomes unnecessary; remove it if gating no longer
  changes array length.
- **Financial card:** stays on the grid but greyed for guests (module is
  auth-gated). Fix its stale link `/financial` → `/finances` while in there.
- **Pagination is client-side** over the existing `limit=100` fetch (simple
  page slice + pager UI). Server-side pagination deferred until a corpus
  actually approaches 100 items.
- **Page sizes:** Websites 16/page desktop (4×4), 4/page mobile (1×4).
  Media 12/page desktop (4 cols × 3 rows), mobile **2 cols × 4 rows = 8/page**
  (2:3 posters read well two-up; suggested, user to confirm on staging).
- **Sidebar collapse state** persists in `localStorage`; collapsed = icon rail
  or fully hidden with a toggle button — implementer picks the cheaper one that
  looks right, collapsed-to-rail preferred.
- **Mobile nav (user-confirmed 2026-07-17):** hamburger button → slide-in
  drawer (off-canvas) on small screens, reusing the same sidebar
  content/sections/locked-link gating. Drawer overlays content with a scrim,
  closes on link tap / scrim tap / Esc. Desktop keeps the fixed sidebar; the
  drawer is just the < md presentation of the same component.

## Tasks

### Phase 1 — Home cards (HomePage.tsx)

- [x] 1.1 Show **all** cards to all visitors; replace the `show`/filter
      mechanism with a per-card `locked` state computed from the existing
      `canAccess*` helpers (Financial, Squash, Vehicle Expenses, General
      Expenses gated; Memes and the rest public).
- [x] 1.2 Locked visual: greyed (opacity/desaturate) + lock indicator + short
      "sign in to unlock" affordance; locked cards route guests to `/auth`.
- [x] 1.3 Financial card marked as auth-gated (locked for guests) and link
      fixed to `/finances`.
- [x] 1.4 Remove the `key={works.length}` unstick hack if the card array is now
      constant across auth states (it should be).

### Phase 2 — Left navbar (LeftSidebar.tsx + AppLayout.tsx)

- [x] 2.1 Sidebar visible **always, to all users incl. guests** (drop the
      `user &&` / access-based `null` return; sync `AppLayout`'s `showSidebar`
      offset logic).
- [x] 2.2 Add top "basic links" section, first in the sidebar:
      Internet Dashboard, Media, Websites (plus Home if cheap).
- [x] 2.3 Modules section shows **all** module groups; groups/links the user
      can't access render greyed + non-navigating (same locked treatment as
      cards).
- [x] 2.4 Admin section visible **only** when `getVisibleAdminModules(user)`
      is non-empty (managers/superadmins); for everyone else it's absent and
      Modules sits directly under the basic links.
- [x] 2.5 Whole-sidebar collapse toggle, state in `localStorage`; content
      offset (`md:pl-60`) follows collapsed state.
- [x] 2.6 Mobile nav: hamburger button (top-left in the header) opening a
      slide-in drawer at `< md`, rendering the same sidebar sections and
      locked-link gating. Scrim behind it; closes on link tap, scrim tap, or
      Esc. Check whether MobileAppShell (native) needs the same or already has
      its own nav.

      Implementation note: the mobile web (`< md`) drawer already existed in
      `MobileHeader.tsx` (hamburger + slide-out panel) — it previously built
      its own Discover/Recommended/Admin/Modules nav from `config/modules.ts`
      independently of `LeftSidebar`. Rather than adding a second, forked
      drawer, `LeftSidebar.tsx` now exports the nav content as
      `SidebarNavSections` (Basics → Modules-with-locks → Admin-if-any) and
      both the desktop `<aside>` and `MobileHeader`'s drawer render that same
      component — satisfying "same component, two presentations" without
      duplicating nav logic. `MobileHeader.tsx` was edited to consume it, add
      Esc-to-close, and move the hamburger to the top-left. `MobileAppShell.tsx`
      (native/Capacitor shell) was **not** touched — it has its own bottom-tab
      nav (`MobileBottomTabs`) and a `/more` page, a completely separate nav
      paradigm from the sidebar; out of scope per the task brief.

### Phase 3 — /websites pagination ✅ (2026-07-17)

- [x] 3.1 Fixed grid: 4 columns desktop, 1 column mobile (replace auto-fill).
- [x] 3.2 Client-side pagination: 16/page desktop, 4/page mobile; pager UI
      (prev/next + page numbers or count); reset to page 1 when
      search/category filters change.

### Phase 4 — /media pagination ✅ (2026-07-17)

- [x] 4.1 Fixed grid: 4 columns × 3 rows desktop (12/page); mobile 2 columns
      × 4 rows (8/page) — suggested, confirm with user on staging.
- [x] 4.2 Client-side pagination with pager UI; reset to page 1 when
      search/category/type filters change (note: type filter is already
      client-side — paginate the post-filter list).

Implementation: new shared `src/web/spa/src/components/Pager.tsx` (prev/next +
"Page X of Y", self-hides at pageCount<=1) and `useMediaQuery.ts` (reactive
matchMedia hook) used by both pages. `npm run build` passed. Diff reviewed by
lead, not yet committed — will commit together with Phase 1/2 once that lands.

### Phase 5 — Verify & ship

- [x] 5.1 `cd src/web/spa && npm run build` passes (the CI gate) — verified by
      lead on the combined tree (Phase 1–4 together). CI rebuilds `dist/` from
      source (`npm ci && npm run build` → `s3 sync`), so the tracked `dist/`
      churn is stale and is intentionally NOT committed.
- [ ] 5.2 Manual pass in browser: guest view (greyed cards + sidebar with
      locked links, no admin section), user view, admin view; pagination on
      both pages at desktop + mobile widths. **← user verifies on staging.**
- [x] 5.3 Committed to `development` (source only; dist/pyc noise excluded).
      Awaiting user staging verification, then this doc is fully done.

## Log

- 2026-07-17 — doc created; exploration complete; no implementation started.
- 2026-07-17 — Phase 1 (home cards) and Phase 2 (sidebar) implemented in
  `HomePage.tsx`, `LeftSidebar.tsx`, `AppLayout.tsx`, `MobileHeader.tsx`.
  `npm run build` passed; `npm run typecheck` shows only the 3 pre-existing
  baseline errors (DashboardPage, VehiclesExpensesPage, SiteDetailPage — none
  in touched files). Diff reviewed by lead, not yet committed — pending 5.1/5.2
  alongside Phase 3/4.
