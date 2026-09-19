import { checkRateLimit } from '@/lib/rate-limit'
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

/**
 * LE PLAFOND HORAIRE — un garde d'ÉCRITURE, pas un garde-fou de coût.
 *
 * Le coût est déjà borné par la temporisation : une rafale de déclenchements ne
 * produit qu'un seul run. Ce qui n'était borné par rien, c'est le nombre
 * d'ÉCRITURES sur `profiles` qu'un client peut déclencher — programmer une
 * relance écrit, et deux surfaces clientes appellent cette fonction.
 *
 * Vingt par heure et par expert : très au-dessus de tout usage réel (un expert
 * qui reprend son profil en dix fois reste loin du compte), assez bas pour
 * qu'une boucle cliente ne martèle pas la base.
 *
 * PAS DE RÉGLAGE D'ADMINISTRATION, délibérément. Un seuil anti-abus n'est pas
 * un paramètre commercial : le rendre modifiable depuis un écran invite à le
 * relever le jour où il gêne, c'est-à-dire le jour où il sert. En échange, les
 * dépassements sont comptés et lisibles (cf. `relance_overrun_health`).
 */
export const RELANCE_MAX_PAR_HEURE = 20
export const RELANCE_FENETRE_S = 3600

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
 * Compte un dépassement — best-effort, ne lève jamais.
 *
 * `rate_limit_check` n'enregistre PAS les hits refusés (« refuse → ne pas
 * enregistrer » est son contrat), donc un dépassement ne se déduit d'aucune
 * table existante. Sans ce comptage, le plafond ne se découvrirait que par un
 * ticket. Ce n'est ni une file d'attente ni un rejeu : on compte, et c'est tout.
 *
 * Faire échouer une programmation parce qu'on n'a pas su COMPTER son refus
 * serait absurde — on journalise et on continue.
 */
async function compterDepassement(
  supabaseAdmin: SupabaseClient,
  profileId: string,
  origine: OrigineRelance,
): Promise<void> {
  // ⚠️ LE BLOC SUIVANT CRIE QUAND L'INSERTION ÉCHOUE — « le compteur va
  //    sous-estimer » — et se taisait quand l'ÉCOSYSTÈME manquait. La ligne
  //    partait alors avec `domain_id: null` : comptée globalement, invisible
  //    dans toute répartition par écosystème. Un chiffre faux sous un label
  //    juste (§E.24), dans un compteur anti-abus.
  const { data: prof, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('domain_id')
    .eq('id', profileId)
    .maybeSingle()
  if (profErr) {
    console.error('[relance] écosystème du dépassement INCONNU — la répartition par écosystème sous-estimera', {
      profileId,
      origine,
      message: profErr.message,
    })
  }
  const { error } = await supabaseAdmin.from('relance_overruns').insert({
    profile_id: profileId,
    domain_id: (prof as { domain_id?: string | null } | null)?.domain_id ?? null,
    origine,
  })
  if (error) {
    console.error('[relance] dépassement NON COMPTÉ — le compteur va sous-estimer', {
      profileId,
      origine,
      message: error.message,
    })
  }
}

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
  // ── Plafond horaire, AVANT toute écriture ────────────────────────────────
  //
  //  FAIL-OPEN, et c'est l'inverse de la vérification d'un code OTP — parce que
  //  ce n'est pas la même sorte de garde. Ici, refuser à cause d'un limiteur
  //  cassé ferait PERDRE un déclenchement, c'est-à-dire ré-introduirait très
  //  exactement le défaut que le lot 6 a corrigé. Un limiteur indisponible doit
  //  donc laisser passer : `checkRateLimit` porte ce contrat.
  if (!(await checkRateLimit(supabaseAdmin, 'relance_programmation', profileId, RELANCE_FENETRE_S, RELANCE_MAX_PAR_HEURE))) {
    await compterDepassement(supabaseAdmin, profileId, origine)
    console.warn('[relance] plafond horaire atteint — relance NON programmée', {
      profileId,
      origine,
      plafond: RELANCE_MAX_PAR_HEURE,
    })
    return { ok: false, raison: 'plafond_horaire' }
  }

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
