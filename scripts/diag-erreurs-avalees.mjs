// scripts/diag-erreurs-avalees.mjs — CLIQUET sur les erreurs de requête
// converties en « pas de résultat ».
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE SCRIPT
//   La vérification expert échouait depuis la migration, et personne ne le
//   savait : sa requête citait une colonne supprimée, PostgREST rendait une
//   erreur, le code la transformait en `null`, et l'appelant concluait
//   « profil introuvable ». Le profil existait pourtant.
//
//   Le motif n'est pas propre à ce fichier. Chaque fois qu'une erreur de
//   requête devient une ABSENCE DE DONNÉE, on remplace une panne bruyante par
//   un comportement plausible et faux — le pire des deux mondes, parce que
//   personne ne cherche.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUI A CHANGÉ, ET POURQUOI — il était une CARTE, il est un CLIQUET
//
//   Pendant des mois ce script RECENSAIT et rendait 0. Son propre en-tête le
//   disait : « ni un contrôle qui échoue, ni un cliquet ». Une carte ne ferme
//   aucune porte, et **personne ne sait depuis quand elle n'a pas été relue**.
//   Il balayait en outre `app/` + `lib/` seulement, alors que §E.15 avait déjà
//   montré qu'un composant client porte parfaitement une règle serveur.
//
//   CE QUE LE BALAYAGE A TROUVÉ EN S'ÉTENDANT À `components/` : trois requêtes,
//   dans deux fichiers, et les deux consequences étaient pires que « une erreur
//   non journalisée ».
//     · `DashboardShell` — une panne rendait `null`, le shell en tirait un
//       badge « non vérifié » ET un VERROU de navigation. Un utilisateur
//       approuvé se voyait refuser une entrée de menu parce qu'une requête
//       avait échoué. Aggravant : ce chargement est RELANCÉ sur deux événements,
//       donc une panne au refetch EFFAÇAIT un état déjà bon.
//     · `SettingsView` — même motif, mais le chargement est passé en `reload` à
//       deux sections : il est rappelé APRÈS UN ENREGISTREMENT RÉUSSI. Une
//       panne à cet instant vidait l'écran juste après un « enregistré ».
//
//   SON MOTIF AVAIT DEUX TROUS, mesurés en écrivant ce lot. Il exigeait
//   `const { … } = await <objet>.` — une déstructuration OBJET. Lui échappaient :
//     ①-bis  const [{ data: a }, { data: b }] = await Promise.all([ sb…, sb… ])
//     ①-ter  const [aRes, bRes]               = await Promise.all([ sb…, sb… ])
//            puis `aRes.data` lu plus loin, et `aRes.error` JAMAIS.
//   C'est la forme qui manquait DashboardShell — donc le trou couvrait
//   exactement le défaut que l'extension venait de révéler.
//
//   ⚠️ Un `Promise.all` d'AUXILIAIRES (`peek(...)`, `countByDomain(...)`) n'est
//      PAS de cette classe : son erreur vit dans l'auxiliaire, pas ici. Les
//      confondre ferait crier à tort — donc désactiver le contrôle le jour même.
//      D'où la condition : le motif du tableau doit lui-même porter `data`, ou
//      lier un résultat dont `.error` est consultable.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LES CINQ FORMES, PAR GRAVITÉ DÉCROISSANTE
//
//   ①     ERREUR NON LUE      `const { data } = await supabase...`
//         L'erreur n'est même pas récupérée. Une requête peut échouer
//         intégralement sans qu'une seule ligne de code s'en aperçoive.
//   ①-bis IDEM, EN TABLEAU    `const [{ data: a }] = await Promise.all([...])`
//   ①-ter RÉSULTAT LIÉ ENTIER `const [aRes] = await Promise.all([...])`, puis
//         `aRes.data` lu et `aRes.error` jamais.
//   ②     ERREUR IGNORÉE      récupérée, puis oubliée : le pire à lire, car le
//         code a l'air prudent.
//   ③     ERREUR CONVERTIE    `if (error) { … return null | [] | false }`
//         Souvent DÉLIBÉRÉ et légitime. Ce n'est pas une liste de bugs : c'est
//         une liste d'endroits où il faut avoir DÉCIDÉ, et où le message doit
//         dire « la requête a échoué », jamais « il n'y a rien ».
//
// ⚠️ CE SCRIPT LIT UN MOTIF, PAS UNE INTENTION — et la nuance a déjà coûté un
//    faux signalement. `countOtherAvailablePlatformAdmins` apparaît en forme ③
//    et j'en avais fait un cas prioritaire. Vérification faite, c'est l'inverse :
//    son `null` est documenté, VOULU, et ses deux appelants l'honorent avec des
//    replis opposés adaptés à la réversibilité de leur action.
//    UN MOTIF N'EST PAS UN DÉFAUT. Chaque ligne demande la même lecture.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE CLIQUET, ET POURQUOI IL A **DEUX** LISTES ET PAS UNE
//
//   §G.8 : un cliquet fige un inventaire, il ne le JUGE pas. Le lot 1.3 l'a
//   payé — trois lignes gelées « parce qu'elles ressemblaient aux autres », et
//   l'une d'elles écrivait en base un motif faux sous les yeux de l'admin.
//
//   Geler 168 emplacements d'un coup les déclarerait tous légitimes SANS LES
//   AVOIR LUS : ce serait refaire l'erreur, en dix fois plus gros. D'où deux
//   listes qui ne disent PAS la même chose :
//
//     JUGÉS   — lus un par un, avec leur raison écrite. Une entrée sans raison
//               n'a rien à faire ici : « une liste sans raisons devient un
//               tampon qu'on remplit sans lire » (diag-lire-comparer-ecrire).
//     À JUGER — COMPTÉS, pas lus. Le mot est choisi : cette liste ne déclare
//               rien légitime. Elle dit combien il reste à ouvrir, et elle ne
//               peut que DÉCROÎTRE.
//
//   Le cliquet refuse toute occurrence NEUVE (rouge, sortie 1). Le reliquat
//   à juger est BRUYANT mais VERT : un contrôle durablement rouge est un
//   contrôle qu'on apprend à ignorer (§E.14), et celui-là doit survivre aux
//   trois lots qu'il faudra pour le vider.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-erreurs-avalees.mjs           → le décompte + le cliquet
//   node scripts/diag-erreurs-avalees.mjs --detail  → chaque emplacement
//   node scripts/diag-erreurs-avalees.mjs --gel     → régénère la liste À JUGER
//
// AUCUN accès base, AUCUN réseau. 0 = vert · 1 = rouge.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { estObjetIntrouvable } from '../lib/avatar.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// §E.15 : `components/` n'est pas décoratif — c'est là que le lot a trouvé les
// deux consequences les plus graves de la classe.
const RACINES = ['app', 'lib', 'components']

