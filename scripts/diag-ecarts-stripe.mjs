// scripts/diag-ecarts-stripe.mjs — « ZERO ECART » ET « JE N'AI PAS PU COMPARER »
// NE SE CONFONDENT JAMAIS.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QU'IL DEFEND, ET POURQUOI C'EST UNE PROPRIETE ET NON UN NOM
//
//   Le module d'exploitation Stripe a trois surfaces — l'ecran des ecarts, la
//   verification nocturne, la sante du raccordement — et elles lisent la MEME
//   source. C'est la forme exacte de §E.36 : deux gardes qui tombent sur la
//   meme panne n'en font qu'une, et l'une des deux est rassurante a tort.
//
//   La parade choisie est un TYPE, pas une vigilance : `EtatEcarts` n'expose
//   `ecarts` QUE dans sa branche 'compare'. Ce controle ne relit pas ce type —
//   IL L'EXECUTE. C'est possible parce que les trois modules purs n'importent
//   que des TYPES (`import type`), effaces par le depouillement de types de
//   Node : ils se chargent donc en Node nu, sans chargeur d'alias, sans build,
//   depuis n'importe quel worktree (§E.3).
//
//   Consequence : renommer une constante interne ne fait pas rougir ce
//   controle, et deplacer la regle dans un autre fichier ne le fait pas verdir
//   — il ne connait que le COMPORTEMENT (§E.34).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE BANC S'EPROUVE AVANT DE SE CROIRE (§E.33)
//
//   Un controle qui ne sait produire QUE des verts ne prouve rien. La section A
//   fabrique donc d'abord un ecart de CHAQUE nature et verifie qu'il sort : si
//   le banc ne sait pas crier, son silence ne vaut rien.
//
//   node scripts/diag-ecarts-stripe.mjs
//   Aucune base, aucun reseau, aucune variable d'environnement.
//   0 = vert · 1 = rouge.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// §E.3 : le depot sort en CRLF, et tout motif qui traverse un saut de ligne
// serait vert chez son auteur et rouge partout ailleurs.
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

/** §E.7 : un anti-motif doit pouvoir etre DOCUMENTE. On lit le code, pas la prose. */
const sansCommentaires = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')

