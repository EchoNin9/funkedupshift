# 01 — Gap analysis: native shell vs web shell

All paths are relative to `src/web/spa/src`.

## Shell / chrome

| Concern | Web (`AppLayoutContent`) | Native (`MobileAppShell`) |
|---|---|---|
| Top bar | `TopBar` (>640px) / `MobileTopBar` (≤640px): Syne "f" brand mark, wordmark, theme toggle | Branding logo + siteName, `ThemeToggle`, avatar or Sign In |
| Primary nav | `TabBar`: Home · Apps · Search · Account/Sign in | `MobileBottomTabs`: Home + 3 user-toggled modules + More |
| App discovery | `LauncherDrawer` as a bottom sheet: 3 groups, search, locked tiles with reasons, pins | `/more` page list (`MobileMorePage`) |
| Account / admin entry | `AccountMenu` sheet: identity, Profile, Appearance (mode + theme chips), Admin section, Sign out | Avatar → `/profile`; admin via `/more` |
| Home | Guest landing / signed-in Dashboard (greeting, Pinned, recent short links, recently used) | Same `HomePage` component, but no launcher context, so "Explore all apps" / "All apps" do nothing or break |
| App page frame | `AppPageLayout`: breadcrumb, icon header, Pin button, "More in…" footer | none |
| `/apps`, `/apps/:group` | All apps / section pages | missing |
| Updates banner | `UpdatesBanner` on `/` only, dismissible per session | `Marquee` on every page |
| Impersonation | `ImpersonationBanner` at all widths | missing (an admin impersonating on mobile has no indicator) |
| Customisation | Server-side pins (`usePins`, profile API) + recents (`useRecentRoutes`) | `mobile_enabled_modules` in Capacitor Preferences (`MobileModulesContext` / `useMobileModules`, which duplicate each other) |
| Footer | Site footer + spacer for the tab bar | none |

## Routes

Native is **missing** these (web has them in `shell/AppLayout.tsx`):

- `/apps`, `/apps/:group`
- `/investing`
- Tools: `/tools`, `/shortener`, `/password`, `/images`, `/crop`, `/removebg`, `/dns`, `/textshare`, `/converters`
- `/t/:id` (text share view)
- `/social`, `/social/compose` (behind `SocialGate`, superadmin)
- `/lipsync` (behind `LipsyncGate`, signed in)
- `/admin/themes`, `/admin/stats`, `/admin/lipsync-budgets`
- `/privacy` (the canonical URL given to Meta; native only has `/privacy-policy`)

Native-only routes to delete: `/more`, `/mobile-settings`. Add `<Navigate>` redirects to `/` for both, so stale
links and the saved tab state don't land on nothing. That's two lines; drop them after one release.

## Auth-gated display

There's a single source of truth and both shells already import it:

- `config/modules.ts`: `PUBLIC_MODULES` (with `group`, `minRole`, `authOnly`, `visibility`), `ADMIN_MODULES`,
  `canOpenModule`, `getLauncherGroups` (lock reason `guest` vs `no-access`), `getVisibleAdminModules`.
- `shell/AuthContext.tsx`: `hasRole`, `canAccessSquash` (custom group `Squash`), `canAccessInvesting` (`Financial`),
  `canAccessMemes` / `canCreateMemes` / `canEditAnyMeme` (`Memes`), `canAccessExpenses` (`Expenses`). Superadmin passes all.

What native gets wrong today:

- **Locked apps are hidden instead of shown locked.** It uses `getVisiblePublicModules`, so guests never see what signing in unlocks.
  Web shows locked tiles: "Sign in" for guests, "No access, ask an admin" for signed-in users without the group.
- **No Admin section in an account menu.** The admin list isn't filtered by `getVisibleAdminModules` in the same place as web.
- **No route-level gates** for `/social` and `/lipsync`, because the routes don't exist on native.
- Admin › Themes is superadmin-only (backend `_requireAdmin`). Keep that.

Phase 1 fixes all of this for free by rendering the same shell.

## Bugs that only show up on native (phase 2)

Found while reading the code:

1. **Share URLs use `window.location.origin`**, which is `https://localhost` on Android and `capacitor://localhost` on iOS:
   - `features/memes/ShareMemeBox.tsx:14`
   - `features/memes/ShareMemePopover.tsx:13`
   - `features/squash/squashShared.ts:80`
2. **File saving and opening is broken on Android.** `<a download>` is ignored, and `navigator.share` doesn't exist in Android's WebView.
   - Affected: the Image/Crop/Remove BG downloads, Vehicles CSV/PDF/ZIP exports, lipsync MP4 download and expense attachments.
   - PDF attachment previews render blank, because Android's WebView can't show PDFs inline.
   - Full call-site list and fix: [03b-file-saving.md](03b-file-saving.md).
3. **`target="_blank"` / `window.open`** (19 call sites) opens inside the WebView or does nothing, depending on platform.
4. **Google Fonts are loaded from a CDN** (`index.html:12-14`). The app needs the network for brand type, and shows fallback type offline.
5. **The imgly background-removal model ships inside the app bundle** (`public/imgly`, part of the 81 MB `dist`). That's fine for
   offline use but bloats the AAB. `publicPath` uses `location.origin`, which works because the files are local.
6. **Android hardware back** exits the app instead of closing the launcher or account sheet, or going back in history.
7. **Tablets / landscape**: above 640px the web shell switches to the desktop TopBar and drawer. That's acceptable. Verify it
   doesn't look broken on a tablet; don't build a separate tablet layout.
8. **Cognito tokens live in WebView `localStorage`** (`auth.js` → `amazon-cognito-identity-js` default storage). The OS can clear this
   under storage pressure, mainly on iOS. That only costs a re-login, so treat it as low priority.
