// scripts/diag-refus-actionnables.mjs — UN REFUS DIT CE QUI BLOQUE ET QUOI FAIRE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Le serveur NOMME depuis toujours la cause de ses refus commerciaux — trois
//   codes en 402, dans trois routes. Trois écrans sur cinq les jetaient à
//   l'arrivée et affichaient « Une erreur est survenue ».
//
//   L'organisation qui atteignait son quota mensuel de publications, son
//   plafond d'annonces actives, ou ses dévoilements inclus, lisait la même
//   phrase que pour une panne réseau. Elle ne savait ni ce qui bloquait, ni si
//   c'était sa faute, ni quoi faire ensuite. Côté EXPERT le même refus produit
//   un encart qui explique et propose — l'asymétrie n'avait aucune raison
//   d'être, et le modèle existait déjà dans le dépôt.
//
//   Ce défaut est invisible pour `tsc` et pour le build : une table de
//   correspondance à laquelle il manque une entrée est du code parfaitement
//   valide. Seul un contrôle qui compare les codes ÉMIS aux codes TRAITÉS le
//   voit — c'est ce que fait celui-ci.
//
// CE QU'IL VÉRIFIE
//   1. Tout code de refus COMMERCE émis en 402 par UNE ROUTE, QUELLE QU'ELLE
//      SOIT, a un message dans CHAQUE écran qui appelle cette route. Les codes
//      sont DÉCOUVERTS dans les routes, les écrans sont DÉCOUVERTS par le
//      chemin qu'ils appellent : rien n'est recopié ici.
//   2. Chaque message dit CE QUI BLOQUE **et** CE QU'ON PEUT FAIRE.
//   3. Les quatre langues, à l'identique.
//   4. Aucune VALEUR commerciale n'est écrite dans les messages.
//   5. Le verrou reste fermé : aucun bouton de paiement sur ces refus.
//   6. La réactivation : dans le doute on FERME, et le refus dit quoi faire.
//
// ┌─ CONVERTI EN BALAYAGE (lot C4a, 20/09/2026) ────────────────────────────┐
// │ Il connaissait DEUX chaînes route → écran, écrites à la main. Or quatre │
// │ écrans appellent ces deux routes, et le quatrième — `CandidatureCard`  │
// │ — jette `unlock_limit_reached` dans « une erreur est survenue » :        │
// │ EXACTEMENT le défaut que ce contrôle est né pour fermer, sur un écran   │
// │ qu'il n'ouvrait pas (§E.34). Les routes sont désormais trouvées par ce  │
// │ qu'elles émettent (un 402), les écrans par ce qu'ils appellent.         │
// └─────────────────────────────────────────────────────────────────────────┘
//
//   node scripts/diag-refus-actionnables.mjs   → contrôles statiques.
//                                                AUCUN accès base.
//
// LECTURE PURE : ce script n'écrit JAMAIS et ne joint jamais la base.

import {
  RACINES_CLIENT, LOCALES, lire, sansCommentaires, fichiers, routesApi, consommateurs,
  messages, lireCle, clesFinissantPar, localesManquantes, bilan,
} from './balayage-promesse.mjs'

const { ok, section, info, fin } = bilan()

/**
 * GEL — lu, nommé, non acquitté (§G.8). Un défaut nommé est rendu à
 * l'arbitrage, pas corrigé ici.
 */
// Le jour de la conversion (20/09/2026) le gel a porté UN défaut nommé — et
// c'était le défaut fondateur du contrôle : `CandidatureCard` jetait le 402
// `unlock_limit_reached` dans « une erreur est survenue ». Corrigé le même jour
// sur arbitrage. Le gel est VIDE ; la convention reste pour le prochain.
const GEL = {}
const gele = (cle) => cle in GEL
const defautsNommes = Object.values(GEL).filter((r) => r.startsWith('DÉFAUT NOMMÉ')).length

// ══════════════════════════════════════════════════════════════════════════
// LES MOTIFS — éprouvés AVANT le balayage (§E.33)
// ══════════════════════════════════════════════════════════════════════════

