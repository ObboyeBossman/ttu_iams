// =============================================================================
// IAMS — shared/services/institution.service.js
// All reads/writes for faculties, departments, and programmes.
// Super Admin only for mutations; all authenticated users can read.
// =============================================================================

import { supabase } from '../supabase-client.js';

// ---------------------------------------------------------------------------
// FACULTIES
// ---------------------------------------------------------------------------

/** Returns all faculties ordered by name, with a count of their departments. */
export async function listFaculties() {
  const { data, error } = await supabase
    .from('faculties')
    .select('*, departments(count)')
    .order('name', { ascending: true });
  return { data, error };
}

/** Returns a single faculty by id. */
export async function getFacultyById(id) {
  const { data, error } = await supabase
    .from('faculties')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return { data, error };
}

/** Creates a new faculty. RLS enforces super_admin only. */
export async function createFaculty({ name, code, created_by }) {
  const { data, error } = await supabase
    .from('faculties')
    .insert({ name: name.trim(), code: code.trim().toUpperCase(), created_by })
    .select()
    .single();
  return { data, error };
}

/** Updates faculty name and/or code. */
export async function updateFaculty(id, patch) {
  const clean = {};
  if (patch.name !== undefined) clean.name = patch.name.trim();
  if (patch.code !== undefined) clean.code = patch.code.trim().toUpperCase();
  const { data, error } = await supabase
    .from('faculties')
    .update(clean)
    .eq('id', id)
    .select()
    .single();
  return { data, error };
}

/**
 * Deletes a faculty. Will fail with a foreign key error if departments
 * still reference it (ON DELETE RESTRICT) — callers should surface that
 * error to the user rather than silently failing.
 */
export async function deleteFaculty(id) {
  const { error } = await supabase
    .from('faculties')
    .delete()
    .eq('id', id);
  return { error };
}

// ---------------------------------------------------------------------------
// DEPARTMENTS
// ---------------------------------------------------------------------------

/** Returns departments, optionally filtered by faculty_id, with programme count. */
export async function listDepartments(facultyId = null) {
  let q = supabase
    .from('departments')
    .select('*, programmes(count)')
    .order('name', { ascending: true });
  if (facultyId) q = q.eq('faculty_id', facultyId);
  const { data, error } = await q;
  return { data, error };
}

/** Creates a new department under a faculty. */
export async function createDepartment({ faculty_id, name, code, created_by }) {
  const { data, error } = await supabase
    .from('departments')
    .insert({ faculty_id, name: name.trim(), code: code.trim().toUpperCase(), created_by })
    .select()
    .single();
  return { data, error };
}

/** Updates department name and/or code. */
export async function updateDepartment(id, patch) {
  const clean = {};
  if (patch.name !== undefined) clean.name = patch.name.trim();
  if (patch.code !== undefined) clean.code = patch.code.trim().toUpperCase();
  const { data, error } = await supabase
    .from('departments')
    .update(clean)
    .eq('id', id)
    .select()
    .single();
  return { data, error };
}

/**
 * Deletes a department. Fails if programmes still reference it
 * (ON DELETE RESTRICT).
 */
export async function deleteDepartment(id) {
  const { error } = await supabase
    .from('departments')
    .delete()
    .eq('id', id);
  return { error };
}

// ---------------------------------------------------------------------------
// PROGRAMMES
// ---------------------------------------------------------------------------

/** Returns programmes, optionally filtered by department_id. */
export async function listProgrammes(departmentId = null) {
  let q = supabase
    .from('programmes')
    .select('*, students(count)')
    .order('name', { ascending: true });
  if (departmentId) q = q.eq('department_id', departmentId);
  const { data, error } = await q;
  return { data, error };
}

/** Returns all programmes with department + faculty joined (for dropdowns). */
export async function listProgrammesFull() {
  const { data, error } = await supabase
    .from('programmes')
    .select(`
      *,
      departments (
        id, name, code,
        faculties ( id, name, code )
      )
    `)
    .order('name', { ascending: true });
  return { data, error };
}

/** Creates a new programme under a department. */
export async function createProgramme({ department_id, name, type, duration_years, created_by }) {
  const { data, error } = await supabase
    .from('programmes')
    .insert({ department_id, name: name.trim(), type, duration_years: Number(duration_years), created_by })
    .select()
    .single();
  return { data, error };
}

/** Updates programme fields. */
export async function updateProgramme(id, patch) {
  const clean = { ...patch };
  if (clean.name) clean.name = clean.name.trim();
  if (clean.duration_years) clean.duration_years = Number(clean.duration_years);
  const { data, error } = await supabase
    .from('programmes')
    .update(clean)
    .eq('id', id)
    .select()
    .single();
  return { data, error };
}

/**
 * Deletes a programme. Fails if students still reference it
 * (ON DELETE RESTRICT).
 */
export async function deleteProgramme(id) {
  const { error } = await supabase
    .from('programmes')
    .delete()
    .eq('id', id);
  return { error };
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/** Programme type options in display order. */
export const PROGRAMME_TYPES = ['BSc', 'HND', 'Diploma', 'B-Tech', 'MSc', 'PhD'];

/**
 * Resolves a row from the spreadsheet import (faculty_code, department_code,
 * programme_name, programme_type) to a programme_id. Returns null if no
 * match found in the provided cached data.
 *
 * @param {Object} row - { faculty_code, department_code, programme_name, programme_type }
 * @param {Array}  programmes - result from listProgrammesFull()
 */
export function resolveProgrammeId(row, programmes) {
  const match = programmes.find(p =>
    p.name.toLowerCase() === row.programme_name?.trim().toLowerCase() &&
    p.type === row.programme_type?.trim() &&
    p.departments?.code?.toUpperCase() === row.department_code?.trim().toUpperCase() &&
    p.departments?.faculties?.code?.toUpperCase() === row.faculty_code?.trim().toUpperCase()
  );
  return match?.id ?? null;
}
