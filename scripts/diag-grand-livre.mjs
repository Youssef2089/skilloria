#!/usr/bin/env node
// scripts/diag-grand-livre.mjs — LE SOCLE DU GRAND LIVRE TIENT : liste
// fermée, ajout seul, fonction unique, pièce explicite, preuve exécutée (§D.26).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE CE CONTRÔLE GARDE
//   A. LA LISTE EST FERMÉE ET UNIQUE : les codes du seed SQL et ceux de
//      `lib/journal/actions.ts` sont les mêmes, dans les deux sens ; les
//      quinze actions imposées par le mandat y sont ; chaque « refus_… »
//      impose le statut « refuse ».
//   B. LA TABLE ET LE VERROU : les quatorze colonnes, les neuf contraintes,
//      les privilèges repris à tous les rôles applicatifs (service_role ne
//      garde que la lecture), le trigger BEFORE UPDATE OR DELETE qui lève en
//      GL001, le trigger TRUNCATE, le seul chemin de suppression reconnu de
//      l'intérieur (réglage local), et la DATE EN TÊTE de chaque index de
//      filtre — les deux exceptions nommées.
//   C. LA FONCTION UNIQUE : `journaliser()` exige pièce et type (GL002),
//      refuse un type hors liste et un statut contraire (GL003), retire les
//      clés personnelles ; UN SEUL `insert into public.grand_livre` dans tout
//      le dépôt ; aucune écriture directe ni aucun appel RPC hors de la porte
//      TypeScript ; la pièce y est un paramètre OBLIGATOIRE et jamais
//      inventée ; aucun contexte ambiant (`AsyncLocalStorage`).
//   D. L'ACTION RÉELLE : /api/admin/durees crée sa pièce AVANT toute écriture
//      et écrit par `regler_durees_place()`, qui met à jour ET journalise dans
//      la même fonction ; `effacer_adresses_ip()` génère sa pièce en SQL et
//      journalise SUCCÈS et ÉCHEC, chacun dans son bloc.
//   E. LE DÉRIVEUR SQL = LE DÉRIVEUR TYPESCRIPT : le témoin de la
//      postcondition est RECALCULÉ ici par le module TypeScript.
//   F. LA POSTCONDITION S'EXÉCUTE : sondes GL002/GL003, UPDATE et DELETE qui
//      doivent lever, privilèges interrogés, deux actions réelles rejouées,
//      tout annulé.
//   G. AUCUNE DONNÉE PERSONNELLE dans un détail passé au grand livre —
//      détecteur PARTAGÉ avec le journal d'audit (scripts/lib/detail-sans-pii).
//
// CE QU'IL NE VÉRIFIE PAS, ET LE DIT
//   · que les actions de la liste sont TOUTES branchées : c'est l'étape 2 —
//     aujourd'hui deux le sont, et ce contrôle garde que celles-là passent par
//     la fonction ;
//   · la base elle-même : ce contrôle lit le dépôt, c'est la postcondition
//     qui exécute (§E.67).
//
//   node scripts/diag-grand-livre.mjs   → statique, aucun accès base.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { blocApres, appelsDe, chargerClesPersonnelles, fabriquerDetecteur } from './lib/detail-sans-pii.mjs'
import { identifiantDerive } from '../lib/admin/identifiant-derive.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const stripTs = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*')).join('\n')
const stripSql = (src) => src.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

function migration(suffixe) {
  const hits = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith(`_${suffixe}.sql`))
  if (hits.length !== 1) throw new Error(`migration « ${suffixe} » : ${hits.length} correspondance(s)`)
  return `supabase/migrations/${hits[0]}`
}
function fichiers(dir, out = []) {
  for (const e of readdirSync(join(ROOT, dir))) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
    const rel = `${dir}/${e}`
    if (statSync(join(ROOT, rel)).isDirectory()) fichiers(rel, out)
    else if (/\.(ts|tsx)$/.test(e)) out.push(rel)
  }
  return out
}
/** Le corps d'une fonction SQL : de sa création à la fin de son `$fn$;` / `$$;`. */
function corpsSql(sql, nomAvecParenthese) {
  const i = sql.indexOf(`function ${nomAvecParenthese}`)
  if (i < 0) return ''
  // la création ouvre avec `as $x$` : le corps va jusqu'au `$x$;` qui suit
  const ouverture = /as \$([a-z]*)\$/g
  ouverture.lastIndex = i
  const o = ouverture.exec(sql)
  if (!o) return ''
  const fermeture = `$${o[1]}$;`
  const fin = sql.indexOf(fermeture, o.index + o[0].length)
  return fin < 0 ? sql.slice(i) : sql.slice(i, fin + fermeture.length)
}

const MIG = migration('grand_livre')
const SQL = stripSql(read(MIG))
const TOUTES_MIGRATIONS = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()
const SQL_PAR_MIGRATION = new Map(TOUTES_MIGRATIONS.map((f) => [f, stripSql(read(`supabase/migrations/${f}`))]))
/**
 * LA DERNIÈRE DÉFINITION d'une fonction, toutes migrations confondues : c'est
 * elle qui vit en base. Une migration ultérieure qui remplace `journaliser()`
 * (la liste blanche l'a fait) est celle qu'on lit — pas la première.
 */
function derniereDefinition(nomAvecParenthese) {
  let trouvee = { fichier: null, corps: '' }
  for (const f of TOUTES_MIGRATIONS) {
    const src = SQL_PAR_MIGRATION.get(f)
    if (src.includes(`create or replace function ${nomAvecParenthese}`)) trouvee = { fichier: f, corps: corpsSql(src, nomAvecParenthese) }
  }
  return trouvee
}
/**
 * TOUTES les fonctions SQL dans leur DERNIÈRE définition : nom → { fichier,
 * corps, params }. Les paramètres sont lus dans la signature — c'est par leur
 * TYPE (`jsonb`) que le détecteur de données personnelles sait quels arguments
 * d'un appel `.rpc()` portent un détail, sans liste tenue à la main (§E.61).
 */
