# App-shell redesign — QA (wave 4, `redesign/cleanup-qa`)

**Bottom line:** every surface in the matrix renders with no uncaught errors, no horizontal overflow
(1280 / 375 / 320) and correct role gating, in both themes. This was verified headless. Signed-in
cells ran against **stubbed** auth and API data, so they still need a manual look on staging with
real accounts. Four things were fixed along the way and a short list of follow-ups remains (see
[Findings](#findings)).

## How this was run

- `npx vite build && npx vite preview --port 4173`, driven by headless Chromium
  (`/opt/pw-browsers/chromium_headless_shell-1194`) through Playwright. The script is
  [`qa-screenshots/qa-sweep.js`](qa-screenshots/qa-sweep.js); results were 168 page loads, 0 flagged.
- **Stubbed, not real.** Playwright route interception does three things:
  - serves a fake `config.js` that defines `window.API_BASE_URL` and a `window.auth` stub, one per persona
    (guest / user / group member / admin);
  - answers `GET /me`, `/profile`, `/themes`, `/site-settings`, `/s`, `/memes*` with canned JSON
    (everything else returns `{}`);
  - blocks Google Fonts, so **Space Grotesk, Manrope and Syne did not load**. Type was rendered in the
    system fallback, so exact glyph metrics and the brand mark need a staging look.
- Personas: `user` = `groups:["user"]`, `member` = user + `customGroups:["Memes"]`, `admin` = `groups:["admin"]`.
- Each load recorded: `data-theme` matched the requested mode, final URL and `<h1>` (gating),
  `scrollWidth > clientWidth` (overflow), and `pageerror` / `console.error` (excluding blocked network).
- No test credentials exist in the cloud sandbox and `stage.funkedupshift.com` is not reachable, so
  nothing here touched real Cognito or the real API.

Legend: ✅ verified headless · 🧪 verified headless against stubbed auth/API, **needs manual check on staging** ·
⬜ not covered headless.

## Matrix

Cells read *dark / light* at *desktop 1280 / 375 / 320*. 320px was loaded for every page (no overflow); screenshots
were kept for 1280 and 375 (and the 320 home).

| Surface | Guest | User | Group member (Memes) | Admin |
|---|---|---|---|---|
| **Home** (landing / dashboard) | ✅ landing, hero, group grids, locked tiles | 🧪 greeting, Pinned empty/defaults, recents | 🧪 | 🧪 |
| **Launcher** (desktop drawer, mobile sheet) + search, pins, lock states | ✅ opens from top bar / Apps tab; lock icons + 50% greyscale on gated apps | 🧪 pin state, no-access inert tiles | 🧪 Meme Generator unlocked | 🧪 everything unlocked |
| **Account menu** (+ Appearance, Admin section) | n/a (Sign in) | 🧪 Appearance (mode + theme chips); no Admin section | 🧪 same as user | 🧪 Admin section lists all admin modules |
| **App-page frame** (`/websites`) breadcrumb + icon tile + Pin + "More in…" | ✅ (no Pin for guests) | 🧪 | 🧪 | 🧪 |
| **`/apps/:group`** (`/apps/tools`) | ✅ | 🧪 | 🧪 | 🧪 |
| **Shortener** | ✅ "Sign in to create short links" card | 🧪 form + links list (stub item), Copy / expiry / delete | 🧪 | 🧪 |
| **Canvas tool** (`/crop`) | ✅ sign-in gate | 🧪 file picker card, processed-locally copy | 🧪 | 🧪 |
| **Memes — guest view** | ✅ list visible, Share link, no Rate/search/My Memes, "Sign in to rate or create" | n/a | n/a | n/a |
| **Memes — signed-in non-member** | n/a | 🧪 list + Rate; **no** All/My Memes tabs, no search; no create entry point | n/a | n/a |
| **Memes — member** | n/a | n/a | 🧪 All / My Memes tabs + search | 🧪 |
| **Admin › Themes** | ✅ redirects to `/auth` | 🧪 "Access Denied" (superadmin-only) | 🧪 "Access Denied" | 🧪 site defaults, theme cards with dark+light previews, New theme |

Extra pages swept for admin + guest in both themes, both widths (`qa2`): `/media`, `/admin`, `/admin/branding`,
`/admin/membership`. These are the legacy-styled pages that carried the old `n1–n4` colours; light-mode contrast looked fine
(hue tokens are the deepened variants in light).

Screenshots kept in [`qa-screenshots/`](qa-screenshots/): guest home (dark desktop, light 375), launcher sheet (dark 375),
account sheet (admin, light 375), memes (guest 375), shortener (signed-in 375), websites (guest light desktop), Admin › Themes (light desktop).

## Findings

### Fixed in this PR

1. **Heavy 2px footer rule** on every desktop page (and the old mobile shell header): left over from Neon Pop (`border-t-2 border-text-primary`) → hairline `border-border-default`.
2. **Account sheet scrim covered the TabBar on mobile.** It now stops above the tab bar (`bottom: 68px + safe-area`), so the tabs stay tappable. This matches the prototype, where the account menu sits above the tab bar.
3. **Double page padding on admin pages.** Themes, Admin dashboard and Stats nested `container-max section-padding` inside the app-page frame, which indented them ~32px and left a large gap under the header. The wrappers were removed. Themes and the Admin dashboard were re-checked in light desktop after the fix; Stats was not.
4. **`hydratePins` cross-user seeding** (wave 3 follow-up): the pins cache is now stamped with its owner (`funkedupshift_pins_owner`); a cache from another user (or an unowned legacy cache) is discarded and never seeds the server.

### Not fixed — needs a decision or a staging look

- **Staging checks (all 🧪 cells):** repeat the matrix with real accounts. Things stubs can't prove: real `/profile` pin/theme round-trip, `canAccess*` against real group data, impersonation banner on mobile, Admin menu visibility for `manager`.
- **Fonts:** confirm Space Grotesk headings / Manrope body / Syne brand mark on staging (blocked here).
- **Memes create entry point:** for a group member the Memes page shows no "Create meme" button in the header area. It is reachable only from the launcher (Meme Generator). Consider a primary action next to Pin.
- **Admin frame top gap:** admin pages start ~24px lower than other app pages (breadcrumb at y≈146 vs 122). Cosmetic; comes from `AdminLayout` wrapper spacing.
- **Hover "lift" on cards removed** (legacy `.card` is now a hairline surface). Cards that were `<div class="card">` get no hover state; only `a.card`, `button.card` and `.card-hover`.
- **Brand mark** still uses Syne via `.brand-mark-syne` and `ThemeChips` (`var(--font-brand)`), by design; `font-display` now means Space Grotesk everywhere.
- **Native app:** `MobileAppShell` still uses `MobileBottomTabs` / `MobileMorePage` (kept per brief; builds, no deleted imports). Follow-up: a route table shared with `AppLayout`, then adopt `TabBar` + sheet launcher.
- **`npm run typecheck`** still reports the 3 pre-existing errors (DashboardPage, VehiclesExpensesPage, SiteDetailPage); none in touched files.
- **320px:** no horizontal overflow on any page (measured on all). Only the home page was viewed visually: greeting wraps, updates marquee and tab bar labels fit.
- **prefers-reduced-motion:** CSS rules cover `.marquee-track`, launcher transitions and the new `.btn`/`.input`/`.card` transitions. Not exercised in the headless run.
