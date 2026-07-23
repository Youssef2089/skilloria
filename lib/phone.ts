import { parsePhoneNumberFromString } from 'libphonenumber-js'

/**
 * lib/phone.ts — normalisation E.164 STRICTE, source unique.
 *
 * Pourquoi ce helper existe : côté org, le téléphone était stocké VERBATIM
 * (seule garde = une regex `^\+[1-9]\d{6,14}$`). Deux écritures du même numéro
 * (`+33612345678` vs `+330612345678`, `+33 6 12…`, `0033…`) passaient la regex
 * et donnaient deux chaînes distinctes → l'unicité du téléphone était
 * contournable par variation de format. Ce module canonicalise AVANT tout
 * stockage, toute signature de jeton OTP et tout contrôle d'unicité, pour que
 * l'index unique `users(phone) where phone_verified` soit fiable.
 *
 * Dépendance libphonenumber-js : seule bibliothèque éprouvée qui parse et
 * canonicalise les formats nationaux/internationaux réels — l'écrire à la main
 * rouvrirait exactement le trou qu'on ferme.
 *
 * Contrat :
 *   - normalizeE164(raw) → forme canonique E.164 (`+33612345678`) si le numéro
 *     est VALIDE et complet, sinon `null`. Ne devine JAMAIS un pays : un numéro
 *     national sans indicatif (`0612…`) retourne null (on n'infère pas +33).
 *   - isE164(s) → true si `s` est déjà une chaîne E.164 canonique.
 */

/**
 * Canonicalise un numéro en E.164 strict. Retourne null si invalide/incomplet.
 *
 * Volontairement SANS `defaultCountry` : on n'infère aucun indicatif. Un numéro
 * saisi doit être international (préfixe `+`) pour être accepté — c'est déjà ce
 * que l'UI impose (champ pré-rempli `+33`). Refuser l'inférence évite qu'un
 * `0612345678` devienne `+33612345678` sur un tenant non-français.
 */
export function normalizeE164(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > 40) return null

  // Un numéro E.164 commence par `+`. On rejette d'emblée toute saisie
  // nationale (pas d'inférence de pays — cf. entête).
  if (!trimmed.startsWith('+')) return null

  const parsed = parsePhoneNumberFromString(trimmed)
  if (!parsed || !parsed.isValid()) return null

  const e164 = parsed.number // toujours au format E.164 canonique
  // Ceinture + bretelles : la forme retournée DOIT respecter le gabarit E.164.
  return isE164(e164) ? e164 : null
}

/** `true` si `s` est déjà une chaîne E.164 canonique (`+` puis 7 à 15 chiffres). */
export function isE164(s: unknown): s is string {
  return typeof s === 'string' && /^\+[1-9]\d{6,14}$/.test(s)
}
