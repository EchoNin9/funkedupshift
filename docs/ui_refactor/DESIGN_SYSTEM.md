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

# Neon Pop — Design System

A funky, neon-brutalist system: bold neon on a deep-plum (or warm-white) base,
chunky uppercase display type, hard-offset shadows, springy hovers, and drifting
neon ambiance.

---

## 1. Color tokens

Define these as CSS custom properties on the page root (`:root` or a theme wrapper)
and reference them everywhere. The dark theme is the default.

### Dark (default)
```css
--bg:    #0c0814;  /* page background (deep plum-black) */
--bg2:   #170d27;  /* panel / card surface */
--fg:    #fdf6ff;  /* primary text + brutalist borders */
--muted: #9a85b5;  /* secondary text */
--line:  rgba(255,255,255,.16); /* hairlines, subtle borders */
--n1:    #ff2bd6;  /* neon magenta — primary accent */
--n2:    #ffe600;  /* neon yellow */
--n3:    #00e5ff;  /* neon cyan */
--n4:    #b6ff3d;  /* neon lime */
```

### Light
```css
--bg:    #fff7ec;
--bg2:   #ffffff;
--fg:    #14081a;  /* near-black text + borders */
--muted: #6b5a7a;
--line:  #14081a;  /* brutalist black hairlines */
--n1:    #ff2bd6;
--n2:    #ffd400;
--n3:    #00b8d4;
--n4:    #7bd000;
```

The **theme toggle** swaps these variable values on the root element. Persist the
choice in `localStorage` and re-apply on load. Default to dark.

### Special-purpose
- **Nav buttons** use a dedicated neon green: `#39ff7a` (fill when active, with glow
  `0 0 14px rgba(57,255,122,.6)`; outline + green text when inactive). This is the one
  accent that is NOT theme-swapped — keep it green in both themes.
- Hard-shadow / brutalist borders against neon fills use ink `#14081a`.

---

## 2. Typography

Load via Google Fonts:
```
https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500;700&family=Syne:wght@700;800&display=swap
```

| Role | Family | Weight | Transform | Notes |
|------|--------|--------|-----------|-------|
| Display / headings / buttons | **Syne** | 800 | UPPERCASE | letter-spacing ~ -0.01em, line-height ~0.9–0.95 |
| Body / UI / labels | **Space Grotesk** | 400 / 500 / 700 | none | base 14px |
| Mono details (URLs, banner, code) | **JetBrains Mono** | 400 / 500 | none | 11–13px |

Type scale (px): page H1 `clamp(30, 5vw, 52)`; section H2 `18–20`; card title `18`;
body `13–14`; labels/meta `10–12`.

---

## 3. Components

### Brutalist card
```
background: var(--bg2);
border: 3px solid var(--fg);
border-radius: 8px;
box-shadow: 8px 8px 0 var(--nX);   /* hard offset, colored per card */
```
**Hover** (springy): `transform: translate(-3px,-3px); box-shadow: 12px 12px 0 var(--nX);`
with `transition: transform .15s cubic-bezier(.34,1.56,.64,1), box-shadow .15s ease;`
Cards on the home "Works" grid also carry a slight resting rotation (~±1.5deg) that
straightens to 0 on hover.

Accent color per card cycles through `--n1 → --n2 → --n3 → --n4`.

### Primary button (pop)
```
background: var(--n2);           /* or --n1 */
color: #14081a;
font-family: Syne; font-weight: 800; text-transform: uppercase;
border: 3px solid #14081a;
border-radius: 12px;
box-shadow: 6px 6px 0 #14081a;
```
**Hover:** `transform: translate(-2px,-2px); box-shadow: 8px 8px 0 #14081a;`
(same spring easing).

### Secondary / ghost button
Transparent bg, `2px solid var(--line)`, `color: var(--fg)`, radius 11px.

### Nav button (top bar)
`2px solid #39ff7a`, radius 10px. Active = filled `#39ff7a` with dark text `#0c0814`
+ green glow. Inactive = transparent with green text.

### Inputs / textarea / select
```
background: var(--bg);
border: 2px solid var(--line);
border-radius: 9px;
color: var(--fg);
padding: 12px 14px;
```
**Focus:** `border-color: var(--nX); box-shadow: 3px 3px 0 var(--nX);` (no glow blur —
a hard 3px offset). Labels above fields in Syne 800, 12px, uppercase.

