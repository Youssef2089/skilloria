import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContexteJournal } from '@/lib/journal/contexte'
import { journaliserDans } from '@/lib/journal/journaliser'
import type { ArretDeNotation } from './rerank'

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

export class JournalDeRecherche {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly journal: ContexteJournal,
    private readonly sujet: SujetDeRecherche,
    /** L'écosystème de l'OBJET cherché, lu sur sa ligne — pas celui du contexte. */
    private readonly ecosystemeId: string,
  ) {}

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
}
