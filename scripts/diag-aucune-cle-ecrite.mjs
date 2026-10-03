#!/usr/bin/env node
// scripts/diag-aucune-cle-ecrite.mjs — AUCUNE CLÉ NI AUCUN JETON ÉCRITS DANS LE DÉPÔT (lot DevOps CI, 03/10/2026).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI : la détection de clés de GitHub (« Secret Protection ») n'est pas offerte sur un dépôt PRIVÉ d'un
//   compte personnel — elle est réservée aux organisations (docs/integration-continue.md, « Sécurité du dépôt »).
//   Ce contrôle la remplace pour ce qui compte ici : les clés des fournisseurs que le produit utilise. Il tourne
//   dans la série (scripts/diag.mjs), donc sur chaque demande de fusion, et sur le poste avant un commit.
//
// CE QU'IL FAIT : chaque fichier SUIVI par git (`git ls-files`), lu en entier, contre des motifs à FORTE
//   confiance — une forme qu'une clé réelle a et qu'un texte ordinaire n'a pas :
//   Stripe (sk_live_, sk_test_, rk_, whsec_), Anthropic (sk-ant-), Resend (re_…_…), Supabase (sb_secret_, et un
//   jeton JWT dont la charge dit `service_role`), GitHub (ghp_, github_pat_), AWS (AKIA…), une clé privée PEM,
//   une adresse Postgres avec mot de passe vers un hôte qui n'est pas la machine locale.
//   Un JWT `anon` n'est PAS signalé : c'est la clé publique du navigateur.
//
// CE QU'IL NE VOIT PAS, ET LE DIT : une clé sans forme reconnaissable (Cohere, Vonage : des chaînes nues) ;
//   l'HISTORIQUE git (une clé retirée d'un fichier reste dans les commits passés — elle se RÉVOQUE, elle ne
//   s'efface pas) ; les fichiers non suivis (`.env.local` ne doit jamais l'être : `.gitignore`).
//
//   node scripts/diag-aucune-cle-ecrite.mjs      → statique, aucun accès base, aucun réseau.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}

/** Les motifs. Chacun s'écrit par MORCEAUX : ce fichier ne doit pas se dénoncer lui-même. */
const m = (...parts) => new RegExp(parts.join(''), 'g')
const MOTIFS = [
  { nom: 'clé Stripe', re: m('\\b(?:sk|rk)_(?:live|test)_', '[0-9A-Za-z]{20,}') },
  { nom: 'clé de webhook Stripe', re: m('\\bwhsec_', '[0-9A-Za-z]{20,}') },
  { nom: 'clé Anthropic', re: m('\\bsk-ant-', '[A-Za-z0-9_-]{20,}') },
  { nom: 'clé Resend', re: m('\\bre_', '[A-Za-z0-9]{6,}_[A-Za-z0-9]{12,}') },
  { nom: 'clé de service Supabase', re: m('\\bsb_secret_', '[A-Za-z0-9_-]{16,}') },
  { nom: 'jeton GitHub', re: m('\\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_', '[A-Za-z0-9_]{40,})') },
  { nom: 'clé AWS', re: m('\\bAKIA', '[0-9A-Z]{16}\\b') },
  { nom: 'clé privée', re: m('-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIV', 'ATE KEY-----') },
  { nom: 'adresse Postgres avec mot de passe', re: m('postgres(?:ql)?://[^\\s:/@]+:[^\\s@]{6,}@(?!127\\.0\\.0\\.1|localhost|\\[::1\\])', '[^\\s/:]+') },
]
const JWT = m('\\beyJ[A-Za-z0-9_-]{10,}\\.', 'eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{16,}')

/** Un JWT est à protéger si sa charge dit `service_role` (la clé de service de Supabase). */
function jwtDeService(jeton) {
  try {
    const charge = JSON.parse(Buffer.from(jeton.split('.')[1], 'base64url').toString('utf8'))
    return charge?.role === 'service_role'
  } catch {
    return false
  }
}
const mord = (re, texte) => { re.lastIndex = 0; const r = re.test(texte); re.lastIndex = 0; return r }

