// =============================================================================
// IAMS — shared/services/students.js
// =============================================================================
// Student profile lookups. `profiles` (identity common to every role) and
// `students` (academic fields: index_number, department, programme, level)
// are separate tables since Rev. 6 (Section 11) — this service is the one
// place that joins them, mostly via the student_profiles view so callers
// get a single flat row instead of two separate queries to stitch together
// themselves.
//
// Account creation (admin inserting a profiles + students row pair) is
// intentionally NOT here yet — FR1 says "the Admin creates and manages
// accounts," but that flow also needs an auth.users row created via
// Supabase Auth admin APIs, which the mock client's documented supported
// surface does not cover. Treating that as out of scope for this pass
// rather than half-implementing it against a mock that can't back it.
// =============================================================================

import { supabase } from '../supabase-client.js';

/**
 * Returns every student as a flat profile+academic row (id, full_name,
 * phone, created_at, index_number, department, programme, level), sorted
 * by index_number. Visibility is RLS-scoped same as everything else: an
 * admin gets all students, a school supervisor gets only students with a
 * placement in one of their assigned zones, a student gets only themself
 * (see "students: supervisor reads assigned" in rls-policies.sql).
 */
export async function listStudents() {
  const { data, error } = await supabase
    .from('student_profiles')
    .select('*')
    .order('index_number', { ascending: true });
  return { data, error };
}

/** Returns one student's flat profile+academic row by id, or null if not found / not visible to the caller. */
export async function getStudentById(studentId) {
  const { data, error } = await supabase.from('student_profiles').select('*').eq('id', studentId).maybeSingle();
  return { data, error };
}

/**
 * Client-side filter over an already-fetched student list.
 *
 * Supports both the new structured FK fields (faculty_id, department_id,
 * programme_id — from the updated student_profiles view) and the legacy
 * free-text `department` column as a fallback. All filters are combined
 * with AND semantics.
 *
 * @param {Array}  students
 * @param {Object} opts
 * @param {string} [opts.faculty_id]    - Filter by faculty UUID (new)
 * @param {string} [opts.department_id] - Filter by department UUID (new)
 * @param {string} [opts.programme_id]  - Filter by programme UUID (new)
 * @param {string} [opts.department]    - Legacy text match (fallback)
 * @param {string} [opts.level]
 * @param {string} [opts.search]        - Free-text: name or index_number
 * @param {boolean}[opts.activeOnly]    - When true, exclude is_active=false
 */
export function filterStudents(students, {
  faculty_id,
  department_id,
  programme_id,
  department,
  level,
  search,
  activeOnly,
} = {}) {
  let rows = students;

  if (faculty_id) {
    rows = rows.filter((s) => s.faculty_id === faculty_id);
  }
  if (department_id) {
    rows = rows.filter((s) => s.department_id === department_id);
  }
  if (programme_id) {
    rows = rows.filter((s) => s.programme_id === programme_id);
  }
  // Legacy fallback — used by existing admin portal pages until migrated
  if (department && !department_id) {
    rows = rows.filter((s) => s.department === department);
  }
  if (level) {
    rows = rows.filter((s) => s.level === level);
  }
  if (activeOnly) {
    rows = rows.filter((s) => s.is_active !== false);
  }
  if (search) {
    const needle = search.trim().toLowerCase();
    if (needle) {
      rows = rows.filter(
        (s) =>
          s.full_name.toLowerCase().includes(needle) ||
          s.index_number.toLowerCase().includes(needle)
      );
    }
  }
  return rows;
}

/** Updates a student's academic record (department, programme, level — not index_number, which schema.sql declares unique and isn't expected to change post-enrollment). Admin-only at the RLS layer ("students: admin updates"). */
export async function updateStudentAcademics(studentId, patch) {
  const { data, error } = await supabase.from('students').update(patch).eq('id', studentId).select().single();
  return { data, error };
}

/** Updates a student's common profile fields (full_name, phone). Admin-only at the RLS layer for editing someone else's profile ("profiles: admin updates"); a student editing their own row goes through the same table but is a self-service flow this function doesn't distinguish — RLS allows both paths transparently. */
export async function updateStudentProfile(studentId, patch) {
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', studentId).select().single();
  return { data, error };
}
