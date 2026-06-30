# TTU IAMS — Architecture & Agent Behavior

Scope: agent autonomy/escalation policy, the full project structure, and
cross-cutting boundaries. Companion to `CLAUDE.md` (identity, phase
boundary, data model) and `AGENTS.md` (UI/UX rules) — doesn't repeat
either, only adds what's new.

## Agent autonomy
Default: analyze carefully, decide, proceed. Don't wait for sign-off on
routine work — that covers anything inside an already-approved feature's
own folder, refactors scoped to one feature, bug fixes within existing
scope, and choosing between two equally reasonable approaches.

**Notify before proceeding — this is the actual "critical" bar, not a
vague feeling:**
- Anything touching a DB-enforced invariant or trigger already listed in
  `CLAUDE.md` (status lifecycle, `draft_id` uniqueness, role-integrity
  checks, field-locking, attribution stamping).
- Any schema change or destructive query, full stop. There is no
  separate dev/staging Supabase project — the spec is explicit that one
  project covers both development and production — so a mistake here
  isn't recoverable the way it would be with environment separation.
  That alone makes schema work "critical" by default.
- Adding a dependency, framework, or build-tool change outside the
  confirmed stack (Vite + the four CDN libraries already in `CLAUDE.md`).
- Anything that would start Phase 2 scope (FR4, FR5, the deferred parts
  of FR6/FR7).
- Deleting or renaming an existing feature folder, or any change that
  breaks the services-only Supabase access pattern.
- Genuine ambiguity about whether something is in scope at all — that
  ambiguity is itself the critical case; don't resolve it by guessing.

Everything else: proceed, and record what was decided and why in the
commit/PR description rather than asking first.

## Project structure
Full tree, integrating the Vite app shell (confirmed in `CLAUDE.md`) with
the feature-folder convention (defined in `AGENTS.md`):

```
iams/
├── package.json / vite.config.js / index.html
├── public/
├── src/
│   ├── shared/            → services/, sync/, pdf/, supabase-client.js,
│   │                        utils.js — the ONLY layer touching Supabase
│   ├── shell/             → nav.js, shell-config.js, shell.css
│   ├── styles/
│   │   ├── theme.css      → root tokens, light/dark, shared by everyone
│   │   └── portals/
│   │       ├── student.css   → playful motion/illustration layer
│   │       └── staff.css     → restrained layer (admin, school-
│   │                           supervisor, company-supervisor share this)
│   └── modules/
│       ├── auth/
│       └── <portal>/
│           └── <feature>/
│               ├── <feature>.html
│               ├── <feature>.css
│               └── <feature>.js
└── supabase/
    ├── schema.sql / rls-policies.sql / seed.sql
```

## Boundaries
- **Feature self-containment.** Every feature folder is closed: it may
  import its portal stylesheet and root tokens, and call into
  `src/shared/services/` — nothing else. No feature imports another
  feature's files directly, and no outside stylesheet targets a
  feature's internals. This holds at both the portal/module level and
  the individual-feature level — styling is owned locally wherever it's
  defined, never patched from outside.
- **One direction for data.** Pages/feature scripts → services →
  Supabase. Never the reverse, never skipped.
- **One direction for styling.** Root tokens → portal stylesheet →
  feature CSS. A feature can use tokens; it can't redefine them.
- **New top-level folders are a "notify" event** — same bar as a new
  dependency, since they change the map this file describes.

## Status
v1 — 30 Jun 2026. Builds on the confirmed Vite stack and the feature
folder convention; update this file if either changes again.
Done