/** Depouille le SQL de ses commentaires `--`, hors chaines. */
const sansCommentairesSql = (src) =>
  src
    .split('\n')
    .map((l) => {
      let dansChaine = false
      for (let i = 0; i < l.length; i++) {
        if (l[i] === "'") dansChaine = !dansChaine
        if (!dansChaine && l[i] === '-' && l[i + 1] === '-') return l.slice(0, i)
      }
      return l
    })
    .join('\n')

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else {
    echecs++
    console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`)
  }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const note = (s) => console.log(`  note ${s}`)

const { comparerDroits, estAttributionManuelle, abonnementGouvernant, STATUTS_OUVRANTS } =
  await import('../lib/stripe-exploitation/ecarts.ts')
const { etatJournal, estCoince, MINUTES_AVANT_COINCE, MAX_DURATION_WEBHOOK_SECONDES } =
  await import('../lib/stripe-exploitation/journal.ts')
const { classerRaccordement, TYPES_TRAITES, JOURS_DE_SILENCE_TOLERES } =
  await import('../lib/stripe-exploitation/raccordement.ts')

const MAINTENANT = new Date('2026-09-20T12:00:00.000Z')
const PLUS_TARD = '2026-12-01T00:00:00.000Z'

const CATALOGUE = new Map([
  ['price_business', { packageId: 'pkg-business', slug: 'business' }],
  ['price_elite', { packageId: 'pkg-elite', slug: 'elite' }],
])

/** Une organisation locale, par defaut coherente avec un abonnement actif. */
const org = (patch = {}) => ({
  organizationId: 'org-1',
  organizationName: 'Acme',
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
  packageId: 'pkg-business',
  packageSlug: 'business',
  packageValidUntil: PLUS_TARD,
  packageSourceEventAt: '2026-09-01T00:00:00.000Z',
  ...patch,
})

const abo = (patch = {}) => ({
  id: 'sub_1',
  customerId: 'cus_1',
  statut: 'active',
  priceId: 'price_business',
  finDePeriode: PLUS_TARD,
  ...patch,
})

/** Lance la comparaison sur une lecture REUSSIE. */
const comparer = (locaux, abonnements) =>
  comparerDroits({
    locaux,
    abonnements: { etat: 'disponible', valeur: abonnements },
    catalogue: CATALOGUE,
    maintenant: MAINTENANT,
  })

const natures = (r) => (r.etat === 'compare' ? r.ecarts.map((e) => e.nature).sort() : ['(impossible)'])

// ══════════════════════════════════════════════════════════════════════════
section('A. LE BANC SAIT CRIER — les huit natures sont atteignables')
// Un balayage qui rend zero se prouve avant de se croire (§E.33). Si aucun de
// ces huit montages ne produisait son ecart, tous les verts de la section B
// seraient des verts d'aveugle.
// ══════════════════════════════════════════════════════════════════════════

const CAS = [
  [
    'paie_sans_acces',
    () => comparer([org({ packageId: null, packageSlug: null, packageValidUntil: null })], [abo()]),
  ],
  ['acces_sans_paiement', () => comparer([org()], [abo({ statut: 'canceled' })])],
  ['offre_differente', () => comparer([org()], [abo({ priceId: 'price_elite' })])],
  // ⚠️ MONTAGE A LIRE DEUX FOIS, ET LE BANC M'A REPRIS DESSUS. La premiere
  //    version posait une validite locale DEJA PASSEE : les droits etaient
  //    alors fermes, et c'est `paie_sans_acces` qui sortait — un ecart juste,
  //    mais pas celui qu'on croyait eprouver. « Etre en retard » suppose que
  //    les droits sont OUVERTS, et qu'ils le sont moins longtemps que ce qui a
  //    ete encaisse. C'est exactement pourquoi un banc s'eprouve (§E.33) : sans
  //    la section A, cette assertion aurait ete verte pour une autre raison.
  [
    'validite_en_retard',
    () => comparer([org({ packageValidUntil: '2026-10-01T00:00:00.000Z' })], [abo()]),
  ],
  [
    'client_sans_organisation',
    () => comparer([], [abo({ id: 'sub_9', customerId: 'cus_orphelin' })]),
  ],
  ['prix_hors_catalogue', () => comparer([org()], [abo({ priceId: 'price_inconnu' })])],
  ['statut_inconnu', () => comparer([org()], [abo({ statut: 'quelque_chose_de_neuf' })])],
  [
    'plusieurs_abonnements',
    () => comparer([org()], [abo(), abo({ id: 'sub_2', statut: 'canceled' })]),
  ],
]

for (const [nature, monter] of CAS) {
  const r = monter()
  ok(
    r.etat === 'compare' && r.ecarts.some((e) => e.nature === nature),
    `le banc sait produire « ${nature} »`,
    `obtenu : ${natures(r).join(', ') || '(aucun)'}`,
  )
}

// Chaque nature porte une gravite, et aucune ne sort sans.
{
  const toutes = CAS.flatMap(([, monter]) => {
    const r = monter()
    return r.etat === 'compare' ? r.ecarts : []
  })
  ok(
    toutes.every((e) => e.gravite === 'bloquant' || e.gravite === 'attention'),
    'chaque ecart porte une gravite nommee',
  )
  ok(
    toutes.some((e) => e.gravite === 'bloquant'),
    'le rouge est reserve a ce qui ne se fait pas — au moins une nature est bloquante',
  )
}

// ══════════════════════════════════════════════════════════════════════════
section('B. « 0 ECART » ET « JE N\'AI PAS PU COMPARER » SONT DEUX ETATS (§E.36)')
// ══════════════════════════════════════════════════════════════════════════

const sain = comparer([org()], [abo()])
ok(sain.etat === 'compare' && sain.ecarts.length === 0, 'un etat coherent ne produit AUCUN ecart')

for (const motif of [
  'billing_disabled',
  'billing_key_missing',
  'billing_key_env_mismatch',
  'stripe_injoignable',
  'stripe_permission',
  'lecture_locale',
]) {
  const panne = comparerDroits({
    locaux: [org()],
    abonnements: { etat: 'indisponible', motif, detail: 'banc' },
    catalogue: CATALOGUE,
    maintenant: MAINTENANT,
  })
  ok(panne.etat === 'impossible', `une lecture en panne (${motif}) rend 'impossible', jamais 'compare'`)
  ok(panne.motif === motif, `le motif ${motif} est TRANSPORTE, pas retraduit en « erreur »`)
  // ⚠️ L'ASSERTION QUI PORTE TOUT LE MODULE. `ecarts` doit etre ABSENT, et non
  //    pas present et vide : un tableau vide est exactement ce que l'ecran
  //    lirait comme « aucun ecart ».
  ok(
    !('ecarts' in panne),
    `sur ${motif}, la propriete 'ecarts' N'EXISTE PAS (un tableau vide se lirait « aucun ecart »)`,
    `obtenu : ${JSON.stringify(panne)}`,
  )
}

