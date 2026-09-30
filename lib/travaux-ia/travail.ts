import type { SupabaseClient } from '@supabase/supabase-js'
import { ouvrirContexte, estTypeActeur, type ContexteJournal } from '@/lib/journal/contexte'
import { estPiece } from '@/lib/journal/piece'

/**
 * UN TRAVAIL D'IA — la ligne de `public.travaux_ia` (migration travaux_ia, §D.30).
 *
 * Les travaux longs (analyse d'un CV, vérification d'un expert) ne tournent plus
 * dans la requête de l'expert : la route DÉPOSE, l'exécutant (`/api/cron/travaux-ia`)
 * EXÉCUTE, le pilote pg_cron CLÔT ce qui est perdu. Ce module porte le type, le
 * contexte de journal d'un travail, et les deux dépôts.
 */

export type NatureTravail = 'analyse_cv' | 'verification_expert'
export type StatutTravail = 'en_attente' | 'en_cours' | 'reussi' | 'echoue' | 'annule'

export type Travail = {
  id: string
  nature: NatureTravail
  profile_id: string
  domain_id: string | null
  statut: StatutTravail
  tentatives: number
  max_tentatives: number
  piece: string
  acteur_id: string | null
  acteur_type: string | null
  charge: Record<string, unknown>
  erreur_code: string | null
}

/**
 * LE CONTEXTE DE JOURNAL D'UN TRAVAIL : la pièce et l'acteur du GESTE qui l'a
 * déposé. Les lignes que le travail écrit (`cv_televerse`, `verification_conclue`,
 * les étapes de la recherche) s'écrivent sous cette pièce — le geste reste entier,
 * même quand son issue arrive une minute plus tard.
 */
export function contexteDuTravail(t: Travail): ContexteJournal {
  const acteur = t.acteur_id && estTypeActeur(t.acteur_type) ? { id: t.acteur_id, type: t.acteur_type } : null
  return ouvrirContexte({
    origine: acteur ? (acteur.type === 'admin' ? 'administrateur' : 'utilisateur') : 'systeme',
    acteur,
    ecosystemeId: t.domain_id,
    piece: estPiece(t.piece) ? t.piece : undefined,
  })
}

/** Dépose l'analyse d'un CV déjà STOCKÉ : le profil passe « en cours » ET le travail naît, ensemble. */
export async function deposerAnalyseCv(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args: { profileId: string; chemin: string; hash: string; octets: number },
): Promise<{ ok: true; travailId: string; premierConsentement: boolean } | { ok: false; message: string }> {
  const { data, error } = await admin.rpc('deposer_analyse_cv', {
    p_profile_id: args.profileId,
    p_chemin: args.chemin,
    p_hash: args.hash,
    p_octets: args.octets,
    p_piece: journal.piece,
    p_acteur_id: journal.acteur?.id ?? null,
    p_acteur_type: journal.acteur?.type ?? null,
  })
  if (error) return { ok: false, message: error.message }
  const r = (data ?? {}) as { travail?: string; premier_consentement?: boolean }
  if (!r.travail) return { ok: false, message: 'deposer_analyse_cv n a rendu aucun travail' }
  return { ok: true, travailId: r.travail, premierConsentement: r.premier_consentement === true }
}

/** Dépose la vérification d'un expert : « en cours » à l'écran (sauf un profil déjà approuvé), et le travail. */
export async function deposerVerificationExpert(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args: { profileId: string },
): Promise<{ ok: true; travailId: string } | { ok: false; message: string }> {
  const { data, error } = await admin.rpc('deposer_verification_expert', {
    p_profile_id: args.profileId,
    p_piece: journal.piece,
    p_acteur_id: journal.acteur?.id ?? null,
    p_acteur_type: journal.acteur?.type ?? null,
  })
  if (error) return { ok: false, message: error.message }
  if (typeof data !== 'string') return { ok: false, message: 'deposer_verification_expert n a rendu aucun travail' }
  return { ok: true, travailId: data }
}

/**
 * Échoue un travail : REJOUÉ si l'échec est de notre côté ou du fournisseur et qu'il
 * reste une tentative ; sinon clos, avec l'issue de repli posée EN BASE (analyse
 * « échouée, nommée » ; vérification en revue humaine) et sa ligne au grand livre.
 */
export async function echouerTravail(
  admin: SupabaseClient,
  travailId: string,
  code: string,
  rejouable: boolean,
): Promise<StatutTravail | 'inconnu'> {
  const { data, error } = await admin.rpc('echouer_travail_ia', {
    p_travail: travailId,
    p_code: code,
    p_rejouable: rejouable,
  })
  if (error) {
    // Le bail expirera et le pilote reprendra : ce travail n'est pas perdu.
    console.error('[travaux-ia] échec NON ENREGISTRÉ — le pilote reprendra à l expiration du bail', {
      travailId,
      code,
      message: error.message,
    })
    return 'inconnu'
  }
  return (typeof data === 'string' ? data : 'inconnu') as StatutTravail | 'inconnu'
}
