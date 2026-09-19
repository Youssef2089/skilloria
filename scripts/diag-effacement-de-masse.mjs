#!/usr/bin/env node
/**
 * UNE LECTURE EN PANNE NE PEUT PLUS DEVENIR UN `PATCH`.
 *
 * ┌─ LA FORME QUE §E.22 N'AVAIT PAS — ET ELLE EST PIRE QUE SES NEUF CAS ────┐
 * │ Les neuf cas du lot 1.3 s'arrêtaient tous à une LECTURE : un refus, un   │
 * │ message, un compteur. Aucun ne finissait sur une ÉCRITURE.               │
 * │                                                                          │
 * │ Les deux écrans de validation de profil chargeaient expériences,         │
 * │ formations et langues par `(res.data ?? [])`. Une panne rendait donc un  │
 * │ formulaire VIDE ; l'expert enregistrait son brouillon ; le corps portait │
 * │ `experiences: []` ; et `PATCH /api/profile` applique une liste vide par  │
 * │ `delete().eq('profile_id', …)` sans rien réinsérer.                      │
 * │                                                                          │
 * │ L'EXPERT LISAIT « BROUILLON ENREGISTRÉ » À LA SECONDE EXACTE OÙ SA       │
 * │ CARRIÈRE ENTIÈRE DISPARAISSAIT. La panne ne mentait plus : elle DEVENAIT │
 * │ la vérité.                                                               │
 * │                                                                          │
 * │ ET LE CHEMIN SANS BARRIÈRE ÉTAIT LE BOUTON PAR DÉFAUT : la barrière de   │
 * │ complétude de la route ne s'arme que sous `body.visible === true`. Qui   │
 * │ PUBLIE était sauvé (400 `incomplete`, avec un motif faux mais rien de    │
 * │ perdu) ; qui ENREGISTRE UN BROUILLON n'avait rien du tout.               │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ CE QUE CE CONTRÔLE GARDE, ET POURQUOI EN DEUX ENDROITS ══════════════
 *   ① LES ÉCRANS n'envoient plus une liste qu'ils n'ont pas su lire.
 *   ② LA ROUTE refuse un remplacement par le vide qu'aucune lecture n'appuie.
 *
 *   Le ② seul suffirait à empêcher la destruction ; le ① seul ne suffirait
 *   pas — un correctif d'écran n'est pas une barrière, il régresse au premier
 *   copier-coller (§E.20 : le dépôt portait DÉJÀ quatre copies de ce même
 *   chargement). On garde les deux, et on garde SÉPARÉMENT le fait que la
 *   route ne dépend pas de l'écran.
 *
 * ⚠️ §E.7 — les commentaires sont retirés avant toute détection. Ce fichier
 *    cite `(res.data ?? [])` et `experiences: []` pour expliquer ce qu'il
 *    interdit, et les écrans corrigés citent l'ancienne forme dans leurs
 *    propres commentaires. Un contrôle naïf rougirait sur sa propre explication.
 *
 * Sortie : 0 vert · 1 rouge. Aucune base, aucun réseau, aucun identifiant.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** §E.3 — le dépôt sort en CRLF, et tout motif qui franchit un `\n` casserait. */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const exists = (p) => existsSync(join(ROOT, p))

/**
 * §E.7 — on lit le CODE, jamais la prose.
 * Les lignes sont PRÉSERVÉES (un commentaire devient une ligne vide) pour que
 * les numéros rapportés restent ceux du fichier réel.
 */
const sansCommentaires = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l))
    .join('\n')

let echecs = 0
const ok = (condition, libelle, pourquoi) => {
  if (condition) {
    console.log(`  ok   ${libelle}`)
  } else {
    echecs++
    console.log(`  KO   ${libelle}`)
    if (pourquoi) console.log(`       → ${pourquoi}`)
  }
}
const section = (titre) => console.log(`\n═══ ${titre} ═══\n`)

/** Les quatre copies du MÊME chargement. §E.20 : on les garde ensemble. */
const ECRANS = {
  destructeurs: [
    'app/[locale]/dashboard/freelance/profil/valider/page.tsx',
    'app/[locale]/dashboard/cdi/profil/valider/page.tsx',
  ],
  afficheurs: [
    'app/[locale]/dashboard/freelance/mon-profil/page.tsx',
    'lib/hooks/useCdiProfile.ts',
  ],
}
const TOUS = [...ECRANS.destructeurs, ...ECRANS.afficheurs]
const ROUTE = 'app/api/profile/route.ts'
const TYPE = 'lib/lecture/liste.ts'

