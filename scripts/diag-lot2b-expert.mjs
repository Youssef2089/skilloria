// Diagnostique Lot 2b — côté expert.
//
// Couvre :
//   (a) Feed via service_role : montre le match D365 / score 9 / reason
//   (b) Détail + flip notif read + match notified→viewed (atomic)
//   (c) Candidature POST → INSERT ; ré-INSERT → 23505 (déjà candidaté)
//   (d) Dismiss POST → match.status='dismissed'
//   (e) PREUVE durcissement RLS :
//        - Auth anon authentifiée comme user expert
//        - SELECT publications WHERE id = publi matchée → row visible (via la
//          fonction SECURITY DEFINER expert_has_match_for_publication)
//        - SELECT publications WHERE id = autre publi non-matchée → 0 row
//        - INSERT candidatures sans match → blocked (RLS WITH CHECK)
//
// Compte de test :
//   user expert  : youssef.cherif89@gmail.com
//   profile_id   : ce6b8369-1993-4236-9a1f-a2566280aa3c
//   publi D365   : be1921ea-ae54-43e4-96a4-74b3697231d0

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}

const { createClient } = await import('@supabase/supabase-js')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = createClient(SUPABASE_URL, SRK, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const EXPERT_USER_EMAIL = 'youssef.cherif89@gmail.com'
const EXPERT_PROFILE_ID = 'ce6b8369-1993-4236-9a1f-a2566280aa3c'
const PUBLI_D365 = 'be1921ea-ae54-43e4-96a4-74b3697231d0'

// ───────────────────────────────────────────────────────────────────────────
// (0) Reset état pour rejouer proprement
// ───────────────────────────────────────────────────────────────────────────
console.log('=== (0) RESET ===')
// Remettre le match à 'notified' et virer dismiss pour rejouer
await supabaseAdmin
  .from('matches')
  .update({ status: 'notified' })
  .eq('publication_id', PUBLI_D365)
  .eq('profile_id', EXPERT_PROFILE_ID)

// Supprimer candidature existante si présente
const { error: delErr } = await supabaseAdmin
  .from('candidatures')
  .delete()
  .eq('publication_id', PUBLI_D365)
  .eq('profile_id', EXPERT_PROFILE_ID)
if (delErr) console.log('  delete candidature err:', delErr.message)

// Remettre notif à 'pending' / null read_at
await supabaseAdmin
  .from('notifications')
  .update({ status: 'pending', read_at: null })
  .eq('entity_id', PUBLI_D365)
  .eq('type', 'new_match_opportunity')

console.log('  reset OK')
console.log()

// ───────────────────────────────────────────────────────────────────────────
// (a) FEED
// ───────────────────────────────────────────────────────────────────────────
console.log('=== (a) FEED — service_role simulation ===')
const { data: matches } = await supabaseAdmin
  .from('matches')
  .select('id, score, status, explanation, publication_id')
  .eq('profile_id', EXPERT_PROFILE_ID)
  .neq('status', 'dismissed')
  .order('score', { ascending: false })

console.log('  matches non-dismissed :', matches?.length ?? 0)
for (const m of matches ?? []) {
  const { data: pub } = await supabaseAdmin
    .from('publications')
    .select('id, type, title, status, confidential')
    .eq('id', m.publication_id)
    .maybeSingle()
  if (!pub) continue
  console.log(`  - "${pub.title}" (${pub.type}, ${pub.status}) score=${m.score} match.status=${m.status}`)
  const reason = typeof m.explanation === 'string' ? m.explanation : (m.explanation?.reason ?? JSON.stringify(m.explanation ?? null))
  console.log(`    reason: ${String(reason).slice(0, 220)}`)
}
console.log()

// ───────────────────────────────────────────────────────────────────────────
// (b) DETAIL — flip notif + match (simulation route GET /api/me/missions/[id])
// ───────────────────────────────────────────────────────────────────────────
console.log('=== (b) DETAIL — open & atomic flip ===')
// État AVANT
const beforeMatch = await supabaseAdmin
  .from('matches')
  .select('status')
  .eq('publication_id', PUBLI_D365)
  .eq('profile_id', EXPERT_PROFILE_ID)
  .maybeSingle()
const beforeNotif = await supabaseAdmin
  .from('notifications')
  .select('status, read_at')
  .eq('entity_id', PUBLI_D365)
  .eq('type', 'new_match_opportunity')
  .maybeSingle()
console.log('  AVANT  match.status =', beforeMatch.data?.status, '| notif.status =', beforeNotif.data?.status, '| read_at =', beforeNotif.data?.read_at)

// Flip atomique : match notified→viewed (anti-race avec .in)
const { data: matchRow } = await supabaseAdmin
  .from('matches')
  .select('id, status')
  .eq('publication_id', PUBLI_D365)
  .eq('profile_id', EXPERT_PROFILE_ID)
  .maybeSingle()
if (matchRow && (matchRow.status === 'notified' || matchRow.status === 'pending')) {
  await supabaseAdmin
    .from('matches')
    .update({ status: 'viewed' })
    .eq('id', matchRow.id)
    .in('status', ['notified', 'pending'])
}
const nowIso = new Date().toISOString()
await supabaseAdmin
  .from('notifications')
  .update({ status: 'read', read_at: nowIso })
  .eq('entity_id', PUBLI_D365)
  .eq('type', 'new_match_opportunity')
  .is('read_at', null)

// État APRÈS
const afterMatch = await supabaseAdmin
  .from('matches')
  .select('status')
  .eq('publication_id', PUBLI_D365)
  .eq('profile_id', EXPERT_PROFILE_ID)
  .maybeSingle()
const afterNotif = await supabaseAdmin
  .from('notifications')
  .select('status, read_at')
  .eq('entity_id', PUBLI_D365)
  .eq('type', 'new_match_opportunity')
  .maybeSingle()
console.log('  APRÈS  match.status =', afterMatch.data?.status, '| notif.status =', afterNotif.data?.status, '| read_at =', afterNotif.data?.read_at)
console.log()

// ───────────────────────────────────────────────────────────────────────────
// (c) CANDIDATURE INSERT — succès puis ré-INSERT → 23505
// ───────────────────────────────────────────────────────────────────────────
console.log('=== (c) CANDIDATURE ===')
const { data: prof } = await supabaseAdmin
  .from('profiles')
  .select('domain_id, title, summary, skills, seniority, expert_type, years_experience, tjm_min, tjm_max, salary_min, salary_max, work_modes, languages, country, city, availability_status, profile_score, branch_id, speciality_id')
  .eq('id', EXPERT_PROFILE_ID)
  .maybeSingle()
const preview = {
  title: prof?.title, summary: prof?.summary, skills: prof?.skills ?? [],
  seniority: prof?.seniority, expert_type: prof?.expert_type,
  years_experience: prof?.years_experience, tjm_min: prof?.tjm_min, tjm_max: prof?.tjm_max,
  salary_min: prof?.salary_min, salary_max: prof?.salary_max,
  work_modes: prof?.work_modes ?? [], languages: prof?.languages ?? [],
  country: prof?.country, city: prof?.city,
  availability_status: prof?.availability_status, profile_score: prof?.profile_score,
  branch_id: prof?.branch_id, speciality_id: prof?.speciality_id,
}

const { data: matchForCand } = await supabaseAdmin
  .from('matches')
  .select('id, score')
  .eq('publication_id', PUBLI_D365)
  .eq('profile_id', EXPERT_PROFILE_ID)
  .maybeSingle()

const insert1 = await supabaseAdmin
  .from('candidatures')
  .insert({
    publication_id: PUBLI_D365,
    profile_id: EXPERT_PROFILE_ID,
    match_id: matchForCand?.id,
    domain_id: prof?.domain_id,
    cover_message: 'Test Lot 2b — fortement intéressé par cette mission D365.',
    ai_match_score: matchForCand?.score,
    status: 'received',
    preview,
  })
  .select('id, status, ai_match_score, match_id')
  .single()
if (insert1.error) console.log('  insert1 ERR:', insert1.error.code, insert1.error.message)
else console.log('  insert1 OK :', insert1.data)

const insert2 = await supabaseAdmin
  .from('candidatures')
  .insert({
    publication_id: PUBLI_D365,
    profile_id: EXPERT_PROFILE_ID,
    match_id: matchForCand?.id,
    domain_id: prof?.domain_id,
    status: 'received',
    preview,
  })
  .select('id')
  .single()
console.log('  insert2 (ré-INSERT) :', insert2.error ? `BLOCKED — code=${insert2.error.code} (expected 23505)` : 'UNEXPECTEDLY OK', insert2.error?.message ?? '')
console.log()

// ───────────────────────────────────────────────────────────────────────────
// (d) DISMISS
// ───────────────────────────────────────────────────────────────────────────
console.log('=== (d) DISMISS ===')
// Reset à viewed pour montrer le flip
await supabaseAdmin
  .from('matches')
  .update({ status: 'viewed' })
  .eq('publication_id', PUBLI_D365)
  .eq('profile_id', EXPERT_PROFILE_ID)

await supabaseAdmin
  .from('matches')
  .update({ status: 'dismissed' })
  .eq('publication_id', PUBLI_D365)
  .eq('profile_id', EXPERT_PROFILE_ID)

const { data: feedAfterDismiss } = await supabaseAdmin
  .from('matches')
  .select('id, status')
  .eq('profile_id', EXPERT_PROFILE_ID)
  .neq('status', 'dismissed')
console.log('  feed après dismiss :', feedAfterDismiss?.length, 'match(es) non-dismissed')

// Restaurer notified pour pouvoir retester
await supabaseAdmin
  .from('matches')
  .update({ status: 'notified' })
  .eq('publication_id', PUBLI_D365)
  .eq('profile_id', EXPERT_PROFILE_ID)
console.log()

// ───────────────────────────────────────────────────────────────────────────
// (e) RLS HARDENING PROOF
// ───────────────────────────────────────────────────────────────────────────
console.log('=== (e) DURCISSEMENT RLS ===')

// e.1 Récupérer une autre publication 'published' (non-matchée par cet expert)
const { data: otherPubs } = await supabaseAdmin
  .from('publications')
  .select('id, title, status')
  .eq('status', 'published')
  .neq('id', PUBLI_D365)
  .limit(5)
console.log('  publications published total (admin) :', otherPubs?.length ?? 0, '+ D365')

// e.2 Sign-in en tant que l'expert (anon key) pour tester RLS
//     On utilise admin.generateLink magic-link OU directement set la session
//     en signant un JWT... le plus simple est de récupérer l'user_id et de
//     créer une session via admin.signInWithPassword si on a le pwd.
//     Faute de pwd, on utilise admin.createSession (Supabase JS v2 ≥ 2.x)
//     OU on s'appuie sur l'admin.generateLink + recovery flow.
//     Plus pragmatique : créer un JWT custom signé avec le SECRET sub=user_id
//     n'est pas trivial. On bascule donc en mode "verify via PostgREST".

// Récupérer l'user_id
const { data: userByEmail } = await supabaseAdmin.auth.admin.listUsers()
const expertUser = userByEmail?.users?.find((u) => u.email === EXPERT_USER_EMAIL)
console.log('  expert user_id =', expertUser?.id)
if (!expertUser) {
  console.log('  ⚠️  expert user introuvable, skip preuve RLS via anon')
} else {
  // Générer un lien magique pour récupérer un access_token utilisable
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: EXPERT_USER_EMAIL,
  })
  if (linkErr) {
    console.log('  generateLink ERR:', linkErr.message)
  } else if (linkData?.properties?.hashed_token) {
    // Échanger le hashed_token contre une session via verifyOtp
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: vData, error: vErr } = await anonClient.auth.verifyOtp({
      type: 'magiclink',
      token_hash: linkData.properties.hashed_token,
    })
    if (vErr) {
      console.log('  verifyOtp ERR:', vErr.message)
    } else {
      console.log('  ✓ session obtenue pour user_id =', vData.user?.id)

      // ━━ Test 1 : SELECT publications WHERE id = D365 (matchée)
      const tryMatched = await anonClient
        .from('publications')
        .select('id, title')
        .eq('id', PUBLI_D365)
      console.log('  → SELECT publi MATCHÉE (D365) :', tryMatched.data?.length ?? 0, 'row(s)',
        tryMatched.error ? `[ERR ${tryMatched.error.code}: ${tryMatched.error.message}]` : '')

      // ━━ Test 2 : SELECT publications WHERE id = autre (non-matchée)
      if (otherPubs && otherPubs.length > 0) {
        const tryUnmatched = await anonClient
          .from('publications')
          .select('id, title')
          .eq('id', otherPubs[0].id)
        console.log('  → SELECT publi NON-matchée :', tryUnmatched.data?.length ?? 0, 'row(s)',
          tryUnmatched.error ? `[ERR ${tryUnmatched.error.code}: ${tryUnmatched.error.message}]` : '')
      }

      // ━━ Test 3 : SELECT publications WHERE status='published' (parcours libre)
      const tryListAll = await anonClient
        .from('publications')
        .select('id')
        .eq('status', 'published')
      console.log('  → SELECT toutes publi published :', tryListAll.data?.length ?? 0, 'row(s) (attendu: 1 — uniquement la matchée)')

      // ━━ Test 4 : INSERT candidatures sans match (sur une publi non-matchée)
      if (otherPubs && otherPubs.length > 0) {
        const tryInsertNoMatch = await anonClient
          .from('candidatures')
          .insert({
            publication_id: otherPubs[0].id,
            profile_id: EXPERT_PROFILE_ID,
            domain_id: prof?.domain_id,
            status: 'received',
          })
          .select('id')
          .single()
        console.log('  → INSERT candidature sans match :',
          tryInsertNoMatch.error ? `BLOCKED [${tryInsertNoMatch.error.code}: ${tryInsertNoMatch.error.message}]` : `UNEXPECTEDLY OK id=${tryInsertNoMatch.data?.id}`)
      }
    }
  }
}

console.log()
console.log('=== DONE ===')
