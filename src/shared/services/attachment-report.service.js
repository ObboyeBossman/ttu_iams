// =============================================================================
// IAMS — shared/services/attachment-report.service.js
// Service layer for Student Attachment Report feature.
// Integrates with Supabase, with automatic local fallback if tables do not exist.
//
// Payment status/charging moved to shared/services/payments.service.js
// (hasPaid / initiatePayment) — see report.js.
// =============================================================================

import { supabase } from '../supabase-client.js';

const REPORT_KEY_PREFIX = 'iams_report_';

/**
 * Gets the student's report record for the active season.
 */
export async function getAttachmentReport(studentId, seasonId) {
  try {
    const { data, error } = await supabase
      .from('attachment_reports')
      .select('*')
      .eq('student_id', studentId)
      .eq('season_id', seasonId)
      .maybeSingle();

    if (!error && data) {
      return { data, error: null };
    }
  } catch (e) {
    // Ignore and fallback
  }

  // Fallback to localStorage
  const localStr = localStorage.getItem(`${REPORT_KEY_PREFIX}${studentId}_${seasonId}`);
  if (localStr) {
    try {
      return { data: JSON.parse(localStr), error: null };
    } catch (e) {
      return { data: null, error: e };
    }
  }
  return { data: null, error: null };
}

/**
 * Upserts the report data (draft/sections/inputs).
 */
export async function upsertAttachmentReport(studentId, seasonId, reportData) {
  const payload = {
    student_id: studentId,
    season_id: seasonId,
    path_type: reportData.path_type || 'ai',
    input_form: reportData.input_form || {},
    report_sections: reportData.report_sections || {},
    status: reportData.status || 'draft',
    pdf_url: reportData.pdf_url || null,
    submitted_at: reportData.submitted_at || null,
    updated_at: new Date().toISOString()
  };

  try {
    const { data, error } = await supabase
      .from('attachment_reports')
      .upsert(payload, { onConflict: 'student_id,season_id' })
      .select()
      .single();

    if (!error) return { data, error: null };
  } catch (e) {
    // Ignore and fallback
  }

  // Fallback to localStorage
  localStorage.setItem(`${REPORT_KEY_PREFIX}${studentId}_${seasonId}`, JSON.stringify(payload));
  return { data: payload, error: null };
}