// ═════════════════════════════════════════════════════════════════════════════
section('A. Le TYPE existe, et il rend `?? []` INÉCRIVABLE')
// ═════════════════════════════════════════════════════════════════════════════
//
//   LA PARADE EST UN TYPE, PAS UNE DISCIPLINE. `lignes` n'existe QUE dans la
//   branche `'disponible'` : il n'y a aucun moyen d'atteindre les lignes sans
//   avoir répondu à `'indisponible'`. Le discriminant s'appelle `etat` et
//   `'indisponible'` y veut dire la même chose que dans `etatRepartition` et
//   dans `expertProfileGate` — trois noms pour la même idée rouvriraient la
//   confusion qu'ils ferment.
{
  ok(exists(TYPE), `${TYPE} existe`)
  const t = exists(TYPE) ? sansCommentaires(read(TYPE)) : ''

  ok(
    /\|\s*\{\s*etat:\s*'indisponible'\s*\}/.test(t),
    "le type porte l'état « indisponible »",
    "sans état nommé, une panne redevient indistinguable d'une liste vide",
  )
  ok(
    /\{\s*etat:\s*'disponible';\s*lignes:\s*T\[\]\s*\}/.test(t),
    '`lignes` n’existe que dans la branche « disponible »',
    'si `lignes` vivait hors de l’union, on pourrait le lire sans avoir traité la panne',
  )
  // Le discriminant est PARTAGÉ avec les parades existantes. Un quatrième
  // dialecte pour la même idée est exactement ce qu'on refuse.
  ok(
    /etat:\s*'indisponible'/.test(sansCommentaires(read('lib/matching/etat-repartition.ts'))),
    'le même mot « indisponible » gouverne déjà la répartition du matching',
    'le vocabulaire des états doit traverser les couches, sinon chaque couche réinvente le sien',
  )
  // La borne des listes est CLOSE et partagée avec la route (même parti pris
  // que `SUJETS` : la borne identique des deux côtés, ou rien n'est garanti).
  ok(
    /LISTES_DE_PROFIL\s*=\s*\[\s*'experiences',\s*'educations',\s*'languages_structured'\s*\]\s*as const/.test(t),
    'les trois listes de profil sont une liste BORNÉE et partagée',
  )
}

// ═════════════════════════════════════════════════════════════════════════════
section('B. LA ROUTE refuse un effacement que rien n’appuie — la vraie barrière')
// ═════════════════════════════════════════════════════════════════════════════
//
//   §E.8 : chaque assertion est ancrée SUR LE BLOC qu'elle vise. Une regex
//   lâchée sur le fichier attraperait le bloc voisin — c'est exactement
//   comme ça que `diag-zones-de-travail` est passé au vert sur une condition
//   retirée.
{
  ok(exists(ROUTE), `${ROUTE} existe`)
  const r = exists(ROUTE) ? sansCommentaires(read(ROUTE)) : ''

  // ① La barrière existe, et elle est AVANT toute écriture de bloc.
  const iBarriere = r.indexOf('effacement_non_declare')
  // ⚠️ L'ANCRE NAÏVE ÉTAIT `.from('profile_experiences')`, ET ELLE ÉTAIT FAUSSE.
  //    Ce nom de table apparaît AUSSI dans le comptage de complétude, ~60
  //    lignes plus HAUT que la barrière — le contrôle rougissait donc sur du
  //    code correct. C'est §E.8 pris à mon propre piège : on ancre sur ce
  //    qu'on vise (la DESTRUCTION), pas sur un nom qui traîne ailleurs.
  const iPremierDelete = r.indexOf('.delete()')
  ok(
    iBarriere > 0 && iPremierDelete > 0 && iBarriere < iPremierDelete,
    'le refus est prononcé AVANT le premier `delete` de bloc',
    'une barrière posée après la destruction ne barre rien',
  )

  // ② Elle ne mord QUE sur l'irréversible : liste vide ET lignes existantes.
  //    Une barrière plus large gênerait le cas normal, et une barrière qui
  //    gêne le cas normal est une barrière qu'on retire.
  ok(
    /if\s*\(\s*!Array\.isArray\(envoyee\)\s*\|\|\s*envoyee\.length\s*>\s*0\s*\)\s*continue/.test(r),
    'un remplacement par une liste NON VIDE passe sans entrave',
    'refuser le cas normal ferait retirer la barrière au premier ticket',
  )
  ok(
    /if\s*\(\s*\(count\s*\?\?\s*0\)\s*>\s*0\s*\)/.test(r),
    'vider une liste DÉJÀ VIDE passe sans entrave',
  )
  ok(
    /if\s*\(\s*declarees\.includes\(cle\)\s*\)\s*continue/.test(r),
    'une liste DÉCLARÉE LUE peut être vidée — c’est une décision, pas une panne',
  )

  // ③ ET LE COMPTAGE LUI-MÊME NE RETOMBE PAS DANS LA CLASSE QU'ON FERME.
  //    Ne pas savoir combien de lignes on effacerait n'autorise pas à les
  //    effacer. C'est le piège exact de §E.22 ⑤ : une liste vide par panne
  //    faisait sauter la barrière d'acquittement du lot 1.3.
  const blocCount = /const\s*\{\s*count,\s*error:\s*cntErr\s*\}[\s\S]{0,700}?\n\s{6}\}/.exec(r)?.[0] ?? ''
  ok(
    /if\s*\(\s*cntErr\s*\)/.test(blocCount) && /503/.test(blocCount) && !/continue/.test(blocCount.split('cntErr')[1]?.slice(0, 400) ?? ''),
    'un comptage EN PANNE refuse (503) au lieu de laisser passer',
    'sinon la barrière elle-même se contourne par une seconde panne de lecture',
  )

  // ④ La route ne fait AUCUNE confiance à l'écran : la borne vient du module
  //    partagé, et les valeurs reçues sont filtrées par le prédicat borné.
  ok(
    /from\s*'@\/lib\/lecture\/liste'/.test(r) && /\.filter\(estListeDeProfil\)/.test(r),
    'les clés déclarées sont filtrées par la borne partagée',
    'accepter une clé arbitraire ferait déclarer « lue » n’importe quoi',
  )
}