// Et les deux resultats doivent etre DISTINGUABLES par un appelant qui ne
// regarde que ce qui l'interesse.
{
  const panne = comparerDroits({
    locaux: [org()],
    abonnements: { etat: 'indisponible', motif: 'stripe_injoignable', detail: 'banc' },
    catalogue: CATALOGUE,
    maintenant: MAINTENANT,
  })
  ok(sain.etat !== panne.etat, 'les deux situations ne rendent pas le meme etat')
  ok(
    (sain.ecarts?.length ?? null) !== (panne.ecarts?.length ?? null),
    'aucun appelant ne peut lire le meme compte dans les deux cas',
  )
}

// ══════════════════════════════════════════════════════════════════════════
section('C. L\'ATTRIBUTION MANUELLE NE CRIE PAS — le faux positif de masse')
// Mesure le 20/09/2026 sur la base de recette : 4 organisations, UNE avec une
// offre, AUCUNE avec un identifiant Stripe. Sans cette exclusion, l'ecran
// annoncait « acces sans paiement » sur un compte pilote des sa premiere nuit.
// ══════════════════════════════════════════════════════════════════════════

const pilote = org({
  organizationId: 'org-pilote',
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  packageSourceEventAt: null,
})
ok(estAttributionManuelle(pilote), 'une offre posee a la main est reconnue comme telle')
{
  const r = comparer([pilote], [])
  ok(r.etat === 'compare' && r.ecarts.length === 0, 'elle ne produit AUCUN ecart')
  ok(r.attributionsManuelles === 1, 'elle est COMPTEE a part, pas passee sous silence')
  ok(r.organisationsComparees === 0, 'elle ne gonfle pas le nombre d\'organisations comparees')
}

// ⚠️ ET L'EXCLUSION NE DOIT PAS SERVIR DE PORTE DEROBEE. Une organisation qui a
//    DEJA ete touchee par Stripe n'est plus « manuelle », meme sans identifiant.
for (const [label, patch] of [
  ['elle porte un customer Stripe', { stripeCustomerId: 'cus_1' }],
  ['elle porte un abonnement Stripe', { stripeSubscriptionId: 'sub_1' }],
  ['un evenement Stripe l\'a deja ecrite', { packageSourceEventAt: '2026-09-01T00:00:00.000Z' }],
]) {
  ok(
    !estAttributionManuelle({ ...pilote, ...patch }),
    `l'exclusion tombe des que ${label}`,
  )
}
{
  // Le cas reel qu'elle ne doit PAS masquer : Stripe l'a connue, puis plus rien.
  const r = comparer([org({ packageSourceEventAt: '2026-09-01T00:00:00.000Z' })], [])
  ok(
    r.etat === 'compare' && r.ecarts.some((e) => e.nature === 'acces_sans_paiement'),
    'une organisation touchee par Stripe puis disparue de Stripe est bien signalee',
  )
}

// ══════════════════════════════════════════════════════════════════════════
section('D. LE RAPPROCHEMENT — sur le CLIENT, avec le repli documente')
// ══════════════════════════════════════════════════════════════════════════

