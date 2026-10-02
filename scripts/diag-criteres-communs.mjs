/**
 * diag-criteres-communs.mjs — LES MÊMES CRITÈRES SUR LES TROIS ÉCRANS (lot « critères des annonces », 03/10/2026,
 * §D.39 — décision de Youssef). CONTRÔLE BLOQUANT.
 *
 * LA RÈGLE : un critère commun au profil de l'expert, à l'annonce d'une organisation et au besoin de sous-traitance —
 * branche, spécialités, séniorités, zones, modes de travail, temps de travail — est PRÉSENT sur chacun des écrans
 * (validation freelance, validation CDI, annonce d'organisation, besoin de sous-traitance), avec LA MÊME liste de
 * valeurs. Ce que Youssef a vu : le besoin de sous-traitance n'avait pas de spécialité ; le mode de travail était un choix
 * unique sur l'annonce et multiple sur le profil ; chaque écran recopiait sa liste.
 *
 * CE QU'IL VÉRIFIE :
 *   A. LE REGISTRE (lib/criteres/communs.ts, EXÉCUTÉ) : les six critères, chacun avec sa source de valeurs — une liste
 *      fermée ou le référentiel — et ce contrôle en connaît chacun (un critère ajouté au registre sans contrôle rougit) ;
 *   B. LA BASE : pour chaque liste fermée, la DERNIÈRE définition de la contrainte de `profiles` ET celle de
 *      `publications` (dans les migrations) disent EXACTEMENT la liste du registre ;
 *   C. LES ÉCRANS : chaque écran (l'annonce et le besoin, à travers le composant partagé qu'ils rendent) présente chaque
 *      critère par la source commune — les options de branche et de zones servies par /api/taxonomy, les spécialités par
 *      `optionsSpecialites`, les séniorités par `SENIORITES`, les modes et le temps par les composants partagés — et
 *      ENVOIE sa valeur ;
 *   D. AUCUNE COPIE : aucun écran, ni le composant partagé, ne porte une liste littérale de valeurs d'une liste fermée
 *      (deux valeurs ou plus dans un même tableau) — la copie qui dérive ;
 *   E. LES ROUTES lisent les mêmes listes (profil : liste blanche ; annonces : la même fonction de lecture) ;
 *   F. CHAQUE VALEUR a son libellé dans les quatre langues ;
 *   G. L'ÉPREUVE, INTÉGRÉE : le contrôle est rejoué sur des copies MUTÉES (un critère retiré d'un écran, une liste
 *      recopiée, une contrainte de base qui diverge, les spécialités construites à la main) et doit rougir à chaque fois.
 *
 * CE QU'IL NE VOIT PAS : un navigateur (il lit le code de l'écran, pas son rendu) ; le contenu du référentiel (branches,
 * spécialités, zones servies par /api/taxonomy — une même route pour tous, et c'est ce qu'il vérifie) ; la justesse
 * d'une traduction.
 *
 * Sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

let C
try {
  C = await import(pathToFileURL(join(ROOT, 'lib/criteres/communs.ts')).href)
} catch (err) {
  console.error('✘ lib/criteres/communs.ts ne se charge pas — le contrôle ne tourne pas', err)
  process.exit(2)
}

// ── Les écrans, et ce qu'ils rendent ──────────────────────────────────────────────────────────────────────────────
const ECRANS = {
  'validation freelance': 'app/[locale]/dashboard/freelance/profil/valider/page.tsx',
  'validation CDI': 'app/[locale]/dashboard/cdi/profil/valider/page.tsx',
  'annonce d’organisation': 'components/dashboard/PublicationForm.tsx',
  'besoin de sous-traitance': 'components/collaboration/SousTraitanceView.tsx',
}
const PARTAGES = {
  champs: 'components/annonces/ChampsAnnonce.tsx',
  formulaire: 'lib/annonces/formulaire.ts',
  choix: 'components/criteres/ChoixCriteres.tsx',
}
const MIGRATIONS = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()

/** Les textes que le contrôle juge (commentaires retirés) ; une épreuve en remplace certains par une copie mutée. */
function textesReels() {
  const t = {}
  for (const p of [...Object.values(ECRANS), ...Object.values(PARTAGES), 'app/api/profile/route.ts',
    'app/api/publications/route.ts', 'app/api/publications/[id]/route.ts', 'lib/annonces/criteres.ts', 'lib/criteres/specialites.ts']) {
    t[p] = sansCommentaires(lire(p))
  }
  t.__migrations = MIGRATIONS.map((f) => sansCommentairesSql(lire(`supabase/migrations/${f}`))).join('\n;\n')
  return t
}

