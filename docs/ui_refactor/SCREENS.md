> ⚠️ **HISTORICAL HANDOFF — describes the non-deployed legacy HTML frontend (`src/web/*.html`).**
>
> The live application is the **React SPA** in `src/web/spa/`. This document was part of the
> original "Neon Pop" design handoff and was implemented against the SPA during epic FUNK-1
> (FUNK-2…FUNK-11). Treat it as **design intent / history, not a current spec** — several details
> drifted from what shipped.
>
> **Canonical source of truth = the SPA code:** design tokens live in
> `src/web/spa/src/styles.css` + `tailwind.config.cjs`; screens are components under
> `src/web/spa/src/features/*` and shell chrome under `src/web/spa/src/shell/` (not `*.html`).
>
> **Known drifts to ignore here:** media items are `image`/`video` with **no `year`** field
> (not a Film/Shows/Albums catalog); page "targets" are SPA routes/components, not the `*.html`
> files referenced below.

# Screens

Each section maps a design to its target page(s) in `src/web/`. Styling details (exact
hex, type, shadows) are in `DESIGN_SYSTEM.md`; this file covers **layout, content, and
behavior**. All screens share the same fixed top nav, marquee banner, footer, neon
background, and (optional) custom cursor.

---

## Shared chrome (every page)

**Top nav** (fixed, ~60px, `backdrop-filter: blur(12px)`, semi-transparent `--bg`,
bottom border `2px solid var(--fg)`):
- **Left:** brand — pulsing neon dot (`--n1`) + "FUS" in Syne 800. Links to `index.html`.
- **Center:** nav buttons — Browse · Media · Add · Sign in · Admin. Neon-green `#39ff7a`
  (active = filled + glow, inactive = outlined). In the real app these are `<a>` links
  to the corresponding pages; the current page's link is the "active" one. Apply
  role-gating exactly as today (e.g. Admin only for admins/managers).
- **Right:** dark/light theme toggle (sun/moon icon + label).

**Marquee banner:** full-bleed strip directly under the nav (see DESIGN_SYSTEM §3 and
`BANNER_TASK.md`).

**Footer:** top border `2px solid var(--fg)`; "© 2026 FUNKEDUPSHIFT" (Syne) left; nav
links right; over a slightly darkened `--bg`.

---

## 1. Landing — `index.html`

**Purpose:** funky front door + hub of the user's mini-apps/works.

**Layout:** full-bleed hero (~74vh) centered, then "The Works" card grid, then footer.

- **Hero:** glitch RGB-split wordmark "FUNKED / UP SHIFT" with mouse parallax (see
  DESIGN_SYSTEM §5), subtitle, a primary CTA ("ENTER THE FUNK ↓" → scrolls to works),
  and 3 floating sticker badges in the corners.
- **Marquee** strip below hero.
- **Works grid:** `repeat(auto-fill, minmax(290px, 1fr))` of brutalist cards, one per
  app/work. Each card: 2-digit index (Syne, accent color), status pill (LIVE / BUILDING
  / SOON), title (Syne, uppercase), one-line blurb, footer row (tag + "OPEN ↗"), resting
  rotation ±1.5° straightening on hover, hard offset shadow shifting on hover.

**Works content** (title — blurb — status — link):
- Expense Tracker — "Every dollar, logged daily." — LIVE
- Financial App — "Budgets, forecasts & net worth." — BUILDING
- Merch Store — "Funky goods, dropping soon." — SOON
- Site Catalog — "A curated stash of the web." — LIVE → `websites.html`
- Media Library — "Films, shows & music, all tagged." — LIVE → `media.html`
- Internet Dashboard — "My corner of the net at a glance." — LIVE → `internet-dashboard.html`
- Squash Tracker — "Matches, ladders & stats." — LIVE → `squash.html`
- Something New — "Cooking up the next funky thing." — SOON

(Wire these to the real destinations/labels that exist in the app; the above is the
intended set + tone.)

---

## 2. Browse — `websites.html`  ("The Stash")

**Purpose:** browse/search the catalog of saved sites.