const fichiers = []
const parcourir = (d) => {
  for (const e of readdirSync(d)) {
    if (e === 'node_modules' || e === '.next') continue
    const p = join(d, e)
    if (statSync(p).isDirectory()) parcourir(p)
    else if (/\.(ts|tsx)$/.test(e)) fichiers.push(p)
  }
}
for (const r of RACINES) parcourir(join(ROOT, r))

/** Une déstructuration OBJET d'un résultat Supabase, sur une ou plusieurs lignes. */
const DESTRUCTURATION = /const\s*\{([^}]*)\}\s*=\s*await\s+([A-Za-z_$][\w$.]*)\s*\n?\s*\./g

/** Une déstructuration en TABLEAU sur `Promise.all` — les deux trous mesurés. */
const TABLEAU = /const\s*\[([\s\S]{0,500}?)\]\s*=\s*await\s+Promise\.all\(([\s\S]{0,1500}?)\n\s*\]\s*\)/g

/**
 * Ce qui a le droit de se trouver entre les crochets d'une DÉSTRUCTURATION.
 *
 * ⚠️ SANS CE FILTRE, `TABLEAU` PART DU MAUVAIS `const [`. Son corps
 *    `[\s\S]{0,500}?` traverse les sauts de ligne : il accroche le premier
 *    `const [` qui parvient, en moins de 500 caractères, à atteindre un
 *    `] = await Promise.all`. Dans `DashboardShell.tsx`, c'était
 *    `const [user, setUser] = useState(...)` — DIX-SEPT LIGNES PLUS HAUT que le
 *    `Promise.all` visé, avec un `useEffect` entier avalé au passage.
 *
 *    ET C'EST MA PROPRE CORRECTION QUI L'A RÉVÉLÉ : tant que les commentaires
 *    comptaient, les dix lignes de prose entre les deux faisaient dépasser les
 *    500 caractères et rien ne matchait. Le trou était là depuis le premier
 *    jour ; il était masqué par un défaut du même script.
 *
 *    La parade est un motif POSITIF, pas une liste d'exclusions : un motif de
 *    liaison ne contient QUE des identifiants, des virgules, des accolades, des
 *    deux-points et des espaces. Ni `(`, ni `=`, ni `<` — donc ni appel, ni
 *    affectation, ni générique. Conséquence assumée et mesurée : une valeur par
 *    défaut (`const [a = 1] = …`) sortirait du recensement ; le dépôt n'en
 *    porte aucune sur un `Promise.all`.
 */
const MOTIF_DE_LIAISON = /^[\w$\s,{}:.[\]]*$/

/**
 * Le corps autour d'une position — 25 lignes DE CODE, pas 25 lignes du fichier.
 *
 * ⚠️ RETIRER LES COMMENTAIRES NE SUFFISAIT PAS. Ils sont remplacés par des
 *    lignes VIDES (pour que les numéros rapportés restent ceux du fichier
 *    réel), si bien qu'une fenêtre comptée en lignes restait remplie de vide.
 *    `loadOrganizationContext` relit son erreur 28 lignes plus bas, dont
 *    dix-neuf de commentaire : la fenêtre contenait SIX lignes de code, et le
 *    site le mieux documenté du dépôt passait pour « erreur ignorée ».
 *    On compte donc les lignes NON VIDES — la distance qui compte est celle du
 *    code, pas celle du fichier.
 */
/**
 * LA FENETRE NE MESURE PAS CE QU ON CROYAIT, ET LA MESURE L A IMPOSE.
 *
 * On l attendait comme un cadran de DETECTION : plus large, plus de prises.
 * Mesure, sur les six reglages 15 / 20 / 25 / 30 / 40 / 50 :
 *
 *     15 → 106     20 → 98     25 → 96     30 → 95     40 → 93     50 → 91
 *
 * Elle fait L INVERSE. L elargir RETIRE des emplacements, et les dix qui
 * entrent a 15 comme les cinq qui sortent a 50 sont TOUS de la forme ②
 * (« recuperee puis jamais relue »). C est mecanique : la forme ② cherche
 * une RELECTURE ; une fenetre trop courte ne la voit pas et ACCUSE du code
 * qui traite parfaitement son erreur. La fenetre est un cadran de FAUX
 * POSITIFS, pas de detection.
 *
 * LES CINQ, LUS UN PAR UN — les cinq que 50 faisait sortir :
 *   publications:301      `insertErr` relu +26 lignes → 500. Le `.insert({…})`
 *                         fait 26 lignes : la relecture tombait dehors.
 *   upload-cv:347         `finalErr` relu +33 lignes. Le `.update({…})` en
 *                         fait 32.
 *   cdi-upload-cv:111     `profileErr` relu +41 lignes. Le `.select([…])`
 *                         enumere 40 colonnes.
 *   cdi-upload-cv:415     `finalErr` relu +44 lignes.
 *   cv/reset:76           `updErr` relu +50 lignes → 500. Le `.update({…})`
 *                         efface 46 colonnes.
 *
 * LES CINQ SONT DES FAUX POSITIFS. Ce qui les separe de leur relecture n est
 * pas du code qui oublie : c est une LISTE DE COLONNES. Un recensement qui
 * compte les lignes d une charge utile comme de la distance accuse les
 * routes qui ecrivent le plus de champs — exactement celles qui comptent.
 *
 * LE REGLAGE, DONC, N EST PAS UN NOMBRE. La question « l erreur est-elle
 * traitee ? » se pose sur TOUT LE RESTE DU FICHIER — et c est deja la regle
 * que la forme ①-ter applique vingt lignes plus bas, dans ce meme script.
 * La fenetre ne sert plus qu a la forme ③, qui cherche un `if` LOCAL :
 * « est-ce traite ? » est une question de PORTEE, « comment est-ce traite ? »
 * une question de VOISINAGE. Les deux ne se bornent pas pareil.
 *
 * ⚠️ ET CE QUE CE REGLAGE COUTE SE DIT (§E.38) : une erreur dont le nom est
 *    reutilise plus loin dans le fichier pour une AUTRE requete passe
 *    desormais pour relue. C est le prix de la portee, il est assume, et la
 *    forme ② est eprouvee par mutation dans diag-echec-silencieux.
 */
