#!/usr/bin/env node
// scripts/diag-ecritures-effectives.mjs — UNE ÉCRITURE QUI NE TOUCHE AUCUNE LIGNE NE PASSE JAMAIS EN SILENCE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI IL EXISTE (lot T.3, 28/09/2026, §E.74)
//   Une RPC verrouille une ligne, la relit, puis la met à jour par son
//   identifiant. Zéro ligne touchée n'y est possible que sur ANOMALIE — une
//   politique forcée, un trigger qui annule, une ligne disparue. Le balayage du
//   28/09/2026 a trouvé 16 écritures de ce genre sans aucune vérification, et une
//   (`cloturer_annonce`) qui rendait `false` : l'anomalie s'y lisait comme un
//   rejeu (§E.22). La parade est UNE fonction, `exiger_ecriture()` (EC001).
//
// LA PROPRIÉTÉ, sur la DERNIÈRE définition de chaque fonction créée depuis le
// socle du grand livre (les écrivains du journal et leurs RPC) :
//   chaque UPDATE / DELETE est suivi de `get diagnostics v = row_count` PUIS de
//   `exiger_ecriture(v, …)` — OU figure au GEL, où chaque entrée dit pourquoi zéro
//   ligne y est LÉGITIME (une écriture conditionnelle dont le WHERE est la garde,
//   qui rend alors une issue nommée ; un nettoyage). Le gel ne fait que descendre :
//   une entrée qui ne correspond plus à une écriture rougit.
// PÉRIMÈTRE, ÉCRIT : la DERNIÈRE définition de TOUTE fonction du schéma public
//   rejouée depuis les migrations — triggers compris, vues exclues (elles n'écrivent pas).
//   Mesuré le 28/09/2026 : les fonctions d'avant le socle en portaient 17 sans compte ;
//   six anomalies corrigées (ecritures_effectives), le reste au gel avec sa raison.
// CE QU'IL NE GARDE PAS : que le compte ATTENDU soit le bon (il vérifie qu'on le
//   demande), ni le SQL dynamique (`execute`).
//
//   node scripts/diag-ecritures-effectives.mjs   → statique, aucun accès base.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rejouerMigrations } from './lib/schema-migrations.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}

