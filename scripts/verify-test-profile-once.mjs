import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}

// ⚠️ CE SCRIPT ECRIT EN BASE — SANS AUCUN `.update(` VISIBLE DANS CE FICHIER.
//    C'est tout l'interet de le dire ici : il ecrit en APPELANT du code
//    applicatif. Depuis le 30/09/2026 (§D.30), il DEPOSE un travail de verification
//    (`deposer_verification_expert`) : l'executant `/api/cron/travaux-ia` appelle
//    l'IA Claude et ecrit le verdict (`conclure_verification_expert`) — le statut du
//    profil, `users.is_verified`, une ligne au grand livre. Un lecteur qui cherche un
//    verbe d'ecriture dans ce fichier n'en trouve pas et le croit inoffensif.
//
//    L'IA Claude est appelee pour de vrai par l'executant : chaque execution coute.
const { exigerAutorisationEcriture } = await import('./garde-ecriture.mjs')
exigerAutorisationEcriture({
  script: 'verify-test-profile-once.mjs',
  ecrit: [
    'lance une VERIFICATION IA REELLE (Claude) sur un profil code en dur — depense a chaque run',
    "reecrit profiles.verification_status / verification_score / verified_at / verification_data",
    'reecrit users.is_verified',
  ],
  perte: "l'ancien verdict de verification est ecrase et n'est pas conserve.",
})

const { createClient } = await import('@supabase/supabase-js')
const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const PROFILE_ID = 'ce6b8369-1993-4236-9a1f-a2566280aa3c'
const USER_ID = '0e28543e-d91d-4b0a-8e0c-64fa33eec3a3'

// Le travail est DÉPOSÉ, comme une publication le fait : l'exécutant le prend dans la minute.
console.log('Dépôt d un travail de vérification (vraie IA Claude, par l exécutant) sur profil', PROFILE_ID, '…')
const { data: travail, error: depotErr } = await supabaseAdmin.rpc('deposer_verification_expert', {
  p_profile_id: PROFILE_ID,
  p_piece: crypto.randomUUID(),
  p_acteur_id: null,
  p_acteur_type: null,
})
if (depotErr) {
  console.error('dépôt refusé :', depotErr.message)
  process.exit(1)
}
console.log('travail déposé :', travail, '— relancez ce script dans quelques minutes pour lire le verdict.')
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