### Pills / tags / badges
Rounded (`border-radius: 20–30px`). Two flavors:
- **Quiet tag:** `1.5–2px solid var(--line)`, muted text.
- **Loud badge:** solid neon fill, ink text `#14081a`, `2px solid #14081a` + hard
  `4px 4px 0 #14081a` shadow; hero stickers add a slight rotation + float animation.

### Star rating
Unicode `★` (filled, `color: var(--n2)`) and `☆` (empty, muted), letter-spacing ~2px.

### Scrolling marquee banner
Full-bleed strip under the nav: `background: var(--n1)`, `3px solid var(--fg)` bottom
border, Syne 800 ink text, items separated by `✦`. The string is duplicated 2–3× in a
`width: max-content` flex row animated `translateX(0 → -50%)` linearly (~22–24s) for a
seamless loop. (This text becomes admin-editable — see `BANNER_TASK.md`.)

---

## 4. Background & ambiance

Layered behind content (`position: fixed; inset: 0; z-index: 0; pointer-events: none`):
- 2–3 **blurred neon blobs**: radial-gradient circles in `--n1` / `--n3` / `--n2`,
  `opacity ~.2–.32`, `filter: blur(~50px)`, each drifting via a slow translate/scale
  keyframe loop (16–24s).
- **Halftone dots:** `radial-gradient(var(--line) 1px, transparent 1px)` at
  `background-size: ~20–22px`, low opacity.

Content sits at `z-index: 1`.

> The landing page's **Glitch Terminal** alt direction (green CRT grid + scanlines +
> RGB-split wordmark) was explored but **not chosen** — except the RGB-split glitch is
> reused on the Pop hero wordmark (see below). Ignore the rest of the terminal look.

---

## 5. Signature hero (landing only)

- Wordmark "FUNKED / UP SHIFT" in Syne 800, `clamp(3rem, 10vw, 7.4rem)`, fill `--n1`,
  hard offset shadow `6px 6px 0 var(--n3)` + soft glow `0 0 40px rgba(255,43,214,.45)`.
- **RGB-split glitch:** two `aria-hidden` copies stacked over the base, colored
  `--n3` (cyan) and `--n4` (lime), `mix-blend-mode: screen`, each running a tiny
  2–3px jitter keyframe (`steps(2)`, ~0.9s / 1.1s) for chromatic aberration.
- **Parallax:** the wordmark container tilts/translates toward the mouse
  (`perspective(900px) rotateX/rotateY` up to ~±8–11°, translate ~±14px).
- Floating **sticker badges** ("★ daily-driven", "est. funk", "made with chaos")
  pinned to the hero corners, each slightly rotated + gentle `translateY` float.

---

## 6. Motion

| Element | Animation |
|---------|-----------|
| Card / button hover | spring `cubic-bezier(.34,1.56,.64,1)`, ~.12–.16s, shadow + translate |
| Marquee | linear translateX, 18–24s, infinite |
| Neon blobs | ease-in-out translate+scale, 16–24s, infinite |
| Hero stickers | `translateY` float, 4–5s ease-in-out |
| Brand dot / status LED | opacity pulse, ~1.6s |
| Hero wordmark | RGB-split jitter, ~0.9–1.1s `steps(2)` |

**Custom cursor:** on `(pointer: fine)` devices, a ~24px circle follows the mouse with
`mix-blend-mode: screen` and a hue that cycles each move (rainbow). Hide on touch.

**Reduce motion:** gate all of the above behind `prefers-reduced-motion` (and/or an
app flag): drop animations and the custom cursor.

---

## 7. Layout

- Content max-width **1180px**, centered, horizontal padding `clamp(14px, 3vw, 32px)`.
- Top nav is **fixed** (~60px tall); offset page content below it (the marquee is the
  first element under the nav).
- Card grids: `repeat(auto-fill, minmax(280–290px, 1fr))`, gap ~22px. Media posters
  use `minmax(180px, 1fr)` with `aspect-ratio: 2/3`.
- Footer: top border `2px solid var(--fg)`, Syne copyright left, nav links right.
