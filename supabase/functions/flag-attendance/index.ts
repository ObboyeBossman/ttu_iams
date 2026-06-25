import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * flag-attendance Edge Function
 * Triggered via pg_net or cron when attendance logs are created or updated.
 * In Phase 2, this calculates distance and inserts into attendance_flags.
 */

serve(async (req) => {
  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { record, old_record, type } = await req.json();

    if (type === 'INSERT' || type === 'UPDATE') {
      const log = record;
      
      // Basic stub for Phase 2: if distance > 200m, flag it
      if (log.distance_from_placement_m && log.distance_from_placement_m > 200) {
        
        // Check if a flag already exists for this log to prevent duplicates
        const { data: existingFlags } = await supabaseClient
          .from('attendance_flags')
          .select('id')
          .eq('attendance_log_id', log.id);

        if (!existingFlags || existingFlags.length === 0) {
          await supabaseClient
            .from('attendance_flags')
            .insert({
              student_id: log.student_id,
              season_id: log.season_id,
              attendance_log_id: log.id,
              flag_reason: `Distance from placement exceeded threshold: ${log.distance_from_placement_m}m`
            });
          
          // Also update the log status to 'flagged_location'
          await supabaseClient
            .from('attendance_logs')
            .update({ status: 'flagged_location' })
            .eq('id', log.id);
        }
      }
    }

    return new Response(JSON.stringify({ message: 'Processed attendance event' }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { "Content-Type": "application/json" },
      status: 400,
    });
  }
});
