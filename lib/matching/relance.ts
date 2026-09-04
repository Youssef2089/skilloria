import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * LA RELANCE D'UN EXPERT — REPORTÉE, JAMAIS ANNULÉE.
 *
 * ═══ CE QUI CLOCHAIT ══════════════════════════════════════════════════════
 *   Un expert modifiait son profil : le moteur tournait. Il le modifiait à
 *   nouveau dans l'heure : le garde-fou de débit REFUSAIT (429), et ce
 *   déclenchement était PERDU. Ses dernières modifications n'étaient jamais
 *   notées, et rien ne le signalait — ni à lui, ni à nous.
 *
 *   Le garde-fou avait raison de protéger le coût. Il avait tort d'ANNULER.
 *
 * ═══ CE QUI SE PASSE MAINTENANT ═══════════════════════════════════════════
 *   IMMÉDIAT À L'APPROBATION. C'est le moment qui compte pour l'expert : son
 *   profil vient d'être validé, il doit voir des annonces tout de suite. Aucune
 *   temporisation ne s'applique là.
 *
 *   REPORTÉ ENSUITE. Tout déclenchement ultérieur pose une échéance à une
 *   heure. Un nouveau déclenchement pendant l'attente la REPOUSSE : on attend
 *   que l'expert ait fini de modifier son profil, puis on note UNE fois, sur
 *   son état final. Une note au lieu de cinq, et surtout aucune modification
 *   perdue.
 *
 * ═══ LE PIÈGE DU REPORT, ET IL EST BORNÉ ══════════════════════════════════
 *   Reporter indéfiniment, c'est ne jamais exécuter. Un expert qui modifie son
 *   profil toutes les cinquante minutes ne serait JAMAIS noté — le défaut qu'on
 *   prétend corriger, déguisé en fonctionnalité.
 *
 *   L'exécution a donc lieu au plus tôt des deux : l'échéance reportée, ou le
 *   PREMIER déclenchement de la série plus l'attente maximale. Le report ne
 *   peut pas repousser au-delà.
 *
 * ═══ POURQUOI LE DÉLAI VIT ICI ET PAS EN BASE ═════════════════════════════
 *   C'est une règle de comportement, pas une donnée. La base porte les faits
 *   (une échéance, un compteur de reports) ; le code porte la règle. Une seule
 *   des deux doit bouger quand on change d'avis.
 */

/** La temporisation nominale : on attend que l'expert ait fini. */
export const DELAI_RELANCE_MINUTES = 60

/**
 * L'attente maximale, quels que soient les reports.
 *
 * Six heures : assez pour absorber une après-midi d'allers-retours sur un
 * profil, trop court pour qu'un expert reste invisible une journée entière.
 */
export const ATTENTE_MAX_HEURES = 6

export type OrigineRelance =
  | 'profil_modifie'
  | 'ouverture_croisee'
  | 'disponibilite'
  | 'cv_reanalyse'

/** Ce que l'appelant apprend, et qu'il peut journaliser tel quel. */
export type Programmation =
  | { ok: true; due_at: string; reportee: boolean }
  | { ok: false; raison: string }

/**
 * Programme une relance, ou REPORTE celle qui attend déjà.
 *
 * L'écriture est faite EN BASE, en une seule instruction : lire puis écrire
 * depuis ici laisserait une fenêtre entre les deux, et deux modifications
 * simultanées se marcheraient dessus — l'une des deux serait perdue, c'est-à-dire
 * exactement le défaut que ce mécanisme corrige.
 */
export async function programmerRelance(
  supabaseAdmin: SupabaseClient,
  profileId: string,
  origine: OrigineRelance,
): Promise<Programmation> {
  // On lit l'état AVANT pour savoir s'il s'agit d'un report ou d'une première
  // programmation. C'est une information de journal, pas une décision : la
  // décision, elle, est prise par la fonction SQL en une seule écriture.
  const { data: avant } = await supabaseAdmin
    .from('profiles')
    .select('matching_relance_due_at')
    .eq('id', profileId)
    .maybeSingle()
  const attendaitDeja = !!(avant as { matching_relance_due_at?: string | null } | null)
    ?.matching_relance_due_at

  const { data, error } = await supabaseAdmin.rpc('programmer_relance_expert', {
    p_profile_id: profileId,
    p_delai: `${DELAI_RELANCE_MINUTES} minutes`,
    p_raison: origine,
  })
  if (error) {
    // Une relance non programmée est une modification qui ne sera jamais notée.
    // On le DIT bruyamment : c'est précisément le silence qu'on corrige.
    console.error('[relance] NON PROGRAMMÉE — cette modification ne sera pas notée', {
      profileId,
      origine,
      message: error.message,
    })
    return { ok: false, raison: error.message }
  }
  const due = typeof data === 'string' ? data : null
  if (!due) return { ok: false, raison: 'profil introuvable' }

  console.log('[relance] programmée', {
    profileId,
    origine,
    due_at: due,
    reportee: attendaitDeja,
  })
  return { ok: true, due_at: due, reportee: attendaitDeja }
}

/**
 * Solde une relance APRÈS son exécution.
 *
 * `debutRun` est l'instant où le run a commencé. Un déclenchement arrivé
 * PENDANT l'exécution porte une échéance postérieure : il n'est pas soldé, et
 * la relance repartira. Sans cette précaution, une modification faite pendant
 * les quinze secondes du run serait perdue — le défaut, à nouveau.
 */
export async function solderRelance(
  supabaseAdmin: SupabaseClient,
  profileId: string,
  debutRun: Date,
): Promise<{ soldee: boolean }> {
  const { data, error } = await supabaseAdmin.rpc('solder_relance_expert', {
    p_profile_id: profileId,
    p_debut_run: debutRun.toISOString(),
  })
  if (error) {
    // Non soldée : la relance repartira au prochain passage. C'est un doublon
    // de travail, pas une perte — le bon sens de l'échec pour ce mécanisme.
    console.error('[relance] non soldée — elle sera rejouée', {
      profileId,
      message: error.message,
    })
    return { soldee: false }
  }
  if (data === false) {
    console.log('[relance] un déclenchement est arrivé pendant le run — elle repartira', {
      profileId,
    })
  }
  return { soldee: data === true }
}

/** La prochaine relance due, la plus ancienne d'abord. */
export async function prochaineRelance(
  supabaseAdmin: SupabaseClient,
): Promise<{ ok: true; profileId: string | null } | { ok: false; raison: string }> {
  const { data, error } = await supabaseAdmin.rpc('prochaine_relance_expert', {
    p_attente_max: `${ATTENTE_MAX_HEURES} hours`,
  })
  if (error) {
    console.error('[relance] file illisible', error.message)
    return { ok: false, raison: error.message }
  }
  return { ok: true, profileId: typeof data === 'string' ? data : null }
}
