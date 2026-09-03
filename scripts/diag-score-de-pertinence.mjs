// scripts/diag-score-de-pertinence.mjs — LE SCORE A CHANGÉ DE NATURE
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUI A CHANGÉ, ET POURQUOI CE SCRIPT EXISTE
//   `matches.score` portait une note de Claude sur 10, avec un barème écrit
//   dans le prompt. Elle était interprétable, et à peu près comparable d'une
//   annonce à l'autre.
//
//   Le score d'un reranker n'a AUCUNE de ces propriétés. Il vit dans [0,1], il
//   est propre à une requête, et le fournisseur écrit noir sur blanc qu'on ne
//   peut ni le lire comme une proportion, ni comparer les scores de deux
//   requêtes différentes.
//
//   Le risque n'est donc pas qu'on se trompe de colonne : c'est qu'un jour,
//   quelqu'un affiche « 0,4 / 10 », ou qu'un écran classe deux annonces sur une
//   échelle qui ne le permet pas. Rien dans le compilateur ne l'empêche : un
//   nombre reste un nombre.
//
// CE QUE CE SCRIPT VÉRIFIE — et il ÉCHOUE, ce n'est pas un recensement
//   A. la migration sépare les deux grandeurs, et les borne chacune ;
//   B. le score de pertinence NE SORT PAS de l'API — seul le palier sort ;
//   C. aucun nombre de pertinence n'atteint l'écran de l'expert ;
//   D. le palier n'est jamais RECALCULÉ à l'affichage ;
//   E. les deux échelles ne se croisent nulle part.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-score-de-pertinence.mjs
//
// AUCUN accès base, AUCUN réseau.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

/**
 * Une migration se retrouve par son SUFFIXE DESCRIPTIF, jamais par son numéro.
 * Les numéros ont déjà été réattribués une fois pour éviter une collision entre
 * copies de travail, et ce script avait alors cessé de pointer sur quoi que ce
 * soit — silencieusement.
 */
function migration(suffixe) {
  const dossier = join(ROOT, 'supabase', 'migrations')
  const f = readdirSync(dossier).find((x) => x.endsWith(`_${suffixe}.sql`))
  if (!f) {
    console.error(`\n❌ Migration introuvable : *_${suffixe}.sql`)
    process.exit(2)
  }
  return join('supabase', 'migrations', f)
}