function fenetre(src, pos, lignesDeCode = 25) {
  const suite = src.slice(pos).split('\n')
  const gardees = []
  let vues = 0
  for (const l of suite) {
    gardees.push(l)
    if (l.trim() !== '') vues++
    if (vues >= lignesDeCode) break
  }
  return gardees.join('\n')
}

const RETOUR_MUET = /return\s+(null|\[\]|false|undefined|\{\s*\}|0)\b/

const trouvailles = []

for (const f of fichiers) {
  // ⚠️ LES COMMENTAIRES SONT RETIRES AVANT DETECTION — ET LE MOTIF EN AVAIT
  //    BESOIN POUR UNE RAISON QUI SE LIT COMME UNE BLAGUE.
  //
  //    `loadOrganizationContext` (lib/auth-guard.ts) RELIT bien son `memberErr`
  //    — 28 lignes plus bas. Entre les deux : DIX-NEUF LIGNES DE COMMENTAIRE
  //    qui expliquent §E.18 et la classe que ce recensement existe pour
  //    trouver. La fenetre de 25 lignes ne contenait donc que SIX lignes de
  //    code, la relecture tombait dehors, et le site le mieux documente du
  //    depot etait compte comme « erreur ignoree ».
  //
  //    C'est §E.7 A L'ENVERS : d'habitude un controle est trompe par un
  //    anti-pattern ECRIT dans un commentaire ; ici il est trompe par la
  //    DOCUMENTATION DU CORRECTIF. Meme parade : on lit le CODE.
  //
  //    Les lignes sont PRESERVEES (un commentaire devient une ligne vide) : les
  //    numeros rapportes restent ceux du fichier reel, sinon tout le
  //    recensement designerait des lignes fausses.
  const src = readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l))
    .join('\n')
  const rel = relative(ROOT, f).replace(/\\/g, '/')

  // ─── Formes ①, ② et ③ : la déstructuration objet ──────────────────────────
  for (const m of src.matchAll(DESTRUCTURATION)) {
    const champs = m[1]
    const objet = m[2]
    if (!/supabase|admin|client|db/i.test(objet)) continue

    const ligne = src.slice(0, m.index).split('\n').length
    const suite = fenetre(src, m.index)
    const alias = /\berror\s*:\s*([A-Za-z_$][\w$]*)/.exec(champs)?.[1]
    const nomErreur = alias ?? (/\berror\b/.test(champs) ? 'error' : null)

    if (!nomErreur) {
      trouvailles.push({ rel, ligne, forme: 'non lue', extrait: m[0].replace(/\s+/g, ' ').slice(0, 80) })
      continue
    }

    const apres = suite.slice(m[0].length)
    // PORTEE, pas voisinage : cf. l en-tete de `fenetre()`. Meme regle que
    // la forme ①-ter plus bas, qui lit deja tout le reste du fichier.
    const relue = new RegExp(`\\b${nomErreur}\\b`).test(src.slice(m.index + m[0].length))
    if (!relue) {
      trouvailles.push({ rel, ligne, forme: 'ignorée', extrait: `{ …, ${nomErreur} } jamais relu` })
      continue
    }

    const bloc = new RegExp(`if\\s*\\(\\s*!?${nomErreur}[\\s\\S]{0,300}?\\}`).exec(apres)?.[0] ?? ''
    if (RETOUR_MUET.test(bloc) && !/throw/.test(bloc)) {
      trouvailles.push({ rel, ligne, forme: 'convertie', extrait: bloc.replace(/\s+/g, ' ').slice(0, 90) })
    }
  }

  // ─── Formes ①-bis et ①-ter : la déstructuration en tableau ────────────────
  for (const m of src.matchAll(TABLEAU)) {
    const champs = m[1]
    const corps = m[2]
    // Les crochets doivent porter un MOTIF DE LIAISON, pas dix-sept lignes de
    // code qu'une regex trop large a traversées (cf. MOTIF_DE_LIAISON).
    if (!MOTIF_DE_LIAISON.test(champs)) continue
    // Le tableau doit contenir de VRAIES requêtes, pas des auxiliaires.
    if (!/supabase|supabaseAdmin/i.test(corps)) continue
    const ligne = src.slice(0, m.index).split('\n').length

    if (/\{/.test(champs)) {
      // ①-bis : motif objet DANS le tableau. Il doit porter `data` — sans quoi
      // ce n'est pas un résultat Supabase qu'on déstructure.
      if (!/\bdata\b/.test(champs)) continue
      if (/\berror\b/.test(champs)) continue
      trouvailles.push({
        rel, ligne, forme: 'non lue (tableau)',
        extrait: `const [${champs.replace(/\s+/g, ' ').slice(0, 60)}…] = await Promise.all`,
      })
      continue
    }

    // ①-ter : le résultat ENTIER est lié à un nom. `.error` est-il lu ensuite ?
    const noms = champs.split(',').map((x) => x.trim()).filter((x) => /^[A-Za-z_$][\w$]*$/.test(x))
    const apres = src.slice(m.index + m[0].length)
    const muets = noms.filter((n) => !new RegExp(`\\b${n}\\.error\\b`).test(apres))
    // Un nom dont on ne lit NI `.data` NI `.error` n'est pas un résultat de
    // requête : on ne l'invente pas.
    const reels = muets.filter((n) => new RegExp(`\\b${n}\\.data\\b`).test(apres))
    if (reels.length === 0) continue
    trouvailles.push({
      rel, ligne, forme: 'liée sans erreur',
      extrait: `${reels.length}/${noms.length} lien(s) dont .error n'est jamais lu : ${reels.join(', ')}`,
    })
  }
}

