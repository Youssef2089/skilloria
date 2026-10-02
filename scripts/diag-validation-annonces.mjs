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
  // 9 — DEUX VALIDATIONS EN MÊME TEMPS : la seconde lit « déjà traitée », et ne rend pas la place de la première.
  const blocReserve = /if \(reserve !== true\) \{([\s\S]*?)\n    \}\n    placeReservee = true/.exec(t.valider)?.[1] ?? ''
  const iRelu = blocReserve.search(/if \(statut !== STATUT_EN_REVUE\) \{\s*return json\(\{[^}]*code: 'already_processed' \}, 409\)/)
  const iPlafond = blocReserve.indexOf("code: 'active_publications_limit_reached'")
  if (iRelu < 0 || iPlafond < 0 || iRelu > iPlafond) fautes.push('9. une réservation perdue au profit d’une validation simultanée se dit encore « plafond atteint »')
  // 9 bis (contre-relecture de l'ARRÊT 28, point C ; §E.22) — UNE RELECTURE EN PANNE N'EST PAS UNE DÉCISION : elle se dit
  // (503 `statut_illisible`) AVANT « déjà tranchée » et « plafond atteint », et l'écran propose de réessayer.
  const iPanne = blocReserve.search(/const statut = await statutRelu\(\)\s*if \(statut === null\) \{\s*return json\(\{[^}]*code: 'statut_illisible' \}, 503\)/)
  if (iPanne < 0 || (iRelu >= 0 && iPanne > iRelu)) fautes.push('9 bis. une relecture du statut en panne se dit « déjà tranchée » (ou « plafond atteint ») au lieu de la panne')
  if (!/if \(error\) \{[^}]*return null \}\s*return \(data as \{ status\?: string \} \| null\)\?\.status \?\? 'introuvable'/.test(t.valider)) {
    fautes.push('9 bis. statutRelu ne distingue plus la panne (null) d’une annonce disparue')
  }
  if (!/'statut_illisible'\] as const/.test(t.fiche) || !/setReessaiValidation\(p\.code === 'statut_illisible'\)/.test(t.fiche)
      || !/\{reessaiValidation && \(\s*<button[\s\S]{0,200}?onClick=\{\(\) => \{ void valider\(\) \}\}/.test(t.fiche) || !/\{t\('erreurs\.reessayer'\)\}/.test(t.fiche)) {
    fautes.push('9 bis. l’écran ne dit pas la panne de relecture, ou ne propose pas de réessayer la validation')
  }
  const blocNul = /if \(!miseEnLigne\) \{([\s\S]*?)\n  \}/.exec(t.valider)?.[1] ?? ''
  if (!/const statut = await statutRelu\(\)\s*if \(statut !== null && statut !== 'published'\) await rendreLaPlace\(/.test(blocNul) || /^\s*await rendreLaPlace\(/m.test(blocNul)) {
    fautes.push('9. la seconde validation rend la place d’une annonce que la première vient de mettre en ligne')
  }
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
  // Le journal suit la MÊME règle que la liste (contre-relecture de l'ARRÊT 28, point B) : note 0 ET aucun signalement ⇒
  // « non jugée » ; un vrai 0/10 (des signalements) se lit 0/10. Le compte des signalements est écrit par la base.
  const nd = /function noteDuVerdict\(d: Record<string, unknown>\): number \| 'non_jugee' \| null \{([\s\S]*?)\n\}/.exec(t.phrase)?.[1] ?? ''
  if (!/const note = nombre\(d\.verification_score\)\s*if \(note !== 0\) return note\s*const signalements = nombre\(d\.nb_signalements\)\s*if \(signalements === null\) return null\s*return signalements === 0 \? 'non_jugee' : 0/.test(nd)) {
    fautes.push('7. le journal ne lit plus « non jugée » comme la liste (note 0 ET aucun signalement) — un vrai 0/10 deviendrait « non jugée », ou l’inverse')
  }
  if ((t.phrase.match(/const note = noteDuVerdict\(d\)/g) ?? []).length !== 2 || !/const nonJugee = note === 'non_jugee'/.test(t.phrase)
      || !/note === 'non_jugee'\s*\?\s*\{ cle: `annonce_refusee\.\$\{genre\}_non_jugee`/.test(t.phrase) || /nonJugee = note === 0/.test(t.phrase)) {
    fautes.push('7. une mise en ligne ou un refus, au journal, ne passe plus par la règle commune (noteDuVerdict)')
  }
  const nbSignalements = (t.migration.match(/'nb_signalements', v_p\.nb_signalements/g) ?? []).length
  if (nbSignalements !== 2 || (t.migration.match(/where jsonb_typeof\(f\) = 'string'\) as nb_signalements/g) ?? []).length !== 2) {
    fautes.push(`7. publier_annonce et refuser_annonce n’écrivent pas toutes deux le nombre de signalements au journal (${nbSignalements})`)
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
    ['le journal qui redit « 0/10 »', () => muter('phrase', "const nonJugee = note === 'non_jugee'", 'const nonJugee = false')],
    ['le journal qui dit « non jugée » sur un vrai 0/10', () => muter('phrase', "return signalements === 0 ? 'non_jugee' : 0", "return 'non_jugee'")],
    ['le refus au journal qui ignore les signalements', () => muter('phrase', "      const note = noteDuVerdict(d)\n      const genre", "      const note = nombre(d.verification_score)\n      const genre")],
    ['le refus qui n’écrit plus le nombre de signalements', () => muter('migration', "      'verification_score', v_p.verification_score,\n      'nb_signalements', v_p.nb_signalements),", "      'verification_score', v_p.verification_score),")],
    ['« soumise le » redevenu updated_at', () => muter('fiche', 'formatDate(a.soumise_le)', 'formatDate(a.updated_at)')],
    ['la validation qui réécrit la date de soumission', () => muter('migration', 'case when v_par_admin then p.soumise_le else now() end', 'now()')],
    ['la place rendue sans relire le statut', () => muter('valider', "if (statut !== null && statut !== 'published') await rendreLaPlace(", "await rendreLaPlace(")],
    ['« plafond atteint » pour une validation simultanée', () => muter('valider', 'if (statut !== STATUT_EN_REVUE) {', 'if (false) {')],
    ['une relecture en panne dite « déjà tranchée »', () => muter('valider', 'if (statut === null) {', 'if (false) {')],
    ['statutRelu qui confond la panne et l’annonce disparue', () => muter('valider', "?.status ?? 'introuvable'", '?.status ?? null')],
    ['l’écran sans « Réessayer »', () => muter('fiche', "setReessaiValidation(p.code === 'statut_illisible')", 'setReessaiValidation(false)')],
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
