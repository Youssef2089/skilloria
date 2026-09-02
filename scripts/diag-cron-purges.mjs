#!/usr/bin/env node
// scripts/diag-cron-purges.mjs
// ─────────────────────────────────────────────────────────────────────────────
// SANTE DES PURGES RGPD PORTEES SUR pg_cron
//
//   node scripts/diag-cron-purges.mjs
//
// Repond a une seule question, celle qui compte : « les purges legalement
// obligatoires tournent-elles encore ? ». Une purge CNIL qui cesse de tourner
// sans que personne ne le voie est une non-conformite silencieuse.
//
// POURQUOI DEUX SOURCES
//   pg_net est asynchrone. `cron.job_run_details` prouve seulement que l'appel
//   a ete MIS EN FILE : un 401 ou un 500 y apparait `succeeded`. Le vrai verdict
//   HTTP vit dans `public.cron_run_log`, alimente par le job de reconciliation.
//   Ce script lit les deux via la fonction `public.cron_purge_health()` (le
//   schema `cron` n'est pas expose par PostgREST) et les confronte.
//
// CE QU'IL SAIT DISTINGUER
//   - le job n'existe pas / est desactive        -> planification perdue
//   - le job a leve (secret Vault absent)        -> visible cote ordonnanceur
//   - le job a tourne mais la route a repondu 401/500
//   - le job a tourne mais aucune reponse observee (timeout, TTL depasse)
//   - le job n'a pas tourne depuis trop longtemps (silence = panne)
//
// Sortie : exit 0 si tout est vert, exit 1 des qu'un job est en defaut.
// Aucun secret n'est affiche.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

