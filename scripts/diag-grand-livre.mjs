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
  // LA LISTE S'ÉTEND PAR MIGRATION : le seed du socle, PUIS chaque migration ultérieure qui
  // insère dans grand_livre_actions (même forme d'insertion) — lues TOUTES, jamais une liste
  // de fichiers tenue à la main (§E.61).
  const lignes = []
  for (const f of TOUTES_MIGRATIONS) {
    const src = SQL_PAR_MIGRATION.get(f)
    for (let from = 0; ; ) {
      const iSeed = src.indexOf('insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values', from)
      if (iSeed < 0) break
      const fin = src.indexOf('on conflict (code)', iSeed)
      const seed = src.slice(iSeed, fin < 0 ? undefined : fin)
      from = iSeed + 10
      for (const m of seed.matchAll(/\(\s*'([a-z0-9_]+)',\s*'([a-z]+)',\s*(null|'[a-z]+'),\s*'([a-z0-9_.]+)'\s*\)/g)) {
        lignes.push({ code: m[1], famille: m[2], impose: m[3] === 'null' ? null : m[3].slice(1, -1), cle: m[4], f })
      }
    }
  }
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
  ok(refus.length >= 5 && refus.every((l) => l.impose === 'refuse' && l.famille === 'refus'),
    `chaque « refus_… » est de famille refus et IMPOSE le statut refuse (${refus.length} refus nommés)`)
  const doublons = lignes.map((l) => l.code).filter((c, i, t) => t.indexOf(c) !== i)
  ok(doublons.length === 0, 'aucune action n’est insérée deux fois dans la liste fermée, toutes migrations confondues', doublons.join(', ') || undefined)
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
  // TOUT EST PARAMÉTRABLE (décision de Youssef, 28/09/2026) : la conservation et le plancher légal se SAISISSENT
  // dans l'administration — aucune migration n'en pose la valeur. Seule regler_conservation_journal() les écrit.
  {
    const posees = []
    for (const [f, src] of SQL_PAR_MIGRATION) {
      const sql = src.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
      // L'instruction UPDATE seule (jusqu'au « ; »), chaque affectation jugée : une valeur venue d'un
      // paramètre (p_…) est une SAISIE relayée ; toute autre est une valeur posée par la migration.
      for (const m of sql.matchAll(/update\s+public\.grand_livre_conservation\b[^;]*?\bset\b([^;]*)/gi)) {
        for (const a of m[1].matchAll(/\b(conservation_mois|plancher_mois)\s*=\s*([^,\s]+)/gi)) {
          if (!/^p_/i.test(a[2])) posees.push(f)
        }
      }
      if (/insert\s+into\s+public\.grand_livre_conservation\s*\([^)]*\b(conservation_mois|plancher_mois)\b/i.test(sql)) posees.push(f)
      if (/\b(conservation_mois|plancher_mois)\s+integer\s+default\b/i.test(sql)) posees.push(f)
    }
    ok(posees.length === 0,
      'aucune migration ne pose une valeur de conservation ou de plancher (elles se saisissent dans l’administration)',
      posees.join(', ') || undefined)
  }
  // LE SEUL CHEMIN, POSÉ PAR UNE SEULE FONCTION (phase B 2.7) : parmi les DERNIÈRES définitions, une seule pose
  // le réglage de nettoyage — nettoyer_journal() — et le RETIRE après ses suppressions.
  {
    const poseurs = [...DEFINITIONS_COURANTES].filter(([, d]) => /set_config\('grand_livre\.nettoyage', 'autorise', true\)/.test(d.corps)).map(([n]) => n)
    const nettoyeur = DEFINITIONS_COURANTES.get('nettoyer_journal')?.corps ?? ''
    ok(poseurs.length === 1 && poseurs[0] === 'nettoyer_journal'
         && /set_config\('grand_livre\.nettoyage', 'autorise', true\);[\s\S]*?delete from public\.grand_livre[\s\S]*?set_config\('grand_livre\.nettoyage', '', true\);[\s\S]*?exiger_ecriture\(v_effacees, 'nettoyer_journal : grand_livre', p_total_annonce\);[\s\S]*?'journal_nettoye'/.test(nettoyeur),
      'le réglage de nettoyage est posé par UNE fonction (nettoyer_journal), retiré après les suppressions, le compte exigé égal à l’annonce, puis sa ligne',
      `poseurs : ${poseurs.join(', ') || 'aucun'}`)
  }
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
  // Le type peut être générique (`EcritureJournal<A …> = {`, point 2.5) : on ancre sur la
  // DÉCLARATION, pas sur une écriture exacte de son en-tête (§E.34).
  const iNom = porte.indexOf('export type EcritureJournal')
  const iType = iNom < 0 ? -1 : porte.indexOf('= {', iNom)
  const typeEcriture = iType < 0 ? '' : (blocApres(porte.slice(iType), '{') ?? '')
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

