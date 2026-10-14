# Handoff: Funkedupshift app shell + design system

## Overview
This replaces the "Neon Pop" look and the left sidebar in the React SPA (`src/web/spa/`) with a calmer system that still has plenty of colour. It covers:
- a lean **top bar** with a **slide-out app launcher**, replacing `LeftSidebar.tsx`
- **Admin moved into the avatar menu**
- **two homes**: a public landing for guests and a dashboard for signed-in users
- a standard **app page frame**: breadcrumb, icon header, pin button and a "More in…" footer
- **pinning** apps
- a **mobile layout**: bottom tab bar plus the launcher as a bottom sheet, intended for the native shell too
- the redesigned **URL Shortener** page as the reference tool page

## About the design files
The files in this bundle are **design references built in HTML**, not production code. Rebuild them inside the existing SPA (React + TypeScript + Tailwind + react-router + framer-motion) using its patterns. Keep all existing behaviour: Cognito auth, the API calls, the `canAccess*` role/group gating in `AuthContext.tsx` and `config/modules.ts`, impersonation and branding.

To view the prototype, serve this folder over HTTP (for example `npx serve .`) and open `prototype/AppShell.dc.html`. Its Tweaks switch the viewer between guest, user and admin, the theme between dark and light, and the launcher between grid and list.

## Fidelity
**High fidelity.** The colours, type, spacing, radii and interactions are final. `styles.css` is the source of truth for tokens; `DESIGN_SYSTEM.md` holds the rules.

## Information architecture
Every destination in `config/modules.ts` maps to one of three launcher groups plus Admin:

| Group | Hue token | Apps (access) |
|---|---|---|
| Discover | `--color-hue-teal` | Websites, Media, Memes, Internet Dashboard, Highlights, Highest Rated (all guests) |
| Tools | `--color-hue-violet` | My Info (guests); URL Shortener, Password Generator, Image Resizer, Crop Image, Remove Background, DNS Lookup, Text Share, Converters, Lipsync Studio (signed in) |
| Modules | `--color-hue-coral` | Finances (signed in); Investing, Vehicle Expenses, General Expenses, Squash, Meme Generator (group-gated through the existing `canAccess*` helpers) |
| Admin (avatar menu only) | `--color-hue-amber` | Admin home, Websites, Media, Membership, Recommended, Internet Dashboard, Branding, Stats, Social Scheduler, Lipsync Budgets (managers/superadmins, filtered with `getVisibleAdminModules`) |

Squash Admin stays reachable from Admin, and from the Squash page for those who can modify it. Add an `icon`, `description` and `group` to every entry in `PUBLIC_MODULES` so a single config drives the launcher, the landing page, the section pages and the "More in…" footers.

## Screens

### 1. Top bar (desktop, wider than 640px)
- Sticky, 60px tall, padding `0 20px`, gap 12px.
- Background `color-mix(in srgb, var(--color-bg) 84%, transparent)` with `backdrop-filter: blur(14px)` and a 1px `--color-divider` bottom border.
- Left to right:
  1. **Launcher button**: 36×36 `.btn-secondary.btn-icon`, Phosphor `squares-four` at 19px.
  2. **Wordmark**: a 28×28 mark (`.brand-mark.brand-mark-syne`: radius 8, `--color-brand` fill `#7c5cff`, a white "f" in **Syne 800** at 19px; never themed), then "funked**up**shift" in Space Grotesk 600 at 17px with -0.02em tracking. "up" is `--color-accent-text`.
  3. **Search trigger**: `flex: 0 1 380px`, 20px left margin, 38px tall, surface fill, 1px divider border, radius 10. It holds a magnifier icon, the muted text "Search apps and tools" and a `⌘K` keycap. Clicking it opens the launcher with search focused.
  4. A spacer.
  5. **Theme toggle**: ghost icon button showing a sun in dark mode and a moon in light mode.
  6. **Avatar or Sign in**: signed-in users get a 36px circle with a `linear-gradient(135deg, hue-violet, hue-coral)` fill and initials in Space Grotesk 600 at 14px; it opens the account menu. Guests get a `.btn-primary` "Sign in".
- Remove `PopBackground`. Replace `PopMarquee` with the **updates banner** (section 1b).

