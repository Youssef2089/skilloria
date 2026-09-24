// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  diag-audit-jamais-nul — UNE TRACE D'AUDIT NE PASSE JAMAIS `null` À UNE
//  COLONNE NOT NULL. Sinon elle n'existe pas, et personne ne le sait.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
//  ┌─ LE CAS, MESURÉ LE 24/09/2026 SUR LE DÉPÔT ────────────────────────────┐
//  │ Sept appels à `logAudit` passaient `entity_id: null`. La colonne est   │
//  │ `uuid NOT NULL` depuis la baseline. `logAudit` est best-effort — il    │
//  │ journalise l'échec en console et n'échoue jamais l'appelant. Postgres  │
//  │ rejetait donc l'insert, et la route répondait « enregistré ».         │
//  │                                                                        │
//  │ SIX DES SEPT ÉTAIENT DES RÉGLAGES D'ARGENT : tarifs des modèles,       │
//  │ plafond global, alertes par acteur, plafond par acteur, quota de CV,   │
//  │ durées de la place. Aucune de ces traces n'a jamais existé.            │
//  │                                                                        │
//  │ ET LE COMPILATEUR EN A TROUVÉ TROIS DE PLUS, que le balayage ne pouvait│
//  │ pas voir : `domain_id` passé depuis une VARIABLE typée nullable. Aucun │
//  │ `null` littéral — un `grep` ne les aurait jamais attrapés.            │
//  └────────────────────────────────────────────────────────────────────────┘
//
//  ═══ LA PARADE EST LE TYPE, ET CE CONTRÔLE GARDE LE TYPE ═════════════════
//    `AuditLogParams` exige désormais `entity_id: string`, `entity_type:
//    string`, `domain_id: string` — sans `?`, sans `| null`. C'est `tsc` qui
//    nomme les appels fautifs, un à un, à la compilation.
//
//    Ce contrôle ne refait pas le travail du compilateur. Il garde CE QUI
//    RENDRAIT LE COMPILATEUR AVEUGLE :
//      ① le type lui-même — qu'on ne le rouvre pas en `string | null` ;
//      ② les CASTS qui le contournent — `as string` sur une valeur nullable
//         compile, et arrive nulle à l'exécution ;
//      ③ le `??` qui « répare » en inventant — `entity_id ?? null` dans
//         `logAudit` était exactement ce qui transmettait le null ;
//      ④ la contrainte en base — si elle tombait, le type serait une règle
//         sans raison.
//
//  ⚠️ CE QU'IL NE VÉRIFIE PAS : que la VALEUR passée soit le bon identifiant.
//     Un UUID dérivé du mauvais nom compile et s'insère. Ce qu'il garde, c'est
//     qu'une trace EXISTE ; ce qu'elle raconte se relit à l'écran.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-audit-jamais-nul.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE variable d'environnement.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { identifiantDerive } from '../lib/admin/identifiant-derive.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const sansCommentaires = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

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
//  BALAYÉS : `app/` et `lib/` — tout ce qui peut appeler `logAudit`.
//  EXCLUS : `components/` (aucun appel serveur n'y vit — un composant client
//    n'a pas la clé service), `scripts/` (un banc n'écrit pas d'audit, et
//    `diag-scripts-destructeurs` garde ceux qui écrivent), `supabase/` (lu à
//    part, pour la contrainte).
const DOSSIERS = ['app', 'lib']
const fichiers = (d, out = []) => {
  for (const e of readdirSync(join(ROOT, d))) {
    const rel = `${d}/${e}`
    if (statSync(join(ROOT, rel)).isDirectory()) fichiers(rel, out)
    else if (/\.(ts|tsx)$/.test(e)) out.push(rel)
  }
  return out
}
const TOUS = DOSSIERS.flatMap((d) => fichiers(d))
const SOURCE = new Map(TOUS.map((f) => [f, sansCommentaires(read(f))]))

console.log('\nUNE TRACE D\'AUDIT EXISTE, OU LE COMPILATEUR REFUSE\n')
console.log(`périmètre : ${TOUS.length} fichiers dans ${DOSSIERS.join(', ')}`)

// ═════════════════════════════════════════════════════════════════════════════
section('A. LE TYPE EXIGE LES TROIS COLONNES NOT NULL — sans `?`, sans `| null`')

const AUDIT = SOURCE.get('lib/audit.ts')
const TYPE = AUDIT.match(/export type AuditLogParams = \{[\s\S]*?\n\}/)
ok(TYPE !== null, 'le type des paramètres d\'audit est identifiable')
for (const champ of ['entity_id', 'entity_type', 'domain_id']) {
  const ligne = TYPE && TYPE[0].match(new RegExp(`^\\s*${champ}(\\??):\\s*([^\\n]+)$`, 'm'))
  ok(
    ligne !== null && ligne[1] === '' && /^string\s*$/.test(ligne[2].trim()),
    `\`${champ}\` est OBLIGATOIRE et de type \`string\` — pas \`?\`, pas \`| null\``,
    ligne
      ? `déclaré « ${champ}${ligne[1]}: ${ligne[2].trim()} » — un null y passerait, et Postgres rejetterait l'insert en silence`
      : `champ absent du type`,
  )
}

