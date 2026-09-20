// scripts/diag-expert-name-masking.mjs — le masquage d'identité expert,
// ÉPROUVÉ EN L'EXÉCUTANT.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG EST DIFFÉRENT DES AUTRES
//   Les trois diagnostics précédents vérifient la FORME DU CODE : telle garde
//   est appelée, telle valeur n'est jamais écrite. C'est tout ce qu'on peut
//   faire sur des routes qui parlent à une base.
//
//   Ici, non. Le masquage est une fonction PURE, et sa correction tient
//   presque entièrement à une douzaine de cas limites — nom d'une lettre,
//   prénom absent, accent décomposé, particule, apostrophe, alphabet sans
//   casse, eszett qui double en majuscule. Relire le code ne prouve rien ;
//   l'exécuter, si. C'est le premier script du projet qui teste un
//   COMPORTEMENT.
//
//   Node 24 retire les annotations de type nativement (`process.features
//   .typescript === 'strip'`) : on importe donc lib/expert-name-code.ts
//   DIRECTEMENT. Ce module a été isolé sans aucun import — ni alias `@/`, ni
//   JSON — précisément pour être chargeable ici.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-expert-name-masking.mjs
//
// AUCUN accès base, aucune variable d'environnement, aucun réseau.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { expertNameCode, firstLetters } from '../lib/expert-name-code.ts'
import { fichiers, lire, sansCommentaires as sansComm } from './balayage-promesse.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * Fins de ligne NORMALISEES. Le depot sort les fichiers en CRLF : un controle
 * dont le motif traverse une fin de ligne (`...\n\s+...`) ne matche jamais sur
 * une copie de travail fraichement extraite, et le diagnostic vire au rouge
 * sans qu'aucun code n'ait change. Un diagnostic dont le resultat depend de la
 * machine qui l'execute ne dit pas si le code est juste : il dit d'ou il vient.
 */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

/**
 * Retire les commentaires avant de chercher un anti-pattern. Sans ça, ce diag
 * interdirait de DOCUMENTER le piège qu'il surveille : le module explique en
 * toutes lettres pourquoi `toLocaleUpperCase()` serait faux, et cette phrase
 * suffisait à déclencher l'alerte. Même correctif que dans diag-suspension.
 */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => {
      const t = l.trimStart()
      return !t.startsWith('//') && !t.startsWith('*')
    })
    .join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const eq = (actual, expected, label) =>
  ok(actual === expected, `${label} → ${JSON.stringify(actual)}`,
    actual === expected ? undefined : `attendu ${JSON.stringify(expected)}`)
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

// ═══ A. LA RÈGLE NOMINALE ══════════════════════════════════════════════════
section('A. Règle nominale — 1 lettre du prénom + 2 du nom')

eq(expertNameCode('Youssef', 'Cherif'), 'YCH', 'Youssef Cherif')
eq(expertNameCode('Sonia', 'Idrissi'), 'SID', 'Sonia Idrissi')
eq(expertNameCode('Marie', 'Dupont'), 'MDU', 'Marie Dupont')
ok(expertNameCode('Youssef', 'Cherif').length === 3, 'le code nominal fait 3 caractères')
ok(!/[\s.]/.test(expertNameCode('Youssef', 'Cherif')), 'ni espace ni point dans le code')

// ═══ B. LES CAS LIMITES — le cœur de la règle ══════════════════════════════
section('B. Cas limites')

// Nom d'une seule lettre : jusqu'à 2 lettres, on ne complète pas.
eq(expertNameCode('Youssef', 'O'), 'YO', 'nom d’une lettre — Youssef O')

// Nom absent → 3 lettres du PRÉNOM (asymétrie voulue).
eq(expertNameCode('Youssef', null), 'YOU', 'nom absent (null)')
eq(expertNameCode('Youssef', ''), 'YOU', 'nom vide')
eq(expertNameCode('Youssef', '   '), 'YOU', 'nom en espaces seuls')
eq(expertNameCode('Bo', null), 'BO', 'nom absent, prénom de 2 lettres')
eq(expertNameCode('A', null), 'A', 'nom absent, prénom d’une lettre')