// Les fichiers que la machine produit ou qui ne portent que des empreintes : rien à y lire.
const IGNORES = [/^package-lock\.json$/, /^node_modules\//, /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|zip|gz)$/i]

let fichiers = null
try {
  fichiers = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean).filter((f) => !IGNORES.some((re) => re.test(f)))
} catch (e) {
  console.log(`  KO   git ls-files impossible — le contrôle N'A PAS TOURNÉ (${e.message})`)
  process.exitCode = 2
}

if (fichiers) {
  console.log(`\n═══ Aucune clé ni aucun jeton dans les ${fichiers.length} fichiers suivis par git ═══\n`)
  const trouves = []
  for (const f of fichiers) {
    let texte
    try {
      if (statSync(join(ROOT, f)).size > 5 * 1024 * 1024) continue
      texte = readFileSync(join(ROOT, f), 'utf8')
    } catch { continue } // supprimé du disque mais encore indexé : rien à lire
    for (const { nom, re } of MOTIFS) {
      for (const x of texte.matchAll(re)) trouves.push(`${f} : ${nom} (« ${x[0].slice(0, 12)}… »)`)
    }
    for (const x of texte.matchAll(JWT)) if (jwtDeService(x[0])) trouves.push(`${f} : jeton de service Supabase (JWT service_role)`)
  }
  ok(trouves.length === 0, 'aucune clé de fournisseur, aucun jeton de service, aucune clé privée, aucune adresse de base avec mot de passe',
    trouves.slice(0, 20).join(' · ') + (trouves.length > 20 ? ` · … (${trouves.length} en tout)` : '') +
    (trouves.length ? ' — RÉVOQUEZ la clé chez le fournisseur : la retirer du fichier ne la retire pas de l’historique.' : ''))

  // L'épreuve du contrôle lui-même : chaque motif reconnaît une clé FABRIQUÉE de sa forme (§G.5 — un contrôle
  // qui ne sait plus mordre reste vert). Les exemples sont assemblés à l'exécution, jamais écrits en entier.
  const x = (n) => 'A1b2C3d4E5f6G7h8J9k0'.repeat(3).slice(0, n)
  const exemples = {
    'clé Stripe': 'sk_' + 'live_' + x(24), 'clé de webhook Stripe': 'whsec' + '_' + x(24),
    'clé Anthropic': 'sk-' + 'ant-' + x(30), 'clé Resend': 're' + '_' + x(8) + '_' + x(20),
    'clé de service Supabase': 'sb_' + 'secret_' + x(20), 'jeton GitHub': 'gh' + 'p_' + x(36),
    'clé AWS': 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP', 'clé privée': '-----BEGIN ' + 'PRIVATE KEY-----',
    'adresse Postgres avec mot de passe': 'postgresql://' + 'postgres:' + x(12) + '@db.exemple.supabase.co',
  }
  const muets = MOTIFS.filter(({ nom, re }) => !mord(re, exemples[nom])).map((p) => p.nom)
  ok(muets.length === 0, `chaque motif (${MOTIFS.length}) reconnaît une clé fabriquée de sa forme`, muets.join(', '))
  const charge = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const service = `eyJ${x(12)}.${charge({ role: 'service_role', iss: 'supabase' })}.${x(20)}`
  const publique = `eyJ${x(12)}.${charge({ role: 'anon', iss: 'supabase' })}.${x(20)}`
  ok(mord(JWT, service) && jwtDeService(service) && !jwtDeService(publique), 'un JWT service_role est signalé, un JWT anon (la clé publique) ne l’est pas')
  const pg = MOTIFS.find((p) => p.nom === 'adresse Postgres avec mot de passe').re
  ok(!mord(pg, 'postgresql://postgres:' + 'postgres@127.0.0.1:54322/postgres'), 'l’adresse de la base LOCALE (127.0.0.1) n’est pas signalée')

  console.log(failures === 0 ? '\n✅ Aucune clé ni aucun jeton écrits dans le dépôt.' : '\n✘ Une clé est écrite dans le dépôt — révoquez-la, puis retirez-la.')
  process.exitCode = failures === 0 ? 0 : 1
}
