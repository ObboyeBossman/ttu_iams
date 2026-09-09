# IAMS — Super Admin Portal: Complete Build Prompt
**Project:** Takoradi Technical University — Industrial Attachment Management System (IAMS)
**Task:** Build the complete Super Admin portal AND the institutional structure it depends on (faculties, departments, programmes), including a full schema migration, bulk import flows, and all necessary updates to existing files.

---

## 1. CONTEXT — WHAT THIS PROJECT IS

IAMS is a vanilla JS, no-framework, no-build-step web app managing student industrial attachments at TTU. Backend is Supabase (PostgreSQL + RLS + Auth). Pages are plain HTML + ES module JS files, served by Vite (dev) and Vercel (prod).

**Existing roles:**
- `student` → `src/modules/student/dashboard.html`
- `admin` → `src/modules/admin_portal/dashboard/dashboard.html`
- `school_supervisor` → `src/modules/school-supervisor/dashboard.html`
- `company_supervisor` → `src/modules/company-supervisor/dashboard.html`

**New role being built:** `super_admin` → `src/modules/super_admin/dashboard/dashboard.html`

---

## 2. THE BIG PICTURE — WHAT IS CHANGING AND WHY

### The problem with the current schema

The existing `students` table stores `department`, `programme`, and `level` as **plain text columns** — free text typed by whoever creates the record. This causes:
- Inconsistent data ("Comp Sci" vs "Computer Science" vs "CS Dept")
- No way to filter or report cleanly by programme type
- No institutional structure to validate student records against

### The solution

Introduce a proper **institutional hierarchy** as database tables:

```
Faculty → Department → Programme → Student
```

`students.department` (text) and `students.programme` (text) are replaced with `students.programme_id` (FK → `programmes.id`). The programme record itself carries the department and faculty via its own foreign keys, so a student's full academic context is always derivable without storing it redundantly.

### Who builds this structure?

The **Super Admin** — and only the Super Admin. They:
1. Register faculties
2. Register departments (under faculties)
3. Register programmes (under departments, with type: BSc / HND / Diploma / B-Tech / etc.)
4. Bulk-import students via Excel/CSV (mapped to programmes)
5. Bulk-import school supervisors via Excel/CSV
6. Create admin accounts one at a time (Liaison Office staff)

No one else in the system can create accounts or manage institutional structure.

---

## 3. SCHEMA MIGRATION

Provide as: `supabase/migrations/20260703000001_super_admin_and_structure.sql`

### 3.1 Extend the user_role enum
```sql
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'super_admin';
```

### 3.2 New institutional structure tables

```sql
-- Faculties
CREATE TABLE public.faculties (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  code        text        NOT NULL UNIQUE,  -- e.g. 'FAS', 'FENG'
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        REFERENCES public.profiles (id) ON DELETE SET NULL
);

-- Departments (belong to a faculty)
CREATE TABLE public.departments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id  uuid        NOT NULL REFERENCES public.faculties (id) ON DELETE RESTRICT,
  name        text        NOT NULL,
  code        text        NOT NULL,  -- e.g. 'CSC', 'EEE'
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  UNIQUE (faculty_id, name),
  UNIQUE (faculty_id, code)
);

-- Programmes (belong to a department)
CREATE TABLE public.programmes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id   uuid        NOT NULL REFERENCES public.departments (id) ON DELETE RESTRICT,
  name            text        NOT NULL,   -- e.g. 'Computer Science'
  type            text        NOT NULL,   -- 'BSc' | 'HND' | 'Diploma' | 'B-Tech' | 'MSc' | 'PhD'
  duration_years  integer     NOT NULL CHECK (duration_years > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  UNIQUE (department_id, name, type)
);
```

### 3.3 Migrate the students table

