# Funked Up Shift — Web SPA

This is the **deployed frontend**: a React + Vite + Tailwind single-page app. CI builds
`npm run build` here and syncs `dist/` to S3 + CloudFront. The plain `src/web/*.html` files
are legacy and are **not** deployed.

## Source of truth for UI

- **Design tokens / Neon Pop system:** `src/styles.css` (CSS-variable tokens: surface/text/accent
  + the `n1–n4` neon scale, `ink`, `nav`) and `tailwind.config.cjs`. Theme switches via
  `data-theme` on `:root`.
- **Shared component classes:** `.card`, `.btn-primary`/`.btn-secondary`, `.input-field`,
  `.pop-pill`/`.pop-badge`, `.pop-marquee`, `.pop-stars` — all in `src/styles.css`.
- **Screens:** components under `src/features/*`; app shell (header, sidebar, marquee, theme
  toggle, backgrounds) under `src/shell/`.

## Historical design docs

`docs/ui_refactor/` (SCREENS.md, DESIGN_SYSTEM.md, BANNER_TASK.md) was the original Neon Pop
handoff. It targets the **legacy HTML frontend** and has drifted from what shipped — useful for
design intent, not as a current spec. See the banner at the top of each of those files.

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # production build → dist/
```
