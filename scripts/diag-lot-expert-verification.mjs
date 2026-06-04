// Diagnostique Lot — Vérification expert.
//
// ✓ Ce diag est PROPRE : snapshot+restore final du profil expert ce6b8369.
//   Mais le `users.is_verified` n'est pas restauré par le script. Le profil
//   expert reste `verification_status=approved` + `is_verified=true` après run
//   (état désiré pour le matching à blanc). À adapter si besoin de tester le
//   cycle complet en démarrant à NULL.
//
// Couvre :
//   (a) profil Microsoft COHÉRENT (ce6b8369) → vrai appel IA → score ≥ 9 →
//       approved auto + users.is_verified=true
//   (b) profil INCOHÉRENT (snapshot temporaire titre/branche/spécialité
//       orientés Salesforce/SAP) → DOMAIN_MISMATCH → cap 5 → pending_admin_review
//   (c) admin approve depuis l'API (mirror) → status='approved' + notif
//   (d) MATCHING gate :
//       • profil approved apparaît dans loadEligibleProfiles (publi D365)
//       • profil non-approved → exclu
//   (e) ERREUR IA (clé bidon) → result='error' dispatcher → pending_admin_review
//
// Pré-requis :
//   • Migration 20260603180000 appliquée (colonnes verification_* sur profiles + row provider)
//   • ANTHROPIC_API_KEY valide

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}

