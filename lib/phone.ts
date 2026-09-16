import {
  parsePhoneNumberFromString,
  parseDigits,
  getExampleNumber,
  getCountryCallingCode,
  isSupportedCountry,
  type CountryCode,
} from 'libphonenumber-js'
import exemplesMobiles from 'libphonenumber-js/examples.mobile.json'

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

// ═══════════════════════════════════════════════════════════════════════════
// SAISIE : PAYS CHOISI + NUMÉRO NATIONAL
// ═══════════════════════════════════════════════════════════════════════════
//
// L'écran exigeait un « + » que rien n'annonçait, sous un drapeau français
// figé : un expert marocain ou tunisien ne pouvait pas saisir son numéro. Le
// motif de toutes les implémentations de référence est l'inverse — on CHOISIT
// un pays et on tape son numéro national, et c'est le CODE qui compose le
// E.164, jamais l'utilisateur.
//
// Ces helpers vivent ici, avec `normalizeE164`, parce que composer et
// normaliser sont la même règle vue des deux côtés. Les séparer ferait
// exactement ce que ce lot corrige : deux implémentations qui divergent.

/** Code ISO 3166-1 alpha-2 reconnu par la bibliothèque. Ré-exporté pour les appelants. */
export type PaysISO = CountryCode

/** `true` si `iso` est un code pays que la bibliothèque sait traiter. */
export function estPaysConnu(iso: unknown): iso is PaysISO {
  return typeof iso === 'string' && iso.length === 2 && isSupportedCountry(iso)
}

/**
 * Convertit les chiffres NON LATINS en chiffres latins, et rien d'autre.
 *
 * POURQUOI. On ouvre au Maghreb : un utilisateur arabophone peut composer son
 * numéro en chiffres arabes-indiens (٠١٢٣…) ou persans (۰۱۲۳…), que son clavier
 * produit naturellement. Les refuser serait un mur invisible — la saisie a
 * l'air correcte à l'écran et le bouton reste gris.
 *
 * ⚠️ `parseDigits` de la bibliothèque fait la conversion, mais il SUPPRIME tout
 *    ce qui n'est pas un chiffre — y compris le « + ». L'utiliser tel quel sur
 *    un numéro collé (`+٢١٦…`) détruirait l'indicatif, donc la détection du
 *    pays. On ne s'en sert donc que caractère par caractère, et on laisse
 *    passer le reste inchangé.
 */
export function chiffresEnLatin(raw: string): string {
  let sortie = ''
  for (const c of raw) {
    const latin = parseDigits(c)
    sortie += latin.length === 1 ? latin : c
  }
  return sortie
}

/**
 * Compose un E.164 à partir du pays choisi et du numéro national saisi.
 * Rend `null` si le résultat n'est pas un numéro valide et complet.
 *
 * C'est la SEULE façon d'obtenir un E.164 depuis un formulaire : l'utilisateur
 * ne tape jamais d'indicatif, donc il ne peut pas se tromper dessus.
 */
export function composerE164(iso: unknown, national: string): string | null {
  if (!estPaysConnu(iso)) return null
  const chiffres = chiffresEnLatin(national).replace(/\D/g, '')
  if (chiffres.length === 0) return null
  const parsed = parsePhoneNumberFromString(chiffres, iso)
  if (!parsed || !parsed.isValid()) return null
  return isE164(parsed.number) ? parsed.number : null
}

/**
 * Reconnaît un numéro COLLÉ avec son indicatif (`+21620123456`, `0021620…`).
 * Rend le pays détecté et le numéro national à afficher, ou `null`.
 *
 * POURQUOI C'EST OBLIGATOIRE. Quelqu'un qui colle un numéro international dans
 * un champ « numéro national » verrait sinon son indicatif traité comme le
 * début du numéro, et un refus incompréhensible. On bascule le sélecteur à sa
 * place.
 *
 * Accepte aussi les chiffres non latins, cf. `chiffresEnLatin`.
 */
export function reconnaitreNumeroColle(
  raw: string,
): { iso: PaysISO; national: string } | null {
  const t = chiffresEnLatin(raw).trim()
  // `00` est la forme internationale composée depuis un poste fixe : très
  // répandue au Maghreb et en Europe, et illisible pour le parseur sans `+`.
  const international = t.startsWith('00') ? `+${t.slice(2)}` : t
  if (!international.startsWith('+')) return null
  const parsed = parsePhoneNumberFromString(international)
  if (!parsed || !parsed.country) return null
  return { iso: parsed.country, national: parsed.nationalNumber }
}

/**
 * Exemple de numéro NATIONAL pour ce pays, à utiliser comme placeholder.
 *
 * ⚠️ IL VIENT DU PAYS, PAS DE LA LANGUE. Les messages du dépôt prescrivaient le
 *    format selon la LANGUE de l'interface : `+33…` en français, `+34…` en
 *    espagnol, `+49…` en allemand. Un Marocain lisant l'espagnol se voyait donc
 *    prescrire le format espagnol.
 *
 * ⚠️ ET IL VIENT DE LA BIBLIOTHÈQUE, pas d'une table écrite à la main : une
 *    table de formats vieillit en silence à chaque renumérotation nationale.
 */
export function exempleNational(iso: unknown): string | null {
  if (!estPaysConnu(iso)) return null
  const ex = getExampleNumber(iso, exemplesMobiles)
  return ex ? ex.formatNational() : null
}

/** Indicatif téléphonique du pays, préfixé `+` (`FR` → `+33`). */
export function indicatifDe(iso: unknown): string | null {
  if (!estPaysConnu(iso)) return null
  return `+${getCountryCallingCode(iso)}`
}

/**
 * Décompose un E.164 en (pays, numéro national) — l'opération inverse de
 * `composerE164`, pour ré-afficher une valeur déjà enregistrée.
 */
export function decomposerE164(e164: unknown): { iso: PaysISO; national: string } | null {
  if (!isE164(e164)) return null
  const parsed = parsePhoneNumberFromString(e164)
  if (!parsed || !parsed.country) return null
  return { iso: parsed.country, national: parsed.nationalNumber }
}
