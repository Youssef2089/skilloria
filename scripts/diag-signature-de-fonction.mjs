// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  diag-signature-de-fonction — UNE POSTCONDITION NE COMPARE PAS UNE CHAÎNE
//  RENDUE PAR POSTGRES À UNE FORME QU'ELLE A SUPPOSÉE.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
//  ┌─ LE CAS, MESURÉ LE 24/09/2026 SUR STAGING ──────────────────────────────┐
//  │ Un `db push` s'est arrêté sur :                                         │
//  │   « verdict_ecrit_par_la_tache: postcondition NON TENUE —               │
//  │     cloturer_run_cron(bigint,integer,jsonb,text) »                      │
//  │                                                                          │
//  │ La fonction existait : la migration venait de la créer six lignes plus  │
//  │ haut, dans la même transaction. C'est la VÉRIFICATION qui était fausse.  │
//  │                                                                          │
//  │ `pg_get_function_identity_arguments` rend AUSSI LES NOMS des paramètres │
//  │ — « p_log_id bigint, p_http_status integer, … ». La comparer à          │
//  │ « bigint, integer, jsonb, text » ne peut JAMAIS être vrai sur une       │
//  │ fonction aux paramètres nommés, c'est-à-dire sur toutes les nôtres :    │
//  │ les NEUF fonctions visées par ce motif en avaient (mesuré dans le dépôt).│
//  │                                                                          │
//  │ QUATRE SITES portaient la faute, dans TROIS migrations, écrites le même │
//  │ jour. La première a arrêté le push ; les trois autres attendaient leur  │
//  │ tour. Cinq migrations ne sont pas parties.                               │
//  └──────────────────────────────────────────────────────────────────────────┘
//
//  ═══ LA PARADE : RÉSOUDRE, PAS RENDRE ═══════════════════════════════════
//    `to_regprocedure('public.f(bigint, integer)')` prend une signature en
//    TYPES, la résout, et rend NULL si rien ne correspond. Aucun rendu, aucun
//    nom, aucune mise en forme : la question posée est celle qu'on voulait
//    poser. Une comparaison de chaîne rendue demande à Postgres de formater,
//    puis parie sur le format.
//
//  ═══ ET DEUX AUTRES DÉFAUTS, TROUVÉS PAR LE MÊME EXAMEN ═════════════════
//    ① `pg_get_functiondef` est STRICT : sur une fonction absente il rend
//       NULL, et `NULL not like '%x%'` vaut NULL — donc le `if` NE S'EXÉCUTE
//       PAS. Une fonction manquante PASSAIT la vérification. C'est §E.37 : la
//       garde ne refuse pas de s'ouvrir, elle choisit le mauvais état.
//       ⚠️ Sauf dans un `exists (select …)`, où une ligne absente ne matche
//          simplement pas, et où le `not exists` fait son travail. Les deux
//          formes se distinguent, et ce contrôle les distingue.
//    ② Le rendu d'une constante `timestamptz` DÉPEND DU FUSEAU DE LA SESSION.
//       Une borne comparée à « 2026-09-23 » se lit « 2026-09-22 17:00:00-07 »
//       sur une session en heure du Pacifique. Même faute, transposée au temps.
//
//  ⚠️ CE QUE CE CONTRÔLE NE PROUVE PAS, ET C'EST LA MOITIÉ HONNÊTE :
//     il garde la FORME, pas le comportement de Postgres. Aucun moteur ne
//     tourne ici — ni `psql`, ni Docker, et PostgREST ne lit pas `pg_catalog`.
//     Ce qui prouve le mécanisme est une requête sur une vraie base, et elle
//     est écrite dans le commit de ce correctif.
//
//     C'EST EXACTEMENT LE DÉFAUT QUE LE CAS RÉVÈLE : ces six migrations
//     n'avaient jamais tourné sur une base avant staging. Une postcondition
//     jamais exécutée est une AFFIRMATION, pas une preuve (§E.60). Ce contrôle
//     rend la faute non reproductible ; il ne remplace pas un `db reset`.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-signature-de-fonction.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE variable d'environnement.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

/**
 * Le SQL sans ses commentaires.
 *
 * ⚠️ LE SQL COMMENTE À DEUX TIRETS, pas avec `//` — un dépouilleur TypeScript
 *    ne les voit pas. Et ce contrôle en a un besoin vital : les correctifs
 *    qu'il garde CITENT le motif fautif dans leur explication. Sans ce filtre,
 *    il dénoncerait les commentaires qui racontent le défaut (§E.7).
 */
