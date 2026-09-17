'use client'

import type { RegleNumero } from './numero-identification'
import { regleDepuisLignePays } from './numero-identification'

/**
 * lib/pays/referentiel-client.ts — LE RÉFÉRENTIEL PAYS, CÔTÉ NAVIGATEUR.
 *
 * ═══ POURQUOI CE MODULE ═══════════════════════════════════════════════════
 *   Le chargement de `/api/countries` vivait DANS `CountrySelect`, avec son
 *   cache privé. Trois écrans en ont maintenant besoin — le sélecteur, la
 *   saisie du numéro d'identification à l'inscription, et la même saisie dans
 *   la modale post-connexion — et chacun aurait refait son `fetch`.
 *
 *   Le dépôt a déjà payé ce prix trois fois : une saisie de téléphone recopiée
 *   en trois exemplaires, avec trois validations divergentes (§E.14). On sort
 *   donc le chargement AVANT qu'il ne se duplique, pas après.
 *
 * ═══ UN SEUL APPEL RÉSEAU POUR TOUTE LA PAGE ══════════════════════════════
 *   Le cache est au niveau du module : le premier appelant déclenche la
 *   requête, les suivants attendent LA MÊME promesse. Trois composants montés
 *   ensemble ne font pas trois requêtes.
 */

export type PaysReferentiel = {
  code: string
  name_fr: string
  name_en: string
  name_es: string
  name_de: string
  flag_emoji: string
  phone_code?: string | null
  sort_order: number
  // Colonnes du format de numéro d'identification. Optionnelles dans le type :
  // un client déployé avant la migration ne les reçoit pas, et l'écran doit
  // dégrader — pas planter. Absentes ⇒ aucune règle ⇒ on accepte.
  registre_numero_libelle?: string | null
  registre_numero_exemple?: string | null
  registre_numero_longueur_min?: number | null
  registre_numero_longueur_max?: number | null
  registre_numero_alphanumerique?: boolean | null
}

let cache: PaysReferentiel[] | null = null
let enCours: Promise<PaysReferentiel[]> | null = null

/**
 * Charge le référentiel, une fois par page.
 *
 * Un échec rend un tableau VIDE et ne relance pas la promesse en échec : les
 * écrans affichent alors leur état « référentiel indisponible » plutôt qu'une
 * liste muette — un sélecteur vide sans explication est un écran mort.
 */
export function chargerPays(): Promise<PaysReferentiel[]> {
  if (cache) return Promise.resolve(cache)
  if (enCours) return enCours
  enCours = fetch('/api/countries')
    .then((r) => (r.ok ? r.json() : []))
    .then((data: unknown) => {
      const liste = Array.isArray(data) ? (data as PaysReferentiel[]) : []
      cache = liste
      return liste
    })
    .catch(() => {
      // On relâche la promesse pour qu'un remontage puisse retenter.
      enCours = null
      return []
    })
  return enCours
}

/** Le référentiel déjà chargé, ou `null`. Évite un état de chargement inutile. */
export function paysEnCache(): PaysReferentiel[] | null {
  return cache
}

/** Nom du pays dans la langue de lecture. */
export function nomPays(p: PaysReferentiel, locale: string): string {
  switch (locale) {
    case 'en':
      return p.name_en
    case 'es':
      return p.name_es
    case 'de':
      return p.name_de
    default:
      return p.name_fr
  }
}

/**
 * Règle du numéro d'identification pour ce pays — la MÊME lecture que le
 * serveur, par la MÊME fonction. `null` si le pays n'est pas au référentiel.
 */
export function regleNumeroPour(liste: PaysReferentiel[], code: string): RegleNumero | null {
  const p = liste.find((x) => x.code === code)
  if (!p) return null
  return regleDepuisLignePays(p as unknown as Record<string, unknown>)
}
