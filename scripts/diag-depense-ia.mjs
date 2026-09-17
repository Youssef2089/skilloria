// scripts/diag-depense-ia.mjs — TOUT APPEL PAYANT SE COMPTE, ET REGARDE LE PLAFOND.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE DEFAUT QU'ON FERME
//   CINQ des SEPT points de depense n'enregistraient RIEN et ne consultaient
//   JAMAIS le plafond. Le « plafond Claude 100 $ » ne comptait donc que le
//   jugement de candidature et le pitch : l'analyse de CV, la verification
//   d'expert, la verification d'entreprise et la gate qualite d'annonce
//   depensaient hors de toute comptabilite ET hors de tout plafond.
//
//   AVANT DE REPARTIR PAR ACTEUR, LE TOTAL ETAIT DEJA FAUX.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI UN CONTROLE DE CLASSE, ET PAS CINQ CONTROLES DE CAS
//
//   Corriger les cinq ne suffit pas : le SIXIEME sera ecrit demain, par
//   quelqu'un qui n'aura pas lu cette histoire. Un controle qui tient une liste
//   de cinq fichiers reste vert sur le sixieme — et c'est exactement comme ca
//   que ces cinq-la sont apparus.
//
//   Ce diagnostic DECOUVRE donc tout fichier qui appelle un modele payant, et
//   exige de chacun deux choses :
//     ① qu'il consulte le plafond AVANT d'appeler ;
//     ② qu'il enregistre la depense APRES.
//
//   Une fonction PURE est dispensee de les faire elle-meme — c'est la regle du
//   projet : aucune fonction pure ne devient impure. Mais alors elle doit RENDRE
//   ce qu'elle a consomme, et son appelant doit faire les deux. Le controle suit
//   donc la chaine plutot que de lire un fichier isole.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ET LE SECOND DEFAUT : COMPTER SANS SAVOIR POUR QUI
//
//   Une fois les sept points comptes, le total etait juste et MUET : une seule
//   organisation pouvait remplir le plafond de tout l'ecosysteme sans qu'aucune
//   requete ne puisse le montrer. Les identifiants d'acteur existaient — dans
//   le `context` jsonb, c'est-a-dire nulle part ou l'on puisse sommer.
//
//   Les sections F a H exigent donc trois choses de plus :
//     ③ que chaque depense NOMME son acteur declencheur, et UN SEUL ;
//     ④ qu'un depassement par acteur ALERTE sans jamais bloquer ;
//     ⑤ que la somme des lignes affichees EGALE la depense du mois — sans quoi
//       le tableau de bord cesse d'etre croyable, et donc d'etre lu.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-depense-ia.mjs
//
// AUCUN acces base, AUCUN reseau, AUCUNE variable d'environnement.
// LECTURE PURE : ce script n'ecrit JAMAIS.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Fins de ligne NORMALISEES : le depot sort les fichiers en CRLF, et un retour
// chariot casse tout motif qui traverse un saut de ligne.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

