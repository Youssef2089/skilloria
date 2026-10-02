/**
 * diag-resoumission.mjs — UNE ANNONCE REFUSÉE SE MODIFIE ET SE SOUMET À NOUVEAU, SANS COMPTER DEUX FOIS (regroupement,
 * ARRÊT 28 — la resoumission laissée par S3 faute de périmètre ; décision de Youssef sur le compteur). CONTRÔLE BLOQUANT.
 *
 * LA RÈGLE : l'auteur d'une annonce refusée par l'administration (annonce d'une organisation ou besoin de sous-traitance)
 * la modifie ; elle repasse en BROUILLON — seulement si un champ change ; la publication qui suit fait juger le TEXTE
 * MODIFIÉ par la vérification automatique ; et cette nouvelle soumission ne compte pas une seconde fois dans les
 * publications du mois. Le message de refus le dit, dans les quatre langues.
 *
 * CE QU'IL VÉRIFIE :
 *   A. LA ROUTE D'ÉDITION (PATCH /api/publications/[id]) : `rejected` est éditable ; le statut ne s'écrit qu'à la
 *      resoumission (`rejected` → `draft`) ; une annonce refusée INCHANGÉE est refusée nommément AVANT toute écriture ;
 *      le motif est servi à l'auteur SEULEMENT pour une annonce refusée ;
 *   B. LA PUBLICATION (/publish) : la resoumission se reconnaît au motif de refus (`review_reason`) ; le compteur mensuel
 *      n'est pas consommé pour elle ; le contrôle de qualité n'est PAS sauté (il juge le texte modifié) ; la publication
 *      part toujours d'un brouillon (l'anti-relance tient) ;
 *   C. LE MARQUEUR EST SÛR : dans les migrations, la seule fonction qui POSE `publications.review_reason` est
 *      `refuser_annonce()`, et la voie administrateur de `publier_annonce()` l'efface ; aucun code de app/, lib/,
 *      components/ ne l'écrit ;
 *   D. LES ÉCRANS : la carte et la fiche d'annonce (organisation) mènent à « Modifier » pour une annonce refusée ; le
 *      formulaire la laisse se soumettre et montre son motif ; la fiche du besoin (expert) mène à la page de reprise, qui
 *      existe et reprend le formulaire du besoin ; le bandeau du motif est rendu par les quatre surfaces ;
 *   E. LES MESSAGES : le refus (cloche et e-mail) dit la resoumission et le compteur, dans les quatre langues, et garde
 *      ses variables ; le bandeau et le refus « inchangée » existent dans les quatre langues ;
 *   F. L'ÉPREUVE, INTÉGRÉE : le contrôle rejoué sur des copies MUTÉES doit rougir à chaque fois.
 *
 * CE QU'IL NE VOIT PAS : un navigateur ; la base (aucune migration dans ce geste — le marqueur est une colonne qui
 * existe) ; la justesse d'une traduction ; un compteur consommé ailleurs que dans /publish.
 *
 * Sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
// §E.7 : un commentaire ne prouve rien.
const sansCommentaires = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/ .*$/, ''))).join('\n')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
const sansCommentairesSql = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (t) => console.log(`\n── ${t}`)

const F = {
  patch: 'app/api/publications/[id]/route.ts',
  publish: 'app/api/publications/[id]/publish/route.ts',
  carte: 'components/dashboard/AnnonceCard.tsx',
  fiche: 'app/[locale]/dashboard/entreprise/annonces/[id]/page.tsx',
  formulaire: 'components/dashboard/PublicationForm.tsx',
  ficheBesoin: 'components/collaboration/SousTraitanceDetailView.tsx',
  vueBesoin: 'components/collaboration/SousTraitanceView.tsx',
  pageReprise: 'app/[locale]/dashboard/freelance/sous-traitance/[id]/modifier/page.tsx',
  pageRepriseCdi: 'app/[locale]/dashboard/cdi/sous-traitance/[id]/modifier/page.tsx',
  bandeau: 'components/annonces/MotifRefus.tsx',
  communs: 'lib/annonces/formulaire.ts',
}
const LANGUES = ['fr', 'en', 'es', 'de']
const MIGRATIONS = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()

function codeDuDepot() {
  const out = []
  const parcourir = (d) => {
    for (const e of readdirSync(join(ROOT, d))) {
      const p = `${d}/${e}`
      if (statSync(join(ROOT, p)).isDirectory()) { if (e !== 'node_modules') parcourir(p) }
      else if (/\.(ts|tsx)$/.test(e) && p !== 'lib/database.types.ts') out.push(p)
    }
  }
  for (const r of ['app', 'lib', 'components']) parcourir(r)
  return out
}

function textesReels() {
  const t = {}
  for (const p of Object.values(F)) t[p] = existsSync(join(ROOT, p)) ? sansCommentaires(lire(p)) : null
  t.__migrations = MIGRATIONS.map((f) => ({ f, sql: sansCommentairesSql(lire(`supabase/migrations/${f}`)) }))
  t.__code = codeDuDepot().map((p) => ({ p, src: sansCommentaires(lire(p)) }))
  t.__messages = Object.fromEntries(LANGUES.map((l) => [l, JSON.parse(lire(`messages/${l}.json`))]))
  return t
}

const valeur = (o, chemin) => chemin.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o)

/** Les dernières définitions des fonctions SQL, dans l'ordre des migrations. */
function dernieresFonctions(migrations) {
  const corps = new Map()
  for (const { sql } of migrations) {
    for (const m of sql.matchAll(/create (?:or replace )?function public\.(\w+)\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\2\$/g)) corps.set(m[1], m[3])
  }
  return corps
}

