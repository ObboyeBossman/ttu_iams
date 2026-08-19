// src/shared/services/letters.service.js

import { supabase } from '../supabase-client.js';
import { generateVerificationCode } from '../utils.js';

/**
 * Insert a new letter row into the `letters` table.
 * Generates the verification_code client-side.
 *
 * @param {Object} formData - Raw form data (student_id, season_id, company_name, etc.)
 * @returns {{ data: Object|null, error: Error|null }}
 */
export async function createLetter(formData) {
  const verification_code = generateVerificationCode();

  const { data, error } = await supabase
    .from('letters')
    .insert({
      student_id: formData.student_id,
      season_id: formData.season_id,
      company_name: formData.company_name,
      region: formData.region,
      city_town: formData.city_town,
      street_landmark: formData.street_landmark,
      contact_person: formData.contact_person,
      company_contact_phone: formData.company_contact_phone,
      verification_code,
    })
    .select()
    .single();

  return { data, error };
}
