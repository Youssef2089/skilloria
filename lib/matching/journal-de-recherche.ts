import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContexteJournal } from '@/lib/journal/contexte'
import { journaliserDans } from '@/lib/journal/journaliser'
import type { ArretDeNotation } from './rerank'
import type { BilanNotifications } from './shared'
import type { RaisonIneligible } from './eligibilite'
// Les plafonds des deux sens — une source, vérifiée contre ses jumeaux SQL.
import { RELANCE_MAX_TENTATIVES, RUN_MAX_TENTATIVES } from './run-abouti'

/**
 * LE JOURNAL D'UNE RECHERCHE — l'histoire d'un run, écrite au grand livre,
 * UNE LIGNE PAR ÉTAPE, jamais par lot ni par profil (§D.26).
 *
 * ═══ CE QUE C'EST ═══════════════════════════════════════════════════════════
 *   Le SEUL module qui porte les huit littéraux `recherche_*` du dépôt — un
 *   écrivain par action, et c'est ce que `diag-grand-livre` vérifie (D bis).
 *   Les deux sens du moteur — annonce → experts (`lib/matching/index.ts`) et
 *   expert → annonces (`lib/matching/run-for-expert.ts`) — l'appellent aux
 *   mêmes étapes, sous la MÊME pièce que le geste qui a déclenché le run :
 *   la publication, la modification du profil, le passage planifié.
 *
 * ═══ LES HUIT ÉTAPES, ET CE QUE CHACUNE PORTE ═══════════════════════════════
 *   · `lancee`          — le point de NON-RETOUR : la tentative est comptée,
 *                          le moteur va lire le vivier et payer. Ce qui refuse
 *                          AVANT (annonce expirée, expert inéligible, réglages
 *                          absents) s'écrit seul, `terminee` ou `echouee`, sans
 *                          `lancee` — une tentative non consommée n'est pas un
 *                          lancement.
 *   · `filtree`         — combien d'éligibles, combien d'écartés, et pourquoi.
 *   · `classee`         — combien de notés, de reprises, de lots en échec ; les
 *                          unités FACTURÉES et leur source ; le coût (§D.24).
 *   · `correspondances` — retenues, fortes, insérées, mises à jour, supprimées.
 *   · `notifiee`        — combien de notifications sont PARTIES.
 *   · `terminee`        — l'issue, fermée : ok, vivier vide, annonce expirée…
 *   · `echouee`         — l'étape et la cause, en CODES, jamais une phrase.
 *   · `abandonnee`      — après la dernière tentative : plus rien ne rejouera.
 *
 * ═══ LE SUJET, ET L'ÉCOSYSTÈME ══════════════════════════════════════════════
 *   Le sujet est l'objet dont on cherche les correspondances — l'annonce dans
 *   un sens, le profil dans l'autre. Le type du sujet DIT le sens ; on ne le
 *   répète pas dans le détail. L'écosystème est celui de l'objet, lu sur sa
 *   ligne : un passage planifié n'en a pas dans son contexte.
 *
 * ═══ UN ÉCHEC LÈVE, ET C'EST VOULU ══════════════════════════════════════════
 *   `journaliserDans` lève si le grand livre refuse (§E.68 : un journal
 *   best-effort ment déjà). Un run dont l'histoire ne peut pas s'écrire ne se
 *   termine pas : côté annonce il reste INACHEVÉ, donc rejouable ; côté expert
 *   la relance n'est pas soldée. Les appelants qui répondent à un écran
 *   attrapent déjà ce que le moteur lève.
 *
 * ═══ AUCUNE DONNÉE PERSONNELLE ══════════════════════════════════════════════
 *   Des comptes, des codes fermés, des identifiants. Jamais un titre, jamais
 *   un texte de profil, jamais une note individuelle (§D.6) — la répartition
 *   des notes reste dans `matching_stats`, hors du grand livre.
 */

export type SujetDeRecherche =
  | { type: 'publications'; id: string }
  | { type: 'profiles'; id: string }

