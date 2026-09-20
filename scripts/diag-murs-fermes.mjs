// scripts/diag-murs-fermes.mjs — LES MURS RESTENT DES MURS, ET AUCUN N'EST MORT.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Le lancement est gratuit et la date d'ouverture des abonnements n'est pas
//   fixée. Le chemin de paiement est construit, câblé et testable — mais il ne
//   doit PAS s'afficher tant que le verrou est fermé.
//
//   Deux façons de rater ça, et elles sont opposées :
//
//     · LE BOUTON MORT. Le mur de dévoilement portait un bouton DÉSACTIVÉ
//       « Bientôt disponible ». Un bouton qu'on ne peut pas cliquer promet une
//       porte qui n'existe pas : l'utilisateur le vise, ne comprend pas, et
//       recommence. Une ligne d'issue vaut mieux qu'un bouton qui ment.
//
//     · LE VERROU QUI FUIT. Servir l'état par une variable `NEXT_PUBLIC_` le
//       rendrait lisible dans le bundle, et surtout l'UI pourrait diverger du
//       serveur — qui reste seul à décider.
//
//   Et une troisième, plus discrète : OUVRIR PAR IGNORANCE. Si le quota n'est
//   pas lisible, le mur doit rester fermé. `=== true`, jamais une vérité simple.
//
// CE QU'IL VÉRIFIE
//   1. Aucun bouton désactivé sur AUCUN mur de conversion.
//   2. Le verrou vient du SERVEUR : toute route qui le sert le calcule, et tout
//      écran qui appelle une telle route le lit en `=== true`.
//   3. Il est FERMÉ par défaut, partout : aucune forme ouverte par ignorance,
//      et un quota illisible referme.
//   4. L'issue bascule avec lui : contact quand c'est fermé, offres quand
//      c'est ouvert — et les deux libellés existent dans les 4 langues.
//   5. Aucune clé de mur orpheline, dans un sens ni dans l'autre.
//   6. Aucun chiffre commercial écrit dans un mur.
//
// ┌─ CONVERTI EN BALAYAGE (lot C4a, 20/09/2026) ────────────────────────────┐
// │ Il ouvrait CINQ fichiers par leur chemin. Un sixième mur, un sixième    │
// │ lecteur du verrou, une septième clé `wall_*` n'étaient pas regardés     │
// │ (§E.34). Il balaie désormais `components/` + `app/[locale]/` côté écran │
// │ et `app/api/` côté serveur ; les MURS sont trouvés par la clé qui les   │
// │ nomme (`wall_title` — un contrat i18n, pas un nom de fichier), les      │
// │ LECTEURS du verrou par le champ qu'ils lisent (`billing_enabled`), et   │
// │ les écrans qui appellent une route par son CHEMIN.                      │
// └─────────────────────────────────────────────────────────────────────────┘
//
//   node scripts/diag-murs-fermes.mjs   → contrôles statiques. AUCUN accès base.
//
// LECTURE PURE : ce script n'écrit JAMAIS et ne joint jamais la base.

import {
  RACINES_CLIENT, LOCALES, lire, sansCommentaires, fichiers, routesApi, consommateurs,
  messages, lireCle, clesPlates, localesManquantes, bilan,
} from './balayage-promesse.mjs'

const { ok, section, info, fin } = bilan()

// ══════════════════════════════════════════════════════════════════════════
// LES MOTIFS — et leurs preuves, AVANT le balayage (§E.33)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Les murs d'un fichier : de chaque référence à `wall_title` jusqu'à la ligne
 * d'issue qui suit (`need_more_contact` / `need_more_upgrade`). Un mur sans
 * issue rend `null` pour `issue` : c'est un mur mort, et ça se dit.
 */
