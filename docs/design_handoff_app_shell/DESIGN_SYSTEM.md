# Funkedupshift design system

The product UI for funkedupshift.com: vibrant but professional. A cool near-black ground (or a soft light ground), Space Grotesk headings over Manrope body text, one confident violet accent, and four category hues that give the app catalogue its colour. The old "Neon Pop" energy survives in the palette and the big display type. The brutalist shadows, rotation and glitch effects are gone.

## How to use this

- Link `styles.css` from every page and take every colour, font, spacing value, radius and shadow from its variables (`var(--color-*)`, `var(--font-*)`, `var(--space-*)`, `var(--radius-*)`, `var(--shadow-*)`).
- Dark is the default. Put `data-theme="light"` on any ancestor to switch; every token re-resolves. Persist the choice in `localStorage`.
- Icons: Phosphor (https://phosphoricons.com), regular weight, 16–28px.
- `templates/app-shell/` is the reference shell: top bar, launcher drawer, avatar menu, guest landing, dashboard and a tool page.

## Navigation model (replaces the left sidebar)

- **Top bar, 60px:** launcher button, wordmark, search (⌘K), theme toggle, avatar (or **Sign in** for guests). No other links.
- **Launcher drawer:** slides in from the left. It holds search plus every app, grouped into Discover / Tools / Modules. Each app is an icon tile in its group hue. ⌘K opens it; Esc or a click on the scrim closes it.
- **Locked apps** always show: greyed (50% opacity, greyscale) with a lock. Guests who click one go to sign-in. Signed-in users without access get an inert tile with a "No access" label.
- **Admin** lives in the avatar menu and only appears for managers and admins.
- **Pages** use the full width under the bar. Each starts with a breadcrumb (Home › Group › App) and a header with the app's icon tile, name and one-line description.
- **Two homes:** a public landing for guests (hero plus the full app catalogue), and a dashboard once signed in (pinned apps, recent short links, recently used apps).

## Mobile (≤640px, and the native app)

The same model, moved within thumb reach. Nothing new to learn:

- The top bar shrinks to wordmark plus theme toggle. Launcher, search and account move to a **bottom tab bar**: Home · Apps · Search · Account (Sign in for guests). Tabs are 56px tall and respect `env(safe-area-inset-bottom)`.
- The **launcher becomes a bottom sheet** (88vh, grabber on top) with the same groups, pins and locked states. Apps opens it without the keyboard; Search opens it focused.
- The **account menu** (including Admin) opens as a sheet above the tab bar.
- Pages keep the breadcrumb, icon-tile header and "More in…" footer; content goes single-column with 16px gutters.
- The native shell should render these same classes (`.tabbar`, `.tab`, `.launcher`, `.account-menu`) rather than its own separate tabs and More page.

## Color

- Ground `--color-bg` #111117, surfaces `--color-surface` / `--color-surface-2`, text `--color-text`, secondary text `--color-text-muted`.
- Accent `--color-accent` #7c5cff: primary buttons, focus rings, the brand mark. For text in the accent hue, use `--color-accent-text`.
- Category hues: `--color-hue-teal` (Discover), `--color-hue-violet` (Tools), `--color-hue-coral` (Modules), `--color-hue-amber` (Admin). Use them for icons, dots and 17% tints (`color-mix(in srgb, hue 17%, transparent)`), never for large fills.
- The 100–900 ramps (`--color-neutral-*`, `--color-accent-*`, `--color-accent-2-*`) are there for finer steps.

## Type

Space Grotesk 600 for headings, set tight (-0.025em; display sizes go down to -0.05em). Manrope for body and UI text: 400 for copy, 600–700 for labels and buttons.

## Components

| Class | What it is |
| --- | --- |
| `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-icon` / `.btn-lg` / `.btn-block` | Primary is a solid violet fill; secondary is a surface with a hairline border |
| `.tag` + `.tag-accent` / `.tag-accent-2` / `.tag-neutral` / `.tag-outline` | Pill labels |
| `.field`, `.input`, `.radio`, `.seg` + `.seg-opt` | Form controls; focus adds an accent border and a 3px halo |
| `.card` (+ `-kicker/-title/-body/-meta`), `.elev-sm/md/lg` | Surface cards with a hairline border |
| `.nav` + `.nav-brand` | A basic header bar |
| `.table` | Data tables with hairline row rules |
| `.dialog-backdrop` + `.dialog` | Modal |

## Do

- Let colour come from the app icon tiles and the accent. Keep surfaces neutral.
- Give every page the breadcrumb plus icon-tile header so users always know where they are.
- Keep motion short (150–260ms, ease-out). The drawer slide is the biggest motion in the system.

## Don't

- Don't bring back hard offset shadows, tilted cards, the marquee or the glitch effect.
- Don't flood large areas with the accent or the category hues.
- Don't add links to the top bar. New apps go in the launcher.
