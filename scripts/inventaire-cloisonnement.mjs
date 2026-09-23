// scripts/inventaire-cloisonnement.mjs — L'INVENTAIRE DU CLOISONNEMENT, PARTAGE.
//
// Sorti de diag-ecosystem-scope.mjs le 20/09/2026 pour que la recette 3.3 en
// DERIVE sa matrice au lieu de l'ecrire a la main : une route ajoutee entre dans
// la matrice toute seule — sinon la matrice devient un inventaire nomme de plus
// (§E.34). Le diagnostic continue de garder sa COMPLETUDE (toute route qui touche
// une table cloisonnee est declaree ici, ou il rougit).
//
// Trois objets, trois modes — voir les commentaires de chacun :
//   INVENTORY          routes app/api qui touchent publications / candidatures /
//                      conversations : 'scoped' | 'expert' | 'exempt' ;
//   LIB_INVENTORY      modules lib/ : 'ligne' | 'cle' | 'exempt' ;
//   ROUTES_VIA_MOTEUR  routes qui ne citent aucune table et passent par le moteur.
//
// Et un quatrieme, ajoute pour la recette : ATTENDUS — le mode dit OU la route
// cloisonne, ATTENDUS dit CE QU'ELLE DOIT REPONDRE a chaque population. Le mode
// est garde par le diagnostic ; les attendus sont eprouves par la recette, contre
// une vraie base. `null` = pas encore etabli : la recette l'OBSERVE et le dit,
// elle ne le compte pas vert.
//
// PUR : aucune sortie, aucun process.exit. Importe en relatif avec extension (§E.3).

export const INVENTORY = {
  // ── Organisation : LISTES ──────────────────────────────────────────────
  'publications/route.ts': 'scoped',
  'me/candidatures-org/route.ts': 'scoped',
  'me/badges/route.ts': 'scoped',
  'me/conversations/route.ts': 'scoped',
  // ── Organisation : ACCES PAR IDENTIFIANT ───────────────────────────────
  'publications/[id]/route.ts': 'scoped',
  'publications/[id]/candidatures/route.ts': 'scoped',
  'publications/[id]/close/route.ts': 'scoped',
  'publications/[id]/publish/route.ts': 'scoped',
  'candidatures/[id]/reject/route.ts': 'scoped',
  'candidatures/[id]/select/route.ts': 'scoped',
  'candidatures/[id]/unlock/route.ts': 'scoped',
  // Pitch redige a la demande : elle lit la candidature ET son annonce, donc
  // elle porte le filtre comme les autres acces par identifiant.
  'candidatures/[id]/pitch/route.ts': 'scoped',
  'me/candidatures/[id]/view/route.ts': 'scoped',

  // ── Surfaces EXPERT ────────────────────────────────────────────────────
  // Un expert est lie a UN ecosysteme a vie : son ecosysteme actif est
  // toujours celui de son compte. La garde d'appartenance (profil, match)
  // cloisonne donc deja, et le moteur de mise en relation ne cree de match qu'a
  // l'interieur d'un ecosysteme.
  //
  // OU CELA SE JOUE, ET L'ADRESSE A CHANGE : le cloisonnement du moteur vivait
  // dans lib/matching/shared.ts ; depuis la reecriture du moteur il est porte
  // par lib/matching/pool.ts (sens annonce -> experts) et
  // lib/matching/run-for-expert.ts (sens inverse). Le fait n'a pas bouge,
  // l'adresse si — et une adresse perimee envoie le prochain lecteur verifier
  // au mauvais endroit. Ces deux modules sont desormais DECLARES ci-dessous
  // (LIB_INVENTORY), et leur filtre est verifie, plus seulement affirme.
  'me/missions/[id]/route.ts': 'expert',
  'me/candidatures/route.ts': 'expert',
  'me/collaboration/quota/route.ts': 'expert',
  // Depot de candidature par l'expert : la candidature herite du domain_id du
  // PROFIL, donc de l'ecosysteme unique de l'expert.
  //
  // ⚠️ L'ADRESSE A CHANGE LE 23/09/2026, ET L'ENTREE RESTE. La route est
  //    devenue une COQUILLE : elle authentifie, resout le profil de l'appelant,
  //    et delegue a `lib/candidatures/depot.ts` — declare ci-dessous en 'cle' —
  //    parce que le bouton RELANCER du back-office doit rejouer EXACTEMENT ce
  //    chemin (§E.20).
  //    Elle ne cite donc plus aucune table cloisonnee, et elle reste POURTANT
  //    dans cet inventaire : c'est la recette 3.3 qui itere dessus, et l'en
  //    retirer aurait cesse d'eprouver le depot contre une vraie base — une
  //    perte de couverture deguisee en nettoyage (§E.62).
  'candidatures/route.ts': 'expert',

  // ── Conversation : deux cotes ──────────────────────────────────────────
  // La conversation est atteinte par la candidature, elle-meme deja
  // cloisonnee des deux cotes (org via l'annonce, expert via son profil).
  // Un filtre ici serait redondant sans rien ajouter.
  'conversations/[id]/messages/route.ts': 'exempt',
}

