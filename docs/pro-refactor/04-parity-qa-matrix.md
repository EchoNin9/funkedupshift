# 04 — Parity QA matrix (acceptance checklist)

Run on an Android device or emulator, against **staging** (build with staging `API_BASE_URL` and Cognito ids),
in both dark and light themes. The web reference is `docs/design_handoff_app_shell/QA.md`. Its signed-in
cells were only checked against stubbed auth, so this pass doubles as the first real-account check.

**Personas** (the same ones web QA uses):
- **G** = guest, signed out
- **U** = Cognito `user`, no custom groups
- **M** = `user` + custom groups `Memes`, `Squash`, `Financial`, `Expenses`
- **A** = Cognito `admin` (frontend role `superadmin`)
- **Mgr** = Cognito `manager`, for the admin-section rows

**Legend**: ✓ opens · 🔒S locked tile → sign in · 🔒N locked tile, inert ("ask an admin") · — hidden

## Launcher / home tiles

| App (group) | G | U | M | A |
|---|---|---|---|---|
| Websites, Media, Memes, Internet Dashboard, Highlights, Highest Rated (Discover) | ✓ | ✓ | ✓ | ✓ |
| My Info (Tools) | ✓ | ✓ | ✓ | ✓ |
| Shortener, Password, Image Resizer, Crop, Remove BG, DNS, Text Share, Converters, Lipsync (Tools) | 🔒S | ✓ | ✓ | ✓ |
| Finances (Modules) | 🔒S | ✓ | ✓ | ✓ |
| Investing (`Financial`) | 🔒S | 🔒N | ✓ | ✓ |
| Vehicles / General expenses (`Expenses`) | 🔒S | 🔒N | ✓ | ✓ |
| Squash (`Squash`) | 🔒S | 🔒N | ✓ | ✓ |
| Meme Generator (`Memes`) | 🔒S | 🔒N | ✓ | ✓ |

## Account sheet

| Item | G | U | M | Mgr | A |
|---|---|---|---|---|---|
| Tab shows "Sign in" → `/auth` | ✓ | — | — | — | — |
| Identity + role tag, Profile, Appearance, Sign out | — | ✓ | ✓ | ✓ | ✓ |
| Admin section: Websites, Media, Recommended, Membership | — | — | — | ✓ | ✓ |
| Admin section: Internet Dashboard, Branding, Themes, Stats, Social Scheduler, Lipsync Budgets | — | — | — | — | ✓ |

## Direct routes and deep pages

| Route | G | U | M | A |
|---|---|---|---|---|
| `/` | landing | dashboard + greeting | dashboard | dashboard |
| `/apps`, `/apps/discover\|tools\|modules` | ✓ | ✓ | ✓ | ✓ |
| `/memes` | list, share, no rate/search | + rate, no tabs/search | + All/My tabs, search | all |
| `/memes/create`, `/memes/:id/edit` | blocked | blocked | own only | any |
| `/shortener` and other tools | in-page sign-in card | ✓ | ✓ | ✓ |
| `/t/:id`, `/squash/s/:id` (share views) | ✓ | ✓ | ✓ | ✓ |
| `/lipsync` | → `/auth` | ✓ | ✓ | ✓ |
| `/social` | blocked | blocked | blocked | ✓ |
| `/admin` | → `/auth` | Access Denied | Access Denied | ✓ |
| `/admin/themes`, `/admin/stats`, `/admin/lipsync-budgets` | → `/auth` | Access Denied | Access Denied | ✓ |
| `/more`, `/mobile-settings` (legacy) | → `/` | → `/` | → `/` | → `/` |

## Shell behaviour (all personas)

- [ ] Top bar clears the status bar, and the TabBar clears the gesture/nav bar (safe areas).
- [ ] Apps tab opens the launcher sheet. Search tab opens it with the keyboard up, and the sheet lifts above the keyboard.
- [ ] App page shows a breadcrumb in which every crumb is a link, icon header, Pin (signed-in only) and "More in…" chips.
- [ ] Pin something in the app, and it appears on the web dashboard for the same account (server-side pins).
- [ ] Updates banner shows on `/` only. Signed-in users can dismiss it.
- [ ] Admin impersonates a user: the impersonation banner is visible at phone width, and the role-gated tiles change to match.
- [ ] Theme toggle and theme chips work. The site default theme from Admin › Themes applies on fresh install.
- [ ] Android back closes an open sheet first, then navigates back, then exits (phase 2).
- [ ] Camera: receipt scanner (Vehicles, General expenses) and Profile "Take Photo" still work.
- [ ] Share links open on the public site (phase 2 item 1).
- [ ] File saving and opening: run the full QA list in [03b-file-saving.md](03b-file-saving.md).
- [ ] No horizontal scroll at 320 / 375 / 412 widths. Tablet in landscape shows the desktop shell without breaking.

Record results in a copy of this table in the PR description. Screenshots go in the PR.
