import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContexteJournal } from '@/lib/journal/contexte'
import { journaliserDans } from '@/lib/journal/journaliser'
import type { ArretDeNotation } from './rerank'
import type { BilanNotifications } from './shared'
import type { RaisonIneligible } from './eligibilite'
// Les plafonds des deux sens — une source, vérifiée contre ses jumeaux SQL.
import { RELANCE_MAX_TENTATIVES, RUN_MAX_TENTATIVES } from './run-abouti'

/**
 * LE JOURNAL D'UNE RECHERCHE — UNE LIGNE PAR RECHERCHE, écrite à sa fin (décision de Youssef, 01/10/2026,
 * ARRÊT 22). Les cinq étapes (lancée, vivier filtré, profils notés, correspondances, notifications) écrivaient
 * chacune leur ligne : cinq à six lignes par recherche, recherches automatiques comprises. Elles NOTENT désormais
 * leur bilan en mémoire, et la ligne de fin (terminée, en échec ou abandonnée) le porte, avec le coût. Le détail
 * lot par lot reste dans le journal des dépenses d'IA. Le texte ci-dessous décrit encore les étapes : elles
 * existent toujours, elles n'écrivent plus.
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

/**
 * LE BILAN D'UNE RECHERCHE — ce que les étapes ont vu, accumulé EN MÉMOIRE, écrit UNE fois à la fin.
 * Chaque clé est un nombre (ou absente : l'étape n'a pas eu lieu — `undefined` ne s'écrit pas).
 */
