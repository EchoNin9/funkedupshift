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

# Feature: Admin-editable scrolling banner

The marquee ticker that scrolls across the top of every page is currently a hardcoded
string (e.g. `EXPENSES ✦ FINANCE ✦ MERCH ✦ MEDIA ✦ SQUASH ✦ DASHBOARD ✦ CATALOG ✦`).
Make it **stored, served by the API, and editable from the Admin panel**.

The reference UI (textarea + live preview + Save) is the "Scrolling banner" card on the
Admin screen of `Funkedupshift Pages (Pop).dc.html`.

---

## Behavior

- Every page loads the current banner string from the API and renders it in the marquee
  (duplicated 2–3× for a seamless loop; items separated by `✦`).
- An admin/manager can edit the string in the Admin panel: a textarea, a **live marquee
  preview** that re-renders on each keystroke, and a **Save** button that PUTs the value.
- After save, the new value is what every page shows on next load.
- If the fetch fails or no value is set yet, fall back to a sensible default string
  (keep the current hardcoded string as the default seed).

## Data model (DynamoDB single table)

This app uses one table with `PK`/`SK`. Store the banner as a settings item, e.g.:

```
PK = "SETTINGS"
SK = "BANNER"
value = "EXPENSES ✦ FINANCE ✦ MERCH ✦ ..."
updatedAt = <ISO timestamp>
updatedBy = <cognito sub / email>
```

A single global setting (not per-user). Match the table name/keys used elsewhere in
`infra/` and `src/lambda/api/handler.py`.

## API (API Gateway HTTP API → Lambda `handler.py`)

Add two routes (follow the existing routing/response conventions in `handler.py` and
`src/lambda/common/response.py`):

- `GET /settings/banner` → `{ "value": "<string>" }`
  - **Public / no auth** (every page, signed-in or not, needs it). If you prefer, fold it
    into an existing bootstrap/config endpoint the pages already call to avoid an extra
    request.
- `PUT /settings/banner` with body `{ "value": "<string>" }` → updated item.
  - **Auth required, gated to admin/manager** — reuse the same group-check helper used by
    other admin mutations (Cognito groups `admin` / `manager`). Reject others with 403.
  - Validate: non-empty after trim, reasonable max length (e.g. ≤ 500 chars), strip
    control chars. Persist `updatedAt` / `updatedBy`.

Add unit tests alongside the existing ones in `src/lambda/tests/` (mirror
`test_admin_handlers.py` patterns) covering: get returns default when unset, get returns
stored value, put rejects non-admin (403), put validates empty/too-long, put persists.

## Frontend

- **Shared chrome:** wherever the marquee is rendered (every page), fetch
  `GET /settings/banner` on load and inject the value. Centralize this so there's one
  place to update — ideally the same shared header/nav include/JS.
- **Admin panel:** add the "Scrolling banner" card (see Admin screen in the reference):
  - `<textarea>` bound to the current value (JetBrains Mono).
  - Helper text: "This text scrolls across every page. Separate items with ✦. Changes
    preview live below."
  - **Live preview:** a small bordered marquee that re-renders from the textarea's current
    value on every `input` event (no save needed to preview).
  - **SAVE BANNER** button → `PUT /settings/banner` with the textarea value; on success
    show a confirmation and update any in-page marquees. Disable while saving; surface
    errors.
  - Gate the whole card behind the admin/manager check already used on admin pages.

## Acceptance criteria

- [ ] Banner string lives in DynamoDB, not hardcoded.
- [ ] `GET /settings/banner` returns the current value (or default) and every page renders it.
- [ ] Admin panel shows textarea + live preview + Save.
- [ ] Typing updates the live preview instantly; Save persists and reflects sitewide.
- [ ] `PUT` is rejected (403) for non-admin/manager users.
- [ ] Empty / oversized input is validated and rejected with a clear message.
- [ ] Lambda tests cover get/put happy paths + auth + validation.
- [ ] Marquee still duplicates the string for a seamless loop and respects reduce-motion.
