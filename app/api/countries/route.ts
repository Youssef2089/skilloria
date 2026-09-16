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
    // `phone_code` EST SÉLECTIONNÉ, et il manquait : le référentiel le porte
    // pour les 64 pays (migration 20260916000000), mais cette route ne le
    // renvoyait pas. Un sélecteur de pays pour la saisie d'un téléphone avait
    // donc le drapeau et le nom, et pas l'indicatif — d'où le « 🇫🇷 » figé et le
    // placeholder « +33 » en dur qui ont bloqué les inscriptions hors de France.
    //
    // Les clients Supabase ne sont PAS typés : une colonne absente ici ne
    // produit aucune erreur, juste un champ `undefined` côté client. C'est
    // exactement comme ça que le manque est passé inaperçu.
    const { data, error } = await supabase
      .from('countries')
      .select('code, name_fr, name_en, name_es, name_de, flag_emoji, phone_code, sort_order')
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
