// Reproduit la query exacte que la page /valider lance vers PostgREST.
// On ne révèle pas les data — uniquement le status + le message d'erreur.
import { readFileSync } from 'node:fs'
const env = readFileSync('.env.local', 'utf8')
function pick(name) {
  const m = env.split(/\r?\n/).find(l => l.startsWith(name + '='))
  return m ? m.slice(name.length + 1).trim() : null
}
const url = pick('NEXT_PUBLIC_SUPABASE_URL')
const anon = pick('NEXT_PUBLIC_SUPABASE_ANON_KEY')
const USER_ID = '0e28543e-d91d-4b0a-8e0c-64fa33eec3a3'
const COLS =
  'id,title,summary,seniority,years_experience,skills,certifications,branch_id,speciality_id,languages,location,work_modes,tjm_min,tjm_max,availability_date,linkedin_url,cv_parsing_status,visible,phone,address_line,postal_code,city,country,birth_year,photo_url,years_total_experience,availability_status'

const endpoint = `${url}/rest/v1/profiles?select=${encodeURIComponent(COLS)}&user_id=eq.${USER_ID}`
console.log('Endpoint:', endpoint)

// Test 1 : avec apikey + Bearer (comme supabase-js anon)
const r1 = await fetch(endpoint, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } })
console.log('\n--- Test 1 : apikey + Bearer=anon (sans session user) ---')
console.log('status:', r1.status, r1.statusText)
const body1 = await r1.text()
console.log('body  :', body1.slice(0, 600))

// Test 2 : sans aucun header (reproduit "No API key found")
const r2 = await fetch(endpoint, { headers: {} })
console.log('\n--- Test 2 : aucun header ---')
console.log('status:', r2.status, r2.statusText)
console.log('body  :', (await r2.text()).slice(0, 200))