//  ③ Le `??` qui inventait un null : c'est lui qui transmettait le défaut.
const CORPS = AUDIT.match(/export async function logAudit\([\s\S]*?\n\}\n/)
ok(CORPS !== null, 'le corps de logAudit est identifiable')
ok(
  CORPS !== null && !/entity_(id|type)\s*\?\?\s*null/.test(CORPS[0]) && !/domain_id\s*\?\?\s*null/.test(CORPS[0]),
  'logAudit ne remplace plus une valeur absente par `null`',
  '`entity_id ?? null` était exactement ce qui transmettait le null à Postgres',
)

// ═════════════════════════════════════════════════════════════════════════════
section('B. AUCUN APPEL NE CONTOURNE LE TYPE')

//  Chaque appel `logAudit({ … })`, pris comme un OBJET entier — accolades
//  équilibrées, pas une fenêtre de N lignes (§E.40).
function objetsLogAudit(src) {
  const out = []
  const re = /logAudit\s*\(\s*\{/g
  let m
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 1
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    out.push(src.slice(m.index, i))
  }
  return out
}

let appels = 0
const contournements = []
for (const [f, src] of SOURCE) {
  if (f === 'lib/audit.ts') continue
  for (const objet of objetsLogAudit(src)) {
    appels++
    for (const champ of ['entity_id', 'entity_type', 'domain_id']) {
      // Un null LITTÉRAL — la forme d'origine.
      if (new RegExp(`\\b${champ}\\s*:\\s*null\\b`).test(objet)) contournements.push(`${f} — ${champ}: null`)
      // Un CAST qui fait taire le compilateur sur une valeur nullable.
      if (new RegExp(`\\b${champ}\\s*:[^,\\n]*\\bas\\s+string\\b`).test(objet)) contournements.push(`${f} — ${champ} … as string`)
      // Un `!` non-null qui promet sans garantir.
      if (new RegExp(`\\b${champ}\\s*:[^,\\n]*\\w!\\s*,`).test(objet)) contournements.push(`${f} — ${champ} … !`)
    }
  }
}
ok(appels >= 80, `les appels à logAudit sont découverts (${appels})`, 'aucun appel trouvé : le balayage est vide')
ok(
  contournements.length === 0,
  'aucun appel ne passe un null littéral, un cast `as string` ni un `!` sur ces trois champs',
  contournements.length ? contournements.join(' ; ') : undefined,
)

// ═════════════════════════════════════════════════════════════════════════════
section('C. UN OBJET SANS UUID PASSE PAR L\'IDENTIFIANT DÉRIVÉ — un seul dériveur')

//  Les réglages clés par un texte — tarifs, plafonds, quotas, durées — et le
//  catalogue n'ont pas d'UUID. Ils passent par `identifiantDerive`, et la
//  tâche planifiée y DÉLÈGUE : deux dériveurs finiraient par différer.
const CRON = SOURCE.get('lib/admin/cron-audit-id.ts')
ok(
  /identifiantDerive\s*\(\s*'cron_job'/.test(CRON) && !/createHash/.test(CRON),
  'le dériveur des tâches DÉLÈGUE au dériveur général',
  'un second hachage divergerait du premier sur un préfixe, et les lignes d\'une tâche cesseraient de se regrouper (§E.20)',
)
ok(
  identifiantDerive('cron_job', 'x') !== identifiantDerive('reglage', 'x'),
  'deux espaces donnent deux identifiants pour la même clé',
  'sans espace, une tâche nommée comme un réglage porterait la même empreinte',
)
ok(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(identifiantDerive('reglage', 'ai_spend_caps')),
  'l\'identifiant dérivé a la forme d\'un uuid — Postgres l\'accepte dans une colonne `uuid`',
)
ok(
  identifiantDerive('cron_job', 'purge_inactive_trigger') === identifiantDerive('cron_job', 'purge_inactive_trigger'),
  'et il est STABLE : la même clé, toujours la même empreinte',
)

//  Les six réglages d'argent passent bien par lui — découverts par la
//  PROPRIÉTÉ (une route admin qui écrit une table de réglage), pas listés.
const REGLAGES = ['ai_model_tarifs', 'ai_spend_caps', 'ai_spend_seuils_acteur', 'ai_quotas', 'duree_reglages']
//  L'ÉCRITURE PEUT PASSER PAR UNE RPC — le grand livre (§D.26) fait écrire
//  `duree_reglages` par `regler_durees_place()`. Les fonctions SQL qui écrivent
//  une table de réglage sont DÉCOUVERTES dans les migrations, et une route qui
//  les appelle est un écrivain : le périmètre inclut le SQL (§E.61), sinon la
//  première route passée par une RPC sortirait du contrôle sans qu'il le dise.
const RPC_DE_REGLAGE = (() => {
  const noms = new Set()
  for (const f of readdirSync(join(ROOT, 'supabase/migrations')).filter((x) => x.endsWith('.sql'))) {
    const sql = read(`supabase/migrations/${f}`).split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    for (const m of sql.matchAll(/create or replace function public\.(\w+)\(/g)) {
      const fin = /\$[a-z]*\$;/g
      fin.lastIndex = m.index
      const f2 = fin.exec(sql)
      const corps = sql.slice(m.index, f2 ? f2.index + f2[0].length : undefined)
      if (REGLAGES.some((t) => new RegExp(`(update|insert into)\\s+public\\.${t}\\b`).test(corps))) noms.add(m[1])
    }
  }
  return [...noms]
})()
const routesDeReglage = TOUS.filter((f) => {
  const s = SOURCE.get(f)
  if (!/^app\/api\/admin\//.test(f)) return false
  return REGLAGES.some((t) => new RegExp(`\\.from\\('${t}'\\)\\s*\\.\\s*(update|upsert|insert)`).test(s))
    || RPC_DE_REGLAGE.some((fn) => s.includes(`.rpc('${fn}'`))
})
ok(routesDeReglage.length >= 4,
  `les routes qui ÉCRIVENT un réglage sont découvertes (${routesDeReglage.length} ; RPC de réglage vues dans le SQL : ${RPC_DE_REGLAGE.join(', ') || 'aucune'})`)
const sansDerive = routesDeReglage.filter((f) => !/identifiantDerive\s*\(/.test(SOURCE.get(f)))
ok(
  sansDerive.length === 0,
  'chacune trace avec un identifiant DÉRIVÉ',
  sansDerive.length ? `sans dériveur : ${sansDerive.join(', ')}` : undefined,
)

// ═════════════════════════════════════════════════════════════════════════════
section('D. LA CONTRAINTE EN BASE EST BIEN LA RAISON DU TYPE')

const BASELINE = read('supabase/migrations/00000000000000_baseline.sql')
const DDL = BASELINE.match(/CREATE TABLE IF NOT EXISTS "public"\."audit_logs" \([\s\S]*?\n\);/)
ok(DDL !== null, 'la définition de audit_logs est identifiable dans la baseline')
for (const champ of ['entity_id', 'entity_type', 'domain_id']) {
  ok(
    DDL !== null && new RegExp(`"${champ}"[^\\n]*NOT NULL`).test(DDL[0]),
    `\`${champ}\` est NOT NULL en base`,
    'si la contrainte tombait, le type serait une règle sans raison — et il faudrait le dire ici',
  )
}
//  … et aucune migration ne l'a relâchée depuis.
const relachements = readdirSync(join(ROOT, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql') && !f.startsWith('00000000000000'))
  .filter((f) => /alter table (if exists )?"?public"?\."?audit_logs"?[\s\S]{0,200}drop not null/i.test(read(`supabase/migrations/${f}`)))
ok(relachements.length === 0, 'aucune migration ne relâche ces NOT NULL', relachements.join(', ') || undefined)

// ═════════════════════════════════════════════════════════════════════════════
section('E. LES TÉMOINS — les détecteurs peuvent-ils rougir ? (§E.33)')

{
  const objets = objetsLogAudit("x; await logAudit({ a: { b: 1 }, entity_id: null }); y; logAudit({ entity_id: id })")
  ok(objets.length === 2 && /entity_id\s*:\s*null/.test(objets[0]) && !/entity_id\s*:\s*null/.test(objets[1]),
    'témoin : l\'extraction d\'objet équilibre les accolades et sépare deux appels')
}
ok(
  /\bentity_id\s*:[^,\n]*\bas\s+string\b/.test("entity_id: (ligne.domain_id as string),") &&
    !/\bentity_id\s*:[^,\n]*\bas\s+string\b/.test("entity_id: ligne.id,"),
  'témoin : le détecteur de cast voit `as string` et laisse une valeur franche',
)
{
  const type = 'export type AuditLogParams = {\n  domain_id: string | null\n  entity_id?: string\n}'
  const l1 = type.match(/^\s*domain_id(\??):\s*([^\n]+)$/m)
  const l2 = type.match(/^\s*entity_id(\??):\s*([^\n]+)$/m)
  ok(
    l1 && !/^string\s*$/.test(l1[2].trim()) && l2 && l2[1] === '?',
    'témoin : le lecteur de type voit un `| null` et un `?`',
  )
}

console.log(failures === 0 ? '\n✅ une trace d\'audit existe, ou le compilateur refuse\n' : `\n❌ ${failures} écart(s)\n`)
process.exit(failures === 0 ? 0 : 1)