### 1b. Updates banner (home page only)
- Sits directly under the top bar, **only on `/`** (guest landing and dashboard). Height 40px, background `color-mix(accent 14%, bg)`, 1px divider bottom border.
- Content: an `.tag-accent` "Updates" label with a megaphone icon, then the admin-editable `bannerText` (split into items) scrolling in a `.marquee` / `.marquee-track` loop: 60s linear, items separated by an accent-text ✦, edges faded with a mask, paused on hover, static under `prefers-reduced-motion`.
- **Signed-in users** get an ✕ (32px ghost icon button, title "Hide until your next visit"). Dismissal is stored in **`sessionStorage`** (`funkedupshift_banner_dismissed`), so it returns in every new session. Guests can't dismiss it.

### 2. Launcher drawer
- Slides in from the left: `position: fixed`, full height, `width: min(440px, 92vw)`, surface background, `--shadow-lg`.
- Motion: `transform: translateX(-104%)` to `none` over 260ms with `cubic-bezier(.2,.8,.2,1)`.
- The scrim behind it is `color-mix(#08080c 55%)` and fades over 200ms. Clicking the scrim, pressing Esc or choosing an app closes the drawer. ⌘K / Ctrl+K opens it from anywhere.
- Contents, top to bottom:
  1. **Header**: "Apps" in Space Grotesk 600 at 20px, plus a close button.
  2. **Search input** with placeholder "Search N apps". It filters on name and description.
  3. **Home row**: labelled "Home — your dashboard" when signed in.
  4. **Pinned group**: shown first, only when signed in and the search box is empty.
  5. **The three groups**, each with a section label: a 7px hue dot, the group name in uppercase 12px 700 with .06em tracking, and the app count.
  6. **Footer hints**: "⌘K open · Esc close · N locked". Desktop only.
- **Grid tile** (3 columns, 4px gap): padding `12px 6px 10px`, radius 10, transparent background, `--color-surface-2` on hover.
  - Icon: a 46px tile with radius 13 and a 17% hue tint behind the icon in its hue, at 23px. Use the `.app-icon` + `.hue-*` classes.
  - Label: 12px, weight 600, centred.
  - The current app gets `.is-current` (surface-2 background).
- **List row** (the alternative layout): a 34px icon tile, the name at 14px 600 and the description at 12px muted, truncated.
- **Pin toggle**: shown on each tile for signed-in users on apps they can open. A 24px target in the top-right corner, Phosphor `push-pin` (the `fill` weight when pinned), 0.55 opacity at rest and 1 when hovered or pinned. Clicking it must not open the app (`stopPropagation`).
- **Locked apps** (`.is-locked`: 50% opacity, greyscale) carry a 20px lock badge on the icon corner.
  - Guests who click one go to `/auth`.
  - Signed-in users without access get an inert tile (`.is-inert`, `cursor: not-allowed`) with the tooltip "{App} — ask an admin for access".

### 3. Account menu
- Fixed position, 64px from the top and 16px from the right, 300px wide, surface background, 1px divider border, radius 16, `--shadow-lg`, 8px padding, scrolls when content is too tall.
- Contents, top to bottom:
  1. **Identity**: 40px gradient avatar, display name in 14px 700, email in 12px muted, and a role tag (`.tag-accent`: "Admin" or "User").
  2. Profile.
  3. **Appearance**: toggles the theme and shows the current value.
  4. **Admin section**: only when `getVisibleAdminModules(user)` is non-empty. A divider, an uppercase "Admin" label (11px), then the admin links.
  5. A divider, then **Sign out** in `--color-danger`.
- Rows are 9×10px padding, radius 8, 14px text with an 18px muted icon, and `--color-surface-2` on hover. A transparent full-screen layer behind the menu closes it.

### 4. Guest landing (`/` when signed out)
- **Hero**: 80px top and 40px bottom padding, max-width 880px, left aligned.
  - Three outline tags, each with a hue dot: Discover, Tools, Modules.
  - H1 "Funked **up**<br>shift." in Space Grotesk 600, `clamp(52px, 9vw, 112px)`, line-height 0.9, letter-spacing -0.05em. "up" is `--color-accent-text`; the final "." is `--color-accent`.
  - Lead paragraph at 19px/1.5, muted, max-width 560px: "A curated index of the web, a media library and a kit of everyday tools. Open to browse — sign in to rate, save and use the modules."
  - Buttons: `.btn-primary.btn-lg` "Explore all apps" (opens the launcher) and `.btn-secondary.btn-lg` "Browse websites".
