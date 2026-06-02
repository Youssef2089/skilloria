#!/usr/bin/env node
// scripts/diag-supabase.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic forensique : NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
// dans .env.local + appel test direct à PostgREST.
//
// Usage : node scripts/diag-supabase.mjs (depuis la racine du repo)
//
// NE RÉVÈLE JAMAIS la valeur des secrets — seulement présence, longueur,
// préfixe attendu, caractères invisibles éventuels.
//
// Aucune dépendance externe (Node 20+ pour fetch natif).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const BLUE = '\x1b[36m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

const envPath = resolve(process.cwd(), '.env.local')

console.log(`${BOLD}=== diag-supabase — env + REST live test ===${RESET}`)
console.log(`Working dir : ${process.cwd()}`)
console.log(`Env file    : ${envPath}`)
console.log()

if (!existsSync(envPath)) {
  console.log(`${RED}✗ .env.local introuvable à ${envPath}${RESET}`)
  process.exit(1)
}

const raw = readFileSync(envPath, 'utf8')

// ─── Parseur minimal d'env (KEY=VALUE, quotes simples/doubles, # comments) ──
function parseEnv(text) {
  const map = new Map()
  // Strip BOM si présent
  const noBom = text.replace(/^﻿/, '')
  const lines = noBom.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1)
    // Préserve les espaces autour pour l'audit
    // Retire un éventuel guillemet englobant
    let quoteKind = null
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      quoteKind = value[0]
      value = value.slice(1, -1)
    }
    map.set(key, { value, lineNo: i + 1, raw: line, quoteKind })
  }
  return map
}