/** Les codes de refus COMMERCE émis en 402 par une route — sur une ou plusieurs lignes. */
function codesEmis(src) {
  const codes = new Set()
  for (const m of src.matchAll(/code:\s*'([a-z_]+)'\s*\}[\s\S]{0,40}?\b402\b/g)) codes.add(m[1])
  return [...codes]
}
/**
 * L'écran TRAITE-t-il ce code ? La simple présence ne prouve rien (le code
 * survit dans un `new Set([...])` ou dans une clé i18n). On exige la forme qui
 * traite : une entrée de table `<code>: t(` ou une comparaison `=== '<code>'`.
 */
const traite = (src, code) => new RegExp(`===\\s*'${code}'|\\b${code}\\s*:\\s*t\\(`).test(src)
/** Deux temps : le constat, puis l'issue — au moins deux phrases, et de la longueur. */
const actionnable = (txt) => typeof txt === 'string' && txt.length > 60 && (txt.match(/[.!?]/g) || []).length >= 2
const CHIFFRES = /\b\d+\s*(annonce|publication|profil|dévoilement|listing|post|reveal|Anzeige|anuncio)/i

section('ÉPREUVE DES MOTIFS — avant de leur faire confiance')
{
  ok(codesEmis("return json(\n  { error: 'x', code: 'quota_a' },\n  402,\n)").join() === 'quota_a', 'détecte : un 402 sur plusieurs lignes')
  ok(codesEmis("return json({ error: 'x', code: 'quota_b' }, 402)").join() === 'quota_b', 'détecte : un 402 sur une ligne')
  ok(codesEmis("return json({ error: 'x', code: 'not_found' }, 404)").length === 0, 'ignore : un 404 — pas un refus commerce')
  ok(traite("if (code === 'quota_a') setError(t('e'))", 'quota_a'), 'détecte : une comparaison qui traite le code')
  ok(traite('const M = { quota_a: t("errors.quota_a") }', 'quota_a'), 'détecte : une entrée de table qui traite le code')
  ok(!traite("const S = new Set(['quota_a'])\nsetError(t('error_quota_a'))", 'quota_a'), 'ignore : le code présent sans être TRAITÉ (Set, clé i18n) — les deux mutations qui étaient passées vertes')
  ok(actionnable('Vous avez atteint votre quota mensuel de publications. Contactez-nous pour en discuter.'), 'détecte : un constat puis une issue')
  ok(!actionnable('Quota atteint.'), 'refuse : un constat seul, en cinq mots')
  ok(CHIFFRES.test('Vous avez 2 annonces actives.'), 'détecte : une quantité écrite en dur')
}

// ══════════════════════════════════════════════════════════════════════════
const ECRANS = fichiers(RACINES_CLIENT)
const ROUTES = routesApi()
const MSG = messages()

section('1. Tout refus commerce émis est traité par CHAQUE écran qui appelle sa route')
const emetteurs = ROUTES.map((r) => ({ ...r, codes: codesEmis(sansCommentaires(lire(r.rel))) })).filter((r) => r.codes.length)
info(`${ROUTES.length} routes balayées · ${emetteurs.length} émettent un refus 402 · ${ECRANS.length} fichiers client`)
ok(emetteurs.length >= 2, 'au moins deux routes émettent un refus commerce (publication, dévoilement)',
  'découverte vide : le motif ne reconnaît plus les refus')
const clesDeRefus = []
let totalCodes = 0
for (const r of emetteurs) {
  const lecteurs = consommateurs(r.chemin, ECRANS)
  ok(lecteurs.length >= 1, `${r.chemin} est appelé par au moins un écran (${lecteurs.length})`,
    'une route sans appelant : le chemin a changé, ou le résolveur ne le reconnaît plus')
  for (const code of r.codes) {
    totalCodes++
    // Le message : une clé dont la feuille se termine par le code (`<code>` ou `error_<code>`), découverte.
    const cles = clesFinissantPar(MSG.fr, code)
    ok(cles.length >= 1, `« ${code} » a un message (${cles.join(', ') || 'AUCUNE clé ne se termine par ce code'})`)
    clesDeRefus.push(...cles)
    for (const e of lecteurs) {
      const src = sansCommentaires(lire(e))
      const t = traite(src, code)
      const cle = `${e} | ${code}`
      if (!t && gele(cle)) info(`${e.split('/').pop()} ne traite PAS « ${code} » — GELÉ, ${GEL[cle].slice(0, 12)}…`)
      else ok(t, `« ${code} » est traité par ${e.split('/').pop()}`,
        "Le serveur nomme la cause ; l'écran la jette et affiche « une erreur est survenue ».")
    }
  }
}
info(`${totalCodes} code(s) de refus commerce découvert(s) dans les routes`)