- **One section per group**:
  - Header: a 9px hue dot, H2 at 24px, and a muted blurb (Discover "Open to everyone.", Tools "Everyday utilities — free with an account.", Modules "Personal apps for invited groups.").
  - A card grid using `repeat(auto-fill, minmax(250px, 1fr))` with a 12px gap.
- **App card**: surface background, 1px divider border, radius 16, 18px padding, 14px gap.
  - Content: a 42px icon tile, the name at 15px 700 and the description at 13px/1.45 muted.
  - Hover: the border becomes `--color-border-strong` and the card lifts 2px (`translateY(-2px)`), 150ms.
  - Locked: `.is-locked`, plus a lock label in the top-right corner (12px 600): "Sign in" for guests, "No access" for signed-in users.

### 5. Dashboard (`/` when signed in)
- **Header row**: 52px top and 32px bottom padding, space-between, wraps on narrow screens.
  - Left: the local date as `weekday, month day`, 13px 600 muted. Under it an H1 at `clamp(36px, 5vw, 54px)` with -0.04em tracking.
  - H1 text: "Good morning|afternoon|evening, {firstName || username || email}." The cut-offs are under 12:00, under 18:00, then evening, using the device's local time. Work it out once at render; there's no need to re-check while the page is open. If no name is available, drop the ", name" part.
  - Right: `.btn-secondary` "All apps" with the grid icon.
- **Pinned**:
  - Label in uppercase 13px 700, then the hint "Pin any app with the pin button in its page header, or right from the launcher."
  - Tiles in a grid of `repeat(auto-fill, minmax(180px, 1fr))` with a 10px gap. Each has 12px padding, radius 10, a 38px icon tile, the name at 14px 700 and the group label at 12px muted.
  - Empty state: a dashed box reading "No pinned apps yet."
- **Two cards** in a grid of `repeat(auto-fit, minmax(min(100%, 360px), 1fr))` with a 16px gap:
  - **Recent short links**: the latest 3, each with a Copy button, plus an "Open shortener →" ghost link in the header.
  - **Recently used**: app rows, each with a relative time.
  - Card style: surface background, 1px divider border, radius 16, 20px padding.

### 6. App page frame (every app, admin page and Profile)
- **Breadcrumb**: 28px top padding, 13px muted text with `caret-right` separators: Home › {Group} › {App}. **Every crumb is a link.**
  - The Group crumb goes to a **section page** at `/apps/{group}` that shows the group's header and its card grid.
  - On admin pages the middle crumb is "Admin" and goes to `/admin`. On Profile it is "Account".
  - The current crumb is `--color-text` 600 with `aria-current="page"`.
- **Header**: 18px top and 28px bottom padding, 16px gap, wraps.
  - A 54px icon tile (radius 14, 28px icon), then an H1 at `clamp(28px, 3.5vw, 36px)` with -0.035em tracking and the muted description below it.
  - On the right, a **Pin / Pinned** `.btn-secondary` with a `push-pin` icon in accent-text, filled when pinned. Only for signed-in users with access.
- **Body**: the app's existing screen, full width, max 1180px with 24px gutters (16px on mobile).
- **Footer**: "More in {Group}", an uppercase 13px label, then a wrapping row of `.btn-secondary` chips (a 26px icon tile and the name) for the other apps in the group. Locked apps show `.is-locked`. Admin pages list the other admin pages instead.

### 7. URL Shortener (reference tool page)
- **Form card**: surface background, divider border, radius 16, 14px padding. A 48px-tall input with a leading `link-simple` icon and the placeholder "https://example.com/some/very/long/path", then a 48px `.btn-primary.btn-lg` "Shorten".
- **Validation**: the URL must match `^https?://` plus a domain. Otherwise show the 13px 600 danger text "Enter a full URL starting with http:// or https://". Keep the API's own error messages.
- **Success banner**:
  - Style: `color-mix(hue-teal 12%, surface)` fill and a teal 35% border.
  - Contents: a `check-circle` icon, the small label "Short link ready", the short URL in Space Grotesk 600 at 20px, and a Copy button.
