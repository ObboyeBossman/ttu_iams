# IAMS — Supabase Directory

This directory contains all database and serverless artifacts for the IAMS project.

## Structure

```
supabase/
├── README.md
├── schema.sql                                     ← Phase 1 tables, triggers, indexes, views
├── rls-policies.sql                               ← Phase 1 Row Level Security policies
├── seed.sql                                       ← Dev test data (do NOT run in production)
├── migrations/
│   ├── 20260622000001_phase1_schema.sql           ← Supabase CLI — schema
│   └── 20260622000002_phase1_rls.sql              ← Supabase CLI — RLS
└── functions/
    ├── get-letter-assets/index.ts                 ← Signed URLs for private storage assets
    ├── admin-create-user/index.ts                 ← Admin-only account creation (service role)
    └── verify-letter/index.ts                     ← Public letter authenticity lookup
```

## Two ways to apply

### Option A — Supabase CLI (recommended)

```bash
# Link to your project (first time only)
supabase link --project-ref <your-project-ref>

# Push all pending migrations
supabase db push

# Optional: load seed data into dev/staging
supabase db reset   # runs migrations + seed.sql in order
```

### Option B — Supabase SQL Editor (manual)

Run the files in this exact order:

1. `schema.sql`
2. `rls-policies.sql`
3. `seed.sql` *(optional — dev only)*

> **Note:** `schema.sql` and `rls-policies.sql` are the canonical reference
> files. The `migrations/` equivalents contain the same SQL split into
> two versioned files for Supabase CLI tracking.

## Run order

| Step | File | Purpose |
|------|------|---------|
| 1 | `schema.sql` / migration 000001 | Creates enums, tables, triggers, indexes, views |
| 2 | `rls-policies.sql` / migration 000002 | Enables RLS and creates all access policies |
| 3 | `seed.sql` | Inserts test users, a season, zones, and sample placements |

## Seed data accounts

Create these users in **Supabase Auth** first (Dashboard → Authentication → Users),
then update the UUID constants in `seed.sql` to match.

| Email | Password | Role |
|-------|----------|------|
| `admin@ttu.edu.gh` | `TestPass123!` | admin |
| `kwame.asante@ttu.edu.gh` | `TestPass123!` | student |
| `ama.mensah@ttu.edu.gh` | `TestPass123!` | student |
| `dr.boateng@ttu.edu.gh` | `TestPass123!` | school_supervisor |

## Phase 2 notes

Additional tables (attendance, logbook entries, supervisor visits, anomaly
flags) will be added as new migrations in this directory when Phase 2 work
begins. They will reference existing Phase 1 tables via foreign keys.
