/**
 * diag-validation-annonces.mjs — LA VALIDATION DES ANNONCES PAR L'ADMINISTRATEUR DIT VRAI (lot S3, puis la relecture de
 * l'ARRÊT 28, points 6 à 9). CONTRÔLE BLOQUANT.
 *
 * CE QU'IL VÉRIFIE (une section par point de la relecture) :
 *   6. une décision DÉJÀ PRISE (un autre onglet, un autre administrateur) recharge vraiment la fiche — les boutons
 *      disparaissent avec le statut — et le dit APRÈS le rechargement (qui efface les erreurs) ;
 *   … les sections suivantes s'ajoutent avec leur point.
 * L'ÉPREUVE, INTÉGRÉE : chaque règle est rejouée sur une copie MUTÉE et doit rougir.
 *
 * CE QU'IL NE VOIT PAS : un navigateur (il lit le code de l'écran, pas son rendu) ; la base.
 *
 * Sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
// §E.7 : un commentaire ne prouve rien.
const sansCommentaires = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/ .*$/, ''))).join('\n')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (t) => console.log(`\n── ${t}`)

const F = {
  fiche: 'app/[locale]/admin/annonces/[id]/page.tsx',
  valider: 'app/api/admin/annonces/[id]/valider/route.ts',
  refuser: 'app/api/admin/annonces/[id]/refuser/route.ts',
  liste: 'app/api/admin/annonces/route.ts',
  ecranListe: 'app/[locale]/admin/annonces/page.tsx',
  phrase: 'lib/journal/phrase.ts',
  routeFiche: 'app/api/admin/annonces/[id]/route.ts',
  migration: 'supabase/migrations/20261003030000_validation_annonces.sql',
}
let REELS
try {
  REELS = Object.fromEntries(Object.entries(F).map(([k, p]) => [k, sansCommentaires(lire(p))]))
} catch (err) {
  console.error('✘ un fichier du contrôle est illisible — le contrôle ne tourne pas', err.message)
  process.exit(2)
}

/** Les règles, jugées sur des textes (réels, ou mutés par l'épreuve). Rend la liste des fautes. */
function juger(t) {
  const fautes = []
  // 6 — DÉJÀ TRANCHÉE : la fiche se recharge, puis le dit.
  const dt = /const dejaTranchee = async \(\) => \{([\s\S]*?)\n  \}/.exec(t.fiche)?.[1] ?? ''
  const iLoad = dt.indexOf('await load()')
  const iDit = dt.search(/setIssue\(\{[^}]*t\('erreurs\.already_processed'\)/)
  if (iLoad < 0 || iDit < 0 || iDit < iLoad) fautes.push('6. « déjà tranchée » ne recharge pas la fiche AVANT de le dire (load() efface les erreurs)')
  const appels = (t.fiche.match(/if \(!res\.ok && p\.code === 'already_processed'\) \{ await dejaTranchee\(\); return \}/g) ?? []).length
  if (appels !== 2) fautes.push(`6. valider ET refuser doivent recharger sur « déjà tranchée » (vu : ${appels} sur 2)`)
  if (!/const enRevue = a\.status === 'pending_review'/.test(t.fiche)) fautes.push('6. les boutons ne dépendent plus du statut relu')
  // 8 — « SOUMISE LE » DIT LA SOUMISSION, jamais la dernière écriture.
  if (/soumise_le', \{ date: formatDate\(a\.updated_at\)/.test(t.fiche) || !/t\('fiche\.soumise_le', \{ date: formatDate\(a\.soumise_le\) \}\)/.test(t.fiche)) {
    fautes.push('8. la fiche date la soumission par updated_at (la dernière écriture)')
  }
  if (!/soumise_le: pub\.soumise_le/.test(t.routeFiche) || !/: r\.status === 'pending_review' \? r\.soumise_le/.test(t.liste)) {
    fautes.push('8. la fiche ou la liste ne servent plus la date de soumission')
  }
  if (!/soumise_le\s*= case when v_par_admin then p\.soumise_le else now\(\) end/.test(t.migration)) {
    fautes.push('8. publier_annonce ne pose plus la date de soumission sur la voie automatique, ou la réécrit sur la voie administrateur')
  }
  // 7 — JAMAIS JUGÉE ≠ « 0/10 », dans la liste comme au journal.
  if (!/raisonsDuVerdict\(r\.verification_data, r\.verification_score\)/.test(t.liste) || !/non_jugee: r2\.non_aboutie/.test(t.liste)
      || !/'id, type, title, status, verification_score, verification_data,/.test(t.liste)) {
    fautes.push('7. la liste ne lit plus le verdict par raisonsDuVerdict (une vérification qui n’a pas jugé redevient « 0/10 »)')
  }
  if (!/\{r\.non_jugee && \(/.test(t.ecranListe) || !/\{!r\.non_jugee && r\.note != null && \(/.test(t.ecranListe) || !/t\('admin\.non_jugee'\)/.test(t.ecranListe)) {
    fautes.push('7. l’écran de la liste affiche une note pour une annonce non jugée, ou ne dit plus « non jugée »')
  }
  if (!/const nonJugee = note === 0/.test(t.phrase) || (t.phrase.match(/non_jugee`/g) ?? []).length < 3 || !/note === 0\s*\?\s*\{ cle: `annonce_refusee\.\$\{genre\}_non_jugee`/.test(t.phrase)) {
    fautes.push('7. le journal dit encore « 0/10 » pour une annonce que la vérification automatique n’a pas jugée')
  }
  return fautes
}

section('6 à 9. La validation des annonces, sur le code réel')
{
  const fautes = juger(REELS)
  ok(fautes.length === 0, 'la fiche et les routes de validation disent vrai', fautes.join(' · '))
}

section('L’épreuve : chaque mutation fait rougir le contrôle')
{
  const muter = (cle, a, b) => {
    if (!REELS[cle].includes(a)) return null
    return { ...REELS, [cle]: REELS[cle].replace(a, () => b) }
  }
  const EPREUVES = [
    ['« déjà tranchée » qui ne recharge plus la fiche', () => muter('fiche', '    await load()\n    setIssue({', '    setIssue({')],
    ['la liste qui sert la note brute', () => muter('liste', 'return { note: r2.note, non_jugee: r2.non_aboutie }', 'return { note: r.verification_score, non_jugee: false }')],
    ['l’écran qui affiche la note d’une annonce non jugée', () => muter('ecranListe', '{!r.non_jugee && r.note != null && (', '{r.note != null && (')],
    ['le journal qui redit « 0/10 »', () => muter('phrase', 'const nonJugee = note === 0', 'const nonJugee = false')],
    ['« soumise le » redevenu updated_at', () => muter('fiche', 'formatDate(a.soumise_le)', 'formatDate(a.updated_at)')],
    ['la validation qui réécrit la date de soumission', () => muter('migration', 'case when v_par_admin then p.soumise_le else now() end', 'now()')],
    ['le refus qui oublie « déjà tranchée »', () => muter('fiche', "      if (!res.ok && p.code === 'already_processed') { await dejaTranchee(); return }\n      if (!res.ok) {\n        if (p.code === 'motif_requis'", "      if (!res.ok) {\n        if (p.code === 'motif_requis'")],
  ]
  for (const [nom, fabriquer] of EPREUVES) {
    const t = fabriquer()
    if (!t) { ok(false, `épreuve « ${nom} » : le texte à muter est introuvable — l’épreuve ne mord plus`); continue }
    const fautes = juger(t)
    ok(fautes.length > 0, `épreuve « ${nom} » : le contrôle rougit (${(fautes[0] ?? '').slice(0, 90)}…)`)
  }
}

console.log(`\n${echecs === 0 ? '✅ diag-validation-annonces : la validation des annonces dit vrai.' : `❌ diag-validation-annonces : ${echecs} contrôle(s) rouge(s).`}`)
process.exitCode = echecs === 0 ? 0 : 1