const par = (forme) => trouvailles.filter((t) => t.forme === forme)

// ═══════════════════════════════════════════════════════════════════════════
// LE GEL — deux listes, et elles ne disent pas la même chose
// ═══════════════════════════════════════════════════════════════════════════

/**
 * JUGÉS — lus un par un, avec leur RAISON. Une entrée sans raison n'a rien à
 * faire ici : ce serait §G.8 rouvert.
 *
 * ⚠️ « JUGÉ » NE VEUT PAS DIRE « LÉGITIME ». IL VEUT DIRE **LU**.
 *
 *    C'est la distinction que le lot 4.1d a dû introduire, et elle manquait.
 *    Jusque-là cette liste ne contenait que des emplacements sains, et le mot
 *    « jugé » s'était mis à vouloir dire « acquitté ». Trente-sept
 *    emplacements ont été ouverts au lot 4.1d ; **quinze mentent**, et ils
 *    sont ici — avec leur mécanisme, leur conséquence et leur RANG — parce
 *    qu'ils sortent du périmètre des huit corrections ordonnées.
 *
 *    Les laisser en `A_JUGER` aurait dit « pas encore regardés », ce qui est
 *    faux. Les corriger sans arbitrage aurait élargi le lot tout seul, ce qui
 *    est la faute inverse de celle qu'on ferme. Chaque raison commence donc
 *    par **LÉGITIME** ou par **DÉFAUT NOMMÉ, NON CORRIGÉ (rang N)**.
 *
 *    Le rang 1 est `app/api/profile/route.ts:671` : une lecture en panne
 *    **écrit en base** et dégrade un expert vérifié.
 */
