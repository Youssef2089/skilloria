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

const PROFILE_ID = 'ce6b8369-1993-4236-9a1f-a2566280aa3c'
const USER_ID = '0e28543e-d91d-4b0a-8e0c-64fa33eec3a3'

const { runExpertVerification } = await import('../lib/verification/expert-verification.ts')

console.log('Lancement runExpertVerification (vraie IA Claude) sur profil', PROFILE_ID, '…')
const t0 = Date.now()
const verdict = await runExpertVerification({ supabaseAdmin, profile_id: PROFILE_ID })
console.log('durée :', Date.now() - t0, 'ms')
console.log('verdict :', JSON.stringify(verdict, null, 2))
console.log()

const { data: prof } = await supabaseAdmin.from('profiles').select('verification_status, verification_score, verified_at, verification_data').eq('id', PROFILE_ID).maybeSingle()
const { data: user } = await supabaseAdmin.from('users').select('is_verified').eq('id', USER_ID).maybeSingle()
console.log('═══════════════════ ÉTAT FINAL BDD ═══════════════════')
console.log('  profile.verification_status :', prof?.verification_status)
console.log('  profile.verification_score  :', prof?.verification_score)
console.log('  profile.verified_at         :', prof?.verified_at)
console.log('  profile.flags               :', JSON.stringify(prof?.verification_data?.flags ?? []))
console.log('  profile.notes               :', String(prof?.verification_data?.notes ?? '').slice(0, 200))
console.log('  users.is_verified           :', user?.is_verified)
