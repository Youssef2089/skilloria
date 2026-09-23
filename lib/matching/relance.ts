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
 *   REPORTÉ ENSUITE. Tout déclenchement ultérieur pose une échéance. Un nouveau
 *   déclenchement pendant l'attente la REPOUSSE : une rafale de modifications
 *   ne produit qu'un run, et aucune modification n'est perdue.
 *
 * ═══ CE QUE LE REPORT NE FAIT PLUS, ET C'EST LE POINT ═════════════════════
 *   IL NE PORTE PLUS LA JUSTESSE. Il l'a portée tant que le brouillon de
 *   notation ignorait le contenu : une note s'y retrouvait par identité, et
 *   attendre « l'état final » était la seule façon de ne pas servir une note
 *   calculée sur le profil d'avant. C'était une DISCIPLINE — et elle ne fermait
 *   pas la fenêtre, elle la rétrécissait : une modification juste après
 *   l'échéance reprenait la note qui venait d'être écrite.
 *
 *   Depuis le 22/09/2026, la note est clée sur l'EMPREINTE des textes qui l'ont
 *   produite ([lib/matching/empreinte.ts](./empreinte.ts)). Un profil modifié a
 *   une autre empreinte, donc d'autres notes — **juste par construction**, sans
 *   rien attendre (§E.31). Le report n'a plus à garantir quoi que ce soit.
 *
 * ═══ CE QU'IL GARDE : L'ANTI-RAFALE, ET RIEN D'AUTRE ══════════════════════
 *   Dix modifications de suite font dix empreintes neuves, donc dix runs
 *   PAYANTS : plus aucune note n'est reprise d'une version antérieure du
 *   profil. Le report les ramène à un.
 *
 *   ⚠️ CETTE RAISON N'ÉTAIT PAS VRAIE AVANT, ET ELLE L'EST DEVENUE. Ce module
 *   a longtemps justifié l'attente par le coût, alors que la reprise par
 *   identité rendait un second run presque gratuit : l'argument était faux au
 *   moment où il était écrit, et il est devenu exact le jour où on a fermé le
 *   défaut qu'il ignorait. Mesuré, pas supposé — cf. §E.58.
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

/**
 * LA TEMPORISATION NOMINALE — dix minutes, et voici pourquoi ce nombre.
 *
 * Elle n'a plus qu'un travail : **ramener une rafale de modifications à un seul
 * run** (cf. en-tête). Elle se règle donc sur la seule grandeur qui compte
 * désormais — la durée des PAUSES à l'intérieur d'une séance d'édition — et
 * plus du tout sur « combien de temps attendre avant d'être sûr que l'expert a
 * fini », qui était la question d'avant l'empreinte.
 *
 * Dix minutes couvrent largement ces pauses : on enchaîne les enregistrements
 * en quelques secondes à quelques minutes, on ne reprend pas son profil une fois
 * par quart d'heure pendant une heure.
 *
 * ELLE VALAIT SOIXANTE, ET LES CINQUANTE AUTRES N'ACHÈTENT PLUS RIEN. Elles
 * payaient la justesse — plus l'attente était longue, plus l'état noté avait de
 * chances d'être le dernier. La clé la donne désormais gratuitement, tandis que
 * l'heure d'attente, elle, coûte : l'expert reste une heure sans voir les
 * annonces que son profil mis à jour lui ouvre.
 *
 * ⚠️ PROPOSITION, PAS MESURE. Aucune donnée du dépôt ne dit la durée réelle
 *    d'une séance d'édition — il faudrait horodater les enregistrements
 *    successifs, ce qu'on ne fait pas. Dix minutes est un choix ARGUMENTÉ, et
 *    il se change en une ligne ; ce qui ne se change pas en une ligne, c'est la
 *    justesse, et elle ne dépend plus de ce nombre.
 */
export const DELAI_RELANCE_MINUTES = 10

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
 * LE PLAFOND HORAIRE, CONSOMMÉ — une seule implémentation, deux appelants.
 *
 * ═══ POURQUOI IL SORT DE `programmerRelance` ══════════════════════════════
 *   Depuis le 21/09/2026, la bascule de disponibilité N'ÉCHELONNE PLUS : elle
 *   exécute le moteur tout de suite (cf. `/api/me/sync-matching`). Le plafond,
 *   lui, doit continuer de s'appliquer — il borne les écritures qu'un client
 *   peut déclencher, et un run direct en déclenche autant qu'une relance.
 *
 *   Le recopier dans la route aurait produit deux plafonds portant le même nom
 *   et vieillissant séparément : relever l'un laisserait l'autre en place, et
 *   le code ressemblerait à un plafond unique. C'est exactement le défaut que
 *   §E.20 décrit. Il n'y en a donc qu'un, et il est ici.
 *
 * ═══ FAIL-OPEN, ET C'EST DÉLIBÉRÉ ════════════════════════════════════════
 *   L'inverse de la vérification d'un code OTP, parce que ce n'est pas la même
 *   sorte de garde. Refuser à cause d'un limiteur cassé ferait PERDRE un
 *   déclenchement, c'est-à-dire ré-introduirait très exactement le défaut que
 *   le lot 6 a corrigé. `checkRateLimit` porte ce contrat.
 *
 * `true` = le geste est autorisé. Un refus est DÉJÀ compté et journalisé ici :
 * l'appelant n'a qu'à le rendre à l'écran.
 */
