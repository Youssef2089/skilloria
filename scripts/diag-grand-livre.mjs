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
const TOUTES_MIGRATIONS = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))

// ═══ A. LA LISTE FERMÉE — une seule, dans les deux sens ═════════════════════
section('A. La liste fermée des actions — SQL et TypeScript disent la même chose')
{
  const iSeed = SQL.indexOf('insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values')
  const seed = iSeed < 0 ? '' : SQL.slice(iSeed, SQL.indexOf('on conflict (code)', iSeed))
  const lignes = [...seed.matchAll(/\(\s*'([a-z0-9_]+)',\s*'([a-z]+)',\s*(null|'[a-z]+'),\s*'([a-z0-9_.]+)'\s*\)/g)]
    .map((m) => ({ code: m[1], famille: m[2], impose: m[3] === 'null' ? null : m[3].slice(1, -1), cle: m[4] }))
  const codesSql = new Set(lignes.map((l) => l.code))
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
}

// ═══ C. LA FONCTION UNIQUE ══════════════════════════════════════════════════
section('C. journaliser() est la seule porte — pièce et type exigés, liste fermée, sans donnée personnelle')
{
  const fn = corpsSql(SQL, 'public.journaliser(')
  ok(/if p_piece is null then\s+raise exception 'journaliser : la piece est obligatoire[^']*'\s+using errcode = 'GL002'/.test(fn),
    'la pièce est OBLIGATOIRE (GL002)')
  ok(/if p_type_action is null then\s+raise exception[^;]*using errcode = 'GL002'/.test(fn), 'le type est OBLIGATOIRE (GL002)')
  ok(/type d action inconnu[\s\S]{0,200}?using errcode = 'GL003'/.test(fn), 'un type hors liste est REFUSÉ (GL003)')
  ok(/impose le statut[\s\S]{0,200}?using errcode = 'GL003'/.test(fn), 'un statut contraire à celui que le type impose est REFUSÉ (GL003)')
  ok(/public\.audit_logs_detail_sans_pii\(coalesce\(p_detail, '\{\}'::jsonb\)\)/.test(fn),
    'le détail passe par audit_logs_detail_sans_pii() AVANT d’être inséré — la même liste que le journal d’audit')
  // UN SEUL insert dans tout le dépôt, et il est dans journaliser.
  let inserts = 0
  const ailleurs = []
  for (const f of TOUTES_MIGRATIONS) {
    const src = stripSql(read(`supabase/migrations/${f}`))
    const n = (src.match(/insert into public\.grand_livre\b(?!_actions)/g) || []).length
    inserts += n
    if (n && `supabase/migrations/${f}` !== MIG) ailleurs.push(f)
  }
  ok(inserts === 1 && ailleurs.length === 0 && /insert into public\.grand_livre\s*\(/.test(fn),
    'UN SEUL `insert into public.grand_livre` dans tout le dépôt, et il est dans journaliser()',
    `vu : ${inserts} insert(s)${ailleurs.length ? `, hors migration grand_livre : ${ailleurs.join(', ')}` : ''}`)
  // Côté code : aucune écriture directe, aucun appel RPC hors de la porte.
  const ecrituresDirectes = []
  const rpcHorsPorte = []
  for (const f of [...fichiers('app'), ...fichiers('lib'), ...fichiers('components')]) {
    const src = stripTs(read(f))
    if (/\.from\('grand_livre'\)[\s\S]{0,200}?\.(insert|update|upsert|delete)\(/.test(src)) ecrituresDirectes.push(f)
    if (f !== 'lib/journal/journaliser.ts' && /\.rpc\('journaliser'/.test(src)) rpcHorsPorte.push(f)
  }
  ok(ecrituresDirectes.length === 0, 'aucun fichier n’écrit dans grand_livre par le client (from().insert/update/delete)',
    ecrituresDirectes.join(', ') || undefined)
  ok(rpcHorsPorte.length === 0, 'aucun fichier n’appelle la RPC journaliser hors de lib/journal/journaliser.ts', rpcHorsPorte.join(', ') || undefined)
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
  const fnReglage = corpsSql(SQL, 'public.regler_durees_place(')
  ok(/update public\.duree_reglages/.test(fnReglage) && /return public\.journaliser\(\s*p_piece, 'reglage_modifie', 'reussi', 'administrateur'/.test(fnReglage),
    'regler_durees_place() met à jour le réglage ET journalise, dans la même fonction — l’un sans l’autre est impossible')
  ok(/if p_acteur_id is null then\s+raise exception[^;]*using errcode = 'GL002'/.test(fnReglage), 'un réglage a toujours un auteur')
  const fnIp = corpsSql(SQL, 'public.effacer_adresses_ip()')
  ok(/v_piece\s+uuid := gen_random_uuid\(\)/.test(fnIp), 'la tâche SQL génère sa pièce (gen_random_uuid) — la pièce est générable des deux côtés')
  const iExc = fnIp.indexOf('exception when others then')
  const corpsOk = iExc < 0 ? '' : fnIp.slice(0, iExc)
  const corpsKo = iExc < 0 ? '' : fnIp.slice(iExc)
  ok(/journaliser\(\s*v_piece, 'ip_effacees', 'reussi', 'tache_planifiee'/.test(corpsOk), 'succès : journalisé DANS le bloc, avec sa pièce')
  ok(/journaliser\(\s*v_piece, 'ip_effacees', 'echoue', 'tache_planifiee'/.test(corpsKo), 'échec : journalisé DANS le gestionnaire, même pièce')
  ok(/left\(sqlerrm, 200\)/.test(corpsKo), 'l’échec porte la CLASSE de la panne, bornée — pas un texte entier')
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
}

// ═══ G. AUCUNE DONNÉE PERSONNELLE — détecteur partagé ═══════════════════════
section('G. Un détail passé au grand livre ne porte ni clé ni valeur personnelle')
{
  const CLES = chargerClesPersonnelles(stripSql(read(migration('audit_sans_donnee_personnelle'))))
  ok(CLES.length >= 10, `la liste des clés personnelles est lue en base (${CLES.length} clés) — la même que pour audit_logs`)
  const detecteurDetail = fabriquerDetecteur(CLES, 'detail')
  const detecteurRpc = fabriquerDetecteur(CLES, 'p_detail')
  const defauts = []
  let appels = 0
  for (const f of [...fichiers('app'), ...fichiers('lib'), ...fichiers('components')]) {
    if (f === 'lib/journal/journaliser.ts') continue
    const src = stripTs(read(f))
    for (const bloc of appelsDe(src, 'journaliser(')) {
      appels++
      const d = detecteurDetail(bloc, src)
      if (d) defauts.push(`${f} · journaliser — ${d}`)
    }
    for (const nom of [".rpc('journaliser'", ".rpc('regler_durees_place'"]) {
      for (const bloc of appelsDe(src, nom)) {
        appels++
        const d = detecteurRpc(bloc, src)
        if (d) defauts.push(`${f} · ${nom} — ${d}`)
      }
    }
  }
  ok(appels >= 1, `${appels} appel(s) vers le grand livre lus`)
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
