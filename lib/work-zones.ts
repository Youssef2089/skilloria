// lib/work-zones.ts
//
// ZONES DE TRAVAIL — arbre, aplatissement, libellés. Source UNIQUE côté code.
//
// « Zones de travail » remplace « Localisation » des deux côtés du marché. Ce
// n'est ni le domicile de l'expert, ni le siège de l'organisation : c'est là où
// l'expert ACCEPTE de travailler, et là où l'annonce a besoin de quelqu'un.
//
// LA PROPRIÉTÉ À TENIR, et elle n'est pas évidente :
//   une annonce « Europe » doit recouper un expert « France », ET un expert
//   « Europe » doit recouper une annonce « France ». Comparer des identifiants
//   de zone ne le permet pas — les deux ensembles ne se recoupent pas au même
//   niveau de la hiérarchie.
//
//   La solution est l'APLATISSEMENT VERS LES FEUILLES : chaque côté stocke, en
//   plus de ce qu'il a déclaré, l'ensemble des CODES PAYS que sa déclaration
//   recouvre. Le recoupement redevient un simple `&&` entre deux ensembles de
//   pays, symétrique par construction.
//
// ⚠️ `expandToCountryCodes` ci-dessous est le MIROIR EXACT de la fonction SQL
//    `public.work_zone_country_codes(uuid[])` (migration referentiel_zones_de_
//    travail). Les deux DOIVENT rendre le même résultat : la base écrit la
//    colonne dérivée, l'écran affiche ce qu'elle couvre, et un écart ferait
//    afficher autre chose que ce qui filtre. Le diagnostic du lot compare les
//    deux implémentations sur la vraie donnée de la migration.

export type WorkZoneKind = 'world' | 'continent' | 'country'

/** Une zone telle que l'API taxonomie la rend : `name` est DÉJÀ traduit. */
export type WorkZone = {
  id: string
  parent_id: string | null
  kind: WorkZoneKind
  /** Code stable et lisible : 'WORLD', 'EU', 'C_FR'. Jamais un uuid en dur. */
  code: string
  /** Renseigné pour les seules feuilles (kind = 'country'). */
  country_code: string | null
  name: string
  slug: string
}

export type WorkZoneNode = {
  zone: WorkZone
  children: WorkZoneNode[]
}

/**
 * Construit l'arbre monde > continents > pays à partir de la liste plate.
 *
 * Les zones orphelines (parent absent de la liste) sont remontées à la racine
 * plutôt qu'ignorées : une zone qu'on n'affiche pas est une zone que personne
 * ne peut choisir, et personne ne saurait pourquoi.
 */
export function buildWorkZoneTree(zones: WorkZone[]): WorkZoneNode[] {
  const parId = new Map<string, WorkZoneNode>()
  for (const zone of zones) parId.set(zone.id, { zone, children: [] })

  const racines: WorkZoneNode[] = []
  for (const node of parId.values()) {
    const parent = node.zone.parent_id ? parId.get(node.zone.parent_id) : undefined
    if (parent) parent.children.push(node)
    else racines.push(node)
  }
  return racines
}

/**
 * MIROIR de public.work_zone_country_codes(uuid[]).
 *
 * Rend l'ensemble des codes pays couverts par des zones déclarées, à n'importe
 * quel niveau. Trié, dédoublonné — comme le `array_agg(distinct … order by …)`
 * de la fonction SQL, pour que les deux soient comparables terme à terme.
 */
export function expandToCountryCodes(zones: WorkZone[], selectedIds: readonly string[]): string[] {
  const parId = new Map(zones.map((z) => [z.id, z]))
  const enfantsDe = new Map<string, string[]>()
  for (const z of zones) {
    if (!z.parent_id) continue
    const liste = enfantsDe.get(z.parent_id)
    if (liste) liste.push(z.id)
    else enfantsDe.set(z.parent_id, [z.id])
  }

  const vus = new Set<string>()
  const pays = new Set<string>()
  const pile = selectedIds.filter((id) => parId.has(id))

  while (pile.length > 0) {
    const id = pile.pop() as string
    if (vus.has(id)) continue
    vus.add(id)
    const zone = parId.get(id)
    if (zone?.country_code) pays.add(zone.country_code)
    for (const enfant of enfantsDe.get(id) ?? []) pile.push(enfant)
  }

  return Array.from(pays).sort()
}

/**
 * Retire d'une sélection ce qui est DÉJÀ couvert par une zone plus large.
 *
 * Cocher « Europe » puis « France » ne veut rien dire de plus que « Europe » :
 * garder les deux afficherait une sélection qui ment sur sa propre précision,
 * et l'utilisateur croirait avoir restreint quelque chose. On ne retire jamais
 * la zone LARGE — c'est le choix explicite de l'utilisateur.
 */
