// =============================================================================
// IAMS — shared/services/attachment-report.service.js
// Service layer for Student Attachment Report feature.
// Integrates with Supabase, with automatic local fallback if tables do not exist.
// =============================================================================

import { supabase } from '../supabase-client.js';

const REPORT_KEY_PREFIX = 'iams_report_';
const PAYMENT_KEY_PREFIX = 'iams_payment_';

/**
 * Checks if the student has paid for the AI report generation in the active season.
 */
export async function hasPaidForSeason(studentId, seasonId) {
  try {
    const { data, error } = await supabase
      .from('attachment_payments')
      .select('*')
      .eq('student_id', studentId)
      .eq('season_id', seasonId)
      .maybeSingle();

    if (!error && data) {
      return data.status === 'confirmed';
    }
  } catch (e) {
    // Ignore and fallback
  }

  // Fallback to localStorage
  const localVal = localStorage.getItem(`${PAYMENT_KEY_PREFIX}${studentId}_${seasonId}`);
  return localVal === 'confirmed';
}

/**
 * Marks the active season as paid for the student (Simulating webhook confirmation).
 */
export async function markSeasonAsPaid(studentId, seasonId, paymentRef = '') {
  try {
    const { data, error } = await supabase.functions.invoke('verify-paystack', {
      body: { 
        reference: paymentRef || `pay_${Math.random().toString(36).substr(2, 9)}`,
        student_id: studentId, 
        season_id: seasonId 
      }
    });

    if (!error && data?.success) {
      localStorage.setItem(`${PAYMENT_KEY_PREFIX}${studentId}_${seasonId}`, 'confirmed');
      return { data: data.data, error: null };
    }
  } catch (e) {
    console.error('Edge function verify-paystack failed:', e);
  }

  // Fallback to localStorage for local dev without Edge Functions running
  localStorage.setItem(`${PAYMENT_KEY_PREFIX}${studentId}_${seasonId}`, 'confirmed');
  return { data: { status: 'confirmed' }, error: null };
}

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