export async function consommerPlafondHoraire(
  supabaseAdmin: SupabaseClient,
  profileId: string,
  origine: OrigineRelance,
): Promise<boolean> {
  const autorise = await checkRateLimit(
    supabaseAdmin,
    'relance_programmation',
    profileId,
    RELANCE_FENETRE_S,
    RELANCE_MAX_PAR_HEURE,
  )
  if (autorise) return true

  await compterDepassement(supabaseAdmin, profileId, origine)
  console.warn('[relance] plafond horaire atteint — geste REFUSÉ', {
    profileId,
    origine,
    plafond: RELANCE_MAX_PAR_HEURE,
  })
  return false
}

/**
 * Programme une relance, ou REPORTE celle qui attend déjà.
 *
 * L'écriture est faite EN BASE, en une seule instruction : lire puis écrire
 * depuis ici laisserait une fenêtre entre les deux, et deux modifications
 * simultanées se marcheraient dessus — l'une des deux serait perdue, c'est-à-dire
 * exactement le défaut que ce mécanisme corrige.
 *
 * ⚠️ CE CHEMIN EST CELUI DES MODIFICATIONS DE PROFIL, ET SEULEMENT LUI.
 *    Mesuré le 21/09/2026 : les deux appelants sont `/api/profile` (origine
 *    `profil_modifie`, à chaque enregistrement) et, jusqu'à ce jour,
 *    `/api/me/sync-matching`. Le premier est bien une rafale — un expert
 *    reprend son profil en dix passes, et chacune produit une empreinte neuve,
 *    donc un run payant. Le second ne l'était pas : un interrupteur à deux
 *    positions ne produit pas de rafale, et l'attente n'y absorbait rien. Elle
 *    a été retirée de là.
 */
export async function programmerRelance(
  supabaseAdmin: SupabaseClient,
  profileId: string,
  origine: OrigineRelance,
): Promise<Programmation> {
  // Plafond horaire, AVANT toute écriture.
  if (!(await consommerPlafondHoraire(supabaseAdmin, profileId, origine))) {
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


/* ═══════════════════════════════════════════════════════════════════════════
   UN RUN QUI A ÉCHOUÉ NE SE SOLDE PAS — LA DÉCISION EST AILLEURS, ET C'EST VOULU
   ═══════════════════════════════════════════════════════════════════════════

   `runAcheve` et `codeDEchec` vivent dans [./run-abouti.ts](./run-abouti.ts),
   un module SANS AUCUN IMPORT — donc chargeable tel quel par Node, donc
   EXÉCUTABLE par son contrôle (§E.33). Ce fichier-ci importe `checkRateLimit`
   par l'alias `@/` : un diagnostic ne peut pas le charger, et le contrôle
   retomberait sur une expression régulière, c'est-à-dire sur un commentaire
   (§E.7).

   Ils sont RÉEXPORTÉS ici pour que les appelants n'aient qu'un seul chemin
   d'import à connaître. */
export { codeDEchec, runAcheve, RELANCE_MAX_TENTATIVES } from './run-abouti'

/**
 * Compte une tentative, AVANT le run — comme côté annonce.
 *
 * Sans ce compteur, « ne pas solder un run en échec » serait une BOUCLE
 * INFINIE : le cron reprendrait le même expert toutes les cinq minutes et
 * paierait le reranker à chaque passage. Le plafond existe déjà côté annonce
 * (`matching_attempts < 5`) ; on le reprend, on n'en invente pas un second.
 *
 * Best-effort : une tentative non comptée vaut mieux qu'un run non fait — même
 * raisonnement que `marquerTentative` côté annonce, et même conséquence assumée.
 */
export async function marquerTentativeRelance(
  supabaseAdmin: SupabaseClient,
  profileId: string,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc('marquer_tentative_relance', {
    p_profile_id: profileId,
  })
  if (error) {
    console.error('[relance] tentative NON COMPTÉE — le plafond ne se fermera pas', {
      profileId,
      message: error.message,
    })
  }
}

/**
 * Enregistre qu'un run a ÉCHOUÉ, SANS solder l'échéance.
 *
 * L'échéance reste : la relance sera rejouée au prochain passage, jusqu'au
 * plafond. L'échec est DATÉ et NOMMÉ parce que l'expert doit pouvoir le lire —
 * un run échoué ne se dit pas « aucune mission pour l'instant » (§E.27).
 */
export async function echouerRelance(
  supabaseAdmin: SupabaseClient,
  profileId: string,
  code: string,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc('echouer_relance_expert', {
    p_profile_id: profileId,
    p_code: code,
  })
  if (error) {
    console.error('[relance] échec NON ENREGISTRÉ — l’expert lira « aucune mission »', {
      profileId,
      code,
      message: error.message,
    })
  }
}

/**
 * Solde une relance APRÈS son exécution — SEULEMENT si le run a ABOUTI.
 *
 * ⚠️ L'APPELANT DOIT AVOIR CONSULTÉ `runAcheve()` AVANT. Appeler cette
 *    fonction sur un run en échec efface l'échéance et perd la modification
 *    qui l'avait déclenchée : c'est le défaut que le lot D3 ferme.
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
