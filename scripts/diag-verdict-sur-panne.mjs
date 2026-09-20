/**
 * diag-verdict-sur-panne.mjs — UNE LECTURE EN ECHEC NE REND PAS UN VERDICT METIER.
 *
 * ┌─ LA CLASSE (§E.42) ─────────────────────────────────────────────────────┐
 * │ C'est la voisine de §E.22. Dans §E.22 la valeur est NEUTRE (`null`, `[]`, │
 * │ `0`) et le defaut nait chez l'appelant. Ici la valeur est FAUSSE, et elle │
 * │ porte une AUTORITE : un 404 (« cet objet n'existe pas ») ou un 403 (« vous │
 * │ n'y avez pas droit ») rendu sur une LECTURE EN PANNE. Un 404 se met en    │
 * │ cache, se redirige, se lit par le navigateur comme un fait. Un 503 dit    │
 * │ « reessayez » — et la meme requete, une minute plus tard, reussit.        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * LE MOTIF PART DE LA GARDE, PAS DU REFUS — c'est ce qui lui fait voir la
 * moitie que `if (err || !x)` ratait : l'erreur AVALEE EN AMONT, dont la garde
 * ne voit plus qu'un `!x`. Chaque `if (…)` (parentheses equilibrees), son bloc
 * (comptage d'accolades — jamais une fenetre, §E.8), rend-il 404/403 ? puis :
 *   · la condition nomme l'erreur d'une lecture, et le refus n'est pas porte
 *     par le message de la RPC                        → CONFONDUE ;
 *   · elle teste `!x`, et `x` sort d'une lecture dont l'erreur n'est pas prise
 *     (UN saut de reaffectation suivi)                → AVALEE EN AMONT ;
 *   · le 404 vit SOUS un `includes('…not_found')` sur le message de l'erreur
 *                                                     → MOTIF PORTE PAR LA RPC ;
 *   · l'erreur est prise ailleurs                     → ERREUR PRISE AILLEURS ;
 *   · sinon (format, droit, etat)                     → HORS CLASSE.
 *
 * ┌─ LA FORME LEGITIME, RECONNUE PAR SA PROPRIETE ET NON PAR UNE LISTE ─────┐
 * │ Une RPC qui rend son motif dans son MESSAGE — `cron_job_not_found`,      │
 * │ `package_not_found` — est un CONTRAT, pas une panne : l'erreur PORTE le  │
 * │ fait metier, et le 404 dit vrai. L'echec generique, lui, rend 500/503.    │
 * │ Le controle reconnait la FORME (le 404 sous le test du message), pas des  │
 * │ chemins de fichiers : un sixieme appelant de la meme RPC sera classe de   │
 * │ lui-meme (§E.34).                                                          │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * CE QU'IL NE VOIT PAS, ET IL FAUT LE LIRE (§E.38) :
 *   · si l'objet existe VRAIMENT — un 404 sur une panne ment, un 404 sur une
 *     absence dit vrai, et la forme est la meme. SEULE LA LECTURE TRANCHE ;
 *   · un refus rendu depuis une fonction d'un AUTRE fichier ;
 *   · `notFound()` et les redirections, qui ne portent aucun statut ;
 *   · une chaine de reaffectations de plus d'un saut — ces gardes sont
 *     DECLAREES en fin de sortie, comptees, et le compte ne doit pas grossir.
 *
 * Aucune base, aucun reseau, aucun alias. §E.3 : CRLF normalise en entree.
 * Sortie : 0 vert · 1 rouge.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RACINES = ['app', 'lib', 'components']
const lire = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n')

/** §E.7 — commentaires retires SANS PERDRE DE LIGNES. */
const sansCommentaires = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l))
    .join('\n')

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else {
    echecs++
    console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`)
  }
}
const section = (t) => console.log(`\n═══ ${t} ═══\n`)

/* ══════════════════════════════════════════════════════════════════════════
 * LE MOTIF
 * ════════════════════════════════════════════════════════════════════════ */
function condition(code, i) {
  const ouvre = code.indexOf('(', i)
  if (ouvre < 0) return null
  let prof = 0
  for (let k = ouvre; k < code.length; k++) {
    if (code[k] === '(') prof++
    else if (code[k] === ')') {
      prof--
      if (prof === 0) return { cond: code.slice(ouvre + 1, k), fin: k }
    }
  }
  return null
}
function corps(code, apresCondition) {
  let k = apresCondition + 1
  while (k < code.length && /\s/.test(code[k])) k++
  if (code[k] !== '{') {
    const fin = code.indexOf('\n', k)
    return code.slice(k, fin < 0 ? code.length : fin)
  }
  let prof = 0
  for (let j = k; j < code.length; j++) {
    if (code[j] === '{') prof++
    else if (code[j] === '}') {
      prof--
      if (prof === 0) return code.slice(k, j + 1)
    }
  }
  return ''
}

// Les formes de refus reellement presentes dans le depot — y compris la
// levee `AuthError(403, …)` de requireAuth, que la premiere version ne voyait
// pas : la RACINE de la famille A vivait la (§E.42).
const REFUS = /(?:json\([\s\S]{0,200}?,\s*|status:\s*|AuthError\(\s*)(404|403)\b/
const ERREUR_DE_LECTURE = /\b(\w*[Ee]rr\w*|error)\b/
const MOTIF_RPC = /\.includes\(\s*['"][a-z_]*not_found['"]\s*\)/

function origineDirecte(code, nom, avant) {
  const source =
    '\\b(?:const|let)\\s*\\{([^}]*\\b' +
    nom +
    '\\b[^}]*)\\}\\s*=\\s*await\\s+[\\w.$]*(?:supabase|admin|client|auth)[\\w.$]*'
  const m = [...avant.matchAll(new RegExp(source, 'gi'))].at(-1)
  if (!m) return null
  return { champs: m[1].replace(/\s+/g, ' ').trim(), erreurPrise: /\berror\b/.test(m[1]) }
}
/** UN saut de reaffectation, et un seul (§E.38) : `x = data ?? null`. */
function origine(code, nom, avant) {
  const directe = origineDirecte(code, nom, avant)
  if (directe) return directe
  const aff = [...avant.matchAll(new RegExp('\\b' + nom + '\\s*=\\s*([^\\n;]+)', 'g'))].at(-1)
  if (!aff) return null
  for (const id of new Set([...aff[1].matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map((x) => x[1]))) {
    if (id === nom) continue
    const o = origineDirecte(code, id, avant)
    if (o) return o
  }
  return null
}

export function recenser(code) {
  const prises = []
  for (const m of code.matchAll(/\bif\s*\(/g)) {
    const c = condition(code, m.index)
    if (!c) continue
    const bloc = corps(code, c.fin)
    const r = REFUS.exec(bloc)
    if (!r) continue
    const cond = c.cond.replace(/\s+/g, ' ').trim()
    const ligne = code.slice(0, m.index).split('\n').length
    const statut = r[1]
    const avant = code.slice(0, m.index)

    const err = ERREUR_DE_LECTURE.exec(cond)
    if (err) {
      const dUneLecture = origine(code, err[1], avant) !== null || /\.error\b/.test(cond)
      if (!dUneLecture) {
        prises.push({ ligne, statut, classe: 'HORS CLASSE', cond })
        continue
      }
      // Le refus est-il porte par le MESSAGE de l'erreur ? On regarde ce qui
      // precede le STATUT DANS le bloc : un `includes('…not_found')` sur la
      // condition elle-meme, ou sur un `if` imbrique avant le refus. On coupe
      // a la fin du match et non a son debut : le motif de refus est lache
      // (`json(…, 404` sur 200 caracteres) et peut demarrer sur un `json(`
      // voisin — un 409 juste avant le 404, cas reel de `cron-jobs/run`.
      const avantRefus = bloc.slice(0, r.index + r[0].length)
      const porteParLaRpc = MOTIF_RPC.test(cond) || MOTIF_RPC.test(avantRefus)
      prises.push({ ligne, statut, classe: porteParLaRpc ? 'MOTIF PORTE PAR LA RPC' : 'CONFONDUE', cond })
      continue
    }

    const nom = /^!?\s*([A-Za-z_$][\w$]*)/.exec(cond)?.[1]
    const o = nom ? origine(code, nom, avant) : null
    // `const org = auth.organization` : la lecture vit dans requireAuth, et sa
    // panne y LEVE deja 503 (§E.22 ①, sentinelle en A). `null` y veut dire
    // « aucune organisation », et rien d'autre : c'est un DROIT, hors classe.
    const droitAmont =
      nom && new RegExp('\\b' + nom + '\\s*=\\s*[\\w$]+\\.organization\\b').test(avant)
    if (o && !o.erreurPrise) prises.push({ ligne, statut, classe: 'AVALEE EN AMONT', cond })
    else if (o) prises.push({ ligne, statut, classe: 'ERREUR PRISE AILLEURS', cond })
    else if (droitAmont) prises.push({ ligne, statut, classe: 'HORS CLASSE', cond })
    else if (nom && /^!?\s*\w+\s*$/.test(cond)) prises.push({ ligne, statut, classe: 'NON RESOLUE', cond })
    else prises.push({ ligne, statut, classe: 'HORS CLASSE', cond })
  }
  return prises
}
const SUSPECTES = new Set(['CONFONDUE', 'AVALEE EN AMONT'])

/* ══════════════════════════════════════════════════════════════════════════
 * A. LE MOTIF EST EPROUVE SUR SES CAS CONNUS — AVANT TOUT BALAYAGE (§E.33).
 *    Les temoins sont CE QUI A DISPARU : le code tel qu'il etait le 20/09/2026.
 * ════════════════════════════════════════════════════════════════════════ */
section('A. LE MOTIF, EPROUVE SUR SES CAS CONNUS')

const AVALEE_AVANT = [
  '  if (token) {',
  "    const { data } = await admin.from('organization_invitations').select(COLS).maybeSingle()",
  '    invitation = (data as unknown as Inv | null) ?? null',
  '  }',
  "  if (!invitation) { return json({ error: 'Invitation not found', code: 'not_found' }, 404) }",
].join('\n')
const CONFONDUE_AVANT = [
  "  const { data: userRow, error: userErr } = await auth.supabaseAdmin.from('users').select('x').maybeSingle()",
  "  if (userErr || !userRow) { return json({ error: 'User not found', code: 'user_missing' }, 404) }",
].join('\n')
const RACINE_AVANT = [
  "  const { data: userRow, error: userErr } = await supabaseAdmin.from('users').select('id').maybeSingle()",
  "  if (userErr) { throw new AuthError(403, { error: 'User not found', code: 'user_lookup_failed' }) }",
].join('\n')
const APRES = [
  "  const { data: userRow, error: userErr } = await auth.supabaseAdmin.from('users').select('x').maybeSingle()",
  "  if (userErr) { return json({ error: 'Could not read', code: 'compte_verification_indisponible' }, 503) }",
  "  if (!userRow) { return json({ error: 'User not found', code: 'user_missing' }, 404) }",
].join('\n')
const RPC_LEGITIME = [
  "  const { error: setErr } = await auth.supabaseAdmin.rpc('admin_cron_set_active', { p: 1 })",
  '  if (setErr) {',
  "    if ((setErr.message ?? '').includes('cron_job_not_found')) {",
  "      return json({ error: 'Job not found', code: 'not_found' }, 404)",
  '    }',
  "    return json({ error: 'Could not change state', code: 'toggle_failed' }, 500)",
  '  }',
].join('\n')
const FORMAT = "  if (!id || !UUID_REGEX.test(id)) { return json({ error: 'Invalid id', code: 'invalid_id' }, 404) }"

const suspectes = (code) => recenser(code).filter((p) => SUSPECTES.has(p.classe))
{
  const a = suspectes(AVALEE_AVANT)
  ok(a.length === 1 && a[0].classe === 'AVALEE EN AMONT', 'il VOIT la lecture avalee en amont, valeur RENOMMEE (accept:94 tel qu il etait)', JSON.stringify(a))
  const c = suspectes(CONFONDUE_AVANT)
  ok(c.length === 1 && c[0].classe === 'CONFONDUE', 'il VOIT la garde confondue `if (err || !x) → 404` (reactivate:55 tel qu il etait)', JSON.stringify(c))
  const r = suspectes(RACINE_AVANT)
  ok(r.length === 1 && r[0].statut === '403', 'il VOIT la levee `AuthError(403)` sur une lecture (auth-guard:279 tel qu il etait)', JSON.stringify(r))
  ok(suspectes(APRES).length === 0, 'il se TAIT sur le correctif — un balayage qui rend zero se prouve')
  const l = recenser(RPC_LEGITIME)
  ok(
    l.length >= 1 && l.every((p) => p.classe === 'MOTIF PORTE PAR LA RPC'),
    'il RECONNAIT la forme legitime — le 404 sous `includes(…not_found)` porte le fait metier',
    JSON.stringify(l),
  )
  const f = recenser(FORMAT)
  ok(f.length === 1 && f[0].classe === 'HORS CLASSE', 'une validation de FORMAT n est pas denoncee')

  // SENTINELLE de la regle « droit amont » : `const org = auth.organization`
  // n'est hors classe QUE parce que requireAuth leve 503 quand la lecture de
  // l'organisation echoue. Si cette levee disparait, la regle ment, et les
  // vingt `if (!org) → 403` du depot redeviennent des verdicts sur une panne.
  const garde = sansCommentaires(lire(join(ROOT, 'lib/auth-guard.ts')))
  const debutOrg = garde.indexOf('async function loadOrganizationContext(')
  const finOrg = garde.indexOf('\nexport ', debutOrg)
  const corpsOrg = debutOrg >= 0 ? garde.slice(debutOrg, finOrg < 0 ? undefined : finOrg) : ''
  ok(
    /if\s*\(\s*memberErr\s*\)[\s\S]{0,600}?throw new AuthError\(\s*503\b/.test(corpsOrg),
    'sentinelle — loadOrganizationContext LEVE 503 sur memberErr (ce qui rend `!auth.organization` hors classe)',
    'la regle « droit amont » n a plus de fondement : requireAuth ne distingue plus la panne de l absence',
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * B. LE BALAYAGE
 * ════════════════════════════════════════════════════════════════════════ */
section('B. LE BALAYAGE — app/ + lib/ + components/')

const fichiers = []
const marche = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) marche(p)
    else if (/\.tsx?$/.test(p)) fichiers.push(p)
  }
}
for (const r of RACINES) marche(join(ROOT, r))

/**
 * EXEMPTIONS — une raison PAR ENTREE et une SENTINELLE (§G.8) : si ce qui
 * justifie l'exemption disparait, l'exemption tombe et le controle rougit.
 */
const EXEMPTIONS = {
  'app/api/invitations/resolve/route.ts': {
    raison:
      'Reponse volontairement UNIFORME (decision de securite, 20/09/2026) : un attaquant qui sonde ' +
      'des jetons ne doit pas distinguer « invalide » de « expire » de « lecture en panne ». Le 404 ' +
      'ment donc vers l EXTERIEUR par choix. La sentinelle exige que la panne soit JOURNALISEE vers ' +
      'l INTERIEUR : le silence vers l attaquant ne justifie pas le silence vers l exploitant.',
    sentinelle: /console\.error\([^)]*\berror\b/,
  },
}

const toutes = []
for (const f of fichiers) {
  const rel = relative(ROOT, f).replace(/\\/g, '/')
  for (const p of recenser(sansCommentaires(lire(f)))) toutes.push({ rel, ...p })
}
const par = {}
for (const p of toutes) par[p.classe] = (par[p.classe] ?? 0) + 1
console.log(`  ${fichiers.length} fichiers · ${toutes.length} gardes rendant 404/403`)
for (const [k, v] of Object.entries(par).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)
console.log('')

const suspects = toutes.filter((p) => SUSPECTES.has(p.classe))
const exemptes = suspects.filter((p) => p.rel in EXEMPTIONS)
const nonExemptes = suspects.filter((p) => !(p.rel in EXEMPTIONS))

for (const rel of Object.keys(EXEMPTIONS)) {
  const ex = EXEMPTIONS[rel]
  ok(
    ex.sentinelle.test(sansCommentaires(lire(join(ROOT, rel)))),
    `${rel} — exemptee, et sa sentinelle tient : ${ex.raison.slice(0, 60)}…`,
    'la panne n est plus journalisee : l exemption tombe',
  )
}
ok(
  nonExemptes.length === 0,
  `aucune garde ne rend un verdict metier sur une lecture en panne (${exemptes.length} exemptee(s) avec raison)`,
  nonExemptes.map((p) => `${p.rel}:${p.ligne} [${p.statut}] ${p.classe} — if (${p.cond.slice(0, 60)})`).join('\n       '),
)

// La forme legitime est COMPTEE et nommee — elle a ete prise pour un defaut
// une fois ; on l'ecrit pour que ca ne se refasse pas.
const rpc = toutes.filter((p) => p.classe === 'MOTIF PORTE PAR LA RPC')
console.log(`\n  ${rpc.length} refus portes par le MESSAGE d une RPC — un contrat, pas une panne :`)
for (const p of rpc) console.log(`      ${p.rel}:${p.ligne} [${p.statut}]`)

/* ══════════════════════════════════════════════════════════════════════════
 * C. CE QUE LE MOTIF NE RESOUT PAS — DECLARE, COMPTE, ET LE COMPTE NE GROSSIT PAS.
 *    Un etat MESURE (§G.8), pas une exemption : chaque ligne reste a lire.
 * ════════════════════════════════════════════════════════════════════════ */
section('C. LES GARDES QUE LE MOTIF NE RESOUT PAS — lues une par une, gelees nommement')

/**
 * GEL du 20/09/2026 — un ETAT MESURE, pas des exemptions (§G.8) : le motif ne
 * remonte pas leur origine en un saut, donc il ne les JUGE pas. Chacune a ete
 * LUE, et sa raison commence par LEGITIME. Une garde NEUVE que le motif ne
 * resout pas rougit : on la lit, puis on l'ajoute ICI avec sa raison — jamais
 * en relevant un plafond. Cle = fichier + condition, pas le numero de ligne,
 * qui bouge a chaque edition (§E.34).
 */
const GEL_NON_RESOLUES = {
  'app/api/admin/cron-jobs/[name]/runs/route.ts | !job':
    'LEGITIME — `job` derive de `overviewRes.data` (Promise.all, destructuration de tableau) ; `overviewRes.error` sort en 500 juste avant',
  'app/api/candidatures/[id]/pitch/route.ts | !pub':
    'LEGITIME — `pub` derive de `cand.publications` ; `candErr` sort en 500 et `!candData` en 404 AVANT, deux sauts plus haut',
  'app/api/conversations/[id]/messages/route.ts | !cand':
    'LEGITIME (deux occurrences) — `cand = pickRel(conv.candidatures)` ; la lecture de `conv` sort en 500 sur erreur dans `loadConvAsParticipant`, puis `!loaded.ok` est rendu tel quel',
  'app/api/invitations/resolve/route.ts | !token':
    'LEGITIME — un parametre de requete vide : validation de FORMAT, aucune lecture',
  'app/api/me/invitations/accept/route.ts | block':
    "LEGITIME — `block === 'indisponible'` sort en 503 sur la ligne PRECEDENTE (§E.22 ⑥) ; ce qui reste est un motif metier",
  'app/api/me/missions/route.ts | !isApproved':
    'LEGITIME — `isApproved` sort de `feedCtx.context`, et `!feedCtx.ok` a rendu 500 juste avant',
}
const nonResolues = toutes.filter((p) => p.classe === 'NON RESOLUE')
const cle = (p) => `${p.rel} | ${p.cond}`
console.log(`  ${nonResolues.length} garde(s) \`!x\` dont l origine n est pas remontee en un saut :`)
for (const p of nonResolues) console.log(`      ${p.rel}:${p.ligne} [${p.statut}] if (${p.cond})`)
const neuves = nonResolues.filter((p) => !(cle(p) in GEL_NON_RESOLUES))
const sorties = Object.keys(GEL_NON_RESOLUES).filter((k) => !nonResolues.some((p) => cle(p) === k))
ok(
  neuves.length === 0,
  `aucune garde non resolue NEUVE (${Object.keys(GEL_NON_RESOLUES).length} entrees gelees, toutes lues)`,
  neuves.map((p) => `${p.rel}:${p.ligne} if (${p.cond}) — la LIRE, puis l ajouter au gel avec sa raison`).join('\n       '),
)
ok(
  sorties.length === 0,
  'aucune entree du gel n a disparu sans qu on le dise',
  `sortie(s) du gel : ${sorties.join(' ; ')} — retirer la ligne, ou verifier que la garde n est pas devenue autre chose`,
)
ok(
  Object.values(GEL_NON_RESOLUES).every((r) => /^LEGITIME\b/.test(r)),
  'chaque raison du gel commence par LEGITIME — et « juge » veut dire LU, pas acquitte (§G.8)',
)

console.log('')
if (echecs > 0) {
  console.log(`✘ ${echecs} CONTROLE(S) EN ECHEC`)
  process.exit(1)
}
console.log('✅ Une lecture en echec rend 503, jamais un verdict — et le motif a prouve qu il voit.')