function murs(src) {
  const out = []
  for (const m of src.matchAll(/['"]wall_title['"]/g)) {
    const reste = src.slice(m.index)
    const issue = reste.search(/need_more_(?:contact|upgrade)/)
    out.push({ debut: m.index, issue: issue < 0 ? null : issue, bloc: issue < 0 ? reste.slice(0, 1500) : reste.slice(0, issue) })
  }
  return out
}
const boutonMort = (bloc) => /<button\b/.test(bloc) || /aria-disabled/.test(bloc) || /not-allowed/.test(bloc)

/** Les lectures du champ SERVEUR `billing_enabled` qui ne sont ni un type ni un `=== true`. */
function lecturesNonFermees(src) {
  const out = []
  for (const m of src.matchAll(/\bbilling_enabled\b/g)) {
    const ligne = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index) === -1 ? undefined : src.indexOf('\n', m.index))
    const estType = /\bbilling_enabled\??\s*:\s*boolean\b/.test(ligne)
    const estFerme = /\bbilling_enabled\s*===\s*true\b/.test(ligne)
    const estServeur = /\bbilling_enabled:\s*billingEnabled\(\)/.test(ligne)
    if (!estType && !estFerme && !estServeur) out.push(ligne.trim())
  }
  return out
}
/** Une forme OUVERTE PAR IGNORANCE : l'absence ou l'échec vaudrait « ouvert ». */
const OUVERTURES = /\bbilling(?:_e|E)nabled\b[^;\n]{0,40}(?:\?\?\s*true|!==?\s*false)|useState(?:<boolean>)?\(\s*true\s*\)\s*$/m
const ouvertParIgnorance = (src) => OUVERTURES.test(src)

section('ÉPREUVE DES MOTIFS — avant de leur faire confiance')
{
  const murMort = `<span>{t('wall_title')}</span><p>{t('wall_body')}</p><button disabled>Bientôt</button><span>{tCommerce('need_more_contact')}</span>`
  const murSain = `<span>{t('wall_title')}</span><p>{t('wall_body')}</p><span>{tCommerce('need_more_contact')}</span>{x && <button onClick={go}>Ouvrir</button>}`
  const murSansIssue = `<span>{t('wall_title')}</span><p>{t('wall_body')}</p></div>`
  ok(murs(murMort).length === 1 && boutonMort(murs(murMort)[0].bloc), 'détecte : un bouton désactivé DANS le mur')
  ok(murs(murSain).length === 1 && !boutonMort(murs(murSain)[0].bloc), 'ignore : un bouton APRÈS la ligne d’issue (il n’est pas dans le mur)')
  ok(murs(murSansIssue)[0].issue === null, 'détecte : un mur sans ligne d’issue')
  ok(lecturesNonFermees("if (q?.billing_enabled) open()").length === 1, 'détecte : une lecture du champ serveur sans `=== true`')
  ok(lecturesNonFermees("billing_enabled?: boolean\nconst v = q.billing_enabled === true").length === 0, 'ignore : un type et une lecture fermée')
  ok(ouvertParIgnorance('const open = data.billing_enabled ?? true'), 'détecte : `?? true` — l’absence ouvrirait')
  ok(ouvertParIgnorance('if (billingEnabled !== false) show()'), 'détecte : `!== false` — l’inconnu ouvrirait')
  ok(!ouvertParIgnorance('const [billingEnabled, setBillingEnabled] = useState(false)\nif (billingEnabled === true) show()'), 'ignore : fermé par défaut')
}

// ══════════════════════════════════════════════════════════════════════════
/**
 * GEL — ce que le balayage a trouvé que les cinq noms cachaient, LU et NOMMÉ
 * (§G.8 : « jugé » veut dire lu, pas acquitté). Chaque raison commence par
 * LÉGITIME ou par DÉFAUT NOMMÉ ; le contrôle compte les seconds à voix haute.
 * Un défaut nommé n'est pas corrigé ici — c'est un arbitrage rendu à
 * l'architecte, pas un élargissement du lot.
 */
// Le gel a porté deux DÉFAUTS NOMMÉS le jour de la conversion (20/09/2026) —
// SousTraitanceView qui ne refermait pas le verrou, et la clé orpheline
// `collaboration.wall_contact`. Les deux ont été corrigés le même jour sur
// arbitrage ; le gel est VIDE, et la convention reste écrite pour le prochain.
const GEL = {}
const gele = (cle) => cle in GEL
const defautsNommes = Object.values(GEL).filter((r) => r.startsWith('DÉFAUT NOMMÉ')).length

const ECRANS = fichiers(RACINES_CLIENT)
const ROUTES = routesApi()
const MSG = messages()
const lu = new Map(ECRANS.map((f) => [f, sansCommentaires(lire(f))]))