{
  // L'identifiant d'abonnement a change chez Stripe (re-souscription) : le
  // rapprochement par client tient, celui par abonnement aurait crie.
  const r = comparer([org({ stripeSubscriptionId: 'sub_ancien' })], [abo({ id: 'sub_nouveau' })])
  ok(
    r.etat === 'compare' && !r.ecarts.some((e) => e.nature === 'acces_sans_paiement'),
    'un abonnement RECREE chez Stripe ne produit pas de faux « acces sans paiement »',
    `obtenu : ${natures(r).join(', ')}`,
  )
}
{
  // Le desordre de livraison : l'abonnement est arrive avant le rattachement du
  // customer. C'est le fonctionnement NORMAL, et le repli doit le couvrir.
  const r = comparer([org({ stripeCustomerId: null })], [abo()])
  ok(
    r.etat === 'compare' && r.ecarts.length === 0,
    'une organisation sans customer mais avec abonnement se rapproche par son abonnement',
    `obtenu : ${natures(r).join(', ')}`,
  )
}
{
  // Plusieurs abonnements : on CLASSE, on ne prend pas le premier venu. L'ordre
  // de la liste ne doit rien changer au verdict.
  const a = abo({ id: 'sub_a', statut: 'canceled' })
  const b = abo({ id: 'sub_b', statut: 'active' })
  ok(
    abonnementGouvernant([a, b]).id === 'sub_b' && abonnementGouvernant([b, a]).id === 'sub_b',
    'l\'abonnement gouvernant ne depend pas de l\'ordre de pagination de Stripe',
  )
  ok(
    abonnementGouvernant([]) === null,
    'aucun abonnement rend null — et non un objet vide qu\'on lirait comme actif',
  )
}
{
  // La validite ne se compare que dans UN sens : prolonger est normal
  // (periode de grace), etre en retard ne l'est pas.
  const grace = comparer([org({ packageValidUntil: '2027-06-01T00:00:00.000Z' })], [abo()])
  ok(
    grace.etat === 'compare' && !grace.ecarts.some((e) => e.nature === 'validite_en_retard'),
    'une validite locale PLUS LOINTAINE (periode de grace) ne produit aucun ecart',
    `obtenu : ${natures(grace).join(', ')}`,
  )
}

// ══════════════════════════════════════════════════════════════════════════
section('E. LES DEUX JUMEAUX ASSUMES NE PEUVENT PAS DIVERGER (§E.20)')
// `lib/billing/events.ts` appartient a un autre chantier et n'exporte ni sa
// liste de statuts ouvrants, ni sa liste de types traites. On les recopie — et
// on lit les DEUX dans le source pour qu'une divergence rougisse ici.
// ══════════════════════════════════════════════════════════════════════════

const events = sansCommentaires(lire('lib/billing/events.ts'))

{
  const m = events.match(/STATUTS_OUVRANTS\s*=\s*new Set\(\[([^\]]*)\]/)
  ok(Boolean(m), 'la liste des statuts ouvrants est lisible dans lib/billing/events.ts')
  if (m) {
    const chezLui = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
    const chezNous = [...STATUTS_OUVRANTS].sort()
    ok(
      JSON.stringify(chezLui) === JSON.stringify(chezNous),
      'les statuts ouvrants sont IDENTIQUES des deux cotes',
      `events.ts : ${chezLui.join(', ')}\n       ecarts.ts : ${chezNous.join(', ')}`,
    )
  }
}

{
  // Les types traites : on lit les `case` du switch d'aiguillage, hors `default`.
  const bloc = events.slice(events.indexOf('switch (event.type)'))
  const chezLui = [...bloc.matchAll(/case\s+'([a-z_.]+)'/g)].map((x) => x[1]).sort()
  ok(chezLui.length > 0, 'les types traites sont lisibles dans le switch d\'aiguillage')
  const chezNous = [...TYPES_TRAITES].sort()
  ok(
    JSON.stringify(chezLui) === JSON.stringify(chezNous),
    `les ${chezNous.length} types traites sont IDENTIQUES des deux cotes`,
    `events.ts : ${chezLui.join(', ')}\n       raccordement.ts : ${chezNous.join(', ')}`,
  )
}

// ══════════════════════════════════════════════════════════════════════════
section('F. LE JOURNAL — un « received » coince est un INCIDENT, pas un etat')
// ══════════════════════════════════════════════════════════════════════════