export function dedupeCoveredZones(zones: WorkZone[], selectedIds: readonly string[]): string[] {
  const parId = new Map(zones.map((z) => [z.id, z]))
  const ancetres = (id: string): string[] => {
    const chaine: string[] = []
    let courant = parId.get(id)?.parent_id ?? null
    while (courant) {
      chaine.push(courant)
      courant = parId.get(courant)?.parent_id ?? null
    }
    return chaine
  }
  const retenus = selectedIds.filter((id) => parId.has(id))
  const ensemble = new Set(retenus)
  return retenus.filter((id) => !ancetres(id).some((a) => ensemble.has(a)))
}

/**
 * Nombre de pays qu'une zone couvre — sert à dire « Europe · 46 pays » plutôt
 * qu'un libellé nu qui laisse l'utilisateur deviner l'étendue de son choix.
 */
export function countryCountOf(zones: WorkZone[], zoneId: string): number {
  return expandToCountryCodes(zones, [zoneId]).length
}

/** Les continents, dans l'ordre du référentiel : la saisie rapide en un clic. */
export function continentsOf(zones: WorkZone[]): WorkZone[] {
  return zones.filter((z) => z.kind === 'continent')
}

export function worldZoneOf(zones: WorkZone[]): WorkZone | null {
  return zones.find((z) => z.kind === 'world') ?? null
}

// ─── LA SAISIE — deux questions, jamais un piège (recette du 01/10/2026, point 2) ──────────
//
// LE DÉFAUT : « Monde entier » était un bouton parmi les continents. Coché, il absorbait tout
// (`dedupeCoveredZones` garde la zone la plus large) : un clic sur « Europe » l'ajoutait PUIS le
// retirait aussitôt, couvert par le monde. Rien ne bougeait à l'écran ; il fallait d'abord
// décocher le monde, puis recliquer — deux clics, et personne ne comprenait pourquoi.
//
// LA SAISIE, comme les plateformes comparables (voir docs/reprise-s1.md) : une PREMIÈRE question
// fermée — « partout dans le monde » OU « dans certaines zones » — puis, seulement dans le second
// cas, des continents en un clic et une RECHERCHE de pays, la sélection montrée en étiquettes
// qu'on retire d'une croix. Le monde n'est plus jamais un bouton parmi les autres : aucun clic
// ne peut plus être absorbé en silence.

/** Le mode qu'une sélection exprime — `null` tant que rien n'est choisi (aucun défaut). */
export function modeDeSelection(zones: readonly WorkZone[], selected: readonly string[]): 'monde' | 'zones' | null {
  const monde = zones.find((z) => z.kind === 'world')
  if (monde && selected.includes(monde.id)) return 'monde'
  return selected.length > 0 ? 'zones' : null
}

/**
 * La zone déjà choisie qui COUVRE `id` (un continent pour un de ses pays, le monde pour tout), ou
 * `null`. Sert à dire « déjà couvert par Europe » au lieu d'ajouter une étiquette qui ne
 * changerait rien.
 */
export function zoneCouvrante(zones: readonly WorkZone[], selected: readonly string[], id: string): WorkZone | null {
  const parId = new Map(zones.map((z) => [z.id, z]))
  let courant = parId.get(id)?.parent_id ?? null
  while (courant) {
    if (selected.includes(courant)) return parId.get(courant) ?? null
    courant = parId.get(courant)?.parent_id ?? null
  }
  return null
}

/**
 * Ajouter une zone EN MODE « certaines zones ». Le monde, s'il était choisi, s'efface : on vient
 * de dire « pas partout ». Une zone déjà couverte ne s'ajoute pas (rendue inchangée — l'écran le
 * dit) ; un continent ajouté absorbe ses pays déjà choisis.
 */
export function ajouterZone(zones: WorkZone[], selected: readonly string[], id: string): string[] {
  const monde = worldZoneOf(zones)
  const sansMonde = selected.filter((v) => v !== monde?.id)
  if (sansMonde.includes(id) || zoneCouvrante(zones, sansMonde, id)) return [...sansMonde]
  return dedupeCoveredZones(zones, [...sansMonde, id])
}

export function retirerZone(selected: readonly string[], id: string): string[] {
  return selected.filter((v) => v !== id)
}

// ─── LA SAISIE PAR CONTINENT (lot zones de travail, 02/10/2026 — décision de Youssef) ──────────
//
// LE DÉFAUT : « Continents entiers » et « Ajouter un pays » côte à côte. Youssef a choisi Europe,
// a voulu ensuite choisir un pays DEDANS, et n'a compris qu'après coup qu'il fallait taper son nom.
//
// LA SAISIE : un clic sur un continent DÉPLIE ses pays — « Tout le continent » en tête, une case
// par pays. Ce qui s'enregistre est EXACTEMENT ce qui est coché :
//   · « Tout le continent » = le CONTINENT (il couvrira aussi un pays ajouté plus tard au
//     référentiel — le recalcul est en base, migration `zones_couverture_suit_le_referentiel`) ;
//   · des pays cochés = CES pays, et seulement eux (cocher les 46 un par un n'est pas « l'Europe »).
// Décocher un pays d'un continent entier laisse les AUTRES cochés : le continent devient la liste
// de ses autres pays. Le monde, s'il était choisi, s'efface dès qu'on choisit une zone.