// ══════════════════════════════════════════════════════════════════════════
section('2. Chaque message dit ce qui BLOQUE et ce qu’on peut FAIRE')
for (const c of clesDeRefus) {
  const txt = lireCle(MSG.fr, c)
  ok(actionnable(txt), `${c} : constat PUIS issue (deux phrases, étoffé)`, `« ${txt} » — il manque ce qu'on peut faire.`)
}
// L'appel à l'action est PARTAGÉ, donc jamais recopié dans chaque message.
ok(typeof lireCle(MSG.fr, 'commerce.need_more_contact') === 'string', 'l’appel à l’action vit dans un espace partagé (commerce.*)')
ok(clesDeRefus.every((c) => !/[Cc]ontact/.test(String(lireCle(MSG.fr, c)))), 'aucun message ne recopie l’appel à l’action',
  "Recopié, il faudrait le changer en trois endroits le jour où le verrou s'ouvre.")

// ══════════════════════════════════════════════════════════════════════════
section('3. Les quatre langues, à l’identique')
for (const c of [...clesDeRefus, 'commerce.need_more_contact', 'commerce.need_more_upgrade']) {
  const manquantes = localesManquantes(MSG, c)
  ok(manquantes.length === 0, `${c} : 4 langues`, manquantes.length ? `absente en ${manquantes.join(', ')}` : undefined)
}