const ligne = (patch = {}) => ({
  id: 'evt_1',
  type: 'invoice.paid',
  statut: 'received',
  livemode: false,
  tentatives: 1,
  erreur: null,
  organizationId: null,
  recuLe: MAINTENANT.toISOString(),
  cloturLe: null,
  ...patch,
})

const ilYA = (minutes) => new Date(MAINTENANT.getTime() - minutes * 60_000).toISOString()

ok(
  MINUTES_AVANT_COINCE === Math.round((MAX_DURATION_WEBHOOK_SECONDES * 30) / 60),
  'le delai se DEDUIT du plafond de duree du webhook, il ne se choisit pas',
)
ok(!estCoince(ligne({ recuLe: ilYA(1) }), MAINTENANT), 'un evenement recu il y a une minute est EN COURS')
ok(
  estCoince(ligne({ recuLe: ilYA(MINUTES_AVANT_COINCE + 1) }), MAINTENANT),
  'au-dela du delai deduit, il est COINCE',
)
for (const statut of ['processed', 'ignored', 'failed']) {
  ok(
    !estCoince(ligne({ statut, recuLe: ilYA(10_000) }), MAINTENANT),
    `un evenement '${statut}', meme ancien, n'est pas coince (il est CLOTURE)`,
  )
}

{
  const j = etatJournal({ etat: 'indisponible' }, MAINTENANT)
  ok(j.etat === 'indisponible', 'une lecture de journal en panne rend \'indisponible\'')
  ok(
    !('lignes' in j) && !('resume' in j),
    'et n\'expose NI lignes NI resume — « 0 evenement » y serait rassurant a tort',
  )
}
{
  const j = etatJournal({ etat: 'disponible', lignes: [] }, MAINTENANT)
  ok(j.etat === 'disponible' && j.resume.total === 0, 'un journal LU et vide rend un resume a zero')
}
{
  // LE POINT QUI FERME §E.36 DANS LE JOURNAL : le compteur du bandeau et le
  // verdict de chaque ligne viennent du MEME calcul. Un bandeau qui annonce
  // trois coinces que le tableau ne designe pas serait pire qu'aucun bandeau.
  const lignes = [
    ligne({ id: 'evt_a', recuLe: ilYA(MINUTES_AVANT_COINCE + 5) }),
    ligne({ id: 'evt_b', recuLe: ilYA(1) }),
    ligne({ id: 'evt_c', statut: 'processed', recuLe: ilYA(999) }),
  ]
  const j = etatJournal({ etat: 'disponible', lignes }, MAINTENANT)
  ok(j.resume.coinces === 1, 'le compteur de coinces vaut 1')
  ok(
    j.lignes.filter((l) => l.coince).length === j.resume.coinces,
    'le compteur du bandeau et les lignes MARQUEES disent le meme nombre',
  )
  ok(
    j.lignes.find((l) => l.id === 'evt_a').coince === true &&
      j.lignes.find((l) => l.id === 'evt_b').coince === false,
    'le verdict voyage AVEC la ligne — l\'ecran affiche, il ne recalcule pas (§E.15)',
  )
}

// ══════════════════════════════════════════════════════════════════════════
section('G. LE RACCORDEMENT — le croisement qui nomme la panne')
// ══════════════════════════════════════════════════════════════════════════

const sources = (patch = {}) => ({
  secretPresent: true,
  production: false,
  endpoints: {
    etat: 'disponible',
    valeur: [
      {
        id: 'we_1',
        url: 'https://skilloria.io/api/stripe/webhook',
        statut: 'enabled',
        typesSouscrits: [...TYPES_TRAITES],
        livemode: false,
      },
    ],
  },
  origineDuSite: 'https://skilloria.io',
  dernierRecuLe: MAINTENANT.toISOString(),
  dernierLivemode: false,
  abonnementsOuvrants: 1,
  ...patch,
})

const alertes = (s) => classerRaccordement(s, MAINTENANT).map((a) => a.nature).sort()

ok(alertes(sources()).length === 0, 'un raccordement sain ne produit AUCUNE alerte')

