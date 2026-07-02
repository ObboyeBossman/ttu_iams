# IAMS Project File Tree

> Auto-regenerated after cleanup on 2026-07-03 (Super Admin portal added).
> Source of truth is `supabase/` for all SQL/schema/RLS.

```text
ttu_iams/
├── .env.example                          → copy to .env, fill in Supabase URL + anon key
├── .gitignore
├── README.md
├── index.html                            → root redirect / landing
├── verify.html                           → public letter-verification page (no auth)
├── verify.js
├── vite.config.js                        → multi-page build config + path aliases
├── vercel.json                           → Vercel deployment config
├── package.json
│
├── public/
│   ├── manifest.webmanifest              → PWA manifest
│   └── assets/
│       ├── images/
│       │   └── campus.jpeg
│       ├── letters/
│       │   ├── LETTER.docx               → letter template
│       │   ├── generate-letter-prompt.md → AI prompt for letter generation
│       │   ├── ttu_footer.png
│       │   ├── ttu_letterhead.jpeg
│       │   └── ttu_signature_stamp.jpeg
│       └── logo/
│           ├── ttu_logo.png
│           └── ttu_logo_no_text.png
│
├── scripts/
│   ├── README.md
│   └── seed-users.mjs                    → seeds all auth users via Admin API (not raw SQL)
│
├── src/
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── login.html
│   │   │   ├── login.js                  → form submit, signInWithPassword, role-based redirect
│   │   │   └── auth-guard.js             → session cache, requireRole(), redirectIfAuthenticated()
│   │   │
│   │   ├── admin_portal/
│   │   │   ├── dashboard/
│   │   │   │   ├── dashboard.html
│   │   │   │   └── dashboard.js
│   │   │   ├── users/
│   │   │   │   ├── users.html
│   │   │   │   └── users.js
│   │   │   ├── zones/
│   │   │   │   ├── zones.html
│   │   │   │   └── zones.js
│   │   │   ├── placement-zones/
│   │   │   │   ├── placement-zones.html
│   │   │   │   └── placement-zones.js
│   │   │   ├── seasons/
│   │   │   │   ├── seasons.html
│   │   │   │   └── seasons.js
│   │   │   ├── letters/
│   │   │   │   ├── letters-audit.html
│   │   │   │   └── letters-audit.js
│   │   │   ├── settings/
│   │   │   │   ├── settings.html
│   │   │   │   └── settings.js
│   │   │   ├── placements.html           → assign-placements page
│   │   │   ├── placements.js
│   │   │   ├── students.html
│   │   │   └── students.js
│   │   │
│   │   ├── school-supervisor/
│   │   │   ├── dashboard.html
│   │   │   ├── dashboard.js
│   │   │   ├── students.html
│   │   │   ├── students.js
│   │   │   ├── visits.html
│   │   │   └── visits.js
│   │   │
│   │   ├── company-supervisor/
│   │   │   ├── dashboard.html
│   │   │   ├── dashboard.js
│   │   │   ├── certify.html
│   │   │   └── certify.js
│   │   │
│   │   └── super_admin/                  → Super Admin portal (highest privilege)
│   │       ├── dashboard/
│   │       │   ├── dashboard.html        → Platform-wide stats, audit log snapshot
│   │       │   └── dashboard.js
│   │       ├── structure/                → Faculty → Department → Programme tree
│   │       │   ├── structure.html
│   │       │   └── structure.js
│   │       ├── students/                 → Bulk import + directory (all students)
│   │       │   ├── students.html
│   │       │   └── students.js
│   │       ├── supervisors/              → Bulk import + directory (school & company)
│   │       │   ├── supervisors.html
│   │       │   └── supervisors.js
│   │       ├── admins/                   → Create + manage Liaison Office admin accounts
│   │       │   ├── admins.html
│   │       │   └── admins.js
│   │       ├── system-audit/             → Read-only filterable audit log
│   │       │   ├── system-audit.html
│   │       │   └── system-audit.js
│   │       ├── system-health/            → Cross-season analytics
│   │       │   ├── system-health.html
│   │       │   └── system-health.js
│   │       └── settings/                 → Letter assets, season controls, own profile
│   │           ├── settings.html
│   │           └── settings.js
│   │   │
│   │   └── student/                      → SPA: single HTML shell, sections loaded via hash
│   │       ├── dashboard.html
│   │       ├── dashboard.js
│   │       ├── dashboard-widgets.css
│   │       ├── attendance/
│   │       │   ├── attendance.js         → sub-module loaded by dashboard.js
│   │       │   └── attendance.css
│   │       ├── logbook/
│   │       │   ├── logbook.js
│   │       │   └── logbook.css
│   │       ├── placement/
│   │       │   ├── placement.js
│   │       │   └── placement.css
│   │       ├── profile/
│   │       │   ├── profile.js
│   │       │   └── profile.css
│   │       ├── report/
│   │       │   ├── report.js
│   │       │   └── report.css
│   │       └── settings/
│   │           ├── settings.js
│   │           └── settings.css
│   │
│   ├── shared/
│   │   ├── supabase-client.js            → single Supabase client instance (import from here only)
│   │   ├── utils.js
│   │   ├── pdf/
│   │   │   └── generate-letter.js        → jsPDF assembly + signed-URL asset fetching
│   │   ├── services/                     → only layer that calls Supabase directly
│   │   │   ├── auth.service.js
│   │   │   ├── attendance.service.js
│   │   │   ├── attachment-report.service.js
│   │   │   ├── letters.js
│   │   │   ├── logbook.service.js
│   │   │   ├── placements.js
│   │   │   ├── profile.service.js
│   │   │   ├── seasons.js
│   │   │   ├── settings.js
│   │   │   ├── students.js
│   │   │   ├── supervisors.service.js
│   │   │   └── zones.js
│   │   └── sync/
│   │       └── offline-queue.js          → Dexie draft store, sync-on-reconnect, Background Sync
│   │
│   ├── shell/
│   │   ├── nav.js                        → persistent shell: sidebar, topbar, PJAX navigation
│   │   ├── shell-config.js               → per-role nav/brand config
│   │   └── shell.css
│   │
│   └── styles/
│       ├── theme.css                     → CSS custom properties (design tokens)
│       └── components.css
│
├── supabase/                             → source of truth for all DB schema and RLS
│   ├── config.toml
│   ├── schema.sql                        → canonical table definitions
│   ├── rls-policies.sql                  → canonical RLS policies
│   ├── seed.sql                          → initial reference data (zones, seasons, etc.)
│   ├── mock_geo.sql                      → geo test data for local dev
│   ├── README.md
│   └── functions/
│       ├── import_map.json
│       ├── deno.json
│       ├── admin-create-user/index.ts    → creates auth user + profile (admin action)
│       ├── flag-attendance/index.ts      → flags anomalous attendance for admin review
│       ├── generate-ai-report/index.ts   → DeepSeek AI attachment report generation
│       ├── geocode-placement/index.ts    → geocodes company addresses
│       ├── get-letter-assets/index.ts    → returns signed URLs for letter assets
│       ├── verify-letter/index.ts        → public letter authenticity check
│       └── verify-paystack/index.ts      → Paystack webhook handler
│
└── docs/
    └── IAMS_Project_Scope_and_Specification_Rev8.md
```

## Key Architecture Notes

- **Single Supabase client**: always import `supabase` from `/shared/supabase-client.js`. Never construct a second client.
- **Services layer**: page scripts call `shared/services/*.js`, never Supabase directly.
- **Student portal is an SPA**: one HTML shell (`student/dashboard.html`), sub-modules loaded by `dashboard.js` based on URL hash. Other portals use PJAX (persistent shell, page content swapped).
- **Auth flow**: `login.js` → `supabase.auth.signInWithPassword()` → profile lookup for role → redirect to role dashboard. `auth-guard.js` protects every page.
- **Seeding**: run `scripts/seed-users.mjs` with your service role key to create test users. Never insert into `auth.users` via raw SQL.