// Prénom absent → 2 lettres du NOM, JAMAIS plus (partie identifiante).
eq(expertNameCode(null, 'Cherif'), 'CH', 'prénom absent')
eq(expertNameCode('', 'Cherif'), 'CH', 'prénom vide')
ok((expertNameCode(null, 'Cherif') ?? '').length <= 2,
  'prénom absent : jamais plus de 2 lettres du patronyme',
  'le patronyme est la partie identifiante')

// Les deux absents → null, JAMAIS la chaîne vide.
eq(expertNameCode(null, null), null, 'les deux absents')
eq(expertNameCode('', ''), null, 'les deux vides')
eq(expertNameCode('  ', '  '), null, 'les deux en espaces')
ok(expertNameCode(null, null) !== '', 'jamais la chaîne vide — l’appelant DOIT choisir un repli')

// Aucune lettre exploitable.
eq(expertNameCode('😀', '🎉'), null, 'emoji seuls — aucune lettre')
eq(expertNameCode('??', '—'), null, 'ponctuation seule')
eq(expertNameCode('Youssef', '—'), 'YOU', 'nom sans lettre → repli sur le prénom')
eq(expertNameCode('123', 'Cherif'), 'CH', 'prénom sans lettre → 2 lettres du nom')

section('B bis. Accents et normalisation Unicode')

// Les litteraux de CE fichier sont deja en NFC : comparer deux litteraux
// identiques ne prouverait rien. On construit donc explicitement la forme
// DECOMPOSEE, celle qu'un navigateur macOS ou un import CSV peut produire.
const NFC_FIRST = 'Élodie'.normalize('NFC')
const NFC_LAST = 'Ávila'.normalize('NFC')
const NFD_FIRST = NFC_FIRST.normalize('NFD')
const NFD_LAST = NFC_LAST.normalize('NFD')
ok(NFD_FIRST !== NFC_FIRST && NFD_LAST !== NFC_LAST,
  `les deux formes sont bien distinctes (NFD = ${[...NFD_FIRST].length} code points, NFC = ${[...NFC_FIRST].length})`)

eq(expertNameCode(NFC_FIRST, NFC_LAST), 'ÉÁV', 'accents precomposes (NFC)')
// Sans normalize('NFC') dans firstLetters, on prendrait 'E' puis l'accent
// combinant seul — un carre vide a l'ecran.
eq(expertNameCode(NFD_FIRST, NFD_LAST), 'ÉÁV', 'accents DECOMPOSES (NFD)')
ok(expertNameCode(NFD_FIRST, NFD_LAST) === expertNameCode(NFC_FIRST, NFC_LAST),
  'NFD et NFC produisent le MEME code',
  'sans normalisation, deux saisies du meme nom donneraient deux codes differents')
// Aucun accent combinant orphelin ne doit subsister (\p{Mn} = Mark, nonspacing).
ok(!/\p{Mn}/u.test(expertNameCode(NFD_FIRST, NFD_LAST) ?? ''),
  'aucun diacritique combinant détaché dans le résultat')

section('B ter. Séparateurs, particules, casse')