// ─── L'INVENTAIRE DES MODULES `lib/` ─────────────────────────────────────────
//
// POURQUOI IL A FALLU L'AJOUTER
//   Le balayage ne regardait que `app/api/**`. Or la moitie des requetes sur les
//   tables cloisonnees vit dans `lib/` : le moteur de mise en relation, le flux
//   expert, le depechage des notifications, le devoilement. Ce diagnostic etait
//   donc VERT pour ces chemins-la — non parce qu'ils etaient conformes, mais
//   parce qu'il ne regardait pas ou ils sont.
//
//   Un angle mort dans le controle qui defend le cloisonnement est plus
//   dangereux que l'absence de controle : il donne une assurance.
//
// LES DEUX MODES, ET LA DIFFERENCE EST REELLE
//   'ligne' : le module lit une LISTE d'une table cloisonnee. Il porte donc
//             lui-meme le filtre, pris sur le `domain_id` de la ligne PIVOT
//             (l'annonce, le profil) et non sur le contexte d'appel — un moteur
//             declenche par une tache planifiee n'a aucun contexte d'appel.
//             VERIFIE : le fichier doit contenir un `.eq('domain_id', …)`.
//
//   'cle'   : le module ne lit QUE par identifiants fournis par l'appelant
//             (`id`, `publication_id`, `candidature_id`, `profile_id`), deja
//             cloisonnes en amont. Y poser un filtre d'ecosysteme serait
//             redondant, et surtout exigerait un contexte que le module n'a pas.
//             VERIFIE : chaque lecture d'une table cloisonnee est clavetee.
export const LIB_INVENTORY = {
  // ── Moteur de mise en relation ─────────────────────────────────────────
  // Il lit UNE annonce par identifiant ; tout le reste du run derive de son
  // `domain_id`. C'est le pivot, et il n'y en a qu'un.
  'lib/matching/index.ts': 'cle',
  // Le vivier, lui, est une LISTE : il porte le filtre.
  'lib/matching/pool.ts': 'ligne',
  // Le sens inverse liste des ANNONCES pour un expert : meme obligation.
  'lib/matching/run-for-expert.ts': 'ligne',
  // La reconciliation ne lit que le scope qu'on lui fixe (une annonce ou un
  // profil), jamais une liste libre.
  'lib/matching/reconcile.ts': 'cle',

  // ── Flux et surfaces expert ────────────────────────────────────────────
  // Part de `matches` claveté sur le profil, et joint l'annonce. Un expert est
  // mono-ecosysteme a vie : la cle porte le cloisonnement.
  'lib/missions/feed.ts': 'cle',

  // ── Surfaces organisation ──────────────────────────────────────────────
  // Recoit des identifiants d'annonces deja filtres par la route appelante.
  'lib/candidature-org-dto.ts': 'cle',
  'lib/candidatures/lifecycle-batch.ts': 'cle',
  'lib/unlock.ts': 'cle',

  // ── Administration plateforme ──────────────────────────────────────────
  // Comptage d'usage d'une BRANCHE — pour l'ecran ET pour la barriere de
  // suppression, par la meme lecture (§E.36). Il est cleve sur une branche
  // dont l'appelant a deja resolu l'ecosysteme, et sa seule surface est
  // l'administration PLATEFORME, qui voit tous les ecosystemes par
  // construction (§D.3 : admin -> scope 'platform').
  // Ce sont trois COMPTAGES (`head: true`) clavetes sur `branch_id`, pas un
  // acces par cle primaire : le controle a raison de refuser 'cle'. Et ils ne
  // portent pas de filtre `domain_id` — ils n'en ont pas besoin et ne doivent
  // pas en porter : la seule surface est l'administration PLATEFORME, dont le
  // scope est 'platform' par construction (§D.3), et la branche elle-meme
  // appartient a UN ecosysteme que l'appelant a deja resolu. Un filtre ici
  // masquerait des usages reels et ferait supprimer une branche utilisee.
  'lib/admin/usage-branche.ts': 'exempt',

  // ── Notifications ──────────────────────────────────────────────────────
  // Ne lit que les entites citees par des notifications deja destinees a un
  // utilisateur precis.
  'lib/notifications/dispatch.ts': 'cle',

  // ── Depot de candidature ───────────────────────────────────────────────
  // LE chemin de depot, partage par la route de l'expert et par le bouton
  // RELANCER du back-office. Toutes ses lectures sont clavetees : l'annonce
  // par son id, le match et la candidature existante par le couple
  // (publication_id, profile_id), le plafond de devoilement et le departage
  // par publication_id. Aucune liste libre, donc aucun filtre `domain_id` a
  // porter — et la candidature ecrite herite du `domain_id` du PROFIL.
  'lib/candidatures/depot.ts': 'cle',
}

