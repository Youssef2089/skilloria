import type { SupabaseClient } from '@supabase/supabase-js'
import { evaluerVerificationExpert, notifyExpertResult, langueDeNotification } from '@/lib/verification/expert-verification'
import { contexteDuTravail, echouerTravail, type Travail } from './travail'

/**
 * LA VÉRIFICATION D'UN EXPERT, HORS DE LA REQUÊTE DE PUBLICATION (§D.30, B3).
 *
 *   évaluer (lecture + modèle) → CONCLURE en une transaction (profil, drapeau du
 *   compte, état du compte, ligne `verification_conclue`, travail clos) → prévenir
 *   l'expert → approuvé : la PREMIÈRE recherche, tout de suite, rejouée si elle
 *   échoue ; non approuvé : ses recommandations sont retirées.
 *
 * Un travail ANNULÉ entre-temps (l'expert a republié) ne conclut pas : c'est le
 * travail le plus récent qui décidera.
 */

export type IssueVerification =
  | { issue: 'conclu'; approuve: boolean; motif: string }
  | { issue: 'annule' }
  | { issue: 'rejoue' | 'echoue' | 'inconnu'; code: string }

export async function executerVerification(admin: SupabaseClient, t: Travail): Promise<IssueVerification> {
  const journal = contexteDuTravail(t)
  const intention = await evaluerVerificationExpert({ supabaseAdmin: admin, profile_id: t.profile_id, journal })

  if (intention.issue !== 'conclure') {
    const statut = await echouerTravail(admin, t.id, intention.code, intention.issue === 'rejouer')
    console.error('[travaux-ia:verification] pas de verdict', { travailId: t.id, code: intention.code, statut })
    return { issue: statut === 'en_attente' ? 'rejoue' : statut === 'echoue' ? 'echoue' : 'inconnu', code: intention.code }
  }

  const { data, error } = await admin.rpc('conclure_verification_expert', {
    p_travail: t.id,
    p_approuve: intention.approuve,
    p_methode: intention.methode,
    p_score: intention.score,
    p_donnees: intention.donnees,
    p_motif: intention.motif,
  })
  if (error) {
    console.error('[travaux-ia:verification] verdict NON écrit', { travailId: t.id, message: error.message })
    const statut = await echouerTravail(admin, t.id, 'ecriture_en_panne', true)
    return { issue: statut === 'en_attente' ? 'rejoue' : statut === 'echoue' ? 'echoue' : 'inconnu', code: 'ecriture_en_panne' }
  }
  const r = (data ?? {}) as { conclu?: boolean; user_id?: string; domain_id?: string; de?: string | null }
  if (r.conclu !== true) return { issue: 'annule' }

  // Prévenir l'expert (best-effort : le verdict est écrit, la notification ne le défait pas).
  if (r.user_id && r.domain_id) {
    // La langue et la voie de l'expert, pour le texte et le lien. Illisibles : on le DIT, et la
    // notification part en français vers l'accueil générique — le verdict, lui, est déjà écrit.
    const { data: u, error: uErr } = await admin.from('users').select('locale, user_type').eq('id', r.user_id).maybeSingle()
    if (uErr) {
      console.error('[travaux-ia:verification] langue de l expert illisible — notification en langue par défaut', {
        travailId: t.id,
        message: uErr.message,
      })
    }
    const lu = (u ?? {}) as { locale?: string | null; user_type?: string | null }
    await notifyExpertResult({
      supabaseAdmin: admin,
      user_id: r.user_id,
      domain_id: r.domain_id,
      user_type: lu.user_type ?? null,
      locale: langueDeNotification(lu.locale),
      verification_status: intention.approuve ? 'approved' : 'pending_admin_review',
      reason: null,
      piece: journal.piece,
    })
  }

  if (intention.approuve) {
    // LA PREMIÈRE MISE EN RELATION — immédiate, et rejouée si elle échoue (M5).
    // Seulement pour un profil qui VIENT d'être approuvé : un profil déjà approuvé
    // a sa relance programmée par l'enregistrement qui l'a republié.
    if (r.de !== 'approved') {
      // AUCUNE pré-lecture de l'éligibilité ici : le moteur la juge lui-même (§D.20) et rend
      // `ineligible` — un aboutissement, soldé. Une pré-lecture en panne aurait sauté la recherche.
      try {
        const { lancerMiseEnRelationImmediate } = await import('@/lib/matching/mise-en-relation-immediate')
        await lancerMiseEnRelationImmediate(admin, t.profile_id, journal)
      } catch (err) {
        console.error('[travaux-ia:verification] première mise en relation en échec (le verdict, lui, est écrit)', {
          travailId: t.id,
          cause: err instanceof Error ? err.message : String(err),
        })
      }
    }
  } else if (r.de === 'approved') {
    // DÉMOTION : un profil approuvé que sa re-vérification ne confirme pas perd ses
    // recommandations (le drapeau du compte est déjà retombé, dans la transaction du verdict).
    try {
      const { clearExpertRecommendations } = await import('@/lib/matching')
      await clearExpertRecommendations({ supabaseAdmin: admin, profileId: t.profile_id })
    } catch (err) {
      console.error('[travaux-ia:verification] recommandations NON retirées', {
        travailId: t.id,
        cause: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { issue: 'conclu', approuve: intention.approuve, motif: intention.motif }
}