function juger(t) {
  const fautes = []
  const patch = t[F.patch] ?? ''
  const publish = t[F.publish] ?? ''

  // A — l'édition
  if (!/const EDITABLE_STATUSES = \[[^\]]*'rejected'[^\]]*\] as const/.test(patch)) fautes.push('A. PATCH : une annonce refusée n’est pas éditable')
  const iRefus = patch.search(/if \(resoumission && champsChanges\.length === 0\) \{\s*return json\(\s*\{[^}]*code: 'annonce_refusee_inchangee'/)
  const iUpdate = patch.search(/\.update\(resoumission \? \{ \.\.\.u\.updates, status: 'draft' \} : u\.updates\)/)
  if (iRefus < 0) fautes.push('A. PATCH : une annonce refusée inchangée n’est pas refusée nommément (annonce_refusee_inchangee)')
  if (iUpdate < 0) fautes.push('A. PATCH : la resoumission n’écrit pas `status: draft` dans le même update (ou l’écrit sans condition)')
  if (iRefus >= 0 && iUpdate >= 0 && iRefus > iUpdate) fautes.push('A. PATCH : le refus « inchangée » vient APRÈS l’écriture')
  if (!/const resoumission = currentStatus === 'rejected'/.test(patch)) fautes.push('A. PATCH : la resoumission ne se reconnaît plus au statut lu (`rejected`)')
  const statutsEcrits = [...patch.matchAll(/status: '(\w+)'/g)].map((m) => m[1]).filter((s) => s !== 'draft')
  if (statutsEcrits.length) fautes.push(`A. PATCH écrit un autre statut que draft : ${statutsEcrits.join(', ')}`)
  if (!/motif_refus: pub\.status === 'rejected' \? pub\.review_reason : null/.test(patch)) fautes.push('A. GET : le motif n’est pas servi à l’auteur, ou l’est hors d’un refus')

  // B — la publication
  if (!/const resoumission = typeof pub\.review_reason === 'string' && pub\.review_reason\.trim\(\) !== ''/.test(publish)) fautes.push('B. /publish : la resoumission ne se reconnaît plus au motif de refus')
  if (!/review_reason`/.test(publish) && !/review_reason'/.test(publish)) fautes.push('B. /publish ne lit pas review_reason')
  if (!/if \(ents\.limits\.publicationsPerMonth !== null && !resoumission\) \{\s*const allowed = await consumeQuota\(/.test(publish)) fautes.push('B. /publish : le compteur mensuel est consommé pour une resoumission')
  if ((publish.match(/consumeQuota\(/g) ?? []).length !== 1) fautes.push('B. /publish : le compteur mensuel est consommé ailleurs qu’à son unique point')
  if (/resoumission[^\n]*runPublicationVerification|if \(!resoumission\)[\s\S]{0,200}runPublicationVerification/.test(publish)) fautes.push('B. /publish : le contrôle de qualité est sauté pour une resoumission — il doit juger le texte modifié')
  if (!/runPublicationVerification\(/.test(publish)) fautes.push('B. /publish n’appelle plus le contrôle de qualité')
  if (!/const PUBLISHABLE_FROM = \['draft'\] as const/.test(publish)) fautes.push('B. /publish publie depuis un autre statut que draft — l’anti-relance tombe')

  // C — le marqueur
  const corps = dernieresFonctions(t.__migrations)
  const poseurs = [...corps].filter(([, c]) => /review_reason\s*=\s*(?![\s(]|null\b|case\b|p\.review_reason\b)/.test(c) && /update public\.publications/.test(c)).map(([n]) => n)
  if (poseurs.join(',') !== 'refuser_annonce') fautes.push(`C. les fonctions qui POSENT publications.review_reason : [${poseurs.join(', ')}] — attendu : refuser_annonce seule`)
  if (!/review_reason\s*= case when v_par_admin then null else p\.review_reason end/.test(corps.get('publier_annonce') ?? '')) fautes.push('C. la voie administrateur de publier_annonce() n’efface plus le motif')
  for (const { p, src } of t.__code) {
    let i = src.indexOf(".from('publications')")
    while (i >= 0) {
      const suite = src.slice(i, i + 600)
      const fin = suite.slice(1).search(/\.from\(/)
      const chaine = fin >= 0 ? suite.slice(0, fin + 1) : suite
      if (/\.(update|insert|upsert)\([^)]*review_reason/.test(chaine)) fautes.push(`C. ${p} écrit publications.review_reason`)
      i = src.indexOf(".from('publications')", i + 1)
    }
  }

  // D — les écrans
  if (!/const EDITABLE_STATUSES: readonly AnnonceStatus\[\] = \[[^\]]*'rejected'/.test(t[F.carte] ?? '')) fautes.push('D. la carte d’annonce ne mène pas à « Modifier » pour une annonce refusée')
  if (!/const EDITABLE_STATUSES = \[[^\]]*'rejected'/.test(t[F.fiche] ?? '')) fautes.push('D. la fiche d’annonce ne mène pas à « Modifier » pour une annonce refusée')
  if (!/const canPublish = \(status === 'draft' \|\| status === 'rejected'\) && !publishing/.test(t[F.formulaire] ?? '')) fautes.push('D. le formulaire ne laisse pas soumettre une annonce refusée')
  if (!/href=\{`\$\{basePath\}\/sous-traitance\/\$\{pub\.id\}\/modifier`\}/.test(t[F.ficheBesoin] ?? '') || !/isRejected && \(/.test(t[F.ficheBesoin] ?? '')) fautes.push('D. la fiche du besoin ne mène pas à sa reprise quand il est refusé')
  if (!t[F.pageReprise] || !/<SousTraitanceView basePath="\/dashboard\/freelance" repriseId=\{id\} \/>/.test(t[F.pageReprise])) fautes.push('D. la page de reprise du besoin (freelance) manque, ou ne reprend pas son formulaire')
  // Parité CDI (§D.14) : la fiche du besoin mène à `${basePath}/…/modifier` — la page doit exister des deux côtés.
  if (!t[F.pageRepriseCdi] || !/<SousTraitanceView basePath="\/dashboard\/cdi" repriseId=\{id\} \/>/.test(t[F.pageRepriseCdi])) fautes.push('D. la page de reprise du besoin (CDI) manque — la fiche y mène quand même')
  if (!/setBrouillonId\(p\.publication\.id\)/.test(t[F.vueBesoin] ?? '') || !/valeursDepuisBrouillon\(p\.publication\)/.test(t[F.vueBesoin] ?? '')) fautes.push('D. la reprise du besoin ne relit pas ses valeurs, ou en crée un autre au lieu de le mettre à jour')
  for (const p of [F.fiche, F.formulaire, F.ficheBesoin, F.vueBesoin]) {
    if (!/<MotifRefus motif=\{/.test(t[p] ?? '')) fautes.push(`D. ${p} ne montre pas le motif du refus`)
  }
  if (!/case 'annonce_refusee_inchangee': return tPub\('errors\.annonce_refusee_inchangee'\)/.test(t[F.communs] ?? '')) fautes.push('D. le refus « inchangée » n’a pas sa phrase commune aux deux écrans')

  // E — les messages
  const cles = {
    'validation_annonces.avis.cloche.refusee.corps': ['{titre}', '{motif}'],
    'validation_annonces.avis.email.refusee.suite': [],
    'publications.refus.titre': [], 'publications.refus.motif': [], 'publications.refus.suite': [], 'publications.refus.modifier': [],
    'publications.errors.annonce_refusee_inchangee': [],
  }
  // Ce que le refus doit DIRE, par langue : la resoumission ET le compteur (« une seconde fois »).
  const DIT = {
    fr: [/soumett(?:re|ez)-la à nouveau|la soumettre à nouveau/, /une seconde fois/],
    en: [/submit it again/, /a second time/],
    es: [/volver a enviarlo|vuelva a enviarlo|vuelve a enviarlo/, /por segunda vez/],
    de: [/erneut einreichen|erneut ein/, /ein zweites Mal/],
  }
  for (const l of LANGUES) {
    for (const [c, vars] of Object.entries(cles)) {
      const v = valeur(t.__messages[l], c)
      if (typeof v !== 'string' || !v.trim()) { fautes.push(`E. ${l} : ${c} manque`); continue }
      for (const x of vars) if (!v.includes(x)) fautes.push(`E. ${l} : ${c} a perdu ${x}`)
    }
    for (const c of ['validation_annonces.avis.cloche.refusee.corps', 'validation_annonces.avis.email.refusee.suite', 'publications.refus.suite']) {
      const v = valeur(t.__messages[l], c) ?? ''
      for (const re of DIT[l]) if (!re.test(v)) fautes.push(`E. ${l} : ${c} ne dit plus ${re}`)
    }
  }
  return fautes
}

const REELS = textesReels()

section('A à E. La resoumission, sur le code réel')
{
  const fautes = juger(REELS)
  ok(fautes.length === 0, 'une annonce refusée se modifie, repasse en brouillon si elle change, est jugée de nouveau, ne compte pas deux fois, et le refus le dit', fautes.join(' · '))
}

section('F. L’épreuve : chaque mutation fait rougir le contrôle')
{
  const muter = (p, a, b) => {
    const t = { ...REELS }
    if (!t[p] || !t[p].includes(a)) return null
    t[p] = t[p].replace(a, () => b)
    return t
  }
  const muterMessage = (l, chemin, f) => {
    const t = { ...REELS, __messages: JSON.parse(JSON.stringify(REELS.__messages)) }
    const parts = chemin.split('.')
    let o = t.__messages[l]
    for (const k of parts.slice(0, -1)) o = o[k]
    o[parts.at(-1)] = f(o[parts.at(-1)])
    return t
  }
  const EPREUVES = [
    ['une annonce refusée qui n’est plus éditable', () => muter(F.patch, "'archived', 'rejected'] as const", "'archived'] as const")],
    ['la resoumission inchangée qui n’est plus refusée', () => muter(F.patch, 'if (resoumission && champsChanges.length === 0) {', 'if (false) {')],
    ['le brouillon écrit même sans resoumission', () => muter(F.patch, '.update(resoumission ? { ...u.updates, status: \'draft\' } : u.updates)', ".update({ ...u.updates, status: 'draft' })")],
    ['le motif servi hors d’un refus', () => muter(F.patch, "motif_refus: pub.status === 'rejected' ? pub.review_reason : null", 'motif_refus: pub.review_reason')],
    ['le compteur consommé pour une resoumission', () => muter(F.publish, '&& !resoumission) {', ') {')],
    ['le contrôle de qualité sauté pour une resoumission', () => {
      const t = { ...REELS }
      t[F.publish] = t[F.publish].replace(/runPublicationVerification\(/, () => 'if (!resoumission) runPublicationVerification(')
      return t
    }],
    ['une seconde fonction qui pose le motif', () => {
      const t = { ...REELS, __migrations: [...REELS.__migrations, { f: 'z.sql', sql: "create or replace function public.autre(p uuid) returns void language sql as $f$ update public.publications set review_reason = 'x' where id = p; $f$;" }] }
      return t
    }],
    ['un code qui écrit le motif', () => {
      const t = { ...REELS, __code: [...REELS.__code, { p: 'lib/x.ts', src: "await a.from('publications').update({ review_reason: 'x' }).eq('id', id)" }] }
      return t
    }],
    ['la page de reprise CDI absente', () => { const t = { ...REELS }; t[F.pageRepriseCdi] = null; return t }],
    ['la fiche du besoin sans chemin de reprise', () => muter(F.ficheBesoin, 'isRejected && (', 'false && (')],
    ['le formulaire qui ne laisse plus soumettre une annonce refusée', () => muter(F.formulaire, "(status === 'draft' || status === 'rejected')", "(status === 'draft')")],
    ['le motif du refus perdu dans la cloche (es)', () => muterMessage('es', 'validation_annonces.avis.cloche.refusee.corps', (v) => v.replace('{motif}', ''))],
    ['le refus qui ne dit plus le compteur (de)', () => muterMessage('de', 'validation_annonces.avis.email.refusee.suite', (v) => v.replace('ein zweites Mal', 'erneut'))],
  ]
  for (const [nom, fabriquer] of EPREUVES) {
    const t = fabriquer()
    if (!t) { ok(false, `épreuve « ${nom} » : le texte à muter est introuvable — l’épreuve ne mord plus`); continue }
    const fautes = juger(t)
    ok(fautes.length > 0, `épreuve « ${nom} » : le contrôle rougit (${fautes.length} faute(s) : ${(fautes[0] ?? '').slice(0, 90)}…)`)
  }
}

console.log(`\n${echecs === 0 ? '✅ diag-resoumission : une annonce refusée se resoumet modifiée, jugée de nouveau, sans compter deux fois.' : `❌ diag-resoumission : ${echecs} contrôle(s) rouge(s).`}`)
process.exitCode = echecs === 0 ? 0 : 1
