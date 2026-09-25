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
  for (const [nom, def] of DEFINITIONS_COURANTES) {
    if (nom === 'journaliser') continue
    for (const c of def.corps.matchAll(/journaliser\(\s*[^,()]+,\s*'([a-z0-9_]+)'/g)) noter(c[1], `sql:${nom}()`)
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
    return blocApres(src.slice(fermante), '{')
  }
  const tient = (motif, texte) => (typeof motif === 'function' ? motif(texte) : motif.test(texte))
  for (const p of PREUVES) {
    const src = stripTs(read(p.fichier))
    const bloc = (p.bloc.endsWith('(') ? corpsFonctionTs(src, p.bloc) : blocApres(src, p.bloc)) ?? ''
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
