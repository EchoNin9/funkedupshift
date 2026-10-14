# Starter prompts for Claude Code

Copy this folder into the repo as `docs/design_handoff_app_shell/`. Run the prompts in order, one per session or PR, on the `development` branch. CI gate after each one: `cd src/web/spa && npm run build`.

---

## 0. Orientation (read only)
```
Read docs/design_handoff_app_shell/README.md, DESIGN_SYSTEM.md and styles.css, then open prototype/AppShell.dc.html to see the intended behaviour (its logic class at the bottom holds the app list and access rules).
Then read src/web/spa/src/shell/AppLayout.tsx, LeftSidebar.tsx, MobileHeader.tsx, MobileAppShell.tsx, MobileBottomTabs.tsx, UserMenu.tsx, ThemeToggle.tsx, theme.ts, config/modules.ts, styles.css and tailwind.config.cjs.
Don't change any code yet. Write docs/design_handoff_app_shell/PLAN.md that covers: a file-by-file change list for the phases in PROMPTS.md, every component that reads the Neon Pop tokens (--color-n1..n4, font-display, pop-* classes), the risks, and any open questions (including the marquee/bannerText decision). Keep it under 150 lines.
```

## 1. Tokens, fonts, icons
```
Implement the design tokens from docs/design_handoff_app_shell/styles.css in src/web/spa/src/styles.css and tailwind.config.cjs:
- Dark is the default. Light theme goes under [data-theme="light"] on <html>, persisted in localStorage through the existing theme.ts/ThemeToggle.
- Expose the colours, the hue-* category colours, radii, shadows and fonts as Tailwind theme values that reference the CSS variables.
- Swap the fonts to Space Grotesk (headings, 600) and Manrope (body).
- Add @phosphor-icons/react.
- Keep the old token names as aliases for now so nothing breaks.
Don't touch layouts yet. Build must pass.
```

## 2. Module config as the single source
```
Extend src/web/spa/src/config/modules.ts so every launchable app has: id, label, path, group ('discover' | 'tools' | 'modules'), Phosphor icon, one-line description, and an access check that reuses the existing canAccess*/hasRole helpers. Admin entries stay in ADMIN_MODULES.
Use the grouping and descriptions in the README's "Information architecture" table.
Add getLauncherGroups(user), which returns every app (locked ones included) with a `locked` flag and a `lockReason` ('guest' | 'no-access').
Add unit tests if the repo has a test setup for the SPA. Don't change the UI.
```

## 3. Desktop shell: top bar, launcher, account menu
```
Replace LeftSidebar with the new shell described in README sections 1–3:
- TopBar: launcher button, wordmark, ⌘K search trigger, theme toggle, avatar or Sign in.
- LauncherDrawer: left slide-out with search, a Home row, a Pinned group, the three groups, the grid layout, lock states, and Esc/scrim/⌘K behaviour.
- AccountMenu: identity, Profile, Appearance, an Admin section gated by getVisibleAdminModules, and Sign out.
Then:
- Remove the md:pl-60 / md:pl-16 content offset and the SidebarCollapse context.
- Remove PopBackground. Replace PopMarquee with the home-only UpdatesBanner (README 1b): reads bannerText from BrandingContext, sessionStorage dismissal for signed-in users.
- Brand mark: Syne 800 "f" on #7c5cff. Install the favicons from docs/design_handoff_app_shell/assets/ in index.html and the web manifest.
- Use framer-motion for the drawer slide (260ms, cubic-bezier(.2,.8,.2,1)) and the scrim fade (200ms).
Make it match prototype/AppShell.dc.html at desktop widths.
```

## 4. Pinning
```
Add a usePins() hook: an array of app ids in localStorage under "funkedupshift_pins". New users default to shortener, websites, finances, vehicles-expenses, squash, media.
Wire it to the launcher's per-tile pin toggle (stopPropagation, 0.55 opacity at rest), to the launcher's Pinned group, and to the Pin/Pinned button in the app page header (next prompt).
Only for signed-in users, on apps they can open.
```

## 5. App page frame + section pages
```
Create an AppPage wrapper, used by every routed app and admin page:
- breadcrumb where every crumb is a link: Home › Group › App (Admin pages: Home › Admin › Page)
- icon-tile header with title and description from config, plus a Pin button
- a "More in {Group}" footer of chip links (locked apps greyed)
Add /apps/:group section pages that show the group's card grid.
Wrap the existing feature pages without changing their internals.
Spec: README section 6.
```

## 6. Homes
```
Rebuild HomePage as two views (README sections 4–5):
- Guest landing: the hero ("Funked up shift." with "up" in --color-accent-text), lead copy, CTAs, and one card grid per group with locked states.
- Signed-in dashboard: date, greeting ("Good morning|afternoon|evening, {firstName || username || email}." using device local time, computed once at render), Pinned grid with empty state, Recent short links card (reuse the tools/api listLinks), and a Recently used card (track the last 6 app routes in localStorage).
Remove the glitch wordmark, the parallax, the stickers, the stats counters and the role-breakdown sections.
```

## 7. URL Shortener restyle
```
Restyle src/web/spa/src/features/tools/ShortenerPage.tsx to match README section 7 and the prototype: form card, inline URL validation, the teal "Short link ready" banner with Copy, a single list card with dividers, the inline expiry editor, a confirm before delete, and the guest sign-in card.
Keep all the existing API calls and pagination.
Then apply the same form, list and button patterns to the other tool pages (password, images, crop, removebg, dns, textshare, converters, my-info, lipsync) without changing their logic.
```

## 7b. Themes
```
Implement README section 9:
- Backend: themes CRUD (admin only) and a siteSettings record {defaultThemeId, defaultMode}, seeded with Funk, Ember, Lagoon and Neon. Add themeId, mode and pins to the user profile. Deleting a theme must not need a migration: resolve a missing themeId to the default at read time.
- Frontend: a ThemeProvider that derives CSS variables from the theme record (port themeCSS() from the prototype) and sets data-palette and data-theme on <html>. Account menu Appearance section. /admin/themes page with defaults, cards, and the New/Edit dialog.
- Move usePins() persistence from localStorage to the profile API (keep localStorage as a cache).
```

## 8. Mobile web + native
```
Implement README section 8:
- At ≤640px: hide the top-bar launcher button, search and avatar; add a fixed bottom TabBar (Home, Apps, Search, Account/Sign in) with safe-area padding; turn the launcher into a bottom sheet (88vh max 720px, grabber); show the account menu as a sheet above the tab bar.
- Then make MobileAppShell (Capacitor) use the same TabBar, LauncherDrawer sheet and AccountMenu, and retire MobileBottomTabs, MobileMorePage and the old MobileHeader drawer.
- Check on an iOS-sized viewport that touch targets are at least 44px.
```

## 9. Clean-up + QA
```
Remove the unused Neon Pop code: pop-* CSS, Syne, the --color-n* aliases, PopBackground, PopMarquee, LeftSidebar, the SidebarCollapse context, and @heroicons/react if nothing uses it anymore.
Run the build and typecheck.
Then write a QA checklist covering guest, user, group member and admin views × dark and light × desktop and mobile, and walk through it, fixing what you find.
```