// ═══ C bis. LES CLÉS DE CHAQUE APPELANT, CONTRE LA LISTE BLANCHE (point 2.5) ═══
//  Périmètre : la DERNIÈRE définition de chaque fonction SQL qui appelle journaliser() ;
//  le détail (10ᵉ argument) est suivi à travers les littéraux (jsonb_build_object,
//  jsonb_build_array, '{…}'::jsonb), les variables locales (`v := …`), `||`, `- 'clé'`,
//  `-> 'clé'`, coalesce — et, quand il vient d'un PARAMÈTRE jsonb, jusqu'aux APPELANTS de
//  la fonction (point fixe), puis jusqu'aux routes TypeScript qui l'appellent par `.rpc()`,
//  où le paramètre doit être construit `satisfies SousDetail|DetailDe<'code'>` (tsc le tient,
//  lib/journal/detail.ts). Rouge : toute clé hors liste blanche ; tout détail non suivi.
//  Pourquoi : journaliser() refuse une clé hors liste DANS la transaction du geste — une clé
//  oubliée ferait échouer le geste lui-même, en production.
section('C bis. Les clés de chaque appelant, contre la liste blanche de son action')
{
  const blanche = listesBlanchesSql()
  const coupeHaut = (s, sep) => {
    const out = []
    let cur = ''
    let prof = 0
    let chaine = false
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      if (chaine) { cur += c; if (c === "'") chaine = false; continue }
      if (c === "'") { chaine = true; cur += c; continue }
      if (c === '(') prof++
      else if (c === ')') prof--
      if (prof === 0 && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue }
      cur += c
    }
    out.push(cur)
    return out.map((x) => x.trim())
  }
  const deparentheser = (e) => {
    e = e.trim()
    while (e.startsWith('(') && blocApres(e, '(', '(', ')') === e) e = e.slice(1, -1).trim()
    return e
  }
  /** Les clés d'une expression jsonb ; `ctx` : { params: Set, vars: Map, relais: [], dyn: [] }. */
  function clesExpr(expr, pre, ctx, out) {
    const e = deparentheser(expr)
    const parts = coupeHaut(e, '||')
    if (parts.length > 1) { for (const p of parts) clesExpr(p, pre, ctx, out); return }
    const moins = /^([\s\S]+?)\s-\s'([^']+)'$/.exec(e)
    if (moins && coupeHaut(e, ' - ').length > 1) {
      const tmp = new Set()
      clesExpr(moins[1], pre, ctx, tmp)
      const k = pre ? `${pre}.${moins[2]}` : moins[2]
      for (const x of tmp) if (x !== k && !x.startsWith(`${k}.`) && !x.startsWith(`${k}[]`)) out.add(x)
      return
    }
    const fleche = /^(\w+)\s*->\s*'([^']+)'$/.exec(e)
    if (fleche && ctx.params.has(fleche[1])) { ctx.relais.push({ param: fleche[1], pre: '' }); return }
    if (/^jsonb_build_object\s*\(/i.test(e)) {
      const a = decouperArguments(blocApres(e, 'jsonb_build_object', '(', ')') ?? '()')
      for (let i = 0; i + 1 < a.length; i += 2) {
        const k = /^'([^']+)'$/.exec(a[i])
        if (!k) { ctx.dyn.push(`clé non littérale ${a[i]}`); continue }
        const p = pre ? `${pre}.${k[1]}` : k[1]
        out.add(p)
        clesExpr(a[i + 1], p, ctx, out)
      }
      return
    }
    if (/^jsonb_build_array\s*\(/i.test(e)) {
      out.add(`${pre}[]`)
      for (const x of decouperArguments(blocApres(e, 'jsonb_build_array', '(', ')') ?? '()')) clesExpr(x, `${pre}[]`, ctx, out)
      return
    }
    const lit = /^'([\s\S]*)'::jsonb$/.exec(e)
    if (lit) {
      const v = JSON.parse(lit[1])
      ;(function w(o, p) {
        if (Array.isArray(o)) { out.add(`${p}[]`); for (const x of o) if (x && typeof x === 'object') w(x, `${p}[]`); return }
        if (o && typeof o === 'object') for (const k of Object.keys(o)) { const q = p ? `${p}.${k}` : k; out.add(q); if (o[k] && typeof o[k] === 'object') w(o[k], q) }
      })(v, pre)
      return
    }
    const co = /^coalesce\s*\(/i.exec(e)
    if (co) { for (const x of decouperArguments(blocApres(e, 'coalesce', '(', ')') ?? '()')) clesExpr(x, pre, ctx, out); return }
    if (/^\w+$/.test(e)) {
      if (ctx.params.has(e)) { ctx.relais.push({ param: e, pre }); return }
      if (ctx.vars.has(e) && !ctx.vus.has(e)) { ctx.vus.add(e); clesExpr(ctx.vars.get(e), pre, ctx, out); return }
    }
    // Une FEUILLE (valeur scalaire, to_jsonb(…), une colonne) sous une clé déjà comptée.
    if (pre) return
    ctx.dyn.push(e.slice(0, 60))
  }
  const ctxDe = (nom) => {
    const def = DEFINITIONS_COURANTES.get(nom)
    const vars = new Map()
    for (const m of def.corps.matchAll(/\b(v_\w+)\s*:=\s*([\s\S]*?);/g)) if (!vars.has(m[1])) vars.set(m[1], m[2])
    return { params: new Set(def.params.filter((p) => p.type === 'jsonb').map((p) => p.nom)), vars, relais: [], dyn: [], vus: new Set() }
  }
  const ecarts = []
  const nonSuivis = []
  let sites = 0
  const comparer = (ou, codes, cles) => {
    sites++
    for (const c of codes) {
      const b = new Set(blanche.get(c) ?? [])
      const hors = [...cles].filter((k) => !b.has(k))
      if (hors.length) ecarts.push(`${c} ← ${ou} : ${hors.join(', ')}`)
    }
  }
  // File de relais : { fn, param, pre, codes } — un paramètre jsonb dont la valeur devient un détail.
  const file = []
  for (const [nom, def] of DEFINITIONS_COURANTES) {
    if (nom === 'journaliser') continue
    for (let from = 0; ; ) {
      const i = def.corps.indexOf('journaliser(', from)
      if (i < 0) break
      from = i + 'journaliser('.length
      if (/\w/.test(def.corps[i - 1] ?? ' ')) continue
      const a = decouperArguments(blocApres(def.corps.slice(i), 'journaliser(', '(', ')') ?? '()')
      const codes = [...(a[1] ?? '').matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).filter((c) => codesSqlGlobal.has(c))
      if (!codes.length) continue
      const ctx = ctxDe(nom)
      const out = new Set()
      clesExpr(a[9] ?? '', '', ctx, out)
      comparer(`sql:${nom}()`, codes, out)
      for (const d of ctx.dyn) nonSuivis.push(`sql:${nom}() : ${d}`)
      for (const r of ctx.relais) file.push({ fn: nom, ...r, codes })
    }
  }
  // Les relais, jusqu'à leurs appelants — SQL (point fixe), puis TypeScript.
  const tsFichiers = [...fichiers('app'), ...fichiers('lib')].map((f) => [f, stripTs(read(f))])
  const vusRelais = new Set()
  let relaisTs = 0
  while (file.length) {
    const r = file.shift()
    const cle = `${r.fn}/${r.param}/${r.pre}`
    if (vusRelais.has(cle)) continue
    vusRelais.add(cle)
    const idx = DEFINITIONS_COURANTES.get(r.fn).params.findIndex((p) => p.nom === r.param)
    let appelants = 0
    for (const [g] of DEFINITIONS_COURANTES) {
      if (g === r.fn) continue
      const corps = DEFINITIONS_COURANTES.get(g).corps
      for (let from = 0; ; ) {
        const i = corps.indexOf(`${r.fn}(`, from)
        if (i < 0) break
        from = i + r.fn.length + 1
        if (/\w/.test(corps[i - 1] ?? ' ')) continue
        const a = decouperArguments(blocApres(corps.slice(i), `${r.fn}(`, '(', ')') ?? '()')
        if (a[idx] === undefined) continue
        appelants++
        const ctx = ctxDe(g)
        const out = new Set()
        clesExpr(a[idx], r.pre, ctx, out)
        comparer(`sql:${g}() → ${r.fn}(${r.param})`, r.codes, out)
        for (const d of ctx.dyn) nonSuivis.push(`sql:${g}() → ${r.fn}(${r.param}) : ${d}`)
        for (const x of ctx.relais) file.push({ fn: g, ...x, codes: r.codes })
      }
    }
    // TypeScript : `.rpc('fn', { p_param: ident })` — ident construit `satisfies …<'code'>`.
    // Les PORTES (enveloppes typées par leur signature) ne sont pas des appelants .rpc à juger.
    for (const [f, src] of tsFichiers) {
      if ([...PORTES.values()].includes(f)) continue
      for (const bloc of appelsDe(src, `.rpc('${r.fn}',`)) {
        appelants++
        relaisTs++
        const m = new RegExp(`\\b${r.param}:\\s*([\\w.]+)`).exec(bloc)
        if (!m) { nonSuivis.push(`ts:${f} → ${r.fn}(${r.param}) : paramètre absent ou non identifiable`); continue }
        const ident = m[1].split('.')[0]
        // La DÉCLARATION elle-même : son littéral `{…}`, puis ce qui suit IMMÉDIATEMENT sa
        // fermeture. (Une recherche paresseuse glissait jusqu'au `satisfies` de la déclaration
        // suivante — trouvé par mutation, 26/09/2026.)
        const iDecl = src.search(new RegExp(`(?:const|let)\\s+${ident}\\s*=\\s*\\{`))
        const litDecl = iDecl < 0 ? null : blocApres(src.slice(iDecl), '{')
        const apresLit = litDecl ? src.slice(src.indexOf(litDecl, iDecl) + litDecl.length) : ''
        const decl = /^\s*satisfies\s+(SousDetail|DetailDe)<'([a-z0-9_]+)'/.exec(apresLit)
        if (!decl || !r.codes.includes(decl[2])) nonSuivis.push(`ts:${f} → ${r.fn}(${r.param}) : « ${ident} » n'est pas construit satisfies SousDetail|DetailDe<'${r.codes.join("'|'")}'>`)
      }
    }
    if (!appelants && ![...PORTES.keys()].includes(r.fn)) nonSuivis.push(`${r.fn}(${r.param}) : relais sans aucun appelant trouvé`)
  }
  ok(ecarts.length === 0,
    `aucune clé écrite hors de la liste blanche de son action (${sites} site(s) SQL comparé(s), relais suivis jusqu'aux littéraux)`,
    ecarts.slice(0, 8).join('\n         ') || undefined)
  ok(nonSuivis.length === 0 && relaisTs >= 6,
    `aucun détail non suivi : chaque paramètre relayé remonte à un littéral SQL ou à un littéral TypeScript typé (${relaisTs} appel(s) .rpc typé(s))`,
    nonSuivis.slice(0, 8).join('\n         ') || undefined)
  // Côté TypeScript direct : les portes portent le type par action (tsc refuse une clé hors liste).
  const porteJ = stripTs(read('lib/journal/journaliser.ts'))
  const porteR = stripTs(read('lib/journal/reglages.ts'))
  ok(/export type EcritureJournal<A extends ActionActive = ActionActive> = \{[\s\S]*?detail\?: DetailDe<A>/.test(porteJ)
    && /export async function journaliserDans<A extends ActionActive>\(/.test(porteJ)
    && /avant: SousDetail<'reglage_modifie', 'avant'>/.test(porteR) && /apres: SousDetail<'reglage_modifie', 'apres'>/.test(porteR),
    'les portes TypeScript typent le détail PAR ACTION (DetailDe<A>) — tsc refuse une clé hors liste, dérivée de CLES_DETAIL')
  ok(/export type FormeDetail<P extends string>/.test(stripTs(read('lib/journal/detail.ts'))) && /\(typeof CLES_DETAIL\)\[A\]\[number\]/.test(stripTs(read('lib/journal/detail.ts'))),
    'la forme du détail est DÉRIVÉE de CLES_DETAIL — une seule liste, que la section A prouve identique à la base')
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
  // LE CRITÈRE DE FIN DE LA PHASE B (2.8), devenu un contrôle le 28/09/2026 : chaque action de la liste
  // fermée a EXACTEMENT un écrivain — « ni deux » ci-dessus, « ni zéro » ici. Une action ajoutée sans
  // écrivain rougit : une action qu'on ne peut pas écrire est une étiquette sans rien dessous.
  //
  // LES ACTIONS RETIRÉES (décision de Youssef, 01/10/2026, ARRÊT 22) : elles restent dans la liste fermée — leurs
  // lignes passées se lisent — mais n'ont PLUS AUCUN écrivain ; journaliser() les refuse (GL006) au déploiement SUIVANT
  // seulement (§E.72, diag-journal-lisible section 3). Leur liste se lit
  // dans `lib/journal/actions.ts` (ACTIONS_RETIREES) ; diag-journal-lisible vérifie qu'elle est la même qu'en SQL.
  const retirees = new Set([...(read('lib/journal/actions.ts').match(/export const ACTIONS_RETIREES = \[([\s\S]*?)\] as const/)?.[1] ?? '')
    .matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]))
  ok(retirees.size > 0, `la liste des actions retirées est lue (${retirees.size})`)
  const restantes = [...codesSqlGlobal].filter((c) => !branchees.includes(c) && !retirees.has(c)).sort()
  ok(restantes.length === 0,
    `ni zéro : chacune des ${codesSqlGlobal.size - retirees.size} actions actives de la liste fermée a son écrivain`,
    restantes.length ? `sans écrivain : ${restantes.join(', ')}` : undefined)
  const fantomes = branchees.filter((c) => retirees.has(c))
  ok(fantomes.length === 0,
    `aucune des ${retirees.size} actions retirées n’a encore d’écrivain`,
    fantomes.length ? fantomes.map((c) => `${c} ← ${[...sites.get(c)].join(' | ')}`).join(' · ') : undefined)
}

// ═══ D ter. LA PREUVE PAR ACTION — le bloc qui écrit, pas la fonction qui existe ═
section('D ter. Chaque action branchée écrit LÀ où le geste a lieu — ancré sur le bloc (§E.8)')
{
  // Une fonction écrivain qui existe ne prouve pas qu'elle est APPELÉE là où
  // il faut : `refus_plafond_atteint` a deux chemins de refus, et l'un des
  // deux pourrait cesser d'appeler l'écrivain sans que D bis ne bouge. Chaque
  // action branchée déclare donc ses PREUVES : un fichier, un bloc, un motif.
  const PREUVES = [
    { code: 'plafond_atteint', fichier: 'lib/ai-budget.ts', bloc: 'export async function budgetDisponible(', motif: (b) => !/journaliserRefusPlafond|journaliserDans/.test(b), quoi: 'le refus par un plafond ne s’écrit plus (ARRÊT 22, action retirée) : le FAIT d’atteindre le plafond garde sa ligne, une fois par acteur et par mois' },
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
    // Relecture du 01/10/2026, point 19 : l'écran renvoie TOUT le formulaire ; une offre réenregistrée à l'identique
    // ne doit écrire aucune ligne. Chaque colonne que la route peut écrire est comparée à sa valeur LUE (une colonne
    // ajoutée sans sa valeur lue serait « changée » à chaque fois), les limites à leur valeur d'avant.
    { code: 'reglage_modifie', fichier: 'app/api/admin/update-package/route.ts', bloc: 'export async function POST(', motif: (b) => {
        const ecrites = [...new Set([...b.matchAll(/packageUpdates\.([a-z_]+) =/g)].map((m) => m[1]))].filter((c) => c !== 'updated_at')
        const lues = b.match(/const valeurLue: Record<string, unknown> = \{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
        return ecrites.length >= 6 && ecrites.every((c) => new RegExp(`\\b${c}: `).test(lues))
          && /const change = \(champ: string\) => champ in packageUpdates && !memeValeur\(valeurLue\[champ\], packageUpdates\[champ\]\)/.test(b)
          && /\.filter\(\(l\) => !memeValeur\(l\.avant, l\.value\)\)/.test(b)
          && /package_fields: Object\.keys\(packageUpdates\)\.filter\(\(k\) => k !== 'updated_at' && change\(k\)\)/.test(b)
          && !/package_fields: Object\.keys\(packageUpdates\),/.test(b.slice(b.indexOf('journaliserReglage('), b.indexOf('logAudit(')))
      }, quoi: 'un réenregistrement à l’identique n’écrit rien : chaque colonne écrite est comparée à sa valeur LUE, les limites à leur valeur d’avant (point 19)' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/assign-org-package/route.ts', bloc: 'export async function POST(', motif: /\.select\('id, package_id, package_started_at, package_valid_until'\)[\s\S]*?organization_not_found[\s\S]*?\.from\('organizations'\)\s*\.update\(\{[\s\S]*?journaliserReglage\(auth\.supabaseAdmin, journal, \{\s*sujet: \{ type: 'organizations', id: organizationId \},/, quoi: 'attribution : l’organisation est LUE (404 sinon), écrite, puis journalisée' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/migrate-org-packages/route.ts', bloc: 'export async function POST(', motif: /\.update\(\{ package_id: toId,[\s\S]*?journaliserReglage\(auth\.supabaseAdmin, journal, \{\s*sujet: \{ type: 'packages', id: toId \},[\s\S]{0,300}?count: migrated,/, quoi: 'migration : UNE ligne après l’écriture, avec le compte — jamais une par organisation' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/synchroniser-catalogue/route.ts', bloc: 'export async function POST(', motif: /catch \(err\) \{[\s\S]*?journaliserReglage\(auth\.supabaseAdmin, journal, \{[\s\S]{0,200}?statut: 'echoue',[\s\S]*?return json\(\{ error: cause, code: 'synchronisation_impossible' \}, 502\)/, quoi: 'catalogue : une synchronisation qui n’a pas pu se faire est journalisée ÉCHOUÉE, avec sa cause' },
    { code: 'reglage_modifie', fichier: 'app/api/admin/synchroniser-catalogue/route.ts', bloc: 'export async function POST(', motif: /statut: rapport\.failed\.length > 0 \? 'echoue' : 'reussi',[\s\S]{0,200}?synchronisees: rapport\.synced\.map\(\(r\) => r\.slug\),\s*refusees: rapport\.refused\.map\(\(r\) => r\.slug\),\s*en_echec: rapport\.failed\.map\(\(r\) => r\.slug\),/, quoi: 'catalogue : slugs seulement, et ÉCHOUÉE dès qu’une offre est en échec' },
    // ── A3 : le paiement reçu ──
    { code: 'paiement_recu', fichier: 'app/api/stripe/webhook/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteSysteme\(\)[\s\S]*?\.rpc\('stripe_event_reclamer'[\s\S]*?handleStripeEvent\(admin, event, journal\)/, quoi: 'le webhook ouvre sa pièce AVANT la réclamation (première écriture) et la transmet au traitement' },
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
    { code: 'candidature_deposee', fichier: 'lib/candidatures/depot.ts', bloc: 'export async function deposerCandidature(', motif: (b) => (b.match(/return refuserInapte\(supabaseAdmin, args\.journal, \{/g) || []).length === 1 && !/issue: 'inapte'/.test(b), quoi: 'la SEULE sortie « inapte » du dépôt passe par son raccourci (une réponse, plus de ligne)' },
    { code: 'candidature_deposee', fichier: 'lib/candidatures/depot.ts', bloc: 'async function refuserInapte(', motif: (b) => !/journaliserDans|journaliser\(/.test(b), quoi: 'le refus « inapte » ne s’écrit plus (ARRÊT 22, action retirée) : la réponse de la route, elle, ne change pas' },
    // ── B4 : les refus de garde du dépôt ──
    { code: 'candidature_deposee', fichier: 'lib/candidatures/depot.ts', bloc: 'export async function deposerCandidature(', motif: (b) => !/issue: 'refusee'/.test(b) && (b.match(/return refuser\(/g) || []).length >= 10, quoi: 'AUCUNE sortie « refusee » littérale dans le dépôt : toutes passent par le raccourci' },
    { code: 'candidature_deposee', fichier: 'lib/candidatures/depot.ts', bloc: 'async function refuserGarde(', motif: (b) => !/journaliserDans|journaliser\(/.test(b), quoi: 'un refus de garde du dépôt ne s’écrit plus (ARRÊT 22, action retirée)' },
    // ── B5 : le quota d'analyses de CV refuse, et le refus s'écrit ──
    // ARRÊT 19 (§D.30) : le dépôt des DEUX voies vit dans lib/profil/depot-cv.ts ; les routes n'en sont que les portes.
    { code: 'cv_televerse', fichier: 'lib/profil/depot-cv.ts', bloc: 'export async function deposerCv(', motif: (b) => /if \(resetAt !== null && resetAt > now && count >= quota\.maxPerWindow\) \{/.test(b) && !/refuserParQuota/.test(b), quoi: 'le dépôt (les deux voies) : le quota refuse par un 429, SANS ligne (ARRÊT 22, action retirée)' },
    ...[['app/api/profile/upload-cv/route.ts', 'expert_freelance'], ['app/api/profile/cdi-upload-cv/route.ts', 'expert_cdi']].map(([fichier, voie]) => ({ code: 'cv_televerse', fichier, bloc: 'export async function POST(', motif: new RegExp(`return deposerCv\\(request, '${voie}'\\)`), quoi: `la porte ${voie} passe par le dépôt partagé — parité (§D.14)` })),
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
    { code: 'recherche_terminee', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async lancee(', motif: (b) => !/journaliserDans/.test(b) && /this\.bilan\.tentative = d\.tentative/.test(b), quoi: 'la tentative est NOTÉE dans le bilan, plus écrite à part (ARRÊT 22 : les étapes fondues en une ligne)' },
    { code: 'recherche_terminee', fichier: 'lib/matching/index.ts', bloc: 'export async function runMatchingForPublication(', motif: /await marquerTentative\(supabaseAdmin, publicationId, pub\.matching_attempts \?\? 0\)\s*const tentative = \(pub\.matching_attempts \?\? 0\) \+ 1\s*await recherche\.lancee\(\{ tentative \}\)/, quoi: 'annonce : lancée APRÈS la tentative comptée, sujet l’annonce, écosystème le sien, tentative = compteur lu + 1' },
    { code: 'recherche_terminee', fichier: 'lib/matching/run-for-expert.ts', bloc: 'async function executerRunExpert(', motif: /const vieAnnonceJours = lectureDurees\.durees\.vieAnnonceJours\s*await recherche\.lancee\(\{ tentative: p\.matching_relance_tentatives \}\)[\s\S]*?\.from\('publications'\)/, quoi: 'expert : lancée après l’éligibilité et les réglages, AVANT la lecture des annonces ; tentative = le compteur de relance lu' },
    { code: 'recherche_terminee', fichier: 'lib/matching/index.ts', bloc: 'export async function runMatchingForPublication(', motif: /let recherche = new JournalDeRecherche\(supabaseAdmin, journal, \{ type: 'publications', id: publicationId \}, journal\.ecosystemeId\)[\s\S]*?const pub = pubData as unknown as LigneAnnonce\s*recherche = recherche\.dansEcosysteme\(pub\.domain_id\)/, quoi: 'annonce : l’histoire naît à l’entrée (écosystème du geste), et passe sous l’écosystème de l’annonce dès qu’elle est lue' },
    { code: 'recherche_terminee', fichier: 'lib/matching/run-for-expert.ts', bloc: 'async function executerRunExpert(', motif: /let recherche = new JournalDeRecherche\(supabaseAdmin, journal, \{ type: 'profiles', id: profileId \}, journal\.ecosystemeId\)[\s\S]*?const p = profData as unknown as LigneProfil\s*recherche = recherche\.dansEcosysteme\(p\.domain_id\)/, quoi: 'expert : l’histoire naît à l’entrée, et passe sous l’écosystème du profil dès qu’il est lu' },
    { code: 'recherche_terminee', fichier: 'lib/matching/run-for-expert.ts', bloc: 'const SELECT_PROFIL =', motif: /matching_relance_tentatives/, quoi: 'expert : le compteur de relance est LU avec le profil (§E.1 — une colonne absente se lit undefined)' },
    { code: 'recherche_terminee', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async filtree(', motif: (b) => !/journaliserDans/.test(b) && /this\.bilan\.eligibles = d\.eligibles/.test(b) && /this\.bilan\.examinees = d\.a_noter/.test(b), quoi: 'le filtrage NOTE les éligibles et les examinés, il n’écrit plus' },
    { code: 'recherche_terminee', fichier: 'lib/matching/index.ts', bloc: 'export async function runMatchingForPublication(', motif: /const sansMatiere = vivier\.profils\.length - documents\.length[\s\S]*?await recherche\.filtree\(\{\s*eligibles: baseStats\.eligible_after_filters,\s*ecartes_deja_decline: baseStats\.ecartes_deja_decline,\s*ecartes_deja_postule: baseStats\.ecartes_deja_postule,\s*sans_matiere: baseStats\.sans_matiere,\s*a_noter: documents\.length,\s*\}\)\s*if \(documents\.length === 0\) \{/, quoi: 'annonce : filtrée avec les MÊMES comptes que la trace, AVANT la branche « vivier vide »' },
    { code: 'recherche_terminee', fichier: 'lib/matching/run-for-expert.ts', bloc: 'async function executerRunExpert(', motif: /\.filter\(\(d\) => documentUtilisable\(d\.texte\)\)\s*await recherche\.filtree\(\{\s*chargees: annonces\.length,\s*eligibles: retenues\.length,\s*sans_matiere: retenues\.length - documents\.length,\s*a_noter: documents\.length,\s*\}\)\s*if \(documents\.length === 0\) \{/, quoi: 'expert : filtrée sur chargées, éligibles, sans matière, à noter — AVANT la branche « vivier vide »' },
    { code: 'recherche_terminee', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async classee(', motif: (b) => !/journaliserDans/.test(b) && /this\.bilan\.notees = d\.notes/.test(b) && /this\.bilan\.cout_usd = d\.facture\.cout_usd/.test(b), quoi: 'le classement NOTE les notés et le COÛT (null si un lot n’a pas de tarif), il n’écrit plus' },
    { code: 'recherche_terminee', fichier: 'lib/matching/index.ts', bloc: 'export async function runMatchingForPublication(', motif: /for \(const \[profileId, score\] of acquises\) \{[\s\S]*?\}\s*await recherche\.classee\(\{ model: notation\.model, notes: notation\.notes, reprises: acquises\.size, lots_en_echec: notation\.lots_en_echec, arret: notation\.arret_code \?\? null, facture: notation\.facture \}\)/, quoi: 'annonce : classée APRÈS la reprise des notes acquises, avec la facture du run telle que rendue' },
    { code: 'recherche_terminee', fichier: 'lib/matching/run-for-expert.ts', bloc: 'async function executerRunExpert(', motif: /for \(const \[publicationId, score\] of acquises\) \{[\s\S]*?\}\s*await recherche\.classee\(\{ model: notation\.model, notes: notation\.notes, reprises: acquises\.size, lots_en_echec: notation\.lots_en_echec, arret: notation\.arret_code \?\? null, facture: notation\.facture \}\)/, quoi: 'expert : classée APRÈS la reprise des notes acquises, avec la facture du run telle que rendue' },
    { code: 'recherche_terminee', fichier: 'lib/matching/rerank.ts', bloc: 'export async function rerankerTout(', motif: /const depense = await enregistrerDepenseIA\([\s\S]*?recherches \+= r\.facture\.recherches\s*if \(r\.facture\.source === 'plancher'\) auPlancher = true\s*coutUsd = coutUsd === null \|\| depense\.cout_usd === null \? null : coutUsd \+ depense\.cout_usd[\s\S]*?const facture = \{ recherches, source: auPlancher \? 'plancher' : 'fournisseur', cout_usd: coutUsd \} as const\s*return \{ scores, notes, lots_en_echec: lotsEnEchec, arret, arret_code: arretCode, model: args\.model, facture \}/, quoi: 'la facture est CUMULÉE lot par lot sur ce que l’appel a rendu et ce que l’enregistrement a tarifé ; un lot sans tarif rend le coût null, un lot au plancher rend la source plancher' },
    { code: 'recherche_terminee', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async correspondances(', motif: (b) => !/journaliserDans/.test(b) && /this\.bilan\.retenues = d\.retenues/.test(b) && /this\.bilan\.nouvelles = d\.inserees/.test(b), quoi: 'les correspondances NOTENT retenues, fortes et nouvelles, elles n’écrivent plus' },
    { code: 'recherche_terminee', fichier: 'lib/matching/index.ts', bloc: 'export async function runMatchingForPublication(', motif: /stats = await reconcileMatches\(\{[\s\S]*?\} catch \(err\) \{[\s\S]*?return \{ status: 'error'[^\n]*\n\s*\}\s*await recherche\.correspondances\(\{\s*retenues: desired\.length,\s*fortes: auDessusDuSeuil\.length,\s*inserees: stats\.inserted\.length,\s*mises_a_jour: stats\.updated,\s*supprimees: stats\.deleted,\s*filtre_flux: s\.feed_threshold,\s*palier_fort: s\.notify_threshold,\s*\}\)/, quoi: 'annonce : écrite APRÈS la réconciliation réussie (une réconciliation en échec n’écrit pas de correspondances), sur ce que la base a rendu' },
    { code: 'recherche_terminee', fichier: 'lib/matching/run-for-expert.ts', bloc: 'async function executerRunExpert(', motif: /stats = await reconcileMatches\(\{[\s\S]*?\} catch \(err\) \{[\s\S]*?return \{ status: 'error'[^\n]*\n\s*\}\s*await recherche\.correspondances\(\{\s*retenues: desired\.length,\s*fortes: desired\.filter\(\(d\) => d\.relevance_tier === 'strong'\)\.length,\s*inserees: stats\.inserted\.length,\s*mises_a_jour: stats\.updated,\s*supprimees: stats\.deleted,\s*filtre_flux: s\.feed_threshold,\s*palier_fort: s\.notify_threshold,\s*\}\)/, quoi: 'expert : écrite APRÈS la réconciliation réussie, sur ce que la base a rendu' },
    { code: 'recherche_terminee', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async notifiee(', motif: (b) => !/journaliserDans/.test(b) && /this\.bilan\.notifiees = b\.posees/.test(b), quoi: 'les notifications NOTENT les personnes prévenues et celles qui ne l’ont pas été, elles n’écrivent plus' },
    { code: 'recherche_terminee', fichier: 'lib/matching/index.ts', bloc: 'export async function runMatchingForPublication(', motif: /if \(specs\.length > 0\) \{\s*const bilan = await notifyAndFlip\(\{ supabaseAdmin, specs, piece: journal\.piece \}\)\s*notifies = specs\.length\s*await recherche\.notifiee\(bilan\)\s*\}/, quoi: 'annonce : écrite quand un envoi a été TENTÉ, avec le bilan rendu par l’envoi' },
    { code: 'recherche_terminee', fichier: 'lib/matching/run-for-expert.ts', bloc: 'async function executerRunExpert(', motif: /if \(specs\.length > 0\) \{\s*const bilan = await notifyAndFlip\(\{ supabaseAdmin, specs, piece: journal\.piece \}\)\s*notifies = specs\.length\s*await recherche\.notifiee\(bilan\)\s*\}/, quoi: 'expert : écrite quand un envoi a été TENTÉ, avec le bilan rendu par l’envoi' },
    { code: 'recherche_terminee', fichier: 'lib/matching/shared.ts', bloc: 'export async function notifyAndFlip(', motif: (b) => /return \{ \.\.\.bilan, renonce: true \}/.test(b) && /bilan\.deja_notifiees\+\+/.test(b) && /bilan\.paquets_en_echec\+\+/.test(b) && /bilan\.posees \+= typeof posees === 'number' \? posees : 0/.test(b) && /return bilan\s*\}?\s*$/.test(b), quoi: 'l’envoi REND son bilan sur chaque chemin : renoncement, déjà notifiées, paquets refusés, lignes posées' },
    { code: 'recherche_terminee', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async terminee(', motif: /type: 'recherche_terminee',\s*statut: 'reussi',\s*sujet: this\.sujet,\s*ecosystemeId: this\.ecosystemeId,\s*detail: \{\s*issue: d\.issue, raison: d\.raison, tentative: b\.tentative, tache: this\.journal\.tache,\s*eligibles: b\.eligibles, examinees: b\.examinees, notees: b\.notees, reprises: b\.reprises, lots_en_echec: b\.lots_en_echec,\s*retenues: b\.retenues, fortes: b\.fortes, nouvelles: b\.nouvelles, notifiees: b\.notifiees, notifications_manquees: b\.notifications_manquees,\s*recherches: b\.recherches, unites_source: b\.unites_source,\s*\},\s*cout: this\.cout\(\),/, quoi: 'l’écrivain : UNE ligne — l’issue, la raison en code, le bilan clé par clé et le coût, avec ses unités et leur SOURCE (§D.24), au statut que la base impose' },
    { code: 'recherche_terminee', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async classee(', motif: (b) => !/journaliserDans/.test(b) && /this\.bilan\.cout_usd = d\.facture\.cout_usd\s*this\.bilan\.recherches = d\.facture\.recherches\s*this\.bilan\.unites_source = d\.facture\.source/.test(b), quoi: 'le classement NOTE le coût, les unités facturées et leur source (mesurées ou estimées au plancher) — relecture du 01/10/2026, point 15' },
    { code: 'recherche_terminee', fichier: 'lib/matching/index.ts', bloc: 'export async function runMatchingForPublication(', motif: (b) => /await recherche\.terminee\(\{ issue: 'annonce_expiree' \}\)\s*return \{\s*status: 'annonce_expiree',/.test(b) && /await recherche\.terminee\(\{ issue: 'vivier_vide' \}\)\s*return \{ status: 'empty_pool'/.test(b) && /if \(acheve\) await solderBrouillon\(supabaseAdmin, publicationId\)\s*if \(acheve\) await recherche\.terminee\(\{ issue: 'ok' \}\)/.test(b) && (b.match(/recherche\.terminee\(/g) || []).length === 3, quoi: 'annonce : TROIS fins et pas une de plus — annonce expirée (avant la tentative), vivier vide (run achevé), ok (après trace et brouillon soldé)' },
    { code: 'recherche_terminee', fichier: 'lib/matching/run-for-expert.ts', bloc: 'async function executerRunExpert(', motif: (b) => /await recherche\.terminee\(\{ issue: 'ineligible', raison: eligibilite\.raison \}\)\s*return \{\s*status: 'empty_pool',/.test(b) && /await recherche\.terminee\(\{ issue: 'sans_matiere' \}\)\s*return \{\s*status: 'empty_pool',/.test(b) && /await ecrireTraceDePerimetre\(supabaseAdmin, profileId, ouvertureCroisee\)\s*await recherche\.terminee\(\{ issue: 'vivier_vide' \}\)\s*return \{ status: 'empty_pool'/.test(b) && /await ecrireTraceDePerimetre\(supabaseAdmin, profileId, ouvertureCroisee\)\s*const acheve = notation\.lots_en_echec === 0 && !notation\.arret\s*if \(acheve\) await recherche\.terminee\(\{ issue: 'ok' \}\)/.test(b) && (b.match(/recherche\.terminee\(/g) || []).length === 4, quoi: 'expert : QUATRE fins et pas une de plus — inéligible (avec sa raison), sans matière, vivier vide (après la trace de périmètre), ok' },
    { code: 'recherche_echouee', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async echouee(', motif: /type: 'recherche_echouee',\s*statut: 'echoue',\s*sujet: this\.sujet,\s*ecosystemeId: this\.ecosystemeId,\s*detail: \{\s*etape: d\.etape, cause: d\.cause, tentative: d\.tentative, arret: d\.arret, tache: this\.journal\.tache,\s*eligibles: b\.eligibles,/, quoi: 'l’écrivain : l’étape et la cause en codes, la tentative, l’arrêt, et le bilan de ce qui a eu lieu — au statut que la base impose' },
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
    { code: 'recherche_abandonnee', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async echouee(', motif: /type: 'recherche_abandonnee',\s*statut: 'echoue',\s*sujet: this\.sujet,\s*ecosystemeId: this\.ecosystemeId,\s*detail: \{\s*tentatives: d\.tentative, plafond, cause: d\.cause, etape: d\.etape, arret: d\.arret,/, quoi: 'l’écrivain : tentatives, plafond en vigueur, la cause et l’étape du dernier échec — au statut que la base impose' },
    { code: 'recherche_abandonnee', fichier: 'lib/matching/journal-de-recherche.ts', bloc: 'async echouee(', motif: /const plafond = this\.sujet\.type === 'publications' \? RUN_MAX_TENTATIVES : RELANCE_MAX_TENTATIVES[\s\S]*?if \(d\.tentative !== null && d\.tentative >= plafond\) \{\s*await journaliserDans\(this\.admin, this\.journal, \{\s*type: 'recherche_abandonnee',[\s\S]*?\}\)\s*return\s*\}\s*await journaliserDans\(this\.admin, this\.journal, \{\s*type: 'recherche_echouee',/, quoi: 'l’abandon REMPLACE l’échec (une ligne, pas deux), décidé AVANT d’écrire : tentative consommée ≥ plafond du sens, plafonds importés du module pur' },
    { code: 'recherche_abandonnee', fichier: 'app/api/cron/match-retry/route.ts', bloc: 'async function handle(', motif: /p_max_attempts: RUN_MAX_TENTATIVES,/, quoi: 'le rattrapage exclut au MÊME plafond que celui qui écrit l’abandon (une source, plus de constante locale)' },
    { code: 'recherche_abandonnee', fichier: 'lib/matching/mise-en-relation-immediate.ts', bloc: 'export async function lancerMiseEnRelationImmediate(', motif: /await marquerTentativeRelance\(admin, profileId\)[\s\S]{0,120}?const verdict = await runMatchingForExpert\(\{/, quoi: 'la recherche immédiate compte la tentative AVANT le run : le moteur lit un compteur juste' },
    ...['app/api/admin/approve-expert/route.ts', 'lib/travaux-ia/executer-verification.ts', 'lib/travaux-ia/executer-analyse.ts'].map((fichier) => ({ code: 'recherche_abandonnee', fichier, bloc: fichier.includes('approve') ? 'export async function POST(' : fichier.includes('verification') ? 'export async function executerVerification(' : 'export async function executerAnalyseCv(', motif: /lancerMiseEnRelationImmediate\(/, quoi: 'ce déclencheur passe par la recherche immédiate UNIQUE (tentative comptée, échec rejoué)' })),
    // ── D : l'annonce, le profil, le CV, la disponibilité ──
    { code: 'annonce_publiee', fichier: 'app/api/publications/[id]/publish/route.ts', bloc: 'export async function POST(', motif: /\.rpc\('publier_annonce',\s*\{\s*\.\.\.parametresJournal\(journal\),\s*p_publication_id: id,\s*p_domain_id: activeEcosystemId\(auth\),\s*p_organization_id: orgId,\s*p_statuts_admis: \[\.\.\.PUBLISHABLE_FROM\],\s*p_verdict: verdict\.status,\s*p_score: verdict\.score,\s*p_method: verdict\.method,\s*p_data: verdict\.data,/, quoi: 'la route met en ligne par la RPC métier, avec le contexte, le cloisonnement, l’organisation et les statuts admis' },
    { code: 'annonce_publiee', fichier: 'app/api/publications/[id]/publish/route.ts', bloc: 'export async function POST(', motif: (b) => !/\.from\('publications'\)[\s\S]{0,200}?\.update\(/.test(b) && /if \(!miseEnLigne\) \{[\s\S]{0,400}?rendreLaPlace\([\s\S]{0,200}?409\)/.test(b), quoi: 'plus d’écriture directe du statut ; zéro ligne touchée rend la place et répond 409' },
    { code: 'annonce_modifiee', fichier: 'app/api/publications/[id]/route.ts', bloc: 'export async function PATCH(', motif: /\.update\(u\.updates\)[\s\S]*?\.single\(\)\s*if \(updateErr \|\| !updated\) \{[\s\S]*?\}[\s\S]*?const champsChanges = clesModifiees\(u\.updates as Record<string, unknown>, avantAnnonce\)\s*try \{\s*if \(champsChanges\.length > 0\) \{\s*await journaliserDans\(auth\.supabaseAdmin, journal, \{\s*type: 'annonce_modifiee',\s*statut: 'reussi',\s*sujet: \{ type: 'publications', id \},\s*detail: \{ champs: champsChanges, statut_annonce: updated\.status, organization_id: orgId \},\s*\}\)\s*\}\s*\} catch \(err\) \{\s*if \(!\(err instanceof JournalError\)\) throw err[\s\S]{0,300}?code: 'journal_error', publication_id: id \}, 500\)/, quoi: 'la ligne vient APRÈS l’écriture, ne nomme que les champs dont la valeur CHANGE (relus avant), rien sans changement ; un journal qui refuse répond journal_error' },
    { code: 'annonce_modifiee', fichier: 'app/api/publications/[id]/route.ts', bloc: 'export async function PATCH(', motif: (b) => b.indexOf("type: 'annonce_modifiee'") < b.indexOf("action: 'publication_edited'"), quoi: 'le grand livre précède l’audit best-effort : c’est lui qui doit survivre (§E.68)' },
    { code: 'annonce_depubliee', fichier: 'app/api/publications/[id]/close/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.rpc\('cloturer_annonce',\s*\{\s*\.\.\.parametresJournal\(journal\),\s*p_publication_id: id,\s*p_domain_id: activeEcosystemId\(auth\),\s*p_organization_id: orgId,\s*p_statuts_admis: \[\.\.\.CLOSABLE_FROM\],\s*\}\)[\s\S]*?if \(cloturee !== true\) \{[\s\S]{0,200}?409\)/, quoi: 'la route clôture par la RPC métier, avec le contexte, le cloisonnement, l’organisation et les statuts admis ; zéro ligne touchée répond 409' },
    { code: 'annonce_depubliee', fichier: 'app/api/publications/[id]/close/route.ts', bloc: 'export async function POST(', motif: (b) => !/\.from\('publications'\)[\s\S]{0,200}?\.update\(/.test(b), quoi: 'plus d’écriture directe du statut' },
    { code: 'annonce_expiree', fichier: 'app/api/cron/constats/route.ts', bloc: 'async function handle(', motif: /const journal = contexteDeTache\(JOB, piece\)[\s\S]*?const lectureDurees = await chargerDurees\(admin\)[\s\S]*?\.rpc\('constater_annonces_expirees',\s*\{\s*p_piece: journal\.piece,\s*p_vie_annonce_jours: durees\.vieAnnonceJours,\s*p_limite: LIMITE_PAR_PASSAGE,\s*\}\)/, quoi: 'la tâche de constat ouvre UNE pièce par passage, lit la durée en vigueur, et la passe avec la pièce à la fonction SQL' },
    { code: 'cv_televerse', fichier: 'lib/profil/journal-profil.ts', bloc: 'export async function cvTeleverse(', motif: /type: 'cv_televerse',\s*statut: args\.analyse === 'done' \? 'reussi' : 'echoue',\s*sujet: \{ type: 'profiles', id: args\.profileId \},\s*detail: \{\s*octets: args\.octets,\s*analyse: args\.analyse,\s*premier_consentement: args\.premierConsentement,\s*experiences: args\.experiences,\s*formations: args\.formations,\s*langues: args\.langues,\s*ecarts: args\.ecarts,\s*\},/, quoi: 'l’écrivain unique des deux voies : l’issue de l’analyse, le premier consentement, des comptes — jamais l’empreinte ni le nom du fichier' },
    // ARRÊT 19 (§D.30) : l'analyse est un TRAVAIL. La ligne `cv_televerse` est écrite par l'EXÉCUTANT, sous la pièce
    // du dépôt, APRÈS la transaction qui écrit l'analyse (terminer_analyse_cv) et seulement si elle a ÉCRIT ; l'échec
    // a SA ligne, écrite en base (travail_ia_echoue) — pas deux lignes pour un geste. Le premier consentement est LU
    // par la base au dépôt, AVANT l'écriture qui le pose (deposer_analyse_cv), et voyage dans la charge du travail.
    { code: 'cv_televerse', fichier: 'lib/travaux-ia/executer-analyse.ts', bloc: 'export async function executerAnalyseCv(', motif: (b) =>
        b.indexOf("rpc('terminer_analyse_cv'") > 0 && b.indexOf("rpc('terminer_analyse_cv'") < b.indexOf('await cvTeleverse(')
        && b.indexOf('if (r.ecrit !== true)') > 0 && b.indexOf('if (r.ecrit !== true)') < b.indexOf('await cvTeleverse(')
        && /analyse: 'done',/.test(b) && !/analyse: 'failed'/.test(b)
        && /premierConsentement: t\.charge\.premier_consentement === true/.test(b),
      quoi: 'l’exécutant écrit la ligne APRÈS l’écriture de l’analyse, seulement si elle a écrit ; le premier consentement vient du dépôt' },

    { code: 'profil_publie', fichier: 'lib/profil/journal-profil.ts', bloc: 'export async function profilPublie(', motif: /type: 'profil_publie',\s*statut: 'reussi',\s*sujet: \{ type: 'profiles', id: args\.profileId \},\s*detail: \{ deja_visible: args\.dejaVisible, verification_avant: args\.verificationAvant \},/, quoi: 'l’écrivain : première publication ou republication, et l’état de vérification d’avant' },
    { code: 'profil_publie', fichier: 'app/api/profile/route.ts', bloc: 'export async function PATCH(', motif: (b) => /if \(body\.visible === true\) \{\s*const \{ error: userUpdErr \}[\s\S]*?try \{\s*if \(cp\.visible !== true\) \{\s*await profilPublie\(supabaseAdmin, journal, \{ profileId: cp\.id, dejaVisible: false, verificationAvant: \(cp\.verification_status as string \| null\) \?\? null \}\)/.test(b) && b.indexOf('await profilPublie(') < b.indexOf('deposerVerificationExpert(supabaseAdmin') && b.indexOf('await profilPublie(') < b.indexOf("action: 'profile_update'") && /journalRefuse = err/.test(b) && b.indexOf('after(async () =>') < b.indexOf("if (journalRefuse) return json({ error: 'Journal failed', code: 'journal_error', profile_id: cp.id }, 500)"), quoi: 'la route écrit « Profil publié » quand le profil DEVIENT visible (une republication n’écrit plus), AVANT la vérification et l’audit ; un refus du journal est rendu APRÈS le travail différé' },
    { code: 'profil_publie', fichier: 'app/api/profile/route.ts', bloc: 'const baseSelect =', motif: /\bvisible\b/, quoi: 'la colonne `visible` est LUE avec le profil (§E.1) — sans elle, « déjà visible » se lirait toujours faux' },
    { code: 'profil_modifie', fichier: 'lib/profil/journal-profil.ts', bloc: 'export async function profilModifie(', motif: /type: 'profil_modifie',\s*statut: 'reussi',\s*sujet: \{ type: 'profiles', id: args\.profileId \},\s*detail: \{ champs: args\.champs, blocs: args\.blocs \},/, quoi: 'l’écrivain : les noms des champs et des blocs, jamais leur contenu' },
    { code: 'profil_modifie', fichier: 'app/api/profile/route.ts', bloc: 'export async function PATCH(', motif: (b) => /const champDispo = CHAMP_DISPONIBILITE\[isCdi \? 'expert_cdi' : 'expert_freelance'\]\s*const champsModifies = champsReellementModifies\.filter\(\(k\) => k !== 'visible' && k !== champDispo && !\(k === 'photo_url' && patch\.photo_url != null\)\)\s*if \(champsModifies\.length > 0 \|\| blocsModifies\.length > 0\) \{\s*try \{\s*await profilModifie\(supabaseAdmin, journal, \{ profileId: cp\.id, champs: champsModifies, blocs: blocsModifies \}\)/.test(b) && /champsReellementModifies = clesModifiees\(patch, avant/.test(b) && b.indexOf('champsReellementModifies = clesModifiees(') < b.indexOf('.update(patch)') && b.indexOf('await profilModifie(') > b.indexOf('.update(patch)') && b.indexOf('await profilModifie(') < b.indexOf("action: 'profile_update'"), quoi: 'la route relit les valeurs AVANT d’écrire et ne nomme que ce qui CHANGE ; la ligne vient APRÈS l’écriture, avant la publication et l’audit — hors visible et hors le champ de disponibilité' },
    { code: 'disponibilite_basculee', fichier: 'lib/profil/journal-profil.ts', bloc: 'export async function disponibiliteBasculee(', motif: /type: 'disponibilite_basculee',\s*statut: 'reussi',\s*sujet: \{ type: 'profiles', id: args\.profileId \},\s*detail: \{ champ: args\.champ, de: args\.de, vers: args\.vers \},/, quoi: 'l’écrivain : le champ de la voie, l’état d’avant, l’état d’après — des codes' },
    { code: 'disponibilite_basculee', fichier: 'app/api/profile/route.ts', bloc: 'export async function PATCH(', motif: (b) => /const champDispo = CHAMP_DISPONIBILITE\[isCdi \? 'expert_cdi' : 'expert_freelance'\]/.test(b) && /if \(champDispo in patch && patch\[champDispo\] !== cp\[champDispo\]\) \{\s*try \{\s*await disponibiliteBasculee\(supabaseAdmin, journal, \{ profileId: cp\.id, champ: champDispo, de: \(cp\[champDispo\] as string \| null\) \?\? null, vers: \(patch\[champDispo\] as string \| null\) \?\? null \}\)/.test(b) && b.indexOf('await disponibiliteBasculee(') > b.indexOf('.update(patch)') && b.indexOf('await disponibiliteBasculee(') < b.indexOf("action: 'profile_update'"), quoi: 'la route écrit la bascule quand le champ de la voie CHANGE (l’avant lu avec le profil), après l’écriture, avant l’audit' },
    { code: 'devoilement_ferme', fichier: 'app/api/cron/constats/route.ts', bloc: 'async function handle(', motif: /\.from\('candidatures'\)\s*\.select\('id, status, unlocked_at, conversations\(expires_at\)'\)\s*\.eq\('status', 'unlocked'\)\s*\.is\('fermeture_constatee_at', null\)[\s\S]*?const vie = deriveCandidatureLifecycle\([\s\S]*?if \(vie\.reason !== 'exchange_expired'\) continue[\s\S]*?\.rpc\('constater_devoilement_ferme',\s*\{\s*p_piece: journal\.piece,\s*p_candidature_id: c\.id,\s*p_fin_echange: fin\.toISOString\(\),[\s\S]{0,300}?p_statut_lu: c\.status,/, quoi: 'la tâche lit les dévoilées jamais constatées avec leur fil, laisse la SOURCE UNIQUE de l’état de vie décider « échange refermé », et constate avec la pièce du passage et la fin d’échange' },
    // ── E : la sécurité des comptes et la gouvernance d'organisation ──
    { code: 'compte_suspendu', fichier: 'app/api/admin/user-status/route.ts', bloc: 'export async function POST(', motif: (b) => /const journal = contexteDepuisAuth\(auth\)/.test(b) && /\.rpc\('changer_statut_compte',\s*\{\s*\.\.\.parametresJournal\(journal\),\s*p_user_id: t\.id,\s*p_statuts_admis: \[t\.status\],\s*p_nouveau_statut: nextStatus,\s*p_suspend: action === 'suspend',\s*\}\)/.test(b) && /if \(!bascule\) \{[\s\S]{0,300}?code: 'wrong_status' \}, 409\)/.test(b) && !/\.from\('users'\)[\s\S]{0,120}?\.update\(\{ status:/.test(b), quoi: 'la route bascule par la RPC métier avec le contexte et le statut LU comme seul statut admis ; zéro ligne répond 409 ; plus d’écriture directe du statut' },
    ...[['approve-expert', 'statuer_sur_expert', 'true', 'null'], ['reject-expert', 'statuer_sur_expert', 'false', 'reason'],
        ['approve-org', 'statuer_sur_organisation', 'true', 'null'], ['reject-org', 'statuer_sur_organisation', 'false', 'reason']]
      .map(([route, fn, approuve, motif]) => ({ code: approuve === 'true' ? 'compte_valide' : 'compte_refuse', fichier: `app/api/admin/${route}/route.ts`, bloc: 'export async function POST(', motif: (b) =>
        new RegExp(`const journal = contexteDepuisAuth\\(auth\\)`).test(b)
        && new RegExp(`\\.rpc\\('${fn}',\\s*\\{\\s*\\.\\.\\.parametresJournal\\(journal\\),[\\s\\S]{0,200}?p_statut_admis: STATUT_ARBITRABLE,\\s*p_approuve: ${approuve},\\s*p_motif: ${motif},`).test(b)
        && /if \(!arbitrage\) \{[\s\S]{0,200}?code: 'already_processed' \}, 409\)/.test(b)
        && !/\.from\('(profiles|organizations)'\)[\s\S]{0,200}?\.update\(\{\s*verification_status:/.test(b)
        && !/verified_at: nowIso/.test(b),
        quoi: `${route} : arbitre par la RPC métier avec le contexte et le statut admis PARTAGÉ ; zéro ligne répond 409 ; plus d’écriture directe du verdict, et la date rendue est celle posée par la base` })),
    { code: 'session_revoquee', fichier: 'lib/comptes/journal-compte.ts', bloc: 'export async function sessionRevoquee(', motif: /type: 'session_revoquee',\s*statut: 'reussi',\s*sujet: \{ type: 'users', id: args\.userId \},\s*detail: \{\},/, quoi: 'l’écrivain : le fait seul, sur le compte — aucun détail, donc rien qui identifie une session' },
    { code: 'session_revoquee', fichier: 'app/api/me/sessions/revoke-others/route.ts', bloc: 'export async function POST(', motif: (b) => /const setRes = await setSessionToken\([\s\S]*?await sessionRevoquee\(auth\.supabaseAdmin, journal, \{ userId: auth\.user\.id \}\)/.test(b) && /if \(!\(err instanceof JournalError\)\) throw err[\s\S]{0,300}?code: 'journal_error'/.test(b) && b.indexOf('await sessionRevoquee(') < b.indexOf("action: 'sessions_revoked_others'"), quoi: 'la ligne vient APRÈS la rotation et AVANT l’audit ; un journal qui refuse répond journal_error' },
    { code: 'suppression_programmee', fichier: 'app/api/me/account/delete/route.ts', bloc: 'export async function POST(', motif: /\.rpc\('programmer_suppression_compte',\s*\{\s*\.\.\.parametresJournal\(journal\),\s*p_user_id: auth\.user\.id,\s*p_scheduled_at: scheduledAt,\s*p_grace_jours: GRACE_DAYS,\s*\}\)/, quoi: 'la route programme par la RPC avec le contexte, l’échéance et la grâce — la ligne naît dans la transaction du transfert de siège' },
    { code: 'suppression_annulee', fichier: 'lib/comptes/journal-compte.ts', bloc: 'export async function suppressionAnnulee(', motif: /type: 'suppression_annulee',\s*statut: 'reussi',\s*sujet: \{ type: 'users', id: args\.userId \},\s*detail: \{ visibilite_restauree: args\.visibiliteRestauree, avait_un_profil: args\.avaitUnProfil \},/, quoi: 'l’écrivain : le compte revient, et la ligne dit si la visibilité revient avec lui' },
    { code: 'suppression_annulee', fichier: 'app/api/me/account/reactivate/route.ts', bloc: 'export async function POST(', motif: (b) => /\.from\('users'\)\s*\.update\(\{ deletion_scheduled_at: null \}\)[\s\S]*?await suppressionAnnulee\(auth\.supabaseAdmin, journal, \{\s*userId: auth\.user\.id,\s*visibiliteRestauree: restoreVisible,\s*avaitUnProfil,\s*\}\)/.test(b) && /if \(!\(err instanceof JournalError\)\) throw err[\s\S]{0,300}?code: 'journal_error'/.test(b) && b.indexOf('await suppressionAnnulee(') < b.indexOf("action: 'account_reactivated'"), quoi: 'la ligne vient APRÈS la réactivation du compte et AVANT l’audit, avec la visibilité réellement restaurée ; un journal qui refuse répond journal_error' },
    { code: 'email_change', fichier: 'lib/comptes/journal-compte.ts', bloc: 'export async function emailChange(', motif: /type: 'email_change',\s*statut: 'reussi',\s*sujet: \{ type: 'users', id: args\.userId \},\s*detail: \{ etape: args\.etape \},/, quoi: 'l’écrivain : l’étape seule sort (son type fermé est tenu par le compilateur) — jamais l’adresse' },
    { code: 'email_change', fichier: 'app/api/me/email/route.ts', bloc: 'export async function POST(', motif: (b) => /userClient\.auth\.updateUser\(\{ email: new_email \}\)[\s\S]*?await emailChange\(auth\.supabaseAdmin, journal, \{ userId: auth\.user\.id, etape: 'demande' \}\)/.test(b) && b.indexOf('await emailChange(') < b.indexOf("action: 'email_change_requested'") && /code: 'journal_error'/.test(b), quoi: 'la ligne vient APRÈS l’appel qui déclenche la confirmation, avec l’étape « demande » — l’adresse n’a pas encore changé — et avant l’audit' },
    { code: 'mot_de_passe_change', fichier: 'lib/comptes/journal-compte.ts', bloc: 'export async function motDePasseChange(', motif: /type: 'mot_de_passe_change',\s*statut: 'reussi',\s*sujet: \{ type: 'users', id: args\.userId \},\s*detail: \{\},/, quoi: 'l’écrivain : le fait seul — aucun détail, donc ni empreinte ni longueur' },
    { code: 'mot_de_passe_change', fichier: 'app/api/me/password/route.ts', bloc: 'export async function POST(', motif: (b) => /userClient\.auth\.updateUser\(\{ password: new_password \}\)[\s\S]*?await motDePasseChange\(auth\.supabaseAdmin, journal, \{ userId: auth\.user\.id \}\)/.test(b) && b.indexOf('await motDePasseChange(') < b.indexOf("action: 'password_changed'") && /code: 'journal_error'/.test(b), quoi: 'la ligne vient APRÈS la bascule et AVANT l’audit ; un journal qui refuse répond journal_error' },
    { code: 'telephone_verifie', fichier: 'app/api/auth/verify-phone-otp/route.ts', bloc: 'export async function POST(', motif: (b) => /\.rpc\('verifier_telephone',\s*\{\s*\.\.\.parametresJournal\(journal\),\s*p_user_id: auth\.user\.id,\s*p_phone: phone,\s*p_methode: 'otp_sms',\s*\}\)/.test(b) && !/\.from\('users'\)[\s\S]{0,120}?\.update\(\{ phone_verified:/.test(b) && /isUniqueViolation\(updErr\)/.test(b), quoi: 'la route vérifie par la RPC métier avec le contexte ; plus d’écriture directe du drapeau, et la violation d’unicité reste traitée' },
    { code: 'invitation_revoquee', fichier: 'app/api/me/organisation/invitations/[id]/route.ts', bloc: 'export async function PATCH(', motif: (b) => /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.rpc\('revoquer_invitation', \{\s*\.\.\.parametresJournal\(journal\),\s*p_ecosysteme_id: auth\.domain\.id,\s*p_invitation_id: inv\.id,\s*p_organization_id: org\.id,\s*p_statuts_admis: \[\.\.\.INVITATION_MODIFIABLE\],/.test(b) && /if \(revoquee !== true\) \{[\s\S]{0,120}?code: 'not_pending' \}, 409\)/.test(b) && !/\.from\('organization_invitations'\)\s*\.update\(\{ status: 'revoked'/.test(b), quoi: 'la route révoque par la RPC métier — contexte, organisation et statuts admis PARTAGÉS avec la garde ; zéro ligne répond 409 ; plus d’écriture directe' },
    { code: 'invitation_renvoyee', fichier: 'app/api/me/organisation/invitations/[id]/route.ts', bloc: 'export async function PATCH(', motif: (b) => /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.rpc\('renvoyer_invitation', \{\s*\.\.\.parametresJournal\(journal\),\s*p_ecosysteme_id: auth\.domain\.id,\s*p_invitation_id: inv\.id,\s*p_organization_id: org\.id,\s*p_statuts_admis: \[\.\.\.INVITATION_MODIFIABLE\],\s*p_token: tokenHash,\s*p_expires_at: expiresAt,/.test(b) && /if \(renvoyee !== true\) \{[\s\S]{0,120}?code: 'not_pending' \}, 409\)/.test(b) && !/\.from\('organization_invitations'\)\s*\.update\(/.test(b), quoi: 'la route renvoie par la RPC métier — même contexte, même organisation, mêmes statuts admis que la révocation ; zéro ligne répond 409 ; plus aucune écriture directe de l’invitation' },
    { code: 'invitation_acceptee', fichier: 'lib/invitation-accept.ts', bloc: 'export async function applyInvitation(', motif: (b) => /\.rpc\('accepter_invitation', \{\s*\.\.\.parametresJournal\(journal\),\s*p_ecosysteme_id: domainId,\s*p_invitation_id: invitation\.id,\s*p_statuts_admis: \[\.\.\.INVITATION_MODIFIABLE\],\s*\}\)/.test(b) && !/\.from\('organization_(members|invitations)'\)/.test(b) && /default:[\s\S]{0,200}?code: 'db_error'/.test(b), quoi: 'l’acceptation passe par la RPC métier avec le contexte et les statuts PARTAGÉS ; plus aucune écriture directe du membre ni de l’invitation ; une issue inconnue n’est pas un succès' },
    { code: 'invitation_acceptee', fichier: 'app/api/me/invitations/accept/route.ts', bloc: 'export async function POST(', motif: /requireAuth\(request\)[\s\S]*?const journal = contexteDepuisAuth\(auth\)[\s\S]*?applyInvitation\(\{\s*admin,\s*journal,/, quoi: 'la route ouvre son contexte à l’entrée et le transmet à l’acceptation' },
    { code: 'invitation_acceptee', fichier: 'lib/invitation-accept.ts', bloc: 'export const INVITATION_MODIFIABLE =', motif: /= \['pending'\] as const/, quoi: 'UNE constante des statuts admis, partagée par l’acceptation, la révocation et le renvoi' },
    // ── E : les trois faces d'un membre — un écrivain SQL, une enveloppe, quatre appelants ──
    { code: 'role_membre_change', fichier: 'lib/org-members.ts', bloc: 'export async function majMembreOrganisation(', motif: /\.rpc\('maj_membre_organisation', \{\s*\.\.\.parametresJournal\(journal\),\s*p_ecosysteme_id: params\.ecosystemeId,\s*p_membre_id: params\.membreId,/, quoi: 'l’enveloppe exige le contexte du geste et le transmet à la RPC, avec l’écosystème de la LIGNE' },
    { code: 'role_membre_change', fichier: 'app/api/me/organisation/members/[id]/route.ts', bloc: 'export async function PATCH(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?majMembreOrganisation\(auth\.supabaseAdmin, journal, \{\s*membreId: target\.id,\s*ecosystemeId: auth\.domain\.id,\s*nouveauRole: newRole,/, quoi: 'organisation : le changement de rôle passe le contexte ouvert à l’entrée' },
    { code: 'role_membre_change', fichier: 'app/api/admin/user-org-role/route.ts', bloc: 'export async function PATCH(', motif: /requireReauth\(request, auth\.user\.id\)[\s\S]{0,120}?const journal = contexteDepuisAuth\(auth\)[\s\S]*?majMembreOrganisation\(auth\.supabaseAdmin, journal, \{\s*membreId: member\.id,[\s\S]{0,200}?ecosystemeId: t\.domain_id,[\s\S]{0,80}?forcer: lastAdminBypassed,/, quoi: 'plateforme : le dépannage passe le contexte (origine administrateur) et l’écosystème de la CIBLE ; le forçage reste nommé' },
    { code: 'membre_retire', fichier: 'app/api/me/organisation/members/[id]/route.ts', bloc: 'export async function DELETE(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?majMembreOrganisation\(auth\.supabaseAdmin, journal, \{\s*membreId: target\.id,\s*ecosystemeId: auth\.domain\.id,\s*nouveauStatut: 'removed',/, quoi: 'le retrait passe le contexte ; la base dérive « retiré » (la ligne d’un AUTRE — la route interdit la sienne)' },
    { code: 'membre_parti', fichier: 'app/api/me/organisation/leave/route.ts', bloc: 'export async function POST(', motif: /requireAuth\(request\)[\s\S]{0,200}?const journal = contexteDepuisAuth\(auth\)[\s\S]*?majMembreOrganisation\(admin, journal, \{\s*membreId: myRow\.id as string,\s*ecosystemeId: auth\.domain\.id,\s*nouveauStatut: 'removed',/, quoi: 'le départ passe le contexte ; la base dérive « parti » (la ligne de l’ACTEUR lui-même)' },
    // ── 2.7 : la recherche écartée parce qu'une autre tient le bail ──
    { code: 'recherche_terminee', fichier: 'lib/matching/run-for-expert.ts', bloc: 'export async function runMatchingForExpert(', motif: (b) => /if \(bail !== 'pris'\) \{[\s\S]*?return \{/.test(b) && !/refusRechercheEnCours/.test(b), quoi: 'une recherche écartée par le bail (« occupé ») rend sa réponse SANS ligne (ARRÊT 22, action retirée) — celle qui tient le bail écrit sa fin' },
    // ── G : le message envoyé ──
    { code: 'devoilement_ouvert', fichier: 'app/api/conversations/[id]/messages/route.ts', bloc: 'export async function POST(', motif: (b) => /requireAuth\(request\)[\s\S]{0,200}?const journal = contexteDepuisAuth\(auth\)/.test(b) && /\.rpc\('envoyer_message', \{\s*\.\.\.parametresJournal\(journal\),\s*p_conversation_id: convId,\s*p_statuts_admis: \[\.\.\.CONVERSATION_OUVERTE\],\s*p_contenu: content,/.test(b) && /envoi\.issue === 'fermee'\) return json\(\{[^}]*\}, 409\)/.test(b) && !/\.from\('messages'\)\s*\.insert\(/.test(b) && !/\.from\('conversations'\)\s*\.update\(\{ last_message_at/.test(b) && /isExpired\(conv\.expires_at\)/.test(b), quoi: 'la route envoie par la RPC, avec le contexte ouvert à l’entrée et les statuts PARTAGÉS avec sa garde ; fil fermé entre-temps → 409 ; plus d’insertion ni de mise à jour directes ; l’expiration reste jugée par sa source unique' },
    // ── G : les trois purges (un écrivain, trois codes) et l'avertissement d'inactivité ──
    { code: 'compte_purge_demande', fichier: 'lib/account-purge.ts', bloc: 'export async function purgeAccount(', motif: (b) => /\.rpc\('audit_logs_nettoyer_compte'[\s\S]*?\.rpc\('anonymiser_compte', \{\s*\.\.\.parametresJournal\(contexte\.journal\),\s*p_user_id: uid,\s*p_email_substitut: placeholderEmail,\s*p_motif: motifDePurge\(contexte\),/.test(b) && /if \(anonymise !== true\) throw new Error/.test(b) && !/\.from\('users'\)\s*\.update\(/.test(b), quoi: 'le jalon et la ligne partent par la RPC, APRÈS le nettoyage de l’audit ; le motif est DÉRIVÉ du contexte ; un compte déjà purgé LÈVE ; plus d’écriture directe de users' },
    { code: 'compte_purge_inactivite', fichier: 'lib/account-purge.ts', bloc: 'function motifDePurge(', motif: /if \(c\.origine === 'administrateur'\) return 'admin'\s*return c\.job === 'purge_inactive' \? 'inactivite' : 'demande'/, quoi: 'le motif se dérive du type FERMÉ de l’origine — administrateur, inactivité, demande' },
    { code: 'compte_purge_inactivite', fichier: 'app/api/cron/purge-inactive/route.ts', bloc: 'async function handle(', motif: /return unauthorized\(\)\s*\}[\s\S]{0,400}?const journal = contexteDeTache\(JOB, piece\)[\s\S]*?purgerInactifs\(admin, journal\)/, quoi: 'inactivité : la pièce du passage naît à l’entrée, avant toute écriture' },
    { code: 'compte_purge_inactivite', fichier: 'app/api/cron/purge-inactive/route.ts', bloc: 'async function purgerInactifs(', motif: /purgeAccount\(admin, u, \{ origine: 'tache_planifiee', job: JOB, journal \}\)/, quoi: 'inactivité : chaque compte est purgé sous la pièce du passage' },
    { code: 'compte_purge_demande', fichier: 'app/api/cron/purge-deletions/route.ts', bloc: 'async function handle(', motif: /return unauthorized\(\)\s*\}[\s\S]{0,400}?const journal = contexteDeTache\(JOB, piece\)[\s\S]*?purger\(admin, journal\)/, quoi: 'demande : la pièce du passage naît à l’entrée, avant toute écriture' },
    { code: 'compte_purge_demande', fichier: 'app/api/cron/purge-deletions/route.ts', bloc: 'async function purger(', motif: /purgeAccount\(admin, u, \{ origine: 'tache_planifiee', job: JOB, journal \}\)/, quoi: 'demande : chaque compte est purgé sous la pièce du passage' },
    { code: 'compte_purge_admin', fichier: 'app/api/admin/user-purge/route.ts', bloc: 'export async function POST(', motif: /requireReauth\(request, auth\.user\.id\)[\s\S]{0,120}?const journal = contexteDepuisAuth\(auth\)[\s\S]*?\{ origine: 'administrateur', journal \}/, quoi: 'administrateur : le contexte naît après la ré-authentification, avant toute écriture' },
    { code: 'inactivite_avertie', fichier: 'app/api/cron/purge-inactive/route.ts', bloc: 'async function constaterAvertissement(', motif: /\.rpc\('constater_avertissement_inactivite', \{\s*\.\.\.parametresJournal\(journal\),\s*p_user_id: u\.id,/, quoi: 'l’écrivain : la RPC qui pose le marqueur ET écrit la ligne' },
    { code: 'inactivite_avertie', fichier: 'app/api/cron/purge-inactive/route.ts', bloc: 'async function purgerInactifs(', motif: (b) => (b.match(/constaterAvertissement\(admin, journal, u, \{ envoye: false, cause: /g) || []).length === 5 && /cause: 'lien_sans_ecosysteme'/.test(b) && (b.match(/constaterAvertissement\(admin, journal, u, \{ envoye: true, demandeEmailId: res\.id \}\)/g) || []).length === 1 && !/\.update\(\{ inactivity_warning_sent_at/.test(b), quoi: 'les SIX issues passent par l’écrivain — parti, origine inconnaissable, adresse de l’écosystème inconstructible (§E.83, `lien_sans_ecosysteme`), sans adresse, refusé, exception ; plus de marquage direct' },
    { code: 'membre_invite', fichier: 'app/api/me/organisation/invitations/route.ts', bloc: 'export async function POST(', motif: (b) => /\.rpc\('creer_invitation',\s*\{\s*\.\.\.parametresJournal\(journal\),\s*p_ecosysteme_id: auth\.domain\.id,\s*p_invitation: \{/.test(b) && !/\.from\('organization_invitations'\)\s*\.insert\(/.test(b), quoi: 'la route crée l’invitation par la RPC métier avec le contexte ; plus d’insertion directe' },
    { code: 'recherche_terminee', fichier: 'lib/ai-budget.ts', bloc: 'export async function enregistrerDepenseIA(', motif: /await signalerPlafondAtteint\([^\n]*\)\s*return \{ cout_usd: cout \}\s*\} catch \(err\) \{[\s\S]*?return \{ cout_usd: null \}/, quoi: 'l’enregistrement REND le coût calculé au tarif (null si tarif manquant ou exception) — un seul calcul, jamais recalculé par l’appelant (§E.13)' },
    // ── §D.27 : chaque route de création de compte fait naître la pièce, pose la question à la base AVANT, puis SIGNE —
    //    le trigger écrit compte_cree ET la ligne sœur sous cette pièce, dans la transaction du compte (PREUVES_SQL). ──
    { code: 'expert_inscrit', fichier: 'app/api/auth/public/register-expert/route.ts', bloc: 'export async function POST(', motif: /const piece = nouvellePiece\(\)[\s\S]*?voie: 'inscription_expert',\s*piece,[\s\S]*?const verdict = await refusInscription\(supabaseAdmin, email, meta\)[\s\S]*?signees = signerPreuveInscription\(email, meta\)[\s\S]*?signUpWithConfirmation\(\{[\s\S]*?metadata: \{ \.\.\.meta, \.\.\.signees \},/, quoi: 'la pièce naît à l’entrée, la base est interrogée AVANT, la preuve signée part dans les métadonnées — le trigger écrit la paire' },
    { code: 'organisation_preinscrite', fichier: 'app/api/auth/register-org/route.ts', bloc: 'export async function POST(', motif: /const piece = nouvellePiece\(\)[\s\S]*?voie: 'preinscription_organisation',\s*piece,[\s\S]*?const verdict = await refusInscription\(supabaseAdmin, email, meta\)[\s\S]*?signees = signerPreuveInscription\(email, meta\)[\s\S]*?signUpWithConfirmation\(\{[\s\S]*?metadata: \{ \.\.\.meta, \.\.\.signees \},/, quoi: 'la pièce naît à l’entrée, la base est interrogée AVANT, la preuve signée part — l’organisation naît dans la transaction du compte' },
    { code: 'invitation_acceptee', fichier: 'app/api/invitations/inscription/route.ts', bloc: 'export async function POST(', motif: /const piece = nouvellePiece\(\)[\s\S]*?voie: 'invitation',\s*piece,[\s\S]*?invitation_id: inv\.id,\s*[\s\S]*?invitation_statuts: INVITATION_MODIFIABLE\.join\(','\),[\s\S]*?const verdict = await refusInscription\(admin, email, meta\)[\s\S]*?signees = signerPreuveInscription\(email, meta\)[\s\S]*?email_confirm: true,\s*user_metadata: \{ \.\.\.meta, \.\.\.signees \},/, quoi: 'l’invité : l’adresse de l’invitation, confirmée d’office, les statuts admis signés — le trigger accepte l’invitation sous la pièce' },
    { code: 'administrateur_cree', fichier: 'app/api/admin/create-admin/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?voie: 'administrateur',\s*piece: journal\.piece,[\s\S]*?acteur_id: auth\.user\.id,[\s\S]*?const verdict = await refusInscription\(auth\.supabaseAdmin, email, meta\)[\s\S]*?signees = signerPreuveInscription\(email, meta\)[\s\S]*?user_metadata: \{ \.\.\.meta, \.\.\.signees \},/, quoi: 'create-admin : la pièce du geste et l’ACTEUR signés — le trigger promeut dans la transaction (AD002 en base)' },
    { code: 'administrateur_cree', fichier: 'scripts/creer-premier-administrateur.mjs', bloc: 'const meta =', motif: /voie: 'administrateur',\s*piece,[\s\S]*?acteur_id: '',/, quoi: 'le jour zéro : la même voie, SANS acteur — la promotion s’écrit en origine système' },
    { code: 'annonce_creee', fichier: 'app/api/publications/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.from\('publications'\)\s*\.insert\([\s\S]*?if \(insertErr \|\| !row\) \{[\s\S]*?\}\s*[\s\S]{0,400}?try \{\s*if \(input\.type === 'sous_traitance'\) \{\s*await journaliserDans\(auth\.supabaseAdmin, journal, \{\s*type: 'sous_traitance_creee',[\s\S]*?\} else \{\s*await journaliserDans\(auth\.supabaseAdmin, journal, \{\s*type: 'annonce_creee',[\s\S]*?code: 'journal_error', publication_id: row\.id/, quoi: 'la pièce naît à l’entrée ; APRÈS l’insertion réussie, chaque type écrit SON code ; un journal qui refuse se dit avec l’identifiant écrit' },
    { code: 'sous_traitance_creee', fichier: 'app/api/publications/route.ts', bloc: 'export async function POST(', motif: /orgId = ensured\.organizationId\s*personnelleCreee = ensured\.created[\s\S]*?detail: \{ organization_id: orgId, organisation_personnelle_creee: personnelleCreee \}/, quoi: 'le besoin dit si l’organisation personnelle est NÉE avec lui (lu dans ensurePersonalOrg, pas supposé)' },
    { code: 'mission_ecartee', fichier: 'app/api/me/missions/[id]/dismiss/route.ts', bloc: 'export async function POST(', motif: (b) => /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.rpc\('ecarter_mission', \{\s*\.\.\.parametresJournal\(journal\),\s*p_publication_id: publicationId,/.test(b) && !/\.from\('matches'\)/.test(b), quoi: 'la route écarte par la RPC, avec la pièce du geste — elle ne touche plus matches elle-même' },
    { code: 'evenement_stripe_rouvert', fichier: 'app/api/admin/facturation/route.ts', bloc: 'export async function POST(', motif: (b) => /const journal = contexteDepuisAuth\(auth\)[\s\S]*?if \(motif\.length < 10\)[\s\S]*?\.rpc\('rouvrir_evenement_stripe', \{\s*\.\.\.parametresJournal\(journal\),/.test(b) && !/\.from\('stripe_events'\)/.test(b), quoi: 'la pièce naît à l’entrée ; le motif exigé AVANT ; la réouverture passe par la fonction, plus d’écriture directe' },
    { code: 'tache_lancee_a_la_main', fichier: 'app/api/admin/cron-jobs/[name]/run/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?if \(body\.confirm !== true\)[\s\S]*?\.rpc\('admin_cron_run_now', \{\s*\.\.\.parametresJournal\(journal\),\s*p_job_name: jobName,\s*\}\)[\s\S]*?if \(row\?\.issue === 'echoue'\)/, quoi: 'la pièce naît à l’entrée ; la confirmation AVANT ; le lancement par la nouvelle signature ; l’échec écrit se dit' },
    { code: 'taxonomie_modifiee', fichier: 'app/api/admin/create-branch/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?const ligne = await taxonomieModifiee\(auth\.supabaseAdmin, journal, \{\s*objet: '(branche|specialite)',\s*operation: 'creee',[\s\S]*?if \(!ligne\.ok\) \{[\s\S]*?code: 'journal_error'/, quoi: 'create-branch : la ligne creee APRÈS l’écriture, sous la pièce du geste ; un journal qui refuse se dit' },
    { code: 'taxonomie_modifiee', fichier: 'app/api/admin/update-branch/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?const ligne = await taxonomieModifiee\(auth\.supabaseAdmin, journal, \{\s*objet: '(branche|specialite)',\s*operation: 'modifiee',[\s\S]*?if \(!ligne\.ok\) \{[\s\S]*?code: 'journal_error'/, quoi: 'update-branch : la ligne modifiee APRÈS l’écriture, sous la pièce du geste ; un journal qui refuse se dit' },
    { code: 'taxonomie_modifiee', fichier: 'app/api/admin/delete-branch/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?const ligne = await taxonomieModifiee\(auth\.supabaseAdmin, journal, \{\s*objet: '(branche|specialite)',\s*operation: 'supprimee',[\s\S]*?if \(!ligne\.ok\) \{[\s\S]*?code: 'journal_error'/, quoi: 'delete-branch : la ligne supprimee APRÈS l’écriture, sous la pièce du geste ; un journal qui refuse se dit' },
    { code: 'taxonomie_modifiee', fichier: 'app/api/admin/create-speciality/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?const ligne = await taxonomieModifiee\(auth\.supabaseAdmin, journal, \{\s*objet: '(branche|specialite)',\s*operation: 'creee',[\s\S]*?if \(!ligne\.ok\) \{[\s\S]*?code: 'journal_error'/, quoi: 'create-speciality : la ligne creee APRÈS l’écriture, sous la pièce du geste ; un journal qui refuse se dit' },
    // Relecture du 02/10/2026 (points 4 et 5) : l'écriture passe par `modifier_specialite` (tout ou rien) ; une ligne refusée
    // n'empêche plus d'avertir les experts, et se dit à la fin (journal_error, ou journal_et_experts).
    { code: 'taxonomie_modifiee', fichier: 'app/api/admin/update-speciality/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.rpc\('modifier_specialite', \{[\s\S]*?const ligne = await taxonomieModifiee\(auth\.supabaseAdmin, journal, \{\s*objet: '(branche|specialite)',\s*operation: 'modifiee',[\s\S]*?if \(!ligne\.ok\) return json\(\{ error: 'Journal failed', code: 'journal_error'/, quoi: 'update-speciality : la ligne modifiee APRÈS l’écriture, sous la pièce du geste ; un journal qui refuse se dit' },
    { code: 'taxonomie_modifiee', fichier: 'app/api/admin/delete-speciality/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?const ligne = await taxonomieModifiee\(auth\.supabaseAdmin, journal, \{\s*objet: '(branche|specialite)',\s*operation: 'supprimee',[\s\S]*?if \(!ligne\.ok\) \{[\s\S]*?code: 'journal_error'/, quoi: 'delete-speciality : la ligne supprimee APRÈS l’écriture, sous la pièce du geste ; un journal qui refuse se dit' },
    { code: 'ecosysteme_cree', fichier: 'app/api/admin/ecosystemes/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.from\('domain_configs'\)\.insert\([\s\S]*?const ligne = await ecosystemeCree\(auth\.supabaseAdmin, journal, \{[\s\S]{0,120}?configurationCreee: !cfgErr,[\s\S]*?code: 'journal_error'[\s\S]*?if \(cfgErr\) \{/, quoi: 'la ligne s’écrit sur les DEUX issues de la configuration, avant de répondre' },
    { code: 'ecosysteme_modifie', fichier: 'app/api/admin/ecosystemes/[id]/route.ts', bloc: 'export async function PATCH(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?champsDomaineChanges = clesModifiees\(domainUpdates,[\s\S]*?\.from\('domains'\)\.update\(domainUpdates\)[\s\S]*?const ligne = champsChanges\.length === 0 && traductionsChangees\.length === 0\s*\? \(\{ ok: true \} as const\)\s*: await ecosystemeModifie\(auth\.supabaseAdmin, journal, \{\s*id,\s*operation: champsDomaineChanges\.includes\('active'\)[\s\S]*?code: 'journal_error'/, quoi: 'PATCH : relu AVANT, écrit APRÈS ; seuls les champs et traductions qui CHANGENT sont nommés, rien sans changement ; l’activation dite comme telle quand l’état change' },
    { code: 'ecosysteme_modifie', fichier: 'app/api/admin/ecosystemes/[id]/visuel/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.update\(\{ \[colonne\]: chemin \}\)[\s\S]*?ecosystemeModifie\(auth\.supabaseAdmin, journal, \{ id, operation: 'visuel_depose', visuel: kind \}\)/, quoi: 'visuel déposé : APRÈS le dépôt et la colonne posée' },
    { code: 'ecosysteme_modifie', fichier: 'app/api/admin/ecosystemes/[id]/visuel/route.ts', bloc: 'export async function DELETE(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.update\(\{ \[colonne\]: null \}\)[\s\S]*?ecosystemeModifie\(auth\.supabaseAdmin, journal, \{ id, operation: 'visuel_retire', visuel: kind \}\)/, quoi: 'visuel retiré : APRÈS le retrait et la colonne vidée' },
    { code: 'organisation_modifiee', fichier: 'app/api/me/organisation/route.ts', bloc: 'export async function PATCH(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?: clesModifiees\(patch as Record<string, unknown>, avantOrg[\s\S]*?\.update\(\{ \.\.\.patch,[\s\S]*?const ligne = champsChanges\.length === 0\s*\? \(\{ ok: true \} as const\)\s*: await organisationModifiee\(auth\.supabaseAdmin, journal, \{\s*organizationId: org\.id,\s*operation: 'modification',\s*champs: champsChanges[\s\S]*?code: 'journal_error'/, quoi: 'PATCH : relu AVANT, écrit APRÈS ; seuls les champs qui CHANGENT sont nommés, rien sans changement' },
    { code: 'organisation_modifiee', fichier: 'app/api/me/organisation/logo/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.update\(\{ logo_url: chemin,[\s\S]*?organisationModifiee\(auth\.supabaseAdmin, journal, \{ organizationId: org\.id, operation: 'logo_depose' \}\)/, quoi: 'logo déposé : APRÈS le dépôt et la colonne posée' },
    { code: 'organisation_modifiee', fichier: 'app/api/me/organisation/logo/route.ts', bloc: 'export async function DELETE(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.update\(\{ logo_url: null,[\s\S]*?organisationModifiee\(auth\.supabaseAdmin, journal, \{ organizationId: org\.id, operation: 'logo_retire' \}\)/, quoi: 'logo retiré : APRÈS le retrait et la colonne vidée' },
    { code: 'identite_modifiee', fichier: 'app/api/me/identity/route.ts', bloc: 'export async function PATCH(', motif: /requireReauth\(request, auth\.user\.id\)[\s\S]{0,200}?const journal = contexteDepuisAuth\(auth\)[\s\S]*?if \(champs\.length === 0\) \{\s*return json\([\s\S]*?inchange: true[\s\S]*?\.update\(\{ first_name, last_name \}\)[\s\S]*?await identiteModifiee\(auth\.supabaseAdmin, journal, \{ userId: auth\.user\.id, champs \}\)[\s\S]*?code: 'journal_error'/, quoi: 'APRÈS la ré-authentification : le nom relu, rien d’écrit s’il ne change pas ; sinon l’écriture PUIS les noms des seuls champs changés' },
    // ── Fusion de la recette S1 (01/10/2026, décisions de Youssef) : la photo déposée, le CV consulté ──
    { code: 'photo_deposee', fichier: 'app/api/profile/photo/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.select\('id, photo_url'\)[\s\S]*?\.upload\(chemin, verdict\.octets, \{ contentType: verdict\.type, upsert: true \}\)[\s\S]*?await photoDeposee\(auth\.supabaseAdmin, journal, \{ profileId: p\.id, remplacement: !!p\.photo_url \}\)[\s\S]*?code: 'journal_error'/, quoi: 'chaque dépôt, remplacement compris, APRÈS le fichier posé : le profil lu avant, le seul fait « remplacement » ; un refus du journal se dit (journal_error)' },
    { code: 'photo_deposee', fichier: 'app/api/profile/route.ts', bloc: 'export async function PATCH(', motif: /!\(k === 'photo_url' && patch\.photo_url != null\)/, quoi: '« Profil modifié » ne nomme plus une photo DÉPOSÉE (elle a sa ligne) ; un retrait de photo (null) y reste' },
    { code: 'cv_consulte', fichier: 'app/api/admin/lien-cv/[id]/route.ts', bloc: 'export async function POST(', motif: (b) => /const journal = contexteDepuisAuth\(auth\)/.test(b) && b.indexOf("if (lien.etat === 'indisponible')") < b.indexOf('await cvConsulte(auth.supabaseAdmin, journal, { profileId: id })') && b.indexOf('await cvConsulte(') < b.indexOf('return json({ url: lien.url') && /code: 'journal_error' \}, 500\)/.test(b), quoi: 'la ligne s’écrit APRÈS la signature et AVANT le lien ; un refus du journal ne rend AUCUN lien ; un CV absent ou un stockage en panne n’écrit rien' },
    { code: 'cv_reinitialise', fichier: 'app/api/profile/cv/reset/route.ts', bloc: 'export async function POST(', motif: /const journal = contexteDepuisAuth\(auth\)[\s\S]*?\.select\('id, cv_file_path, visible'\)[\s\S]*?\.from\(table\)\s*\.delete\(\)[\s\S]*?await cvReinitialise\(supabaseAdmin, journal, \{\s*profileId: profile\.id,\s*retireDeLaVitrine: profile\.visible === true,/, quoi: 'la visibilité LUE avant la remise à zéro ; la ligne APRÈS toutes les écritures' },
  ]
  // La même preuve côté SQL : chaque RPC métier écrit sa table, compte la
  // ligne, PUIS appelle l'écrivain unique — dans sa DERNIÈRE définition.
  const PREUVES_SQL = [
    { fn: 'admin_cron_run_now', code: 'tache_lancee_a_la_main', motif: /errcode = 'AD002';[\s\S]*?pg_try_advisory_xact_lock[\s\S]*?begin\s*execute v_command;\s*exception when others then\s*v_cause := sqlstate;\s*perform public\.journaliser\(\s*p_piece, 'tache_lancee_a_la_main', 'echoue',[\s\S]*?perform public\.journaliser\(\s*p_piece, 'tache_lancee_a_la_main', 'reussi',/, quoi: 'l’administrateur vérifié en base (AD002), le verrou, la commande dans un sous-bloc (échec écrit), puis la ligne réussie' },
    { fn: 'rouvrir_evenement_stripe', code: 'evenement_stripe_rouvert', motif: /where e\.id = p_evenement_id\s*and e\.status = 'received'\s*and e\.received_at < p_limite\s*returning[\s\S]*?if not found then\s*return jsonb_build_object\('issue', 'non_coince'\);\s*end if;\s*perform public\.journaliser\(\s*p_piece, 'evenement_stripe_rouvert', 'reussi',[\s\S]*?public\.identifiant_derive\('stripe_event', v_e\.id\)/, quoi: 'la garde DANS le WHERE ; non coincé n’écrit rien ; le sujet dérivé de l’identifiant Stripe' },
    { fn: 'ecarter_mission', code: 'mission_ecartee', motif: /join public\.profiles p on p\.id = m\.profile_id[\s\S]*?and p\.user_id = p_acteur_id\s*for update of m;\s*if not found then\s*return 'introuvable';[\s\S]*?return 'deja_ecartee';[\s\S]*?update public\.matches m set status = 'dismissed'[\s\S]*?exiger_ecriture\(v_n, 'ecarter_mission : matches'\);[\s\S]*?perform public\.journaliser\(\s*p_piece, 'mission_ecartee', 'reussi',/, quoi: 'le profil de l’ACTEUR, sous verrou ; déjà écartée n’écrit rien ; l’écart compté PUIS journalisé' },
    { fn: 'promouvoir_administrateur', code: 'administrateur_cree', motif: /errcode = 'AD002';[\s\S]*?begin\s*update public\.users u[\s\S]*?if not found then[\s\S]*?errcode = 'AD001';\s*end if;\s*perform public\.journaliser\(\s*p_piece, 'administrateur_cree', 'reussi',[\s\S]*?exception when others then\s*v_cause := sqlstate;\s*perform public\.journaliser\(\s*p_piece, 'administrateur_cree', 'echoue',/, quoi: 'l’acteur vérifié AVANT (AD002, sans ligne) ; succès dans le bloc, échec dans le gestionnaire, même pièce' },
    // ── Phase B, décision A : toute création de compte, par son seul passage obligé ──
    { fn: 'handle_new_user', code: 'compte_cree', motif: /v_refus := public\.preuve_inscription_refus\(new\.email, v_meta\);[\s\S]*?v_refus := public\.inscription_refus\(new\.email, v_meta\);[\s\S]*?returning id into v_miroir;[\s\S]*?if v_miroir is null then\s*return new;\s*end if;[\s\S]*?perform public\.journaliser\(\s*v_piece, 'compte_cree', 'reussi',/, quoi: 'la PREUVE, puis les RÈGLES, avant toute écriture ; la ligne seulement quand le miroir naît ici' },
    { fn: 'handle_new_user', code: 'expert_inscrit', motif: /if v_voie = 'inscription_expert' then\s*perform public\.journaliser\(\s*v_piece, 'expert_inscrit', 'reussi', 'utilisateur',/, quoi: 'la ligne sœur de l’expert, sous la pièce de compte_cree, dans la transaction' },
    { fn: 'handle_new_user', code: 'organisation_preinscrite', motif: /v_org := public\.creer_organisation_avec_admin\([\s\S]*?exception when unique_violation then[\s\S]*?using errcode = 'IN010';\s*end;\s*perform public\.journaliser\(\s*v_piece, 'organisation_preinscrite', 'reussi', 'utilisateur',\s*new\.id, v_user_type, v_domain_id, 'organizations', v_org,/, quoi: 'l’organisation naît AVEC le compte (une course perdue se nomme), puis sa ligne sœur' },
    { fn: 'handle_new_user', code: 'invitation_acceptee', motif: /if not v_confirme then[\s\S]*?v_inv := public\.accepter_invitation\(\s*v_piece, null, 'utilisateur', new\.id,[\s\S]*?if v_inv ->> 'issue' is distinct from 'acceptee' then\s*raise exception/, quoi: 'l’invité confirmé : l’acceptation (qui écrit sa ligne) dans la transaction du compte, ou rien' },
    { fn: 'handle_new_user', code: 'administrateur_cree', motif: /v_promotion := public\.promouvoir_administrateur\([\s\S]*?if v_promotion is distinct from 'reussi' then\s*raise exception [^;]*using errcode = 'AD001';/, quoi: 'l’administrateur promu dans la transaction du compte, ou rien' },
    { fn: 'journaliser_reglage', motif: /if p_statut not in \('reussi', 'echoue'\)[\s\S]*?using errcode = 'GL003'[\s\S]*?return public\.journaliser\(\s*p_piece, 'reglage_modifie', p_statut, 'administrateur'/, quoi: 'l’écrivain unique : reussi ou echoue, jamais refuse' },
    { fn: 'regler_tarif_ia', motif: /update public\.ai_model_tarifs[\s\S]*?get diagnostics v_n = row_count;[\s\S]*?return public\.journaliser_reglage\(/, quoi: 'tarifs : écrit, compté, puis journalisé — même transaction' },
    { fn: 'regler_plafonds_ia', motif: (c) => /update public\.ai_spend_caps/.test(c) && (c.match(/journaliser_reglage\(/g) || []).length === 3 && /p_sujet_plafonds,[\s\S]*?p_sujet_alertes,[\s\S]*?p_sujet_plafonds_acteur,/.test(c), quoi: 'plafonds : trois familles, trois lignes, trois sujets distincts' },
    { fn: 'regler_quota_ia', motif: /update public\.ai_quotas[\s\S]*?get diagnostics v_n = row_count;[\s\S]*?return public\.journaliser_reglage\(/, quoi: 'quota : écrit, compté, puis journalisé' },
    { fn: 'regler_matching', motif: /update public\.matching_settings[\s\S]*?get diagnostics v_n = row_count;[\s\S]*?return public\.journaliser_reglage\(\s*p_piece, p_acteur_id, p_domain_id/, quoi: 'moteur : écrit, compté, puis journalisé — sur l’écosystème du réglage' },
    { fn: 'regler_note_jugement', motif: /update public\.verification_providers[\s\S]*?get diagnostics v_n = row_count;[\s\S]*?return public\.journaliser_reglage\(/, quoi: 'notes : écrit, compté, puis journalisé' },
    { fn: 'set_default_package', motif: /invariant_broken[\s\S]*?perform public\.journaliser_reglage\([\s\S]*?'packages_default', public\.identifiant_derive\('reglage', 'packages_default:' \|\| v_target\)/, quoi: 'défaut : vérifié PUIS journalisé, sur le défaut de la cible — pas sur l’offre' },
    { fn: 'enregistrer_paiement', code: 'paiement_recu', motif: /on conflict \(stripe_invoice_id\) where stripe_invoice_id is not null do nothing\s+returning id into v_id;[\s\S]*?if v_id is null then\s+return null;[\s\S]*?perform public\.journaliser\(\s*p_piece, 'paiement_recu', 'reussi', 'systeme',\s*null::uuid, null::text, v_t\.domain_id,\s*'organizations', v_t\.organization_id,/, quoi: 'la pièce comptable est insérée (doublon : rien, ni ligne), PUIS journalisée sur l’organisation — même transaction' },
    { fn: 'inserer_candidature_jugee', code: 'candidature_deposee', motif: /on conflict \(publication_id, profile_id\) do nothing[\s\S]*?if v_id is null then[\s\S]*?delete from public\.candidature_depots[\s\S]*?return null;[\s\S]*?update public\.candidature_depots[\s\S]*?set etat\s*=\s*'depose'[\s\S]*?select p\.type into v_type from public\.publications p where p\.id = v_c\.publication_id;\s*perform public\.journaliser\(\s*p_piece,\s*case when v_type = 'sous_traitance' then 'sous_traitance_candidature' else 'candidature_deposee' end,\s*'reussi', p_origine,\s*p_acteur_id, p_acteur_type, v_c\.domain_id,\s*'candidatures', v_id,[\s\S]*?p_piece_origine/, quoi: 'la candidature est insérée (concurrente : rien, ligne du dépôt retirée), le journal du dépôt soldé, PUIS la ligne écrite avec la pièce d’origine — même transaction' },
    { fn: 'ouvrir_depot_candidature', code: 'candidature_deposee', motif: /p_piece\s+uuid[\s\S]*?raise exception 'ouvrir_depot_candidature : la piece est obligatoire' using errcode = 'GL002'[\s\S]*?piece\s*=\s*excluded\.piece/, quoi: 'le journal du dépôt exige la pièce et la pose, à l’ouverture comme à la relance' },
    { fn: 'solder_depot_en_echec', code: 'refus_depot_sans_jugement', motif: /set etat\s*=\s*'echec'[\s\S]*?returning d\.id, d\.tentatives, d\.domain_id[\s\S]*?perform public\.journaliser\(\s*p_piece, 'refus_depot_sans_jugement', 'refuse', p_origine,\s*p_acteur_id, p_acteur_type, v_domaine,[\s\S]*?'cause', p_cause,[\s\S]*?p_piece_origine/, quoi: 'le journal du dépôt est soldé en échec PUIS le refus écrit, au statut imposé, avec la cause fermée et la pièce d’origine — même transaction' },
    { fn: 'decliner_candidature', code: 'candidature_declinee', motif: /set status\s*=\s*'rejected'[\s\S]*?and c\.domain_id = p_domain_id\s*and c\.status = any \(p_statuts_admis\)\s*and exists \(select 1 from public\.publications p\s*where p\.id = c\.publication_id and p\.organization_id = p_organization_id\)[\s\S]*?if v_publication is null then[\s\S]*?return false;[\s\S]*?perform public\.journaliser\(\s*p_piece, 'candidature_declinee', 'reussi', p_origine,/, quoi: 'transition, cloisonnement et propriété rejoués dans l’UPDATE ; zéro ligne rend false sans journaliser ; PUIS la ligne — même transaction' },
    { fn: 'retenir_candidature', code: 'candidature_retenue', motif: /set status\s*=\s*'selected',\s*selected_at = now\(\)[\s\S]*?and c\.domain_id = p_domain_id\s*and c\.status = any \(p_statuts_admis\)\s*and exists \(select 1 from public\.publications p\s*where p\.id = c\.publication_id and p\.organization_id = p_organization_id\)[\s\S]*?if v_selected_at is null then[\s\S]*?return null;[\s\S]*?perform public\.journaliser\(\s*p_piece, 'candidature_retenue', 'reussi', p_origine,[\s\S]*?return v_selected_at;/, quoi: 'transition, cloisonnement et propriété rejoués dans l’UPDATE ; zéro ligne rend null sans journaliser ; PUIS la ligne, et selected_at rendu — même transaction' },
    { fn: 'publier_annonce', code: 'annonce_publiee', motif: /update public\.publications p[\s\S]*?published_at\s*=\s*case when p_verdict = 'published' then now\(\) else p\.published_at end[\s\S]*?and p\.organization_id = p_organization_id\s*and p\.status = any \(p_statuts_admis\)[\s\S]*?if not found then\s*return null;[\s\S]*?if p_verdict = 'published' then\s*perform public\.journaliser\(\s*p_piece,\s*case when v_p\.type = 'sous_traitance' then 'sous_traitance_publiee' else 'annonce_publiee' end,\s*'reussi', p_origine,/, quoi: 'transition rejouée dans l’UPDATE, published_at posé par la base, zéro ligne rend null, ligne SEULEMENT si publiée — même transaction' },
    { fn: 'cloturer_annonce', code: 'annonce_depubliee', motif: /select p\.status into v_de[\s\S]*?for update;\s*if not found or not \(v_de = any \(p_statuts_admis\)\) then\s*return false;[\s\S]*?update public\.publications p\s*set status = 'archived'[\s\S]*?and p\.status = v_de;\s*get diagnostics v_n = row_count;[\s\S]{0,300}?perform public\.exiger_ecriture\(v_n,[\s\S]*?perform public\.journaliser\(\s*p_piece, 'annonce_depubliee', 'reussi', p_origine,[\s\S]*?'de', v_de, 'vers', 'archived'/, quoi: 'statut d’origine lu sous verrou et jugé contre les statuts admis de la ROUTE (aucun littéral de statut ici), transition rejouée, zéro ligne sous verrou LÈVE EC001 (une anomalie n’est pas un rejeu, §E.74), PUIS la ligne — même transaction' },
    { fn: 'constater_annonces_expirees', code: 'annonce_expiree', motif: /where p\.expiration_constatee_at is null\s*and p\.published_at is not null\s*and p\.status = 'published'\s*and not public\.annonce_active\(p\.status, p\.expires_at, p\.published_at, p_vie_annonce_jours\)[\s\S]*?for update skip locked[\s\S]*?set expiration_constatee_at = now\(\)[\s\S]*?perform public\.journaliser\(\s*p_piece, 'annonce_expiree', 'reussi', 'tache_planifiee',\s*null::uuid, null::text, r\.domain_id,\s*'publications', r\.id,/, quoi: 'jamais constatée, publiée, et plus active selon la SEULE règle du schéma (annonce_active) ; marqueur PUIS ligne, même transaction, sous verrou' },
    { fn: 'constater_devoilement_ferme', code: 'devoilement_ferme', motif: /if p_fin_echange is null or p_fin_echange > now\(\) then[\s\S]*?update public\.candidatures c\s*set fermeture_constatee_at = now\(\)\s*where c\.id = p_candidature_id\s*and c\.fermeture_constatee_at is null\s*and c\.status = p_statut_lu\s*returning[\s\S]*?if not found then[\s\S]*?return 'introuvable';[\s\S]*?then 'deja' else 'change' end;\s*end if;\s*if p_fin_echange < v_depuis then\s*return 'passif';\s*end if;\s*perform public\.journaliser\(\s*p_piece, 'devoilement_ferme', 'reussi', 'tache_planifiee',/, quoi: 'LE PASSIF (fin antérieure à la mise en service) pose le marqueur SANS ligne — aucune ligne rétroactive ; une fin d’échange future est refusée ; le statut jugé par la TÂCHE est comparé, jamais redéfini (T.5 : aucune seconde définition de « refermé ») — zéro ligne dit laquelle des raisons (déjà · changé · introuvable) ; marqueur PUIS la ligne — même transaction' },
    { fn: 'changer_statut_compte', code: 'compte_suspendu', motif: /select u\.id, u\.status, u\.domain_id, u\.user_type[\s\S]*?for update;\s*if not found then\s*return null;\s*end if;[\s\S]*?if v_u\.id = p_acteur_id then\s*return jsonb_build_object\('refus', 'self_forbidden'\);\s*end if;\s*if v_u\.user_type = 'admin' then\s*return jsonb_build_object\('refus', 'target_is_admin'\);\s*end if;\s*if not \(v_u\.status = any \(p_statuts_admis\)\) then\s*return null;[\s\S]*?update public\.users u\s*set status = p_nouveau_statut,[\s\S]*?perform public\.journaliser\(\s*p_piece,\s*case when p_suspend then 'compte_suspendu' else 'compte_reactive' end,\s*'reussi', p_origine,\s*p_acteur_id, p_acteur_type, v_u\.domain_id,/, quoi: 'verrou de ligne, transition rejouée (zéro ligne rend null), bascule PUIS ligne dont le CODE est dérivé du geste — même transaction, écosystème de la cible' },
    { fn: 'journaliser_verification', code: 'compte_valide', motif: /return public\.journaliser\(\s*p_piece,\s*case when p_approuve then 'compte_valide' else 'compte_refuse' end,\s*'reussi', p_origine,/, quoi: 'l’écrivain UNIQUE des deux codes, qui les DÉRIVE du verdict — la forme de journaliser_reglage()' },
    { fn: 'statuer_sur_expert', code: 'compte_valide', motif: /for update;\s*if not found or v_p\.verification_status is distinct from p_statut_admis then\s*return null;[\s\S]*?update public\.profiles p[\s\S]*?update public\.users u\s*set is_verified = p_approuve[\s\S]*?perform public\.journaliser_verification\(/, quoi: 'expert : statut relu sous verrou et rejoué, profil ET drapeau du compte écrits, PUIS l’écrivain — même transaction' },
    { fn: 'statuer_sur_organisation', code: 'compte_valide', motif: /for update;\s*if not found or v_o\.verification_status is distinct from p_statut_admis then\s*return null;[\s\S]*?is_verified   = p_approuve,[\s\S]*?perform public\.journaliser_verification\([\s\S]{0,200}?null::uuid, 'organizations',/, quoi: 'organisation : même forme, invariant is_verified dans la même instruction, ligne SANS écosystème (une organisation en rejoint plusieurs)' },
    { fn: 'programmer_suppression_compte', code: 'suppression_programmee', motif: /if not found then\s*return 'introuvable';[\s\S]*?liberer_siege_plateforme[\s\S]*?exception when foreign_key_violation then[\s\S]*?return 'dernier_admin';\s*end;\s*perform public\.journaliser\(\s*p_piece, 'suppression_programmee', 'reussi', p_origine,/, quoi: 'les deux refus (introuvable, dernier administrateur) rendent SANS écrire de ligne ; le siège est transféré, le jalon posé, PUIS la ligne — même transaction' },
    { fn: 'verifier_telephone', code: 'telephone_verifie', motif: /update public\.users u\s*set phone_verified = true,\s*phone          = p_phone\s*where u\.id = p_user_id\s*returning u\.domain_id into v_domaine;\s*if not found then\s*return false;[\s\S]*?perform public\.journaliser\(\s*p_piece, 'telephone_verifie', 'reussi', p_origine,[\s\S]{0,200}?jsonb_build_object\('methode', p_methode\)/, quoi: 'drapeau et numéro écrits sur le COMPTE, zéro ligne rend false, PUIS la ligne — qui ne porte que la méthode' },
    { fn: 'revoquer_invitation', code: 'invitation_revoquee', motif: /where i\.id = p_invitation_id\s*and i\.organization_id = p_organization_id\s*for update;\s*if not found or not \(v_i\.status = any \(p_statuts_admis\)\) then\s*return false;[\s\S]*?set status = 'revoked',[\s\S]*?perform public\.journaliser\(\s*p_piece, 'invitation_revoquee', 'reussi', p_origine,/, quoi: 'appartenance ET transition rejouées SOUS VERROU — une invitation d’une autre organisation est introuvable — zéro ligne rend false, PUIS la ligne' },
    { fn: 'renvoyer_invitation', code: 'invitation_renvoyee', motif: /where i\.id = p_invitation_id\s*and i\.organization_id = p_organization_id\s*for update;\s*if not found or not \(v_i\.status = any \(p_statuts_admis\)\) then\s*return false;[\s\S]*?set token\s*= p_token,\s*expires_at = p_expires_at,[\s\S]*?perform public\.journaliser\(\s*p_piece, 'invitation_renvoyee', 'reussi', p_origine,[\s\S]{0,200}?jsonb_build_object\('role_in_org', v_i\.role_in_org, 'expires_at', p_expires_at\)/, quoi: 'appartenance ET transition rejouées SOUS VERROU, jeton et échéance écrits, PUIS la ligne — rôle et échéance, jamais le jeton' },
    { fn: 'accepter_invitation', code: 'invitation_acceptee', motif: /where i\.id = p_invitation_id\s*for update;\s*if not found then\s*return jsonb_build_object\('issue', 'introuvable'\);\s*end if;\s*if not \(v_i\.status = any \(p_statuts_admis\)\) then[\s\S]*?if v_i\.expires_at <= now\(\) then[\s\S]*?from public\.users u where u\.id = p_acteur_id;[\s\S]*?lower\(btrim\(v_u\.email\)\) <> lower\(btrim\(v_i\.email\)\)[\s\S]*?and m\.user_id = p_acteur_id\s*for update;[\s\S]*?set status\s*= 'accepted',[\s\S]*?perform public\.journaliser\(\s*p_piece, 'invitation_acceptee', 'reussi', p_origine,[\s\S]*?jsonb_build_object\(\s*'organization_id', v_i\.organization_id,\s*'role_in_org', v_i\.role_in_org,\s*'deja_membre', v_deja,\s*'reintegre', v_reintegre\)/, quoi: 'invitation VERROUILLÉE ; statut, échéance et adresse (LUE sur le compte) rejoués dessous ; appartenance verrouillée, écrite, invitation soldée, PUIS la ligne — sans adresse' },
    { fn: 'maj_membre_organisation', code: 'membre_parti', motif: /where m\.id = p_membre_id\s*for update;[\s\S]*?return 'inchange';\s*end if;\s*if v_statut_cible = 'removed' and v_statut <> 'removed' then\s*v_geste := case when v_user = p_acteur_id then 'parti' else 'retire' end;\s*elsif v_statut_cible = v_statut and v_role_cible <> v_role then\s*v_geste := 'role';\s*else\s*raise exception[\s\S]*?using errcode = '22023';[\s\S]*?update public\.organization_members\s*set role_in_org = v_role_cible,[\s\S]*?return 'dernier_admin';\s*end;\s*perform public\.journaliser\(\s*p_piece,\s*case v_geste when 'parti' then 'membre_parti' when 'retire' then 'membre_retire' else 'role_membre_change' end,/, quoi: 'la ligne du membre est VERROUILLÉE ; le geste est DÉRIVÉ avant toute écriture (sa propre ligne = départ), un changement sans action est REFUSÉ (22023) ; l’écriture PUIS la ligne — les refus n’écrivent rien' },
    { fn: 'publier_annonce', code: 'sous_traitance_publiee', motif: /returning p\.id, p\.type, p\.status, p\.published_at into v_p;[\s\S]*?case when v_p\.type = 'sous_traitance' then 'sous_traitance_publiee' else 'annonce_publiee' end/, quoi: 'une sous-traitance publiée s’écrit sous SON nom — le type est lu dans l’UPDATE même, jamais reçu' },
    { fn: 'inserer_candidature_jugee', code: 'sous_traitance_candidature', motif: /select p\.type into v_type from public\.publications p where p\.id = v_c\.publication_id;\s*perform public\.journaliser\(\s*p_piece,\s*case when v_type = 'sous_traitance' then 'sous_traitance_candidature' else 'candidature_deposee' end,/, quoi: 'une candidature à une sous-traitance s’écrit sous SON nom — le type de la publication est LU par la fonction' },
    { fn: 'envoyer_message', code: 'devoilement_ouvert', motif: (c) => /where c\.id = p_conversation_id\s*for update;[\s\S]*?if not \(v_c\.status = any \(p_statuts_admis\)\) then\s*return jsonb_build_object\('issue', 'fermee'\);[\s\S]*?insert into public\.messages[\s\S]*?update public\.conversations c\s*set last_message_at = v_m\.created_at/.test(c) && !/journaliser\(/.test(c.replace(/--[^\n]*/g, '')), quoi: 'fil VERROUILLÉ, statut rejoué contre les statuts reçus ; le message et la date du fil — et PLUS de ligne (ARRÊT 22, message_envoye retirée)' },
    { fn: 'anonymiser_compte', code: 'compte_purge_admin', motif: /if p_motif is null or p_motif not in \('inactivite', 'demande', 'admin'\) then\s*raise exception[\s\S]*?using errcode = '22023';[\s\S]*?set email\s*= p_email_substitut,[\s\S]*?anonymized_at\s*= now\(\)\s*where u\.id = p_user_id\s*and u\.anonymized_at is null\s*returning u\.domain_id into v_domaine;\s*if not found then\s*return false;\s*end if;\s*perform public\.journaliser\(\s*p_piece,\s*case p_motif when 'inactivite' then 'compte_purge_inactivite'\s*when 'demande'\s*then 'compte_purge_demande'\s*else\s*'compte_purge_admin' end,/, quoi: 'le motif est validé AVANT d’écrire ; le jalon est sa propre garde (déjà purgé : false, rien) ; le jalon PUIS la ligne, le code dérivé du motif — trois purges, un écrivain' },
    { fn: 'constater_avertissement_inactivite', code: 'inactivite_avertie', motif: /if p_envoye is null or \(not p_envoye and p_cause is null\) then[\s\S]*?if p_envoye then\s*update public\.users u\s*set inactivity_warning_sent_at = now\(\)[\s\S]*?perform public\.journaliser\(\s*p_piece, 'inactivite_avertie',\s*case when p_envoye then 'reussi' else 'echoue' end,/, quoi: 'un échec porte sa cause ; parti : le marqueur PUIS la ligne réussie ; sinon la ligne échouée, sans marqueur' },
    { fn: 'creer_invitation', code: 'membre_invite', motif: /insert into public\.organization_invitations[\s\S]*?returning id, email, role_in_org[\s\S]*?perform public\.journaliser\(\s*p_piece, 'membre_invite', 'reussi', p_origine,[\s\S]*?jsonb_build_object\(\s*'role_in_org', v_i\.role_in_org,\s*'domain_validation_passed', v_i\.domain_validation_passed,\s*'email_already_exists', v_i\.email_already_exists\)/, quoi: 'l’invitation est insérée PUIS journalisée — même transaction — et la ligne ne porte que le rôle et les deux faits, jamais l’adresse ni le jeton' },
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
  // ── LES CHEMINS SONT UN ENSEMBLE (défaut trouvé par le premier rejeu local, 26/09/2026) ──
  //  La première version émettait un chemin par ÉLÉMENT de tableau : `l[].x` deux
  //  fois pour deux objets, et le refus GL004 nommait une clé fautive autant de fois
  //  qu'elle se répétait. La propriété : la DERNIÈRE définition rend des chemins
  //  DISTINCTS, dans un ordre qui ne dépend pas de la collation du serveur ; la
  //  postcondition compare en collation "C" et sonde le nom UNIQUE dans GL004.
  {
    const chemins = derniereDefinition('public.grand_livre_chemins(').corps
    ok(/select distinct\b/.test(chemins) && /collate "C"/.test(chemins) && /order by/.test(chemins),
      'les chemins d’un détail sont un ENSEMBLE : distincts, dans un ordre stable (collation "C")',
      'un tableau de deux objets a UN chemin l[].x, pas deux — la liste blanche est un ensemble')
    ok((postB.match(/array_agg\(c order by c collate "C"\)/g) || []).length >= 2 && !/array_agg\(c order by c\)/.test(postB),
      'la postcondition compare les chemins triés en collation "C" — jamais selon celle du serveur')
    ok(/"l":\[\{"courriel":"a"\},\{"courriel":"b"\}\][\s\S]{0,400}?when sqlstate 'GL004'[\s\S]{0,300}?<> 1 then/.test(postB),
      'une clé fautive RÉPÉTÉE dans un tableau est nommée UNE fois par GL004 (sonde exécutée)')
  }
  // ── UNE SONDE GL003 NE PROUVE QUE CE QUE LA BASE IMPOSE (défaut trouvé en relisant, 26/09/2026) ──
  //  `recherche_lancee` n'imposait aucun statut, et sa postcondition attendait GL003
  //  sur « refuse » : l'écriture aurait été ACCEPTÉE, la migration arrêtée. Classe :
  //  toute sonde qui attend GL003 d'un appel DIRECT à journaliser() vise une action
  //  dont le statut imposé — seed du socle, puis toute mise à jour — est CONTRAIRE.
  {
    const impose = new Map()
    // Le statut imposé : TOUTES les insertions dans la liste fermée (le socle, puis les actions
    // ajoutées par migration), puis toute mise à jour — jamais le seul seed du socle (§E.61).
    for (const f of TOUTES_MIGRATIONS) {
      const src = SQL_PAR_MIGRATION.get(f)
      const i = src.indexOf('insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values')
      if (i < 0) continue
      const seed = src.slice(i, src.indexOf('on conflict (code)', i))
      for (const m of seed.matchAll(/\(\s*'([a-z0-9_]+)',\s*'[a-z]+',\s*(null|'[a-z]+'),/g)) impose.set(m[1], m[2] === 'null' ? null : m[2].slice(1, -1))
    }
    for (const f of TOUTES_MIGRATIONS) {
      for (const m of SQL_PAR_MIGRATION.get(f).matchAll(/set statut_impose\s*=\s*(null|'[a-z]+')\s+where code = '([a-z0-9_]+)'/g)) impose.set(m[2], m[1] === 'null' ? null : m[1].slice(1, -1))
    }
    const fautes = []
    let sondes = 0
    for (const f of TOUTES_MIGRATIONS) {
      const src = SQL_PAR_MIGRATION.get(f)
      const post = src.slice(Math.max(0, src.indexOf('do $post$')))
      for (const m of post.matchAll(/journaliser\(\s*[^,]+,\s*'([a-z0-9_]+)',\s*'([a-z]+)'[\s\S]{0,700}?when sqlstate '([A-Z0-9]+)'/g)) {
        if (m[3] !== 'GL003') continue
        sondes++
        // Une action HORS de la liste fermée : la sonde prouve le refus du TYPE
        // (GL003 « type inconnu »), pas un statut imposé — légitime.
        if (!impose.has(m[1]) && !codesSqlGlobal.has(m[1])) continue
        const i = impose.get(m[1])
        if (!i || i === m[2]) fautes.push(`${f} : ${m[1]} envoyé « ${m[2]} », imposé ${i ? `« ${i} »` : 'RIEN'}`)
      }
    }
    ok(sondes >= 4 && fautes.length === 0,
      `toute sonde GL003 vise une action qui IMPOSE un statut contraire (${sondes} sonde(s) balayée(s))`,
      fautes.join('\n         ') || undefined)
  }
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
  ok(/journaliser\(gen_random_uuid\(\), 'refus_expert_inapte', 'refuse', 'systeme',[\s\S]{0,300}?jsonb_build_object\('raison', 'ne_pas_deranger', 'publication_id', gen_random_uuid\(\)\)[\s\S]{0,400}?raise exception 'SONDE_ANNULEE'/.test(postI),
    'expert inapte : la forme exacte que le code envoie est ÉCRITE au statut imposé, puis annulée')
  ok(/"message":"texte libre"[\s\S]{0,300}?when sqlstate 'GL004'/.test(postI), 'expert inapte : un texte libre est REFUSÉ (sonde exécutée)')
  // Les refus de garde : même forme.
  const GARDE = stripSql(read(migration('journal_refus_garde_eligibilite')))
  const iPostG = GARDE.indexOf('do $post$')
  const postG = iPostG < 0 ? '' : GARDE.slice(iPostG)
  ok(/journaliser\(gen_random_uuid\(\), 'refus_garde_eligibilite', 'refuse', 'systeme',[\s\S]{0,300}?jsonb_build_object\('code', 'already_applied', 'profile_id', gen_random_uuid\(\)\)[\s\S]{0,400}?raise exception 'SONDE_ANNULEE'/.test(postG),
    'refus de garde : la forme exacte que le code envoie est ÉCRITE au statut imposé, puis annulée')
  ok(/"message":"texte libre"[\s\S]{0,300}?when sqlstate 'GL004'/.test(postG), 'refus de garde : un texte libre est REFUSÉ (sonde exécutée)')
  // Le quota de CV : même forme.
  const QUOTA = stripSql(read(migration('journal_refus_quota_cv')))
  const iPostQ = QUOTA.indexOf('do $post$')
  const postQ = iPostQ < 0 ? '' : QUOTA.slice(iPostQ)
  ok(/journaliser\(gen_random_uuid\(\), 'refus_quota_cv', 'refuse', 'systeme',[\s\S]{0,300}?jsonb_build_object\('quota', 'cv_parsing', 'limite', 3, 'fenetre_heures', 24, 'reset_at', now\(\), 'compte', 3\)[\s\S]{0,400}?raise exception 'SONDE_ANNULEE'/.test(postQ),
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
  {
    const MODIFIEE = stripSql(read(migration('journal_annonce_modifiee')))
    const P = MODIFIEE.slice(Math.max(0, MODIFIEE.indexOf('do $post$')))
    ok(/journaliser\(gen_random_uuid\(\), 'annonce_modifiee', 'reussi', 'systeme',[\s\S]{0,300}?jsonb_build_object\('champs', jsonb_build_array\('title', 'skills_required'\), 'statut_annonce', 'draft', 'organization_id', gen_random_uuid\(\)\)[\s\S]{0,400}?raise exception 'SONDE_ANNULEE'/.test(P),
      'modifiée : la forme exacte que la route envoie (noms de champs) est ÉCRITE, puis annulée')
    ok(/"champs":\["title"\],"title":"texte libre"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'modifiée : le CONTENU d’un champ est REFUSÉ (sonde exécutée)')
  }
  {
    const DEPUB = stripSql(read(migration('journal_annonce_depubliee')))
    const P = DEPUB.slice(Math.max(0, DEPUB.indexOf('do $post$')))
    ok(/to_regprocedure\('public\.cloturer_annonce\(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text\[\]\)'\) is null/.test(P), 'dépubliée : la signature est vérifiée par TYPES')
  }
  {
    const EXPIREE = stripSql(read(migration('journal_annonce_expiree')))
    const P = EXPIREE.slice(Math.max(0, EXPIREE.indexOf('do $post$')))
    ok(/to_regprocedure\('public\.constater_annonces_expirees\(uuid, integer, integer\)'\) is null/.test(P), 'expirée : la signature est vérifiée par TYPES')
    ok(/information_schema\.columns[\s\S]{0,200}?column_name = 'expiration_constatee_at'/.test(P) && /relname = 'publications_expiration_a_constater_idx' and i\.indpred is not null/.test(P),
      'expirée : la colonne-marqueur et l’index PARTIEL de la file sont INTERROGÉS (pg_index, pas un IF NOT EXISTS — §E.60)')
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
    ok(/journaliser\(gen_random_uuid\(\), 'cv_televerse', 'reussi', 'systeme',[\s\S]{0,300}?jsonb_build_object\('octets', \d+, 'analyse', 'done', 'premier_consentement', true, 'experiences', \d+, 'formations', \d+, 'langues', \d+\)[\s\S]{0,800}?journaliser\(gen_random_uuid\(\), 'cv_televerse', 'echoue', 'systeme',[\s\S]{0,300}?jsonb_build_object\('octets', \d+, 'analyse', 'failed', 'premier_consentement', false\)[\s\S]{0,600}?raise exception 'SONDE_ANNULEE'/.test(P),
      'CV : les deux formes que le module écrit (analyse faite, en échec) sont ÉCRITES, puis annulées')
    ok(/"cv_hash"|"hash"/.test(P) && /when sqlstate 'GL004'/.test(P), 'CV : l’empreinte du fichier est REFUSÉE par la liste blanche (sonde exécutée)')
  }
  {
    const PUBLIE = stripSql(read(migration('journal_profil_publie')))
    const P = PUBLIE.slice(Math.max(0, PUBLIE.indexOf('do $post$')))
    ok(/journaliser\(gen_random_uuid\(\), 'profil_publie', 'reussi', 'systeme',[\s\S]{0,300}?jsonb_build_object\('deja_visible', false, 'verification_avant', null\)[\s\S]{0,700}?jsonb_build_object\('deja_visible', true, 'verification_avant', 'approved'\)[\s\S]{0,600}?raise exception 'SONDE_ANNULEE'/.test(P),
      'profil publié : la première publication (sans vérification d’avant) et la republication sont ÉCRITES, puis annulées')
    ok(/"title":"texte libre"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'profil publié : un champ du profil est REFUSÉ (sonde exécutée)')
  }
  {
    const MODIF = stripSql(read(migration('journal_profil_modifie')))
    const P = MODIF.slice(Math.max(0, MODIF.indexOf('do $post$')))
    ok(/journaliser\(gen_random_uuid\(\), 'profil_modifie', 'reussi', 'systeme',[\s\S]{0,300}?jsonb_build_object\('champs', jsonb_build_array\('title', 'skills'\), 'blocs', jsonb_build_array\('experiences'\)\)[\s\S]{0,500}?raise exception 'SONDE_ANNULEE'/.test(P),
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
    ok(/to_regprocedure\('public\.constater_devoilement_ferme\(uuid, uuid, timestamptz, text\)'\) is null\s*or to_regprocedure\('public\.constater_devoilement_ferme\(uuid, uuid, timestamptz\)'\) is not null/.test(P),
      'dévoilement fermé : la signature est vérifiée par TYPES — la nouvelle présente, l’ancienne absente')
    // UNE RÈGLE, UNE DÉFINITION (T.5) : aucun littéral de statut de candidature dans le corps de la
    // fonction — la règle « quels statuts referment » ne vit que dans deriveCandidatureLifecycle.
    {
      const corps = FERME.slice(FERME.indexOf('create or replace function public.constater_devoilement_ferme('), FERME.indexOf('$fn$;', FERME.indexOf('create or replace function public.constater_devoilement_ferme(')))
      ok(corps.length > 0 && !/'(unlocked|selected|received|in_review|shortlisted|rejected|withdrawn|archived)'/.test(corps),
        'dévoilement fermé : aucun statut de candidature écrit en dur dans la fonction — une règle, une définition')
    }
    ok(/column_name = 'fermeture_constatee_at'/.test(P) && /relname = 'candidatures_fermeture_a_constater_idx' and i\.indpred is not null/.test(P), 'dévoilement fermé : la colonne-marqueur et l’index PARTIEL sont INTERROGÉS (§E.60)')
    ok(/create table if not exists public\.constats_mise_en_service/.test(FERME) && /insert into public\.constats_mise_en_service \(constat\) values \('devoilement_ferme'\)/.test(FERME)
      && /date de mise en service du constat manque/.test(P),
      'dévoilement fermé : la date de MISE EN SERVICE est posée par la migration (par environnement) et relue par la postcondition')
    // Le passif des ANNONCES : marqué par la migration, par la source SQL de la règle, sans ligne.
    const EXP = stripSql(read(migration('journal_annonce_expiree')))
    const iPassif = EXP.indexOf('do $passif$')
    ok(iPassif >= 0 && iPassif < EXP.indexOf('cron.schedule(') && iPassif < EXP.indexOf('do $post$')
      && /set expiration_constatee_at = now\(\)[\s\S]*?not public\.annonce_active\(p\.status, p\.expires_at, p\.published_at, v_vie\)/.test(EXP.slice(iPassif))
      && !/journaliser\(/.test(EXP.slice(iPassif, EXP.indexOf('$passif$;', iPassif))),
      'annonces expirées : le PASSIF est marqué par la migration AVANT la planification, par annonce_active() (la source SQL), SANS aucune ligne au grand livre')
    ok(/now\(\) \+ interval '1 day', 'unlocked'\);[\s\S]{0,200}?when sqlstate '22023'/.test(P), 'dévoilement fermé : une fin d’échange FUTURE est refusée (sonde exécutée)')
    ok(/"message":"texte libre"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'dévoilement fermé : un texte libre est REFUSÉ (sonde exécutée)')
  }
  {
    const SUSP = stripSql(read(migration('journal_compte_suspendu')))
    const P = SUSP.slice(Math.max(0, SUSP.indexOf('do $post$')))
    ok(/to_regprocedure\('public\.changer_statut_compte\(uuid, uuid, text, uuid, text, uuid, text\[\], text, boolean\)'\) is null/.test(P), 'suspension : la signature est vérifiée par TYPES')
    ok(/"email":"qui@exemple\.fr"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'suspension : une adresse est REFUSÉE (sonde exécutée)')
  }
  {
    const VALID = stripSql(read(migration('journal_compte_valide')))
    const P = VALID.slice(Math.max(0, VALID.indexOf('do $post$')))
    ok(/to_regprocedure\('public\.journaliser_verification\(uuid, uuid, text, uuid, text, uuid, text, uuid, boolean, jsonb\)'\) is null/.test(P)
      && /to_regprocedure\('public\.statuer_sur_expert\(uuid, uuid, text, uuid, text, uuid, text, boolean, text\)'\) is null/.test(P)
      && /to_regprocedure\('public\.statuer_sur_organisation\(uuid, uuid, text, uuid, text, uuid, text, boolean, text\)'\) is null/.test(P),
      'arbitrage : les TROIS signatures sont vérifiées par TYPES')
    ok(/"review_reason":"texte libre"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'arbitrage : le motif en texte libre est REFUSÉ (sonde exécutée)')
  }
  {
    const SESS = stripSql(read(migration('journal_session_revoquee')))
    const P = SESS.slice(Math.max(0, SESS.indexOf('do $post$')))
    ok(/array_length\(v_cles, 1\) is not null then\s*\n?\s*raise exception 'postcondition NON TENUE : session_revoquee devrait avoir une liste blanche VIDE/.test(P),
      'session : la liste blanche est VÉRIFIÉE VIDE — une liste vide refuse tout, c’est la garde')
    ok(/journaliser\(gen_random_uuid\(\), 'session_revoquee', 'reussi', 'utilisateur',[\s\S]{0,300}?'\{\}'::jsonb[\s\S]{0,400}?raise exception 'SONDE_ANNULEE'/.test(P),
      'session : la forme exacte du module (aucun détail) est ÉCRITE, puis annulée')
    ok(/"token":"ss_[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'session : un JETON est REFUSÉ (sonde exécutée)')
  }
  {
    const SUPP = stripSql(read(migration('journal_suppression_programmee')))
    const P = SUPP.slice(Math.max(0, SUPP.indexOf('do $post$')))
    ok(/drop function if exists public\.programmer_suppression_compte\(uuid, timestamptz\);/.test(SUPP)
      && /to_regprocedure\('public\.programmer_suppression_compte\(uuid, timestamptz\)'\) is not null then\s*\n?\s*raise exception 'postcondition NON TENUE : l ancienne signature SANS journal est encore appelable'/.test(P),
      'suppression : l’ancienne signature SANS journal est SUPPRIMÉE, et la postcondition le vérifie')
    ok(/"email":"qui@exemple\.fr"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'suppression : une adresse est REFUSÉE (sonde exécutée)')
  }
  {
    const ANN = stripSql(read(migration('journal_suppression_annulee')))
    const P = ANN.slice(Math.max(0, ANN.indexOf('do $post$')))
    ok(/jsonb_build_object\('visibilite_restauree', true, 'avait_un_profil', true\)[\s\S]{0,600}?jsonb_build_object\('visibilite_restauree', false, 'avait_un_profil', false\)[\s\S]{0,400}?raise exception 'SONDE_ANNULEE'/.test(P),
      'annulation : les deux formes (un expert qui redevient visible, un compte sans profil) sont ÉCRITES, puis annulées')
    ok(/"missing":\["summary","skills"\][\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'annulation : la liste des champs manquants est REFUSÉE (sonde exécutée)')
  }
  {
    const MAIL = stripSql(read(migration('journal_email_change')))
    const P = MAIL.slice(Math.max(0, MAIL.indexOf('do $post$')))
    ok(/jsonb_build_object\('etape', 'demande'\)[\s\S]{0,400}?raise exception 'SONDE_ANNULEE'/.test(P),
      'adresse : la forme exacte du module (l’étape seule) est ÉCRITE, puis annulée')
    ok(/"new_email":"qui@exemple\.fr"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'adresse : l’ADRESSE est REFUSÉE (sonde exécutée)')
  }
  {
    const MDP = stripSql(read(migration('journal_mot_de_passe_change')))
    const P = MDP.slice(Math.max(0, MDP.indexOf('do $post$')))
    ok(/array_length\(v_cles, 1\) is not null then\s*\n?\s*raise exception 'postcondition NON TENUE : mot_de_passe_change devrait avoir une liste blanche VIDE/.test(P),
      'mot de passe : la liste blanche est VÉRIFIÉE VIDE')
    ok(/'\{"longueur":14\}'[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'mot de passe : la LONGUEUR est REFUSÉE (sonde exécutée)')
  }
  {
    const TEL = stripSql(read(migration('journal_telephone_verifie')))
    const P = TEL.slice(Math.max(0, TEL.indexOf('do $post$')))
    ok(/to_regprocedure\('public\.verifier_telephone\(uuid, uuid, text, uuid, text, uuid, text, text\)'\) is null/.test(P), 'téléphone : la signature est vérifiée par TYPES')
    ok(/"phone":"\+33600000000"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'téléphone : le NUMÉRO est REFUSÉ par la liste blanche (sonde exécutée)')
  }
  {
    const INV = stripSql(read(migration('journal_membre_invite')))
    const P = INV.slice(Math.max(0, INV.indexOf('do $post$')))
    ok(/to_regprocedure\('public\.creer_invitation\(uuid, uuid, text, uuid, text, uuid, jsonb\)'\) is null/.test(P), 'invitation : la signature est vérifiée par TYPES')
    ok(/"invitee_email":"qui@exemple\.fr"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P), 'invitation : l’adresse invitée est REFUSÉE (sonde exécutée)')
  }
  {
    const REV = stripSql(read(migration('journal_invitation_revoquee')))
    const P = REV.slice(Math.max(0, REV.indexOf('do $post$')))
    ok(/to_regprocedure\('public\.revoquer_invitation\(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text\[\]\)'\) is null/.test(P),
      'révocation : la signature est vérifiée par TYPES')
    ok(/\"invitee_email\":\"qui@exemple\.fr\"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P),
      'révocation : l’adresse invitée est REFUSÉE (sonde exécutée)')
  }
  {
    const REN = stripSql(read(migration('journal_invitation_renvoyee')))
    const P = REN.slice(Math.max(0, REN.indexOf('do $post$')))
    ok(/to_regprocedure\('public\.renvoyer_invitation\(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text\[\], text, timestamp with time zone\)'\) is null/.test(P),
      'renvoi : la signature est vérifiée par TYPES, sous le nom que Postgres rend (timestamp with time zone)')
    ok(/"token":"abc"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P) && /raise exception 'SONDE_ANNULEE'/.test(P),
      'renvoi : le jeton est REFUSÉ par la liste blanche (sonde exécutée), et tout est annulé')
  }
  {
    const ACC = stripSql(read(migration('journal_invitation_acceptee')))
    const P = ACC.slice(Math.max(0, ACC.indexOf('do $post$')))
    ok(/to_regprocedure\('public\.accepter_invitation\(uuid, uuid, text, uuid, text, uuid, uuid, text\[\]\)'\) is null/.test(P),
      'acceptation : la signature est vérifiée par TYPES')
    ok(/"email":"qui@exemple\.fr"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P),
      'acceptation : l’adresse est REFUSÉE par la liste blanche (sonde sur identifiants inventés)')
  }
  {
    const MEM = stripSql(read(migration('journal_membres')))
    const iPost = MEM.indexOf('do $post$')
    const P = iPost < 0 ? '' : MEM.slice(iPost)
    ok(/drop function if exists public\.maj_membre_organisation\(uuid, character varying, character varying, boolean\);/.test(MEM.slice(0, iPost))
      && /to_regprocedure\('public\.maj_membre_organisation\(uuid, character varying, character varying, boolean\)'\) is not null/.test(P),
      'membres : l’ANCIENNE signature (sans journal) est SUPPRIMÉE, et la postcondition vérifie qu’elle n’est plus appelable')
    // Aucune définition ULTÉRIEURE ne recrée la signature à quatre arguments.
    const apres = TOUTES_MIGRATIONS.filter((f) => f > migration('journal_membres').split('/').pop())
    ok(apres.every((f) => !/function public\.maj_membre_organisation\(\s*p_membre_id/.test(SQL_PAR_MIGRATION.get(f))),
      'membres : aucune migration postérieure ne recrée la signature sans journal')
  }
  {
    const ST = stripSql(read(migration('journal_sous_traitance')))
    const P = ST.slice(Math.max(0, ST.indexOf('do $post$')))
    ok(/to_regprocedure\('public\.inserer_candidature_jugee\(uuid, uuid, text, uuid, text, jsonb, text\)'\) is null/.test(P)
      && /code = 'sous_traitance_publiee'/.test(P) && /code = 'sous_traitance_candidature'/.test(P),
      'sous-traitance : les signatures et les deux listes blanches sont vérifiées — les gestes, par tests/database/grand_livre/sous_traitance.test.sql')
  }
  {
    const PU = stripSql(read(migration('journal_purges')))
    const P = PU.slice(Math.max(0, PU.indexOf('do $post$')))
    ok(/to_regprocedure\('public\.anonymiser_compte\(uuid, uuid, text, uuid, text, uuid, text, text, boolean, boolean, boolean, integer\)'\) is null/.test(P)
      && /to_regprocedure\('public\.constater_avertissement_inactivite\(uuid, uuid, text, uuid, text, uuid, timestamp with time zone, boolean, text, text\)'\) is null/.test(P),
      'purges : les deux signatures sont vérifiées par TYPES')
    ok(/"email":"qui@exemple\.fr"[\s\S]{0,300}?when sqlstate 'GL004'/.test(P) && /raise exception 'SONDE_ANNULEE'/.test(P),
      'purges : l’adresse est REFUSÉE par la liste blanche, tout est annulé')
  }
  {
    const ME = stripSql(read(migration('journal_message_envoye')))
    const P = ME.slice(Math.max(0, ME.indexOf('do $post$')))
    ok(/to_regprocedure\('public\.envoyer_message\(uuid, uuid, text, uuid, text, uuid, text\[\], text\)'\) is null/.test(P),
      'message : la signature est vérifiée par TYPES')
    ok(/"content_length":12[\s\S]{0,300}?when sqlstate 'GL004'/.test(P) && /raise exception 'SONDE_ANNULEE'/.test(P),
      'message : la longueur du contenu est REFUSÉE par la liste blanche, tout est annulé')
  }
  // ── UNE SONDE NE LAISSE RIEN : TOUT APPEL QUI ÉCRIT EST DANS UN BLOC ANNULÉ (point 2.3) ──
  //  Périmètre : les postconditions (do $post$) de TOUTES les migrations ; « appel qui
  //  écrit » = un appel à une fonction SQL dont la DERNIÈRE définition insère, modifie
  //  ou supprime (ou écrit au grand livre), hors littéraux, plus tout INSERT/UPDATE/
  //  DELETE écrit en clair. Il est SÛR si un bloc englobant est ANNULÉ (il lève
  //  'SONDE_ANNULEE' et son gestionnaire relance toute autre erreur), ou si le bloc le
  //  plus proche ATTEND une erreur nommée (`when sqlstate '…' then`) et lève
  //  « NON TENUE » après l'appel — si l'erreur ne vient pas, toute la migration avorte.
  //  Audit du 26/09/2026 : 161 appels, 161 sûrs. L'annulation n'est ni un UPDATE ni un
  //  DELETE : le verrou du grand livre ne s'y oppose pas, et aucune ligne n'en reste.
  {
    const ecritSql = new Set([...DEFINITIONS_COURANTES].filter(([n, d]) => ECRIVAINS_SQL.has(n)
      || /\b(insert\s+into|update\s+(public\.)?\w+|delete\s+from)\b/i.test(d.corps)).map(([n]) => n))
    // GEL (exemptions, §G.8) : migrations DÉJÀ APPLIQUÉES, d'une forme antérieure, qu'on ne touche plus.
    // Chaque raison commence par LÉGITIME ou DÉFAUT NOMMÉ.
    const GEL_BLOC = new Map([
      ['20260923000050_tarif_par_recherche.sql', 'LÉGITIME — appliquée ; attend check_violation par un drapeau lu après le bloc, insère PUIS supprime sa sonde, et compte les survivants à la fin : rien ne reste, forme antérieure'],
      ['20260924000010_audit_sans_donnee_personnelle.sql', 'LÉGITIME — appliquée ; appelle audit_logs_nettoyer_compte() sur un compte INEXISTANT (uuid aléatoire) et relit ZÉRO ligne touchée : rien ne peut rester'],
      ['20260923000060_plafond_par_acteur.sql', 'DÉFAUT NOMMÉ — appliquée ; MODIFIE un réglage réel (ai_spend_seuils_acteur) puis le RESTAURE hors bloc annulé : la restauration est une discipline, pas une garde — sans effet aujourd’hui (valeur remise), à ne jamais recopier'],
    ])
    let total = 0
    const hors = []
    for (const f of TOUTES_MIGRATIONS) {
      if (GEL_BLOC.has(f)) continue
      const src = SQL_PAR_MIGRATION.get(f)
      const i = src.indexOf('do $post$')
      if (i < 0) continue
      const post = src.slice(i)
      const blocs = []
      const pile = []
      for (const m of post.matchAll(/\bbegin\b|\bend\s*;|\bend\s+(if|loop|case)\b/gi)) {
        if (/^begin$/i.test(m[0])) pile.push(m.index)
        else if (/^end\s*;$/i.test(m[0])) { const a = pile.pop(); if (a !== undefined) blocs.push([a, m.index]) }
      }
      // UN BLOC SE JUGE SUR SON PROPRE TEXTE — ses blocs imbriqués blanchis (positions conservées).
      // Trouvé par la mutation de T.6 (28/09/2026) : la sonde de renvoyer_invitation, privée de son
      // `raise 'SONDE_ANNULEE'`, passait pour « attend une erreur nommée » parce qu'un bloc IMBRIQUÉ
      // attendait GL005 ; et un bloc imbriqué annulé faisait passer son parent pour annulé.
      const propre = (a, b) => {
        let t = post.slice(a, b)
        for (const [x, y] of blocs) if (x > a && y < b) t = t.slice(0, x - a) + ' '.repeat(y - x) + t.slice(y - a)
        return t
      }
      const annule = (a, b) => { const c = propre(a, b); return /raise exception 'SONDE_ANNULEE'/.test(c) && /exception when others then\s*if sqlerrm <> 'SONDE_ANNULEE' then\s*raise;/.test(c) }
      const appels = []
      for (const n of ecritSql) {
        for (const m of post.matchAll(new RegExp('\\b(?:public\\.)?' + n + '\\s*\\(', 'g'))) {
          const ligne = post.slice(post.lastIndexOf('\n', m.index) + 1, m.index)
          if (/to_regprocedure|string_agg/.test(ligne) || (ligne.match(/'/g) || []).length % 2) continue
          appels.push({ pos: m.index, quoi: n })
        }
      }
      for (const m of post.matchAll(/^\s*(insert into|update public\.|delete from)\s*\S+/gim)) appels.push({ pos: m.index, quoi: m[0].trim() })
      for (const a of appels) {
        total++
        const englobants = blocs.filter(([x, y]) => a.pos > x && a.pos < y).sort((p, q) => q[0] - p[0])
        const proche = englobants[0]
        // Une erreur ATTENDUE, par son code (`sqlstate 'GL004'`) ou par son nom (`check_violation`) — jamais `others`.
        const attendu = proche && /exception when (sqlstate '[0-9A-Z]{5}'|(?!others\b)[a-z_]+) then/.test(propre(proche[0], proche[1]))
          && /raise exception 'postcondition NON TENUE/.test(post.slice(a.pos, proche[1]))
        if (!englobants.some(([x, y]) => annule(x, y)) && !attendu) hors.push(`${f} : ${a.quoi}`)
      }
    }
    // PLANCHER re-mesuré le 28/09/2026 (lot S) : 131 appels, après le retrait des sondes sur données réelles
    // des 16 migrations non appliquées (161 le 26/09). Il ne protège que contre un balayage devenu aveugle.
    ok(total >= 131 && hors.length === 0,
      `toute sonde qui écrit est dans un bloc ANNULÉ, ou attend une erreur nommée — rien n'en reste (${total} appel(s) balayé(s), gel : ${GEL_BLOC.size})`,
      hors.slice(0, 6).join('\n         ') || undefined)
    const defauts = [...GEL_BLOC.values()].filter((r) => r.startsWith('DÉFAUT NOMMÉ')).length
    ok([...GEL_BLOC.values()].every((r) => /^(LÉGITIME|DÉFAUT NOMMÉ) — /.test(r)) && [...GEL_BLOC.keys()].every((f) => TOUTES_MIGRATIONS.includes(f)),
      `le gel du bloc annulé : chaque entrée existe et dit LÉGITIME ou DÉFAUT NOMMÉ (${defauts} défaut(s) nommé(s))`)
  }
  // ── UNE LIGNE « TENUE » NE DIT QUE CE QUI A ÉTÉ VÉRIFIÉ (point 2.2, §E.67) ──
  //  Le rejeu local du 26/09/2026 : 24 migrations sur 45 ont SAUTÉ une sonde faute
  //  de données, et leur dernière ligne affirmait pourtant « naissent ensemble ».
  //  La propriété : toute postcondition qui peut sauter une sonde pose un drapeau
  //  après CHAQUE notice « SAUTEE », et sa ligne finale se dédouble — PARTIELLE si
  //  le drapeau est posé, « tenue » sinon.
  //  GEL (exemptions, §G.8) : des migrations DÉJÀ APPLIQUÉES, qu'on ne touche pas.
  {
    const GEL_SAUTEE = new Map([
      ['20260924000040_grand_livre.sql', 'appliquée sur staging — le socle ; ne se modifie plus'],
    ])
    const fautes = []
    let gardees = 0
    for (const f of TOUTES_MIGRATIONS) {
      const src = SQL_PAR_MIGRATION.get(f)
      const i = src.indexOf('do $post$')
      const post = i < 0 ? '' : src.slice(i)
      const notices = [...post.matchAll(/raise notice '[^']*SAUTEE[^;]*;\s*\n\s*(v_sautee := true;)?/g)]
      if (!notices.length) continue
      if (GEL_SAUTEE.has(f)) continue
      gardees++
      if (!/^\s*v_sautee boolean := false;/m.test(post)) fautes.push(`${f} : pas de drapeau déclaré`)
      if (notices.some((m) => !m[1])) fautes.push(`${f} : une notice SAUTEE n'est pas suivie de v_sautee := true`)
      if (!/if v_sautee then\s*raise notice 'postcondition PARTIELLE[^']*'[^;]*;\s*else\s*raise notice 'postcondition tenue/.test(post)) fautes.push(`${f} : la ligne finale ne se dédouble pas`)
    }
    // PLANCHER re-mesuré le 28/09/2026 (lot S) : 9 — les migrations DÉJÀ APPLIQUÉES qui sautent une sonde
    // (gelées), plus l'inscription (référentiels). Aucune migration nouvelle n'a plus de raison d'en sauter
    // une : elle ne sonde plus de donnée réelle (§E.77, diag-postconditions-structure).
    ok(fautes.length === 0 && gardees >= 9,
      `une postcondition qui peut SAUTER une sonde le DIT dans sa ligne finale (${gardees} migration(s), gel : ${GEL_SAUTEE.size} appliquée(s))`,
      fautes.slice(0, 6).join('\n         ') || undefined)
    const gelFaux = [...GEL_SAUTEE.keys()].filter((f) => !TOUTES_MIGRATIONS.includes(f) || !/SAUTEE/.test(SQL_PAR_MIGRATION.get(f)))
    ok(gelFaux.length === 0, 'le gel ne nomme que des migrations qui existent et qui sautent — il ne peut que se vider', gelFaux.join(', ') || undefined)
  }
  // ── UNE SONDE QUI VIOLE UNE CONTRAINTE DE LA TABLE NE PROUVE RIEN : ELLE ARRÊTE LA MIGRATION (§E.70) ──
  //  Mesuré le 26/09/2026 : 36 appels de sonde, sur 16 migrations, journalisaient
  //  un geste d'UTILISATEUR sans ACTEUR — `grand_livre_acteur_si_humain` refuse
  //  (23514). Une partie ne demandait aucune donnée : elle aurait levé sur une base
  //  vierge. Aucune de ces migrations n'avait tourné. La propriété, balayée sur
  //  TOUTES les postconditions : une origine humaine n'est jamais suivie d'un
  //  acteur nul, et l'écosystème d'un appel direct à journaliser() n'est jamais
  //  un uuid aléatoire (clé étrangère vers domains).
  {
    const fautes = []
    for (const f of TOUTES_MIGRATIONS) {
      const src = SQL_PAR_MIGRATION.get(f)
      const i = src.indexOf('do $post$')
      if (i < 0) continue
      const post = src.slice(i)
      for (const m of post.matchAll(/'(utilisateur|administrateur)',\s*null\b/gi)) fautes.push(`${f} : origine ${m[1]} sans acteur`)
      for (let from = 0; ; ) {
        const k = post.indexOf('journaliser(', from)
        if (k < 0) break
        from = k + 'journaliser('.length
        if (/\w/.test(post[k - 1] ?? ' ')) continue
        const a = decouperArguments(blocApres(post.slice(k), 'journaliser(', '(', ')') ?? '')
        if (/gen_random_uuid/.test(a[6] ?? '')) fautes.push(`${f} : écosystème aléatoire`)
      }
    }
    ok(fautes.length === 0,
      `aucune sonde ne viole une contrainte du grand livre — origine humaine ⇒ acteur, écosystème réel ou nul (${TOUTES_MIGRATIONS.length} migrations balayées)`,
      fautes.slice(0, 6).join('\n         ') || undefined)
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

// ── DEUX ÉCRITURES D'UN GESTE NE SE RESSEMBLENT PAS (recette staging, 30/09/2026) ──
//  Décision de Youssef : un geste ne garde qu'une écriture quand deux ne se distinguent en rien.
//  Le cas vu à l'écran : `handle_new_user` écrivait `compte_cree` ET `expert_inscrit` sur le MÊME
//  sujet (le compte), avec presque le même détail. Ce contrôle lit la DERNIÈRE définition de
//  chaque fonction SQL et refuse que deux ACTIONS différentes y soient écrites sur la même
//  expression de sujet (type ET identifiant). Une même action dans deux branches (réussi /
//  échoué) n'est pas un doublon. Une exception se déclare, avec sa raison (§G.8).
//  CE QU'IL NE VOIT PAS : deux lignes écrites par DEUX fonctions (un écrivain qui en appelle un
//  autre) ou par le TypeScript sous la même pièce — le test `grand_livre/inscriptions` exige deux
//  sujets par voie ; le balayage complet est dans docs/reprise.md (recette staging).
{
  const MEME_SUJET_ADMIS = {}
  const argsDe = (s, i) => {
    const out = []
    let prof = 0, cur = '', q = false
    for (; i < s.length; i++) {
      const c = s[i]
      if (c === "'") q = !q
      if (!q && c === '(') { prof++; if (prof === 1) continue }
      if (!q && c === ')') { prof--; if (prof === 0) { out.push(cur.trim()); return out } }
      if (!q && c === ',' && prof === 1) { out.push(cur.trim()); cur = ''; continue }
      if (prof >= 1) cur += c
    }
    return out
  }
  const doublons = []
  let lues = 0
  for (const [nom, { corps }] of DEFINITIONS_COURANTES) {
    const parSujet = new Map()
    for (const m of corps.matchAll(/public\.journaliser\s*\(/g)) {
      const a = argsDe(corps, m.index + m[0].length - 1)
      if (a.length < 10) continue
      lues++
      const sujet = `${a[7]} / ${a[8]}`.replace(/\s+/g, ' ')
      if (!parSujet.has(sujet)) parSujet.set(sujet, new Set())
      parSujet.get(sujet).add(a[1])
    }
    for (const [sujet, actions] of parSujet) {
      if (actions.size > 1 && !MEME_SUJET_ADMIS[nom]) doublons.push(`${nom} : ${[...actions].join(' + ')} sur ${sujet}`)
    }
  }
  ok(lues > 20 && doublons.length === 0,
    `aucune fonction n’écrit deux actions différentes sur le même sujet (${lues} appels à journaliser lus)`,
    doublons.length ? doublons.join('\n       → ') + '\n       → deux lignes d’un geste sur le même objet ne se distinguent pas à l’écran : chacune dit SON objet, ou l’une disparaît' : undefined)
}

console.log()
if (failures) {
  console.log(`✘ ${failures} CONTRÔLE(S) EN ÉCHEC — le socle du grand livre ne tient pas`)
  process.exit(1)
}
console.log('✅ le socle tient : liste fermée unique, ajout seul prouvé, fonction unique, pièce explicite, deux actions réelles')
