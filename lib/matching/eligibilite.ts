// lib/matching/eligibilite.ts
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ « ÉLIGIBLE » S'ÉCRIT UNE FOIS, ET LES DEUX SENS DU MOTEUR LA LISENT.     ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ LE DÉFAUT, MESURÉ LE 23/09/2026 ───────────────────────────────────────┐
// │ Le moteur a DEUX sens, et chacun jugeait l'éligibilité DE SON CÔTÉ :     │
// │   · annonce → experts : sept filtres poussés en SQL (`pool.ts`) ;        │
// │   · expert → annonces : six tests en mémoire (`run-for-expert.ts`).      │
// │                                                                          │
// │ TROIS CONDITIONS MANQUAIENT DU CÔTÉ EXPERT — compte SUSPENDU, compte en  │
// │ SUPPRESSION, compte ANONYMISÉ. Elles n'étaient même pas CHARGEABLES : le │
// │ `select` de ce côté-là ne demandait pas les colonnes.                    │
// │                                                                          │
// │ ET LES DEUX FICHIERS AFFIRMAIENT LE CONTRAIRE, EN TOUTES LETTRES :       │
// │   « Exactement les mêmes conditions que côté vivier » (run-for-expert)   │
// │   « la SEULE implémentation de la garde […] il n'existe donc pas de      │
// │     seconde liste de conditions » (issue-de-recherche)                   │
// │ Deux commentaires justes le jour où ils ont été écrits, faux depuis, et  │
// │ que rien ne pouvait contredire (§E.7).                                   │
// └──────────────────────────────────────────────────────────────────────────┘
//
// ═══ CE QUE ÇA COÛTAIT, ET C'EST ATTEIGNABLE ═════════════════════════════
//   `requireAuth` ferme la porte aux trois états (403 `account_suspended`,
//   `account_deletion_scheduled`, `account_anonymized`) : aucun écran ne peut
//   donc déclencher un run sur un compte fermé. MAIS DEUX CHEMINS SERVEUR NE
//   PASSENT PAS PAR LÀ :
//     · `app/api/cron/expert-relance` — aucun utilisateur, aucune session ;
//     · `app/api/admin/approve-expert` — c'est le statut de L'ADMINISTRATEUR
//       que la garde vérifie, jamais celui de l'expert approuvé.
//   Un expert suspendu se faisait donc noter (dépense réelle chez le
//   fournisseur) et NOTIFIER : des e-mails « de nouvelles missions » à un
//   compte dont l'accès est coupé.
//
// ═══ POURQUOI UNE LISTE DE DONNÉES, ET PAS DEUX FONCTIONS ════════════════
//   Les deux sens n'ont pas la même forme et ne peuvent pas l'avoir : l'un
//   filtre CINQUANTE MILLE lignes en SQL, l'autre juge UNE ligne déjà chargée.
//   Une « fonction partagée » aurait donc été deux fonctions, c'est-à-dire un
//   jumeau (§E.20) — exactement ce qui vient de diverger.
//
//   Chaque condition est donc une DONNÉE qui porte les deux formes : le test
//   en mémoire ET le filtre SQL. Les deux sens plient la MÊME liste. Ajouter
//   une condition l'ajoute des deux côtés, en une ligne, et il n'existe aucun
//   endroit où l'on puisse en ajouter une d'un seul côté.
//
// ⚠️ ET LES COLONNES SONT DÉRIVÉES DE LA LISTE. C'est la moitié qui manquait :
//    un test sur une colonne que le `select` ne charge pas ne lève RIEN — il
//    lit `undefined` et conclut. Les deux `select` sont construits à partir de
//    `COLONNES_PROFIL` et `COLONNES_COMPTE`, qui sont calculées ici.
//
// MODULE **PUR** : aucun import. Son contrôle l'exécute tel quel (§E.33).

/** Les deux publics du produit. Repris de `lib/annonces/audience.ts` — même union. */
export type PublicExpert = 'expert_freelance' | 'expert_cdi'