```sql
-- Add programme_id FK
ALTER TABLE public.students
  ADD COLUMN programme_id uuid REFERENCES public.programmes (id) ON DELETE RESTRICT;

-- Keep old text columns for now as nullable (migration safety — existing rows
-- won't break immediately). They will be dropped in a follow-up migration
-- once all data is migrated. Mark them deprecated.
COMMENT ON COLUMN public.students.department IS
  'DEPRECATED — replaced by programme_id → programmes → departments. Will be dropped after data migration.';
COMMENT ON COLUMN public.students.programme IS
  'DEPRECATED — replaced by programme_id → programmes. Will be dropped after data migration.';
```

### 3.4 Add is_active to profiles

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.is_active IS
  'Set to false by Super Admin to deactivate an account without deleting it.';
```

### 3.5 Super admin audit log table

```sql
CREATE TABLE public.super_admin_audit (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid        NOT NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
  action      text        NOT NULL,
  target_type text,
  target_id   text,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

### 3.6 Update the student_profiles view

```sql
-- Drop and recreate to include programme_id and the joined faculty/department/programme names
DROP VIEW IF EXISTS public.student_profiles;

CREATE OR REPLACE VIEW public.student_profiles AS
  SELECT
    p.id,
    p.full_name,
    p.phone,
    p.is_active,
    p.created_at,
    s.index_number,
    s.level,
    s.programme_id,
    -- Deprecated text fields kept temporarily for backward compatibility
    s.department,
    s.programme,
    -- Joined institutional names
    pr.name        AS programme_name,
    pr.type        AS programme_type,
    d.id           AS department_id,
    d.name         AS department_name,
    d.code         AS department_code,
    f.id           AS faculty_id,
    f.name         AS faculty_name,
    f.code         AS faculty_code
  FROM public.profiles p
  JOIN public.students s  ON s.id = p.id
  LEFT JOIN public.programmes  pr ON pr.id = s.programme_id
  LEFT JOIN public.departments d  ON d.id  = pr.department_id
  LEFT JOIN public.faculties   f  ON f.id  = d.faculty_id;
```

### 3.7 RLS policies

```sql
-- Enable RLS on new tables
ALTER TABLE public.faculties    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programmes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_admin_audit ENABLE ROW LEVEL SECURITY;

-- Faculties: everyone authenticated can read (students need to see their faculty)
CREATE POLICY "faculties: authenticated read"
  ON public.faculties FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "faculties: super_admin insert"
  ON public.faculties FOR INSERT WITH CHECK (public.current_role() = 'super_admin');
CREATE POLICY "faculties: super_admin update"
  ON public.faculties FOR UPDATE USING (public.current_role() = 'super_admin');
CREATE POLICY "faculties: super_admin delete"
  ON public.faculties FOR DELETE USING (public.current_role() = 'super_admin');

-- Departments: same pattern
CREATE POLICY "departments: authenticated read"
  ON public.departments FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "departments: super_admin insert"
  ON public.departments FOR INSERT WITH CHECK (public.current_role() = 'super_admin');
CREATE POLICY "departments: super_admin update"
  ON public.departments FOR UPDATE USING (public.current_role() = 'super_admin');
CREATE POLICY "departments: super_admin delete"
  ON public.departments FOR DELETE USING (public.current_role() = 'super_admin');

-- Programmes: same pattern
CREATE POLICY "programmes: authenticated read"
  ON public.programmes FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "programmes: super_admin insert"
  ON public.programmes FOR INSERT WITH CHECK (public.current_role() = 'super_admin');
CREATE POLICY "programmes: super_admin update"
  ON public.programmes FOR UPDATE USING (public.current_role() = 'super_admin');
CREATE POLICY "programmes: super_admin delete"
  ON public.programmes FOR DELETE USING (public.current_role() = 'super_admin');

-- Super admin reads and writes all existing tables
-- (Add SELECT policy for super_admin on every existing table)
CREATE POLICY "profiles: super_admin reads all"
  ON public.profiles FOR SELECT USING (public.current_role() = 'super_admin');
CREATE POLICY "profiles: super_admin inserts"
  ON public.profiles FOR INSERT WITH CHECK (public.current_role() = 'super_admin');
CREATE POLICY "profiles: super_admin updates all"
  ON public.profiles FOR UPDATE USING (public.current_role() = 'super_admin');

CREATE POLICY "students: super_admin reads all"
  ON public.students FOR SELECT USING (public.current_role() = 'super_admin');
CREATE POLICY "students: super_admin inserts"
  ON public.students FOR INSERT WITH CHECK (public.current_role() = 'super_admin');
CREATE POLICY "students: super_admin updates"
  ON public.students FOR UPDATE USING (public.current_role() = 'super_admin');

CREATE POLICY "seasons: super_admin reads all"
  ON public.seasons FOR SELECT USING (public.current_role() = 'super_admin');
CREATE POLICY "zones: super_admin reads all"
  ON public.zones FOR SELECT USING (public.current_role() = 'super_admin');
CREATE POLICY "zone_supervisors: super_admin reads all"
  ON public.zone_supervisors FOR SELECT USING (public.current_role() = 'super_admin');
CREATE POLICY "placements: super_admin reads all"
  ON public.placements FOR SELECT USING (public.current_role() = 'super_admin');
CREATE POLICY "letters: super_admin reads all"
  ON public.letters FOR SELECT USING (public.current_role() = 'super_admin');
CREATE POLICY "settings: super_admin reads all"
  ON public.settings FOR SELECT USING (public.current_role() = 'super_admin');
CREATE POLICY "settings: super_admin updates"
  ON public.settings FOR UPDATE USING (public.current_role() = 'super_admin');
CREATE POLICY "payments: super_admin reads all"
  ON public.payments FOR SELECT USING (public.current_role() = 'super_admin');

-- Audit log
CREATE POLICY "super_admin_audit: super_admin reads all"
  ON public.super_admin_audit FOR SELECT USING (public.current_role() = 'super_admin');
CREATE POLICY "super_admin_audit: super_admin inserts"
  ON public.super_admin_audit FOR INSERT WITH CHECK (public.current_role() = 'super_admin');
```

---

## 4. SUPABASE EDGE FUNCTION

Create: `supabase/functions/create-user/index.ts`

The Super Admin cannot call `supabase.auth.admin.createUser()` from the browser — that requires the service role key which must never be exposed client-side. An Edge Function bridges this gap.

```typescript
// supabase/functions/create-user/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify the caller is a super_admin
    const authHeader = req.headers.get('Authorization')
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader! } } }
    )
    const { data: { user } } = await anonClient.auth.getUser()
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { data: profile } = await anonClient.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'super_admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders })
    }

    // Use service role to create the auth user
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const body = await req.json()
    // body: { email, password, role, full_name, phone, ...role_specific_fields }

    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
    })

    if (createError) throw createError

    // Insert profile row
    const { error: profileError } = await adminClient.from('profiles').insert({
      id:        newUser.user.id,
      role:      body.role,
      full_name: body.full_name,
      phone:     body.phone,
      is_active: true,
    })
    if (profileError) throw profileError

    // Insert role-specific row
    if (body.role === 'student') {
      const { error: studentError } = await adminClient.from('students').insert({
        id:           newUser.user.id,
        index_number: body.index_number,
        programme_id: body.programme_id,
        level:        body.level,
        // Keep deprecated text fields populated during transition period
        department:   body.department_name ?? '',
        programme:    body.programme_name ?? '',
      })
      if (studentError) throw studentError
    }

    return new Response(JSON.stringify({ user_id: newUser.user.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
```

**How to call it from the browser:**
```js
const { data: { session } } = await supabase.auth.getSession();
const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
  },
  body: JSON.stringify({ ...userPayload }),
});
const result = await response.json();
if (result.error) throw new Error(result.error);
```

---

## 5. EXISTING FILES THAT NEED UPDATING

### 5.1 `src/modules/auth/auth-guard.js`
Add to `DASHBOARD_PATHS`:
```js
super_admin: '/src/modules/super_admin/dashboard/dashboard.html',
```

### 5.2 `src/shell/shell-config.js`
Add to `SHELL_CONFIG`:
```js
super_admin: {
  brandName:          'Industrial Attachment Management System',
  brandInitials:      'IAMS',
  portalLabel:        'Super Admin',
  showSeasonSwitcher: false,
  showPromo:          false,
  promo:              null,
  nav: [
    { page: 'dashboard',    icon: 'layout-dashboard', label: 'Dashboard',       badge: null },
    { page: 'structure',    icon: 'network',          label: 'Institution',      badge: null },
    { page: 'students',     icon: 'graduation-cap',   label: 'Students',         badge: null },
    { page: 'supervisors',  icon: 'user-check',       label: 'Supervisors',      badge: null },
    { page: 'admins',       icon: 'shield-check',     label: 'Admin Accounts',   badge: null },
    { page: 'system-audit', icon: 'scroll-text',      label: 'Audit Log',        badge: null },
    { page: 'system-health',icon: 'activity',         label: 'System Health',    badge: null },
    { page: 'settings',     icon: 'settings',         label: 'System Config',    badge: null },
  ],
  footer: [
    { type: 'action', id: 'themeToggle', icon: 'sun',     label: 'Toggle Theme' },
    { type: 'action', id: 'signOut',     icon: 'log-out', label: 'Sign Out'     },
  ],
},
```

### 5.3 `src/shared/services/students.js`
Update `filterStudents()` to support filtering by `faculty_id`, `department_id`, `programme_id` (using the new fields from the updated `student_profiles` view). The existing `department` text filter can remain as a fallback.

### 5.4 `vite.config.js`
Add all new super admin HTML entries to `build.rollupOptions.input`:
```js
'super-admin-dashboard':     resolve(__dirname, 'src/modules/super_admin/dashboard/dashboard.html'),
'super-admin-structure':     resolve(__dirname, 'src/modules/super_admin/structure/structure.html'),
'super-admin-students':      resolve(__dirname, 'src/modules/super_admin/students/students.html'),
'super-admin-supervisors':   resolve(__dirname, 'src/modules/super_admin/supervisors/supervisors.html'),
'super-admin-admins':        resolve(__dirname, 'src/modules/super_admin/admins/admins.html'),
'super-admin-system-audit':  resolve(__dirname, 'src/modules/super_admin/system-audit/system-audit.html'),
'super-admin-system-health': resolve(__dirname, 'src/modules/super_admin/system-health/system-health.html'),
'super-admin-settings':      resolve(__dirname, 'src/modules/super_admin/settings/settings.html'),
```

---

## 6. NEW SHARED SERVICE FILES TO CREATE

### `src/shared/services/institution.service.js`
```js
// All reads/writes for faculties, departments, programmes
export async function listFaculties() { ... }
export async function createFaculty(payload) { ... }
export async function updateFaculty(id, patch) { ... }
export async function deleteFaculty(id) { ... }

export async function listDepartments(facultyId = null) { ... }
export async function createDepartment(payload) { ... }
export async function updateDepartment(id, patch) { ... }
export async function deleteDepartment(id) { ... }

export async function listProgrammes(departmentId = null) { ... }
export async function createProgramme(payload) { ... }
export async function updateProgramme(id, patch) { ... }
export async function deleteProgramme(id) { ... }
```

---

## 7. SUPER ADMIN PORTAL — FILES TO CREATE

```
src/modules/super_admin/
├── dashboard/
│   ├── dashboard.html
│   └── dashboard.js
├── structure/              ← Faculty / Department / Programme management
│   ├── structure.html
│   └── structure.js
├── students/               ← Bulk import + view all students
│   ├── students.html
│   └── students.js
├── supervisors/            ← Bulk import + view all supervisors
│   ├── supervisors.html
│   └── supervisors.js
├── admins/                 ← Create and manage admin accounts
│   ├── admins.html
│   └── admins.js
├── system-audit/
│   ├── system-audit.html
│   └── system-audit.js
├── system-health/
│   ├── system-health.html
│   └── system-health.js
└── settings/
    ├── settings.html
    └── settings.js
```

---

## 8. DETAILED FEATURE SPECS — EACH PAGE

---

### PAGE 1: Dashboard (`dashboard/`)

**Purpose:** Platform-wide snapshot on login.

**Stat cards:**
- Total users | Total students | Total admins | Total supervisors
- Total seasons | Total placements | Total letters | Total payments (GHS)

**Body:**
1. Institutional completeness panel — counts of faculties, departments, programmes registered
2. All seasons table — name, status badge, placement count, dates
3. Last 20 audit log entries — actor, action, timestamp
4. Flagged placements count with link

**Data queries:**
```js
await supabase.from('profiles').select('role', { count: 'exact' })
await supabase.from('faculties').select('*', { count: 'exact', head: true })
await supabase.from('departments').select('*', { count: 'exact', head: true })
await supabase.from('programmes').select('*', { count: 'exact', head: true })
await supabase.from('seasons').select('*, placements(count)')
await supabase.from('payments').select('amount_pesewas').eq('status', 'confirmed')
await supabase.from('super_admin_audit').select('*, actor:profiles(full_name)').order('created_at', { ascending: false }).limit(20)
```

---

### PAGE 2: Institution (`structure/`)

**Purpose:** Build and manage the faculty → department → programme hierarchy.

**Layout:** Three-column accordion/tree:
- **Column 1 — Faculties list** with "Add Faculty" button. Each row: faculty name, code, department count. Click to select.
- **Column 2 — Departments** for the selected faculty, with "Add Department" button.
- **Column 3 — Programmes** for the selected department, with "Add Programme" button.

**Add Faculty modal fields:** Name, Code (e.g. FAS)
**Add Department modal fields:** Name, Code (e.g. CSC) — faculty pre-selected from context
**Add Programme modal fields:** Name, Type (dropdown: BSc | HND | Diploma | B-Tech | MSc | PhD), Duration in years — department pre-selected from context

Each item has an Edit and Delete button. Delete is blocked with a clear error if child records exist (e.g. cannot delete a faculty that has departments).

All writes go through `institution.service.js`. Write an audit log entry for every create/update/delete.

---

### PAGE 3: Students (`students/`)

**Purpose:** Bulk import students via Excel/CSV and view all registered students.

**Tabs:**
- **Import** — the bulk upload flow
- **Directory** — searchable, filterable list of all students

#### Import Tab Flow:

**Step 1 — Download Template**
Provide a "Download Template" button that generates and downloads a CSV with these exact headers:
```
full_name, index_number, email, phone, level, programme_name, programme_type, department_code, faculty_code
```
Include one example row in the template.

**Step 2 — Upload File**
File input accepting `.xlsx` and `.csv`. Parse using SheetJS (xlsx) loaded from CDN:
```js
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.0/package/xlsx.mjs';
```

**Step 3 — Preview & Validate**
After parsing, show a preview table of all rows. For each row, validate:
- `full_name` — required, non-empty
- `index_number` — required, matches pattern `TTU/[A-Z]+/[0-9]{2}/[0-9]{3}` (or whatever TTU's actual format is — make it configurable as a constant)
- `email` — required, valid email format
- `phone` — required
- `level` — required (HND 1 / HND 2 / B-Tech 3 / B-Tech 4 / etc.)
- `programme_name` + `programme_type` + `department_code` + `faculty_code` — must match an existing programme in the database

Show each row with a green tick or red error message. Show a summary: "X rows valid, Y rows have errors."

**Step 4 — Confirm & Import**
"Import X valid students" button. Disabled if any rows have errors.

On confirm: for each valid row, call the `create-user` Edge Function with:
```js
{
  email, password: generateDefaultPassword(index_number),
  role: 'student',
  full_name, phone,
  index_number, programme_id, level,
  programme_name, department_name
}
```

Default password generation:
```js
function generateDefaultPassword(indexNumber) {
  // e.g. "TTU/CSC/23/001" → "TTU@csc2023!"
  // Or simply use the index number with a standard suffix
  return indexNumber.replace(/\//g, '') + '@IAMS';
}
```

Show a live progress bar as accounts are created (one at a time, not all in parallel — to avoid rate limits). On completion show: "X accounts created successfully. Default password: [formula shown]."

Write one audit log entry per batch import (not per student) with `detail: { count, season_id_if_any }`.

#### Directory Tab:
- Search by name or index number
- Filter by faculty, department, programme, level
- Table: Index No | Name | Programme | Level | Status (active/inactive) | Joined date
- Click a row to open a detail side panel showing full profile

---

### PAGE 4: Supervisors (`supervisors/`)

**Purpose:** Bulk import school supervisors and company supervisors, and view all.

**Tabs:** Import | Directory

#### Import Tab:

**Template headers for School Supervisors:**
```
full_name, email, phone, staff_id
```

**Template headers for Company Supervisors:**
```
full_name, email, phone, company_name, company_phone
```

Let the Super Admin choose which type they are importing (radio: School Supervisor / Company Supervisor) before uploading.

Same preview → validate → confirm flow as Students. Default password: same formula using staff_id or email prefix.

#### Directory Tab:
- Toggle between school supervisors and company supervisors
- Table: Name | Phone | Email | Type | Zone(s) assigned (for school supervisors, derived from zone_supervisors) | Status | Joined
- Click row for detail panel

---

### PAGE 5: Admin Accounts (`admins/`)

**Purpose:** Create and manage Liaison Office admin accounts one at a time.

**Layout:** Master-detail — left list, right detail panel.

**Left panel:**
- Search by name/phone
- List all profiles where `role = 'admin'`, sorted by name
- "Create Admin" button

**Right detail panel (on selecting an admin):**
- Name, phone, email, member since, status (active / deactivated)
- "Edit" → inline edit for full_name, phone
- "Deactivate" / "Reactivate" → sets `is_active`
- "Reset Password" → toast: "Send password reset instructions to this admin's email"
- All actions write audit log

**Create Admin modal fields:** Full Name, Phone, Email, (password auto-generated and shown to the Super Admin after creation)

---

### PAGE 6: Audit Log (`system-audit/`)

**Purpose:** Read-only, filterable log of all Super Admin actions.

**Columns:** Timestamp | Actor | Action | Target Type | Target ID | Detail (expandable JSON view)

**Filters:** Date from/to | Action type dropdown

Load last 200 rows, filter client-side.

---

### PAGE 7: System Health (`system-health/`)

**Purpose:** Cross-season aggregate read-only analytics.

**Sections:**
1. Placements by Season — Season | Total | Submitted | Assigned | Flagged | Rejected
2. Letters by Season — Season | Total | Unique Students
3. Payments by Season — Season | Total GHS | Logbook fees | Report fees
4. Zone Coverage — Zone | Supervisors | Placements assigned
5. Users by Role — Role | Count (table)
6. Institutional Summary — Faculty | Departments | Programmes | Students (table)

---

### PAGE 8: System Config (`settings/`)

**Three tabs:**

**Tab 1 — Letter Assets Override**
Upload/replace letterhead, stamp, footer. Calls `updateSettings()` from `shared/services/settings.js`. Shows current previews.

**Tab 2 — Season Emergency Controls**
List all open seasons with a "Force Close" button each. Confirm modal before action. Calls `closeSeason(id)`. Writes audit log.

**Tab 3 — My Profile**
Edit own full_name, phone. Toggle theme.

---

## 9. DESIGN DIRECTION — IMPORTANT

The Super Admin portal must have its **own distinct visual identity**. It is NOT a copy or reskin of the existing admin portal. It represents the highest privilege level in the system and should feel premium, authoritative, and modern.

**Design principles:**
- **Darker, more commanding aesthetic** — deep navy/charcoal tones, high-contrast surfaces
- **Spacious layouts** — generous padding, clear visual hierarchy
- **Richer stat cards** — icon accents, colour-coded borders, more information per card
- **Data-dense tables** — power-user density, more columns per row than the regular admin portal
- **Inline `<style>` blocks per page are encouraged** — write bespoke CSS inside each HTML file for the premium look. Always use CSS variables from `theme.css` for all colours and spacing — never hardcode hex values
- **Light and dark mode must both look excellent** — use `var(--bg-surface)`, `var(--bg-default)`, `var(--text-primary)`, `var(--text-secondary)`, `var(--border-default)` everywhere so the existing theme toggle works correctly
- **No third-party UI libraries** — hand-crafted CSS only, built on the existing custom property system

---

## 10. CODE PATTERNS — MUST FOLLOW EXACTLY

### HTML head boilerplate (every page):
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <script>
    (function(){
      var t = localStorage.getItem('iams_theme_mode');
      if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
      }
    })();
  </script>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0a1a48">
  <title>PAGE TITLE | TTU IAMS Super Admin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles/theme.css">
  <link rel="stylesheet" href="/shell/shell.css">
</head>
<body>
<div id="app" class="app-shell">
  <div class="main-content" id="main-content">
    <main class="content-area" id="page-content">
      <!-- content -->
    </main>
  </div>
</div>
<div id="shell-overlays"></div>
<script type="module" src="./PAGE.js"></script>
</body>
</html>
```

### JS boilerplate (every page):
```js
import { requireRole }                    from '/modules/auth/auth-guard.js';
import { initShell, navigateTo, showToast } from '/shell/nav.js';
import { supabase }                        from '/shared/supabase-client.js';
import { formatDate, formatDateTime }      from '/shared/utils.js';

await requireRole(['super_admin']);
await initShell('PAGE_KEY'); // matches the 'page' key in SHELL_CONFIG nav
```

### Edge Function call helper (use consistently across all pages that create users):
```js
async function callCreateUser(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to create user');
  return json;
}
```

### Audit log helper (use on every super_admin action):
```js
async function writeAuditLog(action, targetType, targetId, detail = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  await supabase.from('super_admin_audit').insert({
    actor_id:    session.user.id,
    action,
    target_type: targetType,
    target_id:   String(targetId ?? ''),
    detail,
  });
}
```

### HTML escaping (use everywhere strings are rendered into innerHTML):
```js
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
```

### Toast: `showToast('message', 'success' | 'error' | 'info')`
### Loading overlay: `<div id="page-loading" class="page-loading-overlay"><div class="spinner-lg"></div></div>`
### Never use `alert()`, `<form>`, or `localStorage` for auth state

---

## 11. KEY DATABASE TABLES (complete reference)

```
profiles          id, role, full_name, phone, is_active, avatar_path, created_at
students          id (FK profiles), index_number, programme_id (FK programmes), level,
                  department (deprecated text), programme (deprecated text)
faculties         id, name, code, created_at, created_by
departments       id, faculty_id, name, code, created_at, created_by
programmes        id, department_id, name, type, duration_years, created_at, created_by
seasons           id, name, start_date, end_date, status, placement_window_start, placement_window_end
zones             id, name, description
zone_supervisors  zone_id, school_supervisor_id
placements        id, draft_id, student_id, season_id, company_name, nature_of_business,
                  region, city_town, street_landmark, contact_person, company_contact_phone,
                  latitude, longitude, location_source, geo_region, geo_district, geo_town,
                  geocode_status, start_date, end_date, status, zone_id, synced_at, created_at
letters           id, student_id, season_id, company_name, region, city_town,
                  street_landmark, contact_person, company_contact_phone,
                  verification_code, generated_at
settings          id=1, letterhead_path, stamp_path, footer_path, updated_at, updated_by
payments          id, student_id, season_id, purpose, amount_pesewas, currency,
                  status, paystack_reference, paid_at, created_at
super_admin_audit id, actor_id, action, target_type, target_id, detail (jsonb), created_at
```

**Views:**
- `student_profiles` — updated to join programmes → departments → faculties
- `placement_supervisors` — unchanged

---

## 12. EXISTING SERVICES TO REUSE

| File | Exports |
|---|---|
| `shared/services/seasons.js` | `listSeasons`, `getOpenSeason`, `closeSeason`, `archiveSeason` |
| `shared/services/zones.js` | `listZones` |
| `shared/services/placements.js` | `listPlacements`, `listPlacementsBySeason`, `listPlacementsByStatus` |
| `shared/services/letters.js` | `listLetters` |
| `shared/services/payments.service.js` | `listPaymentsForAdmin`, `summarizePayments`, `formatGHS` |
| `shared/services/settings.js` | `getSettings`, `updateSettings` |
| `shared/services/profile.service.js` | `getOwnProfile`, `updateOwnProfile` |
| `shared/services/students.js` | `listStudents`, `filterStudents` |
| `shared/utils.js` | `formatDate`, `formatDateTime`, `timeAgo` |

---

## 13. COMPLETE DELIVERY CHECKLIST

Every item below must be delivered complete, with no placeholders or TODOs:

**Migration & backend:**
- [ ] `supabase/migrations/20260703000001_super_admin_and_structure.sql`
- [ ] `supabase/functions/create-user/index.ts`

**New shared service:**
- [ ] `src/shared/services/institution.service.js`

**Updates to existing files:**
- [ ] `src/modules/auth/auth-guard.js` — add super_admin to DASHBOARD_PATHS
- [ ] `src/shell/shell-config.js` — add super_admin config
- [ ] `src/shared/services/students.js` — update filterStudents() for new fields
- [ ] `vite.config.js` — add 8 new HTML input entries

**Super Admin portal — 16 new files:**
- [ ] `src/modules/super_admin/dashboard/dashboard.html` + `.js`
- [ ] `src/modules/super_admin/structure/structure.html` + `.js`
- [ ] `src/modules/super_admin/students/students.html` + `.js`
- [ ] `src/modules/super_admin/supervisors/supervisors.html` + `.js`
- [ ] `src/modules/super_admin/admins/admins.html` + `.js`
- [ ] `src/modules/super_admin/system-audit/system-audit.html` + `.js`
- [ ] `src/modules/super_admin/system-health/system-health.html` + `.js`
- [ ] `src/modules/super_admin/settings/settings.html` + `.js`

---

## 14. FILES TO SHARE WITH THE AI ASSISTANT

### Shell & auth
- `src/shell/shell-config.js`
- `src/shell/nav.js`
- `src/modules/auth/auth-guard.js`

### Design system
- `src/styles/theme.css`
- `src/styles/components.css`
- `src/shell/shell.css`

### Shared services
- `src/shared/supabase-client.js`
- `src/shared/utils.js`
- `src/shared/services/seasons.js`
- `src/shared/services/placements.js`
- `src/shared/services/letters.js`
- `src/shared/services/payments.service.js`
- `src/shared/services/settings.js`
- `src/shared/services/profile.service.js`
- `src/shared/services/students.js`

### Schema
- `supabase/migrations/20260629000001_squashed.sql`
- `supabase/migrations/20260630000003_payments.sql`
- `supabase/migrations/20260630000005_profile_avatars.sql`

### Project config
- `vite.config.js`
- `file_tree.md`

**Total: 20 files.**
