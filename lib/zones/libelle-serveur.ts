// lib/zones/libelle-serveur.ts
//
// LE LIBELLÉ D'UNE ZONE CHOISIE, CÔTÉ SERVEUR — le même que l'écran de saisie (lot zones de travail,
// 02/10/2026). Une annonce « Europe » se lit « Europe — tout le continent » sur sa carte, son détail
// et la fiche admin : ni « Europe » seul (qu'on prendrait pour une précision), ni la liste de ses
// pays. Le gabarit vit dans les messages (`work_zones.continent_entier`, quatre langues) — un mot,
// un endroit : l'écran le lit par next-intl, le serveur ici (lecture directe des JSON, comme
// lib/notifications/inapp-labels.ts : on est hors arbre React).

import fr from '@/messages/fr.json'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import de from '@/messages/de.json'
import { libelleDeZone } from '@/lib/work-zones'

const GABARITS: Record<string, string> = {
  fr: fr.work_zones.continent_entier,
  en: en.work_zones.continent_entier,
  es: es.work_zones.continent_entier,
  de: de.work_zones.continent_entier,
}

/** Le gabarit « {zone} — tout le continent » dans la langue donnée (repli : le français). */
export function gabaritContinentEntier(locale: string | null | undefined): string {
  return GABARITS[locale ?? ''] ?? GABARITS.fr
}

/** Le libellé affiché d'une zone : un continent entier le dit, un pays et le monde gardent leur nom. */
export function libelleZoneServeur(zone: { kind: string; name: string }, locale: string | null | undefined): string {
  return libelleDeZone(zone, gabaritContinentEntier(locale))
}