/**
 * Où vit la colonne : sur le profil, ou sur le compte qui le porte.
 *
 * La distinction n'est pas cosmétique : côté SQL, une colonne de compte se lit
 * à travers la jointure (`users.status`), et côté mémoire elle vit dans la
 * relation `users` de la ligne.
 */
export type CibleColonne = 'profil' | 'compte'

/**
 * Quand la condition s'applique.
 *
 * `toujours` — tout le monde, dans les deux sens.
 * `freelance` / `cdi` — la disponibilité, qui est celle du TYPE DE L'EXPERT et
 *   jamais celle de l'annonce. Un freelance en « ne pas déranger » et un
 *   salarié qui ne cherche pas ne sont pas la même donnée.
 */
export type PorteeCondition = 'toujours' | PublicExpert

/**
 * La forme SQL d'une condition, déclarée — pas appliquée ici.
 *
 * ⚠️ `neq_ou_null` N'EST PAS UN CAPRICE. En SQL, `colonne <> 'x'` vaut NULL
 *    quand la colonne est NULL, et la ligne est ÉCARTÉE. En mémoire,
 *    `p.colonne === 'x'` est faux sur `null`, et la ligne est GARDÉE. Sur une
 *    colonne nullable, un `neq` simple exclurait donc des profils que le test
 *    en mémoire accepte — les deux sens divergeraient sur exactement les
 *    profils qui n'ont jamais touché à ce réglage.
 *    `neq` reste disponible pour les colonnes `not null` (mesuré : seule
 *    `users.status` en est une ici).
 */
export type OperateurSql = 'eq' | 'neq' | 'neq_ou_null' | 'is_null' | 'not_null'

export type FiltreSql = {
  cible: CibleColonne
  colonne: string
  operateur: OperateurSql
  /** Absent pour `is_null` / `not_null`. */
  valeur?: string | boolean
}

/** Ce qu'une condition a besoin de lire. Structurel : n'importe quelle ligne qui porte ces champs convient. */
export type LigneJugeable = {
  [colonne: string]: unknown
  users?:
    | { [colonne: string]: unknown }
    | Array<{ [colonne: string]: unknown }>
    | null
}

export type ConditionEligibilite = {
  /** Le code rendu quand la condition n'est PAS remplie. */
  raison: string
  portee: PorteeCondition
  filtre: FiltreSql
  /** `true` = la condition est remplie, le profil reste éligible. */
  remplie: (ligne: LigneJugeable) => boolean
  /** La phrase de journal, côté serveur. Jamais affichée à un utilisateur. */
  journal: string
}

/** Lit une colonne, qu'elle vive sur le profil ou sur le compte joint. */
function valeurDe(ligne: LigneJugeable, filtre: FiltreSql): unknown {
  if (filtre.cible === 'profil') return ligne[filtre.colonne]
  const u = Array.isArray(ligne.users) ? (ligne.users[0] ?? null) : (ligne.users ?? null)
  return u ? u[filtre.colonne] : undefined
}

/**
 * LES CONDITIONS, ET IL N'Y EN A PAS D'AUTRE.
 *
 * L'ordre compte : c'est celui dans lequel les raisons sortent, donc celui que
 * l'expert lit. On va du plus corrigeable par lui (son profil) au moins
 * corrigeable (son compte), puis à ce qu'il a choisi (sa disponibilité).
 *
 * ⚠️ LE DOMAINE N'EN FAIT PAS PARTIE, ET C'EST DÉLIBÉRÉ. Le cloisonnement par
 *    écosystème est une règle d'ACCÈS (§D.3), pas d'éligibilité : côté vivier
 *    il se pose sur l'annonce (`domain_id` de l'annonce), côté expert il
 *    n'existe pas — l'expert appartient à un écosystème à vie et ses annonces
 *    sont cherchées dans le sien. Les mêler ferait une condition dont un des
 *    deux sens n'aurait que faire.
 */