/**
 * LES ISSUES D'UNE RECHERCHE QUI S'EST TERMINÉE — fermées, en valeur.
 *   `ok`              le moteur est allé au bout ;
 *   `vivier_vide`     rien à noter — un RÉSULTAT, pas une panne ;
 *   `annonce_expiree` l'annonce n'est plus active (sens annonce) ;
 *   `ineligible`      l'expert n'a pas droit au moteur aujourd'hui (sens expert) ;
 *   `sans_matiere`    le profil est trop court pour être comparé (sens expert).
 * Les trois dernières sont des REFUS LÉGITIMES : la recherche s'est terminée
 * sans tourner, et c'est la bonne réponse — `runAcheve()` les solde de même.
 */
export type IssueDeRecherche = 'ok' | 'vivier_vide' | 'annonce_expiree' | 'ineligible' | 'sans_matiere'

/**
 * OÙ ET POURQUOI UNE RECHERCHE A ÉCHOUÉ — en CODES, jamais une phrase (§E.24) :
 * une phrase se reformule, un code se compare. Le texte de la panne reste dans
 * les journaux techniques, hors du grand livre (il pourrait porter n'importe quoi).
 */
export type EtapeDeRecherche = 'lecture' | 'reglages' | 'vivier' | 'filtrage' | 'notation' | 'correspondances'
export type CauseDEchec =
  | 'lecture_en_panne'
  | 'introuvable'
  | 'reglages_absents'
  | 'durees_illisibles'
  | 'vivier_en_panne'
  | 'decisions_illisibles'
  | 'annonce_sans_matiere'
  | 'notation_arretee'
  | 'lots_en_echec'
  | 'reconciliation_en_panne'