- **"Your links"**:
  - Header: H2 at 20px, a count tag, and on the right "Links expire after 90 days unless you change the date."
  - List: a single card with `.row-list` dividers.
  - Each row: the short URL (accent-text, 15px 700), the destination (13px muted, truncated), and "Created {date} / Expires **{date}**" at 12px.
  - Row actions:
    - Copy: changes to "Copied" with a check icon for 1.8s.
    - Edit expiry: a calendar icon that opens an inline `datetime-local` editor with Save and Cancel. The date must be in the future; otherwise show "Pick a date and time in the future."
    - Delete: a trash icon in danger colour, behind a confirm.
  - Empty state: "No short links yet — mint one above."
  - Keep the existing load-more pagination.
- **Guest state**: a card with a lock icon, "Sign in to create short links / Your links stay private to your account." and a Sign in button.

### 8. Mobile (640px wide and under, and the native Capacitor shell)
- **Top bar**: just the wordmark and the theme toggle. The launcher button, search, avatar and Sign in are hidden (`.only-wide`).
- **Bottom tab bar** (`.tabbar`):
  - Fixed to the bottom, with `padding-bottom: env(safe-area-inset-bottom)`, a blurred translucent surface background and a 1px top border.
  - Four tabs, each 56px tall: Home · Apps · Search · Account (Sign in for guests). Icons are 23px, labels 11px 600; the active tab is accent-text.
  - Apps opens the launcher without the keyboard. Search opens it with the input focused.
- **Launcher as a bottom sheet**: full width, height `min(88vh, 720px)`, radius 16 on the top corners only, a 36×4 grabber, sliding with `translateY(104%)` to `none`.
- **Account menu**: a sheet with 8px side insets, sitting 76px plus the safe-area inset above the bottom.
- **Content**: 16px gutters. The footer is padded clear of the tab bar.
- **Native app**: replace `MobileBottomTabs.tsx`, `MobileMorePage.tsx` and `MobileHeader.tsx` with the same tab bar and launcher, so web and native share one model.