// ─── LES ROUTES QUI PASSENT PAR UN MODULE `ligne` ────────────────────────────
//
// Elles ne citent AUCUNE table cloisonnee : elles confient un identifiant au
// moteur, qui se cloisonne par la ligne. Invisibles au balayage textuel, elles
// sont pourtant le chemin par lequel des dizaines de milliers de lignes sont
// lues. Elles sont donc declarees ICI, explicitement.
export const ROUTES_VIA_MOTEUR = {
  // Tache planifiee : aucun contexte d'appel, donc aucun ecosysteme actif. Le
  // cloisonnement ne PEUT venir que de la ligne.
  'cron/match-retry/route.ts': 'moteur',
  // Relance d'un expert arrivee a echeance : meme absence de contexte d'appel,
  // donc meme cloisonnement par la ligne (le domain_id du profil).
  'cron/expert-relance/route.ts': 'moteur',
  // Declencheurs cote expert : l'expert est mono-ecosysteme a vie.
  'me/sync-matching/route.ts': 'moteur',
  'profile/cdi-upload-cv/route.ts': 'moteur',
  'profile/upload-cv/route.ts': 'moteur',
  // Enregistrement du profil : il ne cite aucune table cloisonnee, et pourtant
  // il declenche le moteur dans un after(). C'est precisement la route que le
  // balayage textuel ne pouvait pas voir.
  'profile/route.ts': 'moteur',
}

// ─── LES ATTENDUS DE LA RECETTE 3.3 ──────────────────────────────────────────
//
// Le mode dit OÙ la route cloisonne ; ATTENDUS dit CE QU'ELLE DOIT RÉPONDRE à
// chaque population, dérivé des GARDES que la route appelle (lues dans le code,
// pas supposées) et de §D.3 :
//   · anonyme                → 401 partout (requireAuth) ;
//   · requireOrgRole(…)      → expert 403 (org_required), admin 403 (aucune
//                              organisation), organisation 2xx ;
//   · accès par identifiant  → un objet d'une AUTRE organisation ou d'un autre
//                              écosystème est INTROUVABLE (404, jamais 403 —
//                              « il existe ailleurs » serait déjà une fuite) ;
//   · un expert est mono-écosystème à vie : hors du sien, toujours 403.
//
// Vocabulaire des attendus :
//   401 / 403 / 404 / '2xx'  — exact, ou toute réponse 2xx ;
//   'refus'                  — 401, 403 ou 404 indifféremment (le refus est le
//                              fait ; le statut exact se lit dans la route) ;
//   'metier'                 — pas un refus de DROIT (2xx, ou un 4xx métier) ;
//   'parcours'               — action À EFFET (clôturer, refuser, dévoiler,
//                              publier, appeler l'IA) : prouvée UNE fois dans le
//                              parcours, jamais rejouée dans la matrice — la
//                              rejouer détruirait les fixtures des cellules
//                              suivantes ;
//   null                     — PAS ENCORE ÉTABLI : la recette l'observe et le
//                              dit, elle ne le compte pas. À promouvoir après la
//                              première séance contre une vraie base.
//
// ⚠️ Écrit le 20/09/2026 SANS avoir tourné contre une base (§E.12). Les valeurs
//    exactes sont des lectures du code ; la première exécution les éprouvera.
export const POPULATIONS = ['anonyme', 'expert_freelance', 'expert_cdi', 'client', 'cabinet', 'admin']