// LE CAS SOURCE DU LOT : actif chez Stripe, muet chez nous.
ok(
  alertes(sources({ dernierRecuLe: null, dernierLivemode: null })).includes('actif_mais_muet'),
  'point de reception ACTIF + journal JAMAIS servi ⇒ la panne est nommee',
)
// ⚠️ ET ELLE NE SE DECLENCHE PAS SANS LE CROISEMENT : un endpoint qu'on n'a pas
//    pu lire ne permet PAS d'affirmer qu'il etait actif.
ok(
  !alertes(
    sources({
      dernierRecuLe: null,
      dernierLivemode: null,
      endpoints: { etat: 'indisponible', motif: 'stripe_injoignable', detail: 'banc' },
    }),
  ).includes('actif_mais_muet'),
  'sans avoir LU l\'endpoint, on n\'affirme pas qu\'il est actif',
)
ok(
  alertes(
    sources({ endpoints: { etat: 'indisponible', motif: 'stripe_injoignable', detail: 'banc' } }),
  ).includes('endpoints_illisibles'),
  'une lecture d\'endpoints en panne se DIT — ce n\'est pas « aucun endpoint »',
)
ok(
  !alertes(
    sources({ endpoints: { etat: 'indisponible', motif: 'stripe_injoignable', detail: 'banc' } }),
  ).includes('aucun_endpoint'),
  'et elle ne se deguise PAS en « aucun endpoint », qui appellerait l\'action inverse',
)

ok(alertes(sources({ secretPresent: false })).includes('secret_absent'), 'secret absent : nomme')
ok(
  alertes(sources({ dernierLivemode: true })).includes('mode_croise'),
  'un evenement du mauvais mode signale des endpoints croises',
)
ok(
  alertes(sources({ endpoints: { etat: 'disponible', valeur: [] } })).includes('aucun_endpoint'),
  'aucun endpoint vers ce site : nomme',
)
{
  const partiel = sources()
  partiel.endpoints.valeur[0].typesSouscrits = ['invoice.paid']
  ok(alertes(partiel).includes('types_manquants'), 'un endpoint incomplet est signale')
}
{
  const tous = sources()
  tous.endpoints.valeur[0].typesSouscrits = ['*']
  ok(
    !alertes(tous).includes('types_manquants'),
    '`*` vaut TOUS les types — un endpoint parfaitement regle ne rougit pas',
  )
}

// LE SILENCE SEUL NE CRIE PAS, et c'est ce qui rend l'alerte lisible le jour ou
// elle sort : un produit sans abonne ne recoit rien, et c'est NORMAL.
const vieux = new Date(MAINTENANT.getTime() - (JOURS_DE_SILENCE_TOLERES + 2) * 86_400_000).toISOString()
ok(
  !alertes(sources({ dernierRecuLe: vieux, abonnementsOuvrants: 0 })).includes('silence_prolonge'),
  'aucun abonnement vivant : le silence est NORMAL, aucune alerte',
)
ok(
  alertes(sources({ dernierRecuLe: vieux, abonnementsOuvrants: 3 })).includes('silence_prolonge'),
  'des abonnements vivants et un journal muet : LA, c\'est une alerte',
)
ok(
  !alertes(sources({ dernierRecuLe: vieux, abonnementsOuvrants: null })).includes('silence_prolonge'),
  'ne PAS avoir pu compter les abonnements n\'invente aucune alerte (et n\'en eteint aucune : endpoints_illisibles le dit)',
)

// ══════════════════════════════════════════════════════════════════════════
section('H. LES SURFACES — ancrees sur la PROPRIETE, pas sur un chemin (§E.34)')
// On balaie un PERIMETRE et on demande « ceci existe-t-il QUELQUE PART ? ».
// Un fichier renomme ou deplace ne doit ni faire rougir, ni faire verdir.
// ══════════════════════════════════════════════════════════════════════════

/** Tous les fichiers sources sous les dossiers donnes. */
function balayer(dossiers, extensions) {
  const out = []
  const descendre = (rel) => {
    let entrees
    try {
      entrees = readdirSync(join(ROOT, rel))
    } catch {
      return
    }
    for (const e of entrees) {
      if (e === 'node_modules' || e === '.next') continue
      const chemin = `${rel}/${e}`
      if (statSync(join(ROOT, chemin)).isDirectory()) descendre(chemin)
      else if (extensions.some((x) => e.endsWith(x))) out.push(chemin)
    }
  }
  for (const d of dossiers) descendre(d)
  return out
}

