import { createHash } from 'node:crypto'

/**
 * lib/matching/empreinte.ts — UNE NOTE APPARTIENT AUX TEXTES QUI L'ONT PRODUITE.
 *
 * ═══ LE DÉFAUT QU'ELLE FERME, ET IL ÉTAIT SILENCIEUX ══════════════════════
 *   Le brouillon de notation était indexé par `(publication_id, profile_id,
 *   model)`. Trois identités — et **aucun contenu**. Un expert modifiait son
 *   profil, le moteur repartait, et retrouvait « sa » note : celle calculée sur
 *   le profil d'AVANT. Rien ne levait, rien ne le disait, et la note servie
 *   était fausse pendant vingt-quatre heures — la durée de vie du brouillon.
 *
 *   Le report d'une heure ne fermait pas cette fenêtre : il la RÉTRÉCISSAIT.
 *   Une modification à T+61 min relançait un run qui réutilisait la note écrite
 *   à T+60.
 *
 * ═══ LA DÉCISION : LA CLÉ PORTE LE CONTENU ════════════════════════════════
 *   Arbitré par Youssef le 22/09/2026, entre deux sorties possibles :
 *
 *     · SOLDER le brouillon en fin de run — une DISCIPLINE, qui dépend de la
 *       fin du run. Un run qui meurt à mi-chemin laisse des notes périmées.
 *     · CLÉER sur le contenu — JUSTE PAR CONSTRUCTION. Un profil modifié a une
 *       autre empreinte, donc d'autres notes ; un profil inchangé réutilise les
 *       siennes. Aucune fin de run à attendre, aucun ordre à respecter.
 *
 *   La seconde a été retenue : **une garde qui est une clé ne dépend d'aucune
 *   discipline** (§E.31).
 *
 * ═══ POURQUOI L'ORDRE EST CANONIQUE, ET PAS CELUI DE L'APPEL ══════════════
 *   Le brouillon sert LES DEUX SENS, et c'est délibéré : une note acquise par
 *   le run d'un expert épargne le run de l'annonce correspondante. Mais les
 *   deux sens n'appellent pas le reranker dans le même ordre — l'un interroge
 *   avec l'annonce, l'autre avec le profil.
 *
 *   Une empreinte calculée dans l'ordre de l'APPEL donnerait donc deux valeurs
 *   différentes pour le même couple de textes, et **supprimerait le partage
 *   entre les deux sens** — une régression de coût, décidée par accident.
 *   L'ordre est donc TOUJOURS (annonce, profil), quel que soit l'appelant.
 *
 *   ⚠️ CE QUE CE PARTAGE SUPPOSE, ET QUI N'EST PAS VÉRIFIÉ. Il suppose que la
 *   note de (requête = annonce, document = profil) vaut celle de
 *   (requête = profil, document = annonce). **Un reranker ne le garantit pas.**
 *   Cette supposition PRÉEXISTE à ce module — elle est écrite en toutes lettres
 *   dans `run-for-expert.ts` — et ce fichier la conserve à l'identique plutôt
 *   que de la trancher au passage. Elle est nommée ici pour qu'elle soit
 *   arbitrable, pas pour être corrigée en douce.
 *
 * ═══ PUR, SANS AUCUN AUTRE IMPORT ═════════════════════════════════════════
 *   Comme `lib/expert-name-code.ts` : le diagnostic l'exécute TEL QUEL, et
 *   mesure donc la vraie fonction — pas une seconde implémentation qui ne
 *   prouverait rien sur la première (§E.33).
 */

/**
 * Le séparateur, et pourquoi celui-là.
 *
 * `\u0000` ne peut pas apparaître dans les textes comparés : ils viennent de
 * colonnes `text` de Postgres, qui REFUSE l'octet nul. Un séparateur possible
 * dans les données ferait collisionner deux couples différents — `"ab" + "c"`
 * et `"a" + "bc"` — et deux annonces distinctes partageraient une note.
 */
const SEPARATEUR = '\u0000'

/**
 * L'empreinte du couple de textes qui a produit une note.
 *
 * @param texteAnnonce le texte de l'annonce, tel qu'il est passé au reranker
 * @param texteProfil  le texte du profil, tel qu'il est passé au reranker
 *
 * TOUJOURS dans cet ordre, quel que soit le sens du run (cf. en-tête).
 */
export function empreinteDeNote(texteAnnonce: string, texteProfil: string): string {
  return createHash('sha256')
    .update(texteAnnonce + SEPARATEUR + texteProfil, 'utf8')
    .digest('hex')
}