eq(expertNameCode('Jean-Pierre', 'Dupont'), 'JDU', 'prénom composé au tiret')
eq(expertNameCode('Youssef', "D'Amico"), 'YDA', 'apostrophe droite sautée')
eq(expertNameCode('Youssef', 'D’Amico'), 'YDA', 'apostrophe typographique sautée')
ok(!/['’-]/.test(expertNameCode('Youssef', "D'Amico") ?? ''),
  'aucun séparateur dans le code',
  'un « YD\' » afficherait une apostrophe orpheline')
eq(expertNameCode('Youssef', 'Van Der Berg'), 'YVA', 'particule — 2 premières lettres du nom entier')
eq(expertNameCode('Youssef', '  Cherif'), 'YCH', 'espaces de tête ignorés')
eq(expertNameCode('youssef', 'cherif'), 'YCH', 'saisie en minuscules → majuscules')
eq(expertNameCode('YOUSSEF', 'CHERIF'), 'YCH', 'saisie déjà en majuscules')

// Eszett : 'ß'.toUpperCase() vaut 'SS' — le code doit rester borné.
eq(firstLetters('ßeta', 2), 'SE', 'eszett en 1re position ne double pas le résultat')
ok(expertNameCode('Stefan', 'Straße').length === 3, 'nom avec eszett : code de 3 caractères')

section('B quater. Alphabets non latins')

eq(expertNameCode('يوسف', 'شريف'), 'يشر', 'arabe (pas de casse)')
eq(expertNameCode('Юссеф', 'Шариф'), 'ЮША', 'cyrillique')
eq(expertNameCode('小明', '王'), '小王', 'CJK — patronyme d’un sinogramme')
for (const [f, l] of [['يوسف', 'شريف'], ['Юссеф', 'Шариф'], ['小明', '王']]) {
  const code = expertNameCode(f, l)
  ok(!!code && code.length >= 2, `non latin « ${f} ${l} » → code non vide (${code})`)
}

// ═══ C. INVARIANTS DE SÉCURITÉ ═════════════════════════════════════════════
section('C. Invariants — le code ne doit rien divulguer de plus')

const CASES = [
  ['Youssef', 'Cherif'], ['Sonia', 'Idrissi'], ['Jean-Pierre', "D'Amico"],
  ['Élodie', 'Ávila'], ['Youssef', 'Van Der Berg'], ['Stefan', 'Straße'],
  ['Marie', 'O'], ['Юссеф', 'Шариф'],
]
for (const [f, l] of CASES) {
  const code = expertNameCode(f, l) ?? ''
  ok(code.length <= 3, `« ${f} ${l} » : code borné à 3 caractères (${code})`)
  // Le nom complet ne doit JAMAIS apparaître tel quel.
  ok(!code.includes(f) || f.length <= 1, `« ${f} ${l} » : le prénom entier n’apparaît pas`)
  ok(!code.toLowerCase().includes(l.toLowerCase()) || l.length <= 2,
    `« ${f} ${l} » : le patronyme entier n’apparaît pas`)
  // Au plus 2 lettres du patronyme, toujours.
  const fromLast = code.slice(firstLetters(f, 1).length)
  ok(fromLast.length <= 2, `« ${f} ${l} » : au plus 2 lettres du patronyme (${fromLast})`)
}

// Déterminisme : même entrée, même sortie, quelle que soit la locale du process.
ok(expertNameCode('Ibrahim', 'Iyi') === expertNameCode('Ibrahim', 'Iyi'),
  'la fonction est déterministe')
// Cherché dans le CODE seul : le module explique justement pourquoi la
// variante locale serait fausse.
ok(!stripComments(read('lib/expert-name-code.ts')).includes('toLocaleUpperCase'),
  'toUpperCase() invariant, jamais toLocaleUpperCase()',
  "sans argument, la variante locale suit la locale du runtime : 'i' → 'İ' en turc")

// ═══ D. LIBELLÉS DE REPLI — TRADUITS, PLUS EN DUR ══════════════════════════
// ═══ C bis. §D.4 — AUCUN CHEMIN SERVEUR NE PROJETTE L'IDENTITÉ DE CONTACT ══
section('C bis. §D.4 — e-mail, téléphone, LinkedIn, CV : projetés par AUCUNE route hors admin et hors soi-même')
//
// ┌─ CONVERTI EN BALAYAGE (lot C4b, 20/09/2026) ────────────────────────────┐
// │ §D.4 dit « aucun chemin serveur ». Le contrôle nommait cinq fichiers.   │
// │ Il balaie désormais `app/api/` + `lib/` : toute chaîne de `select(…)`   │
// │ qui EMBARQUE l'identité d'un expert (`profiles(…)`, `users!…(…)`, ou    │
// │ une lecture de `profiles`/`users`) et y cite `email`, `phone`,          │
// │ `linkedin_url` ou `cv_url` est un CANDIDAT. Il est légitime si :         │
// │   · la route est ADMIN (`requireAdmin(`) — l'administrateur voit tout ;  │
// │   · la lecture est celle du compte APPELANT (`auth.user.id`, `user.id`) ;│
// │   · c'est un cron (`CRON_SECRET`) ou une fonction interne de `lib/` qui  │
// │     ne construit pas une réponse — chacune LUE et gelée avec sa raison.  │
// │ Tout le reste est rouge : c'est un profil expert qui part vers une       │
// │ organisation avec son contact.                                            │
// └─────────────────────────────────────────────────────────────────────────┘

const CHAMPS_CONTACT = /\b(email|phone|linkedin_url|cv_url)\b/
const IDENTITE = /\b(profiles|users)\b/
/** Les chaînes de select d'un source qui embarquent l'identité ET un champ de contact. */
function selectsSensibles(src) {
  const out = []
  for (const m of src.matchAll(/\.select\(\s*((?:'[^']*'\s*\+?\s*)+)/g)) {
    const chaine = m[1]
    if (IDENTITE.test(chaine) && CHAMPS_CONTACT.test(chaine)) out.push(chaine.replace(/\s+/g, ' ').slice(0, 90))
  }
  // et la lecture directe d'une table d'identité dont le select cite un champ de contact
  for (const m of src.matchAll(/\.from\(\s*'(profiles|users)'\s*\)[\s\S]{0,400}?\.select\(\s*((?:'[^']*'\s*\+?\s*)+)/g)) {
    if (CHAMPS_CONTACT.test(m[2])) out.push(`${m[1]} → ${m[2].replace(/\s+/g, ' ').slice(0, 80)}`)
  }
  return [...new Set(out)]
}
const estAdmin = (src) => /\brequireAdmin\(/.test(src)
const estCron = (src) => /CRON_SECRET/.test(src)
const litSoiMeme = (src) => /\.eq\(\s*'(?:id|user_id)'\s*,\s*(?:auth\.)?user\.id\s*\)/.test(src) || /\.eq\(\s*'user_id'\s*,\s*userId\s*\)/.test(src)

/** GEL — lib et routes LUES, une raison chacune (§G.8). */
const GEL_D4 = {
  'lib/notifications/dispatch.ts': 'LÉGITIME — le dispatcher lit l’e-mail du DESTINATAIRE pour lui envoyer sa notification ; jamais projeté vers un tiers',
  'lib/verification/expert-verification.ts': 'LÉGITIME — la vérification IA lit linkedin_url comme entrée du jugement ; le résultat est une note, pas un profil servi',
  'lib/hooks/useCdiProfile.ts': 'LÉGITIME — hook CLIENT qui lit le compte de l’utilisateur connecté (son propre e-mail) ; pas une projection vers une organisation',
  'lib/admin/user-actions-guard.ts': 'LÉGITIME — garde des actions du BACK-OFFICE : l’e-mail identifie la cible pour l’audit, et ses appelants sont des routes requireAdmin',
  'lib/billing/purchase.ts': 'LÉGITIME — l’e-mail de l’ACHETEUR lui-même, transmis à Stripe comme e-mail client ; rien ne part vers une organisation tierce',
  'app/api/profile/upload-cv/route.ts': 'LÉGITIME — dépôt de CV : le profil de l’appelant (rendu à lui-même)',
  'app/api/profile/cv-status/[jobId]/route.ts': 'LÉGITIME — suivi d’analyse du CV de l’appelant',
  'app/api/me/organisation/members/route.ts': 'LÉGITIME — les e-mails des MEMBRES de sa propre organisation, pas un profil expert',
}
// (account-purge, profile/route.ts, cdi-upload-cv, cv/reset lisent aussi l’identité de
//  l’appelant mais n’entrent pas dans le motif — écritures, ou lecture reconnue « soi-même » ;
//  on ne gèle pas ce que le motif ne dénonce pas.)
{
  const cibles = fichiers(['app/api', 'lib'])
  const candidats = []
  for (const f of cibles) {
    const src = sansComm(lire(f))
    const s = selectsSensibles(src)
    if (s.length) candidats.push({ f, src, selects: s })
  }
  const admin = candidats.filter((c) => estAdmin(c.src) || estCron(c.src))
  const restants = candidats.filter((c) => !estAdmin(c.src) && !estCron(c.src))
  console.log(`  ··   ${cibles.length} fichiers · ${candidats.length} lisent un champ de contact avec l’identité · ${admin.length} admin/cron`)
  ok(candidats.length >= 5, 'le balayage voit les lectures de contact (au moins cinq)', 'un inventaire vide : le motif `select(` ne lit plus le code')
  const rouges = restants.filter((c) => !(c.f in GEL_D4) && !litSoiMeme(c.src))
  for (const c of restants.filter((c) => c.f in GEL_D4)) console.log(`  ··   ${c.f} — GELÉ, ${GEL_D4[c.f].slice(0, 12)}…`)
  ok(rouges.length === 0, 'aucune route hors admin ne projette e-mail / téléphone / LinkedIn / CV d’un expert vers un tiers',
    rouges.map((c) => `${c.f} : ${c.selects[0]}`).join('\n       ') || undefined)
  const sorties = Object.keys(GEL_D4).filter((k) => !restants.some((c) => c.f === k))
  ok(sorties.length === 0, 'aucune entrée du gel §D.4 n’a cessé d’être vraie sans qu’on le dise', sorties.join(' ; ') || undefined)
  ok(Object.values(GEL_D4).every((r) => /^(LÉGITIME|DÉFAUT NOMMÉ)( |$)/.test(r)), 'chaque raison du gel §D.4 commence par LÉGITIME ou DÉFAUT NOMMÉ')
  // Et le module de divulgation lui-même ne rend jamais le contact.
  const disclosure = sansComm(lire('lib/expert-disclosure.ts'))
  ok(/reveal_contact:\s*false/.test(disclosure) && !/reveal_contact:\s*true/.test(disclosure), 'lib/expert-disclosure.ts : reveal_contact vaut false, partout, toujours')
}

section('D. Libellés de repli')

const masking = read('lib/expert-name-masking.ts')
for (const dead of ["'Expert'", "'Utilisateur supprimé'", "'Interlocuteur indisponible'"]) {
  ok(!masking.includes(`return ${dead}`),
    `plus de ${dead} en dur dans le code`,
    'ces chaînes étaient servies en français à une organisation anglophone')
}
ok(/expert_masking/.test(masking), 'les libellés viennent des messages')
ok(/from '@\/messages\/fr\.json'/.test(masking),
  'motif de lib/notifications/inapp-labels.ts réutilisé (lecture directe des JSON)')

for (const loc of ['fr', 'en', 'es', 'de']) {
  const m = JSON.parse(read(`messages/${loc}.json`))
  const e = m.expert_masking
  ok(!!e?.fallback && !!e?.deleted && !!e?.unavailable,
    `i18n ${loc} : expert_masking complet (${e?.fallback} / ${e?.deleted} / ${e?.unavailable})`)
}

// ═══ E. LA DOCUMENTATION NE MENT PLUS ══════════════════════════════════════
section('E. Documentation')

// On ne cherche PAS l'absence de toute mention de l'ancienne forme : la route
// messages la cite légitimement, au passé, pour expliquer que les
// notifications déjà persistées la conservent. Ce qu'on exige, c'est que la
// RÈGLE COURANTE décrite soit la bonne.
for (const [f, label] of [
  ['lib/expert-name-masking.ts', 'en-tête du module'],
  ['app/api/conversations/[id]/messages/route.ts', 'commentaire de la route messages'],
  ['components/dashboard/CandidatureCard.tsx', 'commentaire de la carte candidature'],
]) {
  ok(!read(f).includes('dernière lettre'),
    `${label} : ne présente plus l’ancienne règle comme la règle en vigueur`)
}
ok(read('lib/expert-name-masking.ts').includes('YCH'),
  'en-tête du module : documente la nouvelle forme avec ses exemples')
ok(/déjà persistées/i.test(read('app/api/conversations/[id]/messages/route.ts')),
  'route messages : explique la cohabitation des deux formes en base',
  'les anciennes notifications gardent la forme de leur époque — ce n’est pas un bug')
ok(read('components/dashboard/CandidatureCard.tsx').includes('NOM COMPLET'),
  'CandidatureCard : le commentaire dit la vérité (post-unlock actif = nom complet)',
  'un commentaire qui ment sur une règle de sécurité est pire que pas de commentaire')

// ═══ F. LE DRAPEAU is_masked EST SERVI, PAS DEVINÉ ═════════════════════════
section('F. is_masked — servi par le serveur')

ok(/export function isMaskedExpertName/.test(masking), 'isMaskedExpertName exporté')
for (const f of ['app/api/me/conversations/route.ts', 'app/api/conversations/[id]/messages/route.ts']) {
  ok(/is_masked/.test(read(f)), `${f} : sert is_masked`)
}
for (const f of ['components/dashboard/MessagesInbox.tsx', 'components/dashboard/ConversationView.tsx']) {
  const src = read(f)
  ok(/is_masked/.test(src), `${f} : lit le drapeau servi`)
  ok(!/\.name\[0\]/.test(src), `${f} : plus de découpe UTF-16 \`.name[0]\``,
    'un caractère hors plan de base produirait un carré vide')
}

console.log(failures === 0 ? '\n✔ TOUT VERT\n' : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC\n`)
process.exit(failures === 0 ? 0 : 1)