export const CONDITIONS_ELIGIBILITE = [
  {
    raison: 'profil_non_visible',
    portee: 'toujours',
    filtre: { cible: 'profil', colonne: 'visible', operateur: 'eq', valeur: true },
    remplie: (l) => l.visible === true,
    journal: 'profil non visible',
  },
  {
    raison: 'cv_non_analyse',
    portee: 'toujours',
    filtre: { cible: 'profil', colonne: 'cv_parsing_status', operateur: 'eq', valeur: 'done' },
    remplie: (l) => l.cv_parsing_status === 'done',
    journal: 'CV non analysé',
  },
  {
    raison: 'consentement_absent',
    portee: 'toujours',
    filtre: { cible: 'profil', colonne: 'ai_consent_at', operateur: 'not_null' },
    remplie: (l) => l.ai_consent_at != null,
    journal: 'consentement IA absent',
  },
  {
    raison: 'profil_non_approuve',
    portee: 'toujours',
    filtre: { cible: 'profil', colonne: 'verification_status', operateur: 'eq', valeur: 'approved' },
    remplie: (l) => l.verification_status === 'approved',
    journal: 'profil non approuvé',
  },
  // ── LE COMPTE, ET C'EST CE QUI MANQUAIT D'UN CÔTÉ ──────────────────────
  {
    // `users.status` est `not null` avec un défaut, et son CHECK admet six
    // valeurs — d'où le `neq` simple : il n'existe aucune ligne NULL à
    // protéger. Mesuré, pas supposé.
    raison: 'compte_suspendu',
    portee: 'toujours',
    filtre: { cible: 'compte', colonne: 'status', operateur: 'neq', valeur: 'suspended' },
    remplie: (l) => valeurDe(l, { cible: 'compte', colonne: 'status', operateur: 'neq' }) !== 'suspended',
    journal: 'compte suspendu',
  },
  {
    raison: 'compte_en_suppression',
    portee: 'toujours',
    filtre: { cible: 'compte', colonne: 'deletion_scheduled_at', operateur: 'is_null' },
    remplie: (l) =>
      valeurDe(l, { cible: 'compte', colonne: 'deletion_scheduled_at', operateur: 'is_null' }) == null,
    journal: 'compte en cours de suppression',
  },
  {
    raison: 'compte_anonymise',
    portee: 'toujours',
    filtre: { cible: 'compte', colonne: 'anonymized_at', operateur: 'is_null' },
    remplie: (l) =>
      valeurDe(l, { cible: 'compte', colonne: 'anonymized_at', operateur: 'is_null' }) == null,
    journal: 'compte anonymisé',
  },
  // ── LA DISPONIBILITÉ, par public ───────────────────────────────────────
  {
    raison: 'ne_pas_deranger',
    portee: 'expert_freelance',
    filtre: {
      cible: 'profil',
      colonne: 'availability_status',
      operateur: 'neq_ou_null',
      valeur: 'do_not_disturb',
    },
    remplie: (l) => l.availability_status !== 'do_not_disturb',
    journal: 'expert en « ne pas déranger »',
  },
  {
    raison: 'non_en_recherche',
    portee: 'expert_cdi',
    filtre: { cible: 'profil', colonne: 'cdi_status', operateur: 'neq_ou_null', valeur: 'employed' },
    remplie: (l) => l.cdi_status !== 'employed',
    journal: 'expert non en recherche',
  },
] as const satisfies readonly ConditionEligibilite[]

/**
 * L'union des raisons — **DÉRIVÉE de la liste**, jamais recopiée.
 *
 * Une seconde écriture de ces neuf valeurs pourrait diverger sans faire échouer
 * la compilation. Ici, ajouter une condition ajoute sa raison au type, et tout
 * `switch` exhaustif qui la lit cesse de compiler tant qu'elle n'est pas
 * traitée.
 */
