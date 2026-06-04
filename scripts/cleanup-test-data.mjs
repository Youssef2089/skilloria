// cleanup-test-data.mjs — Suppression IRRÉVERSIBLE des données de test du sprint.
//
// ⚠️ Scope EXPLICITE par IDs (cf. audit Lot nettoyage) :
//   - 3 publications de test (Consultant D365)
//     → CASCADE : matches, candidatures, conversations, messages (via FK ON DELETE CASCADE)
//   - 1 user fictif (test@skilloria-test-fictif.io)
//   - Notifications rattachées (entity_id pointant sur publi/conv/cand supprimés OU
//     toutes notifs des types injectés en BDD pendant tests)
//
// GARDE : 3 organizations, 3 users réels, profile expert ce6b8369 (verified).
//
// Affiche COUNT avant/après par table.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}

const { createClient } = await import('@supabase/supabase-js')
const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ── IDs cibles ────────────────────────────────────────────────────────────
const TARGET_PUB_IDS = [
  '8d8d58e7',
  'be1921ea-ae54-43e4-96a4-74b3697231d0',
  'a2d58f04',
]
const TARGET_USER_FICTIF = '0b4fbb9e-3f5b-4577-9c7a-cd3f3eea99cb'

// Confirmation runtime : ne supprime QUE si les IDs courts matchent un seul row chacun
async function resolveExactPubIds(prefixes) {
  const out = []
  // Fetch toutes les publi une fois, match par prefix JS (uuid n'accepte pas LIKE natif)
  const { data: allPubs } = await supabaseAdmin.from('publications').select('id, title, status')
  const pubs = allPubs ?? []
  for (const p of prefixes) {
    if (p.length === 36) { out.push(p); continue }
    const matches = pubs.filter(row => row.id.startsWith(p))
    if (matches.length !== 1) {
      throw new Error(`prefix ${p} matched ${matches.length} rows — refuse to proceed`)
    }
    out.push(matches[0].id)
  }
  return out
}

console.log('▶ Résolution des IDs…')
const exactPubIds = await resolveExactPubIds(TARGET_PUB_IDS)
console.log('  publications cibles :', exactPubIds)
console.log('  user fictif cible   :', TARGET_USER_FICTIF)
console.log()

// ── COUNT avant ───────────────────────────────────────────────────────────
async function countAll() {
  const tables = ['publications', 'matches', 'candidatures', 'conversations', 'messages', 'notifications', 'users']
  const out = {}
  for (const t of tables) {
    const { count } = await supabaseAdmin.from(t).select('*', { count: 'exact', head: true })
    out[t] = count
  }
  return out
}

const before = await countAll()
console.log('═══ COUNT avant DELETE ═══')
for (const [t, c] of Object.entries(before)) console.log(`  ${t}: ${c}`)
console.log()

// ── Confirmation user fictif (vérifie l'email AVANT delete) ───────────────
const { data: fictifProbe } = await supabaseAdmin.from('users').select('id, email').eq('id', TARGET_USER_FICTIF).maybeSingle()
if (!fictifProbe) {
  console.log(`⚠ user fictif ${TARGET_USER_FICTIF} introuvable — skip suppression user.`)
} else if (!fictifProbe.email.includes('skilloria-test-fictif')) {
  throw new Error(`User fictif id matches but email='${fictifProbe.email}' — REFUSE to delete (safety)`)
} else {
  console.log(`✓ User fictif vérifié : ${fictifProbe.email}`)
}
console.log()

// ── DELETE séquentiel (CASCADE depuis publications fait le travail dérivé) ─
console.log('═══ DELETE en cours ═══')

// 1. Notifications : on cible par entity_id rattaché aux entités à supprimer,
//    + type qui ne survivrait pas (verification_result mentionne le profile.id
//    qui survit, donc pas à supprimer ; new_message/candidature_unlocked/
//    new_match_opportunity ont entity_id = conv/cand/publi → CASCADE manuelle).
const { data: candIds } = await supabaseAdmin.from('candidatures').select('id').in('publication_id', exactPubIds)
const { data: convIds } = await supabaseAdmin.from('conversations').select('id').in('candidature_id', (candIds ?? []).map(c => c.id))
const candIdSet = new Set((candIds ?? []).map(c => c.id))
const convIdSet = new Set((convIds ?? []).map(c => c.id))
const notifEntityTargets = [...exactPubIds, ...candIdSet, ...convIdSet]
console.log(`  notif targets entity_id : ${notifEntityTargets.length} ids`)

