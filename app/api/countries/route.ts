import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    throw new Error('Supabase env vars missing (URL or ANON_KEY)')
  }
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function GET(): Promise<Response> {
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('countries')
      .select('code, name_fr, name_en, name_es, name_de, flag_emoji, sort_order')
      .eq('active', true)
      .order('sort_order', { ascending: true })

    if (error) {
      console.error('[GET /api/countries] supabase error', error.message)
      return new Response(JSON.stringify({ error: 'Failed to load countries' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    }

    return new Response(JSON.stringify(data ?? []), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        // Mise en cache : les pays changent rarement
        'cache-control': 'public, max-age=3600, s-maxage=3600',
      },
    })
  } catch (err) {
    console.error('[GET /api/countries] exception', err)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}