const sansCommentaires = (src) =>
  src
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`)
  }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

// ═════════════════════════════════════════════════════════════════════════════
//  LE PÉRIMÈTRE, ÉCRIT AVANT LE BALAYAGE
// ═════════════════════════════════════════════════════════════════════════════
//  BALAYÉ : `supabase/migrations/` EN ENTIER — les 86 fichiers, pas seulement
//    ceux du lot. La faute est une habitude d'écriture, pas un accident de
//    sprint : la chercher dans les six migrations concernées aurait laissé les
//    quatre-vingts autres hors de portée (§E.61).
//  EXCLU : tout le reste du dépôt. Ces fonctions de catalogue ne s'appellent
//    que depuis du SQL ; un `grep` sur `app/` et `lib/` l'a confirmé vide.
const DOSSIER = 'supabase/migrations'
const FICHIERS = readdirSync(join(ROOT, DOSSIER))
  .filter((f) => f.endsWith('.sql'))
  .sort()
const SQL = new Map(FICHIERS.map((f) => [f, sansCommentaires(read(`${DOSSIER}/${f}`))]))

console.log('\nUNE POSTCONDITION NE PARIE PAS SUR UN FORMAT\n')
console.log(`périmètre : ${FICHIERS.length} migrations`)

// ═════════════════════════════════════════════════════════════════════════════
section('A. AUCUNE SIGNATURE NE SE VÉRIFIE PAR UNE CHAÎNE RENDUE')

//  ⚠️ ON REFUSE LA FONCTION, PAS UNE COMPARAISON PARTICULIÈRE.
//     Chercher `= 'bigint, integer'` n'aurait attrapé que la forme exacte déjà
//     corrigée ; la même faute avec `like`, avec `in (…)` ou contre une colonne
//     serait passée. `pg_get_function_identity_arguments` n'a AUCUN usage
//     légitime dans une postcondition : ce qu'on en veut, `to_regprocedure` le
//     donne sans rendre quoi que ce soit.
const FAUTIFS = FICHIERS.filter((f) =>
  /pg_get_function_identity_arguments/.test(SQL.get(f)),
)
ok(
  FAUTIFS.length === 0,
  'aucune migration ne compare une signature RENDUE',
  FAUTIFS.length
    ? `${FAUTIFS.join(', ')} — la chaîne rendue porte les NOMS des paramètres, la comparaison ne peut jamais être vraie`
    : undefined,
)

//  ET LA FORME ATTENDUE EST PRÉSENTE : sans elle, l'assertion ci-dessus serait
//  verte sur un dépôt qui ne vérifierait plus aucune signature (§E.38).
const RESOLVEURS = FICHIERS.filter((f) => /to_regprocedure\s*\(/.test(SQL.get(f)))
ok(
  RESOLVEURS.length >= 3,
  `les signatures se vérifient par RÉSOLUTION (${RESOLVEURS.length} migrations)`,
  'zéro résolveur : plus aucune signature n\'est vérifiée, et l\'assertion précédente est vide',
)

// ═════════════════════════════════════════════════════════════════════════════
section('B. UNE FONCTION STRICTE NE DÉCIDE PAS D\'UN `if` SANS FILET')

/**
 * Les fonctions de catalogue qui rendent NULL sur une entrée absente, et dont
 * le NULL traverse une condition sans la déclencher.
 *
 * ⚠️ LA FENÊTRE EST LE `if … then`, PAS LE FICHIER (§E.8). Et la distinction
 *    qui compte est celle-ci : dans un `exists (select …)`, une ligne absente
 *    ne matche pas et le `not exists` fait son travail — le NULL n'y est pas
 *    un piège. Hors d'un `exists`, il en est un.
 *
 * ⚠️ ET LE `if` S'ANCRE EN DÉBUT DE LIGNE, CE QUI N'EST PAS UN DÉTAIL.
 *    Le premier jet cherchait `\bif\b` n'importe où : il mordait sur le `if`
 *    de `end if;`, ouvrait une fenêtre à cet endroit, et la fermait au `then`
 *    du bloc SUIVANT — 967 caractères qui traversaient trois instructions et
 *    traînaient le `coalesce` d'une autre. Résultat : retirer le filet d'un
 *    vrai bloc laissait le contrôle VERT, parce que la fenêtre contenait
 *    encore celui du voisin.
 *    C'est §E.40 : une fenêtre de voisinage mesure la DISTANCE au traitement,
 *    pas son APPARTENANCE. Trouvé par mutation.
 */
const STRICTES = ['pg_get_functiondef', 'pg_get_function_result', 'pg_get_constraintdef']
let avales = 0
let examines = 0
for (const [f, src] of SQL) {
  // Chaque `if … then` du fichier, pris comme un bloc entier — et le `if`
  // DOIT ouvrir sa ligne : sinon `end if;` en ouvre un faux (§E.40).
  for (const m of src.matchAll(/^[ \t]*(?:els)?if\b[\s\S]*?\bthen\b/gm)) {
    const bloc = m[0]
    if (!STRICTES.some((n) => new RegExp(`${n}\\s*\\(`).test(bloc))) continue
    // Un `exists (…)` protège : une ligne absente ne matche simplement pas.
    if (/\bexists\s*\(/.test(bloc)) continue
    // Une comparaison à NULL est explicite, elle n'avale rien.
    if (/\bis\s+(not\s+)?null\b/.test(bloc)) continue
    examines++
    if (!/\bcoalesce\s*\(/.test(bloc)) {
      avales++
      failures++
      console.log(`  KO   ${f} — un \`if\` décide sur une fonction STRICTE sans coalesce`)
      console.log(`       ${bloc.replace(/\s+/g, ' ').slice(0, 120)}…`)
    }
  }
}
ok(
  avales === 0,
  `aucun \`if\` ne se décide sur un NULL avalé (${examines} bloc(s) examiné(s))`,
  'sur une entrée absente ces fonctions rendent NULL, et `NULL not like \'%x%\'` vaut NULL : le `if` ne s\'exécute pas (§E.37)',
)
ok(
  examines > 0,
  'et des blocs de cette forme existent bien',
  'zéro bloc examiné : l\'assertion précédente est VIDE, donc toujours verte (§E.38)',
)