const JUGES = {
  // ══════════════════════════════════════════════════════════════════════════
  // LOT 4.1b — les 45 emplacements de `lib/` et `app/[locale]`, ouverts un par
  // un. 29 mentaient et sont corrigés (ils ont quitté le recensement). Les 16
  // ci-dessous sont LÉGITIMES, et chacun porte SA raison — jamais une raison
  // collective : « une liste sans raisons devient un tampon qu'on remplit sans
  // lire » (§G.8).
  //
  // ⚠️ ET LA FORME ③ EST UNE CARTE PAR CONSTRUCTION. Elle cherche
  //    `if (error) { … return null }` — c'est EXACTEMENT la forme du correctif,
  //    un `null` qui veut dire « je ne sais pas ». Le motif ne peut pas
  //    distinguer la parade de ce qu'elle répare. Ce n'est pas un réglage à
  //    affiner : c'est la limite du procédé, et c'est pourquoi le verdict se
  //    rend en lisant l'APPELANT, jamais en lisant le motif.
  // ══════════════════════════════════════════════════════════════════════════

  // ── LA PARADE, PRISE POUR LE DÉFAUT (forme ③) ────────────────────────────
  'app/api/admin/user-purge/route.ts': {
    total: 1,
    raison:
      "`organizationsLeftWithoutAdmin` rend `null` = « je ne sais pas », JAMAIS `[]`. " +
      "C'est le correctif du cas ② de §E.22 : sur `[]`, la barrière d'acquittement " +
      "`acknowledge_org_lockout` sautait en silence sur la seule action irréversible du " +
      "back-office. L'appelant REFUSE sur `null`. Relu le 19/09/2026.",
  },
  'lib/org-members.ts': {
    total: 2,
    raison:
      "`activeAdminCountOrUnknown` rend `null` = compte inconnu, sur ses DEUX lectures " +
      "(lignes d'appartenance, puis comptes encore joignables). Les deux journalisent. " +
      "`countActiveAdmins` n'est qu'une façade qui applique le repli prudent pour ses trois " +
      "appelants RÉVERSIBLES ; un appelant définitif ne consomme jamais ce repli (§E.22 règle 3). " +
      "Relu le 19/09/2026.",
  },
  'lib/admin/user-actions-guard.ts': {
    total: 1,
    raison:
      "`countOtherAvailablePlatformAdmins` rend `null` = « je ne sais pas », documenté comme " +
      "tel, et chaque appelant décide PAR RÉVERSIBILITÉ : réversible → on laisse passer, purge → " +
      "on ne fait rien. C'est l'exemplaire que tout le lot 1.3 cite. Relu le 19/09/2026.",
  },

  // ── LE MODÈLE : LA GARDE EST UNE CONTRAINTE DE SCHÉMA, PAS UNE LECTURE ───
  'lib/collaboration/ensure-personal-org.ts': {
    total: 1,
    raison:
      "`findPersonalOrg` rend `null` sur panne, l'appelant CRÉE, et l'INDEX UNIQUE PARTIEL " +
      "refuse le doublon (23505, rattrapé) ; si la relecture échoue aussi, la fonction LÈVE en " +
      "500. La valeur neutre ne PEUT PAS produire de doublon, parce que la garde n'est pas la " +
      "lecture — c'est le schéma. C'est la forme la plus solide du dépôt : elle ne dépend " +
      "d'aucune discipline, et c'est vers elle qu'on tend partout où c'est possible. " +
      "Relu le 19/09/2026.",
  },

  // ── BEST-EFFORT DÉCLARÉS, ET LE REPLI N'AFFIRME RIEN DE FAUX ─────────────
  'lib/billing/purchase.ts': {
    total: 1,
    raison:
      "E-mail lu pour le REÇU Stripe. Absent, Checkout le redemande — le commentaire le dit sur " +
      "place. Aucun refus, aucun chiffre, aucun statut ne dépend de cette lecture : rien ne peut " +
      "en tirer une affirmation fausse. Relu le 19/09/2026.",
  },
  'lib/emails/brand.ts': {
    total: 1,
    raison:
      "Nom d'écosystème pour la signature d'e-mail. Le repli est `UMBRELLA_BRAND` = 'Skilloria', " +
      "qui est VRAI : c'est le nom de la plateforme, pas une valeur inventée. Un e-mail signé " +
      "Skilloria au lieu de l'écosystème n'affirme rien de faux. Relu le 19/09/2026.",
  },
  'app/[locale]/dashboard/entreprise/page.tsx': {
    total: 2,
    raison:
      "Deux lectures sans conséquence affirmative. (1) `redirectByUserType` ne choisit qu'une " +
      "DESTINATION : toutes les branches mènent à une page valide, et le repli `/` est celui du " +
      "cas majoritaire (client/cabinet sans organisation). (2) Le prénom est explicitement " +
      "best-effort — l'accueil s'affiche sans lui. Aucun état n'est affirmé dans les deux cas. " +
      "Relu le 19/09/2026.",
  },
  'lib/matching/relance.ts': {
    total: 1,
    raison:
      "`avant.matching_relance_due_at` sert à écrire « report » ou « première programmation » " +
      "AU JOURNAL. Le commentaire borne honnêtement la portée — « information de journal, pas " +
      "une décision » — et la décision est prise par la fonction SQL en une seule écriture. " +
      "L'autre lecture du fichier (l'écosystème du dépassement) MENTAIT et a été corrigée. " +
      "Relu le 19/09/2026.",
  },

  // ── ENRICHISSEMENTS D'AFFICHAGE, SANS GARDE EN AVAL ─────────────────────
  'lib/candidature-org-dto.ts': {
    total: 4,
    raison:
      "Quatre lectures d'ENRICHISSEMENT dont aucune ne traverse une garde : le pitch IA " +
      "(décoratif), les badges « non consultée » (dont l'absence montre TOUT comme non consulté, " +
      "soit le sens prudent), et les libellés de branche et de spécialité. Les TROIS AUTRES " +
      "lectures de ce fichier — fenêtres d'annonce, fenêtres d'échange, profils déverrouillés — " +
      "mentaient et rendent désormais `null`, l'appelant refusant en 503. Relu le 19/09/2026.",
  },
  'app/[locale]/dashboard/cdi/page.tsx': {
    total: 1,
    raison:
      "Refetch de `cdi_status` sur `sk:availability-changed`. La garde est " +
      "`if (raw === 'employed' || raw === 'open_to_work')` : sur une panne, RIEN n'est écrit et " +
      "l'écran garde le dernier état connu. C'est la forme prescrite — on n'écrase pas un état " +
      "valide par une absence — et non un repli inventé. Relu le 19/09/2026.",
  },

  // ── L'ERREUR N'EST PAS LUE, MAIS LA DONNÉE L'EST HONNÊTEMENT ────────────
  'lib/verification/expert-verification.ts': {
    total: 1,
    raison:
      "`domRes` (nom + tags de l'écosystème) : son `.error` n'est pas lu, mais sa DONNÉE l'est " +
      "sans repli — « Pas de fallback en dur : un domaine sans nom = anomalie traitée par le " +
      "caller (pending_admin_review), jamais masquée ». Une panne donne un nom vide, donc " +
      "l'anomalie, donc la revue humaine avec un motif nommé : le chemin est le même et il est " +
      "juste. Les TROIS AUTRES éléments du même `Promise.all` retombaient sur `[]` et faisaient " +
      "juger l'IA sur un dossier vide — corrigés. Relu le 19/09/2026.",
  },
  // ══════════════════════════════════════════════════════════════════════════
  // LOT 4.1c — les 51 emplacements de `app/api/{admin,auth,billing}`, ouverts
  // un par un, plus les 6 gardes du balayage `?.`. 26 mentaient ; les 25
  // ci-dessous sont légitimes, chacun avec SA raison.
  //
  // ⚠️ SIXIÈME FOIS QUE LA FORME ③ DÉNONCE LA PARADE. Elle cherche
  //    `if (error) { … return null }` — la forme EXACTE du correctif. Ce
  //    contrôle ne pourra JAMAIS faire mieux : il cherche ce qu'on écrit pour
  //    réparer. Le verdict se rend en lisant l'APPELANT.
  // ══════════════════════════════════════════════════════════════════════════
  'app/api/auth/register-org/route.ts': {
    total: 3,
    raison:
      `Trois PRÉ-CHECKS d'unicité — téléphone, domaine e-mail, numéro d'identification. Ce sont des COURTOISIES : le vrai garde est l'index unique (§E.31), et le fichier le dit lui-même — « l'interception du 23505 plus bas reste le filet en cas de course ». Leur erreur avalée ne corrompt donc RIEN. Ce qu'elle coûtait — un 500 opaque au lieu du 409 nommé — est corrigé au lot 4.1c : le refus du schéma porte désormais son nom. Relu le 19/09/2026.`,
  },
  'app/api/auth/public/register-expert/route.ts': {
    total: 3,
    raison:
      `Un pré-check d'unicité téléphone (même raison que register-org : l'index garde), et les DEUX gardes de taxonomie qui REFUSENT sur l'absence (\`if (!br) return 400\`). Ces deux-là étaient justes mais n'étaient ATTEINTES que si l'écosystème était connu — la garde qui les conditionnait s'ouvrait sur une panne, et elle est fermée au lot 4.1c. Relu le 19/09/2026.`,
  },
  'app/api/auth/public/send-phone-otp/route.ts': {
    total: 1,
    raison:
      `Pré-check d'unicité AVANT l'envoi du SMS. La barrière réelle reste la création de compte (D2, index unique) ; ce contrôle-ci évite une dépense et un code envoyé à un tiers. Sa branche \`else\` déclare explicitement son fail-open quand le service-role manque — c'est arbitré et écrit sur place. Relu le 19/09/2026.`,
  },
  'app/api/auth/verify-phone-otp/route.ts': {
    total: 1,
    raison:
      `Même pré-check, au moment de la vérification. L'index unique reste la barrière ; le rate-limit voisin, lui, est FAIL-CLOSED et le dit. Relu le 19/09/2026.`,
  },
  'app/api/auth/finalize-org-registration/route.ts': {
    total: 1,
    raison:
      `Pré-check d'unicité du numéro d'identification, doublé par \`organizations_siren_unique_idx\`. Relu le 19/09/2026.`,
  },
  'app/api/admin/create-admin/route.ts': {
    total: 1,
    raison:
      `Pré-check d'unicité e-mail : \`auth.users\` refuse le doublon, et la route lit ce refus (« already / registered / exists » → 409 \`email_taken\`). La garde est l'auth, pas la lecture. Relu le 19/09/2026.`,
  },
  'app/api/admin/approve-expert/route.ts': {
    total: 1,
    raison:
      `Slug d'écosystème pour construire le lien d'e-mail. Best-effort DÉCLARÉ (« lookup best-effort hors chemin de décision »), et la route REFUSE D'ENVOYER si l'origine reste inconnue — un lien mort est pire qu'un e-mail non parti (§E.11). Relu le 19/09/2026.`,
  },
  'app/api/admin/reject-expert/route.ts': {
    total: 1,
    raison:
      `Idem approve-expert, même lecture, même repli. Relu le 19/09/2026.`,
  },
  'app/api/admin/approve-org/route.ts': {
    total: 1,
    raison:
      `Destinataire de l'e-mail d'approbation (membre admin le plus ancien). Best-effort déclaré : l'approbation elle-même a déjà eu lieu et n'en dépend pas. Relu le 19/09/2026.`,
  },
  'app/api/admin/reject-org/route.ts': {
    total: 1,
    raison:
      `Idem approve-org. Relu le 19/09/2026.`,
  },
  'app/api/admin/durees/route.ts': {
    total: 2,
    raison:
      `\`compterBascule\` rend \`null\` = « je ne sais pas » et journalise — c'est la parade, pas le défaut. La seconde lecture ne sert qu'à l'horodatage d'écran (\`updated_at\`, \`updated_by\`). Relu le 19/09/2026.`,
  },
  'app/api/admin/ecosystemes/[id]/impact/route.ts': {
    total: 2,
    raison:
      `Les deux compteurs rendent \`null\` sur erreur, et leur commentaire est la SOURCE de la règle §E.22 ⑨ : « un compteur en panne qui affiche zéro dirait *il n'y a rien à perdre* au moment précis où on décide de couper ». C'est l'exemplaire du dépôt. Relu le 19/09/2026.`,
  },
  'app/api/admin/org-usage/route.ts': {
    total: 2,
    raison:
      `Les deux compteurs de consommation rendent \`null\`, corrigés au lot 1.3 (§E.22 ⑨) et gardés par \`diag-echec-silencieux\`. Relu le 19/09/2026.`,
  },
  'app/api/admin/user-purge/route.ts': {
    total: 1,
    raison:
      `\`organizationsLeftWithoutAdmin\` rend \`null\` = « je ne sais pas », JAMAIS \`[]\` : sur \`[]\`, la barrière d'acquittement sautait en silence sur la seule action irréversible du back-office (§E.22 ②). Relu le 19/09/2026.`,
  },
  'app/api/admin/cron-jobs/[name]/schedule/route.ts': {
    total: 1,
    raison:
      `Une SUGGESTION d'horaire offerte AVEC un refus. Son absence ne relâche rien : le refus est prononcé de toute façon. Relu le 19/09/2026.`,
  },
  'app/api/admin/get-branch/[id]/route.ts': {
    total: 3,
    raison:
      `Trois lectures de LIBELLÉS — nom d'écosystème et traductions. Les deux COMPTEURS de ce fichier, eux, mentaient : ils sont passés par \`lib/admin/usage-branche.ts\` au lot 4.1c, avec la barrière de suppression. Relu le 19/09/2026.`,
  },
  'app/api/admin/get-org/[id]/route.ts': {
    total: 1,
    raison:
      `Libellé d'écosystème pour l'affichage. Relu le 19/09/2026.`,
  },
  'app/api/admin/get-package/[id]/route.ts': {
    total: 1,
    raison:
      `Dictionnaire des libellés de features. Le COMPTEUR du même fichier rend désormais \`null\` (§E.22 ⑨) — « aucune organisation sur cette offre » est la phrase qui autorise à la retirer. Relu le 19/09/2026.`,
  },
  'app/api/admin/list-orgs/route.ts': {
    total: 3,
    raison:
      `Trois enrichissements d'une LISTE : noms d'offres, échéances d'abonnement, noms d'écosystèmes. Aucun ne traverse une garde ; leur absence laisse des cellules vides, pas une affirmation. Relu le 19/09/2026.`,
  },
  'app/api/admin/list-other-specialities/route.ts': {
    total: 1,
    raison:
      `Noms d'écosystèmes pour un regroupement d'affichage. Relu le 19/09/2026.`,
  },
  'app/api/admin/ecosystemes/[id]/route.ts': {
    total: 2,
    raison:
      `Les traductions (affichage) et la ligne de configuration — celle-ci fait REFUSER en 409 \`config_missing\` : le motif est imprécis sur une panne, mais rien n'est corrompu et la garde tient. Le COMPTEUR de branches, lui, rend désormais \`null\`. Relu le 19/09/2026.`,
  },
  'app/api/admin/ecosystemes/[id]/visuel/route.ts': {
    total: 2,
    raison:
      `Deux lectures de la ligne de configuration, toutes deux suivies d'un REFUS 409 \`config_missing\`. Fail-closed ; le motif est imprécis sur une panne, l'action ne l'est pas. Relu le 19/09/2026.`,
  },
  'app/api/admin/collaboration-orgs/route.ts': {
    total: 1,
    raison:
      `Cinq lectures à plat pour une LISTE d'administration ; seules trois ont leur erreur non lue, et aucune ne traverse une garde. Relu le 19/09/2026.`,
  },
  'app/api/admin/get-expert/[id]/route.ts': {
    total: 1,
    raison:
      `Les trois tables structurées de l'expert. NOMMÉ ICI PARCE QUE C'EST UN ÉCRAN DE DÉCISION : une panne affichait un profil sans expérience, et un administrateur approuvait dessus. L'erreur est désormais journalisée et le cas documenté ; la correction complète (un état nommé jusqu'à l'écran) appartient au même lot que \`get-user\`. Relu le 19/09/2026.`,
  },
  'app/api/admin/get-user/[id]/route.ts': {
    total: 1,
    raison:
      `Rattachement d'organisation et profil expert, sur l'écran qui précède une suspension ou une purge. Même famille que \`get-expert\` : la donnée manquante se lit « il n'y en a pas ». Relu le 19/09/2026.`,
  },
  'app/api/billing/offers/route.ts': {
    total: 1,
    raison:
      `Les features de chaque offre, pour l'affichage du catalogue. Le mur payant, lui, est fermé par deux verrous serveur indépendants (§D.1). Relu le 19/09/2026.`,
  },


  // ══════════════════════════════════════════════════════════════════════════
  // LOT 4.1d — les 59 emplacements de `app/api/{me,profile,candidatures,
  // conversations,invitations,notifications,publications,taxonomy}`.
  //
  // LES QUINZE DEFAUTS NOMMES SONT FERMES (20/09/2026). Ils ont donc QUITTE le
  // recensement, et onze fichiers sont sortis de ce gel avec eux. Ce qui reste
  // ci-dessous est LEGITIME, une raison par entree — et « legitime » veut dire
  // LU ET JUGE TEL, pas « pas encore regarde ».
  //
  // ⚠️ LA DISTINCTION RESTE ECRITE MEME QUAND ELLE NE SERT PLUS. Tant que ce
  //    gel ne contenait que des lignes saines, le mot « juge » s'etait mis a
  //    vouloir dire « acquitte » — c'est ce glissement qui avait laisse trois
  //    lignes non ouvertes au lot 1.3 (§G.8). Le jour ou un defaut nomme
  //    reviendra ici, la convention doit deja etre la.

  'app/api/candidatures/[id]/pitch/route.ts': {
    total: 1,
    raison:
      ":169 `expRows` — LEGITIME. Les experiences alimentent le TEXTE du pitch, une proposition regeneree a la demande et jamais presentee comme un releve. Une lecture en panne appauvrit la redaction ; elle ne produit aucune affirmation metier et ne franchit aucune garde. Lu le 20/09/2026.",
  },
  'app/api/invitations/resolve/route.ts': {
    total: 1,
    raison:
      ":81 `existingUser` — LEGITIME, et sa raison est DEJA ECRITE dans le fichier : cet ecran ANNONCE, il ne garde pas ; c'est POST accept qui refuse, et qui le dit. Afficher un blocage sur une panne accuserait l'invite a tort. (:61 est ferme — il journalise desormais.) Lu le 20/09/2026.",
  },
  'app/api/me/candidatures/route.ts': {
    total: 1,
    raison:
      ":195 `viewsRaw` — LEGITIME : la carte « consultee » se remet a « non consultee », un badge qui SUR-signale. Aucune affirmation metier, aucune ecriture, et l'etat revient au rechargement suivant. (:179 est ferme.) Lu le 20/09/2026.",
  },
  'app/api/me/organisation/invitations/route.ts': {
    total: 1,
    raison:
      ":265 `inviter` — LEGITIME. Seule la LOCALE de l'e-mail d'invitation en depend ; `normalizeLocale(null)` rend le defaut du produit, qui est un choix ecrit, pas une invention. L'invitation part, le lien est bon, le jeton est bon. Lu le 20/09/2026.",
  },
  'app/api/me/organisation/logo/route.ts': {
    total: 1,
    raison:
      ":93 `row` — LEGITIME. Sans drapeau, `signOrgLogoUrl` ne signe rien et l ecran retombe sur les INITIALES — l etat vide CONCU (§D.8), pas une icone cassee (§E.17). Aucune ecriture, aucune affirmation. Lu le 20/09/2026.",
  },
  'app/api/me/organisation/offre/route.ts': {
    total: 2,
    raison:
      ":52 `usage_peek` — LEGITIME, et c'est le correctif du lot 1.3 : `null` = « je ne sais pas », et l'ecran ecrit « — », jamais « 0 / 2 » (§E.22 ⑨). · :249 `transactions` — LEGITIME : sans derniere transaction, l'ecran dit qu'aucun prelevement n'est enregistre. C'est une ABSENCE, pas un faux prix — et retomber sur le prix catalogue rouvrirait precisement le defaut que §E.41 ② ferme. ⚠️ Reserve ecrite : l'erreur n'est pas journalisee, donc cette absence-la est muette pour l'exploitant. Lus le 20/09/2026.",
  },
  'app/api/notifications/unsubscribe/route.ts': {
    total: 1,
    raison:
      ":62 `user` — LEGITIME. Le desabonnement, lui, a REUSSI et son echec est teste separement (`res.ok`). Seuls la langue et le segment de la redirection de courtoisie retombent sur un defaut ; la garde de routage corrige le segment. Lu le 20/09/2026.",
  },
}