// ══════════════════════════════════════════════════════════════════════════
section('4. Rien en dur — les valeurs vivent au catalogue')
for (const c of clesDeRefus) {
  for (const l of LOCALES) {
    const txt = String(lireCle(MSG[l], c) ?? '')
    ok(!CHIFFRES.test(txt), `${c} [${l}] : aucune quantité écrite en dur`,
      `« ${txt} » — un quota recopié dans une traduction ment dès qu'on le règle au back-office.`)
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('5. Le verrou reste fermé : aucun chemin de paiement sur un refus')
const ecransDesRefus = [...new Set(emetteurs.flatMap((r) => consommateurs(r.chemin, ECRANS)))]
for (const e of ecransDesRefus) {
  const src = sansCommentaires(lire(e))
  const nom = e.split('/').pop()
  ok(!/billing\/checkout|billing\/change-plan|billing\/portal/.test(src), `${nom} n’ouvre aucun parcours de paiement`,
    'Le lancement est gratuit : un refus propose de nous contacter, pas de payer.')
  ok(!/NEXT_PUBLIC_[A-Z_]*(STRIPE|BILLING)/.test(src), `${nom} ne lit aucune variable publique de facturation`)
}
// Le libellé servi aujourd'hui est bien celui du verrou FERMÉ — sur chaque écran qui TRAITE un refus.
for (const e of ecransDesRefus) {
  const src = sansCommentaires(lire(e))
  if (emetteurs.some((r) => r.codes.some((c) => traite(src, c)))) {
    ok(/need_more_contact/.test(src), `${e.split('/').pop()} affiche l’issue « contactez-nous »`)
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('6. LA RÉACTIVATION — dans le doute on FERME, et le refus dit quoi faire')
//
//   Deux défauts, et ils allaient dans le même sens :
//     1. le snapshot `pre_deletion_visible` était restauré SANS évaluer le
//        prédicat de visibilité — on republiait un profil devenu incomplet ;
//     2. le repli sur état inconnu était `true` — sur une information
//        MANQUANTE, on republiait la personne. L'inverse de la règle du projet.
//   Et l'échec rendait un `db_error` générique qu'aucun écran n'affichait :
//   l'expert restait enfermé dans sa période de grâce sans savoir pourquoi.
//
//   La route est trouvée par ce qu'elle ÉMET (`visibility_blocked`), l'écran
//   par ce qu'il APPELLE — plus aucun chemin écrit ici.

const routesReact = ROUTES.filter((r) => /code:\s*'visibility_blocked'/.test(sansCommentaires(lire(r.rel))))
ok(routesReact.length === 1, `une route émet \`visibility_blocked\` (${routesReact.map((r) => r.chemin).join(', ') || 'aucune'})`)
for (const r of routesReact) {
  const react = sansCommentaires(lire(r.rel))
  ok(/missingForVisibility\(/.test(react), 'le prédicat de visibilité est ÉVALUÉ, pas supposé',
    'Un snapshot dit ce que la personne AVAIT choisi, pas si son profil le mérite encore.')
  ok(/pre_deletion_visible === true/.test(react), 'le repli sur état inconnu est FERMÉ (`=== true`)',
    'Un snapshot absent valait « visible » : sur une info manquante, on republiait.')
  ok(/\bmanquants\.length === 0/.test(react), 'la visibilité n’est rendue que si elle était acquise ET encore méritée')
  ok(/missing: manquants/.test(react), 'le refus NOMME les champs manquants',
    'Un db_error générique enferme l’expert dans sa grâce sans lui dire pourquoi.')
  ok(!/\.count \?\? 0[\s\S]{0,40}\.count \?\? 0[\s\S]{0,200}error/.test(react) && /Res\.error \|\| \w+Res\.error/.test(react),
    'un comptage en échec ne vaut PAS zéro', 'Un zéro emprunté à une panne fermerait la visibilité de quelqu’un qui a tout saisi.')
  const ecrans = consommateurs(r.chemin, ECRANS)
  ok(ecrans.length >= 1, `${r.chemin} est appelé par un écran (${ecrans.length})`)
  for (const e of ecrans) {
    const src = sansCommentaires(lire(e))
    ok(/=== 'visibility_blocked'/.test(src) || /manquants/.test(src), `${e.split('/').pop()} traite \`visibility_blocked\` et AFFICHE les champs manquants`,
      'L’échec était avalé en silence : le bouton se réarmait, et rien n’expliquait pourquoi.')
    ok(/profile_validation\.field_errors/.test(src), `${e.split('/').pop()} réutilise les libellés de champs existants`,
      'Une seconde série de libellés finirait par dire autre chose que la première.')
  }
}
for (const l of LOCALES) {
  const r = MSG[l]?.settings?.reactivation
  ok(typeof r?.blocked_title === 'string' && typeof r?.blocked_body === 'string' && typeof r?.reactivate_failed === 'string',
    `refus de réactivation traduit (${l})`)
}

// ══════════════════════════════════════════════════════════════════════════
section('GEL — relu à chaque exécution')
// Pas de `\b` après un « É » : hors drapeau `u`, un caractère accentué n'est pas
// un caractère de mot en JS, et « DÉFAUT NOMMÉ » ne passait jamais.
ok(Object.values(GEL).every((r) => /^(LÉGITIME|DÉFAUT NOMMÉ)( |$)/.test(r)), 'chaque raison du gel commence par LÉGITIME ou DÉFAUT NOMMÉ (§G.8)')
for (const cle of Object.keys(GEL)) {
  const [f, code] = cle.split(' | ')
  ok(!traite(sansCommentaires(lire(f)), code), `l’entrée « ${f.split('/').pop()} ne traite pas ${code} » est encore vraie — sinon la retirer du gel`)
}
info(`${defautsNommes} DÉFAUT(S) NOMMÉ(S) au gel — lus, pas acquittés, rendus à l’arbitrage`)

fin(`Chaque refus commerce dit ce qui bloque et quoi faire — sur tout le périmètre. ${defautsNommes} défaut(s) nommé(s) attendent un arbitrage.`)