### 9. Themes
- **Built-in themes** (each works in dark and light): **Funk** (default; accent `#7c5cff`, tint 285, Discover `#33c9aa`, Tools `#9a82ff`, Modules `#ff7f5c`, Admin `#f2b73f`), **Ember** (accent `#ff6a3d`, tint 45, `#f2b73f` / `#ff8fab` / `#b18cff` / `#5fd0a0`), **Lagoon** (accent `#3d7bff`, tint 230, `#2ec4b6` / `#8fa8ff` / `#ffb454` / `#ff7a93`), **Neon** (accent `#a3e635`, tint 150, `#22d3ee` / `#f472b6` / `#facc15` / `#fb923c`).
- **A theme record** is `{id, name, tint (0–360), accent, discover, tools, modules, admin}`. The full token set is derived from it (see `themeCSS()` in the prototype's logic class): grounds and text are oklch values at the theme's tint; light mode deepens every colour with `color-mix(in oklch, c 70–86%, black)` so it holds contrast; `on-accent` flips to dark text on bright accents. Apply with `data-palette="{id}"` alongside `data-theme="dark|light"` on `<html>`.
- **Users (signed in):** the account menu's Appearance section has a Dark/Light segmented control and a 2-column grid of theme chips (accent + two hue dots, rendered in that theme; selected = 2px accent ring). Saved **server-side on the user profile** (`themeId`, `mode`), next to pins, so it survives sign-out/in and other devices.
- **Admin › Themes** (`/admin/themes`, managers/superadmins):
  - *Site defaults* card: default theme (chips) and default mode (segmented). Used for guests and users with no preference.
  - *Theme cards*: dark + light mini previews (mark, four hue tiles, button, link), name, "Site default" / "Your theme" tags, actions Make default · Edit · Delete. The default can't be deleted.
  - *New / Edit dialog*: name, ground-tint slider, five colour pickers (Accent, Discover, Tools, Modules, Admin), live dark + light previews.
  - **Delete** asks for confirmation; any user whose `themeId` points to it falls back to the site default (resolve at read time: if the stored id no longer exists, use the default).
- **Brand mark and favicon stay `#7c5cff` under every theme.**

## State
- `drawerOpen`, `query`, `menuOpen`, `theme`, `pins: string[]`.
- `theme` lives in `localStorage` (extend `ThemeToggle`/`theme.ts`) by setting `data-theme="light"` on `<html>`.
- `pins`, `themeId` and `mode` persist **on the user profile through the API** (cached in localStorage), so they survive signing out and back in. Guests keep `mode` in localStorage only.
- Themes and site defaults are stored server-side (a `themes` table/collection plus a `siteSettings` record); every page load reads them once. Default pins for new users: URL Shortener, Websites, Finances, Vehicle Expenses, Squash, Media.
- "Recently used" can come from a localStorage history of the last 4–6 app routes visited, or from the existing stats click-path data.
- Locked-state rules: reuse the `LockedGroupRow` logic (guest → `/auth`, signed in → inert).

## Design tokens (`styles.css`)
- **Dark** (the default):
  - Backgrounds and text: bg `#111117`, surface `#1a1a22`, surface-2 `#23232d`, text `#ececf1`, muted `#a1a1b0`.
  - Lines: divider is text at 11%, border-strong is text at 24%.
  - Accent: `#7c5cff`, hover `#9076ff`, accent-text `#a790ff`, on-accent `#fbfaff`.
  - Category hues: violet `#9a82ff`, coral `#ff7f5c`, teal `#33c9aa`, amber `#f2b73f`. Danger `#ff6b6b`.
- **Light** (`[data-theme="light"]`):
  - Backgrounds and text: bg `#f6f6f9`, surface `#fdfdff`, surface-2 `#efeff4`, text `#15151c`, muted `#5b5b6b`.
  - Accent: `#6a48f5`, accent-text `#5434e0`.
  - Category hues: violet `#6a48f5`, coral `#d9502a`, teal `#0e9479`, amber `#b97c06`. Danger `#d63a3a`.
- **Type**: headings Space Grotesk 600 with -0.025em tracking (display sizes down to -0.05em). Body Manrope at 15px/1.55; labels and buttons 600–700.
- **Spacing**: 4 / 8 / 12 / 16 / 24 / 32. **Radius**: 6 / 10 / 16. Icon tiles: 26 / 32–34 / 38–42 / 46 / 54px.
- **Shadows**: dark mode uses a hairline ring plus ambient black (`--shadow-sm/md/lg`); light mode uses soft rgba(20,20,40) shadows.
- **Focus**: a 2px accent outline with a 2px offset. Inputs on focus: accent border plus a 3px accent halo at 28%.
- **Motion**: 150ms for hover, 200ms for the scrim, 260ms for the drawer. No spring easing and no rotation.
- **Mapping**: map these into `tailwind.config.cjs` and `src/web/spa/src/styles.css` as CSS variables, replacing the Neon Pop `--color-n1..n4` tokens and the Syne/brutalist utilities.

## Assets
- **Icons**: Phosphor (`@phosphor-icons/react`), regular weight, with `fill` for pinned pins and `bold` for the small lock badge. This replaces `@heroicons/react`.
- **Fonts**: Google Fonts, Space Grotesk 500/600/700 and Manrope 400/500/600/700.
- **Favicon**: `assets/favicon-{16,32,48,180,192,512}.png` (purple rounded square, white Syne 800 "f"). Use 32 as `<link rel="icon">`, 180 as `apple-touch-icon`, 192/512 in the web manifest and for the Capacitor app icon.
- **Fonts**: add Syne 800 (brand mark only).
- No other images. The hero background image from Branding can stay optional behind the landing hero.

## Files
- `prototype/AppShell.dc.html`: the interactive prototype covering every screen above. Its logic class at the bottom of the file holds the app list, access rules and state.
- `styles.css`: tokens and component classes (`.btn*`, `.input`, `.tag*`, `.card*`, `.app-icon`, `.hue-*`, `.is-locked`, `.launcher`, `.tabbar`, `.tab`, `.account-menu`, `.only-wide`, `.only-narrow`).
- `DESIGN_SYSTEM.md`: the system rules (do / don't).
- `PROMPTS.md`: staged starter prompts for Claude Code.
- `assets/`: favicon PNGs.
