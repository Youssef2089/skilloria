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
    const relue = new RegExp(`\\b${nomErreur}\\b`).test(apres)
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
 * VIDE aujourd'hui, et c'est exact : ce lot a FERMÉ les deux emplacements de
 * `components/` (ils ont donc quitté le recensement au lieu d'y être gelés), et
 * n'a lu aucun des autres. Prétendre le contraire serait la faute qu'on ferme.
 */
const JUGES = {
  // ── LA PARADE, PRISE POUR LE DÉFAUT — ET C'EST STRUCTUREL ────────────────
  //
  //   La forme ③ cherche `if (error) { … return null }`. C'est EXACTEMENT la
  //   forme du correctif : un `null` dont le sens est « je ne sais pas ».
  //   Le motif ne peut donc pas distinguer la parade de ce qu'elle répare —
  //   ce n'est pas un réglage à affiner, c'est la limite du procédé. Le
  //   recensement reste une CARTE ; le verdict se rend en lisant l'appelant.
  //
  //   Les trois entrées ci-dessous ont été relues une par une au lot 4.1b.
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
  'app/[locale]/connexion/page.tsx': 1,
  'app/[locale]/dashboard/cdi/page.tsx': 1,
  'app/[locale]/dashboard/cdi/profil/page.tsx': 1,
  'app/[locale]/dashboard/entreprise/page.tsx': 2,
  'app/[locale]/dashboard/freelance/page.tsx': 1,
  'app/[locale]/nouveau-mot-de-passe/page.tsx': 1,
  'app/[locale]/reactivation/page.tsx': 1,
  'app/api/admin/approve-expert/route.ts': 1,
  'app/api/admin/approve-org/route.ts': 1,
  'app/api/admin/collaboration-orgs/route.ts': 1,
  'app/api/admin/create-admin/route.ts': 1,
  'app/api/admin/cron-jobs/[name]/schedule/route.ts': 1,
  'app/api/admin/delete-branch/route.ts': 3,
  'app/api/admin/durees/route.ts': 2,
  'app/api/admin/ecosystemes/[id]/impact/route.ts': 2,
  'app/api/admin/ecosystemes/[id]/route.ts': 3,
  'app/api/admin/ecosystemes/[id]/visuel/route.ts': 2,
  'app/api/admin/get-branch/[id]/route.ts': 5,
  'app/api/admin/get-expert/[id]/route.ts': 1,
  'app/api/admin/get-org/[id]/route.ts': 1,
  'app/api/admin/get-package/[id]/route.ts': 2,
  'app/api/admin/get-user/[id]/route.ts': 1,
  'app/api/admin/list-orgs/route.ts': 3,
  'app/api/admin/list-other-specialities/route.ts': 1,
  'app/api/admin/org-usage/route.ts': 2,
  'app/api/admin/reject-expert/route.ts': 1,
  'app/api/admin/reject-org/route.ts': 1,
  'app/api/admin/user-status/route.ts': 1,
  'app/api/auth/finalize-org-registration/route.ts': 1,
  'app/api/auth/public/register-expert/route.ts': 4,
  'app/api/auth/public/send-phone-otp/route.ts': 1,
  'app/api/auth/register-org/route.ts': 5,
  'app/api/auth/verify-phone-otp/route.ts': 1,
  'app/api/billing/change-plan/route.ts': 1,
  'app/api/billing/offers/route.ts': 1,
  'app/api/candidatures/[id]/pitch/route.ts': 1,
  'app/api/candidatures/[id]/select/route.ts': 1,
  'app/api/candidatures/route.ts': 7,
  'app/api/conversations/[id]/messages/route.ts': 2,
  'app/api/invitations/resolve/route.ts': 2,
  'app/api/me/badges/route.ts': 1,
  'app/api/me/candidatures/route.ts': 2,
  'app/api/me/conversations/route.ts': 4,
  'app/api/me/invitations/accept/route.ts': 2,
  'app/api/me/invitations/pending/route.ts': 1,
  'app/api/me/missions/[id]/route.ts': 1,
  'app/api/me/organisation/invitations/route.ts': 4,
  'app/api/me/organisation/logo/route.ts': 1,
  'app/api/me/organisation/offre/route.ts': 5,
  'app/api/notifications/unsubscribe/route.ts': 1,
  'app/api/profile/cdi-upload-cv/route.ts': 7,
  'app/api/profile/cv/reset/route.ts': 1,
  'app/api/profile/route.ts': 7,
  'app/api/profile/upload-cv/route.ts': 6,
  'app/api/publications/route.ts': 2,
  'app/api/taxonomy/route.ts': 1,
  'lib/account-purge.ts': 1,
  'lib/billing/apply.ts': 1,
  'lib/billing/purchase.ts': 1,
  'lib/candidature-org-dto.ts': 7,
  'lib/candidatures/lifecycle-batch.ts': 2,
  'lib/collaboration/ensure-personal-org.ts': 1,
  'lib/emails/brand.ts': 1,
  'lib/entitlements.ts': 3,
  'lib/home-ecosystem.ts': 1,
  'lib/matching/relance.ts': 2,
  'lib/notifications/dispatch.ts': 4,
  'lib/package-default.ts': 1,
  'lib/publication-synthesis.ts': 1,
  'lib/unlock.ts': 2,
  'lib/verification/expert-verification.ts': 2,
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
console.log('✅ La classe ne grandit pas. Ce qui reste à juger est dit, et compté.')
process.exit(0)