let failures = 0
const ok = (cond, label, hint) => {
  if (!cond) failures++
  console.log(`  ${cond ? 'ok  ' : 'KO  '} ${label}`)
  if (!cond && hint) console.log(`       → ${hint}`)
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

/** Retire commentaires de ligne et blocs `$$…$$` : on ne lit que le code. */
const sansCommentaires = (sql) =>
  sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

// ══════════════════════════════════════════════════════════════════════════
section('ÉPREUVE DU DÉTECTEUR — avant de lui faire confiance')
// ══════════════════════════════════════════════════════════════════════════
//
// Le contrôle central de ce script cherche un NOMBRE DE PERTINENCE affiché.
// Un détecteur qui ne détecte rien passe pour vert. On l'éprouve donc à chaque
// exécution, sur des cas écrits ici.

/**
 * Une vue affiche-t-elle un nombre issu du score de pertinence ?
 *
 * On cherche les formes qui MÈNENT à un nombre visible : arrondi, division,
 * pourcentage, ou interpolation directe d'une variable de score. On ne cherche
 * PAS le mot « score » : il apparaît légitimement dans d'autres échelles
 * (vérification d'entreprise, note de candidature), et un contrôle qui crie au
 * loup finit ignoré.
 */
const NOMS_DE_SCORE = 'relevance_score|ai_score|matchScore|pertinence'
function nombresDePertinence(src) {
  const motifs = [
    new RegExp(`Math\\.round\\(\\s*[^)]*(?:${NOMS_DE_SCORE})`, 'g'),
    new RegExp(`toFixed\\(\\s*\\d*\\s*\\)[^\\n]*(?:${NOMS_DE_SCORE})`, 'g'),
    new RegExp(`\\{\\s*(?:[a-zA-Z_$.]*\\.)?(?:${NOMS_DE_SCORE})[a-zA-Z_$]*\\s*\\}`, 'g'),
    new RegExp(`(?:${NOMS_DE_SCORE})[a-zA-Z_$]*\\s*\\*\\s*100`, 'g'),
  ]
  const trouves = []
  for (const m of motifs) for (const t of src.matchAll(m)) trouves.push(t[0].replace(/\s+/g, ' '))
  return trouves
}

{
  const doitTrouver = [
    ['{t("x", { score: Math.round(ai_score) })}', 'un arrondi du score'],
    ['<span>{relevance_score}</span>', 'le score interpolé tel quel'],
    ['const pct = relevance_score * 100', 'un score converti en pourcentage'],
  ]
  const doitIgnorer = [
    ['{Math.round(verification.score)}', 'la note de vérification d entreprise'],
    ['{Math.round(ai_match_score)}', 'la note de candidature, sur 10, légitime'],
    ["order('relevance_score', { ascending: false })", 'un TRI par le score, jamais affiché'],
    ['  relevance_score: number | null', 'une DÉCLARATION de type, qui ne sort rien'],
    ['relevance_tier === "strong"', 'le palier, qui n est pas un nombre'],
  ]
  for (const [src, libelle] of doitTrouver) {
    ok(nombresDePertinence(src).length > 0, `détecte : ${libelle}`,
      'le détecteur laisserait passer un nombre affiché')
  }
  for (const [src, libelle] of doitIgnorer) {
    ok(nombresDePertinence(src).length === 0, `ignore : ${libelle}`,
      'faux positif : un contrôle qui crie au loup finit ignoré')
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('A. LA MIGRATION SÉPARE LES DEUX GRANDEURS')
// ══════════════════════════════════════════════════════════════════════════

const SQL = sansCommentaires(read(migration('score_de_pertinence')))

ok(/drop column if exists score\b/.test(SQL),
  'l ancienne note de matching est SUPPRIMÉE',
  'la garder inviterait à y ranger le score du reranker — deux grandeurs, une colonne')
ok(/add column if not exists relevance_score\s+numeric/.test(SQL),
  'relevance_score existe, en numeric')
ok(/relevance_score >= 0 and relevance_score <= 1/.test(SQL),
  'relevance_score est bornée à [0,1]',
  'sans borne, une valeur sur 10 s y rangerait sans un mot')
ok(/add column if not exists relevance_model/.test(SQL),
  'le modèle qui a produit le score est conservé',
  'changer de reranker change l échelle : un score sans son modèle est illisible')

ok(/add column if not exists relevance_tier/.test(SQL),
  'le PALIER affiché existe en base')
ok(/relevance_tier in \('strong', 'normal'\)/.test(SQL),
  'le palier est borné à deux valeurs',
  'une troisième valeur réintroduirait une graduation, donc un classement')

ok(/ai_match_score >= 0 and ai_match_score <= 10/.test(SQL),
  'la note de candidature reste bornée à [0,10]',
  'c est une AUTRE échelle : les deux bornes doivent rester distinctes')

ok(/create index if not exists matches_profile_relevance_idx/.test(SQL),
  'l index du flux porte sur la nouvelle colonne')
ok(/drop index if exists public\.matches_profile_score_idx/.test(SQL),
  'l index de l ancienne colonne est retiré',
  'un index sur une colonne supprimée fait échouer la migration')

// ══════════════════════════════════════════════════════════════════════════
section('B. LE SCORE NE SORT PAS DE L API')
// ══════════════════════════════════════════════════════════════════════════

const ROUTES_FLUX = [
  'app/api/me/missions/route.ts',
  'app/api/me/missions/[id]/route.ts',
]
for (const r of ROUTES_FLUX) {
  const src = read(r)
  ok(/relevance_tier:/.test(src), `${r} rend le PALIER`)
  // Le score peut être TRIÉ (son nom passe alors en chaîne à `.order()`) mais
  // jamais LU. Le déclarer dans un type ne le sort pas non plus — seule une
  // lecture de la valeur, `row.relevance_score`, peut finir dans une réponse.
  const lectures = [...src.matchAll(/\b\w+\.relevance_score\b/g)].map((m) => m[0])
  ok(lectures.length === 0, `${r} ne LIT jamais la valeur du score`,
    lectures.length
      ? `trouvé : ${lectures.join(' ; ')} — sorti de l API, un nombre finit affiché`
      : undefined)
}
ok(/order\('relevance_score'/.test(read('app/api/me/missions/route.ts')),
  'le flux est ORDONNÉ par le score',
  'ordonner reste juste : c est afficher qui ne l est pas')

// ══════════════════════════════════════════════════════════════════════════
section('C. AUCUN NOMBRE DE PERTINENCE À L ÉCRAN')
// ══════════════════════════════════════════════════════════════════════════

const VUES_EXPERT = [
  'components/dashboard/MissionCard.tsx',
  'components/dashboard/MissionCastingCard.tsx',
  'components/dashboard/MissionDetailView.tsx',
  'components/dashboard/CastingCarousel.tsx',
]
for (const v of VUES_EXPERT) {
  const trouves = nombresDePertinence(read(v))
  ok(trouves.length === 0, `${v.split('/').pop()} n affiche aucun nombre`,
    trouves.length ? `trouvé : ${trouves.slice(0, 3).join(' ; ')}` : undefined)
}

const LOCALES = ['fr', 'en', 'es', 'de']
const MSG = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`messages/${l}.json`))]))
const lire = (m, chemin) => chemin.split('.').reduce((o, k) => (o == null ? o : o[k]), m)

