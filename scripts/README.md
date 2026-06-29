# IAMS — Developer Scripts

## seed-users.mjs

Seeds all test users into a fresh Supabase project using the Admin API.  
**Run this after `supabase db push` on a new project.**

### Why this instead of seed.sql?

`seed.sql` inserted users directly into `auth.users` via raw SQL. This breaks
when a Supabase project is recreated because the internal GoTrue JWT secret
changes and those raw rows are not recognized as valid login accounts.

The Admin API (`supabase.auth.admin.createUser`) creates users correctly
regardless of the project's internal secret.

### Setup

```bash
# Install dependencies (only needed once)
npm install @supabase/supabase-js

# Export credentials — get service_role key from:
# Supabase Dashboard → Project Settings → API → service_role (secret)
export SUPABASE_URL=https://your-ref.supabase.co
export SUPABASE_SERVICE_KEY=eyJ...your-service-role-key...

# Run
node scripts/seed-users.mjs
```

### Test accounts (password: `Password123!`)

| Role | Email |
|---|---|
| Admin | `admin.kwame@ttu.edu.gh` |
| School Supervisor | `sup.mensah@ttu.edu.gh` |
| Company Supervisor | `csup.hammond@gmail.com` |
| Student | `std.abena@student.ttu.edu.gh` |

### Safety

- The service role key has full DB access. **Never commit it to git.**
- The script is idempotent — safe to re-run if it fails halfway.