// ─── Audit d'une valeur sans la révéler ─────────────────────────────────────
function auditValue(label, entry, expectedPrefix) {
  console.log(`${BOLD}${label}${RESET}`)
  if (!entry) {
    console.log(`  ${RED}✗ Absent de .env.local${RESET}`)
    console.log()
    return null
  }
  const { value, lineNo, raw, quoteKind } = entry
  console.log(`  Ligne #${lineNo} : ${DIM}${raw.length > 40 ? raw.slice(0, 30) + '…[redacted]' : raw.replace(/=.*/, '=…[redacted]')}${RESET}`)
  console.log(`  Présent       : ${GREEN}oui${RESET}`)
  console.log(`  Longueur      : ${value.length} caractères`)
  if (quoteKind) {
    console.log(`  Quotes        : ${YELLOW}${quoteKind} (guillemets retirés au parsing — Next.js ne les attend PAS, vérifier que c'est voulu)${RESET}`)
  } else {
    console.log(`  Quotes        : ${GREEN}aucune${RESET}`)
  }
  // Espaces / caractères invisibles
  const leading = value.match(/^\s+/)?.[0] ?? ''
  const trailing = value.match(/\s+$/)?.[0] ?? ''
  if (leading.length || trailing.length) {
    const leadHex = Array.from(leading).map(c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
    const trailHex = Array.from(trailing).map(c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
    console.log(`  ${RED}✗ Espaces autour : leading=[${leadHex}] (${leading.length}) trailing=[${trailHex}] (${trailing.length})${RESET}`)
    console.log(`    ${YELLOW}→ Cause probable de "No API key found" si l'apikey est strippé/rejeté${RESET}`)
  } else {
    console.log(`  Whitespace    : ${GREEN}propre${RESET}`)
  }
  // Caractères non-imprimables internes (BOM, NUL, CR isolé, etc.)
  const nonPrintable = value.match(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g)
  if (nonPrintable) {
    const hex = nonPrintable.map(c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
    console.log(`  ${RED}✗ Caractères non-imprimables internes : ${nonPrintable.length} × [${hex}]${RESET}`)
  } else {
    console.log(`  Caractères    : ${GREEN}imprimables uniquement${RESET}`)
  }
  // Préfixe attendu
  const trimmedValue = value.trim()
  if (expectedPrefix && !trimmedValue.startsWith(expectedPrefix)) {
    console.log(`  ${RED}✗ Préfixe attendu '${expectedPrefix}…' — observé '${trimmedValue.slice(0, expectedPrefix.length)}…'${RESET}`)
  } else if (expectedPrefix) {
    console.log(`  Préfixe       : ${GREEN}${expectedPrefix}…${RESET} ✓`)
  }
  console.log()
  return trimmedValue.length > 0 ? trimmedValue : null
}

const envMap = parseEnv(raw)

console.log(`${BLUE}─── Variables NEXT_PUBLIC_ ───${RESET}`)
console.log()

const url = auditValue(
  'NEXT_PUBLIC_SUPABASE_URL',
  envMap.get('NEXT_PUBLIC_SUPABASE_URL'),
  'https://',
)
const anonKey = auditValue(
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  envMap.get('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  'eyJ',
)

console.log(`${BLUE}─── Appel test PostgREST (vérité-terrain) ───${RESET}`)
console.log()

if (!url || !anonKey) {
  console.log(`${RED}✗ URL ou clé manquante — appel test sauté.${RESET}`)
  console.log()
  console.log(`${BOLD}VERDICT${RESET}`)
  console.log(`  ${RED}Cause du 500 "No API key found" : la clé anon est absente/vide dans .env.local${RESET}`)
  console.log(`  ${YELLOW}Fix : compléter NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ… dans .env.local puis redémarrer le dev server.${RESET}`)
  process.exit(2)
}

const testUrl = `${url.replace(/\/$/, '')}/rest/v1/profiles?select=id&limit=1`
console.log(`Endpoint    : ${testUrl}`)
console.log(`Headers     : apikey + Authorization Bearer (mêmes valeurs)`)
console.log()

let status = 0
let bodyText = ''
let timing = 0
const t0 = Date.now()
try {
  const res = await fetch(testUrl, {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  })
  timing = Date.now() - t0
  status = res.status
  // On lit le body mais on ne LOGGE PAS les données métier ; uniquement
  // le message d'erreur PostgREST s'il y en a un.
  bodyText = await res.text()
} catch (err) {
  timing = Date.now() - t0
  console.log(`${RED}✗ fetch a throw : ${err?.message ?? err}${RESET}`)
  console.log(`  Durée : ${timing} ms`)
  console.log()
  console.log(`${BOLD}VERDICT${RESET}`)
  console.log(`  ${RED}Le runtime Node ne peut pas joindre ${url}.${RESET}`)
  console.log(`  ${YELLOW}Vérifier la connectivité réseau / DNS / pare-feu.${RESET}`)
  process.exit(3)
}

console.log(`Status HTTP : ${status === 200 ? `${GREEN}${status}${RESET}` : `${RED}${status}${RESET}`}`)
console.log(`Durée       : ${timing} ms`)

// Extraction du message d'erreur PostgREST s'il existe, SANS exposer les data
let pgrstMsg = null
let pgrstHint = null
try {
  const parsed = JSON.parse(bodyText)
  if (parsed && typeof parsed === 'object') {
    if ('message' in parsed) pgrstMsg = String(parsed.message)
    if ('hint' in parsed) pgrstHint = String(parsed.hint)
  }
} catch {
  /* corps non-JSON */
}
if (pgrstMsg) {
  console.log(`Message     : ${YELLOW}${pgrstMsg}${RESET}`)
  if (pgrstHint) console.log(`Hint        : ${DIM}${pgrstHint}${RESET}`)
} else if (status === 200) {
  // On compte les caractères pour confirmer qu'on a reçu un corps sans le révéler
  console.log(`Body        : ${GREEN}${bodyText.length} octets reçus (données non affichées)${RESET}`)
}
console.log()

console.log(`${BOLD}VERDICT${RESET}`)
if (status === 200) {
  console.log(`  ${GREEN}✓ La clé anon dans .env.local FONCTIONNE contre PostgREST.${RESET}`)
  console.log()
  console.log(`  ${YELLOW}Conclusion :${RESET} le bug "No API key found" côté browser n'est PAS dû à la clé`)
  console.log(`  elle-même. Le bundle JS client a été produit avec une autre valeur (ou undefined) :`)
  console.log(`  ${BOLD}→ Tuer et relancer ${GREEN}npm run dev${RESET}${BOLD} pour rebuilder le bundle client.${RESET}`)
  console.log(`  → Hard-refresh navigateur (Ctrl+Shift+R) pour vider le cache JS.`)
  process.exit(0)
}
if (status === 401 || (pgrstMsg && /no api key|invalid api key|jwt/i.test(pgrstMsg))) {
  console.log(`  ${RED}✗ La clé anon dans .env.local NE FONCTIONNE PAS contre PostgREST.${RESET}`)
  console.log()
  console.log(`  ${YELLOW}Causes possibles :${RESET}`)
  console.log(`    a) clé du mauvais projet Supabase (URL et anon key ne sont pas cohérentes)`)
  console.log(`    b) clé rotée côté Supabase Dashboard et pas mise à jour ici`)
  console.log(`    c) caractères invisibles dans la ligne .env.local (cf. audit ci-dessus)`)
  console.log()
  console.log(`  ${BOLD}Fix :${RESET} récupérer la bonne anon key dans Supabase Dashboard → Settings →`)
  console.log(`  API → Project API keys → anon public, puis la coller telle quelle dans .env.local`)
  console.log(`  (sans guillemets, sans espace autour du =).`)
  process.exit(4)
}
console.log(`  ${YELLOW}Status inattendu ${status}.${RESET} Examiner manuellement la réponse PostgREST.`)
process.exit(5)