const LISTES = { seniorites: C.SENIORITES, modes_travail: C.MODES_TRAVAIL, temps_travail: C.TEMPS_TRAVAIL }
/** Pour chaque liste fermée : la colonne et les deux contraintes qui la portent. */
const CONTRAINTES = {
  seniorites: ['profiles_seniorities_check', 'publications_seniorities_check'],
  modes_travail: ['profiles_work_modes_valid', 'publications_work_modes_valid'],
  temps_travail: ['profiles_temps_travail_valid', 'publications_temps_travail_valid'],
}

/** Les valeurs de la DERNIÈRE définition d'une contrainte CHECK dans les migrations (null si introuvable). */
function valeursContrainte(migrations, nom) {
  const re = new RegExp(`constraint\\s+"?${nom}"?\\s+check\\s*\\(([\\s\\S]*?array\\s*\\[[^\\]]*\\])`, 'gi')
  let dernier = null
  for (const m of migrations.matchAll(re)) dernier = m[1]
  if (!dernier) return null
  const tableau = /array\s*\[([^\]]*)\]/i.exec(dernier)?.[1] ?? ''
  return [...tableau.matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
}

const memeEnsemble = (a, b) => a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',')

/** Le texte d'un écran, augmenté du composant partagé qu'il rend (et de la validation qu'il appelle). */
function texteEcran(t, p) {
  let s = t[p]
  if (/<ChampsAnnonce\b/.test(s) && /from '@\/components\/annonces\/ChampsAnnonce'/.test(s)) s += '\n' + t[PARTAGES.champs]
  if (/\bcorpsDeRequete\(/.test(s) && /from '@\/lib\/annonces\/formulaire'/.test(s)) s += '\n' + t[PARTAGES.formulaire]
  return s
}

const estProfil = (p) => p.includes('/profil/valider/')

/**
 * LE JUGEMENT — rend la liste des fautes. Chaque critère : présent (par la source commune) et envoyé.
 * Les clés de ce tableau sont celles du registre : un critère du registre sans règle ici est une faute (A).
 */
const REGLES = {
  branche: {
    present: (s) => /\/api\/taxonomy\?/.test(s) && /(?:\bbranches|referentiel\?\.branches \?\? \[\]\))\.map\(\(?b\)? =>/.test(s),
    envoye: (s, p) => (estProfil(p) ? /\bbranch_slug:/.test(s) : /\bbranch_id: v\.branch_id/.test(s)),
  },
  specialites: {
    present: (s) => /\boptionsSpecialites\(/.test(s) && /\/api\/taxonomy\?/.test(s),
    envoye: (s, p) => (estProfil(p) ? /\bspeciality_slugs:/.test(s) : /\bspeciality_ids: v\.speciality_ids/.test(s)),
  },
  seniorites: {
    present: (s) => /\bSENIORITES\.map\(/.test(s) && /import \{[^}]*\bSENIORITES\b[^}]*\} from '@\/lib\/criteres\/communs'/.test(s),
    envoye: (s, p) => (estProfil(p) ? /^\s*seniorities,$/m.test(s) : /\bseniorities: v\.seniorities/.test(s)),
  },
  zones: {
    present: (s) => /<WorkZoneSelector\b/.test(s) && /\/api\/taxonomy\?/.test(s),
    envoye: (s) => /\bwork_zone_codes:/.test(s),
  },
  modes_travail: {
    present: (s) => /<ChoixModesTravail\b/.test(s),
    envoye: (s, p) => (estProfil(p) ? /\bwork_modes: workModes/.test(s) : /\bwork_modes: v\.work_modes/.test(s)),
  },
  temps_travail: {
    present: (s) => /<ChoixTempsTravail\b/.test(s),
    envoye: (s, p) => (estProfil(p) ? /\btemps_travail: tempsTravail/.test(s) : /\btemps_travail: v\.temps_travail/.test(s)),
  },
}

function juger(t) {
  const fautes = []
  // A — le registre
  const cles = C.CRITERES_COMMUNS.map((c) => c.cle)
  for (const c of cles) if (!REGLES[c]) fautes.push(`A. le critère « ${c} » du registre n’a pas de règle dans ce contrôle`)
  for (const c of Object.keys(REGLES)) if (!cles.includes(c)) fautes.push(`A. la règle « ${c} » ne correspond à aucun critère du registre`)
  for (const c of C.CRITERES_COMMUNS) {
    if (c.valeurs !== 'referentiel' && LISTES[c.cle] !== c.valeurs) fautes.push(`A. « ${c.cle} » : la liste du registre n’est pas la constante exportée`)
  }
  // B — la base
  for (const [cle, [cProfil, cAnnonce]] of Object.entries(CONTRAINTES)) {
    for (const nom of [cProfil, cAnnonce]) {
      const v = valeursContrainte(t.__migrations, nom)
      if (!v) fautes.push(`B. la contrainte ${nom} est introuvable dans les migrations`)
      else if (!memeEnsemble(v, LISTES[cle])) fautes.push(`B. ${nom} dit [${v.join(', ')}], le registre [${LISTES[cle].join(', ')}]`)
    }
  }
  // C — les écrans
  for (const [nom, p] of Object.entries(ECRANS)) {
    const s = texteEcran(t, p)
    for (const [cle, r] of Object.entries(REGLES)) {
      if (!r.present(s)) fautes.push(`C. ${nom} : le critère « ${cle} » est absent, ou ne vient pas de la source commune`)
      else if (!r.envoye(s, p)) fautes.push(`C. ${nom} : le critère « ${cle} » est présenté mais pas envoyé`)
    }
  }
  if (!/MODES_TRAVAIL\.map\(/.test(t[PARTAGES.choix]) || !/TEMPS_TRAVAIL\.map\(/.test(t[PARTAGES.choix])) {
    fautes.push('C. les composants partagés ne présentent plus les listes du registre (MODES_TRAVAIL, TEMPS_TRAVAIL)')
  }
  if (!/specialites\.filter\(\(s\) => s\.branch_id === brancheId\)/.test(t['lib/criteres/specialites.ts'])
      || !/value: SPECIALITY_OTHER/.test(t['lib/criteres/specialites.ts'])) {
    fautes.push('C. optionsSpecialites ne filtre plus par branche, ou ne propose plus « Autre (préciser) »')
  }
  // D — aucune copie d'une liste fermée
  for (const p of [...Object.values(ECRANS), PARTAGES.champs, PARTAGES.choix, PARTAGES.formulaire]) {
    for (const tableau of t[p].matchAll(/\[([^\[\]]{0,400})\]/g)) {
      for (const [cle, liste] of Object.entries(LISTES)) {
        const n = liste.filter((v) => new RegExp(`['"]${v}['"]`).test(tableau[1])).length
        if (n >= 2) fautes.push(`D. ${p} recopie la liste « ${cle} » : [${tableau[1].trim().slice(0, 80)}]`)
      }
    }
    // Les spécialités construites à la main (le filtre par branche recopié) — la source est optionsSpecialites.
    if (/\.filter\(\(?(?:s|sp)\)? => (?:s|sp)\.branch_id === /.test(t[p])) fautes.push(`D. ${p} filtre les spécialités par branche lui-même`)
  }
  // E — les routes
  const profil = t['app/api/profile/route.ts']
  for (const champ of ['seniorities', 'work_modes', 'temps_travail']) {
    if (!new RegExp(`'${champ}'`).test(/const directFields[^\]]*\]/.exec(profil)?.[0] ?? '')) fautes.push(`E. /api/profile n’accepte pas « ${champ} »`)
  }
  for (const r of ['app/api/publications/route.ts', 'app/api/publications/[id]/route.ts']) {
    if (!/lireCriteresAnnonce\(/.test(t[r]) || !/valeursConnues\(SENIORITES, v\)/.test(t[r])) fautes.push(`E. ${r} ne lit pas les critères par les fonctions communes`)
  }
  if (!/valeursConnues\(MODES_TRAVAIL, body\.work_modes\)/.test(t['lib/annonces/criteres.ts'])
      || !/valeursConnues\(TEMPS_TRAVAIL, body\.temps_travail\)/.test(t['lib/annonces/criteres.ts'])) {
    fautes.push('E. lireCriteresAnnonce ne lit plus les modes et le temps par les listes du registre')
  }
  return fautes
}

// ══════════════════════════════════════════════════════════════════════════
section('A-E. Les trois écrans, les mêmes critères, les mêmes valeurs — et la base, et les routes')
// ══════════════════════════════════════════════════════════════════════════
const REELS = textesReels()
const fautes = juger(REELS)
ok(fautes.length === 0, `${C.CRITERES_COMMUNS.length} critères × ${Object.keys(ECRANS).length} écrans : présents, de la source commune, envoyés ; base et routes alignées`,
  fautes.join('\n       → '))
for (const [cle, liste] of Object.entries(LISTES)) console.log(`  ··   ${cle} : [${liste.join(', ')}]`)

// ══════════════════════════════════════════════════════════════════════════
section('F. Chaque valeur a son libellé, dans les quatre langues')
// ══════════════════════════════════════════════════════════════════════════
{
  const LANGUES = ['fr', 'en', 'es', 'de']
  const MSG = Object.fromEntries(LANGUES.map((l) => [l, JSON.parse(lire(`messages/${l}.json`))]))
  const cle = (o, p) => p.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o)
  const chemins = [
    ...C.MODES_TRAVAIL.map((v) => `criteres.modes_travail.${v}`),
    ...C.TEMPS_TRAVAIL.map((v) => `criteres.temps_travail.${v}`),
    ...C.UNITES_DUREE.map((v) => `criteres.unites_duree.${v}`),
    ...C.UNITES_DUREE.map((v) => `criteres.duree.${v}`),
    ...C.SENIORITES.map((v) => `publications.form.seniority_options.${v}`),
    ...C.SENIORITES.map((v) => `profile_validation.sections.identity.seniority_options.${v}`),
  ]
  const absents = chemins.flatMap((p) => LANGUES.filter((l) => typeof cle(MSG[l], p) !== 'string' || !cle(MSG[l], p).trim()).map((l) => `${p} (${l})`))
  ok(absents.length === 0, `${chemins.length} libellés de valeurs, dans les quatre langues`, absents.join(', '))
  // Les libellés que Youssef a fixés pour le temps de travail.
  const attendus = { fr: ['Temps plein', 'Temps partiel'], en: ['Full-time', 'Part-time'], es: ['Jornada completa', 'Tiempo parcial'], de: ['Vollzeit', 'Teilzeit'] }
  const faux = LANGUES.filter((l) => cle(MSG[l], 'criteres.temps_travail.plein') !== attendus[l][0] || cle(MSG[l], 'criteres.temps_travail.partiel') !== attendus[l][1])
  ok(faux.length === 0, 'temps plein / temps partiel : les libellés décidés par Youssef, dans les quatre langues', faux.join(', '))
}

// ══════════════════════════════════════════════════════════════════════════
section('H. L’unité du budget suit le TYPE d’annonce, par une seule règle (§E.96)')
// ══════════════════════════════════════════════════════════════════════════
//  « mission ? jour : an » rangeait le besoin de sous-traitance parmi les salaires. La règle vit sur le type
//  (budgetUnitForAnnonce) ; une alternative recopiée sur le type, ou une table d'unités par type, rougit.
const ALTERNATIVES_INTERDITES = [
  /===\s*'(?:mission|offre|sous_traitance)'\s*\?\s*'(?:day|year)'/,
  /===\s*'(?:mission|offre|sous_traitance)'\s*\?\s*tPub\('budget_unit\./,
  /\{\s*mission:\s*'\/[^']*',\s*offre:\s*'\/[^']*'\s*\}/,
]
function alternativesDuBudget(textes) {
  const fautes = []
  for (const [p, src] of Object.entries(textes)) {
    for (const re of ALTERNATIVES_INTERDITES) if (re.test(src)) fautes.push(`${p} : ${re.source}`)
  }
  return fautes
}
const CODE = (() => {
  const out = {}
  const parcourir = (d) => {
    for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`
      if (e.isDirectory()) { if (e.name !== 'node_modules') parcourir(p) }
      else if (/\.(ts|tsx)$/.test(e.name)) out[p] = sansCommentaires(lire(p))
    }
  }
  ;['app', 'lib', 'components'].forEach(parcourir)
  return out
})()
{
  const f = alternativesDuBudget(CODE)
  ok(f.length === 0, `aucune unité de budget dérivée du type à la main (${Object.keys(CODE).length} fichiers lus)`, f.join(', '))
  ok(/budgetUnitForAnnonce\(type\)/.test(CODE['lib/publication-synthesis.ts'] ?? '') && /budgetUnitForAnnonce\(t\)/.test(CODE['app/api/publications/route.ts'] ?? '')
     && /return budgetUnitForAnnonce\(type\) === 'year' \? 'budget_unit\.year' : 'budget_unit\.day'/.test(CODE['lib/annonces/mise-en-forme.ts'] ?? '')
     && /tPub\(cleUniteBudget\(pub\.type\)\)/.test(CODE['lib/annonces/mise-en-forme.ts'] ?? ''),
    'la synthèse, la route des annonces et la mise en forme passent par budgetUnitForAnnonce')
  const muté = { 'app/api/publications/route.ts': "return t === 'mission' ? 'day' : 'year'" }
  ok(alternativesDuBudget(muté).length > 0, 'épreuve : « mission ? jour : an » réécrit dans la route fait rougir')
}

// ══════════════════════════════════════════════════════════════════════════
section('G. L’épreuve : chaque mutation fait rougir le contrôle')
// ══════════════════════════════════════════════════════════════════════════
{
  const muter = (p, de, vers) => {
    const t = { ...REELS }
    if (!t[p].includes(de)) return null
    t[p] = t[p].split(de).join(vers)
    return t
  }
  const EPREUVES = [
    ['le temps de travail retiré de la validation freelance', () => muter(ECRANS['validation freelance'], '<ChoixTempsTravail', '<div data-x')],
    ['les modes de travail retirés du composant d’annonce (donc des DEUX écrans d’annonce)', () => muter(PARTAGES.champs, '<ChoixModesTravail', '<div data-x')],
    ['une liste de modes recopiée dans le besoin de sous-traitance', () => {
      const t = { ...REELS }
      t[ECRANS['besoin de sous-traitance']] += "\nconst MODES = ['remote', 'onsite', 'hybrid']\n"
      return t
    }],
    ['la contrainte de base de l’annonce qui diverge (temps de travail)', () => {
      const t = { ...REELS }
      t.__migrations += "\nalter table public.publications add constraint publications_temps_travail_valid check (temps_travail <@ array['plein', 'partiel', 'mi_temps']::text[]);\n"
      return t
    }],
    ['les spécialités construites à la main dans la validation CDI', () => muter(ECRANS['validation CDI'], 'optionsSpecialites(', 'autresOptions(')],
    ['la spécialité qui n’est plus envoyée par l’annonce', () => muter(PARTAGES.formulaire, 'speciality_ids: v.speciality_ids', 'speciality_idz: v.speciality_ids')],
    ['les séniorités recopiées dans la validation freelance', () => muter(ECRANS['validation freelance'], 'SENIORITES.map(', "['junior', 'confirmed', 'senior', 'expert'].map(")],
    ['la branche absente du besoin de sous-traitance (le composant partagé n’est plus rendu)', () => muter(ECRANS['besoin de sous-traitance'], '<ChampsAnnonce', '<AutreChose')],
  ]
  for (const [nom, fabriquer] of EPREUVES) {
    const t = fabriquer()
    if (!t) { ok(false, `épreuve « ${nom} »`, 'le texte à muter est introuvable — l’épreuve ne prouve rien'); continue }
    const f = juger(t)
    ok(f.length > 0, `épreuve « ${nom} » : le contrôle rougit (${f.length} faute(s) : ${f[0]?.slice(0, 90) ?? '—'}…)`)
  }
}

console.log(echecs === 0 ? '\n✅ diag-criteres-communs : les trois écrans ont les mêmes critères, avec les mêmes valeurs.' : `\n❌ diag-criteres-communs : ${echecs} contrôle(s) rouge(s) — BLOQUANT.`)
process.exit(echecs === 0 ? 0 : 1)
