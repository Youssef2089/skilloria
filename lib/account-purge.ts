import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'

/**
 * ANONYMISATION RGPD d'un compte — logique PARTAGÉE.
 *
 * Extraite telle quelle de app/api/cron/purge-deletions/route.ts (fonction
 * `purgeOne`, mission S3 §7) SANS changer son comportement, pour être réutilisée
 * par la purge des comptes INACTIFS (règle CNIL : 2 ans max après le dernier
 * contact) sans dupliquer la mécanique d'anonymisation.
 *
 * Pour chaque compte échu (idempotent, échec partiel toléré, JAMAIS de
 * fire-and-forget — tout est awaité) :
 *   1. BLOCAGE LOGIN + LIBÉRATION email : admin.updateUserById → email
 *      placeholder unique (libère l'email d'origine) + ban permanent + mot de
 *      passe aléatoire. (JAMAIS auth.admin.deleteUser : messages.sender_id est
 *      ON DELETE CASCADE → l'historique d'interactions DOIT être préservé.)
 *   2. SUPPRESSION fichiers perso : CV (bucket 'cv') + avatar (bucket 'avatars').
 *   3. ANONYMISATION profil : PII vidées, visible=false.
 *   4. ANONYMISATION user : nom vidé, téléphone libéré, email miroir = placeholder,
 *      status='deleted', anonymized_at=now() (posé EN DERNIER → un échec amont
 *      laisse le compte non marqué et il sera repris au prochain run).
 *   Les enregistrements d'interaction (candidatures/conversations/messages)
 *   sont PRÉSERVÉS sous forme désormais anonymisée.
 *
 * En cas d'échec BLOQUANT (auth, profil, user), la fonction LÈVE → l'appelant
 * n'incrémente pas le compteur et le compte sera repris au prochain passage
 * (anonymized_at non posé). Les suppressions de fichiers sont best-effort.
 */

const PERMANENT_BAN = '876000h' // ~100 ans

export type PurgeableUser = {
  id: string
  domain_id: string
  email: string | null
}

export async function purgeAccount(admin: SupabaseClient, u: PurgeableUser): Promise<void> {
  const uid = u.id
  const placeholderEmail = `deleted+${uid}@deleted.invalid`

  // 1. Bloque le login + libère l'email d'origine (auth = source de vérité).
  //    Si ça échoue, on lève → le compte n'est PAS marqué et sera repris.
  const { error: authErr } = await admin.auth.admin.updateUserById(uid, {
    email: placeholderEmail,
    password: randomUUID() + randomUUID(),
    ban_duration: PERMANENT_BAN,
  })
  if (authErr) {
    throw new Error(`auth_update_failed: ${authErr.message}`)
  }

  // 2. Suppression des fichiers perso (best-effort, ne bloque pas la purge).
  const { data: prof } = await admin
    .from('profiles')
    .select('id, cv_file_path')
    .eq('user_id', uid)
    .maybeSingle()
  if (prof?.cv_file_path) {
    const { error: cvErr } = await admin.storage.from('cv').remove([prof.cv_file_path])
    if (cvErr) console.error('[purge] cv remove failed', { uid, msg: cvErr.message })
  }
  const { error: avErr } = await admin.storage.from('avatars').remove([`${uid}/avatar.jpg`])
  if (avErr) console.error('[purge] avatar remove failed', { uid, msg: avErr.message })

  // 3. Anonymisation du profil (PII vidées, invisible).
  if (prof?.id) {
    const { error: profErr } = await admin
      .from('profiles')
      .update({
        visible: false,
        pre_deletion_visible: null,
        summary: null,
        title: null,
        photo_url: null,
        cv_file_path: null,
        cv_url: null,
        cv_hash: null,
        address_line: null,
        postal_code: null,
        birth_year: null,
        linkedin_url: null,
        phone: null,
        city: null,
        location: null,
        skills: [],
        languages: [],
        certifications: [],
      })
      .eq('id', prof.id)
    if (profErr) throw new Error(`profile_anonymize_failed: ${profErr.message}`)
  }

  // 4. Anonymisation du user (anonymized_at posé EN DERNIER → idempotence).
  const { error: userErr } = await admin
    .from('users')
    .update({
      email: placeholderEmail,
      first_name: null,
      last_name: null,
      phone: null,
      phone_verified: false,
      linkedin_url: null,
      civility: null,
      job_title: null,
      status: 'deleted',
      last_session_token: null,
      anonymized_at: new Date().toISOString(),
    })
    .eq('id', uid)
  if (userErr) throw new Error(`user_anonymize_failed: ${userErr.message}`)

  await logAudit({
    supabaseAdmin: admin,
    user_id: uid,
    domain_id: u.domain_id,
    action: 'account_purged',
    entity_type: 'user',
    entity_id: uid,
    detail: { anonymized: true },
  })
}
