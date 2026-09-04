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
