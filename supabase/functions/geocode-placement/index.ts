import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import "@supabase/functions-js/edge-runtime.d.ts"

// -----------------------------------------------------------------------------
// IMPORTANT — the address_components field mapping below is UNVERIFIED against
// a real Ghanaian Google Geocoding response and must be confirmed before
// relying on it in production.
//
// Make a real call for a known coordinate (e.g. Takoradi: 4.8845, -1.7554)
// and inspect the actual `address_components` returned — Google's generic
// admin-level schema does not map identically onto every country's real
// administrative structure.
//
// Until verified, treat geo_region/geo_district/geo_town as "best guess,
// human-checkable" — which is exactly why the admin UI exposes a manual
// override path (placement-zones.js) rather than treating this as ground truth.
// -----------------------------------------------------------------------------

console.log("Geocode function loaded")

Deno.serve(async (req) => {
  let placementId: string | null = null

  try {
    const { record } = await req.json()
    if (!record || !record.id) {
      return new Response('No placement record provided', { status: 400 })
    }
    placementId = record.id

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const lat = record.latitude
    const lng = record.longitude

    // location_source = 'manual' (no GPS captured) is an expected, normal
    // Phase 1 state — not an error. Mark as failed (nothing to geocode)
    // without logging it as a server-side error.
    if (lat == null || lng == null) {
      await supabaseClient
        .from('placements')
        .update({ geocode_status: 'failed' })
        .eq('id', record.id)
      return new Response(
        JSON.stringify({ skipped: true, reason: 'no_coordinates' }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    const apiKey = Deno.env.get('GOOGLE_GEOCODING_API_KEY')
    if (!apiKey) {
      console.error('geocode-placement: missing GOOGLE_GEOCODING_API_KEY secret')
      await supabaseClient
        .from('placements')
        .update({ geocode_status: 'failed' })
        .eq('id', record.id)
      return new Response('Missing API Key', { status: 500 })
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`

    // Bound the request so a slow Google response can't hang this function.
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    let response: Response
    try {
      response = await fetch(url, { signal: controller.signal })
    } catch (fetchErr) {
      clearTimeout(timeout)
      console.error('geocode-placement: fetch failed/timed out for placement', record.id, fetchErr)
      await supabaseClient
        .from('placements')
        .update({ geocode_status: 'failed' })
        .eq('id', record.id)
      return new Response('Geocoding request failed or timed out', { status: 502 })
    }
    clearTimeout(timeout)

    const data = await response.json()

    if (data.status !== 'OK' || !data.results || data.results.length === 0) {
      console.error('geocode-placement: API returned non-OK status for placement', record.id, data.status, data.error_message)
      await supabaseClient
        .from('placements')
        .update({ geocode_status: 'failed' })
        .eq('id', record.id)
      return new Response('Geocoding failed', { status: 400 })
    }

    const components = data.results[0]?.address_components || []

    // See header comment: unverified mapping, intentionally left explicit.
    const geo_region   = components.find((c: any) => c.types.includes('administrative_area_level_1'))?.long_name || null
    const geo_district = components.find((c: any) => c.types.includes('administrative_area_level_2'))?.long_name || null
    const geo_town     = components.find((c: any) => c.types.includes('locality'))?.long_name
                      || components.find((c: any) => c.types.includes('sublocality'))?.long_name
                      || components.find((c: any) => c.types.includes('administrative_area_level_3'))?.long_name
                      || null

    // OK status but nothing extracted is a strong signal the field-mapping
    // assumption is wrong for this result — treat it as failed rather than
    // writing three nulls and silently calling it 'success'.
    if (!geo_region && !geo_district && !geo_town) {
      console.error(
        'geocode-placement: OK status but no usable address_components matched for placement',
        record.id,
        JSON.stringify(components)
      )
      await supabaseClient
        .from('placements')
        .update({ geocode_status: 'failed' })
        .eq('id', record.id)
      return new Response('Geocoding succeeded but field mapping extracted nothing', { status: 422 })
    }

    const { error } = await supabaseClient
      .from('placements')
      .update({
        geo_region,
        geo_district,
        geo_town,
        geocode_status: 'success',
        geocoded_at: new Date().toISOString(),
      })
      .eq('id', record.id)

    if (error) throw error

    return new Response(JSON.stringify({ success: true, geo_region, geo_district, geo_town }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('geocode-placement: unhandled error for placement', placementId, error)
    // Best-effort: still try to mark the row failed rather than leaving it
    // stuck on 'pending' forever, but never throw past this point.
    try {
      if (placementId) {
        const supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )
        await supabaseClient.from('placements').update({ geocode_status: 'failed' }).eq('id', placementId)
      }
    } catch (_) { /* swallow — already in the error path */ }

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