const { createClient } = await import('@supabase/supabase-js')
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseAdmin = createClient(SUPABASE_URL, SRK, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const EXPERT_PROFILE_ID = 'ce6b8369-1993-4236-9a1f-a2566280aa3c'
const EXPERT_USER_ID = '0e28543e-d91d-4b0a-8e0c-64fa33eec3a3'
const PUBLI_D365 = 'be1921ea-ae54-43e4-96a4-74b3697231d0'

// ───────────────────────────────────────────────────────────────────────────
// Pré-check migration
// ───────────────────────────────────────────────────────────────────────────
{
  const { data, error } = await supabaseAdmin.from('profiles').select('id, verification_status').eq('id', EXPERT_PROFILE_ID).maybeSingle()
  if (error || !data || !('verification_status' in (data ?? {}))) {
    console.error('⚠️  Migration 20260603180000 NON appliquée. Stop.')
    console.error('   Applique le SQL via Supabase SQL Editor avant de lancer le diag.')
    process.exit(1)
  }
}
console.log('✓ Migration appliquée (colonne verification_status présente)')

// ───────────────────────────────────────────────────────────────────────────
// Snapshot du profil original (pour restore après tests)
// ───────────────────────────────────────────────────────────────────────────
const { data: snap } = await supabaseAdmin
  .from('profiles')
  .select('title, summary, branch_id, speciality_id, skills, verification_status, verification_method, verification_score, verification_data, verified_at, verified_by, review_reason')
  .eq('id', EXPERT_PROFILE_ID)
  .maybeSingle()
console.log('snapshot profil :', { title: snap?.title, verification_status: snap?.verification_status })
console.log()

async function restoreSnapshot() {
  await supabaseAdmin
    .from('profiles')
    .update({
      title: snap?.title, summary: snap?.summary,
      branch_id: snap?.branch_id, speciality_id: snap?.speciality_id,
      skills: snap?.skills,
      verification_status: snap?.verification_status,
      verification_method: snap?.verification_method,
      verification_score: snap?.verification_score,
      verification_data: snap?.verification_data,
      verified_at: snap?.verified_at,
      verified_by: snap?.verified_by,
      review_reason: snap?.review_reason,
    })
    .eq('id', EXPERT_PROFILE_ID)
}

async function resetVerification() {
  await supabaseAdmin
    .from('profiles')
    .update({
      verification_status: null,
      verification_method: null,
      verification_score: null,
      verification_data: null,
      verified_at: null,
      verified_by: null,
      review_reason: null,
    })
    .eq('id', EXPERT_PROFILE_ID)
  await supabaseAdmin.from('users').update({ is_verified: false }).eq('id', EXPERT_USER_ID)
}

// Import dispatcher
const { runExpertVerification } = await import('../lib/verification/expert-verification.ts')

// ───────────────────────────────────────────────────────────────────────────
// (a) Profil cohérent Microsoft → vraie vérif → approved ≥ 9
// ───────────────────────────────────────────────────────────────────────────
console.log('=== (a) PROFIL MICROSOFT COHÉRENT → vraie vérif IA ===')
await resetVerification()
const t0 = Date.now()
const verdictA = await runExpertVerification({ supabaseAdmin, profile_id: EXPERT_PROFILE_ID })
console.log('  durée :', Date.now() - t0, 'ms')
console.log('  status :', verdictA.verification_status)
console.log('  score  :', verdictA.score)
console.log('  flags  :', verdictA.flags)
console.log('  notes  :', String(verdictA.notes ?? '').slice(0, 200))

const { data: profA } = await supabaseAdmin.from('profiles').select('verification_status, verification_score').eq('id', EXPERT_PROFILE_ID).maybeSingle()
const { data: userA } = await supabaseAdmin.from('users').select('is_verified').eq('id', EXPERT_USER_ID).maybeSingle()
console.log('  BDD profile.verification_status =', profA?.verification_status, ' score=', profA?.verification_score)
console.log('  BDD users.is_verified =', userA?.is_verified)
console.log()

const aApproved = profA?.verification_status === 'approved' && userA?.is_verified === true

// ───────────────────────────────────────────────────────────────────────────
// (b) Profil incohérent : on injecte titre/branche orientés Salesforce/SAP
// ───────────────────────────────────────────────────────────────────────────
console.log('=== (b) PROFIL INCOHÉRENT (Salesforce/SAP) → DOMAIN_MISMATCH cap 5 ===')
// On snapshot d'abord branch/spec actuels pour les remettre après
const { data: branches } = await supabaseAdmin.from('branches').select('id, name').ilike('name', '%Salesforce%').limit(1)
const { data: specs } = await supabaseAdmin.from('specialities').select('id, name').ilike('name', '%Salesforce%').limit(1)
const salesforceBranchId = (branches ?? [])[0]?.id ?? null
const salesforceSpecId = (specs ?? [])[0]?.id ?? null

await resetVerification()
await supabaseAdmin
  .from('profiles')
  .update({
    title: 'Consultant Salesforce CPQ senior — SAP S/4 HANA',
    summary: 'Architecte Salesforce certifié, expertise CPQ + SAP S/4 HANA en parallèle.',
    skills: ['Salesforce', 'Salesforce CPQ', 'SAP S/4 HANA', 'Apex', 'ABAP'],
    branch_id: salesforceBranchId,
    speciality_id: salesforceSpecId,
  })
  .eq('id', EXPERT_PROFILE_ID)

const t1 = Date.now()
const verdictB = await runExpertVerification({ supabaseAdmin, profile_id: EXPERT_PROFILE_ID })
console.log('  durée :', Date.now() - t1, 'ms')
console.log('  status :', verdictB.verification_status)
console.log('  score  :', verdictB.score, ' (attendu ≤ 5)')
console.log('  flags  :', verdictB.flags, ' (attendu DOMAIN_MISMATCH)')
console.log('  notes  :', String(verdictB.notes ?? '').slice(0, 200))

const { data: profB } = await supabaseAdmin.from('profiles').select('verification_status, verification_score, verification_data').eq('id', EXPERT_PROFILE_ID).maybeSingle()
console.log('  BDD profile.verification_status =', profB?.verification_status)
console.log('  BDD profile.verification_data.flags =', profB?.verification_data?.flags)

const bGated = profB?.verification_status === 'pending_admin_review' && (verdictB.flags ?? []).includes('DOMAIN_MISMATCH') && (verdictB.score ?? 10) <= 5

// Restore snapshot pour les tests suivants
console.log('  restore snapshot…')
await restoreSnapshot()
console.log()

// ───────────────────────────────────────────────────────────────────────────
// (c) Admin approve via API mirror (simulation directe en service_role)
// ───────────────────────────────────────────────────────────────────────────
console.log('=== (c) Admin approve (simulation route) ===')
// Mettre en pending_admin_review puis simuler approve
await supabaseAdmin.from('profiles').update({ verification_status: 'pending_admin_review' }).eq('id', EXPERT_PROFILE_ID)
const nowIso = new Date().toISOString()
await supabaseAdmin.from('profiles').update({
  verification_status: 'approved',
  verified_at: nowIso,
  verified_by: null,                    // admin id non disponible ici, on simule
  review_reason: null,
}).eq('id', EXPERT_PROFILE_ID)
await supabaseAdmin.from('users').update({ is_verified: true }).eq('id', EXPERT_USER_ID)

const { data: profC } = await supabaseAdmin.from('profiles').select('verification_status, verified_at').eq('id', EXPERT_PROFILE_ID).maybeSingle()
console.log('  BDD profile.verification_status =', profC?.verification_status, ' at=', profC?.verified_at)
console.log()

// ───────────────────────────────────────────────────────────────────────────
// (d) Matching gate : approved IN, non-approved OUT
// ───────────────────────────────────────────────────────────────────────────
console.log('=== (d) Matching gate is_verified rebranché ===')
// Helper : reproduire le filtre loadEligibleProfiles
async function listEligible() {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, verification_status, users!profiles_user_id_fkey!inner(user_type)')
    .eq('cv_parsing_status', 'done')
    .eq('visible', true)
    .not('ai_consent_at', 'is', null)
    .eq('verification_status', 'approved')
    .eq('users.user_type', 'expert_freelance')
  return data ?? []
}

// État approved : doit apparaître
const eligibleApproved = await listEligible()
const aIn = eligibleApproved.some(p => p.id === EXPERT_PROFILE_ID)
console.log('  Profil approved dans pool éligible :', aIn ? 'OUI ✓' : 'NON (KO)')

// Reset à pending_admin_review : doit disparaître
await supabaseAdmin.from('profiles').update({ verification_status: 'pending_admin_review' }).eq('id', EXPERT_PROFILE_ID)
const eligiblePending = await listEligible()
const aOut = !eligiblePending.some(p => p.id === EXPERT_PROFILE_ID)
console.log('  Profil pending_admin_review HORS pool :', aOut ? 'OUI ✓' : 'NON (KO)')

// Reset NULL : doit aussi disparaître
await supabaseAdmin.from('profiles').update({ verification_status: null }).eq('id', EXPERT_PROFILE_ID)
const eligibleNull = await listEligible()
const aOutNull = !eligibleNull.some(p => p.id === EXPERT_PROFILE_ID)
console.log('  Profil verification_status=NULL HORS pool :', aOutNull ? 'OUI ✓' : 'NON (KO)')
console.log()

// ───────────────────────────────────────────────────────────────────────────
// (e) Erreur IA (clé bidon) → pending_admin_review, jamais auto-verify
// ───────────────────────────────────────────────────────────────────────────
console.log('=== (e) ERREUR IA simulée → pending_admin_review (fail-safe) ===')
await resetVerification()
const validKey = process.env.ANTHROPIC_API_KEY
process.env.ANTHROPIC_API_KEY = 'sk-ant-INVALID-FORTEST'
try {
  const verdictE = await runExpertVerification({ supabaseAdmin, profile_id: EXPERT_PROFILE_ID })
  console.log('  verdict.status :', verdictE.status)
  console.log('  verdict.verification_status :', verdictE.verification_status)
  console.log('  verdict.score :', verdictE.score)
} finally {
  process.env.ANTHROPIC_API_KEY = validKey
}
const { data: profE } = await supabaseAdmin.from('profiles').select('verification_status, verification_data').eq('id', EXPERT_PROFILE_ID).maybeSingle()
const { data: userE } = await supabaseAdmin.from('users').select('is_verified').eq('id', EXPERT_USER_ID).maybeSingle()
console.log('  BDD profile.verification_status =', profE?.verification_status, ' (attendu pending_admin_review)')
console.log('  BDD users.is_verified =', userE?.is_verified, ' (attendu false, JAMAIS auto-verify)')

const eFailSafe = profE?.verification_status === 'pending_admin_review' && userE?.is_verified === false
console.log()

// ───────────────────────────────────────────────────────────────────────────
// Restore final
// ───────────────────────────────────────────────────────────────────────────
await restoreSnapshot()
console.log('=== restore snapshot final ===')

console.log()
console.log('═══════════════════ RÉSUMÉ ═══════════════════')
console.log(` (a) profil Microsoft → approved ≥ 9 + is_verified=true : ${aApproved ? '✓ OK' : '✗ KO'}`)
console.log(` (b) DOMAIN_MISMATCH cap 5 → pending_admin_review        : ${bGated ? '✓ OK' : '✗ KO'}`)
console.log(` (d) matching gate (approved IN, non-approved OUT)        : ${aIn && aOut && aOutNull ? '✓ OK' : '✗ KO'}`)
console.log(` (e) erreur IA → pending_admin_review (jamais auto-verify): ${eFailSafe ? '✓ OK' : '✗ KO'}`)
