import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContexteJournal } from '@/lib/journal/contexte'
import { journaliserDans } from '@/lib/journal/journaliser'

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
}