const L = 'LÉGITIME : écriture conditionnelle — son WHERE est la garde, zéro ligne rend'
/** fonction:table:rang → raison. Le rang compte les écritures de CETTE table dans CETTE fonction. */
const GEL = {
  'anonymiser_compte:users:1': `${L} false (compte déjà purgé ou disparu)`,
  'constater_avertissement_inactivite:users:1': `${L} false (compte anonymisé entre-temps)`,
  // ── les fonctions d'avant le socle (balayées depuis le 28/09/2026) ──
  'rate_limit_check:rate_limit_hits:1': 'LÉGITIME : purge des passages hors fenêtre — zéro veut dire « rien d\'ancien »',
  'purge_cron_maintenance:cron_run_log:1': 'LÉGITIME : rétention par lot (corps de réponse de plus de 90 jours) — zéro veut dire « rien d\'ancien »',
  'purge_cron_maintenance:cron_run_log:2': 'LÉGITIME : rétention par lot (lignes de plus de 5 ans)',
  'purge_cron_maintenance:cron:1': 'LÉGITIME : rétention par lot de cron.job_run_details (30 jours)',
  'purger_notes_partielles:matching_notes_partielles:1': 'LÉGITIME : purge par lot des notes de plus de 24 h — rend son compte, zéro veut dire « rien d\'ancien »',
  'reconcile_cron_run_log:cron_run_log:1': 'LÉGITIME : réconciliation par lot des réponses pg_net — rend son compte, zéro veut dire « rien à réconcilier »',
  'cloturer_run_cron:cron_run_log:1': 'LÉGITIME : conditionnel sur reconciled_at is null — rend false, « verdict déjà posé »',
  'admin_cron_run_now:cron_run_log:1': 'LÉGITIME : conditionnel — zéro ligne planifiée à requalifier, la fonction insère alors la ligne manuelle (repli lu dans le code)',
  'appliquer_scores_de_pertinence:matches:1': 'LÉGITIME : application par lot — rend le nombre de matches touchés ; un match supprimé entre la notation et l\'application ne se note pas',
  'audit_logs_nettoyer_compte:audit_logs:1': 'LÉGITIME : nettoyage par lot des traces du compte — rend son compte, zéro veut dire « rien à nettoyer »',
  'reserver_place_annonce:publications:1': 'LÉGITIME : nettoyage par lot des places d\'annonces qui ne sont plus actives — zéro veut dire « rien à libérer »',
  'reserver_place_annonce:publications:2': 'LÉGITIME : conditionnel (place_active is null) — la fonction rend `found`, c\'est son issue',
  'promouvoir_administrateur:users:1': 'LÉGITIME : conditionnel (client créé pour l’administration) — `if not found` lève le refus NOMMÉ AD001, que le gestionnaire ÉCRIT (administrateur_cree échouée) ; la fonction rend « echoue »',
  'rouvrir_evenement_stripe:stripe_events:1': 'LÉGITIME : conditionnel (encore received, reçu avant la limite) — la garde EST le WHERE (§E.31) ; `if not found` rend « non_coince », rien n’a changé et rien ne s’écrit',
  'nettoyer_journal:grand_livre:1': 'LÉGITIME : suppression PAR FAMILLE — zéro ligne pour une famille est légitime ; le TOTAL est exigé égal à l’annonce (exiger_ecriture(v_effacees, …, p_total_annonce)), sinon la transaction est annulée',
  'solder_relance_expert:profiles:1': 'LÉGITIME : conditionnel (relance due avant le début du passage) — `if found` choisit la branche ; la seconde écriture, elle, exige son compte',
  'rendre_bail:baux:1': 'LÉGITIME : un bail déjà rendu, ou expiré puis repris par un autre, n\'a rien à rendre — conditionnel sur finished_at is null',
  'reserver_place_incluse:candidatures:1': 'LÉGITIME : conditionnel (place_incluse is null) — la fonction rend `found`, c\'est son issue',
  'liberer_place_incluse:candidatures:1': 'LÉGITIME : libérer la place d\'une candidature disparue ne libère rien qui existe (language sql, idempotent)',
  'liberer_place_annonce:publications:1': 'LÉGITIME : libérer la place d\'une annonce disparue ne libère rien qui existe (language sql, idempotent)',
  'pourvoir_siege_admin_si_vacant:organizations:1': 'LÉGITIME : « si vacant » — conditionnel sur siege_admin_membre_id is null, zéro veut dire « déjà pourvu »',
  'pourvoir_siege_plateforme_si_vacant:plateforme:1': 'LÉGITIME : « si vacant » — conditionnel sur siege_admin_user_id is null, zéro veut dire « déjà pourvu »',
  // ── les fonctions du grand livre ──
  'constater_devoilement_ferme:candidatures:1': `${L} une issue NOMMÉE — « deja » (constat déjà posé), « change » (statut changé depuis la lecture), « introuvable »`,
  'decliner_candidature:candidatures:1': `${L} false (statut hors des statuts admis)`,
  'retenir_candidature:candidatures:1': `${L} null (statut hors des statuts admis)`,
  'publier_annonce:publications:1': `${L} null (brouillon absent ou d'une autre organisation)`,
  'solder_depot_en_echec:candidature_depots:1': 'LÉGITIME : un dépôt jamais ouvert (ouverture en échec, déjà journalisée par depot.ts) n\'a pas de ligne à solder — le refus refus_depot_sans_jugement s\'écrit QUAND MÊME, sans sujet (§D.19) : l\'échec ne se perd pas',
  'verifier_telephone:users:1': `${L} false (compte absent)`,
  'inserer_candidature_jugee:candidature_depots:1': 'LÉGITIME : nettoyage sur conflit — le dépôt de cette tentative est effacé s\'il existe ; son absence (ouverture du journal en échec, déjà journalisée par depot.ts) ne change rien',
  'inserer_candidature_jugee:candidature_depots:2': 'LÉGITIME : cas dégradé connu — `depot.ts` continue quand l\'ouverture du dépôt échoue (et le journalise) ; la candidature s\'insère, la tentative vaut null dans la ligne',
  'effacer_adresses_ip:audit_logs:1': 'LÉGITIME : effacement par lot — zéro ligne veut dire « rien d\'ancien à effacer », et le compte entre dans la ligne ip_effacees',
  'effacer_adresses_ip:session_logs:1': 'LÉGITIME : effacement par lot — idem, compté dans la ligne ip_effacees',
  'appliquer_analyse_cv:profile_experiences:1': 'LÉGITIME : remplacement de la liste — un premier dépôt n’a aucune expérience à effacer ; la réinsertion suit dans la même transaction (§E.87)',
  'appliquer_analyse_cv:profile_educations:1': 'LÉGITIME : remplacement de la liste — un premier dépôt n’a aucune formation à effacer (§E.87)',
  'appliquer_analyse_cv:profile_languages:1': 'LÉGITIME : remplacement de la liste — un premier dépôt n’a aucune langue à effacer (§E.87)',
  'regler_durees_place:duree_reglages:1': 'LÉGITIME : le compte est vérifié en place (v_n <> 1 → exception nommée) — même garde, écrite avant exiger_ecriture',
  'regler_tarif_ia:ai_model_tarifs:1': 'LÉGITIME : compte vérifié en place (v_n <> 1 → P0002 « modèle inconnu », refus nommé)',
  'regler_quota_ia:ai_quotas:1': 'LÉGITIME : compte vérifié en place (v_n <> 1 → P0002 « quota inconnu »)',
  'regler_matching:matching_settings:1': 'LÉGITIME : compte vérifié en place (v_n <> 1 → P0002)',
  'regler_note_jugement:verification_providers:1': 'LÉGITIME : compte vérifié en place (v_n <> 1 → P0002)',
  'regler_plafonds_ia:ai_spend_caps:1': 'LÉGITIME : compte vérifié en place, par fournisseur (v_n <> 1 → P0002)',
  'regler_plafonds_ia:ai_spend_seuils_acteur:1': 'LÉGITIME : compte vérifié en place, par acteur (v_n <> 1 → P0002)',
  'regler_plafonds_ia:ai_spend_seuils_acteur:2': 'LÉGITIME : compte vérifié en place, par acteur (v_n <> 1 → P0002)',
}

