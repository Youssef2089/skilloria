import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * lib/inscription/refus.ts — LIRE LE REFUS DE LA BASE, POUR L'AFFICHER (§D.27).
 *
 * ═══ LA RÈGLE N'EST PAS ICI ════════════════════════════════════════════════
 *   Chaque règle d'inscription (formats, spécialité, domaines bloqués ou
 *   publics, unicité du domaine et du SIREN, invitation) est écrite UNE fois,
 *   en base : `inscription_refus()`. Le trigger `handle_new_user` la rejoue en
 *   garde finale. Ce module ne juge rien : il POSE LA QUESTION avant de créer le
 *   compte, parce que GoTrue avale l'erreur du trigger (« Database error saving
 *   new user ») et qu'une route ne saurait pas, après coup, quoi dire.
 *
 * ═══ LES CODES SONT STABLES ════════════════════════════════════════════════
 *   La liste ci-dessous est celle que la base peut rendre, ni plus ni moins —
 *   `diag-porte-inscription` la compare aux littéraux des fonctions SQL et aux
 *   messages `inscription_refus.*` des quatre langues. Un code ajouté en base
 *   sans message ici rougit.
 */

export const CODES_REFUS = [
  // la preuve (le serveur s'est trompé, ou le secret manque : jamais la faute de l'utilisateur)
  'preuve_absente',
  'preuve_invalide',
  'preuve_expiree',
  'secret_absent',
  // les règles
  'invalid_role',
  'invalid_voie',
  'invalid_piece',
  'invalid_domain',
  'role_gratuit_absent',
  'invalid_email',
  'email_taken',
  'invalid_first_name',
  'invalid_last_name',
  'cgu_required',
  'invalid_phone',
  'phone_already_used',
  'invalid_specialty',
  'invalid_branch',
  'branch_required',
  'invalid_speciality',
  'speciality_required',
  'invalid_org_type',
  'invalid_company_name',
  'invalid_country_code',
  'invalid_siren',
  'siren_taken',
  'invalid_vat_number',
  'email_domain_blocked',
  'email_domain_taken',
  'invitation_invalide',
  'invitation_expiree',
  'invitation_email_mismatch',
  'invitation_non_confirmee',
  'admin_role_missing',
  'acteur_non_admin',
  // les courses perdues, nommées par le trigger
  'organisation_deja_inscrite',
  'administrateur_non_promu',
] as const

export type CodeRefus = (typeof CODES_REFUS)[number]

/** Le refus quand la question elle-même n'a pas pu être posée. */
export const INSCRIPTION_INDISPONIBLE = 'inscription_indisponible' as const

const INDISPONIBLES: ReadonlySet<CodeRefus> = new Set<CodeRefus>([
  'preuve_absente',
  'preuve_invalide',
  'preuve_expiree',
  'secret_absent',
  'invalid_voie',
  'invalid_piece',
  'role_gratuit_absent',
  'admin_role_missing',
  'administrateur_non_promu',
])
const DEJA_PRIS: ReadonlySet<CodeRefus> = new Set<CodeRefus>([
  'email_taken',
  'phone_already_used',
  'siren_taken',
  'email_domain_taken',
  'organisation_deja_inscrite',
])

/** Le statut HTTP d'un refus : 409 pour ce qui est déjà pris, 503 pour ce qui n'est pas la faute de l'utilisateur. */
export function statutDuRefus(code: CodeRefus | typeof INSCRIPTION_INDISPONIBLE): number {
  if (code === INSCRIPTION_INDISPONIBLE) return 503
  if (INDISPONIBLES.has(code)) return 503
  if (DEJA_PRIS.has(code)) return 409
  return 400
}

export function estCodeRefus(v: unknown): v is CodeRefus {
  return typeof v === 'string' && (CODES_REFUS as readonly string[]).includes(v)
}

export type Verdict =
  | { ok: true }
  | { ok: false; code: CodeRefus | typeof INSCRIPTION_INDISPONIBLE; statut: number }

/**
 * Pose la question à la base : ce compte, avec ces métadonnées, serait-il refusé ?
 * Une lecture en panne n'est pas un feu vert (§E.22) : elle rend `inscription_indisponible`.
 */
export async function refusInscription(
  admin: SupabaseClient,
  email: string,
  meta: Record<string, string>,
): Promise<Verdict> {
  const { data, error } = await admin.rpc('inscription_refus', { p_email: email, p_meta: meta })
  if (error) {
    console.error('[inscription] inscription_refus illisible', error.message)
    return { ok: false, code: INSCRIPTION_INDISPONIBLE, statut: 503 }
  }
  if (data === null || data === undefined) return { ok: true }
  if (!estCodeRefus(data)) {
    // Un code que ce module ne connaît pas : on ne devine pas, on ne laisse pas passer.
    console.error('[inscription] code de refus inconnu', data)
    return { ok: false, code: INSCRIPTION_INDISPONIBLE, statut: 503 }
  }
  return { ok: false, code: data, statut: statutDuRefus(data) }
}

/**
 * Après une création REFUSÉE par GoTrue sans motif lisible : on repose la question.
 * Une course perdue (le domaine pris entre-temps) se nomme alors ; sinon, indisponible.
 */
export async function nommerLeRefus(
  admin: SupabaseClient,
  email: string,
  meta: Record<string, string>,
): Promise<{ code: CodeRefus | typeof INSCRIPTION_INDISPONIBLE; statut: number }> {
  const v = await refusInscription(admin, email, meta)
  if (!v.ok) return { code: v.code, statut: v.statut }
  return { code: INSCRIPTION_INDISPONIBLE, statut: 503 }
}
