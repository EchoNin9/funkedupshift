# Tools Platform Phase 3 — Handoff & Build Instructions

**Written 2026-07-18 at the end of the phase-2 sessions.** Read alongside repo
`CLAUDE.md` (delegation protocol + hard-won gotchas — the gotchas section
there is mandatory reading, each entry cost a failed deploy or prod bug) and
`docs/tools-platform-phase2-handoff.md` (prior state; its "State of the
world" is still accurate plus the additions below).

---

## State of the world (verified live, do not redo)

Everything in the phase-2 handoff, plus (all FUNK sprint 3, all Done):

- **Password generator** (FUNK-37), **Image Resizer: crop + downsize**
  (FUNK-38), **DNS lookup** (FUNK-39, default query type "All types"),
  **Text share** (FUNK-40: `fus-textshare` DDB in ca-central-1, public
  `GET /tools/text/{id}` — the API's first unauth route, viewers at
  `/t/<id>` in both frontends).
- FUNK-41 fixed the layer-republish bug; `infra/tools.tf` now rebuilds the
  tools layer zip every apply (`timestamp()` trigger) and republishes the
  layer version when the requirements string changes (`source_code_hash`).
- The per-tool wiring pattern is now well-worn — copy it: tools-site
  (`src/web/tools-site/`): component + `TOOLS` card + `View` union +
  render in `App.tsx`; SPA (`src/web/spa/`): `src/features/<tool>/` +
  `modules.ts` entry + `MODULE_GROUPS` link + lazy route in
  `AppLayout.tsx`. The two apps never import from each other; small logic
  is duplicated verbatim in both.
- Remaining open ticket: FUNK-35 (legacy us-west-2 shortener decommission —
  console work, not repo work).

## Process (same as phase 2 — it worked)

- Delegation protocol per CLAUDE.md: lead on the frontier model, Sonnet
  sidekicks; recon only if the pattern above doesn't answer the question;
  spec-quality briefs ending "report diff + tests before committing"; lead
  reviews via `git diff`, commits, pushes, live-verifies.
- One FUNK ticket per tool (`claude` label, AC checklist, Fibonacci points
  in `customfield_10016`, transitions 11/21/31). Ask Adam which sprint, or
  use the active one.
- `development` pushes deploy the LIVE tools site — verify live (curl the
  bundle/endpoints) between tools, and check CI via
  `gh run view --json conclusion`, never a piped `gh run watch`.
- Adam UI spot-checks gate Done where listed.

---

## Build next (phase-3 scope, effort-sized)

### 1. Image tools: split "Crop Image" into its own card — **XS, 1 pt**

Crop already ships inside the Image Resizer (FUNK-38). This is packaging,
not building: a `CropTool` card/view that reuses the exact crop code
(pointer-drag selection → `cropCanvas` → encode at max quality → download),
minus the quality/target-size controls. Keep the Image Resizer as-is
(crop stays there too — it's part of the downsize flow). Both frontends.
Watch CLAUDE.md gotcha #4 (canvas must stay mounted).

### 2. Image tools: "Remove Background" — **L, 8 pts — the only hard one**

No stdlib/Canvas path exists; background removal needs a segmentation
model. Decision already leaning (confirm with Adam before building):

- **Recommended: client-side via `@imgly/background-removal`** (npm,
  onnxruntime-wasm under the hood). Keeps the "images never leave your
  browser" story. Costs: first new npm dep in the tools frontends; ~40MB
  of model+wasm fetched on first use — self-host those assets in each
  app's own bucket (the package supports a `publicPath` override; don't
  rely on a third-party CDN). Show a clear first-run download progress bar.
- **Rejected: server-side** (rembg/onnxruntime is ~200MB → Lambda container
  image, new infra class, images leave the browser). Not worth it for a
  hobby tool.
- Ship after the cheap stuff; treat as its own deploy with time to test.
  Test with a person photo, a product shot, and a busy background.

### 3. New "Converters" section — **S, 3 pts total (one ticket)**

All pure client-side, zero deps, zero backend. One tools-site card
("Converters", tabbed) + one SPA page keeps the file count down; separate
cards only if Adam prefers the look.

- **Temperature:** C ↔ F (add Kelvin, it's free). Two-way bound inputs.
- **Metric ↔ US imperial:** length (mm/cm/m/km ↔ in/ft/yd/mi), mass
  (g/kg ↔ oz/lb/stone), volume (ml/L ↔ fl oz/cup/pint/quart/gallon —
  label US, not UK, or offer both). Table-driven: one `{unit: factor}`
  map per dimension, convert via a base unit. No library.
- **Date math** (stdlib `Date`): "X days from now" → date; "date X is a
  &lt;weekday&gt;"; "date X is N days from now/ago"; days between two dates.
  Suggested extras (cheap, same primitives): unix timestamp ↔ date,
  ISO week number, "next Friday"-style next-weekday lookup, age from
  birthdate.
- **Timezone converter** (stdlib `Intl.DateTimeFormat` with `timeZone` —
  handles DST correctly for free): pick a time + source zone → show it in
  a target zone ("7am in Korea is 3pm yesterday in Vancouver" — mind the
  day offset, show it explicitly). Zone list from
  `Intl.supportedValuesOf("timeZone")` with a search box; pin a favorites
  row (Vancouver, Korea, UTC — ask Adam for his list).

### Sequencing

Converters (trivial, warms up the section) → Crop card (1 pt) →
Remove Background (its own deploy, the risk item). One ticket, one
sidekick brief, one live-verified deploy each.
