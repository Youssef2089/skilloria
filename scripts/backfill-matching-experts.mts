// Backfill matching — déclenche runMatchingForExpert pour chaque expert
// éligible qui n'a actuellement AUCUN match en BDD. Idempotent : un re-run sur
// un expert déjà réconcilié ne re-notifie pas (les notifications sont émises
// uniquement sur inserts FRAIS de matches — cf. reconcile.ts).
//
// Garde : --only-email=<email> pour cibler un expert précis (utile en V1
// pour valider de bout en bout avant un fanout).
//
// Usage :
//   node scripts/backfill-matching-experts.mjs                       (tous)
//   node scripts/backfill-matching-experts.mjs --only-email=foo@x    (un seul)
//   node scripts/backfill-matching-experts.mjs --dry-run             (lecture)

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}

const args = process.argv.slice(2)
const onlyEmail = args.find((a) => a.startsWith('--only-email='))?.split('=')[1]?.toLowerCase()
const dryRun = args.includes('--dry-run')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SRK) {
  console.error('Missing env NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const { createClient } = await import('@supabase/supabase-js')
const supabaseAdmin = createClient(SUPABASE_URL, SRK, {
  auth: { persistSession: false, autoRefreshToken: false },
})

console.log('=== BACKFILL MATCHING EXPERTS ===')
console.log('only-email :', onlyEmail ?? '(tous éligibles à 0 match)')
console.log('dry-run    :', dryRun)
console.log('')

// 1. Charger les experts éligibles
let q = supabaseAdmin
  .from('profiles')
  .select('id, user_id, domain_id, verification_status, visible, ai_consent_at, cv_parsing_status, availability_status, cdi_status, users!profiles_user_id_fkey!inner(email, user_type, locale)')
  .eq('verification_status', 'approved')
  .eq('visible', true)
  .not('ai_consent_at', 'is', null)
  .eq('cv_parsing_status', 'done')

const { data: profiles, error: profErr } = await q
if (profErr) {
  console.error('profiles load error :', profErr.message)
  process.exit(1)
}
console.log('Experts éligibles totaux :', profiles?.length ?? 0)
for (const p of profiles ?? []) {
  const u = Array.isArray(p.users) ? p.users[0] : p.users
  console.log(' raw:', p.id.slice(0,8), '|', u?.email, '|', u?.user_type, '| dnd_freelance=', p.availability_status, '| dnd_cdi=', p.cdi_status)
}

// 2. Filtrer ceux qui ont 0 match (ou ciblé par email)
const candidates = []
for (const p of profiles ?? []) {
  const users = Array.isArray(p.users) ? p.users[0] : p.users
  const email = users?.email?.toLowerCase() ?? null
  if (onlyEmail && email !== onlyEmail) continue
  // DND check
  if (users?.user_type === 'expert_freelance' && p.availability_status === 'do_not_disturb') continue
  if (users?.user_type === 'expert_cdi' && p.cdi_status === 'employed') continue
  const { count } = await supabaseAdmin
    .from('matches').select('id', { count: 'exact', head: true })
    .eq('profile_id', p.id)
  if (onlyEmail || (count ?? 0) === 0) {
    candidates.push({ id: p.id, email, user_type: users?.user_type ?? null, locale: users?.locale ?? 'fr', match_count: count ?? 0 })
  }
}

console.log('Candidats à backfill :', candidates.length)
for (const c of candidates) console.log(' -', c.email, '|', c.user_type, '| profile=', c.id, '| matches=', c.match_count)
console.log('')

if (dryRun) {
  console.log('(dry-run — pas d\'exécution)')
  process.exit(0)
}

if (candidates.length === 0) {
  console.log('Rien à faire.')
  process.exit(0)
}

// 3. Importer runMatchingForExpert et exécuter sérialement (rate-limit IA)
console.log('Exécution runMatchingForExpert sérialement (rate-limit IA)...')
const { runMatchingForExpert } = await import('../lib/matching/index')

let okCount = 0, errCount = 0, emptyCount = 0
for (const c of candidates) {
  process.stdout.write(`  ▶ ${c.email}... `)
  try {
    const verdict = await runMatchingForExpert({
      supabaseAdmin,
      profileId: c.id,
      locale: c.locale,
    })
    if (verdict.status === 'ok') {
      okCount++
      console.log(`OK ${verdict.proposals.length} matches | ${verdict.notes}`)
    } else if (verdict.status === 'empty_pool') {
      emptyCount++
      console.log(`empty | ${verdict.notes}`)
    } else {
      errCount++
      console.log(`${verdict.status} | ${verdict.notes}`)
    }
  } catch (err) {
    errCount++
    console.log('THREW', err instanceof Error ? err.message : String(err))
  }
  // petit pause anti-flood
  await new Promise((r) => setTimeout(r, 500))
}

console.log('')
console.log('=== DONE ===')
console.log('ok    :', okCount)
console.log('empty :', emptyCount)
console.log('err   :', errCount)