let echecs = 0
const ok = (cond, libelle, indice) => {
  if (cond) console.log(`  ok   ${libelle}`)
  else { echecs++; console.log(`  KO   ${libelle}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

/** Commentaires retires — LIGNES d'abord, BLOCS ensuite (cf. §E.3 et §E.12). */
const sansCommentaires = (src) =>
  src.replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '')

// ─────────────────────────────────────────────────────────────────────────────
// 1. DECOUVRIR LES APPELS PAYANTS — app/ ET lib/, jamais une liste
// ─────────────────────────────────────────────────────────────────────────────

/**
 * UN APPEL, PAS UNE MENTION.
 *   `messages.create(` sur un client Anthropic, ou un POST vers l'API Cohere.
 *   Le nom d'un fournisseur CITE dans un commentaire ou un libelle ne depense
 *   rien — d'ou le depouillement, et d'ou des motifs qui exigent un APPEL.
 */
const APPEL_PAYANT = [
  { re: /\.messages\.create\s*\(/, quoi: 'Anthropic messages.create' },
  { re: /api\.cohere\.com/, quoi: 'API Cohere' },
]

const RACINES = ['app', 'lib']
const fichiers = []
;(function parcourir(d) {
  for (const e of readdirSync(join(ROOT, d))) {
    const rel = `${d}/${e}`
    if (statSync(join(ROOT, rel)).isDirectory()) parcourir(rel)
    else if (/\.(ts|tsx)$/.test(e)) fichiers.push(rel)
  }
})(RACINES[0])
;(function parcourir(d) {
  for (const e of readdirSync(join(ROOT, d))) {
    const rel = `${d}/${e}`
    if (statSync(join(ROOT, rel)).isDirectory()) parcourir(rel)
    else if (/\.(ts|tsx)$/.test(e)) fichiers.push(rel)
  }
})(RACINES[1])

const depensiers = []
for (const f of fichiers) {
  const code = sansCommentaires(read(f))
  const motif = APPEL_PAYANT.find((m) => m.re.test(code))
  if (motif) depensiers.push({ fichier: f, quoi: motif.quoi, code })
}

section('A. Tout fichier qui appelle un modele payant est compte')

console.log(`       ${depensiers.length} fichier(s) sur ${fichiers.length} appellent un modele payant :`)
for (const d of depensiers) console.log(`         ${d.fichier}  (${d.quoi})`)
console.log('')

/**
 * QUI EST L'APPELANT D'UNE FONCTION PURE ?
 *   Un fichier pur ne fait ni l'un ni l'autre — il REND sa consommation. Le
 *   controle remonte alors a celui qui l'importe, et c'est LUI qu'on exige.
 *   Decouvert par balayage, jamais par une liste : une liste laisserait passer
 *   le sixieme.
 */
function appelantsDe(module) {
  const nom = module.replace(/^lib\//, '@/lib/').replace(/\.tsx?$/, '')
  const relatif = module.split('/').pop().replace(/\.tsx?$/, '')
  const out = []
  for (const f of fichiers) {
    if (f === module) continue
    const code = sansCommentaires(read(f))
    if (
      new RegExp(`from\\s+'${nom.replace(/[/@.]/g, '\\$&')}'`).test(code) ||
      new RegExp(`from\\s+'\\./${relatif}'`).test(code) ||
      new RegExp(`from\\s+'\\.\\./${relatif}'`).test(code)
    ) out.push(f)
  }
  return out
}

const CONSULTE = /\bbudgetDisponible\s*\(/
const ENREGISTRE = /\benregistrerDepenseIA\s*\(/
const REND_CONSOMMATION = /\bConsommationIA\b/

for (const d of depensiers) {
  const consulte = CONSULTE.test(d.code)
  const enregistre = ENREGISTRE.test(d.code)

  if (consulte && enregistre) {
    ok(true, `${d.fichier} — consulte le plafond ET enregistre`)
    continue
  }

  // FONCTION PURE : dispensee, a condition de RENDRE sa consommation et
  // d'avoir au moins un appelant qui fait les deux.
  if (REND_CONSOMMATION.test(d.code)) {
    const appelants = appelantsDe(d.fichier)
    const complets = appelants.filter((a) => {
      const c = sansCommentaires(read(a))
      return CONSULTE.test(c) && ENREGISTRE.test(c)
    })
    ok(
      complets.length > 0,
      `${d.fichier} — PUR : rend sa consommation, ${complets.length} appelant(s) la comptent`,
      appelants.length === 0
        ? 'aucun appelant trouve : la consommation rendue n’est comptee nulle part'
        : `appelants sans comptage : ${appelants.filter((a) => !complets.includes(a)).join(', ')}`,
    )
    continue
  }

  // Ni l'un, ni l'autre, ni pur : c'est le defaut nominal.
  ok(false, `${d.fichier} — appelle un modele payant sans le compter`,
    `${consulte ? '' : 'ne consulte PAS le plafond. '}${enregistre ? '' : 'n’enregistre PAS la depense. '}` +
      'Soit il fait les deux, soit il rend une ConsommationIA et son appelant les fait.')
}

section('B. Le tarif suit le modele appele')

// LE DEFAUT CORRIGE : 3 $ / 15 $ — les prix de Sonnet 4.6 — etaient appliques a
// TOUS les appels Claude, dont Sonnet 5 (2/10) et, demain, Haiku (1/5).
{
  const enDur = []
  for (const f of fichiers) {
    const code = sansCommentaires(read(f))
    if (/\b(COUT_USD|PRIX_USD|USD_PAR_1M|COST_USD_PER)\w*\s*=\s*[\d.]/.test(code)) enDur.push(f)
  }
  ok(enDur.length === 0, 'aucun tarif codé en dur dans app/ ni lib/',
    enDur.length ? `trouve dans : ${enDur.join(', ')}` : undefined)

  const budget = sansCommentaires(read('lib/ai-budget.ts'))
  ok(/from\s+'ai_model_tarifs'|\.from\('ai_model_tarifs'\)/.test(budget),
    'le tarif est LU en base (ai_model_tarifs)',
    'un tarif en constante diverge du modele des qu’on change de modele')
  ok(/tarif_manquant/.test(budget),
    'un tarif inconnu est SIGNALE, pas remplace par zero en silence',
    'un cout nul silencieux ferait deriver le plafond sans que rien ne le dise')

  // CHAQUE MODELE APPELE DOIT AVOIR UN TARIF. C'est ce qui empeche « tarif
  // manquant » d'arriver en production plutot que de s'y constater.
  const modeles = new Set()
  for (const f of fichiers) {
    const code = sansCommentaires(read(f))
    for (const m of code.matchAll(/'(claude-[a-z0-9.-]+)'/g)) modeles.add(m[1])
  }
  const migrations = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((x) => x.endsWith('.sql'))
  const grille = migrations.map((m) => read(`supabase/migrations/${m}`)).join('\n')
  const sansTarif = [...modeles].filter((m) => !grille.includes(`'${m}'`))
  ok(sansTarif.length === 0,
    `les ${modeles.size} modele(s) Claude cites dans le code ont un tarif seede`,
    sansTarif.length ? `sans tarif : ${sansTarif.join(', ')} — leur depense serait comptee ZERO` : undefined)
}

section('C. Un echec d’enregistrement ne casse aucun parcours')

{
  const budget = read('lib/ai-budget.ts')
  const code = sansCommentaires(budget)

  // ANCRE sur le CORPS de chaque fonction, pas sur le fichier : une regex
  // lachee trouverait le `try` de l'autre fonction et resterait verte.
  for (const nom of ['enregistrerDepense', 'enregistrerDepenseIA']) {
    const i = code.search(new RegExp(`export async function ${nom}\\b`))
    if (i === -1) { ok(false, `${nom} introuvable`); continue }
    const fin = code.indexOf('\nexport ', i + 1)
    const corps = code.slice(i, fin === -1 ? code.length : fin)
    ok(/try\s*\{/.test(corps) && /catch\s*\(/.test(corps),
      `${nom} — entoure d’un try/catch : ne leve sur AUCUN chemin`,
      'un expert qui depose son CV ne doit pas etre bloque parce qu’on n’a pas su compter une depense')
    ok(!/\bthrow\b/.test(corps), `${nom} — ne relance jamais`,
      'relancer transformerait un defaut de comptabilite en echec de parcours')
  }

  // chargerTarif aussi : une panne de lecture du tarif ne doit rien casser.
  const iT = code.search(/async function chargerTarif\b/)
  const corpsT = iT === -1 ? '' : code.slice(iT, code.indexOf('\n}', iT) + 2)
  ok(iT !== -1 && /catch\s*\{/.test(corpsT),
    'chargerTarif — une panne de lecture rend null, elle ne leve pas')
}

section('D. Le fail-closed du plafond est preserve')

{
  const code = sansCommentaires(read('lib/ai-budget.ts'))
  const i = code.search(/export async function budgetDisponible\b/)
  const corps = code.slice(i, code.indexOf('\nexport ', i + 1))
  // C'est l'EXCEPTION assumee au fail-open du reste du projet : ne pas savoir
  // combien on a depense n'autorise pas a depenser plus. Ne pas l'uniformiser
  // par souci de coherence.
  ok(/ok: false/.test(corps) && /illisible/.test(corps),
    'une lecture de depense en echec REFUSE (fail-closed)',
    'un fail-open ici laisserait depenser a l’aveugle — c’est l’argent qu’il protege')
  ok(!/ok: true/.test(corps.split('if (error)')[1]?.split('}')[0] ?? ''),
    'aucun chemin ne rend « autorise » sur une erreur de lecture')
}

section('E. Le detecteur lui-meme est eprouve')

{
  const cas = [
    ['const r = await client.messages.create({ model })', true, 'un appel Anthropic'],
    ["await fetch('https://api.cohere.com/v2/rerank')", true, 'un appel Cohere'],
    ["const doc = 'voir client.messages.create pour le detail'", false, 'une MENTION dans une chaine'],
    ['const x = 1', false, 'du code ordinaire'],
  ]
  for (const [src, attendu, quoi] of cas) {
    const trouve = APPEL_PAYANT.some((m) => m.re.test(sansCommentaires(src)))
    ok(trouve === attendu, `${attendu ? 'detecte' : 'ignore'} : ${quoi}`,
      attendu ? 'le detecteur laisserait passer un point de depense muet'
              : 'faux positif : un controle qui crie a tort finit ignore')
  }
  // Un appel CITE en commentaire ne depense rien.
  ok(!APPEL_PAYANT.some((m) => m.re.test(sansCommentaires('// on appelle client.messages.create ici'))),
    'ignore : un appel cite dans un commentaire',
    'un anti-pattern doit pouvoir etre DOCUMENTE')
}

section('F. Toute depense NOMME son acteur declencheur')

// Le type `ActeurIA` rend l'oubli non compilable — ce controle verifie que le
// type existe TOUJOURS sous cette forme, et que personne ne l'a assoupli en
// deux champs optionnels « juste pour ce cas-la ».
{
  const BUDGET = sansCommentaires(read('lib/ai-budget.ts'))

  ok(/export type ActeurIA\s*=/.test(BUDGET),
    'le type ActeurIA existe',
    'sans lui, un point de depense peut enregistrer sans acteur')

  // L'union interdit STRUCTURELLEMENT les deux acteurs a la fois. Deux champs
  // optionnels les autoriseraient, et les deux sommes compteraient deux fois la
  // meme depense.
  const uni = BUDGET.slice(BUDGET.indexOf('export type ActeurIA'))
  const corpsUnion = uni.slice(0, uni.indexOf('\n\n'))
  ok(
    /\{\s*type:\s*'organization';\s*id:\s*string\s*\}/.test(corpsUnion) &&
      /\{\s*type:\s*'profile';\s*id:\s*string\s*\}/.test(corpsUnion),
    'ActeurIA est une UNION — deux acteurs a la fois ne compilent pas',
    'deux champs optionnels laisseraient les sommes se compter deux fois')

  // L'argument est OBLIGATOIRE : `acteur?` reintroduirait le defaut silencieux.
  const sig = BUDGET.slice(BUDGET.indexOf('export async function enregistrerDepenseIA'))
  const argsIA = sig.slice(0, sig.indexOf('): Promise'))
  ok(/\n\s*acteur:\s*ActeurIA/.test(argsIA) && !/acteur\?:/.test(argsIA),
    'l’argument acteur est OBLIGATOIRE, sans defaut',
    'un acteur optionnel rend le non-imputable possible par simple oubli')

  // Les deux colonnes sont REELLEMENT ecrites, et depuis le type.
  ok(/organization_id: args\.acteur\.type === 'organization'/.test(BUDGET) &&
     /profile_id: args\.acteur\.type === 'profile'/.test(BUDGET),
    'les deux colonnes d’acteur sont ecrites depuis le type',
    'un acteur porte seulement dans le contexte jsonb reste inagregeable')

  // CHAQUE appel passe un acteur. Le compilateur le garantit deja ; on le
  // verifie quand meme, car un objet construit ailleurs le contournerait sans
  // erreur de type.
  const appels = []
  for (const f of fichiers) {
    if (f === 'lib/ai-budget.ts') continue
    const code = sansCommentaires(read(f))
    let k = code.indexOf('enregistrerDepenseIA(')
    while (k >= 0) {
      const bloc = code.slice(k, k + 700)
      appels.push({ fichier: f, aActeur: /\bacteur:/.test(bloc) })
      k = code.indexOf('enregistrerDepenseIA(', k + 1)
    }
  }
  const muets = appels.filter((a) => !a.aActeur)
  ok(appels.length >= 7,
    `les ${appels.length} enregistrement(s) de depense sont vus par le controle`,
    'moins de sept : un point de depense a disparu ou n’est plus detecte')
  ok(muets.length === 0,
    'aucun enregistrement ne se passe d’acteur',
    muets.map((m) => m.fichier).join(', '))

  // L'ECHAPPATOIRE EST VISIBLE. `non_imputable` est legitime, mais il doit
  // rester RARE et MOTIVE : on compte ses usages pour qu'il ne se repande pas
  // en silence. Aucun aujourd'hui.
  const evasions = fichiers.filter(
    (f) => f !== 'lib/ai-budget.ts' && /type: 'non_imputable'/.test(sansCommentaires(read(f))),
  )
  ok(evasions.length === 0,
    `l’echappatoire non_imputable n’est utilisee nulle part (${evasions.length})`,
    'usage(s) : ' + evasions.join(', ') + ' — legitime, mais il doit etre motive et rester rare')
}

section('G. L’alerte par acteur ALERTE — elle ne bloque rien')

{
  const ROUTE = sansCommentaires(read('app/api/admin/matching-settings/route.ts'))
  const ECRAN = sansCommentaires(read('app/[locale]/admin/matching/page.tsx'))

  ok(/ai_spend_par_acteur/.test(ROUTE),
    'le decoupage par acteur est LU par l’ecran',
    'une comptabilite qu’aucun ecran ne montre ne sert a rien')

  // RIEN N'EST STOCKE : l'alerte se deduit a chaque chargement.
  ok(/en_alerte: seuil !== null/.test(ROUTE),
    'l’alerte est CALCULEE a l’affichage, jamais stockee',
    'un etat « en depassement » ecrit quelque part serait faux la seconde suivante')

  // Le drapeau ne doit exister QUE pour etre affiche. S'il commandait un refus,
  // un `return`, un 4xx ou une degradation, l'alerte serait devenue un blocage.
  const BLOQUE = /en_alerte[^\n]*\)\s*\{?\s*(return|throw)/
  ok(!BLOQUE.test(ROUTE) && !BLOQUE.test(ECRAN),
    'aucun refus, aucun arret ne depend de en_alerte',
    'la decision produit est arbitree : un depassement ALERTE, il ne bloque pas')

  const METIER = fichiers.filter((f) => !f.startsWith('app/api/admin/') && !f.includes('admin/matching'))
  const contamines = METIER.filter((f) => /\ben_alerte\b|ai_spend_seuils_acteur/.test(sansCommentaires(read(f))))
  ok(contamines.length === 0,
    'le seuil par acteur ne sort pas de l’ecran d’administration',
    'lu dans un parcours, il finirait par le conditionner : ' + contamines.join(', '))

  // AUCUNE PRORATION. Une depense n'est jamais divisee entre acteurs : le
  // non-imputable reste non-imputable, il ne se repartit pas.
  const PRORATION = /(depense|cost_usd|depense_mois)\s*[/*]\s*[a-z_]*(acteurs|organisations|profils|count)/i
  const proratises = fichiers.filter((f) => PRORATION.test(sansCommentaires(read(f))))
  ok(proratises.length === 0,
    'aucune depense n’est proratisee entre acteurs',
    'repartir le non-imputable inventerait un chiffre : ' + proratises.join(', '))
}

section('H. La somme peut boucler — les deux fenetres sont identiques')

{
  // La propriete « Σ lignes = depense du mois » ne tient QUE si les deux
  // fonctions decoupent le mois de la MEME facon. Deux expressions differentes
  // decaleraient les totaux de quelques heures en fin de mois, et l'ecran
  // mentirait sans lever la moindre erreur.
  const FENETRE = /created_at >= date_trunc\('month', now\(\) at time zone 'utc'\)/
  const SQL = readdirSync(join(ROOT, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => read('supabase/migrations/' + f))
    .join('\n')

  const debut = SQL.indexOf('function public.ai_spend_par_acteur')
  const corps = debut < 0 ? '' : SQL.slice(debut, SQL.indexOf('$fn$;', debut) + 5)

  ok(FENETRE.test(corps),
    'ai_spend_par_acteur decoupe le mois comme ai_spend_status',
    'deux fenetres differentes et la somme cesse de boucler')

  ok(/constraint ai_spend_un_seul_acteur/.test(SQL),
    'la base refuse deux acteurs sur le meme evenement',
    'sans elle, les sommes par organisation et par profil compteraient deux fois')

  // Les deux lignes agregees doivent EXISTER dans la fonction, sans quoi la
  // somme ne boucle pas : le reste tronque ou le non-imputable disparaitraient.
  ok(/'reste_non_detaille'/.test(corps) && /'non_imputable'/.test(corps),
    'le reste tronque et le non-imputable sont des lignes rendues',
    'sans elles, le tableau affiche moins que la depense reelle')
}

section('I. Les deux reglages d’ARGENT se reglent — et l’ecran dit lequel bloque')

/**
 * LE DEFAUT QU'ON FERME ICI.
 *   /admin/matching AFFICHAIT le plafond et le seuil d'alerte sans permettre
 *   de les changer. C'est ce que §D.7 condamne — un reglage qui ne se regle
 *   pas — au pire endroit possible : de l'argent. Et §E.10 rappelle ce que
 *   coute une valeur posee a la main en base : elle ne survit pas a une
 *   reconstruction, et ne laisse aucune trace exploitable.
 *
 *   MAIS LES DEUX NE FONT PAS LA MEME CHOSE. Le plafond BLOQUE (fail-closed
 *   assume) ; le seuil ALERTE et n'arrete rien. Deux champs voisins qui se
 *   ressemblent sans agir pareil sont un piege — le meme que les durees.
 */
{
  const ROUTE = sansCommentaires(read('app/api/admin/plafonds-ia/route.ts'))
  const ECRAN = sansCommentaires(read('app/[locale]/admin/matching/page.tsx'))
  const LECTURE = sansCommentaires(read('app/api/admin/matching-settings/route.ts'))

  ok(/\.from\('ai_spend_caps'\)\s*\.?\s*\n?\s*\.update\(/.test(ROUTE),
    'le plafond global peut etre ECRIT depuis le back-office',
    'affiche sans pouvoir etre change, c’est un reglage qui ne regle rien (§D.7)')

  ok(/\.from\('ai_spend_seuils_acteur'\)\s*\.?\s*\n?\s*\.update\(/.test(ROUTE),
    'le seuil d’alerte par acteur peut etre ECRIT depuis le back-office')

  // LA GARDE EST AU SERVEUR. Griser un champ ne garde rien : un appel forge passe.
  ok(/function montantValide/.test(ROUTE) && /n >= 0 && n <= 100_000/.test(ROUTE),
    'les montants sont bornes AU SERVEUR',
    'une borne posee seulement dans l’input ne garde rien')

  ok(/unknown_provider/.test(ROUTE) && /unknown_actor/.test(ROUTE),
    'un fournisseur ou un acteur hors catalogue est REFUSE',
    'sans quoi un appel forge creerait une ligne que rien ne lit')

  // TOUT OU RIEN. Un etat a moitie ecrit serait affiche sans qu'on sache
  // lequel des champs a pris.
  const iValide = ROUTE.indexOf('montantValide(valeur)')
  const iEcrit = ROUTE.indexOf(".from('ai_spend_caps')")
  ok(iValide > 0 && iEcrit > iValide,
    'le corps entier est valide AVANT la moindre ecriture',
    'ecrire les bonnes valeurs et refuser les autres laisse un etat a moitie applique')

  // ET LA TRACE, avec DEUX actions distinctes : un plafond qui bloque et un
  // seuil qui alerte ne se relisent pas de la meme facon dans un journal.
  ok(/ai_spend_cap_updated/.test(ROUTE) && /ai_spend_alert_threshold_updated/.test(ROUTE),
    'les deux changements sont traces sous DEUX actions distinctes',
    'les confondre ferait chercher une coupure de service dans un changement de bruit')

  ok(/bloque: true/.test(ROUTE) && /bloque: false/.test(ROUTE),
    'la trace dit lequel des deux BLOQUE',
    'un journal qui ne distingue pas les deux oblige a relire le code pour le savoir')

  // L'ECRAN DOIT LE DIRE AUSSI, et pas dans une aide qu’on deplie.
  ok(/money\.cap_blocks_label/.test(ECRAN) && /money\.alert_warns_label/.test(ECRAN),
    'l’ecran ecrit lequel arrete et lequel previent',
    'deux champs voisins qui n’agissent pas pareil sont un piege (meme famille que les durees)')

  ok(/seuils_acteur:/.test(LECTURE),
    'les seuils sont RENDUS par la lecture, donc editables',
    'sans eux, l’ecran ne pourrait afficher qu’un champ vide')

  // LE SEUIL NE DOIT TOUJOURS RIEN BLOQUER. Le rendre reglable ne change pas
  // la decision produit : un depassement alerte, il ne bloque pas.
  const METIER = fichiers.filter((f) => !f.startsWith('app/api/admin/') && !f.includes('admin/matching'))
  const contamines = METIER.filter((f) => /ai_spend_seuils_acteur/.test(sansCommentaires(read(f))))
  ok(contamines.length === 0,
    'le seuil d’alerte ne sort toujours pas de l’ecran d’administration',
    'lu dans un parcours, il finirait par le conditionner : ' + contamines.join(', '))
}

console.log(echecs === 0 ? '\n✔ TOUT VERT' : `\n✘ ${echecs} CONTROLE(S) EN ECHEC`)
process.exit(echecs === 0 ? 0 : 1)
