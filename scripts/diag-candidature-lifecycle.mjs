// scripts/diag-candidature-lifecycle.mjs
//
// Vérifie la TABLE DE DÉRIVATION de l'état de vie d'une candidature
// (lib/candidatures/lifecycle.ts), sans base de données : le module est pur.
//
//   node scripts/diag-candidature-lifecycle.mjs
//
// Ne remplace pas un framework de test (il n'y en a pas dans ce repo) — c'est
// un diagnostic exécutable dans la lignée des autres scripts/diag-*.mjs.
//
// Le cas critique vérifié ici est le TROU HISTORIQUE : une candidature
// JAMAIS DÉBLOQUÉE n'avait aucune fenêtre propre et vivait indéfiniment.
// Depuis l'expiration des annonces à 30 j, elle DOIT basculer archivée avec
// la raison « Cette annonce a expiré ».

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// ── Compilation du module TS en ESM temporaire (pas de runner TS au repo) ──
//  tsc en ligne de commande ignore les `paths` du tsconfig : les imports en
//  '@/lib/...' remontent en TS2307. On laisse tsc ÉMETTRE malgré l'erreur
//  (noEmitOnError est false par défaut) puis on réécrit les spécifieurs.
const outDir = mkdtempSync(join(tmpdir(), 'sk-lifecycle-'))
try {
  execFileSync(
    'npx',
    ['tsc',
      'lib/candidatures/lifecycle.ts', 'lib/publications/expiry.ts', 'lib/conversations/expiry.ts',
      '--outDir', outDir, '--module', 'esnext', '--target', 'es2022',
      '--moduleResolution', 'bundler', '--skipLibCheck'],
    { stdio: 'pipe', shell: process.platform === 'win32' },
  )
} catch {
  /* TS2307 attendu — seule l'émission compte, vérifiée juste après. */
}
const lifecyclePath = join(outDir, 'candidatures', 'lifecycle.js')
if (!existsSync(lifecyclePath)) {
  console.error('Compilation échouée :', lifecyclePath, 'absent.')
  process.exit(1)
}
writeFileSync(
  lifecyclePath,
  readFileSync(lifecyclePath, 'utf8')
    .replace('@/lib/publications/expiry', '../publications/expiry.js')
    .replace('@/lib/conversations/expiry', '../conversations/expiry.js'),
)
const { deriveCandidatureLifecycle, parseBucketFilter } = await import(pathToFileURL(lifecyclePath).href)

const NOW = new Date('2026-08-08T12:00:00.000Z')
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 3600 * 1000).toISOString()
const daysAhead = (n) => new Date(NOW.getTime() + n * 24 * 3600 * 1000).toISOString()

const openPub = { status: 'published', published_at: daysAgo(5), expires_at: null }
const expiredPub = { status: 'published', published_at: daysAgo(31), expires_at: null }
const closedPub = { status: 'archived', published_at: daysAgo(5), expires_at: null }

const CASES = [
  // ── bucket 'active' ──────────────────────────────────────────────────
  ['selected — annonce expirée, sans effet',
    { status: 'selected', publication: expiredPub }, 'active', 'selected'],
  ['unlocked — fenêtre 15 j encore ouverte',
    { status: 'unlocked', unlocked_at: daysAgo(2), publication: openPub, conversation: { expires_at: daysAhead(13) } },
    'active', 'exchange_open'],
  ['unlocked — annonce expirée mais échange vivant (l’échange prime)',
    { status: 'unlocked', unlocked_at: daysAgo(2), publication: expiredPub, conversation: { expires_at: daysAhead(13) } },
    'active', 'exchange_open'],
  ['received — annonce encore ouverte',
    { status: 'received', publication: openPub }, 'active', 'awaiting_review'],
  ['in_review — annonce encore ouverte',
    { status: 'in_review', publication: openPub }, 'active', 'awaiting_review'],
  ['shortlisted (vestigial) — annonce encore ouverte',
    { status: 'shortlisted', publication: openPub }, 'active', 'awaiting_review'],

  // ── bucket 'archived' — LE TROU COMBLÉ ───────────────────────────────
  ['received + annonce EXPIRÉE  ← trou historique',
    { status: 'received', publication: expiredPub }, 'archived', 'publication_expired'],
  ['in_review + annonce EXPIRÉE ← trou historique',
    { status: 'in_review', publication: expiredPub }, 'archived', 'publication_expired'],
  ['received + annonce RETIRÉE par l’org',
    { status: 'received', publication: closedPub }, 'archived', 'publication_closed'],
  ['received + publication introuvable',
    { status: 'received', publication: null }, 'archived', 'publication_closed'],
  ['unlocked — fenêtre 15 j écoulée, aucune sélection',
    { status: 'unlocked', unlocked_at: daysAgo(20), publication: openPub, conversation: { expires_at: daysAgo(5) } },
    'archived', 'exchange_expired'],
  ['unlocked — pas de ligne conversation, repli unlocked_at + 15 j écoulé',
    { status: 'unlocked', unlocked_at: daysAgo(20), publication: openPub, conversation: null },
    'archived', 'exchange_expired'],
  ['rejected — terminal explicite, prime sur toute horloge',
    { status: 'rejected', publication: openPub }, 'archived', 'rejected'],
  ['withdrawn (vestigial)', { status: 'withdrawn', publication: openPub }, 'archived', 'withdrawn'],
  ['archived (vestigial)', { status: 'archived', publication: openPub }, 'archived', 'archived'],

  // ── repli défensif : on n'archive JAMAIS par ignorance ───────────────
  ['unlocked sans conversation ni unlocked_at — reste actif, sans date',
    { status: 'unlocked', unlocked_at: null, publication: openPub, conversation: null },
    'active', 'exchange_open'],
]

let failed = 0
console.log('\nTABLE DE DÉRIVATION — état de vie des candidatures\n' + '='.repeat(78))
for (const [label, input, expectedBucket, expectedReason] of CASES) {
  const got = deriveCandidatureLifecycle(input, NOW)
  const ok = got.bucket === expectedBucket && got.reason === expectedReason
  if (!ok) failed++
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} | ${expectedBucket.padEnd(8)} | ${String(got.reason).padEnd(19)} | ${label}` +
    (got.until ? `\n     └─ fenêtre visible jusqu'au ${got.until}` : '') +
    (ok ? '' : `\n     └─ ATTENDU ${expectedBucket}/${expectedReason}, OBTENU ${got.bucket}/${got.reason}`),
  )
}

// ── Filtre : ACTIVES PAR DÉFAUT sur les deux menus ──────────────────────
console.log('\nFILTRE ?filter=\n' + '='.repeat(78))
const FILTERS = [
  [undefined, 'active'], [null, 'active'], ['', 'active'], ['nimportequoi', 'active'],
  ['active', 'active'], ['archived', 'archived'], ['all', null],
]
for (const [raw, expected] of FILTERS) {
  const got = parseBucketFilter(raw)
  const ok = got === expected
  if (!ok) failed++
  console.log(`${ok ? 'OK  ' : 'FAIL'} | parseBucketFilter(${JSON.stringify(raw)}) = ${JSON.stringify(got)}`)
}

rmSync(outDir, { recursive: true, force: true })
console.log('\n' + '='.repeat(78))
console.log(failed === 0 ? `TOUS LES CAS PASSENT (${CASES.length + FILTERS.length})` : `${failed} CAS EN ÉCHEC`)
process.exit(failed === 0 ? 0 : 1)
