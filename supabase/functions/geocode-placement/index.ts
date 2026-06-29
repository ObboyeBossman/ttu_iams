import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import "@supabase/functions-js/edge-runtime.d.ts"

console.log("Geocode function loaded")

Deno.serve(async (req) => {
  try {
    const { record } = await req.json()
    if (!record || !record.id) {
      return new Response('No placement record provided', { status: 400 })
    }
    
    // We expect placement coordinates in latitude and longitude, or we can use the location address string
    // Let's use coordinates first, fallback to address if we have it? No, the prompt says:
    // "call this function immediately after a placement record is created/updated with lat/long."
    
    const lat = record.latitude
    const lng = record.longitude
    const apiKey = Deno.env.get('GOOGLE_GEOCODING_API_KEY')
    
    // Create a Supabase client with the Auth context of the function
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' // We use service role to update admin fields
    )

    if (!apiKey) {
      console.error('Missing Google API Key')
      await supabaseClient.from('placements').update({ geocode_status: 'failed' }).eq('id', record.id)
      return new Response('Missing API Key', { status: 500 })
    }
    
    if (!lat || !lng) {
      await supabaseClient.from('placements').update({ geocode_status: 'failed' }).eq('id', record.id)
      return new Response('Missing coordinates', { status: 400 })
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`
    const response = await fetch(url)
    const data = await response.json()

    if (data.status !== 'OK' || !data.results || data.results.length === 0) {
      console.error('Geocoding API failed or returned no results:', data)
      await supabaseClient.from('placements').update({ geocode_status: 'failed' }).eq('id', record.id)
      return new Response('Geocoding failed', { status: 400 })
    }

    const components = data.results[0]?.address_components || []

    const region = components.find((c: any) => c.types.includes('administrative_area_level_1'))?.long_name || null
    const district = components.find((c: any) => c.types.includes('administrative_area_level_2'))?.long_name || null
    const town = components.find((c: any) => c.types.includes('locality'))?.long_name
             || components.find((c: any) => c.types.includes('sublocality'))?.long_name
             || components.find((c: any) => c.types.includes('administrative_area_level_3'))?.long_name
             || null

    const { error } = await supabaseClient
      .from('placements')
      .update({
        region: region, // The DB might already have a region column used differently, but per prompt we overwrite it with Google data
        district: district,
        town: town,
        geocode_status: 'success',
        geocoded_at: new Date().toISOString()
      })
      .eq('id', record.id)

    if (error) throw error

    return new Response(JSON.stringify({ success: true, region, district, town }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('Error in geocode-placement:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