// ─── Env (.env.local) ────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), '.env.local')
if (!existsSync(envPath)) {
  console.error(`${RED}.env.local introuvable a ${envPath}${RESET}`)
  process.exit(1)
}
for (const line of readFileSync(envPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(`${RED}NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans .env.local${RESET}`)
  process.exit(1)
}

const { createClient } = await import('@supabase/supabase-js')
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ─── Attentes par job ────────────────────────────────────────────────────────
//
// ⚠️ L'HORAIRE N'EST PLUS UNE ATTENTE — ET C'EST UN CORRECTIF, PAS UN OUBLI.
//
//   Ce tableau portait un champ `schedule` compare par EGALITE STRICTE au
//   `cron.job.schedule` reel. Cela avait un sens tant que reprogrammer une tache
//   demandait une migration : tout ecart signalait une derive.
//
//   L'ecran /admin/taches-planifiees fait de la reprogrammation une OPERATION
//   SUPPORTEE. Des le premier usage legitime, ce controle serait passe au rouge
//   en accusant un changement voulu. Un diagnostic qui crie au loup sur une
//   action normale finit ignore — et c'est alors qu'il rate la vraie panne.
//
//   Ce qui reste verifiable, et qui compte, est INCHANGE : le job existe, il est
//   actif, il a tourne recemment, et sa reponse HTTP est saine. `maxAgeHours`
//   reste une attente legitime : elle ne decrit pas QUAND la tache tourne, mais
//   a quelle FREQUENCE minimale on exige qu'elle tourne.
//
//   La coherence de la CHAINE (reconciliation apres les purges) n'est pas non
//   plus perdue : elle est desormais declaree en base (`cron_job_catalog.
//   depends_on` / `min_gap_minutes`) et refusee au serveur au moment de
//   reprogrammer — c'est-a-dire empechee, plutot que constatee apres coup.
//
// `maxAgeHours` = au-dela, le silence est traite comme une panne. 26 h pour un
// job quotidien : une marge de 2 h absorbe un decalage sans masquer un jour saute.
const EXPECTED = [
  { name: 'purge_deletions_trigger', http: true,  maxAgeHours: 26, label: 'Purge RGPD art. 17 (suppression volontaire echue)' },
  { name: 'purge_inactive_trigger',  http: true,  maxAgeHours: 26, label: 'Purge CNIL 2 ans (comptes inactifs)' },
  { name: 'cron_run_reconcile',      http: false, maxAgeHours: 26, label: 'Reconciliation des reponses HTTP' },
  { name: 'cron_run_log_purge',      http: false, maxAgeHours: 26, label: 'Menage cron_run_log + cron.job_run_details' },
]

function hoursSince(iso) {
  if (!iso) return null
  return (Date.now() - new Date(iso).getTime()) / 3_600_000
}

function fmtAge(h) {
  if (h === null) return 'jamais'
  if (h < 1) return `il y a ${Math.round(h * 60)} min`
  if (h < 48) return `il y a ${h.toFixed(1)} h`
  return `il y a ${Math.floor(h / 24)} j`
}

// ─── Lecture ─────────────────────────────────────────────────────────────────
const { data, error } = await supabaseAdmin.rpc('cron_purge_health')
if (error) {
  console.error(`${RED}Appel de cron_purge_health() impossible : ${error.message}${RESET}`)
  console.error(`${DIM}La migration 20260823000000_purges_rgpd_pg_cron.sql a-t-elle ete poussee ?${RESET}`)
  process.exit(1)
}

const byName = new Map((data ?? []).map((r) => [r.job_name, r]))

console.log(`${BOLD}SANTE DES PURGES RGPD — declencheur pg_cron${RESET}`)
console.log(`Projet : ${SUPABASE_URL}`)
console.log('='.repeat(78))

let ko = 0
let warn = 0

for (const exp of EXPECTED) {
  const r = byName.get(exp.name)
  const problems = []
  const notes = []

  // 1. Le job existe-t-il, est-il actif, au bon horaire ?
  if (!r || r.schedule === null) {
    problems.push('job ABSENT de cron.job (planification perdue)')
  } else {
    if (r.active === false) problems.push('job DESACTIVE (active = false)')
    // L'horaire est AFFICHE, jamais compare : il est desormais modifiable
    // depuis /admin/taches-planifiees (cf. note sur EXPECTED plus haut).
    notes.push(`horaire : ${r.schedule}`)
  }

  // 2. L'ordonnanceur : le declenchement a-t-il abouti ?
  //    C'est ici — et NULLE PART AILLEURS — qu'apparait un secret Vault absent :
  //    la fonction leve, la transaction est annulee, donc aucune ligne dans
  //    cron_run_log. Le silence cote HTTP s'explique par ce message.
  if (r) {
    const schedAge = hoursSince(r.sched_end)
    if (r.sched_status === null) {
      problems.push("aucun declenchement enregistre par l'ordonnanceur")
    } else {
      if (r.sched_status !== 'succeeded') {
        problems.push(`dernier declenchement "${r.sched_status}" — ${r.sched_message ?? 'sans message'}`)
      }
      if (schedAge !== null && schedAge > exp.maxAgeHours) {
        problems.push(`dernier declenchement ${fmtAge(schedAge)} (> ${exp.maxAgeHours} h attendues)`)
      }
      notes.push(`ordonnanceur : ${r.sched_status}, ${fmtAge(schedAge)}`)
    }
  }

  // 3. Le resultat HTTP : uniquement pour les deux jobs qui appellent une route.
  if (exp.http && r) {
    const httpAge = hoursSince(r.http_requested_at)
    if (r.http_requested_at === null) {
      problems.push('aucun appel HTTP journalise dans cron_run_log')
    } else {
      if (httpAge > exp.maxAgeHours) {
        problems.push(`dernier appel HTTP ${fmtAge(httpAge)} (> ${exp.maxAgeHours} h attendues)`)
      }
      if (r.http_reconciled_at === null) {
        // Ni statut ni erreur : la reponse n'a jamais ete observee. Distinguer
        // « pas encore reconcilie » (normal dans l'heure) d'un vrai trou.
        if (httpAge !== null && httpAge < 1) {
          notes.push('reponse pas encore reconciliee (appel recent)')
        } else {
          problems.push('reponse JAMAIS observee (reconciliation manquee ou TTL pg_net depasse)')
        }
      } else if (r.http_timed_out === true) {
        problems.push('TIMEOUT cote pg_net — le traitement a pu aboutir malgre tout, verdict perdu')
      } else if (r.http_status !== 200) {
        problems.push(`reponse HTTP ${r.http_status ?? 'sans statut'} — ${r.http_error ?? 'sans message'}`)
      } else {
        notes.push(`HTTP 200, ${fmtAge(httpAge)}`)
        if (r.http_response) notes.push(`reponse : ${r.http_response.slice(0, 160)}`)
      }
    }
  }

  const ok = problems.length === 0
  if (!ok) ko += 1
  console.log()
  console.log(`${ok ? GREEN + 'OK  ' : RED + 'KO  '}${RESET}${BOLD}${exp.name}${RESET} ${DIM}— ${exp.label}${RESET}`)
  for (const n of notes) console.log(`     ${DIM}${n}${RESET}`)
  for (const p of problems) console.log(`     ${RED}-> ${p}${RESET}`)
}

// ─── Volumetrie du journal : le menage fait-il son travail ? ─────────────────
const { count: logCount, error: cntErr } = await supabaseAdmin
  .from('cron_run_log')
  .select('id', { count: 'exact', head: true })
if (!cntErr) {
  console.log()
  console.log(`${DIM}cron_run_log : ${logCount} lignes (retention 90 j — au-dela de ~400, verifier cron_run_log_purge)${RESET}`)
  if (logCount > 400) warn += 1
}

console.log()
console.log('='.repeat(78))
if (ko === 0) {
  console.log(`${GREEN}${BOLD}TOUT EST VERT${RESET} — les 4 jobs tournent et les purges repondent 200.`)
  if (warn > 0) console.log(`${YELLOW}${warn} avertissement(s) non bloquant(s) ci-dessus.${RESET}`)
} else {
  console.log(`${RED}${BOLD}${ko} JOB(S) EN DEFAUT${RESET} — voir le detail ci-dessus.`)
  // Les crons Vercel ont ete retires : pg_cron est le SEUL ordonnanceur. Il n'y
  // a plus de filet automatique — le rattrapage est manuel, et c'est ici qu'il
  // doit etre rappele, au moment exact ou le diagnostic vire au rouge.
  console.log()
  console.log(`${YELLOW}${BOLD}PLUS AUCUN FILET AUTOMATIQUE${RESET} — pg_cron est le seul ordonnanceur.`)
  console.log(`${DIM}Rattraper la nuit manquee A LA MAIN (les deux routes sont idempotentes,${RESET}`)
  console.log(`${DIM}un passage en double ne casse rien) :${RESET}`)
  console.log()
  console.log(`  curl -X POST "$SITE_URL/api/cron/purge-deletions" -H "Authorization: Bearer $CRON_SECRET"`)
  console.log(`  curl -X POST "$SITE_URL/api/cron/purge-inactive"  -H "Authorization: Bearer $CRON_SECRET"`)
  console.log()
  console.log(`${DIM}SITE_URL = origine de l'app (sans slash final), CRON_SECRET = variable Vercel.${RESET}`)
  console.log(`${DIM}Attendu : HTTP 200 + un JSON de compte-rendu. 401 => secret errone.${RESET}`)
}
process.exit(ko === 0 ? 0 : 1)