/**
 * À JUGER — COMPTÉS, pas lus. Cette liste ne déclare RIEN légitime : elle dit
 * ce qu'il reste à ouvrir. Elle ne peut que DÉCROÎTRE, et une entrée en sort
 * quand son fichier a été relu — vers JUGÉS avec sa raison, ou vers une
 * correction.
 *
 * Régénérer : `node scripts/diag-erreurs-avalees.mjs --gel`
 */
const A_JUGER = {
  // VIDE — et ce vide est une MESURE, pas une declaration.
  //
  // Les 59 emplacements que cette liste portait apres le lot 4.1c ont tous ete
  // OUVERTS : 22 corriges (ils ont quitte le recensement), 37 geles dans JUGES
  // avec leur raison, dont 15 comme DEFAUTS NOMMES et non corriges — parce
  // qu'ils sortent du perimetre ordonne, pas parce qu'ils seraient sains.
  //
  // ⚠️ CE VIDE NE DIT RIEN DU RESTE DU DEPOT. Les 54 emplacements geles avant
  //    4.1d le sont avec leur propre raison ; ceux que ce recensement ne sait
  //    pas voir sont declares en §E.38 et rappeles dans les raisons ci-dessus.
}


// ═══════════════════════════════════════════════════════════════════════════

const parFichier = new Map()
for (const t of trouvailles) parFichier.set(t.rel, (parFichier.get(t.rel) ?? 0) + 1)