let totalNotifDeleted = 0
if (notifEntityTargets.length > 0) {
  const { count, error } = await supabaseAdmin.from('notifications').delete({ count: 'exact' }).in('entity_id', notifEntityTargets)
  if (error) console.log('  notif delete err:', error.message)
  else { totalNotifDeleted += count ?? 0; console.log(`  - notifications par entity_id     : ${count}`) }
}
// Notifications du user fictif (s'il y a)
{
  const { count, error } = await supabaseAdmin.from('notifications').delete({ count: 'exact' }).eq('user_id', TARGET_USER_FICTIF)
  if (error) console.log('  notif fictif err:', error.message)
  else { totalNotifDeleted += count ?? 0; console.log(`  - notifications du user fictif    : ${count}`) }
}
// Notifications restantes liées aux types test (verification_result) sur les autres users
{
  const { count, error } = await supabaseAdmin.from('notifications').delete({ count: 'exact' })
    .in('type', ['new_message', 'new_match_opportunity', 'candidature_unlocked', 'verification_result'])
  if (error) console.log('  notif type err:', error.message)
  else { totalNotifDeleted += count ?? 0; console.log(`  - notifications restantes (types) : ${count}`) }
}
console.log(`  ⇒ notifications supprimées total  : ${totalNotifDeleted}`)

// 2. Publications → CASCADE supprime matches, candidatures, conversations, messages
{
  const { count, error } = await supabaseAdmin.from('publications').delete({ count: 'exact' }).in('id', exactPubIds)
  if (error) { console.log('  publi delete err:', error.message); process.exit(1) }
  console.log(`  - publications (+CASCADE)         : ${count}`)
}

// 3. User fictif (CASCADE supprime profile fictif éventuel, organization_members, etc.)
if (fictifProbe) {
  const { count, error } = await supabaseAdmin.from('users').delete({ count: 'exact' }).eq('id', TARGET_USER_FICTIF)
  if (error) console.log('  user fictif delete err:', error.message)
  else console.log(`  - user fictif                     : ${count}`)
}

console.log()

// ── COUNT après ───────────────────────────────────────────────────────────
const after = await countAll()
console.log('═══ COUNT après DELETE ═══')
const tables = Object.keys(before)
for (const t of tables) {
  const diff = before[t] - after[t]
  console.log(`  ${t}: ${before[t]} → ${after[t]}   ${diff > 0 ? `(-${diff})` : ''}`)
}
console.log()

// ── Vérif intégrité : aucun orphelin (matches sans publi, candidatures sans publi…)
console.log('═══ Intégrité (orphelins) ═══')
async function orphans(table, fkCol, parentTable, parentCol = 'id') {
  const { data: child } = await supabaseAdmin.from(table).select(fkCol)
  const childIds = new Set((child ?? []).map(r => r[fkCol]).filter(Boolean))
  if (childIds.size === 0) { console.log(`  ${table}.${fkCol} → ${parentTable} : 0 rows à vérifier`); return }
  const { data: parents } = await supabaseAdmin.from(parentTable).select(parentCol).in(parentCol, Array.from(childIds))
  const parentSet = new Set((parents ?? []).map(r => r[parentCol]))
  const orphan = Array.from(childIds).filter(id => !parentSet.has(id))
  console.log(`  ${table}.${fkCol} → ${parentTable} : ${orphan.length} orphelin(s)`, orphan.length > 0 ? orphan.slice(0, 3) : '')
}
await orphans('matches', 'publication_id', 'publications')
await orphans('candidatures', 'publication_id', 'publications')
await orphans('conversations', 'candidature_id', 'candidatures')
await orphans('messages', 'conversation_id', 'conversations')

console.log()
console.log('✓ Nettoyage terminé.')