section('1. Aucun bouton mort sur AUCUN mur — balayage de components/ + app/[locale]/')
const fichiersAvecMur = ECRANS.filter((f) => murs(lu.get(f)).length > 0)
info(`${ECRANS.length} fichiers client · ${fichiersAvecMur.length} portent un mur`)
ok(fichiersAvecMur.length >= 2, 'au moins deux murs existent (dévoilement, sous-traitance)',
  'zéro mur trouvé : la clé `wall_title` a changé de nom, ou le motif ne voit plus les murs')
for (const f of fichiersAvecMur) {
  for (const [i, mur] of murs(lu.get(f)).entries()) {
    const nom = `${f.split('/').pop()}${i ? ` (mur ${i + 1})` : ''}`
    ok(mur.issue !== null, `${nom} : le mur porte une ligne d’issue`,
      'un mur sans issue est un cul-de-sac : ni bouton, ni contact, ni offre')
    ok(!boutonMort(mur.bloc), `${nom} : aucun bouton dans le mur`,
      "Un bouton qu'on ne peut pas cliquer promet une porte qui n'existe pas.")
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('2. Le verrou vient du SERVEUR — les routes qui le servent, et les écrans qui les appellent')
const routesDuVerrou = ROUTES.filter((r) => /\bbilling_enabled\s*:/.test(sansCommentaires(lire(r.rel))))
info(`${ROUTES.length} routes · ${routesDuVerrou.length} servent \`billing_enabled\``)
ok(routesDuVerrou.length >= 1, 'au moins une route sert le verrou', 'aucune route ne rend `billing_enabled` : l’UI ne peut plus l’apprendre du serveur')
for (const r of routesDuVerrou) {
  const src = sansCommentaires(lire(r.rel))
  const valeurs = [...src.matchAll(/\bbilling_enabled\s*:\s*([^,}\n]+)/g)].map((m) => m[1].trim())
  ok(valeurs.every((v) => /^billingEnabled\(\)$/.test(v)), `${r.rel} : chaque \`billing_enabled\` vaut \`billingEnabled()\` — calculé au serveur`,
    `trouvé : ${valeurs.join(' ; ')}`)
  const lecteurs = consommateurs(r.chemin, ECRANS)
  for (const e of lecteurs) {
    ok(/\bbilling_enabled\s*===\s*true\b/.test(lu.get(e)) || !/\bbilling_enabled\b/.test(lu.get(e)),
      `${e.split('/').pop()} (appelle ${r.chemin}) lit le verrou en \`=== true\` — ou ne le lit pas`,
      'une lecture par vérité simple ouvrirait sur `undefined`')
  }
}
// Aucune fuite publique, dans TOUT le code — serveur compris.
const fuites = fichiers(['app', 'lib', 'components']).filter((f) => /NEXT_PUBLIC_[A-Z_0-9]*(STRIPE|BILLING)/.test(sansCommentaires(lire(f))))
ok(fuites.length === 0, 'aucune variable NEXT_PUBLIC_ de facturation, nulle part', fuites.join(', ') || undefined)

// ══════════════════════════════════════════════════════════════════════════
section('3. FERMÉ par défaut — partout où le verrou est lu')
const lecteursDuVerrou = ECRANS.filter((f) => /\bbilling_enabled\b|\bbillingEnabled\b/.test(lu.get(f)))
info(`${lecteursDuVerrou.length} fichiers client lisent le verrou`)
for (const f of lecteursDuVerrou) {
  const src = lu.get(f)
  const nues = lecturesNonFermees(src)
  ok(nues.length === 0, `${f.split('/').pop()} : toute lecture du champ serveur est \`=== true\``, nues.join(' | ') || undefined)
  ok(!ouvertParIgnorance(src), `${f.split('/').pop()} : aucune forme ouverte par ignorance (\`?? true\`, \`!== false\`, \`useState(true)\`)`)
  // Un état local qui porte le verrou naît fermé, et un quota illisible le referme.
  if (/setBillingEnabled\(/.test(src)) {
    ok(/\[billingEnabled, setBillingEnabled\] = useState(?:<boolean>)?\(false\)/.test(src), `${f.split('/').pop()} : l’état local du verrou naît FERMÉ`)
    const referme = /setBillingEnabled\(false\)/.test(src)
    if (!referme && gele(`${f} | referme`)) info(`${f.split('/').pop()} : ne referme pas — GELÉ, ${GEL[`${f} | referme`].slice(0, 12)}…`)
    else ok(referme, `${f.split('/').pop()} : un quota illisible REFERME le verrou`,
      "Best-effort sur les droits, oui — mais pas sur l'ouverture d'un chemin de paiement.")
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('4. L’issue bascule avec le verrou')
for (const f of fichiersAvecMur) {
  const src = lu.get(f)
  ok(/need_more_upgrade/.test(src) && /need_more_contact/.test(src), `${f.split('/').pop()} porte les DEUX libellés d’issue`,
    'Un seul libellé, et le jour de l’ouverture il faudrait revenir modifier l’écran.')
}
for (const c of ['commerce.need_more_contact', 'commerce.need_more_upgrade']) {
  const manquantes = localesManquantes(MSG, c)
  ok(manquantes.length === 0, `${c} : 4 langues`, manquantes.join(', ') || undefined)
}

// ══════════════════════════════════════════════════════════════════════════
section('5. Aucune clé de mur orpheline — dans les deux sens')
const CLES_MUR = clesPlates(MSG.fr).filter((k) => /(^|\.)wall_[a-z_]+$/.test(k))
const codeClient = [...lu.values()].join('\n')
info(`${CLES_MUR.length} clés \`wall_*\` dans les traductions`)
for (const k of CLES_MUR) {
  const feuille = k.split('.').pop()
  const affichee = new RegExp(`['"]${feuille}['"]`).test(codeClient)
  if (!affichee && gele(`messages | ${k}`)) info(`« ${k} » n’est affichée nulle part — GELÉ, ${GEL[`messages | ${k}`].slice(0, 12)}…`)
  else ok(affichee, `« ${k} » est affichée par un écran`,
    'une clé que plus personne n’affiche est du texte qu’on maintiendra pour rien')
  const manquantes = localesManquantes(MSG, k)
  ok(manquantes.length === 0, `« ${k} » : 4 langues`, manquantes.join(', ') || undefined)
}
for (const feuille of new Set([...codeClient.matchAll(/['"](wall_[a-z_]+)['"]/g)].map((m) => m[1]))) {
  ok(CLES_MUR.some((k) => k.endsWith(`.${feuille}`)), `« ${feuille} » (citée par un écran) existe dans les traductions`)
}

// ══════════════════════════════════════════════════════════════════════════
section('6. Aucun chiffre commercial dans un mur')
const CHIFFRE = /\b\d+\s*(profil|candidat|dévoilement|annonce|publication|reveal|listing|Anzeige|anuncio|Kandidat|perfil)/i
for (const l of LOCALES) {
  for (const k of CLES_MUR) {
    const txt = String(lireCle(MSG[l], k) ?? '')
    ok(!CHIFFRE.test(txt), `${k} [${l}] : aucune quantité écrite en dur`,
      `« ${txt} » — un quota recopié ment dès qu'on le règle au back-office.`)
  }
}

// Le gel ne dort pas : une entrée dont le défaut a disparu doit sortir du gel.
section('GEL — relu à chaque exécution')
// Une entrée du gel dont le défaut a disparu doit en sortir : on relit chaque clé.
for (const k of Object.keys(GEL)) {
  const [f, quoi] = k.split(' | ')
  if (f === 'messages') ok(CLES_MUR.includes(quoi) && !new RegExp(`['"]${quoi.split('.').pop()}['"]`).test(codeClient), `l’entrée « ${quoi} orpheline » est encore vraie — sinon la retirer du gel`)
  else ok(lu.has(f) && !/setBillingEnabled\(false\)/.test(lu.get(f)), `l’entrée « ${f.split('/').pop()} ne referme pas » est encore vraie — sinon la retirer du gel`)
}
// Pas de `\b` après un « É » : hors drapeau `u`, un caractère accentué n'est pas
// un caractère de mot en JS, et « DÉFAUT NOMMÉ » ne passait jamais.
ok(Object.values(GEL).every((r) => /^(LÉGITIME|DÉFAUT NOMMÉ)( |$)/.test(r)), 'chaque raison du gel commence par LÉGITIME ou DÉFAUT NOMMÉ (§G.8)')
info(`${defautsNommes} DÉFAUT(S) NOMMÉ(S) au gel — lus, pas acquittés, rendus à l’arbitrage`)

fin(`Les murs restent des murs, et aucun n’est mort — sur tout le périmètre. ${defautsNommes} défaut(s) nommé(s) attendent un arbitrage.`)
