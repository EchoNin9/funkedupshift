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

# Funkedupshift — "Neon Pop" Design Handoff

This package is a **developer handoff** for restyling the Funkedupshift app
(`src/web/`) into the **Neon Pop** visual system, plus one new feature
(admin-editable scrolling banner).

Feed this whole folder to Claude Code. Start by reading the files in this order:

1. `DESIGN_SYSTEM.md` — colors, type, components, motion. The source of truth for *look*.
2. `SCREENS.md` — per-screen layout + behavior specs.
3. `BANNER_TASK.md` — the one net-new feature to build (editable marquee banner).
4. The two HTML design references (see **Design files** below).

---

## About the design files

The two `.dc.html` files in this bundle are **design references created in HTML** —
prototypes that show the intended look, layout, and behavior. They are **not
production code to copy verbatim**. They use a small custom rendering runtime and
inline styles for prototyping speed.

Your job is to **recreate these designs inside the real codebase** — the existing
plain-JS/HTML/CSS frontend in `src/web/` (served from S3/CloudFront, talking to the
API Gateway + Lambda backend) — using that project's established patterns. Keep all
existing functionality (Cognito auth, data fetching, role gating); only the
**presentation layer** changes, plus the new banner feature.

- `Funkedupshift Home.dc.html` — the landing page (`src/web/index.html`).
- `Funkedupshift Pages (Pop).dc.html` — Neon Pop applied to Browse, Media, Add/Edit
  form, Sign in, and Admin. Maps to `websites.html`, `media.html`, `add-site.html` /
  `add-media.html` / `edit-*.html`, `auth.html`, and the admin pages
  (`users.html`, `categories.html`, `groups.html`, etc.).

To open a reference visually, load the `.dc.html` file in a browser (it self-bootstraps).

## Fidelity

**High-fidelity.** Colors, typography, spacing, radii, shadows, and interactions are
final. Recreate them precisely using the codebase's own CSS/markup conventions. Exact
hex values, font stacks, and measurements are in `DESIGN_SYSTEM.md`.

## What changes vs. what stays

**Changes (presentation only):**
- Global theme: fonts, colors, card/button/input styling, nav, footer, background.
- The scrolling marquee banner appears at the top of every page (under the nav).
- Dark/light theme toggle (swaps CSS custom properties on the root).

**Stays (do not break):**
- Cognito sign-in/up, JWT handling, `auth.js` / `auth-button.js`.
- All API calls and data models.
- Role-based gating (admin / manager / user) of links and actions.
- Existing routing between pages (`*.html`).

## New feature

The horizontal scrolling banner text must become **admin-editable** instead of a
hardcoded string. Full spec in `BANNER_TASK.md`.

## Design files

| File | Recreates |
|------|-----------|
| `Funkedupshift Home.dc.html` | `src/web/index.html` (landing) |
| `Funkedupshift Pages (Pop).dc.html` | Browse / Media / Add / Sign in / Admin |

## Screenshots (`screens/`)

Static reference captures (animations/glitch shown mid-frame):

| Image | Screen |
|-------|--------|
| `screens/1-home-hero.png` | Landing hero (Pop) |
| `screens/1b-home-works.png` | Landing "The Works" grid |
| `screens/2-browse.png` | Browse — "The Stash" |
| `screens/3-media.png` | Media — "The Library" |
| `screens/4-add-form.png` | Add / Edit form |
| `screens/5-signin.png` | Sign in |
| `screens/6-admin.png` | Admin (with editable banner card) |

## Suggested implementation order

1. Add a shared stylesheet (e.g. `src/web/pop.css`) defining the design tokens as CSS
   custom properties + the component classes (cards, buttons, inputs, pills, marquee).
2. Add fonts (Syne, Space Grotesk, JetBrains Mono) via Google Fonts `<link>`.
3. Restyle the shared chrome: top nav, marquee banner, footer. Factor into a small
   shared include/JS so every page renders identical chrome.
4. Restyle page-by-page: `index.html` → Browse → Media → forms → auth → admin.
5. Build `BANNER_TASK.md` (DynamoDB setting + API + admin editor).
6. Wire the dark/light toggle (persist choice in `localStorage`).