/** Les pays proposés sous une zone (un continent), dans l'ordre du référentiel. */
export function paysDe(zones: readonly WorkZone[], zoneId: string): WorkZone[] {
  const enfants = new Map<string, WorkZone[]>()
  for (const z of zones) {
    if (!z.parent_id) continue
    const l = enfants.get(z.parent_id)
    if (l) l.push(z)
    else enfants.set(z.parent_id, [z])
  }
  const sortie: WorkZone[] = []
  const pile = [...(enfants.get(zoneId) ?? [])].reverse()
  while (pile.length > 0) {
    const z = pile.pop() as WorkZone
    if (z.kind === 'country') sortie.push(z)
    pile.push(...[...(enfants.get(z.id) ?? [])].reverse())
  }
  return sortie
}

/** Le continent d'un pays (l'ancêtre le plus proche de type continent), ou `null`. */
export function continentDe(zones: readonly WorkZone[], id: string): WorkZone | null {
  const parId = new Map(zones.map((z) => [z.id, z]))
  let courant = parId.get(id)?.parent_id ?? null
  while (courant) {
    const z = parId.get(courant)
    if (!z) return null
    if (z.kind === 'continent') return z
    courant = z.parent_id
  }
  return null
}

/** Ce qu'une sélection dit d'un continent : entier, ou les pays cochés (tous, s'il est entier). */
export function etatDuContinent(
  zones: readonly WorkZone[],
  selected: readonly string[],
  continentId: string,
): { entier: boolean; coches: string[] } {
  const pays = paysDe(zones, continentId).map((z) => z.id)
  if (selected.includes(continentId)) return { entier: true, coches: pays }
  return { entier: false, coches: pays.filter((id) => selected.includes(id)) }
}

/**
 * « Tout le continent », coché ou décoché. Coché : le continent remplace ses pays déjà cochés (il
 * les couvre tous). Décoché : le continent sort, et aucun de ses pays ne reste — « tout » décoché
 * ne veut pas dire « tout sauf rien ».
 */
export function choisirContinentEntier(
  zones: readonly WorkZone[],
  selected: readonly string[],
  continentId: string,
  coche: boolean,
): string[] {
  const monde = zones.find((z) => z.kind === 'world')?.id
  const sesPays = new Set(paysDe(zones, continentId).map((z) => z.id))
  const reste = selected.filter((id) => id !== monde && id !== continentId && !sesPays.has(id))
  return coche ? [...reste, continentId] : reste
}

/**
 * Une case de pays. Cochée : le pays s'ajoute. Décochée : il sort — et si son continent ENTIER
 * était choisi, le continent devient la liste de ses AUTRES pays (décocher la France de « Europe —
 * tout le continent » laisse les 45 autres cochés).
 */
export function basculerPays(zones: readonly WorkZone[], selected: readonly string[], paysId: string): string[] {
  const monde = zones.find((z) => z.kind === 'world')?.id
  const sansMonde = selected.filter((id) => id !== monde)
  if (sansMonde.includes(paysId)) return sansMonde.filter((id) => id !== paysId)
  const continent = continentDe(zones, paysId)
  if (continent && sansMonde.includes(continent.id)) {
    const autres = paysDe(zones, continent.id).map((z) => z.id).filter((id) => id !== paysId)
    return [...sansMonde.filter((id) => id !== continent.id), ...autres]
  }
  return [...sansMonde, paysId]
}

/**
 * Le libellé AFFICHÉ d'une zone choisie : un continent se lit « Europe — tout le continent », jamais
 * « Europe » seul (qu'on prendrait pour une précision) ni la liste de ses pays. Le gabarit vient des
 * messages (`work_zones.continent_entier`, quatre langues) : une formule neutre, qui s'accorde avec
 * tout continent, y compris un continent ajouté plus tard (décision de Youssef).
 */
export function libelleDeZone(
  zone: { kind: string; name: string },
  gabaritContinentEntier: string,
): string {
  return zone.kind === 'continent' ? gabaritContinentEntier.replace('{zone}', () => zone.name) : zone.name
}

/**
 * Deux sélections de zones disent-elles la même chose ? Les zones forment un ENSEMBLE : l'ordre dans
 * lequel l'écran ou la base les rend ne change rien à ce qui filtre. Sert à ne pas écrire, ni
 * relancer, un enregistrement qui ne change rien.
 */
export function memesZones(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  const ea = new Set(a ?? [])
  const eb = new Set(b ?? [])
  return ea.size === eb.size && [...ea].every((id) => eb.has(id))
}

/** Une recherche de pays insensible à la casse et aux accents (« reunion » trouve « Réunion »). */
export function normaliserRecherche(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}