const R = 'refus'
export const ATTENDUS = {
  // ── Organisation : LISTES ──────────────────────────────────────────────
  'publications/route.ts':            { verbe: 'GET', cible: null, query: '?locale=fr', attendus: { anonyme: 401, expert_freelance: 403, expert_cdi: 403, client: '2xx', cabinet: '2xx', admin: 403 }, eco_autre: '2xx' },
  'me/candidatures-org/route.ts':     { verbe: 'GET', cible: null, query: '?locale=fr&filter=all', attendus: { anonyme: 401, expert_freelance: 403, expert_cdi: 403, client: '2xx', cabinet: '2xx', admin: 403 }, eco_autre: '2xx' },
  'me/badges/route.ts':               { verbe: 'GET', cible: null, attendus: { anonyme: 401, expert_freelance: '2xx', expert_cdi: '2xx', client: '2xx', cabinet: '2xx', admin: null }, eco_autre: '2xx' },
  'me/conversations/route.ts':        { verbe: 'GET', cible: null, query: '?locale=fr', attendus: { anonyme: 401, expert_freelance: '2xx', expert_cdi: '2xx', client: '2xx', cabinet: '2xx', admin: null }, eco_autre: '2xx' },
  // ── Organisation : ACCÈS PAR IDENTIFIANT (l'annonce appartient au client) ─
  'publications/[id]/route.ts':               { verbe: 'GET', cible: 'publication', query: '?locale=fr', attendus: { anonyme: 401, expert_freelance: 403, expert_cdi: 403, client: '2xx', cabinet: R, admin: 403 }, eco_autre: 404 },
  'publications/[id]/candidatures/route.ts':  { verbe: 'GET', cible: 'publication', query: '?locale=fr&filter=all', attendus: { anonyme: 401, expert_freelance: 403, expert_cdi: 403, client: '2xx', cabinet: R, admin: 403 }, eco_autre: 404 },
  'publications/[id]/close/route.ts':         { verbe: 'POST', cible: 'publication', attendus: { anonyme: 401, expert_freelance: 403, expert_cdi: 403, client: 'parcours', cabinet: R, admin: 403 }, eco_autre: 404 },
  'publications/[id]/publish/route.ts':       { verbe: 'POST', cible: 'publication', attendus: { anonyme: 401, expert_freelance: 403, expert_cdi: 403, client: 'parcours', cabinet: R, admin: 403 }, eco_autre: 404 },
  'candidatures/[id]/reject/route.ts':        { verbe: 'POST', cible: 'candidature', corps: { reason: 'recette' }, attendus: { anonyme: 401, expert_freelance: 403, expert_cdi: 403, client: 'parcours', cabinet: R, admin: 403 }, eco_autre: 404 },
  'candidatures/[id]/select/route.ts':        { verbe: 'POST', cible: 'candidature', attendus: { anonyme: 401, expert_freelance: 403, expert_cdi: 403, client: 'parcours', cabinet: R, admin: 403 }, eco_autre: 404 },
  'candidatures/[id]/unlock/route.ts':        { verbe: 'POST', cible: 'candidature', attendus: { anonyme: 401, expert_freelance: 403, expert_cdi: 403, client: 'parcours', cabinet: R, admin: 403 }, eco_autre: 404 },
  // Le pitch APPELLE L'IA : jamais rejoué pour l'organisation propriétaire.
  'candidatures/[id]/pitch/route.ts':         { verbe: 'POST', cible: 'candidature', query: '?locale=fr', attendus: { anonyme: 401, expert_freelance: 403, expert_cdi: 403, client: 'parcours', cabinet: R, admin: 403 }, eco_autre: 404 },
  // L'expert marque SA candidature comme vue : sans effet destructeur.
  'me/candidatures/[id]/view/route.ts':       { verbe: 'POST', cible: 'candidature', attendus: { anonyme: 401, expert_freelance: 'metier', expert_cdi: R, client: R, cabinet: R, admin: R }, eco_autre: null },
  // ── Surfaces EXPERT ────────────────────────────────────────────────────
  'me/missions/[id]/route.ts':        { verbe: 'GET', cible: 'mission', query: '?locale=fr', attendus: { anonyme: 401, expert_freelance: '2xx', expert_cdi: R, client: R, cabinet: R, admin: R }, eco_autre: null },
  'me/candidatures/route.ts':         { verbe: 'GET', cible: null, query: '?locale=fr&filter=all', attendus: { anonyme: 401, expert_freelance: '2xx', expert_cdi: '2xx', client: null, cabinet: null, admin: null }, eco_autre: null },
  // expertProfileGate : 403 profile_not_verified tant que l'expert n'est pas approuvé — d'où null, à établir.
  'me/collaboration/quota/route.ts':  { verbe: 'GET', cible: null, attendus: { anonyme: 401, expert_freelance: null, expert_cdi: null, client: 403, cabinet: 403, admin: 403 }, eco_autre: null },
  // Le dépôt exige un MATCH : sans match, 403 not_matched — un refus, pas un droit ouvert.
  'candidatures/route.ts':            { verbe: 'POST', cible: 'publication_corps', corps: null, attendus: { anonyme: 401, expert_freelance: 'parcours', expert_cdi: R, client: 403, cabinet: 403, admin: 403 }, eco_autre: null },
  // ── Conversation : deux côtés — mode 'exempt', cloisonnée par la candidature ─
  'conversations/[id]/messages/route.ts': { verbe: 'GET', cible: 'conversation', attendus: { anonyme: 401, expert_freelance: '2xx', expert_cdi: R, client: '2xx', cabinet: R, admin: R }, eco_autre: null },
}