// ⚠️ `components/` EN FAIT PARTIE : §E.15 a montre qu'un composant client peut
//    parfaitement porter une regle serveur.
const SOURCES = balayer(['app', 'lib', 'components'], ['.ts', '.tsx'])
note(`${SOURCES.length} fichier(s) balayes (app + lib + components).`)

const AVEC = (motif) => SOURCES.filter((f) => motif.test(sansCommentaires(lire(f))))

{
  const consommateurs = AVEC(/comparerDroits\s*\(/)
  ok(
    consommateurs.length >= 1,
    'la comparaison est consommee quelque part sous app/ ou lib/',
    consommateurs.join(', '),
  )
  // LECTURE SEULE : aucun fichier qui compare des droits ne doit ecrire des
  // droits. Corriger un ecart qu'on ne comprend pas encore est le pire remede.
  const ecrivains = consommateurs.filter((f) =>
    /\.from\(\s*['"]organizations['"]\s*\)[\s\S]{0,200}?\.(update|upsert|insert|delete)\s*\(/.test(
      sansCommentaires(lire(f)),
    ),
  )
  ok(ecrivains.length === 0, 'AUCUN consommateur de la comparaison n\'ecrit sur organizations', ecrivains.join(', '))
}

{
  // La surface d'exploitation n'expose aucun verbe d'ecriture. On cherche la
  // PROPRIETE (« un export POST/PATCH/PUT/DELETE dans un fichier qui compare »)
  // et non un chemin, qui vieillirait au premier renommage.
  const routes = SOURCES.filter(
    (f) => f.includes('/facturation/') && f.endsWith('route.ts'),
  )
  ok(routes.length >= 1, 'la route d\'exploitation existe', routes.join(', '))
  const avecEcriture = routes.filter((f) =>
    /export\s+async\s+function\s+(POST|PATCH|PUT|DELETE)\b/.test(sansCommentaires(lire(f))),
  )
  ok(
    avecEcriture.length === 0,
    'elle n\'exporte AUCUN verbe d\'ecriture — l\'ecran constate, il ne corrige pas',
    avecEcriture.join(', '),
  )
}

{
  // La verification nocturne SIGNALE et ne RETRAITE pas : elle ne doit appeler
  // aucun traitement d'evenement.
  const cron = SOURCES.filter((f) => f.includes('/cron/') && /stripe/i.test(f))
  ok(cron.length === 1, 'la verification nocturne existe, en un seul exemplaire', cron.join(', '))
  for (const f of cron) {
    const src = sansCommentaires(lire(f))
    ok(
      !/handleStripeEvent|applyPackageState|extendValidity|attachCustomer/.test(src),
      'elle n\'appelle AUCUN traitement d\'evenement — elle signale, elle ne retraite pas',
    )
    ok(
      !/\.from\(\s*['"]stripe_events['"]\s*\)[\s\S]{0,200}?\.(update|upsert|insert|delete)\s*\(/.test(src),
      'elle n\'ecrit pas dans le journal des evenements',
    )
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('I. LA GARDE EN BASE — une contrainte, pas une discipline (§E.31)')
// ══════════════════════════════════════════════════════════════════════════

{
  const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))
  const porteuses = migrations.filter((f) =>
    /create\s+table\s+if\s+not\s+exists\s+public\.stripe_reconciliation_runs/i.test(
      sansCommentairesSql(lire(`supabase/migrations/${f}`)),
    ),
  )
  ok(porteuses.length === 1, 'une seule migration cree la table des verifications', porteuses.join(', '))

  if (porteuses.length === 1) {
    const sql = sansCommentairesSql(lire(`supabase/migrations/${porteuses[0]}`))
    // §E.8 : on ancre l'assertion sur LE BLOC qu'elle vise, pas une regex lachee
    // sur tout le fichier — le voisin porterait les memes mots.
    const bloc = sql.slice(
      sql.search(/create\s+table\s+if\s+not\s+exists\s+public\.stripe_reconciliation_runs/i),
    )
    const corps = bloc.slice(0, bloc.indexOf('\n);') + 3)

    ok(
      /check\s*\(\s*etat\s+in\s*\(\s*'compare'\s*,\s*'impossible'\s*\)\s*\)/i.test(corps),
      'l\'etat est borne a deux valeurs en BASE',
    )
    // LA CONTRAINTE QUI PORTE LE LOT : sur 'impossible', les compteurs sont NULL.
    ok(
      /etat\s*=\s*'impossible'[\s\S]{0,400}?manquants\s+is\s+null/i.test(corps),
      'sur un etat \'impossible\', `manquants` est NULL — « 0 ecart » y est INTERDIT par la base',
    )
    ok(
      /etat\s*=\s*'compare'[\s\S]{0,400}?manquants\s+is\s+not\s+null/i.test(corps),
      'sur un etat \'compare\', les compteurs sont obligatoires',
    )
    ok(
      /etat\s*=\s*'impossible'\s+and\s+motif_impossible\s+is\s+not\s+null/i.test(corps),
      'un etat \'impossible\' SANS motif est refuse — « ca a rate » sans dire quoi n\'est pas actionnable',
    )
    // LA TACHE EST AU CATALOGUE. Une tache qui n'y figure pas est une tache que
    // personne ne surveille — le catalogue en a deja oublie trois.
    //
    // ⚠️ DEUX DEFAUTS DE CE CONTROLE, TROUVES PAR MUTATION, ET ILS SONT LA MEME
    //    FAMILLE — un motif qu'on ne borne pas lit autre chose que ce qu'il vise.
    //    ① `public\.cron_job_catalog` sans borne de fin matchait encore
    //       `public.cron_job_catalog_DESACTIVE` : la mutation SURVIVAIT. Il faut
    //       une anticipation negative sur les caracteres de mot — `\b` ne sert a
    //       rien ici, `_` EST un caractere de mot (meme piege que §G.3).
    //    ② `[\s\S]{0,600}?` pouvait traverser le `;` et lire l'instruction
    //       VOISINE. On coupe donc l'instruction a son `;` et on cherche DEDANS.
    const debutInsert = sql.search(/insert\s+into\s+public\.cron_job_catalog(?![A-Za-z0-9_])/i)
    const instruction =
      debutInsert < 0 ? '' : sql.slice(debutInsert, sql.indexOf(';', debutInsert) + 1)
    ok(debutInsert >= 0, 'la migration insere bien dans public.cron_job_catalog (et non dans une table voisine)')
    ok(
      /'stripe_reconcile_trigger'/.test(instruction),
      'la tache entre au catalogue des taches planifiees, NOMMEE',
      'cherchee DANS l\'instruction d\'insertion, pas dans le fichier entier',
    )
    ok(
      /select\s+cron\.schedule\(\s*\n?\s*'stripe_reconcile_trigger'/i.test(sql),
      'et elle est effectivement planifiee',
    )
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('J. CE QUE CE CONTROLE NE VERIFIE PAS')
// ══════════════════════════════════════════════════════════════════════════

note('il n\'appelle PAS Stripe : il éprouve la REGLE de comparaison, pas le reseau.')
note('il ne lit AUCUNE base : les contraintes de la section I sont lues dans la')
note('migration, pas verifiees sur un serveur. Seul un rejeu reel les couvre (§E.12).')
note('il ne dit pas si les TEXTES affiches sont justes — diag-cles-i18n garde leur')
note('existence dans les quatre langues, aucune machine ne garde leur sens.')
note('il ne decouvre pas les autres couples ecran/barriere du depot : il garde')
note('CELUI-CI. La regle de §E.36 est generale, sa recherche reste une lecture.')

console.log(
  `\n──────────────────────────────────────────────────────────────────────────────`,
)
if (echecs === 0) {
  console.log('✅ « 0 ecart » et « je n\'ai pas pu comparer » ne se confondent jamais.')
  process.exit(0)
}
console.log(`❌ ${echecs} controle(s) en echec.`)
process.exit(1)