**Layout:**
- Header row: H1 "THE STASH" + sub ("N sites worth keeping — rated, tagged, never
  lost."), and a primary "+ ADD SITE" button (→ `add-site.html`) on the right.
- Toolbar: a search input (flex-grow, with a search glyph) + filter pills (All, Tech,
  Design, Music, Film, Fun, … driven by real categories). Pills highlight on hover
  (cyan border).
- Grid: `repeat(auto-fill, minmax(290px, 1fr))` of site cards.

**Site card:** favicon/initial chip (neon fill, ink letter) + title (Syne) + domain
(JetBrains Mono, muted) on the top row; blurb; tag pills; divider; footer row = star
rating (`--n2`) left, "OPEN ↗" right. Whole card links to the site/detail. Brutalist
hover. (Map to existing site fields: title, url/domain, description, tags, rating.)

---

## 3. Media — `media.html`  ("The Library")

**Purpose:** browse logged films / shows / albums.

**Layout:** header (H1 "THE LIBRARY" + type filter pills: All, Film, Shows, Albums) then
a poster grid `repeat(auto-fill, minmax(180px, 1fr))`.

**Media card:** `aspect-ratio: 2/3` poster (real artwork if available; otherwise a
diagonal-striped placeholder), a type badge (neon fill) top-left, title (Syne) below,
and a row with star rating + year. Lift on hover.

---

## 4. Add / Edit form — `add-site.html`, `edit-site.html`, `add-media.html`, `edit-media.html`

**Purpose:** create/update a catalog entry.

**Layout:** centered column, max-width ~660px. H1 ("ADD TO THE STASH") + sub. One
brutalist card (`box-shadow: 8px 8px 0 var(--n3)`) containing a vertical stack of
labeled fields:
- URL (text), Title (text), Description (textarea, 3 rows)
- Row of two: Category (`<select>`, custom-styled, `appearance: none`) + Tags (text,
  "comma, separated")
- "Your rating" — 5 star glyphs (interactive in the real form)
- Footer actions, right-aligned: **Cancel** (ghost) + **SAVE SITE** (primary pop).

Inputs use the focus treatment (neon border + 3px hard offset). Reuse the page's
existing validation + submit logic; only restyle. Edit variants prefill values and read
"SAVE CHANGES".

---

## 5. Sign in — `auth.html`

**Purpose:** Cognito sign-in / sign-up.

**Layout:** centered auth card (max-width ~430px), `box-shadow: 9px 9px 0 var(--n1)`,
with a floating "welcome back" sticker badge above its top-right corner.
- H1 "SIGN IN" + sub.
- Email + Password fields (focus = cyan border + hard offset).
- Full-width primary button "ENTER THE FUNK →".
- Footer line: "New here? **Create an account**" (toggles to the sign-up flow).

Keep all real Cognito wiring (`auth.js`). This is presentation only. Mirror the same
card for the sign-up / confirm states.

---

## 6. Admin — `users.html` / `categories.html` / `groups.html` (admin area)

**Purpose:** manage banner, users, categories. Gate behind admin/manager role.

**Layout:** H1 "ADMIN" then a responsive grid (`repeat(auto-fit, minmax(320px, 1fr))`,
`align-items: start`) of panel cards:

1. **Scrolling banner** (full width, highlighted with a yellow border + "EDITABLE"
   badge) — the new feature. Textarea bound to the banner value, helper text, a **live
   marquee preview** that updates as you type, and a **SAVE BANNER** button. Full spec in
   `BANNER_TASK.md`.
2. **Users** — list of users: initial chip + email + role pill (color by role). Reuse
   existing user-management actions (edit/role change).
3. **Categories** — wrap of category pills each with an "×" remove affordance, plus an
   "add category" input + ADD button. Reuse existing category CRUD.

Each panel is a brutalist card with a different accent shadow.

---

## Responsive

- Nav center buttons wrap on narrow widths; consider a condensed/menu treatment under
  ~640px.
- Grids already collapse via `auto-fill` minmax.
- Hide the custom cursor and reduce parallax on touch / small screens.
- Forms and auth card go full-width with side padding on mobile.