const DEFINITIONS_COURANTES = (() => {
  const defs = new Map()
  for (const f of TOUTES_MIGRATIONS) {
    const src = SQL_PAR_MIGRATION.get(f)
    for (const m of src.matchAll(/create or replace function public\.(\w+)\(/g)) {
      const corps = corpsSql(src.slice(m.index), `public.${m[1]}(`)
      const signature = (blocApres(corps, `public.${m[1]}(`, '(', ')') ?? '()').slice(1, -1)
      const params = []
      let depth = 0
      let courant = ''
      for (const ch of signature + ',') {
        if (ch === '(') depth++
        if (ch === ')') depth--
        if (ch === ',' && depth === 0) {
          const [nom, type] = courant.trim().split(/\s+/)
          if (nom) params.push({ nom, type: (type ?? '').toLowerCase() })
          courant = ''
        } else courant += ch
      }
      defs.set(m[1], { fichier: f, corps, params })
    }
  }
  return defs
})()
/**
 * Les ÉCRIVAINS du grand livre côté SQL : `journaliser()` et toute fonction
 * qui l'appelle, directement ou par une autre — découverts par point fixe,
 * jamais listés (§E.61). Un écrivain métier ajouté demain est vu sans qu'on
 * l'inscrive nulle part.
 */
const ECRIVAINS_SQL = (() => {
  const ecrivains = new Set(['journaliser'])
  for (let bouge = true; bouge; ) {
    bouge = false
    for (const [nom, def] of DEFINITIONS_COURANTES) {
      if (ecrivains.has(nom)) continue
      if ([...ecrivains].some((e) => new RegExp(`\\b${e}\\(`).test(def.corps))) {
        ecrivains.add(nom)
        bouge = true
      }
    }
  }
  return ecrivains
})()
/**
 * LES PORTES TypeScript : un écrivain SQL dont le seul métier est de journaliser
 * a UNE enveloppe côté code, et c'est la seule qui l'appelle. Le détail y est
 * une variable par construction (c'est le paramètre de la porte) : on ne le
 * juge pas là, on le juge chez ses APPELANTS.
 */
const PORTES = new Map([
  ['journaliser', 'lib/journal/journaliser.ts'],
  ['journaliser_reglage', 'lib/journal/reglages.ts'],
])
/**
 * Les arguments qu'un écrivain SQL passe à un AUTRE écrivain — c'est là, et
 * là seulement, que ses paramètres jsonb deviennent un détail du grand livre.
 * `regler_note_jugement(p_config jsonb, …)` écrit `p_config` dans SA table ;
 * seuls `p_avant` et `p_apres` partent au journal, et le détecteur ne juge
 * que ceux-là — un paramètre jsonb n'est pas un détail parce qu'il est jsonb.
 */
function argumentsVersLeJournal(nom) {
  const corps = DEFINITIONS_COURANTES.get(nom)?.corps ?? ''
  let out = ''
  for (const w of ECRIVAINS_SQL) {
    if (w === nom) continue
    let from = 0
    for (;;) {
      const i = corps.indexOf(`${w}(`, from)
      if (i < 0) break
      if (!/\w/.test(corps[i - 1] ?? ' ')) out += (blocApres(corps.slice(i), `${w}(`, '(', ')') ?? '') + '\n'
      from = i + w.length
    }
  }
  return out
}
/**
 * Les arguments d'un appel `f(…)` rendu par `appelsDe` — découpés à la VIRGULE
 * DE PREMIER NIVEAU. Parenthèses et littéraux imbriqués ne coupent pas :
 * `journaliser(p, case when x then 'a' else 'b' end, …)` rend bien trois
 * arguments, et le deuxième porte les deux codes.
 */
function decouperArguments(bloc) {
  const corps = bloc.startsWith('(') ? bloc.slice(1, -1) : bloc
  const out = []
  let cur = ''
  let prof = 0
  let chaine = false
  for (let i = 0; i < corps.length; i++) {
    const c = corps[i]
    if (chaine) { cur += c; if (c === "'") chaine = false; continue }
    if (c === "'") { chaine = true; cur += c; continue }
    if (c === '(') prof++
    else if (c === ')') prof--
    if (c === ',' && prof === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** Les listes blanches posées en base, action par action — la dernière écriture gagne. */
function listesBlanchesSql() {
  const listes = new Map()
  for (const f of TOUTES_MIGRATIONS) {
    const src = SQL_PAR_MIGRATION.get(f)
    for (const m of src.matchAll(/set cles_detail = array\[([\s\S]*?)\]::text\[\]\s+where code = '([a-z0-9_]+)'/g)) {
      listes.set(m[2], [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort())
    }
  }
  return listes
}

// ═══ A. LA LISTE FERMÉE — une seule, dans les deux sens ═════════════════════
section('A. La liste fermée des actions — SQL et TypeScript disent la même chose')
let codesSqlGlobal = new Set()
{
  const iSeed = SQL.indexOf('insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values')
  const seed = iSeed < 0 ? '' : SQL.slice(iSeed, SQL.indexOf('on conflict (code)', iSeed))
  const lignes = [...seed.matchAll(/\(\s*'([a-z0-9_]+)',\s*'([a-z]+)',\s*(null|'[a-z]+'),\s*'([a-z0-9_.]+)'\s*\)/g)]
    .map((m) => ({ code: m[1], famille: m[2], impose: m[3] === 'null' ? null : m[3].slice(1, -1), cle: m[4] }))
  const codesSql = new Set(lignes.map((l) => l.code))
  codesSqlGlobal = codesSql
  const ts = stripTs(read('lib/journal/actions.ts'))
  const listeTs = blocApres(ts, 'ACTIONS_JOURNAL = [', '[', ']') ?? ''
  const codesTs = new Set([...listeTs.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]))
  const sqlSansTs = [...codesSql].filter((c) => !codesTs.has(c))
  const tsSansSql = [...codesTs].filter((c) => !codesSql.has(c))
  ok(codesSql.size >= 50, `${codesSql.size} actions dans le seed SQL, ${codesTs.size} dans lib/journal/actions.ts`)
  ok(sqlSansTs.length === 0 && tsSansSql.length === 0,
    'les deux listes sont IDENTIQUES, dans les deux sens',
    `SQL sans TS : ${sqlSansTs.join(', ') || '—'} · TS sans SQL : ${tsSansSql.join(', ') || '—'}`)
  const MANDAT = ['refus_plafond_atteint', 'refus_expert_inapte', 'refus_garde_eligibilite', 'refus_quota_cv', 'refus_depot_sans_jugement',
    'compte_purge_inactivite', 'compte_purge_demande', 'compte_purge_admin', 'journal_nettoye', 'reglage_modifie', 'ip_effacees',
    'recherche_abandonnee', 'devoilement_ferme', 'annonce_expiree', 'plafond_atteint']
  const manquantes = MANDAT.filter((c) => !codesSql.has(c))
  ok(manquantes.length === 0, 'les quinze actions imposées par le mandat sont là (refus nommés, trois purges, journal, les manquantes)',
    manquantes.length ? `manquantes : ${manquantes.join(', ')}` : undefined)
  const refus = lignes.filter((l) => l.code.startsWith('refus_'))
  ok(refus.length === 5 && refus.every((l) => l.impose === 'refuse' && l.famille === 'refus'),
    'chaque « refus_… » est de famille refus et IMPOSE le statut refuse')
  ok(lignes.every((l) => l.cle === `journal.actions.${l.code}`), 'chaque clé i18n est journal.actions.<code>')
  ok(/constraint grand_livre_actions_refus_impose\s+check \(famille <> 'refus' or statut_impose = 'refuse'\)/.test(SQL),
    'la base tient : famille refus ⇒ statut imposé refuse')
  ok(/on conflict \(code\) do update/.test(SQL), 'le seed se propage (do update) : un référentiel, pas un réglage')

  // LA LISTE BLANCHE, PAR ACTION — SQL et TypeScript, dans les deux sens.
  const clesTsBloc = blocApres(ts, 'export const CLES_DETAIL = {') ?? ''
  const clesTs = new Map()
  // Un chemin de clé peut contenir `[]` (`avant.drapeaux[]`) : la liste se
  // lit donc jusqu'au `]` qui n'est PAS précédé de `[` — jamais au premier `]`.
  for (const m of clesTsBloc.matchAll(/^\s*([a-z0-9_]+):\s*\[((?:\[\]|[^\]])*)\]/gm)) {
    clesTs.set(m[1], [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort())
  }
  const clesSql = listesBlanchesSql()
  ok(clesTs.size === codesTs.size && [...codesTs].every((c) => clesTs.has(c)),
    'chaque action déclare sa liste blanche côté TypeScript (CLES_DETAIL, `satisfies` — une action sans liste ne compile pas)')
  const ecarts = []
  for (const code of codesSql) {
    const s = clesSql.get(code) ?? []
    const t = clesTs.get(code) ?? []
    if (s.join('|') !== t.join('|')) ecarts.push(`${code} : SQL [${s.join(', ') || '—'}] ≠ TS [${t.join(', ') || '—'}]`)
  }
  ok(ecarts.length === 0, 'les listes blanches sont IDENTIQUES en base et en TypeScript, action par action', ecarts.slice(0, 6).join('\n         ') || undefined)
  const declarees = [...clesSql.entries()].filter(([, l]) => l.length > 0).map(([c]) => c)
  ok(declarees.includes('reglage_modifie') && declarees.includes('ip_effacees'),
    `les actions branchées déclarent leur détail (${declarees.length} liste(s) non vide(s) : ${declarees.join(', ')})`)
}

// ═══ B. LA TABLE ET LE VERROU ═══════════════════════════════════════════════
section('B. La table en ajout seul : colonnes, privilèges, trigger, index date en tête')
{
  const table = blocApres(SQL, 'create table if not exists public.grand_livre (', '(', ')') ?? ''
  const COLONNES = ['horodatage', 'piece', 'piece_origine', 'type_action', 'statut', 'origine', 'acteur_id', 'acteur_type',
    'ecosysteme_id', 'sujet_type', 'sujet_id', 'detail', 'cout_usd', 'unite_facturee']
  const absentes = COLONNES.filter((c) => !new RegExp(`^\\s*${c}\\s`, 'm').test(table))
  ok(absentes.length === 0, 'les quatorze colonnes du mandat', absentes.length ? `absentes : ${absentes.join(', ')}` : undefined)
  const CONTRAINTES = ['grand_livre_statut_check', 'grand_livre_origine_check', 'grand_livre_acteur_type_check', 'grand_livre_acteur_coherent',
    'grand_livre_acteur_si_humain', 'grand_livre_sujet_coherent', 'grand_livre_cout_coherent', 'grand_livre_cout_positif', 'grand_livre_detail_objet']
  ok(CONTRAINTES.every((c) => table.includes(`constraint ${c}`)), 'les neuf contraintes nommées')
  ok(/type_action\s+text not null references public\.grand_livre_actions\(code\)/.test(table),
    'le type d’action est une CLÉ ÉTRANGÈRE vers la liste fermée — un type inconnu ne s’écrit pas (§E.31)')
  ok(/revoke all on table public\.grand_livre from public, anon, authenticated;/.test(SQL)
    && /revoke insert, update, delete, truncate on table public\.grand_livre from service_role;/.test(SQL)
    && /grant select on table public\.grand_livre to service_role;/.test(SQL),
    'privilèges : aucun rôle applicatif n’écrit ; service_role ne garde que la lecture')
  ok(/create trigger grand_livre_ajout_seul\s+before update or delete on public\.grand_livre\s+for each row execute function public\.grand_livre_ajout_seul\(\);/.test(SQL),
    'trigger BEFORE UPDATE OR DELETE, sur chaque ligne')
  ok(/create trigger grand_livre_pas_de_truncate\s+before truncate on public\.grand_livre\s+for each statement execute function public\.grand_livre_ajout_seul\(\);/.test(SQL),
    'et le TRUNCATE lève aussi — un trigger de ligne ne le verrait pas')
  const fnVerrou = corpsSql(SQL, 'public.grand_livre_ajout_seul()')
  ok(/using errcode = 'GL001'/.test(fnVerrou), 'le verrou lève avec un SQLSTATE dédié (GL001) — la postcondition l’attend par code, pas par texte')
  ok(/if tg_op = 'DELETE' and coalesce\(current_setting\('grand_livre\.nettoyage', true\), ''\) = 'autorise' then\s+return old;/.test(fnVerrou),
    'le SEUL chemin : un DELETE sous le réglage local du nettoyage — jamais l’UPDATE',
    'un réglage local meurt avec sa transaction : seul le nettoyage (étape 4) le pose, de l’intérieur')
  const index = [...SQL.matchAll(/create index if not exists (\w+)\s+on public\.grand_livre \(([^)]*)\)/g)]
    .map((m) => ({ nom: m[1], premiere: m[2].split(',')[0].trim().split(/\s+/)[0] }))
  const EXCEPTIONS = ['grand_livre_piece_idx', 'grand_livre_sujet_idx']
  const horsDate = index.filter((i) => !EXCEPTIONS.includes(i.nom) && i.premiere !== 'horodatage')
  ok(index.length >= 5 && horsDate.length === 0,
    `la DATE EN TÊTE de chaque index de filtre (${index.length} index, deux exceptions nommées : pièce, sujet)`,
    horsDate.length ? `hors date : ${horsDate.map((i) => `${i.nom} (${i.premiere})`).join(', ')}` : undefined)
  ok(EXCEPTIONS.every((e) => index.some((i) => i.nom === e)), 'les index pièce et sujet existent — ils se cherchent sans période')
  const uneFois = [...SQL_PAR_MIGRATION.values()].some((src) =>
    /create unique index if not exists grand_livre_une_fois_idx\s+on public\.grand_livre \(piece, type_action, coalesce\(sujet_id/.test(src))
  ok(uneFois, 'UNE FOIS par geste, par action, par sujet — tenu par un index UNIQUE, pas par une discipline (§E.31)')
}

// ═══ C. LA FONCTION UNIQUE ══════════════════════════════════════════════════
section('C. journaliser() est la seule porte — pièce et type exigés, liste fermée, liste blanche, sans donnée personnelle')
{
  const { fichier: fichierJournaliser, corps: fn } = derniereDefinition('public.journaliser(')
  ok(!!fichierJournaliser, `journaliser() lue dans sa DERNIÈRE définition (${fichierJournaliser ?? 'introuvable'})`)
  // LA LISTE BLANCHE D'ABORD, LA LISTE NOIRE ENSUITE — l'ordre est la décision.
  const iBlanche = fn.indexOf('grand_livre_chemins(v_detail)')
  const iNoire = fn.indexOf('public.audit_logs_detail_sans_pii(v_detail)')
  ok(iBlanche >= 0 && /where c <> all \(v_cles\)/.test(fn) && /using errcode = 'GL004'/.test(fn),
    'PREMIÈRE barrière : toute clé hors de la liste blanche de l’action est REFUSÉE et nommée (GL004)')
  ok(iNoire >= 0 && iBlanche >= 0 && iBlanche < iNoire,
    'SECONDE barrière : la liste noire commune vient APRÈS — elle ne décide plus, elle reste')
  ok(/exception when unique_violation then[\s\S]{0,400}?using errcode = 'GL005'/.test(fn),
    'UNE FOIS : la seconde écriture du même geste LÈVE (GL005), jamais une ligne de plus')
  ok(/if p_piece is null then\s+raise exception 'journaliser : la piece est obligatoire[^']*'\s+using errcode = 'GL002'/.test(fn),
    'la pièce est OBLIGATOIRE (GL002)')
  ok(/if p_type_action is null then\s+raise exception[^;]*using errcode = 'GL002'/.test(fn), 'le type est OBLIGATOIRE (GL002)')
  ok(/type d action inconnu[\s\S]{0,200}?using errcode = 'GL003'/.test(fn), 'un type hors liste est REFUSÉ (GL003)')
  ok(/impose le statut[\s\S]{0,200}?using errcode = 'GL003'/.test(fn), 'un statut contraire à celui que le type impose est REFUSÉ (GL003)')
  ok(/public\.audit_logs_detail_sans_pii\(v_detail\)/.test(fn),
    'le détail passe par audit_logs_detail_sans_pii() AVANT d’être inséré — la même liste que le journal d’audit')
  // TOUT insert dans grand_livre vit dans un corps de journaliser() — quelle
  // que soit la migration qui la (re)définit. Une seconde fonction qui
  // insérerait, ou un insert nu, rougit en nommant le fichier.
  let inserts = 0
  const horsPorte = []
  for (const f of TOUTES_MIGRATIONS) {
    const src = SQL_PAR_MIGRATION.get(f)
    const spans = []
    for (const m of src.matchAll(/create or replace function public\.journaliser\(/g)) {
      const corps = corpsSql(src.slice(m.index), 'public.journaliser(')
      spans.push([m.index, m.index + corps.length])
    }
    for (const m of src.matchAll(/insert into public\.grand_livre\b(?!_actions)/g)) {
      inserts++
      if (!spans.some(([a, b]) => m.index >= a && m.index < b)) horsPorte.push(f)
    }
  }
  ok(inserts >= 1 && horsPorte.length === 0 && /insert into public\.grand_livre\s*\(/.test(fn),
    `tout \`insert into public.grand_livre\` du dépôt est DANS journaliser() (${inserts} définition(s) successive(s))`,
    horsPorte.length ? `insert hors de journaliser() dans : ${[...new Set(horsPorte)].join(', ')}` : undefined)
  // Côté code : aucune écriture directe, aucun appel RPC hors de la porte.
  const ecrituresDirectes = []
  const rpcHorsPorte = []
  for (const f of [...fichiers('app'), ...fichiers('lib'), ...fichiers('components')]) {
    const src = stripTs(read(f))
    if (/\.from\('grand_livre'\)[\s\S]{0,200}?\.(insert|update|upsert|delete)\(/.test(src)) ecrituresDirectes.push(f)
    for (const [fn, porte] of PORTES) {
      if (f !== porte && new RegExp(`\\.rpc\\('${fn}'`).test(src)) rpcHorsPorte.push(`${f} → ${fn}`)
    }
  }
  ok(ecrituresDirectes.length === 0, 'aucun fichier n’écrit dans grand_livre par le client (from().insert/update/delete)',
    ecrituresDirectes.join(', ') || undefined)
  ok(rpcHorsPorte.length === 0, `aucun fichier n’appelle une RPC-porte hors de son enveloppe (${[...PORTES].map(([fn, p]) => `${fn} ← ${p}`).join(' · ')})`, rpcHorsPorte.join(', ') || undefined)
  ok([...PORTES.keys()].every((fn) => ECRIVAINS_SQL.has(fn)) && [...PORTES.values()].every((p) => /\.rpc\(/.test(stripTs(read(p)))),
    'chaque porte déclarée est un écrivain SQL réel, et son enveloppe appelle bien une RPC')
  const porte = stripTs(read('lib/journal/journaliser.ts'))
  const typeEcriture = blocApres(porte, 'export type EcritureJournal = {') ?? ''
  ok(/^\s*piece: Piece\s*$/m.test(typeEcriture) && !/piece\?:/.test(typeEcriture),
    'dans la porte TypeScript, la pièce est un champ REQUIS — ni `?`, ni défaut')
  ok(!/nouvellePiece/.test(porte), 'la porte n’invente JAMAIS une pièce à la place de l’appelant')
  const journal = fichiers('lib/journal')
  // Hors commentaires (§E.7) : piece.ts EXPLIQUE pourquoi AsyncLocalStorage est interdit.
  ok(journal.every((f) => !/AsyncLocalStorage|async_hooks/.test(stripTs(read(f)))),
    'aucun contexte ambiant (AsyncLocalStorage) : la pièce voyage en PARAMÈTRE, donc explicitement à travers after()')
  ok(/^\s*piece: Piece\s*$/m.test(typeEcriture) && /export function nouvellePiece\(\): Piece/.test(stripTs(read('lib/journal/piece.ts'))),
    'nouvellePiece() est la fabrique côté code (randomUUID), le type est marqué')
}

// ═══ D. L'ACTION RÉELLE, DE BOUT EN BOUT ════════════════════════════════════
section('D. Deux actions réelles passent par le socle — une par route, une en SQL pur')
{
  const route = stripTs(read('app/api/admin/durees/route.ts'))
  const patch = blocApres(route, 'export async function PATCH(') ?? ''
  const iPiece = patch.indexOf('nouvellePiece()')
  const premiereEcriture = ['.rpc(', '.insert(', '.update(', '.upsert(', '.delete('].map((s) => patch.indexOf(s)).filter((i) => i >= 0)
  ok(iPiece >= 0 && premiereEcriture.length > 0 && iPiece < Math.min(...premiereEcriture),
    'la route crée sa pièce AVANT toute écriture — à l’entrée du geste')
  ok(/\.rpc\('regler_durees_place',\s*\{[\s\S]{0,400}?p_piece: piece,/.test(patch), 'la route écrit par regler_durees_place(), avec SA pièce')
  ok(!/\.from\('duree_reglages'\)[\s\S]{0,80}?\.update\(/.test(patch), 'la route n’écrit PLUS duree_reglages directement')
  const fnReglage = derniereDefinition('public.regler_durees_place(').corps
  ok(/update public\.duree_reglages/.test(fnReglage) && /return public\.journaliser_reglage\(\s*p_piece, p_acteur_id, p_ecosysteme_id, 'duree_reglages'/.test(fnReglage),
    'regler_durees_place() met à jour le réglage ET journalise par l’écrivain unique, dans la même fonction — l’un sans l’autre est impossible')
  ok(/if p_acteur_id is null then\s+raise exception[^;]*using errcode = 'GL002'/.test(fnReglage), 'un réglage a toujours un auteur')
  const fnIp = derniereDefinition('public.effacer_adresses_ip()').corps
  ok(/v_piece\s+uuid := gen_random_uuid\(\)/.test(fnIp), 'la tâche SQL génère sa pièce (gen_random_uuid) — la pièce est générable des deux côtés')
  const iExc = fnIp.indexOf('exception when others then')
  const corpsOk = iExc < 0 ? '' : fnIp.slice(0, iExc)
  const corpsKo = iExc < 0 ? '' : fnIp.slice(iExc)
  ok(/journaliser\(\s*v_piece, 'ip_effacees', 'reussi', 'tache_planifiee'/.test(corpsOk), 'succès : journalisé DANS le bloc, avec sa pièce')
  ok(/journaliser\(\s*v_piece, 'ip_effacees', 'echoue', 'tache_planifiee'/.test(corpsKo), 'échec : journalisé DANS le gestionnaire, même pièce')
  ok(/left\(sqlerrm, 200\)/.test(corpsKo), 'l’échec porte la CLASSE de la panne, bornée — pas un texte entier')
}

// ═══ D bis. UN ÉCRIVAIN PAR ACTION — ni zéro pour une action branchée, ni deux ═
section('D bis. Chaque action branchée a UN écrivain, et un seul')
{
  // TÉMOIN du découpage : un `case` porte bien DEUX codes dans son deuxième
  // argument, et une parenthèse imbriquée ne coupe pas l'argument en deux.
  {
    const t = decouperArguments("(p_piece, case when x then 'compte_suspendu' else 'compte_reactive' end, 'reussi', f(a, b))")
    ok(t.length === 4 && /'compte_suspendu'[\s\S]*'compte_reactive'/.test(t[1]) && t[3] === 'f(a, b)',
      'témoin : le deuxième argument de journaliser() est lu même quand un `case` choisit le code')
  }
  // Les sites TypeScript : un bloc journaliserDans(admin, journal, { type: '…' })
  // ou journaliser(admin, { type: '…' }). Les sites SQL : journaliser(…, '<code>', …)
  // dans un corps de fonction, hors journaliser() elle-même.
  // Un site TypeScript est identifié par son FICHIER ; un site SQL par sa
  // FONCTION (redéfinie par plusieurs migrations, elle compte pour un). Une
  // campagne de mutation a montré qu'identifier les sites TS par le seul nom
  // de la porte (« journaliserDans ») fusionnait deux fichiers en un.
  const sites = new Map()
  const noter = (code, site) => { if (!sites.has(code)) sites.set(code, new Set()); sites.get(code).add(site) }
  for (const f of [...fichiers('app'), ...fichiers('lib'), ...fichiers('components')]) {
    if (f === 'lib/journal/journaliser.ts') continue
    const src = stripTs(read(f))
    for (const nom of ['journaliserDans(', 'journaliser(']) {
      for (const bloc of appelsDe(src, nom)) {
        const m = /\btype:\s*'([a-z0-9_]+)'/.exec(bloc)
        if (m) noter(m[1], `ts:${f}`)
      }
    }
  }
  // Côté SQL, seule la DERNIÈRE définition de chaque fonction compte : c'est
  // elle qui vit en base. L'ancienne `regler_durees_place()` écrivait le code
  // elle-même ; recréée pour passer par `journaliser_reglage()`, elle ne doit
  // plus compter comme écrivain — sinon « un seul » rougirait sur un fantôme.
  //
  // ⚠️ LE CODE SE LIT DANS LE DEUXIÈME ARGUMENT, PAS DANS UNE FORME D'ÉCRITURE.
  //    Le motif d'avant exigeait un littéral collé : `journaliser(p, 'code'`.
  //    Une fonction qui CHOISIT son code — `case when … then 'a' else 'b' end`,
  //    ce que fait la bascule de compte — devenait INVISIBLE : « ni deux » ne
  //    tenait plus sur ces codes, et le compteur les annonçait sans écrivain,
  //    c'est-à-dire qu'il MENTAIT dans le sens rassurant (§E.34).
  //    On découpe donc l'appel et on lit TOUS les codes de la liste fermée que
  //    son deuxième argument contient : la forme peut changer, la propriété non.
  for (const [nom, def] of DEFINITIONS_COURANTES) {
    if (nom === 'journaliser') continue
    // Les appels SQL se délimitent par des PARENTHÈSES — `appelsDe` découpe sur
    // des accolades (c'est un lecteur de JavaScript), et l'employer ici rendait
    // TOUS les écrivains SQL invisibles d'un coup. Mesuré au premier passage.
    for (let from = 0; ; ) {
      const i = def.corps.indexOf('journaliser(', from)
      if (i < 0) break
      from = i + 'journaliser('.length
      const bloc = blocApres(def.corps.slice(i), 'journaliser(', '(', ')')
      if (!bloc) continue
      const args = decouperArguments(bloc)
      for (const c of (args[1] ?? '').matchAll(/'([a-z0-9_]+)'/g)) {
        if (codesSqlGlobal.has(c[1])) noter(c[1], `sql:${nom}()`)
      }
    }
  }
  const parCode = [...sites.entries()].map(([code, l]) => [code, [...l]])
  const branchees = parCode.filter(([, l]) => l.length >= 1).map(([c]) => c).sort()
  const doubles = parCode.filter(([, l]) => l.length > 1)
  const inconnues = branchees.filter((c) => !codesSqlGlobal.has(c))
  ok(inconnues.length === 0, 'aucun écrivain ne cite un code hors de la liste fermée', inconnues.join(', ') || undefined)
  ok(doubles.length === 0,
    `ni deux : aucune action n’a deux écrivains (${branchees.length} action(s) branchée(s) : ${branchees.join(', ')})`,
    doubles.map(([c, l]) => `${c} ← ${l.join(' | ')}`).join('\n         ') || undefined)
  const restantes = [...codesSqlGlobal].filter((c) => !branchees.includes(c)).sort()
  console.log(`  ·    ${restantes.length} action(s) sans écrivain encore — étape 2 en cours : ${restantes.join(', ') || 'aucune'}`)
}

// ═══ D ter. LA PREUVE PAR ACTION — le bloc qui écrit, pas la fonction qui existe ═
section('D ter. Chaque action branchée écrit LÀ où le geste a lieu — ancré sur le bloc (§E.8)')
{
  // Une fonction écrivain qui existe ne prouve pas qu'elle est APPELÉE là où
  // il faut : `refus_plafond_atteint` a deux chemins de refus, et l'un des
  // deux pourrait cesser d'appeler l'écrivain sans que D bis ne bouge. Chaque
  // action branchée déclare donc ses PREUVES : un fichier, un bloc, un motif.
  const PREUVES = [
    { code: 'refus_plafond_atteint', fichier: 'lib/ai-budget.ts', bloc: 'if (arret.arrete) {', motif: /journaliserRefusPlafond\(/, quoi: 'le refus par le plafond de l’ACTEUR journalise' },
    { code: 'refus_plafond_atteint', fichier: 'lib/ai-budget.ts', bloc: 'if (etat.au_plafond) {', motif: /journaliserRefusPlafond\(/, quoi: 'le refus par le plafond GLOBAL journalise' },
    { code: 'refus_plafond_atteint', fichier: 'lib/ai-budget.ts', bloc: 'async function journaliserRefusPlafond(', motif: /statut: 'refuse'/, quoi: 'au statut refuse, que la base impose' },
    { code: 'plafond_atteint', fichier: 'lib/ai-budget.ts', bloc: 'export async function enregistrerDepenseIA(', motif: /await enregistrerDepense\(supabaseAdmin, \{[\s\S]*?\}\)\s*\n\s*await signalerPlafondAtteint\(/, quoi: 'le fait est cherché APRÈS chaque enregistrement de dépense' },
    { code: 'plafond_atteint', fichier: 'lib/ai-budget.ts', bloc: 'async function signalerPlafondAtteint(', motif: /\.eq\('type_action', 'plafond_atteint'\)[\s\S]*?\.gte\('horodatage'/, quoi: 'une fois par acteur et par mois : le journal est relu avant d’écrire' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/durees/route.ts', bloc: 'export async function PATCH(', motif: /\.rpc\('regler_durees_place',\s*\{[\s\S]{0,400}?p_piece: piece,/, quoi: 'la route écrit par la RPC métier, avec sa pièce' },
    // ── A2 : les six familles de réglages, onze routes ──
    { code: 'reglage_modifie', fichier: 'app/api/admin/tarifs-ia/route.ts', bloc: 'export async function PATCH(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.rpc\('regler_tarif_ia',\s*\{[\s\S]{0,400}?p_piece: journal\.piece,[\s\S]{0,400}?p_avant: avant,/, quoi: 'tarifs : le contexte naît avant l’écriture ; la route écrit par regler_tarif_ia() avec sa pièce et l’avant' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/tarifs-ia/route.ts', bloc: 'export async function PATCH(', motif: (b) => !/\.from\('ai_model_tarifs'\)[\s\S]{0,120}?\.(update|upsert|insert)\(/.test(b), quoi: 'tarifs : la route n’écrit PLUS la grille directement' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/plafonds-ia/route.ts', bloc: 'export async function PATCH(', motif: (b) => {
        const cles = [...b.matchAll(/const sujet\w+ = identifiantDerive\('reglage', '([^']+)'\)/g)].map((m) => m[1])
        return cles.length === 3 && new Set(cles).size === 3
          && /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.rpc\('regler_plafonds_ia',\s*\{[\s\S]{0,900}?p_piece: journal\.piece,[\s\S]{0,900}?p_sujet_plafonds: sujetPlafonds,\s*p_sujet_alertes: sujetAlertes,\s*p_sujet_plafonds_acteur: sujetPlafondsActeur,/.test(b)
      }, quoi: 'plafonds : trois sujets DÉRIVÉS distincts, passés à la RPC avec la pièce' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/plafonds-ia/route.ts', bloc: 'export async function PATCH(', motif: (b) => !/\.from\('(ai_spend_caps|ai_spend_seuils_acteur)'\)[\s\S]{0,120}?\.(update|upsert|insert)\(/.test(b), quoi: 'plafonds : la route n’écrit PLUS les trois tables directement' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/ai-quotas/route.ts', bloc: 'export async function PATCH(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?loadCvParsingQuota\([\s\S]*?\.rpc\('regler_quota_ia',\s*\{[\s\S]{0,400}?p_piece: journal\.piece,[\s\S]{0,400}?p_avant: avant,/, quoi: 'quota : l’avant est LU (ou refusé) avant l’écriture ; la route écrit par regler_quota_ia() avec sa pièce' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/ai-quotas/route.ts', bloc: 'export async function PATCH(', motif: (b) => !/\.from\('ai_quotas'\)[\s\S]{0,120}?\.(update|upsert|insert)\(/.test(b), quoi: 'quota : la route n’écrit PLUS la table directement' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/matching-settings/route.ts', bloc: 'export async function PATCH(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.rpc\('regler_matching',\s*\{[\s\S]{0,400}?p_piece: journal\.piece,[\s\S]{0,200}?p_domain_id: domainId,[\s\S]{0,200}?p_avant: avant,/, quoi: 'moteur : la route écrit par regler_matching() avec sa pièce, sur l’écosystème du réglage' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/matching-settings/route.ts', bloc: 'export async function PATCH(', motif: (b) => !/\.from\('matching_settings'\)[\s\S]{0,120}?\.(update|upsert|insert)\(/.test(b), quoi: 'moteur : la route n’écrit PLUS la table directement' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/seuils/route.ts', bloc: 'export async function PATCH(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.rpc\('regler_note_jugement',\s*\{[\s\S]{0,400}?p_piece: journal\.piece,[\s\S]{0,600}?p_apres: apres,/, quoi: 'notes : la route écrit par regler_note_jugement() avec sa pièce' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/seuils/route.ts', bloc: 'export async function PATCH(', motif: (b) => !/\.from\('verification_providers'\)[\s\S]{0,120}?\.(update|upsert|insert)\(/.test(b), quoi: 'notes : la route n’écrit PLUS la table directement' },
    { code: 'reglage_modifie', fichier: 'lib/package-default.ts', bloc: 'export async function applyDefaultTransfer(', motif: /\.rpc\('set_default_package',\s*\{\s*p_package_id: packageId,\s*p_piece: journal\.piece,\s*p_acteur_id: journal\.acteur\.id,/, quoi: 'défaut : le transfert passe à la RPC la pièce et l’acteur du geste' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/set-default-package/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?applyDefaultTransfer\(auth\.supabaseAdmin, \{[\s\S]{0,400}?journal,/, quoi: 'défaut : la route transmet son contexte au transfert' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/create-package/route.ts', bloc: 'export async function POST(', motif: /applyDefaultTransfer\(auth\.supabaseAdmin, \{[\s\S]{0,400}?journal,[\s\S]*?journaliserReglage\(auth\.supabaseAdmin, journal, \{\s*sujet: \{ type: 'packages', id: pkg\.id \},/, quoi: 'création : le transfert (sa ligne) PUIS la ligne de l’offre, même pièce, deux sujets' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/update-package/route.ts', bloc: 'export async function POST(', motif: /\.from\('packages'\)\s*\.update\(packageUpdates\)[\s\S]*?journaliserReglage\(auth\.supabaseAdmin, journal, \{\s*sujet: \{ type: 'packages', id: packageId \},/, quoi: 'édition : la ligne vient APRÈS l’écriture, sur l’offre' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/assign-org-package/route.ts', bloc: 'export async function POST(', motif: /\.select\('id, package_id, package_started_at, package_valid_until'\)[\s\S]*?organization_not_found[\s\S]*?\.from\('organizations'\)\s*\.update\(\{[\s\S]*?journaliserReglage\(auth\.supabaseAdmin, journal, \{\s*sujet: \{ type: 'organizations', id: organizationId \},/, quoi: 'attribution : l’organisation est LUE (404 sinon), écrite, puis journalisée' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/migrate-org-packages/route.ts', bloc: 'export async function POST(', motif: /\.update\(\{ package_id: toId,[\s\S]*?journaliserReglage\(auth\.supabaseAdmin, journal, \{\s*sujet: \{ type: 'packages', id: toId \},[\s\S]{0,300}?count: migrated,/, quoi: 'migration : UNE ligne après l’écriture, avec le compte — jamais une par organisation' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/synchroniser-catalogue/route.ts', bloc: 'export async function POST(', motif: /catch \(err\) \{[\s\S]*?journaliserReglage\(auth\.supabaseAdmin, journal, \{[\s\S]{0,200}?statut: 'echoue',[\s\S]*?return json\(\{ error: cause, code: 'synchronisation_impossible' \}, 502\)/, quoi: 'catalogue : une synchronisation qui n’a pas pu se faire est journalisée ÉCHOUÉE, avec sa cause' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/synchroniser-catalogue/route.ts', bloc: 'export async function POST(', motif: /statut: rapport\.failed\.length > 0 \? 'echoue' : 'reussi',[\s\S]{0,200}?synchronisees: rapport\.synced\.map\(\(r\) => r\.slug\),\s*refusees: rapport\.refused\.map\(\(r\) => r\.slug\),\s*en_echec: rapport\.failed\.map\(\(r\) => r\.slug\),/, quoi: 'catalogue : slugs seulement, et ÉCHOUÉE dès qu’une offre est en échec' },
    // ── A3 : le paiement reçu ──
    { code: 'paiement_recu', fichier: 'app/api/stripe/webhook/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteSysteme\(\)[\s\S]*?\.rpc\('stripe_event_claim'[\s\S]*?handleStripeEvent\(admin, event, journal\)/, quoi: 'le webhook ouvre sa pièce AVANT la réclamation (première écriture) et la transmet au traitement' },
    { code: 'paiement_recu', fichier: 'lib/billing/events.ts', bloc: 'async function onInvoicePaid(', motif: /\.rpc\('enregistrer_paiement',\s*\{\s*p_piece: journal\.piece,\s*p_stripe_event_id: eventId,/, quoi: 'la pièce comptable est écrite par la RPC métier, avec la pièce et l’événement' },
    { code: 'paiement_recu', fichier: 'lib/billing/events.ts', bloc: 'async function onInvoicePaid(', motif: (b) => !/\.from\('transactions'\)[\s\S]{0,80}?\.(upsert|insert)\(/.test(b), quoi: 'le code n’écrit PLUS transactions directement' },
    // ── B1 : la candidature déposée, et la pièce du rejeu ──
    { code: 'candidature_deposee', fichier: 'lib/candidatures/depot.ts', bloc: 'export async function deposerCandidature(', motif: /jugerCandidature\(\{[\s\S]*?\.rpc\('inserer_candidature_jugee',\s*\{\s*\.\.\.parametresJournal\(args\.journal\),\s*p_origine_depot: args\.origine,/, quoi: 'le jugement PUIS l’écriture par la RPC, avec le contexte du geste (pièce, origine, acteur, pièce d’origine)' },
    { code: 'candidature_deposee', fichier: 'lib/candidatures/depot.ts', bloc: 'export async function deposerCandidature(', motif: (b) => !/\.from\('candidatures'\)[\s\S]{0,80}?\.(insert|upsert)\(/.test(b) && !/\.from\('candidature_depots'\)[\s\S]{0,120}?\.update\(\{\s*etat: 'depose'/.test(b), quoi: 'le dépôt n’écrit PLUS la candidature ni le solde du journal directement' },
    { code: 'candidature_deposee', fichier: 'lib/candidatures/depot.ts', bloc: 'async function ouvrirJournal(', motif: /\.rpc\('ouvrir_depot_candidature',\s*\{[\s\S]{0,300}?p_piece: args\.piece,/, quoi: 'le journal du dépôt s’ouvre AVEC la pièce du geste — avant l’appel au modèle' },
    { code: 'candidature_deposee', fichier: 'app/api/admin/depots-en-echec/route.ts', bloc: 'export async function POST(', motif: /contexteDepuisAuth\(auth, estPiece\(ligne\.piece\) \? ligne\.piece : null\)[\s\S]*?deposerCandidature\(\{[\s\S]{0,300}?journal,/, quoi: 'le rejeu ouvre une pièce NEUVE qui référence celle de la tentative rejouée, et la passe au dépôt' },
    // ── B2 : le dépôt sans jugement est un refus ──
    { code: 'refus_depot_sans_jugement', fichier: 'lib/candidatures/depot.ts', bloc: 'async function solderJournalEnEchec(', motif: /\.rpc\('solder_depot_en_echec',\s*\{\s*\.\.\.parametresJournal\(args\.journal\),[\s\S]{0,300}?p_cause: args\.cause,/, quoi: 'le solde en échec passe par la RPC, avec le contexte du geste et la cause fermée' },
    { code: 'refus_depot_sans_jugement', fichier: 'lib/candidatures/depot.ts', bloc: 'async function solderJournalEnEchec(', motif: (b) => !/\.from\('candidature_depots'\)[\s\S]{0,120}?\.update\(/.test(b), quoi: 'le solde en échec n’écrit PLUS la table directement' },
    { code: 'refus_depot_sans_jugement', fichier: 'lib/candidatures/depot.ts', bloc: 'export async function deposerCandidature(', motif: (b) => (b.match(/solderJournalEnEchec\(supabaseAdmin, \{\s*journal: args\.journal,/g) || []).length === 2 && (b.match(/solderJournalEnEchec\(/g) || []).length === 2, quoi: 'les DEUX sorties sans jugement (modèle, base) passent le contexte au solde' },
    // ── B3 : l'expert inapte est refusé, et le refus s'écrit ──
    { code: 'refus_expert_inapte', fichier: 'lib/candidatures/depot.ts', bloc: 'export async function deposerCandidature(', motif: (b) => (b.match(/return refuserInapte\(supabaseAdmin, args\.journal, \{/g) || []).length === 1 && !/issue: 'inapte'/.test(b), quoi: 'la SEULE sortie « inapte » du dépôt passe par l’écrivain, avec le contexte' },
    { code: 'refus_expert_inapte', fichier: 'lib/candidatures/depot.ts', bloc: 'async function refuserInapte(', motif: /journaliserDans\(admin, journal, \{\s*type: 'refus_expert_inapte',\s*statut: 'refuse',\s*sujet: \{ type: 'profiles', id: args\.profileId \},[\s\S]{0,300}?ecosystemeId: args\.domainId,/, quoi: 'au statut imposé, sujet le PROFIL, écosystème celui du dépôt' },
    // ── B4 : les refus de garde du dépôt ──
    { code: 'refus_garde_eligibilite', fichier: 'lib/candidatures/depot.ts', bloc: 'export async function deposerCandidature(', motif: (b) => !/issue: 'refusee'/.test(b) && (b.match(/return refuser\(/g) || []).length >= 10, quoi: 'AUCUNE sortie « refusee » littérale dans le dépôt : toutes passent par le raccourci vers l’écrivain' },
    { code: 'refus_garde_eligibilite', fichier: 'lib/candidatures/depot.ts', bloc: 'async function refuserGarde(', motif: /if \(REFUS_DEPOT\[args\.code\] < 500\) \{\s*await journaliserDans\(admin, journal, \{\s*type: 'refus_garde_eligibilite',\s*statut: 'refuse',\s*sujet: \{ type: 'publications', id: args\.publicationId \},/, quoi: 'seuls les refus de RÈGLE (< 500) s’écrivent, au statut imposé, sujet l’annonce' },
    // ── B5 : le quota d'analyses de CV refuse, et le refus s'écrit ──
    { code: 'refus_quota_cv', fichier: 'lib/ai-quotas.ts', bloc: 'export async function refuserParQuota(', motif: /journaliserDans\(admin, journal, \{\s*type: 'refus_quota_cv',\s*statut: 'refuse',\s*sujet: \{ type: 'profiles', id: args\.profileId \},[\s\S]{0,300}?limite: args\.maxPerWindow,/, quoi: 'au statut imposé, sujet le profil, la limite LUE au moment du refus' },
    { code: 'refus_quota_cv', fichier: 'app/api/profile/upload-cv/route.ts', bloc: 'export async function POST(', motif: /if \(windowActive && count24h >= quota\.maxPerWindow\) \{\s*await refuserParQuota\(supabaseAdmin, journal, \{[\s\S]{0,400}?\}\)\s*return json\(/, quoi: 'freelance : le refus est écrit AVANT le 429' },
    { code: 'refus_quota_cv', fichier: 'app/api/profile/cdi-upload-cv/route.ts', bloc: 'export async function POST(', motif: /if \(windowActive && count24h >= quota\.maxPerWindow\) \{\s*await refuserParQuota\(supabaseAdmin, journal, \{[\s\S]{0,400}?\}\)\s*return json\(/, quoi: 'CDI : le refus est écrit AVANT le 429 — parité (§D.14)' },
    // ── B6 : la candidature déclinée ──
    { code: 'candidature_declinee', fichier: 'app/api/candidatures/[id]/reject/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.rpc\('decliner_candidature',\s*\{\s*\.\.\.parametresJournal\(journal\),[\s\S]{0,400}?p_statuts_admis: \[\.\.\.ALLOWED_PREVIOUS_STATUSES\],[\s\S]{0,400}?if \(declinee !== true\)[\s\S]{0,200}?invalid_transition/, quoi: 'la route décline par la RPC avec le contexte et les statuts admis, et ZÉRO ligne est une transition invalide (409), plus un succès muet' },
    { code: 'candidature_declinee', fichier: 'app/api/candidatures/[id]/reject/route.ts', bloc: 'export async function POST(', motif: (b) => !/\.from\('candidatures'\)[\s\S]{0,120}?\.update\(/.test(b), quoi: 'la route n’écrit PLUS la candidature directement' },
    // ── B7 : la candidature retenue ──
    { code: 'candidature_retenue', fichier: 'app/api/candidatures/[id]/select/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?if \(!isAlreadySelected\) \{\s*const \{ data: retenueAt, error: updErr \} = await auth\.supabaseAdmin\.rpc\('retenir_candidature',\s*\{\s*\.\.\.parametresJournal\(journal\),[\s\S]{0,400}?p_statuts_admis: \[\.\.\.ALLOWED_PREVIOUS_STATUSES\],[\s\S]{0,400}?if \(typeof retenueAt !== 'string'\)[\s\S]{0,200}?invalid_transition[\s\S]{0,300}?selectedAtIso = retenueAt/, quoi: 'la route retient par la RPC avec le contexte et les statuts admis ; ZÉRO ligne est une transition invalide (409) ; selected_at vient de la base' },
    { code: 'candidature_retenue', fichier: 'app/api/candidatures/[id]/select/route.ts', bloc: 'export async function POST(', motif: (b) => !/\.from\('candidatures'\)[\s\S]{0,120}?\.update\(/.test(b), quoi: 'la route n’écrit PLUS la candidature directement' },
    // ── B8 : le dévoilement, par le chemin partagé ──
    { code: 'devoilement_ouvert', fichier: 'lib/unlock.ts', bloc: 'export async function performUnlock(', motif: /const expiresAtIso = conversationExpiryIso\(\{ fenetreEchangeJours: opts\.fenetreEchangeJours \}\)\s*const \{ data: verdictBrut, error: rpcErr \} = await admin\.rpc\('devoiler_candidature',\s*\{\s*\.\.\.parametresJournal\(opts\.journal\),\s*p_candidature_id: candidatureId,\s*p_statuts_admis: \[\.\.\.ALLOWED_PREVIOUS_STATUSES\],\s*p_expires_at: expiresAtIso,\s*p_auto: opts\.auto,/, quoi: 'le chemin partagé dévoile par la RPC, avec le contexte, les statuts admis, la fin d’échange posée ici et l’origine (auto)' },
    { code: 'devoilement_ouvert', fichier: 'lib/unlock.ts', bloc: 'export async function performUnlock(', motif: (b) => !/\.from\('conversations'\)[\s\S]{0,120}?\.insert\(/.test(b) && !/\.from\('candidatures'\)[\s\S]{0,120}?\.update\(/.test(b) && /alreadyUnlocked: verdict\.issue === 'deja'/.test(b), quoi: 'plus d’écriture directe ; « déjà dévoilée » est le verdict de la base sous verrou' },
    { code: 'devoilement_ouvert', fichier: 'lib/candidatures/depot.ts', bloc: 'async function devoilementInclus(', motif: /performUnlock\(admin, candidatureId, \{\s*auto: true,\s*journal: args\.journal,/, quoi: 'le dévoilement inclus passe la pièce du dépôt — même geste, même pièce' },
    { code: 'devoilement_ouvert', fichier: 'app/api/candidatures/[id]/unlock/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?performUnlock\(auth\.supabaseAdmin, candidatureId, \{\s*auto: false,\s*journal,/, quoi: 'le dévoilement manuel ouvre son contexte à l’entrée et le passe au chemin partagé' },
    // ── C : le moteur, dans les deux sens — une ligne par étape, un seul module écrivain ──
    { code: 'recherche_lancee', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async lancee(', motif: /journaliserDans\(this\.admin, this\.journal, \{\s*type: 'recherche_lancee',\s*statut: 'reussi',\s*sujet: this\.sujet,\s*ecosystemeId: this\.ecosystemeId,\s*detail: \{ tentative: d\.tentative, tache: this\.journal\.tache \},/, quoi: 'l’écrivain : sujet et écosystème de l’objet cherché, la tentative et la tâche' },
    { code: 'recherche_lancee', fichier: 'lib/matching/index.ts', bloc: 'export async function runMatchingForPublication(', motif: /await marquerTentative\(supabaseAdmin, publicationId, pub\.matching_attempts \?\? 0\)\s*const tentative = \(pub\.matching_attempts \?\? 0\) \+ 1\s*await recherche\.lancee\(\{ tentative \}\)/, quoi: 'annonce : lancée APRÈS la tentative comptée, sujet l’annonce, écosystème le sien, tentative = compteur lu + 1' },
    { code: 'recherche_lancee', fichier: 'lib/matching/run-for-expert.ts', bloc: 'async function executerRunExpert(', motif: /const vieAnnonceJours = lectureDurees\.durees\.vieAnnonceJours\s*await recherche\.lancee\(\{ tentative: p\.matching_relance_tentatives \}\)[\s\S]*?\.from\('publications'\)/, quoi: 'expert : lancée après l’éligibilité et les réglages, AVANT la lecture des annonces ; tentative = le compteur de relance lu' },
    { code: 'recherche_lancee', fichier: 'lib/matching/index.ts', bloc: 'export async function runMatchingForPublication(', motif: /let recherche = new JournalDeRecherche\(supabaseAdmin, journal, \{ type: 'publications', id: publicationId \}, journal\.ecosystemeId\)[\s\S]*?const pub = pubData as unknown as LigneAnnonce\s*recherche = recherche\.dansEcosysteme\(pub\.domain_id\)/, quoi: 'annonce : l’histoire naît à l’entrée (écosystème du geste), et passe sous l’écosystème de l’annonce dès qu’elle est lue' },
    { code: 'recherche_lancee', fichier: 'lib/matching/run-for-expert.ts', bloc: 'async function executerRunExpert(', motif: /let recherche = new JournalDeRecherche\(supabaseAdmin, journal, \{ type: 'profiles', id: profileId \}, journal\.ecosystemeId\)[\s\S]*?const p = profData as unknown as LigneProfil\s*recherche = recherche\.dansEcosysteme\(p\.domain_id\)/, quoi: 'expert : l’histoire naît à l’entrée, et passe sous l’écosystème du profil dès qu’il est lu' },
    { code: 'recherche_lancee', fichier: 'lib/matching/run-for-expert.ts', bloc: 'const SELECT_PROFIL =', motif: /matching_relance_tentatives/, quoi: 'expert : le compteur de relance est LU avec le profil (§E.1 — une colonne absente se lit undefined)' },
    { code: 'recherche_filtree', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async filtree(', motif: /type: 'recherche_filtree',\s*statut: 'reussi',\s*sujet: this\.sujet,\s*ecosystemeId: this\.ecosystemeId,\s*detail: \{\s*eligibles: d\.eligibles,\s*sans_matiere: d\.sans_matiere,\s*a_noter: d\.a_noter,\s*ecartes_deja_decline: d\.ecartes_deja_decline,\s*ecartes_deja_postule: d\.ecartes_deja_postule,\s*chargees: d\.chargees,\s*\},/, quoi: 'l’écrivain : les comptes du filtrage, clé par clé, jamais un objet opaque' },
    { code: 'recherche_filtree', fichier: 'lib/matching/index.ts', bloc: 'export async function runMatchingForPublication(', motif: /const sansMatiere = vivier\.profils\.length - documents\.length[\s\S]*?await recherche\.filtree\(\{\s*eligibles: baseStats\.eligible_after_filters,\s*ecartes_deja_decline: baseStats\.ecartes_deja_decline,\s*ecartes_deja_postule: baseStats\.ecartes_deja_postule,\s*sans_matiere: baseStats\.sans_matiere,\s*a_noter: documents\.length,\s*\}\)\s*if \(documents\.length === 0\) \{/, quoi: 'annonce : filtrée avec les MÊMES comptes que la trace, AVANT la branche « vivier vide »' },
    { code: 'recherche_filtree', fichier: 'lib/matching/run-for-expert.ts', bloc: 'async function executerRunExpert(', motif: /\.filter\(\(d\) => documentUtilisable\(d\.texte\)\)\s*await recherche\.filtree\(\{\s*chargees: annonces\.length,\s*eligibles: retenues\.length,\s*sans_matiere: retenues\.length - documents\.length,\s*a_noter: documents\.length,\s*\}\)\s*if \(documents\.length === 0\) \{/, quoi: 'expert : filtrée sur chargées, éligibles, sans matière, à noter — AVANT la branche « vivier vide »' },
    { code: 'recherche_classee', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async classee(', motif: /type: 'recherche_classee',\s*statut: d\.lots_en_echec > 0 \|\| \(d\.arret !== null && d\.arret !== 'aucun_document'\) \? 'echoue' : 'reussi',[\s\S]*?detail: \{\s*model: d\.model,\s*notes: d\.notes,\s*reprises: d\.reprises,\s*lots_en_echec: d\.lots_en_echec,\s*arret: d\.arret,\s*recherches: d\.facture\.recherches,\s*unites_source: d\.facture\.source,\s*\},\s*cout: d\.facture\.cout_usd === null \? null : \{ usd: d\.facture\.cout_usd, unite: 'recherches' \},/, quoi: 'l’écrivain : le statut de l’ÉTAPE, les comptes, les unités facturées et leur source, le coût dans les colonnes de coût — null si inconnu' },
    { code: 'recherche_classee', fichier: 'lib/matching/index.ts', bloc: 'export async function runMatchingForPublication(', motif: /for \(const \[profileId, score\] of acquises\) \{[\s\S]*?\}\s*await recherche\.classee\(\{ model: notation\.model, notes: notation\.notes, reprises: acquises\.size, lots_en_echec: notation\.lots_en_echec, arret: notation\.arret_code \?\? null, facture: notation\.facture \}\)/, quoi: 'annonce : classée APRÈS la reprise des notes acquises, avec la facture du run telle que rendue' },
    { code: 'recherche_classee', fichier: 'lib/matching/run-for-expert.ts', bloc: 'async function executerRunExpert(', motif: /for \(const \[publicationId, score\] of acquises\) \{[\s\S]*?\}\s*await recherche\.classee\(\{ model: notation\.model, notes: notation\.notes, reprises: acquises\.size, lots_en_echec: notation\.lots_en_echec, arret: notation\.arret_code \?\? null, facture: notation\.facture \}\)/, quoi: 'expert : classée APRÈS la reprise des notes acquises, avec la facture du run telle que rendue' },
    { code: 'recherche_classee', fichier: 'lib/matching/rerank.ts', bloc: 'export async function rerankerTout(', motif: /const depense = await enregistrerDepenseIA\([\s\S]*?recherches \+= r\.facture\.recherches\s*if \(r\.facture\.source === 'plancher'\) auPlancher = true\s*coutUsd = coutUsd === null \|\| depense\.cout_usd === null \? null : coutUsd \+ depense\.cout_usd[\s\S]*?const facture = \{ recherches, source: auPlancher \? 'plancher' : 'fournisseur', cout_usd: coutUsd \} as const\s*return \{ scores, notes, lots_en_echec: lotsEnEchec, arret, arret_code: arretCode, model: args\.model, facture \}/, quoi: 'la facture est CUMULÉE lot par lot sur ce que l’appel a rendu et ce que l’enregistrement a tarifé ; un lot sans tarif rend le coût null, un lot au plancher rend la source plancher' },
    { code: 'recherche_correspondances', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async correspondances(', motif: /type: 'recherche_correspondances',\s*statut: 'reussi',\s*sujet: this\.sujet,\s*ecosystemeId: this\.ecosystemeId,\s*detail: \{\s*retenues: d\.retenues,\s*fortes: d\.fortes,\s*inserees: d\.inserees,\s*mises_a_jour: d\.mises_a_jour,\s*supprimees: d\.supprimees,\s*filtre_flux: d\.filtre_flux,\s*palier_fort: d\.palier_fort,\s*\},/, quoi: 'l’écrivain : retenues, fortes, ce que la base a fait, et les deux réglages qui ont trié — jamais une note' },
    { code: 'recherche_correspondances', fichier: 'lib/matching/index.ts', bloc: 'export async function runMatchingForPublication(', motif: /stats = await reconcileMatches\(\{[\s\S]*?\} catch \(err\) \{[\s\S]*?return \{ status: 'error'[^\n]*\n\s*\}\s*await recherche\.correspondances\(\{\s*retenues: desired\.length,\s*fortes: auDessusDuSeuil\.length,\s*inserees: stats\.inserted\.length,\s*mises_a_jour: stats\.updated,\s*supprimees: stats\.deleted,\s*filtre_flux: s\.feed_threshold,\s*palier_fort: s\.notify_threshold,\s*\}\)/, quoi: 'annonce : écrite APRÈS la réconciliation réussie (une réconciliation en échec n’écrit pas de correspondances), sur ce que la base a rendu' },
    { code: 'recherche_correspondances', fichier: 'lib/matching/run-for-expert.ts', bloc: 'async function executerRunExpert(', motif: /stats = await reconcileMatches\(\{[\s\S]*?\} catch \(err\) \{[\s\S]*?return \{ status: 'error'[^\n]*\n\s*\}\s*await recherche\.correspondances\(\{\s*retenues: desired\.length,\s*fortes: desired\.filter\(\(d\) => d\.relevance_tier === 'strong'\)\.length,\s*inserees: stats\.inserted\.length,\s*mises_a_jour: stats\.updated,\s*supprimees: stats\.deleted,\s*filtre_flux: s\.feed_threshold,\s*palier_fort: s\.notify_threshold,\s*\}\)/, quoi: 'expert : écrite APRÈS la réconciliation réussie, sur ce que la base a rendu' },
    { code: 'recherche_notifiee', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async notifiee(', motif: /type: 'recherche_notifiee',\s*statut: b\.renonce \|\| b\.paquets_en_echec > 0 \? 'echoue' : 'reussi',\s*sujet: this\.sujet,\s*ecosystemeId: this\.ecosystemeId,\s*detail: \{\s*demandees: b\.demandees,\s*deja_notifiees: b\.deja_notifiees,\s*posees: b\.posees,\s*paquets_en_echec: b\.paquets_en_echec,\s*renonce: b\.renonce,\s*\},/, quoi: 'l’écrivain : le bilan de l’envoi tel que rendu, statut de l’étape échoué si l’envoi a renoncé ou refusé un paquet' },
    { code: 'recherche_notifiee', fichier: 'lib/matching/index.ts', bloc: 'export async function runMatchingForPublication(', motif: /if \(specs\.length > 0\) \{\s*const bilan = await notifyAndFlip\(\{ supabaseAdmin, specs \}\)\s*notifies = specs\.length\s*await recherche\.notifiee\(bilan\)\s*\}/, quoi: 'annonce : écrite quand un envoi a été TENTÉ, avec le bilan rendu par l’envoi' },
    { code: 'recherche_notifiee', fichier: 'lib/matching/run-for-expert.ts', bloc: 'async function executerRunExpert(', motif: /if \(specs\.length > 0\) \{\s*const bilan = await notifyAndFlip\(\{ supabaseAdmin, specs \}\)\s*notifies = specs\.length\s*await recherche\.notifiee\(bilan\)\s*\}/, quoi: 'expert : écrite quand un envoi a été TENTÉ, avec le bilan rendu par l’envoi' },
    { code: 'recherche_notifiee', fichier: 'lib/matching/shared.ts', bloc: 'export async function notifyAndFlip(', motif: (b) => /return \{ \.\.\.bilan, renonce: true \}/.test(b) && /bilan\.deja_notifiees\+\+/.test(b) && /bilan\.paquets_en_echec\+\+/.test(b) && /bilan\.posees \+= tranche\.length/.test(b) && /return bilan\s*\}?\s*$/.test(b), quoi: 'l’envoi REND son bilan sur chaque chemin : renoncement, déjà notifiées, paquets refusés, lignes posées' },
    { code: 'recherche_terminee', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async terminee(', motif: /type: 'recherche_terminee',\s*statut: 'reussi',\s*sujet: this\.sujet,\s*ecosystemeId: this\.ecosystemeId,\s*detail: \{ issue: d\.issue, raison: d\.raison \},/, quoi: 'l’écrivain : l’issue fermée et la raison en code, au statut que la base impose' },
    { code: 'recherche_terminee', fichier: 'lib/matching/index.ts', bloc: 'export async function runMatchingForPublication(', motif: (b) => /await recherche\.terminee\(\{ issue: 'annonce_expiree' \}\)\s*return \{\s*status: 'annonce_expiree',/.test(b) && /await recherche\.terminee\(\{ issue: 'vivier_vide' \}\)\s*return \{ status: 'empty_pool'/.test(b) && /if \(acheve\) await solderBrouillon\(supabaseAdmin, publicationId\)\s*if \(acheve\) await recherche\.terminee\(\{ issue: 'ok' \}\)/.test(b) && (b.match(/recherche\.terminee\(/g) || []).length === 3, quoi: 'annonce : TROIS fins et pas une de plus — annonce expirée (avant la tentative), vivier vide (run achevé), ok (après trace et brouillon soldé)' },
    { code: 'recherche_terminee', fichier: 'lib/matching/run-for-expert.ts', bloc: 'async function executerRunExpert(', motif: (b) => /await recherche\.terminee\(\{ issue: 'ineligible', raison: eligibilite\.raison \}\)\s*return \{\s*status: 'empty_pool',/.test(b) && /await recherche\.terminee\(\{ issue: 'sans_matiere' \}\)\s*return \{\s*status: 'empty_pool',/.test(b) && /await ecrireTraceDePerimetre\(supabaseAdmin, profileId, ouvertureCroisee\)\s*await recherche\.terminee\(\{ issue: 'vivier_vide' \}\)\s*return \{ status: 'empty_pool'/.test(b) && /await ecrireTraceDePerimetre\(supabaseAdmin, profileId, ouvertureCroisee\)\s*const acheve = notation\.lots_en_echec === 0 && !notation\.arret\s*if \(acheve\) await recherche\.terminee\(\{ issue: 'ok' \}\)/.test(b) && (b.match(/recherche\.terminee\(/g) || []).length === 4, quoi: 'expert : QUATRE fins et pas une de plus — inéligible (avec sa raison), sans matière, vivier vide (après la trace de périmètre), ok' },
    { code: 'recherche_echouee', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async echouee(', motif: /type: 'recherche_echouee',\s*statut: 'echoue',\s*sujet: this\.sujet,\s*ecosystemeId: this\.ecosystemeId,\s*detail: \{ etape: d\.etape, cause: d\.cause, tentative: d\.tentative, arret: d\.arret, lots_en_echec: d\.lots_en_echec \},/, quoi: 'l’écrivain : l’étape et la cause en codes, la tentative, l’arrêt et les lots manqués — au statut que la base impose' },
    { code: 'recherche_echouee', fichier: 'lib/matching/index.ts', bloc: 'export async function runMatchingForPublication(', motif: (b) => {
        const sorties = [...b.matchAll(/await recherche\.echouee\(\{ etape: '([a-z_]+)', cause: ([^,]+), tentative(?:: ([^,}]+))?/g)].map((m) => `${m[1]}/${m[2].trim()}/${(m[3] ?? 'tentative').trim()}`)
        const attendues = ['lecture/\'lecture_en_panne\'/null', 'lecture/\'introuvable\'/null', 'reglages/\'reglages_absents\'/null', 'reglages/\'durees_illisibles\'/null', 'vivier/\'vivier_en_panne\'/tentative', 'filtrage/\'annonce_sans_matiere\'/tentative', 'correspondances/\'reconciliation_en_panne\'/tentative', "notation/notation.arret_code ? 'notation_arretee' : 'lots_en_echec'/tentative"]
        return sorties.length === 8 && attendues.every((a) => sorties.includes(a)) && /if \(acheve\) await recherche\.terminee\(\{ issue: 'ok' \}\)\s*else await recherche\.echouee\(\{ etape: 'notation'/.test(b)
      }, quoi: 'annonce : HUIT sorties en échec, chacune avec son étape et sa cause en code ; sans tentative avant le point de non-retour, avec après ; la fin est terminee OU echouee' },
    { code: 'recherche_echouee', fichier: 'lib/matching/run-for-expert.ts', bloc: 'async function executerRunExpert(', motif: (b) => {
        const sorties = [...b.matchAll(/await recherche\.echouee\(\{ etape: '([a-z_]+)', cause: ([^,]+), tentative: ([^,}]+)/g)].map((m) => `${m[1]}/${m[2].trim()}/${m[3].trim()}`)
        const attendues = ['lecture/\'lecture_en_panne\'/null', 'lecture/\'introuvable\'/null', 'reglages/\'reglages_absents\'/p.matching_relance_tentatives', 'reglages/\'durees_illisibles\'/p.matching_relance_tentatives', 'vivier/\'vivier_en_panne\'/p.matching_relance_tentatives', 'vivier/\'decisions_illisibles\'/p.matching_relance_tentatives', 'correspondances/\'reconciliation_en_panne\'/p.matching_relance_tentatives', "notation/notation.arret_code ? 'notation_arretee' : 'lots_en_echec'/p.matching_relance_tentatives"]
        return sorties.length === 8 && attendues.every((a) => sorties.includes(a)) && /if \(acheve\) await recherche\.terminee\(\{ issue: 'ok' \}\)\s*else await recherche\.echouee\(\{ etape: 'notation'/.test(b)
      }, quoi: 'expert : HUIT sorties en échec, chacune avec son étape et sa cause en code ; la tentative est le compteur de relance lu dès que le profil l’est ; la fin est terminee OU echouee' },
    { code: 'recherche_abandonnee', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'private async abandonnee(', motif: /type: 'recherche_abandonnee',\s*statut: 'echoue',\s*sujet: this\.sujet,\s*ecosystemeId: this\.ecosystemeId,\s*detail: \{ tentatives: d\.tentatives, plafond: d\.plafond, cause: d\.cause \},/, quoi: 'l’écrivain, PRIVÉ : tentatives, plafond en vigueur, cause du dernier échec — au statut que la base impose' },
    { code: 'recherche_abandonnee', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async echouee(', motif: /journaliserDans\(this\.admin, this\.journal, \{\s*type: 'recherche_echouee',[\s\S]*?\}\)\s*const plafond = this\.sujet\.type === 'publications' \? RUN_MAX_TENTATIVES : RELANCE_MAX_TENTATIVES\s*if \(d\.tentative !== null && d\.tentative >= plafond\) \{\s*await this\.abandonnee\(\{ tentatives: d\.tentative, plafond, cause: d\.cause \}\)/, quoi: 'l’abandon est DÉCIDÉ dans l’écrivain de l’échec, APRÈS la ligne d’échec : tentative consommée ≥ plafond du sens, plafonds importés du module pur' },
    { code: 'recherche_abandonnee', fichier: 'app/api/cron/match-retry/route.ts', bloc: 'async function handle(', motif: /p_max_attempts: RUN_MAX_TENTATIVES,/, quoi: 'le rattrapage exclut au MÊME plafond que celui qui écrit l’abandon (une source, plus de constante locale)' },
    { code: 'recherche_abandonnee', fichier: 'app/api/admin/approve-expert/route.ts', bloc: 'export async function POST(', motif: /await marquerTentativeRelance\(auth\.supabaseAdmin, profileId\)\s*const v = await runMatchingForExpert\(\{/, quoi: 'l’approbation compte la tentative AVANT le run, comme les deux autres appelants : le moteur lit un compteur juste' },
    // ── D : l'annonce, le profil, le CV, la disponibilité ──
    { code: 'annonce_publiee', fichier: 'app/api/publications/[id]/publish/route.ts', bloc: 'export async function POST(', motif: /\.rpc\('publier_annonce',\s*\{\s*\.\.\.parametresJournal\(journal\),\s*p_publication_id: id,\s*p_domain_id: activeEcosystemId\(auth\),\s*p_organization_id: orgId,\s*p_statuts_admis: \[\.\.\.PUBLISHABLE_FROM\],\s*p_verdict: verdict\.status,\s*p_score: verdict\.score,\s*p_method: verdict\.method,\s*p_data: verdict\.data,/, quoi: 'la route met en ligne par la RPC métier, avec le contexte, le cloisonnement, l’organisation et les statuts admis' },
    { code: 'annonce_publiee', fichier: 'app/api/publications/[id]/publish/route.ts', bloc: 'export async function POST(', motif: (b) => !/\.from\('publications'\)[\s\S]{0,200}?\.update\(/.test(b) && /if \(!miseEnLigne\) \{[\s\S]{0,400}?rendreLaPlace\([\s\S]{0,200}?409\)/.test(b), quoi: 'plus d’écriture directe du statut ; zéro ligne touchée rend la place et répond 409' },
    { code: 'annonce_modifiee', fichier: 'app/api/publications/[id]/route.ts', bloc: 'export async function PATCH(', motif: /\.update\(u\.updates\)[\s\S]*?\.single\(\)\s*if \(updateErr \|\| !updated\) \{[\s\S]*?\}\s*try \{\s*await journaliserDans\(auth\.supabaseAdmin, journal, \{\s*type: 'annonce_modifiee',\s*statut: 'reussi',\s*sujet: \{ type: 'publications', id \},\s*detail: \{ champs: Object\.keys\(u\.updates\), statut_annonce: updated\.status, organization_id: orgId \},\s*\}\)\s*\} catch \(err\) \{\s*if \(!\(err instanceof JournalError\)\) throw err[\s\S]{0,300}?code: 'journal_error', publication_id: id \}, 500\)/, quoi: 'la ligne vient APRÈS l’écriture, porte les NOMS des champs (jamais leur contenu), et un journal qui refuse répond journal_error avec l’identifiant' },
    { code: 'annonce_modifiee', fichier: 'app/api/publications/[id]/route.ts', bloc: 'export async function PATCH(', motif: (b) => b.indexOf("type: 'annonce_modifiee'") < b.indexOf("action: 'publication_edited'"), quoi: 'le grand livre précède l’audit best-effort : c’est lui qui doit survivre (§E.68)' },
    { code: 'annonce_depubliee', fichier: 'app/api/publications/[id]/close/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.rpc\('cloturer_annonce',\s*\{\s*\.\.\.parametresJournal\(journal\),\s*p_publication_id: id,\s*p_domain_id: activeEcosystemId\(auth\),\s*p_organization_id: orgId,\s*p_statuts_admis: \[\.\.\.CLOSABLE_FROM\],\s*\}\)[\s\S]*?if \(cloturee !== true\) \{[\s\S]{0,200}?409\)/, quoi: 'la route clôture par la RPC métier, avec le contexte, le cloisonnement, l’organisation et les statuts admis ; zéro ligne touchée répond 409' },
    { code: 'annonce_depubliee', fichier: 'app/api/publications/[id]/close/route.ts', bloc: 'export async function POST(', motif: (b) => !/\.from\('publications'\)[\s\S]{0,200}?\.update\(/.test(b), quoi: 'plus d’écriture directe du statut' },
    { code: 'annonce_expiree', fichier: 'app/api/cron/constats/route.ts', bloc: 'async function handle(', motif: /const journal = contexteDeTache\(JOB\)[\s\S]*?const lectureDurees = await chargerDurees\(admin\)[\s\S]*?\.rpc\('constater_annonces_expirees',\s*\{\s*p_piece: journal\.piece,\s*p_vie_annonce_jours: durees\.vieAnnonceJours,\s*p_limite: LIMITE_PAR_PASSAGE,\s*\}\)/, quoi: 'la tâche de constat ouvre UNE pièce par passage, lit la durée en vigueur, et la passe avec la pièce à la fonction SQL' },
    { code: 'cv_televerse', fichier: 'lib/profil/journal-profil.ts', bloc: 'export async function cvTeleverse(', motif: /type: 'cv_televerse',\s*statut: args\.analyse === 'done' \? 'reussi' : 'echoue',\s*sujet: \{ type: 'profiles', id: args\.profileId \},\s*detail: \{\s*octets: args\.octets,\s*analyse: args\.analyse,\s*premier_consentement: args\.premierConsentement,\s*experiences: args\.experiences,\s*formations: args\.formations,\s*langues: args\.langues,\s*\},/, quoi: 'l’écrivain unique des deux voies : l’issue de l’analyse, le premier consentement, des comptes — jamais l’empreinte ni le nom du fichier' },
    ...['app/api/profile/upload-cv/route.ts', 'app/api/profile/cdi-upload-cv/route.ts'].map((fichier) => ({ code: 'cv_televerse', fichier, bloc: 'export async function POST(', motif: (b) => {
        const appels = [...b.matchAll(/await cvTeleverse\(supabaseAdmin, journal, \{[\s\S]*?analyse: '(done|failed)',/g)].map((m) => m[1]).sort()
        const premierAvantEcriture = b.indexOf('const premierConsentement = ') > 0 && b.indexOf('const premierConsentement = ') < b.indexOf("cv_parsing_status: 'processing'")
        // L'audit de l'analyse faite est reconnu à son DÉTAIL (un `status: 'done'` plus haut est la réponse du CV déjà analysé).
        const avantAudit = b.indexOf("analyse: 'failed'") < b.indexOf("detail: { status: 'failed'") && b.indexOf("analyse: 'done'") < b.search(/detail: \{\s*status: 'done',/)
        return appels.join(',') === 'done,failed' && premierAvantEcriture && avantAudit && /journalRefuse = err/.test(b) && /if \(journalRefuse\) return json\(\{ error: 'Journal failed', code: 'journal_error', profile_id: \w+\.id \}, 500\)/.test(b)
      }, quoi: 'la voie écrit la ligne aux DEUX issues (analyse faite, analyse en échec), avant l’audit ; le premier consentement est lu AVANT l’écriture qui le pose ; un journal qui refuse est rendu après le travail différé' })),
    { code: 'profil_publie', fichier: 'lib/profil/journal-profil.ts', bloc: 'export async function profilPublie(', motif: /type: 'profil_publie',\s*statut: 'reussi',\s*sujet: \{ type: 'profiles', id: args\.profileId \},\s*detail: \{ deja_visible: args\.dejaVisible, verification_avant: args\.verificationAvant \},/, quoi: 'l’écrivain : première publication ou republication, et l’état de vérification d’avant' },
    { code: 'profil_publie', fichier: 'app/api/profile/route.ts', bloc: 'export async function PATCH(', motif: (b) => /if \(body\.visible === true\) \{\s*const \{ error: userUpdErr \}[\s\S]*?\}\s*try \{\s*await profilPublie\(supabaseAdmin, journal, \{ profileId: cp\.id, dejaVisible: cp\.visible === true, verificationAvant: \(cp\.verification_status as string \| null\) \?\? null \}\)/.test(b) && b.indexOf('await profilPublie(') < b.indexOf('runExpertVerification({') && b.indexOf('await profilPublie(') < b.indexOf("action: 'profile_update'") && /journalRefuse = err/.test(b) && b.indexOf('after(async () =>') < b.indexOf("if (journalRefuse) return json({ error: 'Journal failed', code: 'journal_error', profile_id: cp.id }, 500)"), quoi: 'la route écrit la ligne dans la branche visible=true, AVANT la vérification et l’audit ; un refus du journal est gardé et rendu APRÈS le travail différé' },
    { code: 'profil_publie', fichier: 'app/api/profile/route.ts', bloc: 'const baseSelect =', motif: /\bvisible\b/, quoi: 'la colonne `visible` est LUE avec le profil (§E.1) — sans elle, « déjà visible » se lirait toujours faux' },
    { code: 'profil_modifie', fichier: 'lib/profil/journal-profil.ts', bloc: 'export async function profilModifie(', motif: /type: 'profil_modifie',\s*statut: 'reussi',\s*sujet: \{ type: 'profiles', id: args\.profileId \},\s*detail: \{ champs: args\.champs, blocs: args\.blocs \},/, quoi: 'l’écrivain : les noms des champs et des blocs, jamais leur contenu' },
    { code: 'profil_modifie', fichier: 'app/api/profile/route.ts', bloc: 'export async function PATCH(', motif: (b) => /const champDispo = CHAMP_DISPONIBILITE\[isCdi \? 'expert_cdi' : 'expert_freelance'\]\s*const champsModifies = Object\.keys\(patch\)\.filter\(\(k\) => k !== 'visible' && k !== champDispo\)\s*if \(champsModifies\.length > 0 \|\| touchedBlocks\.length > 0\) \{\s*try \{\s*await profilModifie\(supabaseAdmin, journal, \{ profileId: cp\.id, champs: champsModifies, blocs: touchedBlocks \}\)/.test(b) && b.indexOf('await profilModifie(') > b.indexOf('.update(patch)') && b.indexOf('await profilModifie(') < b.indexOf('if (body.visible === true) {\n    const { error: userUpdErr }') && b.indexOf('await profilModifie(') < b.indexOf("action: 'profile_update'"), quoi: 'la route écrit la modification APRÈS l’écriture des scalaires et des blocs, avant la publication et l’audit — hors visible et hors le champ de disponibilité de la voie' },
    { code: 'disponibilite_basculee', fichier: 'lib/profil/journal-profil.ts', bloc: 'export async function disponibiliteBasculee(', motif: /type: 'disponibilite_basculee',\s*statut: 'reussi',\s*sujet: \{ type: 'profiles', id: args\.profileId \},\s*detail: \{ champ: args\.champ, de: args\.de, vers: args\.vers \},/, quoi: 'l’écrivain : le champ de la voie, l’état d’avant, l’état d’après — des codes' },
    { code: 'disponibilite_basculee', fichier: 'app/api/profile/route.ts', bloc: 'export async function PATCH(', motif: (b) => /const champDispo = CHAMP_DISPONIBILITE\[isCdi \? 'expert_cdi' : 'expert_freelance'\]/.test(b) && /if \(champDispo in patch && patch\[champDispo\] !== cp\[champDispo\]\) \{\s*try \{\s*await disponibiliteBasculee\(supabaseAdmin, journal, \{ profileId: cp\.id, champ: champDispo, de: \(cp\[champDispo\] as string \| null\) \?\? null, vers: \(patch\[champDispo\] as string \| null\) \?\? null \}\)/.test(b) && b.indexOf('await disponibiliteBasculee(') > b.indexOf('.update(patch)') && b.indexOf('await disponibiliteBasculee(') < b.indexOf("action: 'profile_update'"), quoi: 'la route écrit la bascule quand le champ de la voie CHANGE (l’avant lu avec le profil), après l’écriture, avant l’audit' },
    { code: 'devoilement_ferme', fichier: 'app/api/cron/constats/route.ts', bloc: 'async function handle(', motif: /\.from\('candidatures'\)\s*\.select\('id, status, unlocked_at, conversations\(expires_at\)'\)\s*\.eq\('status', 'unlocked'\)\s*\.is\('fermeture_constatee_at', null\)[\s\S]*?const vie = deriveCandidatureLifecycle\([\s\S]*?if \(vie\.reason !== 'exchange_expired'\) continue[\s\S]*?\.rpc\('constater_devoilement_ferme',\s*\{\s*p_piece: journal\.piece,\s*p_candidature_id: c\.id,\s*p_fin_echange: fin\.toISOString\(\),/, quoi: 'la tâche lit les dévoilées jamais constatées avec leur fil, laisse la SOURCE UNIQUE de l’état de vie décider « échange refermé », et constate avec la pièce du passage et la fin d’échange' },
    // ── E : la sécurité des comptes et la gouvernance d'organisation ──
    { code: 'compte_suspendu', fichier: 'app/api/admin/user-status/route.ts', bloc: 'export async function POST(', motif: (b) => /const journal = contexteDepuisAuth\(auth\)/.test(b) && /\.rpc\('changer_statut_compte',\s*\{\s*\.\.\.parametresJournal\(journal\),\s*p_user_id: t\.id,\s*p_statuts_admis: \[t\.status\],\s*p_nouveau_statut: nextStatus,\s*p_suspend: action === 'suspend',\s*\}\)/.test(b) && /if \(!bascule\) \{[\s\S]{0,300}?code: 'wrong_status' \}, 409\)/.test(b) && !/\.from\('users'\)[\s\S]{0,120}?\.update\(\{ status:/.test(b), quoi: 'la route bascule par la RPC métier avec le contexte et le statut LU comme seul statut admis ; zéro ligne répond 409 ; plus d’écriture directe du statut' },
    { code: 'recherche_classee', fichier: 'lib/ai-budget.ts', bloc: 'export async function enregistrerDepenseIA(', motif: /await signalerPlafondAtteint\([^\n]*\)\s*return \{ cout_usd: cout \}\s*\} catch \(err\) \{[\s\S]*?return \{ cout_usd: null \}/, quoi: 'l’enregistrement REND le coût calculé au tarif (null si tarif manquant ou exception) — un seul calcul, jamais recalculé par l’appelant (§E.13)' },
  ]
  // La même preuve côté SQL : chaque RPC métier écrit sa table, compte la
  // ligne, PUIS appelle l'écrivain unique — dans sa DERNIÈRE définition.
  const PREUVES_SQL = [
    { fn: 'journaliser_reglage', motif: /if p_statut not in \('reussi', 'echoue'\)[\s\S]*?using errcode = 'GL003'[\s\S]*?return public\.journaliser\(\s*p_piece, 'reglage_modifie', p_statut, 'administrateur'/, quoi: 'l’écrivain unique : reussi ou echoue, jamais refuse' },
    { fn: 'regler_tarif_ia', motif: /update public\.ai_model_tarifs[\s\S]*?get diagnostics v_n = row_count;[\s\S]*?return public\.journaliser_reglage\(/, quoi: 'tarifs : écrit, compté, puis journalisé — même transaction' },
    { fn: 'regler_plafonds_ia', motif: (c) => /update public\.ai_spend_caps/.test(c) && (c.match(/journaliser_reglage\(/g) || []).length === 3 && /p_sujet_plafonds,[\s\S]*?p_sujet_alertes,[\s\S]*?p_sujet_plafonds_acteur,/.test(c), quoi: 'plafonds : trois familles, trois lignes, trois sujets distincts' },
    { fn: 'regler_quota_ia', motif: /update public\.ai_quotas[\s\S]*?get diagnostics v_n = row_count;[\s\S]*?return public\.journaliser_reglage\(/, quoi: 'quota : écrit, compté, puis journalisé' },
    { fn: 'regler_matching', motif: /update public\.matching_settings[\s\S]*?get diagnostics v_n = row_count;[\s\S]*?return public\.journaliser_reglage\(\s*p_piece, p_acteur_id, p_domain_id/, quoi: 'moteur : écrit, compté, puis journalisé — sur l’écosystème du réglage' },
    { fn: 'regler_note_jugement', motif: /update public\.verification_providers[\s\S]*?get diagnostics v_n = row_count;[\s\S]*?return public\.journaliser_reglage\(/, quoi: 'notes : écrit, compté, puis journalisé' },
    { fn: 'set_default_package', motif: /invariant_broken[\s\S]*?perform public\.journaliser_reglage\([\s\S]*?'packages_default', public\.identifiant_derive\('reglage', 'packages_default:' \|\| v_target\)/, quoi: 'défaut : vérifié PUIS journalisé, sur le défaut de la cible — pas sur l’offre' },
    { fn: 'enregistrer_paiement', code: 'paiement_recu', motif: /on conflict \(stripe_invoice_id\) where stripe_invoice_id is not null do nothing\s+returning id into v_id;[\s\S]*?if v_id is null then\s+return null;[\s\S]*?perform public\.journaliser\(\s*p_piece, 'paiement_recu', 'reussi', 'systeme',\s*null::uuid, null::text, v_t\.domain_id,\s*'organizations', v_t\.organization_id,/, quoi: 'la pièce comptable est insérée (doublon : rien, ni ligne), PUIS journalisée sur l’organisation — même transaction' },
    { fn: 'inserer_candidature_jugee', code: 'candidature_deposee', motif: /on conflict \(publication_id, profile_id\) do nothing[\s\S]*?if v_id is null then[\s\S]*?delete from public\.candidature_depots[\s\S]*?return null;[\s\S]*?update public\.candidature_depots[\s\S]*?set etat\s*=\s*'depose'[\s\S]*?perform public\.journaliser\(\s*p_piece, 'candidature_deposee', 'reussi', p_origine,\s*p_acteur_id, p_acteur_type, v_c\.domain_id,\s*'candidatures', v_id,[\s\S]*?p_piece_origine/, quoi: 'la candidature est insérée (concurrente : rien, ligne du dépôt retirée), le journal du dépôt soldé, PUIS la ligne écrite avec la pièce d’origine — même transaction' },
    { fn: 'ouvrir_depot_candidature', code: 'candidature_deposee', motif: /p_piece\s+uuid[\s\S]*?raise exception 'ouvrir_depot_candidature : la piece est obligatoire' using errcode = 'GL002'[\s\S]*?piece\s*=\s*excluded\.piece/, quoi: 'le journal du dépôt exige la pièce et la pose, à l’ouverture comme à la relance' },
    { fn: 'solder_depot_en_echec', code: 'refus_depot_sans_jugement', motif: /set etat\s*=\s*'echec'[\s\S]*?returning d\.id, d\.tentatives, d\.domain_id[\s\S]*?perform public\.journaliser\(\s*p_piece, 'refus_depot_sans_jugement', 'refuse', p_origine,\s*p_acteur_id, p_acteur_type, v_domaine,[\s\S]*?'cause', p_cause,[\s\S]*?p_piece_origine/, quoi: 'le journal du dépôt est soldé en échec PUIS le refus écrit, au statut imposé, avec la cause fermée et la pièce d’origine — même transaction' },
    { fn: 'decliner_candidature', code: 'candidature_declinee', motif: /set status\s*=\s*'rejected'[\s\S]*?and c\.domain_id = p_domain_id\s*and c\.status = any \(p_statuts_admis\)\s*and exists \(select 1 from public\.publications p\s*where p\.id = c\.publication_id and p\.organization_id = p_organization_id\)[\s\S]*?if v_publication is null then[\s\S]*?return false;[\s\S]*?perform public\.journaliser\(\s*p_piece, 'candidature_declinee', 'reussi', p_origine,/, quoi: 'transition, cloisonnement et propriété rejoués dans l’UPDATE ; zéro ligne rend false sans journaliser ; PUIS la ligne — même transaction' },
    { fn: 'retenir_candidature', code: 'candidature_retenue', motif: /set status\s*=\s*'selected',\s*selected_at = now\(\)[\s\S]*?and c\.domain_id = p_domain_id\s*and c\.status = any \(p_statuts_admis\)\s*and exists \(select 1 from public\.publications p\s*where p\.id = c\.publication_id and p\.organization_id = p_organization_id\)[\s\S]*?if v_selected_at is null then[\s\S]*?return null;[\s\S]*?perform public\.journaliser\(\s*p_piece, 'candidature_retenue', 'reussi', p_origine,[\s\S]*?return v_selected_at;/, quoi: 'transition, cloisonnement et propriété rejoués dans l’UPDATE ; zéro ligne rend null sans journaliser ; PUIS la ligne, et selected_at rendu — même transaction' },
    { fn: 'publier_annonce', code: 'annonce_publiee', motif: /update public\.publications p[\s\S]*?published_at\s*=\s*case when p_verdict = 'published' then now\(\) else p\.published_at end[\s\S]*?and p\.organization_id = p_organization_id\s*and p\.status = any \(p_statuts_admis\)[\s\S]*?if not found then\s*return null;[\s\S]*?if p_verdict = 'published' then\s*perform public\.journaliser\(\s*p_piece, 'annonce_publiee', 'reussi', p_origine,/, quoi: 'transition rejouée dans l’UPDATE, published_at posé par la base, zéro ligne rend null, ligne SEULEMENT si publiée — même transaction' },
    { fn: 'cloturer_annonce', code: 'annonce_depubliee', motif: /select p\.status into v_de[\s\S]*?for update;\s*if not found or not \(v_de = any \(p_statuts_admis\)\) then\s*return false;[\s\S]*?update public\.publications p\s*set status = 'archived'[\s\S]*?and p\.status = v_de;\s*get diagnostics v_n = row_count;\s*if v_n = 0 then\s*return false;[\s\S]*?perform public\.journaliser\(\s*p_piece, 'annonce_depubliee', 'reussi', p_origine,[\s\S]*?'de', v_de, 'vers', 'archived'/, quoi: 'statut d’origine lu sous verrou et jugé contre les statuts admis de la ROUTE (aucun littéral de statut ici), transition rejouée, zéro ligne rend false, PUIS la ligne — même transaction' },
    { fn: 'constater_annonces_expirees', code: 'annonce_expiree', motif: /where p\.expiration_constatee_at is null\s*and p\.published_at is not null\s*and p\.status = 'published'\s*and not public\.annonce_active\(p\.status, p\.expires_at, p\.published_at, p_vie_annonce_jours\)[\s\S]*?for update skip locked[\s\S]*?set expiration_constatee_at = now\(\)[\s\S]*?perform public\.journaliser\(\s*p_piece, 'annonce_expiree', 'reussi', 'tache_planifiee',\s*null::uuid, null::text, r\.domain_id,\s*'publications', r\.id,/, quoi: 'jamais constatée, publiée, et plus active selon la SEULE règle du schéma (annonce_active) ; marqueur PUIS ligne, même transaction, sous verrou' },
    { fn: 'constater_devoilement_ferme', code: 'devoilement_ferme', motif: /if p_fin_echange is null or p_fin_echange > now\(\) then[\s\S]*?update public\.candidatures c\s*set fermeture_constatee_at = now\(\)\s*where c\.id = p_candidature_id\s*and c\.fermeture_constatee_at is null\s*and c\.status = 'unlocked'\s*returning[\s\S]*?if not found then\s*return false;[\s\S]*?perform public\.journaliser\(\s*p_piece, 'devoilement_ferme', 'reussi', 'tache_planifiee',/, quoi: 'une fin d’échange future est refusée ; marqueur posé sur une candidature encore dévoilée et jamais constatée, PUIS la ligne — même transaction ; zéro ligne rend false' },
    { fn: 'changer_statut_compte', code: 'compte_suspendu', motif: /select u\.id, u\.status, u\.domain_id, u\.user_type[\s\S]*?for update;\s*if not found or not \(v_u\.status = any \(p_statuts_admis\)\) then\s*return null;[\s\S]*?update public\.users u\s*set status = p_nouveau_statut,[\s\S]*?perform public\.journaliser\(\s*p_piece,\s*case when p_suspend then 'compte_suspendu' else 'compte_reactive' end,\s*'reussi', p_origine,\s*p_acteur_id, p_acteur_type, v_u\.domain_id,/, quoi: 'verrou de ligne, transition rejouée (zéro ligne rend null), bascule PUIS ligne dont le CODE est dérivé du geste — même transaction, écosystème de la cible' },
    { fn: 'devoiler_candidature', code: 'devoilement_ouvert', motif: /where c\.id = p_candidature_id\s*for update;[\s\S]*?'transition'[\s\S]*?insert into public\.conversations \(candidature_id, domain_id, status, expires_at\)[\s\S]*?on conflict \(candidature_id\) do nothing[\s\S]*?if v_c\.status = 'unlocked' then[\s\S]*?'deja'[\s\S]*?set status\s*=\s*'unlocked',\s*unlocked_at = now\(\)[\s\S]*?perform public\.journaliser\(\s*p_piece, 'devoilement_ouvert', 'reussi', p_origine,[\s\S]*?'auto', p_auto,[\s\S]*?'devoilee'/, quoi: 'verrou de ligne, transition jugée, conversation idempotente, « déjà » sans ligne, bascule PUIS ligne avec l’origine — même transaction' },
  ]
  // Le CORPS d'une fonction TypeScript : après la parenthèse fermante de sa
  // signature — le premier `{` après le nom serait celui d'un type de paramètre.
  const corpsFonctionTs = (src, debut) => {
    const i = src.indexOf(debut)
    if (i < 0) return null
    const o = src.indexOf('(', i)
    let p = 0
    let fermante = -1
    for (let k = o; k < src.length; k++) {
      if (src[k] === '(') p++
      else if (src[k] === ')') { p--; if (p === 0) { fermante = k; break } }
    }
    if (fermante < 0) return null
    // Le CORPS commence à la première accolade HORS chevrons : `): Promise<{ a: 1 }> {`
    // porte une accolade de TYPE avant celle du corps, et la prendre lirait un type.
    let angle = 0
    for (let k = fermante + 1; k < src.length; k++) {
      const c = src[k]
      if (c === '<') angle++
      else if (c === '>' && src[k - 1] !== '=') angle = Math.max(0, angle - 1)
      else if (c === '{' && angle === 0) return blocApres(src.slice(k), '{')
    }
    return null
  }
  const tient = (motif, texte) => (typeof motif === 'function' ? motif(texte) : motif.test(texte))
  // Une INSTRUCTION (`const X =`) n'a pas d'accolade : c'est le texte jusqu'à la première ligne vide.
  const instructionApres = (src, debut) => {
    const i = src.indexOf(debut)
    if (i < 0) return null
    const j = src.indexOf('\n\n', i)
    return src.slice(i, j < 0 ? src.length : j)
  }
  for (const p of PREUVES) {
    const src = stripTs(read(p.fichier))
    const bloc = (p.bloc.endsWith('(') ? corpsFonctionTs(src, p.bloc) : p.bloc.endsWith(' =') ? instructionApres(src, p.bloc) : blocApres(src, p.bloc)) ?? ''
    ok(bloc.length > 0 && tient(p.motif, bloc), `${p.code} — ${p.quoi} (${p.fichier} · ${p.bloc.trim().slice(0, 40)})`)
  }
  for (const p of PREUVES_SQL) {
    const corps = DEFINITIONS_COURANTES.get(p.fn)?.corps ?? ''
    ok(corps.length > 0 && tient(p.motif, corps), `${p.code ?? 'reglage_modifie'} — ${p.quoi} (SQL · ${p.fn}())`)
  }
}

// ═══ E. LE DÉRIVEUR SQL EST LE DÉRIVEUR TYPESCRIPT ══════════════════════════
section('E. identifiant_derive() rend ce que rend lib/admin/identifiant-derive.ts')
{
  const fnDerive = corpsSql(SQL, 'public.identifiant_derive(')
  ok(/select md5\(p_espace \|\| ':' \|\| p_cle\)::uuid/.test(fnDerive), 'md5(espace:clé) lu comme uuid — le même procédé')
  const m = /identifiant_derive\('cron_job', 'ip_retention_purge'\) <> '([0-9a-f-]{36})'::uuid/.exec(SQL)
  const temoinTs = identifiantDerive('cron_job', 'ip_retention_purge')
  ok(!!m && m[1] === temoinTs,
    `le témoin de la postcondition est RECALCULÉ par le TypeScript : ${temoinTs}`,
    m ? `la migration attend ${m[1]}` : 'témoin absent de la postcondition')
}

// ═══ F. LA POSTCONDITION S'EXÉCUTE ══════════════════════════════════════════
section('F. La postcondition EXÉCUTE : refus, verrou, privilèges, deux actions — puis annule')
{
  const iPost = SQL.indexOf('do $post$')
  const post = iPost < 0 ? '' : SQL.slice(iPost)
  ok(/to_regprocedure\(s\) is null/.test(post) && /journaliser\(uuid, text, text, text, uuid, text, uuid, text, uuid, jsonb, uuid, numeric, text\)/.test(post),
    'signatures par TYPES (to_regprocedure), journaliser comprise')
  ok(/when sqlstate 'GL002'/.test(post) && (post.match(/when sqlstate 'GL003'/g) || []).length >= 2,
    'sondes : sans pièce (GL002), type inconnu et refus au mauvais statut (GL003)')
  ok(/UPDATE ACCEPTE[\s\S]{0,200}?when sqlstate 'GL001'/.test(post) && /DELETE ACCEPTE[\s\S]{0,200}?when sqlstate 'GL001'/.test(post),
    'un UPDATE et un DELETE sont TENTÉS et doivent lever GL001 — dans la postcondition même')
  ok(/select detail into v_detail[\s\S]{0,200}?'\{"ok":1\}'::jsonb/.test(post), 'la clé personnelle du détail sonde est retirée')
  ok(/has_table_privilege\('service_role', 'public\.grand_livre', 'INSERT'\)/.test(post) && /has_table_privilege\('service_role', 'public\.grand_livre', 'SELECT'\)/.test(post),
    'les privilèges sont INTERROGÉS, pas déduits du revoke')
  ok(/regler_durees_place\(v_piece, v_acteur/.test(post) && /effacer_adresses_ip\(\)/.test(post) && /'ip_effacees'/.test(post),
    'les deux actions réelles sont REJOUÉES en sonde')
  ok((post.match(/raise exception 'SONDE_ANNULEE'/g) || []).length >= 3, 'chaque sonde s’annule : la migration ne laisse aucune ligne')
  for (const idx of ['grand_livre_date_type_idx', 'grand_livre_date_acteur_idx', 'grand_livre_date_ecosysteme_idx']) {
    ok(post.includes(`'${idx}'`), `l’index ${idx} est vérifié dans pg_index (première colonne), pas dans une chaîne rendue`)
  }
  // La liste blanche a sa propre postcondition, qui s'exécute elle aussi.
  const BLANCHE = stripSql(read(migration('liste_blanche_par_action')))
  const iPostB = BLANCHE.indexOf('do $post$')
  const postB = iPostB < 0 ? '' : BLANCHE.slice(iPostB)
  ok(/when sqlstate 'GL004' then[\s\S]{0,200}?sqlerrm not like '%email_facturation%'/.test(postB),
    'liste blanche : une clé hors liste est REFUSÉE, et le refus NOMME la clé (sonde exécutée)')
  // Ancré sur le DÉTAIL passé à la sonde, pas sur le message du raise (§E.7) :
  // la clé nouvelle doit être dans le jsonb envoyé à journaliser().
  ok(/journaliser\([^;]*?'\{[^']*"nom_contact"[^']*\}'::jsonb\)[\s\S]{0,300}?when sqlstate 'GL004'/.test(postB),
    'liste blanche : une clé personnelle NOUVELLE, imbriquée, est refusée par la liste blanche — pas par la liste noire')
  ok(/when sqlstate 'GL005'/.test(postB), 'une fois : la même écriture rejouée LÈVE GL005 (sonde exécutée)')
  ok(/grand_livre_chemins\('\{"a":\{"b":1,"c":null\}[\s\S]{0,200}?array\['a\.b', 'a\.c', 'l\[\]\.x', 't', 'v'\]/.test(postB),
    'la fonction pure des chemins est EXÉCUTÉE sur un objet imbriqué, un tableau, un nul, deux vides')
  // La migration des réglages a la sienne, exécutée elle aussi.
  const REGLAGES = stripSql(read(migration('journal_reglages')))
  const iPostR = REGLAGES.indexOf('do $post$')
  const postR = iPostR < 0 ? '' : REGLAGES.slice(iPostR)
  ok(/drop function if exists public\.set_default_package\(uuid\);/.test(REGLAGES) && /to_regprocedure\('public\.set_default_package\(uuid\)'\) is not null/.test(postR),
    'réglages : l’ancienne set_default_package(uuid) — une porte sans journal — est SUPPRIMÉE, et la postcondition le vérifie')
  ok(/'public\.journaliser_reglage\(uuid, uuid, uuid, text, uuid, jsonb, jsonb, jsonb, text\)'/.test(postR) && /'public\.set_default_package\(uuid, uuid, uuid, uuid\)'/.test(postR),
    'réglages : les huit signatures sont vérifiées par TYPES (to_regprocedure)')
  ok(/journaliser_reglage\([^;]*?'\{"change_reason":"texte libre"\}'::jsonb\)[\s\S]{0,300}?when sqlstate 'GL004'/.test(postR),
    'réglages : un TEXTE LIBRE est refusé par la liste blanche (sonde exécutée)')
  ok(/journaliser_reglage\([^;]*?'refuse'\)[\s\S]{0,300}?when sqlstate 'GL003'/.test(postR),
    'réglages : le statut « refuse » est refusé à l’écrivain des réglages (sonde exécutée)')
  ok(/detail -> 'apres' ->> 'max_per_window' = '5' and detail ->> 'quota' = 'cv_parsing'/.test(postR) && /regler_durees_place\(gen_random_uuid\(\), v_acteur/.test(postR),
    'réglages : la ligne écrite est RELUE (avant, après, complément), et les durées sont rejouées par la porte recréée')
  ok((postR.match(/raise exception 'SONDE_ANNULEE'/g) || []).length >= 2, 'réglages : chaque sonde qui écrit s’annule')
  // Le paiement reçu a la sienne : la pièce et sa ligne naissent ensemble, le doublon n'écrit rien.
  const PAIEMENT = stripSql(read(migration('journal_paiement')))
  const iPostP = PAIEMENT.indexOf('do $post$')
  const postP = iPostP < 0 ? '' : PAIEMENT.slice(iPostP)
  ok(/to_regprocedure\('public\.enregistrer_paiement\(uuid, jsonb, text\)'\) is null/.test(postP), 'paiement : la signature est vérifiée par TYPES')
  ok((postP.match(/public\.enregistrer_paiement\(gen_random_uuid\(\),/g) || []).length === 2 && /v_id2 is not null or v_lignes <> 1/.test(postP),
    'paiement : la RPC est EXÉCUTÉE deux fois sur la même facture — la seconde n’insère ni ne journalise (sonde annulée)')
  ok(/detail ->> 'transaction_id' = v_id::text/.test(postP) && /raise exception 'SONDE_ANNULEE'/.test(postP),
    'paiement : la ligne est RELUE (sujet organisation, transaction dans le détail), puis annulée')
  // La candidature déposée a la sienne : ouverture avec pièce, écriture, journal du dépôt soldé, ligne relue, concurrente refusée.
  const DEPOSEE = stripSql(read(migration('journal_candidature_deposee')))
  const iPostD = DEPOSEE.indexOf('do $post$')
  const postD = iPostD < 0 ? '' : DEPOSEE.slice(iPostD)
  ok(/drop function if exists public\.ouvrir_depot_candidature\(uuid, uuid, uuid, text\);/.test(DEPOSEE) && /to_regprocedure\('public\.ouvrir_depot_candidature\(uuid, uuid, uuid, text\)'\) is not null/.test(postD),
    'dépôt : l’ancienne ouverture SANS pièce est supprimée, et la postcondition le vérifie')
  ok(/'public\.inserer_candidature_jugee\(uuid, uuid, text, uuid, text, jsonb, text\)'/.test(postD), 'dépôt : les signatures sont vérifiées par TYPES')
  ok((postD.match(/public\.inserer_candidature_jugee\((v_piece|gen_random_uuid\(\)),/g) || []).length === 2 && /v_res2 is not null or v_lignes <> 1/.test(postD),
    'dépôt : la RPC est EXÉCUTÉE deux fois sur le même couple — la concurrente n’insère ni ne journalise (sonde annulée)')
  ok(/d\.piece = v_piece and d\.etat = 'en_cours'/.test(postD) && /d\.etat = 'depose' and d\.candidature_id = \(v_res ->> 'id'\)::uuid and d\.cover_message is null/.test(postD),
    'dépôt : le journal du dépôt porte la pièce à l’ouverture, et il est SOLDÉ par l’écriture (relu)')
  ok(/g\.piece = v_piece and g\.type_action = 'candidature_deposee'[\s\S]{0,300}?g\.detail ->> 'tentative' = '1'/.test(postD) && /raise exception 'SONDE_ANNULEE'/.test(postD),
    'dépôt : la ligne est RELUE sous sa pièce (sujet candidature, tentative comptée), puis annulée')
  // Le refus sans jugement a la sienne : statut imposé éprouvé, solde et refus relus.
  const REFUS_DEPOT = stripSql(read(migration('journal_refus_depot_sans_jugement')))
  const iPostR2 = REFUS_DEPOT.indexOf('do $post$')
  const postR2 = iPostR2 < 0 ? '' : REFUS_DEPOT.slice(iPostR2)
  ok(/to_regprocedure\('public\.solder_depot_en_echec\(uuid, uuid, text, uuid, text, uuid, uuid, text, text\)'\) is null/.test(postR2), 'refus de dépôt : la signature est vérifiée par TYPES')
  ok(/journaliser\(gen_random_uuid\(\), 'refus_depot_sans_jugement', 'reussi'[\s\S]{0,400}?when sqlstate 'GL003'/.test(postR2),
    'refus de dépôt : le statut « reussi » est REFUSÉ par la base pour cette action (sonde exécutée)')
  ok(/public\.ouvrir_depot_candidature\(v_pub, v_prof, v_domaine, 'sonde', v_piece\)[\s\S]*?public\.solder_depot_en_echec\(v_piece,[\s\S]*?d\.etat = 'echec' and d\.cause = 'plafond'[\s\S]*?g\.type_action = 'refus_depot_sans_jugement' and g\.statut = 'refuse'[\s\S]*?g\.detail ->> 'tentative' = '1'[\s\S]*?raise exception 'SONDE_ANNULEE'/.test(postR2),
    'refus de dépôt : ouverture, solde en échec RELU, refus RELU sous sa pièce (cause, tentative), puis annulé')
  // L'expert inapte : la forme du code acceptée, le texte libre refusé.
  const INAPTE = stripSql(read(migration('journal_refus_expert_inapte')))
  const iPostI = INAPTE.indexOf('do $post$')
  const postI = iPostI < 0 ? '' : INAPTE.slice(iPostI)
  ok(/journaliser\(gen_random_uuid\(\), 'refus_expert_inapte', 'refuse', 'utilisateur',[\s\S]{0,300}?jsonb_build_object\('raison', 'ne_pas_deranger', 'publication_id', gen_random_uuid\(\)\)[\s\S]{0,400}?raise exception 'SONDE_ANNULEE'/.test(postI),
    'expert inapte : la forme exacte que le code envoie est ÉCRITE au statut imposé, puis annulée')
  ok(/"message":"texte libre"[\s\S]{0,300}?when sqlstate 'GL004'/.test(postI), 'expert inapte : un texte libre est REFUSÉ (sonde exécutée)')
  // Les refus de garde : même forme.
  const GARDE = stripSql(read(migration('journal_refus_garde_eligibilite')))
  const iPostG = GARDE.indexOf('do $post$')
  const postG = iPostG < 0 ? '' : GARDE.slice(iPostG)
  ok(/journaliser\(gen_random_uuid\(\), 'refus_garde_eligibilite', 'refuse', 'utilisateur',[\s\S]{0,300}?jsonb_build_object\('code', 'already_applied', 'profile_id', gen_random_uuid\(\)\)[\s\S]{0,400}?raise exception 'SONDE_ANNULEE'/.test(postG),
    'refus de garde : la forme exacte que le code envoie est ÉCRITE au statut imposé, puis annulée')
  ok(/"message":"texte libre"[\s\S]{0,300}?when sqlstate 'GL004'/.test(postG), 'refus de garde : un texte libre est REFUSÉ (sonde exécutée)')
  // Le quota de CV : même forme.
  const QUOTA = stripSql(read(migration('journal_refus_quota_cv')))
  const iPostQ = QUOTA.indexOf('do $post$')
  const postQ = iPostQ < 0 ? '' : QUOTA.slice(iPostQ)
  ok(/journaliser\(gen_random_uuid\(\), 'refus_quota_cv', 'refuse', 'utilisateur',[\s\S]{0,300}?jsonb_build_object\('quota', 'cv_parsing', 'limite', 3, 'fenetre_heures', 24, 'reset_at', now\(\), 'compte', 3\)[\s\S]{0,400}?raise exception 'SONDE_ANNULEE'/.test(postQ),
    'quota de CV : la forme exacte que le code envoie est ÉCRITE au statut imposé, puis annulée')
  ok(/"message":"texte libre"[\s\S]{0,300}?when sqlstate 'GL004'/.test(postQ), 'quota de CV : un texte libre est REFUSÉ (sonde exécutée)')
  // La candidature déclinée : transition relue, rejeu sans seconde ligne.
  const DECLINEE = stripSql(read(migration('journal_candidature_declinee')))
  const iPostDc = DECLINEE.indexOf('do $post$')
  const postDc = iPostDc < 0 ? '' : DECLINEE.slice(iPostDc)
  ok(/to_regprocedure\('public\.decliner_candidature\(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text, text\[\]\)'\) is null/.test(postDc), 'déclinée : la signature est vérifiée par TYPES')
  ok((postDc.match(/public\.decliner_candidature\((v_piece|gen_random_uuid\(\)),/g) || []).length === 2 && /v_ok2 is distinct from false or v_lignes <> 1/.test(postDc),
    'déclinée : la RPC est EXÉCUTÉE deux fois sur la même candidature — le rejeu rend false et n’écrit pas (sonde annulée)')
  ok(/c\.status = 'rejected' and c\.status_reason = 'sonde'/.test(postDc) && /\(g\.detail ->> 'has_reason'\)::boolean/.test(postDc) && /raise exception 'SONDE_ANNULEE'/.test(postDc),
    'déclinée : la transition et la ligne sont RELUES, puis annulées')
  // La candidature retenue : même forme, selected_at relu tel que rendu.
  const RETENUE = stripSql(read(migration('journal_candidature_retenue')))
  const iPostRt = RETENUE.indexOf('do $post$')
  const postRt = iPostRt < 0 ? '' : RETENUE.slice(iPostRt)
  ok(/to_regprocedure\('public\.retenir_candidature\(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text\[\]\)'\) is null/.test(postRt), 'retenue : la signature est vérifiée par TYPES')
  ok((postRt.match(/public\.retenir_candidature\((v_piece|gen_random_uuid\(\)),/g) || []).length === 2 && /v_quand2 is not null or v_lignes <> 1/.test(postRt),
    'retenue : la RPC est EXÉCUTÉE deux fois sur la même candidature — le rejeu rend null et n’écrit pas (sonde annulée)')
  ok(/c\.status = 'selected' and c\.selected_at = v_quand/.test(postRt) && /g\.detail ->> 'publication_type' is not null/.test(postRt) && /raise exception 'SONDE_ANNULEE'/.test(postRt),
    'retenue : la transition (selected_at tel que rendu) et la ligne sont RELUES, puis annulées')
  // Le dévoilement : conversation, bascule et ligne relues ; le rejeu est « déjà » sur la même conversation.
  const DEVOILE = stripSql(read(migration('journal_devoilement_ouvert')))
  const iPostDv = DEVOILE.indexOf('do $post$')
  const postDv = iPostDv < 0 ? '' : DEVOILE.slice(iPostDv)
  ok(/to_regprocedure\('public\.devoiler_candidature\(uuid, uuid, text, uuid, text, uuid, text\[\], timestamptz, boolean\)'\) is null/.test(postDv), 'dévoilement : la signature est vérifiée par TYPES')
  ok((postDv.match(/public\.devoiler_candidature\((v_piece|gen_random_uuid\(\)),/g) || []).length === 2 && /v_res2 ->> 'issue' <> 'deja' or v_res2 ->> 'conversation_id' <> v_res ->> 'conversation_id' or v_lignes <> 1/.test(postDv),
    'dévoilement : la RPC est EXÉCUTÉE deux fois — le rejeu est « deja », même conversation, sans seconde ligne (sonde annulée)')
  ok(/c\.status = 'unlocked' and c\.unlocked_at is not null/.test(postDv) && /v\.status = 'open'/.test(postDv) && /\(g\.detail ->> 'auto'\)::boolean = false/.test(postDv) && /raise exception 'SONDE_ANNULEE'/.test(postDv),
    'dévoilement : la bascule, la conversation et la ligne (auto) sont RELUES, puis annulées')
  // L'annonce publiée : brouillon réel publié et relu, rejeu null, pending_review sans ligne.
  const PUBLIEE = stripSql(read(migration('journal_annonce_publiee')))
  const iPostPb = PUBLIEE.indexOf('do $post$')
  const postPb = iPostPb < 0 ? '' : PUBLIEE.slice(iPostPb)
  ok(/to_regprocedure\('public\.publier_annonce\(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text\[\], text, numeric, text, jsonb\)'\) is null/.test(postPb), 'publiée : la signature est vérifiée par TYPES')
  ok((postPb.match(/public\.publier_annonce\((v_piece|gen_random_uuid\(\)),/g) || []).length === 3 && /v_res2 is not null or v_lignes <> 1/.test(postPb) && /'pending_review', 4\.0[\s\S]{0,400}?v_lignes <> 1/.test(postPb),
    'publiée : la RPC est EXÉCUTÉE trois fois — publiée, rejouée (null, une ligne), pending_review (verdict écrit, aucune ligne) — sonde annulée')
  ok(/g\.detail ->> 'organization_id' = v_pub\.organization_id::text/.test(postPb) && /\(v_res ->> 'published_at'\) is null/.test(postPb) && /raise exception 'SONDE_ANNULEE'/.test(postPb),
    'publiée : la ligne est RELUE (sujet, écosystème, organisation, published_at posé), puis annulée')
  {
    const MODIFIEE = stripSql(read(migration('journal_annonce_modifiee')))
    const P = MODIFIEE.slice(Math.max(0, MODIFIEE.indexOf('do $post$')))
    ok(/journaliser\(gen_random_uuid\(\), 'annonce_modifiee', 'reussi', 'utilisateur',[\s\S]{0,300}?jsonb_build_object\('champs', jsonb_build_array\('title', 'skills_required'\), 'statut_annonce', 'draft', 'organization_id', gen_random_uuid\(\)\)[\s\S]{0,400}?raise exception 'SONDE_ANNULEE'/.test(P),
      'modifiée : la forme exacte que la route envoie (noms de champs) est ÉCRITE, puis annulée')
    ok(/"champs":\["title"\],"title":"texte libre"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'modifiée : le CONTENU d’un champ est REFUSÉ (sonde exécutée)')
  }
  {
    const DEPUB = stripSql(read(migration('journal_annonce_depubliee')))
    const P = DEPUB.slice(Math.max(0, DEPUB.indexOf('do $post$')))
    ok(/to_regprocedure\('public\.cloturer_annonce\(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text\[\]\)'\) is null/.test(P), 'dépubliée : la signature est vérifiée par TYPES')
    ok((P.match(/public\.cloturer_annonce\((v_piece|gen_random_uuid\(\)),/g) || []).length === 2 && /v_ok2 is distinct from false or v_lignes <> 1/.test(P),
      'dépubliée : la RPC est EXÉCUTÉE deux fois sur la même annonce — le rejeu rend false et n’écrit pas (sonde annulée)')
    ok(/p\.status = 'archived'/.test(P) && /g\.detail ->> 'de' = 'published'/.test(P) && /raise exception 'SONDE_ANNULEE'/.test(P),
      'dépubliée : la transition et la ligne sont RELUES, puis annulées')
  }
  {
    const EXPIREE = stripSql(read(migration('journal_annonce_expiree')))
    const P = EXPIREE.slice(Math.max(0, EXPIREE.indexOf('do $post$')))
    ok(/to_regprocedure\('public\.constater_annonces_expirees\(uuid, integer, integer\)'\) is null/.test(P), 'expirée : la signature est vérifiée par TYPES')
    ok(/information_schema\.columns[\s\S]{0,200}?column_name = 'expiration_constatee_at'/.test(P) && /relname = 'publications_expiration_a_constater_idx' and i\.indpred is not null/.test(P),
      'expirée : la colonne-marqueur et l’index PARTIEL de la file sont INTERROGÉS (pg_index, pas un IF NOT EXISTS — §E.60)')
    ok(/public\.constater_annonces_expirees\(v_piece, v_vie, 1\)/.test(P) && /expiration_constatee_at is not null/.test(P) && /\(g\.detail ->> 'vie_annonce_jours'\)::integer = v_vie/.test(P) && /raise exception 'SONDE_ANNULEE'/.test(P),
      'expirée : un constat sur une annonce expirée réelle, marqueur et ligne RELUS (durée en vigueur), puis annulé — sautée et dite sur base vierge')
    ok(/cron\.schedule\(\s*'constats_trigger',/.test(EXPIREE) && /trigger_purge_cron\('constats_trigger', '\/api\/cron\/constats'\)/.test(EXPIREE) && /'constats_trigger',\s*'jobs\.constats\.label', 'jobs\.constats\.description',\s*'technical', true,/.test(EXPIREE) && /from cron\.job where jobname = 'constats_trigger'/.test(P) && /cron_job_catalog where job_name = 'constats_trigger'/.test(P),
      'expirée : la tâche est PLANIFIÉE (pg_cron → route), CATALOGUÉE (technique, verdict écrit par la tâche), et la postcondition le vérifie')
    const manquantes = []
    for (const l of ['fr', 'en', 'es', 'de']) {
      const j = JSON.parse(read(`messages/${l}.json`)).admin_back_office?.cron?.jobs?.constats
      if (!j?.label || !j?.description) manquantes.push(l)
    }
    ok(manquantes.length === 0, 'expirée : la tâche a son libellé et sa description dans les QUATRE langues', manquantes.join(', ') || undefined)
    ok(/'\{"vie_annonce_jours":30,"title":"texte libre"\}'[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'expirée : un texte libre est REFUSÉ (sonde exécutée)')
  }
  {
    const CV = stripSql(read(migration('journal_cv_televerse')))
    const P = CV.slice(Math.max(0, CV.indexOf('do $post$')))
    ok(/journaliser\(gen_random_uuid\(\), 'cv_televerse', 'reussi', 'utilisateur',[\s\S]{0,300}?jsonb_build_object\('octets', \d+, 'analyse', 'done', 'premier_consentement', true, 'experiences', \d+, 'formations', \d+, 'langues', \d+\)[\s\S]{0,800}?journaliser\(gen_random_uuid\(\), 'cv_televerse', 'echoue', 'utilisateur',[\s\S]{0,300}?jsonb_build_object\('octets', \d+, 'analyse', 'failed', 'premier_consentement', false\)[\s\S]{0,600}?raise exception 'SONDE_ANNULEE'/.test(P),
      'CV : les deux formes que le module écrit (analyse faite, en échec) sont ÉCRITES, puis annulées')
    ok(/"cv_hash"|"hash"/.test(P) && /when sqlstate 'GL004'/.test(P), 'CV : l’empreinte du fichier est REFUSÉE par la liste blanche (sonde exécutée)')
  }
  {
    const PUBLIE = stripSql(read(migration('journal_profil_publie')))
    const P = PUBLIE.slice(Math.max(0, PUBLIE.indexOf('do $post$')))
    ok(/journaliser\(gen_random_uuid\(\), 'profil_publie', 'reussi', 'utilisateur',[\s\S]{0,300}?jsonb_build_object\('deja_visible', false, 'verification_avant', null\)[\s\S]{0,700}?jsonb_build_object\('deja_visible', true, 'verification_avant', 'approved'\)[\s\S]{0,600}?raise exception 'SONDE_ANNULEE'/.test(P),
      'profil publié : la première publication (sans vérification d’avant) et la republication sont ÉCRITES, puis annulées')
    ok(/"title":"texte libre"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'profil publié : un champ du profil est REFUSÉ (sonde exécutée)')
  }
  {
    const MODIF = stripSql(read(migration('journal_profil_modifie')))
    const P = MODIF.slice(Math.max(0, MODIF.indexOf('do $post$')))
    ok(/journaliser\(gen_random_uuid\(\), 'profil_modifie', 'reussi', 'utilisateur',[\s\S]{0,300}?jsonb_build_object\('champs', jsonb_build_array\('title', 'skills'\), 'blocs', jsonb_build_array\('experiences'\)\)[\s\S]{0,500}?raise exception 'SONDE_ANNULEE'/.test(P),
      'profil modifié : la forme exacte que le module écrit (noms de champs, noms de blocs) est ÉCRITE, puis annulée')
    ok(/"summary":"texte libre"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'profil modifié : le CONTENU d’un champ est REFUSÉ (sonde exécutée)')
  }
  {
    const DISPO = stripSql(read(migration('journal_disponibilite_basculee')))
    const P = DISPO.slice(Math.max(0, DISPO.indexOf('do $post$')))
    ok(/jsonb_build_object\('champ', 'availability_status', 'de', 'available', 'vers', 'unavailable'\)[\s\S]{0,700}?jsonb_build_object\('champ', 'cdi_status', 'de', null, 'vers', 'searching'\)[\s\S]{0,500}?raise exception 'SONDE_ANNULEE'/.test(P),
      'disponibilité : les deux voies (freelance, CDI) sont ÉCRITES sous leur champ, puis annulées')
    ok(/"availability_date"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'disponibilité : une date est REFUSÉE (sonde exécutée)')
  }
  {
    const FERME = stripSql(read(migration('journal_devoilement_ferme')))
    const P = FERME.slice(Math.max(0, FERME.indexOf('do $post$')))
    ok(/to_regprocedure\('public\.constater_devoilement_ferme\(uuid, uuid, timestamptz\)'\) is null/.test(P), 'dévoilement fermé : la signature est vérifiée par TYPES')
    ok(/column_name = 'fermeture_constatee_at'/.test(P) && /relname = 'candidatures_fermeture_a_constater_idx' and i\.indpred is not null/.test(P), 'dévoilement fermé : la colonne-marqueur et l’index PARTIEL sont INTERROGÉS (§E.60)')
    ok((P.match(/public\.constater_devoilement_ferme\((v_piece|gen_random_uuid\(\)), v_cand,/g) || []).length === 2 && /v_ok2 is distinct from false or v_n <> 1/.test(P) && /raise exception 'SONDE_ANNULEE'/.test(P),
      'dévoilement fermé : constat sur une candidature dévoilée réelle, relu, rejeu false sans seconde ligne, puis annulé (sauté et dit sur base vierge)')
    ok(/now\(\) \+ interval '1 day'\);[\s\S]{0,200}?when sqlstate '22023'/.test(P), 'dévoilement fermé : une fin d’échange FUTURE est refusée (sonde exécutée)')
    ok(/"message":"texte libre"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'dévoilement fermé : un texte libre est REFUSÉ (sonde exécutée)')
  }
  {
    const SUSP = stripSql(read(migration('journal_compte_suspendu')))
    const P = SUSP.slice(Math.max(0, SUSP.indexOf('do $post$')))
    ok(/to_regprocedure\('public\.changer_statut_compte\(uuid, uuid, text, uuid, text, uuid, text\[\], text, boolean\)'\) is null/.test(P), 'suspension : la signature est vérifiée par TYPES')
    ok((P.match(/public\.changer_statut_compte\((v_piece|gen_random_uuid\(\)),/g) || []).length === 3 && /v_res2 is not null or v_lignes <> 1/.test(P),
      'suspension : la RPC est EXÉCUTÉE trois fois — suspendue, rejouée (null, une ligne), réactivée par la MÊME fonction (sonde annulée)')
    ok(/g\.type_action = 'compte_reactive'[\s\S]{0,200}?g\.detail ->> 'de' = 'suspended' and g\.detail ->> 'vers' = 'active'/.test(P) && /raise exception 'SONDE_ANNULEE'/.test(P),
      'suspension : les DEUX lignes (suspendue, réactivée) sont RELUES, puis annulées')
    ok(/"email":"qui@exemple\.fr"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'suspension : une adresse est REFUSÉE (sonde exécutée)')
  }
  // Le moteur : une migration par étape, chacune sonde la forme exacte que le module écrit, dans les DEUX sens.
  const sondeRecherche = (suffixe, code, statut, forme, statutRefuse) => {
    const M = stripSql(read(migration(suffixe)))
    const iP = M.indexOf('do $post$')
    const P = iP < 0 ? '' : M.slice(iP)
    // La pièce de la sonde est neuve (gen_random_uuid()) ou celle d'une ligne sœur du même run (v_piece) ;
    // le sujet, neuf ou partagé avec cette ligne sœur (v_sujet).
    const m = (sujet) => new RegExp(`journaliser\\((gen_random_uuid\\(\\)|v_piece), '${code}', '${statut}', 'tache_planifiee',[\\s\\S]{0,200}?'${sujet}', (gen_random_uuid\\(\\)|v_sujet),\\s*${forme}[\\s\\S]{0,2000}?raise exception 'SONDE_ANNULEE'`)
    ok(m('publications').test(P) && m('profiles').test(P), `${code} : la forme exacte que le module écrit est ÉCRITE pour les DEUX sujets (annonce, profil), puis annulée`)
    ok(/"message":"texte libre"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), `${code} : un texte libre est REFUSÉ (sonde exécutée)`)
    // Un statut n'est imposé qu'à certaines étapes (terminee, echouee, abandonnee, lancee) ; les autres n'ont rien à refuser.
    if (statutRefuse) ok(new RegExp(`'${code}', '${statutRefuse}'[\\s\\S]{0,600}?when sqlstate 'GL003'`).test(P), `${code} : le statut « ${statutRefuse} » est REFUSÉ par la base (sonde exécutée)`)
  }
  sondeRecherche('journal_recherche_lancee', 'recherche_lancee', 'reussi', "jsonb_build_object\\('tentative', 1, 'tache', '(match_retry|expert_relance)'\\)", 'refuse')
  sondeRecherche('journal_recherche_filtree', 'recherche_filtree', 'reussi', "jsonb_build_object\\('eligibles', \\d+, 'sans_matiere', \\d+, 'a_noter', \\d+, ('ecartes_deja_decline', \\d+, 'ecartes_deja_postule', \\d+|'chargees', \\d+)\\)", null)
  sondeRecherche('journal_recherche_classee', 'recherche_classee', '(reussi|echoue)', "jsonb_build_object\\('model', '[^']+', 'notes', \\d+, 'reprises', \\d+, 'lots_en_echec', \\d+, 'arret', (null|'[a-z_]+'), 'recherches', \\d+, 'unites_source', '(fournisseur|plancher)'\\)", null)
  sondeRecherche('journal_recherche_correspondances', 'recherche_correspondances', 'reussi', "jsonb_build_object\\('retenues', \\d+, 'fortes', \\d+, 'inserees', \\d+, 'mises_a_jour', \\d+, 'supprimees', \\d+, 'filtre_flux', [\\d.]+, 'palier_fort', [\\d.]+\\)", null)
  sondeRecherche('journal_recherche_notifiee', 'recherche_notifiee', '(reussi|echoue)', "jsonb_build_object\\('demandees', \\d+, 'deja_notifiees', \\d+, 'posees', \\d+, 'paquets_en_echec', \\d+, 'renonce', (true|false)\\)", null)
  sondeRecherche('journal_recherche_terminee', 'recherche_terminee', 'reussi', "jsonb_build_object\\('issue', '(ok|vivier_vide|annonce_expiree|ineligible|sans_matiere)', 'raison', (null|'[a-z_]+')\\)", 'echoue')
  sondeRecherche('journal_recherche_echouee', 'recherche_echouee', 'echoue', "jsonb_build_object\\('etape', '[a-z_]+', 'cause', '[a-z_]+', 'tentative', (null|\\d+), 'arret', (null|'[a-z_]+'), 'lots_en_echec', (null|\\d+)\\)", 'reussi')
  sondeRecherche('journal_recherche_abandonnee', 'recherche_abandonnee', 'echoue', "jsonb_build_object\\('tentatives', \\d+, 'plafond', \\d+, 'cause', '[a-z_]+'\\)", 'reussi')
  {
    const ABANDON = stripSql(read(migration('journal_recherche_abandonnee')))
    const P = ABANDON.slice(Math.max(0, ABANDON.indexOf('do $post$')))
    ok(/journaliser\(v_piece, 'recherche_echouee', 'echoue'[\s\S]*?journaliser\(v_piece, 'recherche_abandonnee', 'echoue'[\s\S]*?where g\.piece = v_piece\) <> 2/.test(P),
      'abandonnée : l’échec et l’abandon d’un même run sont ÉCRITS sous une pièce et RELUS (deux lignes, un sujet — sonde exécutée)')
  }
  {
    const CLASSEE = stripSql(read(migration('journal_recherche_classee')))
    const P = CLASSEE.slice(Math.max(0, CLASSEE.indexOf('do $post$')))
    ok(/'recherches', 1, 'unites_source', 'fournisseur'\),\s*null::uuid, 0\.0123::numeric, 'recherches'\)/.test(P) && /g\.cout_usd = 0\.0123 and g\.unite_facturee = 'recherches'/.test(P),
      'classée : le coût et son unité sont ÉCRITS dans les colonnes de coût, et RELUS (sonde exécutée)')
    ok(/'unites_source', 'plancher'\),\s*null::uuid, null::numeric, null::text\)/.test(P) && /g\.cout_usd is null and g\.unite_facturee is null/.test(P),
      'classée : un coût INCONNU s’écrit sans coût ni unité (jamais 0), et c’est relu (sonde exécutée)')
    ok(/'recherches', 1, 'unites_source', 'fournisseur'\),\s*null::uuid, 0\.0123::numeric, null::text\)[\s\S]{0,400}?when sqlstate '23514'/.test(P),
      'classée : un coût SANS unité est refusé par la contrainte (sonde exécutée)')
  }
}

// ═══ G. AUCUNE DONNÉE PERSONNELLE — détecteur partagé ═══════════════════════
section('G. Un détail passé au grand livre ne porte ni clé ni valeur personnelle')
{
  const CLES = chargerClesPersonnelles(stripSql(read(migration('audit_sans_donnee_personnelle'))))
  ok(CLES.length >= 10, `la liste des clés personnelles est lue en base (${CLES.length} clés) — la même que pour audit_logs`)
  const detecteurDetail = fabriquerDetecteur(CLES, 'detail')
  const detecteurRpc = fabriquerDetecteur(CLES, 'p_detail')
  // LES ARGUMENTS QUI PORTENT UN DÉTAIL sont DÉCOUVERTS : pour chaque écrivain
  // SQL (journaliser() et tout ce qui l'appelle), ses paramètres `jsonb`. Une
  // RPC métier ajoutée demain est couverte sans qu'on l'inscrive (§E.61).
  const RPC_DU_JOURNAL = new Map(
    [...ECRIVAINS_SQL].map((fn) => {
      const args = fn === 'journaliser' ? null : argumentsVersLeJournal(fn)
      return [fn, DEFINITIONS_COURANTES.get(fn).params
        .filter((p) => p.type === 'jsonb' && (args === null || new RegExp(`\\b${p.nom}\\b`).test(args)))
        .map((p) => p.nom)]
    }),
  )
  const detecteurs = new Map()
  const detecteurDe = (champ) => {
    if (!detecteurs.has(champ)) detecteurs.set(champ, fabriquerDetecteur(CLES, champ))
    return detecteurs.get(champ)
  }
  ok(ECRIVAINS_SQL.size >= 9 && [...RPC_DU_JOURNAL.values()].some((c) => c.includes('p_avant')),
    `${ECRIVAINS_SQL.size} écrivains SQL découverts par point fixe, et leurs arguments jsonb : ${[...RPC_DU_JOURNAL].map(([fn, c]) => `${fn}(${c.join(', ')})`).join(' · ')}`)
  const defauts = []
  let appels = 0
  const FICHIERS_PORTES = new Set(PORTES.values())
  for (const f of [...fichiers('app'), ...fichiers('lib'), ...fichiers('components')]) {
    if (FICHIERS_PORTES.has(f)) continue
    const src = stripTs(read(f))
    for (const nom of ['journaliser(', 'journaliserDans(']) {
      for (const bloc of appelsDe(src, nom)) {
        appels++
        const d = detecteurDetail(bloc, src)
        if (d) defauts.push(`${f} · ${nom.slice(0, -1)} — ${d}`)
      }
    }
    for (const [fn, champs] of RPC_DU_JOURNAL) {
      for (const bloc of appelsDe(src, `.rpc('${fn}'`)) {
        appels++
        for (const champ of champs) {
          const d = detecteurDe(champ)(bloc, src)
          if (d) defauts.push(`${f} · .rpc('${fn}').${champ} — ${d}`)
        }
      }
    }
    for (const bloc of appelsDe(src, 'journaliserReglage(')) {
      appels++
      for (const champ of ['avant', 'apres', 'complement']) {
        const d = detecteurDe(champ)(bloc, src)
        if (d) defauts.push(`${f} · journaliserReglage().${champ} — ${d}`)
      }
    }
  }
  ok(appels >= 1, `${appels} appel(s) vers le grand livre lus`)
  ok(detecteurDe('avant')('journaliserReglage(admin, journal, { sujet, avant, apres })', 'const avant = { email: u.email }')?.startsWith('clé personnelle'),
    'témoin : un RACCOURCI `avant` est jugé sur son `const avant = {…}` du fichier')
  ok(detecteurDe('avant')('journaliserReglage(admin, journal, { sujet, avant, apres })', '')?.includes('OPAQUE'),
    'témoin : un raccourci sans `const` littéral dans le fichier est opaque, donc refusé')
  ok(defauts.length === 0, 'aucun détail ne porte de clé ni de valeur personnelle, et aucun n’est opaque', defauts.join('\n         ') || undefined)
  // témoins
  ok(detecteurRpc(".rpc('regler_durees_place', { p_piece: piece, p_detail: { avant: { email: u.email } } })")?.startsWith('clé personnelle'),
    'témoin : une clé personnelle imbriquée dans p_detail est vue')
  ok(detecteurRpc(".rpc('regler_durees_place', { p_detail: detailReglage })", 'const detailReglage = { avant: { phone: u.phone } }')?.startsWith('clé personnelle'),
    'témoin : un détail passé par une variable est jugé sur son littéral `const`')
  ok(detecteurRpc(".rpc('regler_durees_place', { p_detail: inconnu })", '')?.includes('OPAQUE'),
    'témoin : une variable sans littéral dans le fichier est opaque, donc refusée')
}

console.log()
if (failures) {
  console.log(`✘ ${failures} CONTRÔLE(S) EN ÉCHEC — le socle du grand livre ne tient pas`)
  process.exit(1)
}
console.log('✅ le socle tient : liste fermée unique, ajout seul prouvé, fonction unique, pièce explicite, deux actions réelles')