if (process.argv.includes('--gel')) {
  console.log('const A_JUGER = {')
  for (const [f, n] of [...parFichier].sort()) console.log(`  '${f}': ${n},`)
  console.log('}')
  process.exit(0)
}

console.log('\n═══ RECENSEMENT ═══\n')
console.log(`  ①     non lue           (l'erreur n'est même pas récupérée)  : ${par('non lue').length}`)
console.log(`  ①-bis non lue (tableau) (Promise.all, motif objet)           : ${par('non lue (tableau)').length}`)
console.log(`  ①-ter liée sans erreur  (Promise.all, résultat lié entier)   : ${par('liée sans erreur').length}`)
console.log(`  ②     ignorée           (récupérée puis jamais relue)        : ${par('ignorée').length}`)
console.log(`  ③     convertie         (if (error) → return null / [])      : ${par('convertie').length}`)
console.log(`\n  TOTAL : ${trouvailles.length} emplacement(s) sur ${parFichier.size} fichier(s)`)
console.log(`  Balayage : ${RACINES.join(' + ')} — ${fichiers.length} fichier(s)`)

if (process.argv.includes('--detail')) {
  console.log('\n═══ DÉTAIL ═══\n')
  for (const t of trouvailles.sort((a, b) => a.rel.localeCompare(b.rel) || a.ligne - b.ligne)) {
    console.log(`  ${t.rel}:${t.ligne}`)
    console.log(`      [${t.forme}] ${t.extrait}`)
  }
}

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`) }
}

console.log('\n═══ LE CLIQUET ═══\n')

const budget = (f) => (JUGES[f]?.total ?? 0) + (A_JUGER[f] ?? 0)
const neuves = []
const baisses = []
for (const [f, n] of parFichier) {
  const b = budget(f)
  if (n > b) neuves.push(`${f} : ${n} occurrence(s) pour un gel de ${b}`)
  else if (n < b) baisses.push(`${f} : ${n} au lieu de ${b}`)
}
const disparus = [...new Set([...Object.keys(JUGES), ...Object.keys(A_JUGER)])]
  .filter((f) => !parFichier.has(f))

ok(
  neuves.length === 0,
  'aucune occurrence NEUVE de la classe',
  neuves.join(' · ') +
    '\n       → Une erreur de requête ne devient pas une absence de donnée. ' +
    'Récupérez-la, et distinguez « rien » de « en panne » (§E.22).',
)

for (const b of baisses) console.log(`  note baisse — ${b} : retirez la différence du gel`)
for (const d of disparus) console.log(`  note ${d} est sorti du recensement : retirez-le du gel`)

const resteAJuger = Object.values(A_JUGER).reduce((a, b) => a + b, 0)
const dejaJuges = Object.values(JUGES).reduce((a, j) => a + (j.total ?? 0), 0)

console.log('')
console.log(`  jugés, avec leur raison : ${dejaJuges}`)
console.log(`  À JUGER, comptés non lus : ${resteAJuger}`)
if (resteAJuger > 0) {
  console.log('')
  console.log('  ⚠ Ces emplacements ne sont PAS déclarés légitimes — ils ne sont pas lus.')
  console.log('    Le cliquet empêche la classe de grandir ; il ne la juge pas (§G.8).')
}

// ─── ÉPREUVE de la seule correction que ce recensement a motivée ────────────
//
// `signAvatarUrl` traitait à l'identique un compte sans photo et un stockage
// tombé — sans une ligne de journal. Le corriger demandait de DISTINGUER les
// deux, et cette distinction est un jugement : trop large, une panne redevient
// muette ; trop étroite, le journal se remplit d'un cas parfaitement banal.
// Elle est donc éprouvée ici, à chaque exécution.
console.log('\n═══ DISTINCTION « absent » / « en panne » (lib/avatar.ts) ═══\n')

const cas = [
  [{ status: 404, message: 'Object not found' }, true, 'objet absent — le cas NORMAL'],
  [{ message: 'Object not found' }, true, 'absent, sans code de statut'],
  [{ statusCode: '404', message: 'not_found' }, true, 'statut rendu en chaîne'],
  [{ status: 500, message: 'Internal error' }, false, 'PANNE de stockage'],
  [{ message: 'fetch failed' }, false, 'PANNE réseau'],
  [{ status: 403, message: 'Unauthorized' }, false, 'droits insuffisants'],
]

for (const [erreur, attendu, libelle] of cas) {
  const obtenu = estObjetIntrouvable(erreur)
  ok(obtenu === attendu, `${libelle} → ${obtenu ? 'silencieux' : 'JOURNALISÉ'}`,
     `attendu : ${attendu ? 'silencieux' : 'JOURNALISÉ'}`)
}

console.log('')
if (echecs > 0) {
  console.log(`✘ ${echecs} CONTRÔLE(S) EN ÉCHEC`)
  process.exit(1)
}
const nommes = Object.values(JUGES).filter((j) => /DEFAUT NOMME/.test(j.raison ?? '')).length
console.log('✅ La classe ne grandit pas, et tout ce qui la compose a été LU.')
if (nommes > 0) {
  console.log(`   ⚠ ${nommes} fichier(s) du gel portent un DÉFAUT NOMMÉ et NON CORRIGÉ — « jugé » veut`)
  console.log('     dire LU, jamais acquitté. Leur rang est écrit dans leur raison.')
}
process.exit(0)