// Un libellé qui contient encore « {score} » est une invitation permanente à
// réafficher le nombre. Il ne doit plus exister dans AUCUNE langue.
for (const chemin of ['missions.card.ai_score', 'missions.detail.ai_score_label', 'missions.casting.top_match']) {
  const survivantes = LOCALES.filter((l) => lire(MSG[l], chemin) !== undefined)
  ok(survivantes.length === 0, `« ${chemin} » n existe plus`,
    survivantes.length
      ? `encore présent en : ${survivantes.join(', ')} — quelqu un le réutilisera`
      : undefined)
}

for (const cle of ['strong', 'normal', 'tooltip']) {
  const absentes = LOCALES.filter((l) => !lire(MSG[l], `matching_badge.${cle}`))
  ok(absentes.length === 0, `matching_badge.${cle} dans les 4 langues`,
    absentes.join(', ') || undefined)
}
for (const l of LOCALES) {
  for (const cle of ['strong', 'normal']) {
    const v = String(lire(MSG[l], `matching_badge.${cle}`) ?? '')
    ok(!/\{\s*score\s*\}|\d+\s*\/\s*10|%/.test(v),
      `matching_badge.${cle} (${l}) ne porte aucun nombre`,
      `libellé : « ${v} »`)
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('D. LE PALIER N EST JAMAIS RECALCULÉ À L AFFICHAGE')
// ══════════════════════════════════════════════════════════════════════════
//
// Le seuil est réglable et les scores ne sont pas comparables entre deux runs.
// Recalculer le palier à l'affichage rebaptiserait en silence des matches
// anciens : un expert verrait « forte » redevenir « correspondance » sans que
// rien n'ait changé pour lui.

for (const v of VUES_EXPERT) {
  const src = read(v)
  const comparaisons = [
    ...src.matchAll(new RegExp(`(?:${NOMS_DE_SCORE})[a-zA-Z_$]*\\s*(?:>=|>|<|<=)\\s*[\\w.]+`, 'g')),
  ].map((m) => m[0])
  ok(comparaisons.length === 0, `${v.split('/').pop()} ne compare aucun score à un seuil`,
    comparaisons.length ? `trouvé : ${comparaisons.join(' ; ')}` : undefined)
  ok(!/TOP_MATCH_THRESHOLD\s*=/.test(src), `${v.split('/').pop()} ne redéfinit aucun seuil local`,
    'un seuil dans une vue est un second réglage que personne ne sait retrouver')
}

// ══════════════════════════════════════════════════════════════════════════
section('E. LES DEUX ÉCHELLES NE SE CROISENT PAS')
// ══════════════════════════════════════════════════════════════════════════

const CANDIDATURES = read('app/api/candidatures/route.ts')
ok(/ai_match_score: null/.test(CANDIDATURES),
  'la note de candidature n est plus recopiée depuis le matching',
  'ranger un score de pertinence dans une échelle sur 10 le ferait lire « 0,73 / 10 »')
ok(!/ai_match_score:\s*matchRow\./.test(CANDIDATURES),
  'aucune reprise du score de match dans la note de candidature')
ok(!/\bmatchRow\.score\b/.test(CANDIDATURES),
  'plus aucune lecture de l ancienne colonne')

// ══════════════════════════════════════════════════════════════════════════
console.log(
  failures === 0
    ? '\n✅ Le score a bien changé de nature : une grandeur, une colonne, un palier.\n'
    : `\n❌ ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
