/**
 * lib/ecosystem-scope.ts — LE CLOISONNEMENT PAR ÉCOSYSTÈME.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ LE CLOISONNEMENT S'OUBLIE PAR OMISSION, JAMAIS PAR ERREUR VISIBLE.       ║
 * ║                                                                          ║
 * ║ Une requête à laquelle il manque ce filtre ne lève rien, ne casse aucun  ║
 * ║ test, n'affiche aucun symptôme : elle renvoie simplement TROP de lignes. ║
 * ║ C'est ainsi que quatre écrans ont pu être écrits sans filtrer, alors que ║
 * ║ la colonne était là, obligatoire, et remplie à chaque écriture.          ║
 * ║                                                                          ║
 * ║ D'où deux décisions, ensemble :                                          ║
 * ║   1. UN SEUL nom, importé partout : `activeEcosystemId(auth)`. Il rend   ║
 * ║      le filtre GREPPABLE et dit lequel des deux écosystèmes on lit. Une  ║
 * ║      lecture directe de `auth.domain.id` ne le dirait pas.               ║
 * ║   2. Un contrôle de diagnostic qui DÉCOUVRE les routes touchant les      ║
 * ║      tables cloisonnées et exige que chacune soit déclarée               ║
 * ║      (cf. scripts/diag-ecosystem-scope.mjs). Puisque rien dans le code   ║
 * ║      ne signale qu'un filtre manque, c'est le diagnostic qui le signale. ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ═══ CE QUE LE FILTRE EST, ET N'EST PAS ════════════════════════════════════
 *   Il est AUTOMATIQUE et INVISIBLE. Il découle du sous-domaine courant, point.
 *   L'utilisateur ne le voit pas, ne le choisit pas, ne le décoche pas — il
 *   n'existe aucun paramètre de requête, aucune case, aucune préférence.
 *
 *   Il est appliqué au SERVEUR : les lignes des autres écosystèmes ne quittent
 *   jamais la base. Filtrer dans le navigateur ne cloisonnerait rien (règle 20).
 *
 * ═══ POURQUOI IL S'APPLIQUE AUSSI AUX ACCÈS PAR IDENTIFIANT ════════════════
 *   Filtrer les listes ne suffit pas. Une organisation qui garde un lien en
 *   favori — le détail d'une annonce, une candidature — y accéderait depuis
 *   n'importe quel écosystème. Le filtre est donc posé DANS la recherche par
 *   identifiant, et pas après elle.
 *
 *   Conséquence voulue : un objet hors de l'écosystème actif est simplement
 *   INTROUVABLE. La route emprunte son 404 existant, sans chemin d'erreur
 *   nouveau. On ne renvoie jamais 403 : révéler « cet objet existe, mais
 *   ailleurs » serait déjà une fuite.
 *
 * ═══ NEUTRALITÉ EN MONO-ÉCOSYSTÈME — DÉMONTRABLE ═══════════════════════════
 *   Aujourd'hui, `auth.domain.id` vaut toujours `users.domain_id`, et toute
 *   annonce d'une organisation porte ce même écosystème puisqu'il n'y en a
 *   qu'un. Ajouter une égalité sur une colonne NOT NULL dont toutes les valeurs
 *   sont déjà celle qu'on compare ne peut retirer AUCUNE ligne.
 *   `scripts/diag-ecosystem-scope.mjs --db` le vérifie sur les données réelles.
 */

/** Colonne portant l'écosystème. Identique sur `publications` et `candidatures`. */
export const ECOSYSTEM_COLUMN = 'domain_id'

/**
 * L'écosystème ACTIF, celui du sous-domaine courant.
 *
 * ⚠️ À ne pas confondre avec `auth.user.domain_id`, l'écosystème du COMPTE.
 *    Pour un expert, les deux coïncident à vie. Pour un membre d'organisation,
 *    ils divergeront dès que la circulation entre écosystèmes sera ouverte —
 *    et c'est CELUI-CI qu'il faut filtrer, jamais l'autre.
 *
 * Cette fonction ne fait rien d'autre que nommer l'intention. C'est son but :
 * une lecture directe de `auth.domain.id` ne dit pas au relecteur laquelle des
 * deux valeurs il regarde.
 */
export function activeEcosystemId(auth: { domain: { id: string } }): string {
  return auth.domain.id
}
