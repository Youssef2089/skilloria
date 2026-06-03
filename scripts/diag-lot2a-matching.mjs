// Test isolé runMatching — Lot 2a.
// Charge .env.local, instancie un client service_role, lance runMatching sur
// une publi existante, montre matches + notifications.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}

const { createClient } = await import('@supabase/supabase-js')
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

const PUBLICATION_ID = 'be1921ea-ae54-43e4-96a4-74b3697231d0'

console.log('=== ÉTAT AVANT ===')
const before = await supabaseAdmin
  .from('matches')
  .select('id, score, status, profile_id')
  .eq('publication_id', PUBLICATION_ID)
console.log('matches existants :', before.data?.length ?? 0)

const beforeNotifs = await supabaseAdmin
  .from('notifications')
  .select('id, user_id, status')
  .eq('entity_id', PUBLICATION_ID)
  .eq('type', 'new_match_opportunity')
console.log('notifications existantes :', beforeNotifs.data?.length ?? 0)
console.log()

console.log('=== RUN MATCHING ===')
const { runMatching } = await import('../lib/matching/index.ts')
const t0 = Date.now()
const verdict = await runMatching({
  supabaseAdmin,
  publicationId: PUBLICATION_ID,
  locale: 'fr',
})
console.log('Durée :', Date.now() - t0, 'ms')
console.log('Status :', verdict.status)
console.log('Notes  :', verdict.notes)
console.log('Model  :', verdict.model)
console.log('Proposals :', verdict.proposals.length)
for (const p of verdict.proposals.slice(0, 5)) {
  console.log(`  - ${p.profile_id} | score=${p.score}`)
  console.log(`    reason: ${p.reason}`)
}
console.log()

console.log('=== ÉTAT APRÈS — matches ===')
const after = await supabaseAdmin
  .from('matches')
  .select('id, score, status, profile_id, explanation, created_at, updated_at')
  .eq('publication_id', PUBLICATION_ID)
  .order('score', { ascending: false })
console.log('Total matches :', after.data?.length ?? 0)
for (const m of (after.data ?? []).slice(0, 5)) {
  console.log(`  - profile_id=${m.profile_id} | score=${m.score} | status=${m.status}`)
  console.log(`    reason: ${m.explanation?.reason ?? '(none)'}`)
  console.log(`    model:  ${m.explanation?.model ?? '(none)'}`)
}
console.log()

console.log('=== ÉTAT APRÈS — notifications ===')
const afterNotifs = await supabaseAdmin
  .from('notifications')
  .select('id, user_id, type, channel, title, body, link_url, status, entity_id, created_at')
  .eq('entity_id', PUBLICATION_ID)
  .eq('type', 'new_match_opportunity')
console.log('Total notifs :', afterNotifs.data?.length ?? 0)
for (const n of (afterNotifs.data ?? [])) {
  console.log(`  - user_id=${n.user_id} | channel=${n.channel} | status=${n.status}`)
  console.log(`    title: ${n.title}`)
  console.log(`    body:  ${n.body}`)
  console.log(`    link:  ${n.link_url}`)
}
