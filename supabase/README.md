# IAMS — Supabase Setup

## Fresh project setup (do this every time you create a new Supabase project)

### 1. Update your .env
```
VITE_SUPABASE_URL=https://your-new-ref.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your-new-anon-key...
```
Both values are in: **Supabase Dashboard → Project Settings → API**

> ⚠️ When you recreate a project, BOTH the URL and the anon key change.
> Updating only the URL is a common mistake that causes silent auth failures.

### 2. Clear your browser storage
Before testing, open DevTools → Application → Storage → **Clear site data**.
Old sessions from the previous project will cause login to silently fail.

### 3. Push the schema
```bash
npx supabase link --project-ref your-new-ref
npx supabase db push
```
This runs `migrations/20260629000001_squashed.sql` then `seed.sql` automatically.

### 4. Seed users
```bash
export SUPABASE_SERVICE_KEY=eyJ...your-service-role-key...
node scripts/seed-users.mjs
```
The service role key is in: **Supabase Dashboard → Project Settings → API → service_role**

That's it. The app is ready to use.

---

## File structure

```
supabase/
├── migrations/
│   └── 20260629000001_squashed.sql   ← single source of truth: schema + RLS
├── seed.sql                          ← reference data only (seasons + zones)
├── config.toml                       ← Supabase CLI config
├── mock_geo.sql                      ← geo test data for local dev
├── functions/                        ← Edge Functions
│   ├── admin-create-user/
│   ├── flag-attendance/
│   ├── generate-ai-report/
│   ├── geocode-placement/
│   ├── get-letter-assets/
│   ├── verify-letter/
│   └── verify-paystack/
└── README.md                         ← this file
```

## Why users are NOT in seed.sql

Direct `auth.users` SQL inserts break whenever a Supabase project is recreated
because the internal GoTrue JWT secret changes. Those rows become invalid login
accounts that look right in the DB but can never authenticate.

`scripts/seed-users.mjs` uses the Admin API which creates users correctly
regardless of the project's internal state, and is safe to re-run (idempotent).

## Test credentials

Password for all accounts: `Password123!`

| Role               | Email                            |
|--------------------|----------------------------------|
| Admin              | admin.kwame@ttu.edu.gh           |
| School Supervisor  | sup.mensah@ttu.edu.gh            |
| Company Supervisor | csup.hammond@gmail.com           |
| Student            | std.abena@student.ttu.edu.gh     |