export type RaisonIneligible = (typeof CONDITIONS_ELIGIBILITE)[number]['raison']

/** Les colonnes de `profiles` qu'il faut charger pour juger. Dérivées, pas listées. */
export const COLONNES_PROFIL: readonly string[] = [
  ...new Set(
    CONDITIONS_ELIGIBILITE.filter((c) => c.filtre.cible === 'profil').map((c) => c.filtre.colonne),
  ),
]

/** Les colonnes de `users` qu'il faut charger pour juger. Dérivées, pas listées. */
export const COLONNES_COMPTE: readonly string[] = [
  ...new Set(
    CONDITIONS_ELIGIBILITE.filter((c) => c.filtre.cible === 'compte').map((c) => c.filtre.colonne),
  ),
]

/** Les conditions qui s'appliquent à ce public : les communes, plus la sienne. */
export function conditionsPour(kind: PublicExpert): readonly ConditionEligibilite[] {
  return CONDITIONS_ELIGIBILITE.filter((c) => c.portee === 'toujours' || c.portee === kind)
}

export type VerdictEligibilite =
  | { ok: true }
  | { ok: false; raison: RaisonIneligible; journal: string }

/**
 * LE JUGEMENT, en mémoire — le SEUL, pour les deux sens.
 *
 * Rend la PREMIÈRE condition non remplie. Une seule raison, pas une liste :
 * l'expert corrige une chose à la fois, et l'écran a une phrase à dire.
 */
export function jugerEligibilite(ligne: LigneJugeable, kind: PublicExpert): VerdictEligibilite {
  for (const c of conditionsPour(kind)) {
    if (!c.remplie(ligne)) {
      return { ok: false, raison: c.raison as RaisonIneligible, journal: c.journal }
    }
  }
  return { ok: true }
}

/**
 * LA FORME SQL, appliquée par l'appelant — qui seul connaît son constructeur.
 *
 * Ce module ne dépend d'aucun client : il DÉCRIT les filtres, il ne les pose
 * pas. L'appelant plie la liste avec cette petite grammaire, et n'a donc
 * aucune occasion d'en écrire un de son cru.
 *
 * Rend, pour chaque condition, l'appel à faire — sous une forme que
 * `pool.ts` traduit en quatre lignes.
 */
export type AppelPostgrest =
  | { methode: 'eq'; colonne: string; valeur: string | boolean }
  | { methode: 'neq'; colonne: string; valeur: string | boolean }
  | { methode: 'is_null'; colonne: string }
  | { methode: 'not_null'; colonne: string }
  /** `colonne.is.null,colonne.neq.valeur` — cf. `neq_ou_null` ci-dessus. */
  | { methode: 'or'; expression: string }

/**
 * Le nom de colonne tel que PostgREST l'attend : préfixé par la relation quand
 * la colonne vit sur le compte.
 */
export function colonneSql(filtre: FiltreSql): string {
  return filtre.cible === 'compte' ? `users.${filtre.colonne}` : filtre.colonne
}

export function appelsPostgrest(kind: PublicExpert, portees: readonly PorteeCondition[]): AppelPostgrest[] {
  const out: AppelPostgrest[] = []
  for (const c of conditionsPour(kind)) {
    if (!portees.includes(c.portee)) continue
    const col = colonneSql(c.filtre)
    switch (c.filtre.operateur) {
      case 'eq':
        out.push({ methode: 'eq', colonne: col, valeur: c.filtre.valeur as string | boolean })
        break
      case 'neq':
        out.push({ methode: 'neq', colonne: col, valeur: c.filtre.valeur as string | boolean })
        break
      case 'neq_ou_null':
        out.push({ methode: 'or', expression: `${col}.is.null,${col}.neq.${String(c.filtre.valeur)}` })
        break
      case 'is_null':
        out.push({ methode: 'is_null', colonne: col })
        break
      case 'not_null':
        out.push({ methode: 'not_null', colonne: col })
        break
    }
  }
  return out
}