// ═════════════════════════════════════════════════════════════════════════════
section('C. LES QUATRE ÉCRANS — plus aucun `?? []` sur une liste de profil')
// ═════════════════════════════════════════════════════════════════════════════
//
//   §E.20 : le dépôt portait QUATRE copies du même chargement. Deux
//   écrivaient, deux affichaient — et la recherche du défaut se serait
//   arrêtée à la première corrigée. On les garde toutes les quatre, ensemble,
//   dans la même section.
{
  for (const f of TOUS) {
    ok(exists(f), `${f} existe`)
    const src = exists(f) ? sansCommentaires(read(f)) : ''

    // La forme interdite, dans ses deux écritures : `x.data ?? []` et le
    // `{ data: x }` déstructuré d'un Promise.all (qui jette l'`error` à
    // l'écriture même de la ligne — il n'y a plus rien à oublier de lire).
    const dataOuVide = /\b(exps|edus|langs|expsRes|edusRes|langsRes)\b(\.data)?\s*\?\?\s*\[\]/.exec(src)
    ok(
      dataOuVide === null,
      `${f} : aucune liste de profil ne retombe sur \`[]\``,
      dataOuVide ? `trouvé : ${dataOuVide[0]}` : undefined,
    )

    ok(
      /listeLue[<(]/.test(src),
      `${f} : la lecture passe par \`listeLue\``,
      'sans le type, rien n’oblige à traiter la branche « indisponible »',
    )
  }
}

// ═════════════════════════════════════════════════════════════════════════════
section('D. LES DEUX DESTRUCTEURS — une liste non lue n’est pas ENVOYÉE')
// ═════════════════════════════════════════════════════════════════════════════
//
//   C'est `'experiences' in body` qui DÉCLENCHE le remplacement côté route.
//   Omettre la clé est donc la seule abstention possible : envoyer `[]` serait
//   un effacement. L'assertion est ancrée sur le corps du PATCH, pas lâchée
//   sur le fichier (§E.8).
{
  for (const f of ECRANS.destructeurs) {
    const src = exists(f) ? sansCommentaires(read(f)) : ''

    for (const cle of ['experiences', 'educations', 'languages_structured']) {
      // La clé n'apparaît dans le corps QUE sous une garde sur `listesLues`.
      const inconditionnelle = new RegExp(`\\n\\s{6}${cle}:\\s*cleaned`, '').test(src)
      ok(
        !inconditionnelle,
        `${f} : \`${cle}\` n’est plus envoyée inconditionnellement`,
        'une clé présente dans le corps déclenche le delete, même vide',
      )
      ok(
        new RegExp(`listesLues\\.includes\\('${cle}'\\)`).test(src),
        `${f} : \`${cle}\` n’est envoyée que si elle a été LUE`,
      )
    }

    ok(
      /listes_lues:\s*listesLues/.test(src),
      `${f} : le corps DÉCLARE les listes réellement lues`,
      'sans déclaration, la route ne peut pas distinguer une décision d’une panne',
    )

    // L'état part de VIDE. C'est le bon défaut : avant le chargement, on n'a
    // rien lu — et un défaut « tout lu » rouvrirait la destruction sur un
    // enregistrement déclenché avant la fin du chargement.
    ok(
      /useState<ListeDeProfil\[\]>\(\[\]\)/.test(src),
      `${f} : « aucune liste lue » est l’état de DÉPART`,
      'partir de « tout lu » rendrait la garde inopérante tant que le chargement n’a pas fini',
    )

    // ET L'ÉCRAN LE DIT. Un refus muet remplacerait un mensonge précis par un
    // silence poli (§E.19) — et ici l'affirmation muette était la pire
    // possible : un formulaire vide se lit « vous n'avez rien saisi ».
    ok(
      /list_read_failed_title/.test(src) && /list_read_failed_retry/.test(src),
      `${f} : la panne est ANNONCÉE, avec une action`,
    )
  }
}

// ═════════════════════════════════════════════════════════════════════════════
section('E. LES DEUX AFFICHEURS — un profil illisible ne se lit pas « vide »')
// ═════════════════════════════════════════════════════════════════════════════
{
  for (const f of ECRANS.afficheurs) {
    const src = exists(f) ? sansCommentaires(read(f)) : ''
    ok(
      /sectionsIndisponibles/.test(src),
      `${f} : les sections illisibles sont nommées, pas confondues avec le vide`,
    )
  }
  // Et le hook le fait REMONTER : sans le champ dans l'état, l'écran ne peut
  // pas le dire, et le correctif du hook serait invisible.
  // ⚠️ MUTATION M17 : CETTE ASSERTION ÉTAIT TROP LÂCHE, ET ELLE EST RESTÉE VERTE.
  //    Renommer le champ DU TYPE D'ÉTAT ne la faisait pas broncher : la même
  //    forme `sectionsIndisponibles: ListeDeProfil[]` existe AUSSI en
  //    VARIABLE LOCALE vingt lignes plus bas, et la regex, lâchée sur tout le
  //    fichier, attrapait la locale. §E.8 : on ancre sur le BLOC visé — ici la
  //    déclaration du type d'état, reconnue par ses champs voisins.
  const hook = sansCommentaires(read('lib/hooks/useCdiProfile.ts'))
  const blocEtat = /experiences:\s*ExperienceItem\[\][\s\S]{0,700}?\n\}/.exec(hook)?.[0] ?? ''
  ok(
    /sectionsIndisponibles:\s*ListeDeProfil\[\]/.test(blocEtat),
    'le hook CDI EXPOSE les sections indisponibles dans son TYPE D’ÉTAT',
    'sans le champ dans l’état, l’écran ne peut pas le dire — le correctif du hook serait invisible',
  )
  ok(
    /\n\s{2,}sectionsIndisponibles,/.test(hook),
    'le hook RENSEIGNE ce champ quand il répond',
    'un champ déclaré et jamais posé vaut un champ absent',
  )
  // ⚠️ MUTATION M18 : « false && sectionsIndisponibles.length > 0 » PASSAIT.
  //    La regex cherchait la condition n'importe où dans le fichier — et la
  //    condition y était toujours, simplement DÉSARMÉE. C'est le piège EXACT
  //    du lot 1.3 (« if (false && block === 'indisponible') »), et j'y suis
  //    retombé en écrivant le contrôle censé le fermer.
  //    On ancre donc sur la FORME EXACTE de l’ouverture JSX : l’accolade colle
  //    à la condition, et plus rien ne peut se glisser devant.
  const CONDITION_ARMEE = /\{sectionsIndisponibles\.length > 0 && \(/
  for (const [nom, f] of [
    ['CDI', 'app/[locale]/dashboard/cdi/mon-profil/page.tsx'],
    ['freelance', 'app/[locale]/dashboard/freelance/mon-profil/page.tsx'],
  ]) {
    const vue = sansCommentaires(read(f))
    ok(
      CONDITION_ARMEE.test(vue) && /list_read_failed_title/.test(vue),
      `la vue ${nom} consomme ce champ et affiche le bandeau, sans garde désarmée`,
      'une condition précédée de « false && » reste présente dans le fichier et ne fait rien',
    )
  }
}

// ═════════════════════════════════════════════════════════════════════════════
section('F. Les motifs arrivent jusqu’à l’écran, dans les QUATRE langues')
// ═════════════════════════════════════════════════════════════════════════════
//
//   Un motif honnête qui n'arrive pas à l'écran remplace un mensonge précis
//   par une clé brute. Parité stricte : la même arborescence dans les quatre.
{
  const LANGUES = ['fr', 'en', 'es', 'de']
  const ATTENDUES = {
    profile_validation: [
      'sections.experiences',
      'sections.educations',
      'sections.languages_structured',
      'errors.list_read_failed_title',
      'errors.list_read_failed_body',
      'errors.list_read_failed_retry',
      'errors.erase_not_declared',
    ],
    cdi_profile_validation: [
      'sections.experiences',
      'sections.educations',
      'sections.languages_structured',
      'errors.list_read_failed_title',
      'errors.list_read_failed_body',
      'errors.list_read_failed_retry',
      'errors.erase_not_declared',
    ],
    profile_view: [
      'errors.list_read_failed_title',
      'errors.list_read_failed_body',
      'errors.list_read_failed_retry',
      // Les NOMS de section sont RÉUTILISÉS, pas redéclarés : deux jeux de
      // noms pour les mêmes trois blocs divergent toujours.
      'sections.career',
      'sections.education',
      'sections.languages',
    ],
    cdi_profile_view: [
      'errors.list_read_failed_title',
      'errors.list_read_failed_body',
      'errors.list_read_failed_retry',
      'sections.career',
      'sections.education',
      'sections.languages',
    ],
  }
  const lire = (o, chemin) => chemin.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o)

  for (const langue of LANGUES) {
    const m = JSON.parse(read(`messages/${langue}.json`))
    const manquantes = []
    for (const [espace, cles] of Object.entries(ATTENDUES)) {
      for (const cle of cles) {
        if (typeof lire(m[espace], cle) !== 'string') manquantes.push(`${espace}.${cle}`)
      }
    }
    ok(manquantes.length === 0, `${langue} : les motifs sont traduits`, manquantes.join(' · '))
  }

  // ET LE TEXTE DIT LES TROIS MÊMES CHOSES QUE LES CINQ CLÉS DU LOT 1.3 :
  // ce qui n'a pas marché (une LECTURE), ce qui n'a PAS été fait (rien n'est
  // perdu), et la suite. On garde le milieu, qui est celui qu'on oublie.
  const fr = JSON.parse(read('messages/fr.json'))
  for (const espace of ['profile_validation', 'cdi_profile_validation', 'profile_view', 'cdi_profile_view']) {
    const corps = fr[espace].errors.list_read_failed_body
    ok(
      /rien n'a été perdu|rien n'est perdu/i.test(corps),
      `${espace} : le message dit que RIEN N'EST PERDU`,
      'un refus qui ne dit pas ce qui a survécu fait croire à une perte',
    )
  }
}

// ═════════════════════════════════════════════════════════════════════════════
section('G. Ce que ce contrôle NE vérifie PAS')
// ═════════════════════════════════════════════════════════════════════════════
console.log(
  `  note il lit du TEXTE, pas un comportement : il ne prouve pas qu'une panne
  note réelle produit le bon écran. Seul un rejeu avec une base le prouverait.
  note
  note il ne couvre que les TROIS listes de profil. Tout autre bloc « remplacé
  note en entier » (delete + insert) porte la même classe et n'est pas gardé ici.
  note
  note la barrière de la route s'appuie sur un COMPTAGE. Si une quatrième liste
  note apparaît dans LISTES_DE_PROFIL sans sa table dans TABLE_DE_LA_LISTE, la
  note route lèvera — et c'est voulu : mieux vaut lever que compter la mauvaise.`,
)

console.log('')
if (echecs > 0) {
  console.log(`✘ ${echecs} CONTRÔLE(S) EN ÉCHEC`)
  process.exit(1)
}
console.log('✅ Une lecture en panne ne peut plus devenir un PATCH.')