/** Découpe au `;` de niveau zéro de parenthèses, chaînes vidées d'abord. */
function instructions(corps) {
  const s = corps.replace(/'(?:[^']|'')*'/g, "''")
  const out = []
  let prof = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') prof++
    if (ch === ')') prof--
    if (ch === ';' && prof === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}

/** Les écritures d'un corps : [{ table, rang, exigee }]. */
export function ecritures(corps) {
  const instr = instructions(corps)
  const rangs = new Map()
  const out = []
  instr.forEach((s, i) => {
    // `for update` (verrou) et `do update` (upsert) ne sont pas des UPDATE.
    for (const m of s.matchAll(/(?<!\bfor\s)(?<!\bdo\s)\b(update|delete\s+from)\s+(?:only\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi)) {
      if (/^(skip|nowait|of)$/i.test(m[2])) continue
      const table = m[2].toLowerCase()
      const rang = (rangs.get(table) ?? 0) + 1
      rangs.set(table, rang)
      const suite = instr.slice(i + 1, i + 3).join(';')
      const diag = suite.match(/get\s+diagnostics\s+([a-z_][a-z0-9_]*)\s*=\s*row_count/i)
      const exigee = !!diag && new RegExp(`\\bexiger_ecriture\\(\\s*${diag[1]}\\b`, 'i').test(suite)
      out.push({ table, rang, exigee })
    }
  })
  return out
}

// ── Le motif, éprouvé sur des témoins AVANT de balayer (§E.33) ──
console.log('\n═══ Le motif est éprouvé sur des témoins ═══\n')
const T_SILENCE = `begin select 1 into v from public.t where id = p for update; update public.t set a = 1 where id = p; perform public.journaliser(x); end`
const T_EXIGEE = `begin update public.t set a = 1 where id = p; get diagnostics v_n = row_count; perform public.exiger_ecriture(v_n, 'x'); end`
const T_VERROU = `begin select id into v from public.t where x for update skip locked; insert into public.t (a) values (1) on conflict (a) do update set a = 2; end`
const T_AUTRE_VAR = `begin update public.t set a = 1; get diagnostics v_n = row_count; perform public.exiger_ecriture(v_autre, 'x'); end`
ok(ecritures(T_SILENCE).length === 1 && !ecritures(T_SILENCE)[0].exigee, 'il VOIT une mise à jour sans compte exigé')
ok(ecritures(T_EXIGEE).length === 1 && ecritures(T_EXIGEE)[0].exigee, '… et la reconnaît quand le compte est exigé')
ok(ecritures(T_VERROU).length === 0, '… et ne prend ni `for update skip locked` ni `do update` pour une écriture')
ok(ecritures(T_AUTRE_VAR)[0]?.exigee === false, '… et refuse un exiger_ecriture qui ne lit pas le compte mesuré')

// ── Le balayage ──
console.log('\n═══ Les écritures de toutes les fonctions (dernière définition) ═══\n')
const toutes = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort()
const socles = toutes.filter((f) => f.endsWith('_grand_livre.sql'))
if (socles.length !== 1) { console.error(`✘ socle introuvable ou ambigu (${socles.length})`); process.exit(2) }
const { fonctions } = rejouerMigrations()
const silences = []
const vues = new Set()
let n = 0
let exigees = 0
for (const [nom, def] of [...fonctions].sort()) {
  if (/^\s*create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\b/i.test(def.corps)) continue
  for (const e of ecritures(def.corps)) {
    n++
    const cle = `${nom}:${e.table}:${e.rang}`
    vues.add(cle)
    if (e.exigee) exigees++
    else if (!(cle in GEL)) silences.push(`${cle} (${def.migration})`)
  }
}
ok(n > 0, `${n} écritures balayées, ${exigees} exigent leur compte, ${n - exigees} au gel à raisons`)
ok(silences.length === 0, 'aucune écriture ne passe en silence hors du gel',
  silences.length ? `${silences.join(' · ')} — appelle exiger_ecriture(v_n, …) après get diagnostics, ou écris au gel pourquoi zéro est légitime` : undefined)
const perimees = Object.keys(GEL).filter((k) => !vues.has(k))
ok(perimees.length === 0, 'chaque entrée du gel correspond à une écriture réelle (le gel ne fait que descendre)', perimees.join(' · ') || undefined)
const gelExigees = Object.keys(GEL).filter((k) => {
  const [nom, table, rang] = k.split(':')
  const def = fonctions.get(nom)
  return def && ecritures(def.corps).some((e) => e.table === table && String(e.rang) === rang && e.exigee)
})
ok(gelExigees.length === 0, 'aucune entrée du gel n\'exige déjà son compte (sinon, la retirer)', gelExigees.join(' · ') || undefined)
const sansRaison = Object.entries(GEL).filter(([, r]) => !/^(LÉGITIME|DÉFAUT NOMMÉ)\b/.test(r)).map(([k]) => k)
ok(sansRaison.length === 0, 'chaque entrée du gel commence par LÉGITIME ou DÉFAUT NOMMÉ (§G.8)', sansRaison.join(' · ') || undefined)
const existe = [...fonctions].some(([nom, def]) => nom === 'exiger_ecriture' && /errcode\s*=\s*'EC001'/i.test(def.corps))
ok(existe, 'la fonction unique exiger_ecriture() existe et lève EC001')

console.log(failures === 0
  ? `\n✅ ${n} écritures : ${exigees} exigent leur compte (EC001), ${n - exigees} ont une raison écrite.`
  : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC — une écriture peut ne rien toucher en silence`)
process.exit(failures === 0 ? 0 : 1)