// ═════════════════════════════════════════════════════════════════════════════
section('C. UN RENDU QUI DÉPEND DE LA SESSION SE REND DÉTERMINISTE')

//  Le rendu d'une constante `timestamptz` passe par sa fonction de sortie, qui
//  FORMATE DANS LE FUSEAU DE LA SESSION. Une borne comparée à « 2026-09-23 »
//  se lit « 2026-09-22 17:00:00-07 » sur une session en heure du Pacifique.
//  Il n'existe pas de `to_regconstraint` : on rend donc le rendu déterministe.
let sansFuseau = 0
for (const [f, src] of SQL) {
  // Un motif qui contient une DATE, comparé à une définition rendue.
  const compareUneDate = /\b(like|not like|~|!~)\s*'%?\d{4}-\d{2}-\d{2}/.test(src)
  if (!compareUneDate) continue
  if (!/set\s+local\s+time\s*zone|set\s+local\s+timezone/i.test(src)) {
    sansFuseau++
    failures++
    console.log(`  KO   ${f} — compare une DATE dans un rendu sans fixer le fuseau`)
  }
}
ok(
  sansFuseau === 0,
  'toute comparaison de date dans un rendu fixe le fuseau de la session',
  'sinon la même migration passe en UTC et lève ailleurs — en annonçant disparue une borne qui est là',
)

// ═════════════════════════════════════════════════════════════════════════════
section('D. UNE POSTCONDITION QUI SE TROMPE LIVRE DE QUOI LA CONTREDIRE')

//  ⚠️ C'EST LA LEÇON LA PLUS CHÈRE DU CAS. Le message disait « fonction
//     absente » ; la fonction existait. Quatre heures se perdent à chercher une
//     fonction qui est là parce que le refus n'a pas dit CE QU'IL A VU.
const CORRIGEES = [
  '20260923000020_verdict_ecrit_par_la_tache.sql',
  '20260923000040_bail_par_portee.sql',
]
for (const f of CORRIGEES) {
  const src = SQL.get(f)
  ok(
    src !== undefined && /::regprocedure::text/.test(src),
    `${f.slice(0, 30)}… : le refus NOMME les signatures réellement présentes`,
    'un refus qui n\'énumère pas ce qu\'il a trouvé envoie chercher dans le noir',
  )
}

// ═════════════════════════════════════════════════════════════════════════════
section('E. LES TÉMOINS — les détecteurs peuvent-ils rougir ? (§E.33)')