export class JournalDeRecherche {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly journal: ContexteJournal,
    private readonly sujet: SujetDeRecherche,
    /**
     * L'écosystème de l'OBJET cherché, lu sur sa ligne — pas celui du contexte.
     * Avant la lecture de l'objet, celui du geste (une tâche n'en a pas) :
     * `dansEcosysteme()` rend l'instance de l'objet dès qu'il est lu.
     */
    private readonly ecosystemeId: string | null,
  ) {}

  /** La même recherche, sous l'écosystème de l'objet lu. Immuable : une nouvelle instance. */
  dansEcosysteme(ecosystemeId: string): JournalDeRecherche {
    return new JournalDeRecherche(this.admin, this.journal, this.sujet, ecosystemeId)
  }

  /**
   * LE LANCEMENT — après que la tentative a été comptée (annonce :
   * `marquerTentative`, le compteur lu + 1 ; expert : le compteur de relance
   * tel que lu sur le profil, incrémenté AVANT le run par l'appelant qui
   * relance). L'origine est déjà sur la ligne (`origine`, acteur) ; le nom de
   * la tâche planifiée, lui, ne vit que dans le contexte : on l'écrit.
   */
  async lancee(d: { tentative: number | null }): Promise<void> {
    await journaliserDans(this.admin, this.journal, {
      type: 'recherche_lancee',
      statut: 'reussi',
      sujet: this.sujet,
      ecosystemeId: this.ecosystemeId,
      detail: { tentative: d.tentative, tache: this.journal.tache },
    })
  }

  /**
   * LE FILTRAGE — ce que les critères DÉCLARÉS ont laissé passer, et ce qu'ils
   * ont écarté. `eligibles` est le vivier après filtres ; `sans_matiere`, ceux
   * qu'on ne peut pas noter (rien à lire) ; `a_noter`, ce qui part au classeur.
   * Annonce : les écartés pour décision déjà prise (décliné, déjà postulé) ;
   * expert : le nombre d'annonces CHARGÉES avant le recoupement en mémoire.
   * Une clé absente n'est pas envoyée (`undefined`) — le sens ne se répète pas.
   */
  async filtree(d: {
    eligibles: number
    sans_matiere: number
    a_noter: number
    ecartes_deja_decline?: number
    ecartes_deja_postule?: number
    chargees?: number
  }): Promise<void> {
    await journaliserDans(this.admin, this.journal, {
      type: 'recherche_filtree',
      statut: 'reussi',
      sujet: this.sujet,
      ecosystemeId: this.ecosystemeId,
      detail: {
        eligibles: d.eligibles,
        sans_matiere: d.sans_matiere,
        a_noter: d.a_noter,
        ecartes_deja_decline: d.ecartes_deja_decline,
        ecartes_deja_postule: d.ecartes_deja_postule,
        chargees: d.chargees,
      },
    })
  }

  /**
   * LE CLASSEMENT — notés (payés ce run), reprises (acquises d'un run
   * interrompu, non repayées), lots en échec, l'arrêt en CODE ; et ce que le
   * run a PAYÉ : les unités dans l'unité facturée, leur source, le coût dans
   * les colonnes de coût du grand livre (§D.24, §D.26). Un coût inconnu
   * (`null` : un lot sans tarif) ne s'écrit pas — un coût partiel est faux.
   * Le statut est celui de l'ÉTAPE : `echoue` si un lot a manqué ou si la
   * notation a été arrêtée — sauf `aucun_document`, qui n'est pas une panne.
   */
  async classee(d: {
    model: string
    notes: number
    reprises: number
    lots_en_echec: number
    arret: ArretDeNotation | null
    facture: { recherches: number; source: 'fournisseur' | 'plancher'; cout_usd: number | null }
  }): Promise<void> {
    await journaliserDans(this.admin, this.journal, {
      type: 'recherche_classee',
      statut: d.lots_en_echec > 0 || (d.arret !== null && d.arret !== 'aucun_document') ? 'echoue' : 'reussi',
      sujet: this.sujet,
      ecosystemeId: this.ecosystemeId,
      detail: {
        model: d.model,
        notes: d.notes,
        reprises: d.reprises,
        lots_en_echec: d.lots_en_echec,
        arret: d.arret,
        recherches: d.facture.recherches,
        unites_source: d.facture.source,
      },
      cout: d.facture.cout_usd === null ? null : { usd: d.facture.cout_usd, unite: 'recherches' },
    })
  }

  /**
   * LES CORRESPONDANCES — ce que le filtre du flux a retenu parmi les notés,
   * combien sont fortes (le palier figé ce jour-là), et ce que la
   * réconciliation a FAIT : insérées, mises à jour, supprimées. Les deux
   * valeurs de réglage qui ont trié sont écrites avec — un réglage qui change
   * ne réécrit pas l'histoire. Jamais une note individuelle (§D.6).
   */
  async correspondances(d: {
    retenues: number
    fortes: number
    inserees: number
    mises_a_jour: number
    supprimees: number
    filtre_flux: number
    palier_fort: number
  }): Promise<void> {
    await journaliserDans(this.admin, this.journal, {
      type: 'recherche_correspondances',
      statut: 'reussi',
      sujet: this.sujet,
      ecosystemeId: this.ecosystemeId,
      detail: {
        retenues: d.retenues,
        fortes: d.fortes,
        inserees: d.inserees,
        mises_a_jour: d.mises_a_jour,
        supprimees: d.supprimees,
        filtre_flux: d.filtre_flux,
        palier_fort: d.palier_fort,
      },
    })
  }

  /**
   * LES NOTIFICATIONS — ce que l'envoi a FAIT, tel qu'il l'a rendu : le
   * nombre demandé n'est pas le nombre parti. Écrite seulement quand un envoi
   * a été tenté ; son absence dit « rien à envoyer » (notifications éteintes,
   * aucune forte fraîche), et la ligne des correspondances dit pourquoi.
   * Statut de l'ÉTAPE : `echoue` si l'envoi a renoncé ou si un paquet a été
   * refusé — les destinataires manqués se rattrapent au run suivant, mais on
   * ne l'écrit pas comme réussi.
   */
  async notifiee(b: BilanNotifications): Promise<void> {
    await journaliserDans(this.admin, this.journal, {
      type: 'recherche_notifiee',
      statut: b.renonce || b.paquets_en_echec > 0 ? 'echoue' : 'reussi',
      sujet: this.sujet,
      ecosystemeId: this.ecosystemeId,
      detail: {
        demandees: b.demandees,
        deja_notifiees: b.deja_notifiees,
        posees: b.posees,
        paquets_en_echec: b.paquets_en_echec,
        renonce: b.renonce,
      },
    })
  }

  /**
   * LA FIN — l'issue, fermée. Statut `reussi` imposé par la base : une
   * recherche terminée sur un refus légitime (annonce expirée, expert
   * inéligible, profil sans matière) ou sur un vivier vide s'est bien
   * TERMINÉE ; ce qui a échoué s'écrit `echouee`. La raison n'accompagne
   * que l'inéligibilité, en code (§D.20).
   */
  async terminee(d: { issue: IssueDeRecherche; raison?: RaisonIneligible }): Promise<void> {
    await journaliserDans(this.admin, this.journal, {
      type: 'recherche_terminee',
      statut: 'reussi',
      sujet: this.sujet,
      ecosystemeId: this.ecosystemeId,
      detail: { issue: d.issue, raison: d.raison },
    })
  }

  /**
   * L'ÉCHEC — l'étape et la cause, en codes ; la tentative consommée (`null`
   * quand aucune ne l'a été : une lecture en panne avant le point de
   * non-retour) ; pour la notation, l'arrêt en code et les lots manqués.
   * Statut `echoue` imposé par la base. Une recherche échouée côté annonce
   * reste INACHEVÉE (rejouable) ; côté expert, la relance n'est pas soldée.
   *
   * ET C'EST ICI QUE L'ABANDON SE DÉCIDE : la tentative consommée a atteint
   * le plafond du sens, plus rien ne rejouera — le rattrapage (annonce) et la
   * file de relance (expert) excluent l'un et l'autre au-delà du plafond. Le
   * moteur est le seul à voir TOUTES les tentatives, les déclenchements
   * directs compris : il est le seul à pouvoir l'écrire. Même pièce que
   * l'échec — deux types, un sujet, l'index d'unicité ne les confond pas.
   */
  async echouee(d: {
    etape: EtapeDeRecherche
    cause: CauseDEchec
    tentative: number | null
    arret?: ArretDeNotation | null
    lots_en_echec?: number
  }): Promise<void> {
    await journaliserDans(this.admin, this.journal, {
      type: 'recherche_echouee',
      statut: 'echoue',
      sujet: this.sujet,
      ecosystemeId: this.ecosystemeId,
      detail: { etape: d.etape, cause: d.cause, tentative: d.tentative, arret: d.arret, lots_en_echec: d.lots_en_echec },
    })
    const plafond = this.sujet.type === 'publications' ? RUN_MAX_TENTATIVES : RELANCE_MAX_TENTATIVES
    if (d.tentative !== null && d.tentative >= plafond) {
      await this.abandonnee({ tentatives: d.tentative, plafond, cause: d.cause })
    }
  }

  /**
   * L'ABANDON — après la dernière tentative. Privé : seul l'échec le décide,
   * un appelant ne peut pas « abandonner » de lui-même. Le plafond est écrit
   * avec la ligne : un plafond qui change ne réécrit pas l'histoire.
   */
  private async abandonnee(d: { tentatives: number; plafond: number; cause: CauseDEchec }): Promise<void> {
    await journaliserDans(this.admin, this.journal, {
      type: 'recherche_abandonnee',
      statut: 'echoue',
      sujet: this.sujet,
      ecosystemeId: this.ecosystemeId,
      detail: { tentatives: d.tentatives, plafond: d.plafond, cause: d.cause },
    })
  }
}