type BilanDeRecherche = {
  tentative?: number | null
  eligibles?: number
  examinees?: number
  notees?: number
  reprises?: number
  lots_en_echec?: number
  retenues?: number
  fortes?: number
  nouvelles?: number
  notifiees?: number
  notifications_manquees?: number
  /** Le coût du classement ; `null` : un lot sans tarif — un coût partiel est faux (§D.24), il ne s'écrit pas. */
  cout_usd?: number | null
  /**
   * Les unités facturées et leur SOURCE (§D.24) : `fournisseur`, lues dans la réponse ; `plancher`, estimées au minimum
   * facturable parce que la réponse ne les disait pas. Le coût d'une ligne se lit avec elles — relecture du 01/10/2026,
   * point 15 : depuis que la ligne `recherche_classee` est fondue dans la fin, le coût ne disait plus s'il était mesuré.
   */
  recherches?: number
  unites_source?: 'fournisseur' | 'plancher'
}

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
    /** Le bilan PARTAGÉ par les instances d'une même recherche (`dansEcosysteme` le transmet). */
    private readonly bilan: BilanDeRecherche = {},
  ) {}

  /** La même recherche, sous l'écosystème de l'objet lu. Le bilan est le MÊME objet : rien ne se perd. */
  dansEcosysteme(ecosystemeId: string): JournalDeRecherche {
    return new JournalDeRecherche(this.admin, this.journal, this.sujet, ecosystemeId, this.bilan)
  }

  // ── LES ÉTAPES : elles n'écrivent plus, elles NOTENT (ARRÊT 22) ─────────────
  //  Les appelants les appellent comme avant (`await` compris) : la forme ne change pas, seule l'écriture disparaît.

  /** Le point de non-retour : la tentative est comptée. */
  async lancee(d: { tentative: number | null }): Promise<void> {
    this.bilan.tentative = d.tentative
  }

  /** Le filtrage : combien d'éligibles, et combien partent à la notation (les examinés). */
  async filtree(d: {
    eligibles: number
    sans_matiere: number
    a_noter: number
    ecartes_deja_decline?: number
    ecartes_deja_postule?: number
    chargees?: number
  }): Promise<void> {
    this.bilan.eligibles = d.eligibles
    this.bilan.examinees = d.a_noter
  }

  /** Le classement : notés, reprises, lots en échec, et ce que la recherche a COÛTÉ. */
  async classee(d: {
    model: string
    notes: number
    reprises: number
    lots_en_echec: number
    arret: ArretDeNotation | null
    facture: { recherches: number; source: 'fournisseur' | 'plancher'; cout_usd: number | null }
  }): Promise<void> {
    this.bilan.notees = d.notes
    this.bilan.reprises = d.reprises
    this.bilan.lots_en_echec = d.lots_en_echec
    this.bilan.cout_usd = d.facture.cout_usd
    this.bilan.recherches = d.facture.recherches
    this.bilan.unites_source = d.facture.source
  }

  /** Les correspondances : retenues, fortes, et celles qui sont NOUVELLES. */
  async correspondances(d: {
    retenues: number
    fortes: number
    inserees: number
    mises_a_jour: number
    supprimees: number
    filtre_flux: number
    palier_fort: number
  }): Promise<void> {
    this.bilan.retenues = d.retenues
    this.bilan.fortes = d.fortes
    this.bilan.nouvelles = d.inserees
  }

  /** Les notifications : combien de personnes ont été PRÉVENUES, combien ne l'ont pas été (paquet refusé, renoncement). */
  async notifiee(b: BilanNotifications): Promise<void> {
    this.bilan.notifiees = b.posees
    this.bilan.notifications_manquees = b.renonce || b.paquets_en_echec > 0
      ? Math.max(0, b.demandees - b.deja_notifiees - b.posees)
      : 0
  }

  private cout(): { usd: number; unite: 'recherches' } | null {
    return typeof this.bilan.cout_usd === 'number' ? { usd: this.bilan.cout_usd, unite: 'recherches' } : null
  }

  /**
   * LA FIN — UNE ligne pour toute la recherche (décision de Youssef, 01/10/2026) : l'issue, fermée, et le bilan
   * (examinés, notés, retenus, forts, nouveaux, prévenus) avec le coût. Statut `reussi` imposé par la base : une
   * recherche terminée sur un refus légitime ou un vivier vide s'est bien TERMINÉE. La raison n'accompagne que
   * l'inéligibilité, en code (§D.20). Clé par clé, jamais par étalement (§E.38) : le type vérifie ce qui part.
   */
  async terminee(d: { issue: IssueDeRecherche; raison?: RaisonIneligible }): Promise<void> {
    const b = this.bilan
    await journaliserDans(this.admin, this.journal, {
      type: 'recherche_terminee',
      statut: 'reussi',
      sujet: this.sujet,
      ecosystemeId: this.ecosystemeId,
      detail: {
        issue: d.issue, raison: d.raison, tentative: b.tentative, tache: this.journal.tache,
        eligibles: b.eligibles, examinees: b.examinees, notees: b.notees, reprises: b.reprises, lots_en_echec: b.lots_en_echec,
        retenues: b.retenues, fortes: b.fortes, nouvelles: b.nouvelles, notifiees: b.notifiees, notifications_manquees: b.notifications_manquees,
        recherches: b.recherches, unites_source: b.unites_source,
      },
      cout: this.cout(),
    })
  }

  /**
   * L'ÉCHEC — UNE ligne : l'étape et la cause en codes, la tentative consommée (`null` quand aucune ne l'a été),
   * et le bilan de ce qui a eu lieu avant la panne. Statut `echoue` imposé par la base.
   *
   * ET C'EST ICI QUE L'ABANDON SE DÉCIDE : la tentative a atteint le plafond du sens, plus rien ne rejouera. Une
   * seule ligne alors aussi — `recherche_abandonnee` AU LIEU de l'échec, qui porte l'étape et la cause : deux lignes
   * pour un même fait, c'est ce que la décision a fermé.
   */
  async echouee(d: {
    etape: EtapeDeRecherche
    cause: CauseDEchec
    tentative: number | null
    arret?: ArretDeNotation | null
    lots_en_echec?: number
  }): Promise<void> {
    const b = this.bilan
    const plafond = this.sujet.type === 'publications' ? RUN_MAX_TENTATIVES : RELANCE_MAX_TENTATIVES
    const lotsEnEchec = d.lots_en_echec ?? b.lots_en_echec
    if (d.tentative !== null && d.tentative >= plafond) {
      await journaliserDans(this.admin, this.journal, {
        type: 'recherche_abandonnee',
        statut: 'echoue',
        sujet: this.sujet,
        ecosystemeId: this.ecosystemeId,
        detail: {
          tentatives: d.tentative, plafond, cause: d.cause, etape: d.etape, arret: d.arret, tache: this.journal.tache,
          eligibles: b.eligibles, examinees: b.examinees, notees: b.notees, reprises: b.reprises, lots_en_echec: lotsEnEchec,
          retenues: b.retenues, fortes: b.fortes, nouvelles: b.nouvelles, notifiees: b.notifiees, notifications_manquees: b.notifications_manquees,
          recherches: b.recherches, unites_source: b.unites_source,
        },
        cout: this.cout(),
      })
      return
    }
    await journaliserDans(this.admin, this.journal, {
      type: 'recherche_echouee',
      statut: 'echoue',
      sujet: this.sujet,
      ecosystemeId: this.ecosystemeId,
      detail: {
        etape: d.etape, cause: d.cause, tentative: d.tentative, arret: d.arret, tache: this.journal.tache,
        eligibles: b.eligibles, examinees: b.examinees, notees: b.notees, reprises: b.reprises, lots_en_echec: lotsEnEchec,
        retenues: b.retenues, fortes: b.fortes, nouvelles: b.nouvelles, notifiees: b.notifiees, notifications_manquees: b.notifications_manquees,
        recherches: b.recherches, unites_source: b.unites_source,
      },
      cout: this.cout(),
    })
  }
}
