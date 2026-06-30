# TTU IAMS — UI/UX Agent Rules

Scope: visual design, layout, responsiveness, motion, and accessibility for
all portals. Pairs with `CLAUDE.md` (architecture/data rules) — that file
can `@AGENTS.md` this one in rather than duplicating it.

## Token source of truth
`src/styles/theme.css` defines all color, type, spacing, radius, and shadow
tokens via `:root` / `[data-theme]`. It also `@import`s `components.css`,
which agents have not yet seen — check it before assuming a component
pattern doesn't already exist; don't recreate a card/button/badge style
that's already defined there.

## Light & dark mode — mandatory, not optional
Every screen must work in both. The mechanism already exists
(`[data-theme="light"]` / `[data-theme="dark"]`) — use the semantic tokens
(`--bg-page`, `--text-primary`, `--border-default`, etc.), never the raw
brand/scale tokens (`--ttu-blue`, `--blue-500`...) directly in component
CSS. Raw tokens are for defining the semantic layer only.

## Contrast — verified, not assumed
Ran WCAG AA checks (4.5:1 normal text, 3:1 large/UI) on every token pair
in the file. Light mode has real failures; dark mode is clean throughout.

**Fails — do not use as-is:**
- `--accent` / `--ttu-gold` (#F0A500) as text or icon color on white/card
  backgrounds — 2.08:1. Use `--gold-700` (#7A5000) for gold text/icons on
  light backgrounds instead; reserve raw gold for fills, borders, large
  graphic accents.
- `--text-warning` on `--bg-warning` — 2.44:1, fails even the lenient
  large-text threshold. Same fix: swap the foreground to `--gold-700`
  for this pairing specifically.

**Passes for large/bold text or UI elements (≥14px semibold, icons,
borders) but fails for small body text — restrict accordingly:**
- `--text-danger` on `--bg-danger` (4.19:1) — use `--red-700` (#7B241C)
  if the text is small (e.g. inline badge labels under 14px).
- `--text-success` on `--bg-success` (4.43:1) — use a darker green
  (~#14603A) for small text; current pair is fine for badges/headers.
- `--status-pending-fg` on `--status-pending-bg` (4.37:1) — use `--n600`
  for small pending-status text.

Any new color pairing introduced later must be checked the same way
before shipping, not eyeballed.

## Portal split — separate stylesheets, not one theme with overrides
Two visual languages, confirmed as separate files (not a `data-portal`
attribute on a shared sheet):
- **Student portal** — noticeably playful: bouncier easing on
  transitions, illustration-heavy empty states, more motion overall.
  Still uses the same brand tokens (gold/blue) — playful in motion and
  illustration, not in palette.
- **Admin / Lecturer / Supervisor portals** — restrained and serious.
  Subtle motion only (the existing `--transition-smooth` is the ceiling,
  not bounce/spring easing). No illustration-heavy empty states — plain,
  information-dense, minimal-chrome treatment instead.
Both portal stylesheets still consume the same root token file — don't
fork the palette, fork the motion/illustration layer only.

## Responsiveness
Mobile-first. Smallest target screen is a budget Android phone (this is
the primary access device per the IAMS spec, NFR1) up through desktop
admin use. No fixed-pixel layouts; no horizontal scroll at any width.
Touch targets ≥44px on student-facing screens. Test at minimum: ~360px,
~768px, ~1280px.

## HCI principles, applied (not abstract)
- **Hierarchy**: one primary action per screen, sized/colored to be
  obvious before reading any text.
- **Feedback**: every action gets a visible response — loading, success,
  or error state — using the existing `--status-*` tokens, not invented
  ad hoc ones.
- **Progressive disclosure**: especially on student logbook/attendance
  screens — show today's task first, history/detail behind a tap, not
  all at once.
- **Motion with purpose**: every transition should clarify cause→effect
  (state change, navigation direction). Decorative motion is allowed on
  the student portal specifically, per the split above — not a license
  to add it everywhere.

## Feature folder structure
Every feature within a portal module is a self-contained folder with
exactly three files: its own CSS, HTML, and JS. No feature reaches into
another feature's folder.

```
modules/
└── student/
    ├── logbook/
    │   ├── logbook.html
    │   ├── logbook.css
    │   └── logbook.js
    └── attendance-reports/
        ├── attendance-reports.html
        ├── attendance-reports.css
        └── attendance-reports.js
```

Feature CSS imports the relevant portal stylesheet + root tokens; it does
not redefine tokens locally.

## Status
v1 — 30 Jun 2026. Open item: review `components.css` once available, in
case it already defines patterns this file should reference instead of
letting agents reinvent them.