ok(
  sansCommentaires("  -- pg_get_function_identity_arguments(p.oid) = 'x'\n  select 1;").includes(
    'pg_get_function_identity_arguments',
  ) === false,
  'témoin : le dépouilleur SQL retire un commentaire à deux tirets',
  'sans lui, ce contrôle dénonce les commentaires qui RACONTENT le défaut (§E.7)',
)
ok(
  sansCommentaires("select 'a--b' :: text;").includes('select'),
  'témoin : … et il ne mange pas la ligne entière',
)
{
  const avale = "if pg_get_functiondef(x) not like '%y%' then"
  const filet = "if coalesce(pg_get_functiondef(x), '') not like '%y%' then"
  const dansExists = "if not exists (select 1 from pg_proc p where pg_get_functiondef(p.oid) like '%y%') then"
  const bloc = (s) => s.match(/\bif\b[\s\S]*?\bthen\b/)?.[0] ?? ''
  ok(
    !/\bcoalesce\s*\(/.test(bloc(avale)) &&
      /\bcoalesce\s*\(/.test(bloc(filet)) &&
      /\bexists\s*\(/.test(bloc(dansExists)),
    'témoin : le détecteur distingue un NULL avalé, un NULL couvert, et un `exists`',
    'sans cette distinction il rougirait sur la forme SAINE, et on le désactiverait',
  )
}
{
  //  La forme exacte qui a trompé le premier jet : un `end if;` suivi, plus
  //  bas, d'un vrai `if` sans filet. Une fenêtre non ancrée part du faux `if`
  //  et traîne le `coalesce` du bloc précédent.
  //  ⚠️ LE `coalesce` DU MILIEU EST LA PIÈCE MAÎTRESSE, et mon premier témoin
  //     l'avait oublié — il passait donc sans rien prouver. Dans le cas réel,
  //     ce `coalesce` était celui d'un message de `raise`, entre les deux
  //     blocs. C'est lui que la fenêtre flottante ramasse, et c'est lui qui la
  //     fait conclure « il y a un filet » sur un bloc qui n'en a pas.
  const piege = [
    "  if coalesce(pg_get_functiondef(a), '') not like '%x%' then",
    '    raise exception 0;',
    '  end if;',
    "  raise notice '%', coalesce(z, 'rien');",
    "  if pg_get_functiondef(b) not like '%y%' then",
    '    raise exception 0;',
    '  end if;',
  ].join('\n')
  const ancree = [...piege.matchAll(/^[ \t]*(?:els)?if\b[\s\S]*?\bthen\b/gm)]
    .map((m) => m[0])
    .filter((b) => /pg_get_functiondef\s*\(/.test(b))
  const flottante = [...piege.matchAll(/\bif\b[\s\S]*?\bthen\b/g)]
    .map((m) => m[0])
    .filter((b) => /pg_get_functiondef\s*\(/.test(b))
  //  L'ANCRÉE voit deux blocs, dont UN sans filet — elle rougirait.
  //  La FLOTTANTE ramasse le `coalesce` du voisin dans le bloc fautif — elle
  //  verdirait. Les deux moitiés comptent : la seconde seule ne prouverait pas
  //  que la parade marche, la première seule ne prouverait pas qu'elle servait.
  const bloc_b = flottante.find((b) => /pg_get_functiondef\(b\)/.test(b))
  ok(
    ancree.length === 2 &&
      ancree.filter((b) => !/\bcoalesce\s*\(/.test(b)).length === 1 &&
      bloc_b !== undefined &&
      /\bcoalesce\s*\(/.test(bloc_b),
    'témoin : la fenêtre ancrée sépare deux blocs que la fenêtre flottante mélange',
    'sans l\'ancrage, retirer le filet d\'un bloc laisse le contrôle vert grâce au filet du voisin (§E.40)',
  )
}
{
  const avecDate = "if v_def not like '%2026-09-23%' then"
  const sansDate = "if v_def not like '%on conflict%' then"
  const re = /\b(like|not like|~|!~)\s*'%?\d{4}-\d{2}-\d{2}/
  ok(
    re.test(avecDate) && !re.test(sansDate),
    'témoin : le détecteur de date ne mord que sur une DATE',
  )
}

// ═════════════════════════════════════════════════════════════════════════════
console.log(
  failures === 0
    ? '\n✅ aucune postcondition ne parie sur un format\n'
    : `\n❌ ${failures} écart(s)\n`,
)
process.exit(failures === 0 ? 0 : 1)
