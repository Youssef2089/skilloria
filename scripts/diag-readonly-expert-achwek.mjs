// STRICT READ-ONLY diag — aucune écriture en BDD.
// Audit expert achwek.bacc@gmail.com : pourquoi 0 mission recommandée ?
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const EMAIL = 'achwek.bacc@gmail.com'

console.log('=== 1. USER ===')
const { data: users } = await supa.auth.admin.listUsers()
const u = users?.users?.find(x => x.email?.toLowerCase() === EMAIL)
if (!u) { console.log('NOT FOUND in auth.users'); process.exit(0) }
console.log('auth.users.id =', u.id, '| email_confirmed_at =', u.email_confirmed_at)

const { data: uRow } = await supa.from('users').select('id, email, user_type, is_verified, domain_id, locale, created_at, domains(slug, name)').eq('id', u.id).maybeSingle()
console.log('public.users :', JSON.stringify(uRow, null, 2))

console.log('\n=== 2. PROFILE ===')
const { data: prof } = await supa.from('profiles').select('*').eq('user_id', u.id).maybeSingle()
if (!prof) { console.log('NO PROFILE ROW'); process.exit(0) }
console.log('profile.id =', prof.id)
console.log({
  verification_status: prof.verification_status,
  visible: prof.visible,
  ai_consent_at: prof.ai_consent_at,
  cv_parsing_status: prof.cv_parsing_status,
  domain_id: prof.domain_id,
  expert_type: prof.expert_type,
  availability_status: prof.availability_status,
  cdi_status: prof.cdi_status,
  verified_at: prof.verified_at,
  branch_id: prof.branch_id,
  speciality_id: prof.speciality_id,
})

console.log('\n=== 3. SCOPE MATCHING CHECK ===')
const scope = {
  'verification_status=approved': prof.verification_status === 'approved',
  'visible=true': prof.visible === true,
  'ai_consent_at NOT NULL': prof.ai_consent_at != null,
  'cv_parsing_status=done': prof.cv_parsing_status === 'done',
  'user_type=expert_freelance': uRow?.user_type === 'expert_freelance',
  'domain_id present': !!prof.domain_id,
  'availability_status != do_not_disturb (freelance)': prof.availability_status !== 'do_not_disturb',
}
console.log(scope)
const allPass = Object.values(scope).every(Boolean)
console.log('=> SCOPE PASS =', allPass)

console.log('\n=== 4. MATCHES POUR CET EXPERT ===')
const { data: matchRows, count } = await supa
  .from('matches').select('id, publication_id, score, status, created_at', { count: 'exact' })
  .eq('profile_id', prof.id)
console.log('matches.count =', count ?? matchRows?.length ?? 0)
for (const m of matchRows ?? []) console.log(' -', m.id, 'pub=', m.publication_id, 'score=', m.score, 'status=', m.status, 'at=', m.created_at)

console.log('\n=== 5. PUBLICATIONS DOMAINE EXPERT — STATUT/TYPE ===')
const { data: pubs } = await supa
  .from('publications')
  .select('id, type, status, title, organization_id, domain_id, published_at, created_at')
  .eq('domain_id', prof.domain_id)
  .order('created_at', { ascending: false })
  .limit(30)
console.log('publications du domaine (30 max) :', pubs?.length ?? 0)
let eligibleCount = 0
for (const p of pubs ?? []) {
  const eligible = p.status === 'published' && p.type === (uRow?.user_type === 'expert_cdi' ? 'offre' : 'mission')
  if (eligible) eligibleCount++
  console.log(` - ${p.id.slice(0,8)} [${p.type}/${p.status}] "${(p.title||'').slice(0,60)}" pub_at=${p.published_at?.slice(0,10) ?? 'null'} | eligible=${eligible}`)
}
console.log('=> PUBLICATIONS ÉLIGIBLES dans le domaine de l\'expert =', eligibleCount)

console.log('\n=== 6. RUNMATCHING — POOL ATTENDU (simule loadEligibleProfiles) ===')
const expectedUserType = uRow?.user_type === 'expert_cdi' ? 'expert_cdi' : 'expert_freelance'
const poolQ = await supa.from('profiles')
  .select('id, users!profiles_user_id_fkey!inner(user_type)', { count: 'exact' })
  .eq('domain_id', prof.domain_id)
  .eq('cv_parsing_status', 'done')
  .eq('visible', true)
  .not('ai_consent_at', 'is', null)
  .eq('verification_status', 'approved')
  .eq('users.user_type', expectedUserType)
console.log('Profils éligibles dans le pool (au moment de l\'appel runMatching de la dernière publi) :', poolQ.count ?? poolQ.data?.length ?? 0)
const inPool = (poolQ.data ?? []).some(r => r.id === prof.id)
console.log('=> CET EXPERT DANS LE POOL =', inPool)
