/**
 * lib/expert-name-masking.ts — masquage de l'identité expert pour l'ORG.
 *
 * Règle métier (lot sécurité/RGPD) : côté entreprise, l'expert est affiché
 * sous la forme "Prénom + dernière lettre du nom en majuscule", SANS POINT.
 *
 *   "Youssef Cherif"  → "Youssef F"
 *   "Marie Dupont"    → "Marie T"
 *   "Élise Hügel"     → "Élise L"   (dernier caractère alphabétique : 'l' → 'L')
 *   "Marie" (no last) → "Marie"
 *   "" / null         → "Expert"    (fallback)
 *
 * Helper UNIQUE, appelé côté serveur AVANT envoi au client. Le navigateur
 * de l'entreprise ne doit JAMAIS recevoir le nom complet de l'expert ni
 * une initiale "officielle" avec point (qui ressemble à une initiale carte
 * d'identité). Format prénom + lettre majuscule = signal de pseudonymisation.
 *
 * Ne pas appeler côté EXPERT (self) ni côté ADMIN (modération). Ces deux
 * vues passent par des routes/SELECT distincts.
 */

/**
 * Renvoie le dernier caractère alphabétique d'une chaîne, ou null si aucun.
 * Unicode-safe : `\p{L}` reconnaît les lettres latines accentuées, cyrilliques, etc.
 * Les chiffres, traits d'union, espaces et autres ne sont pas considérés.
 */
function lastAlphaChar(s: string): string | null {
  // Itère de droite à gauche pour trouver le premier caractère alphabétique.
  // On utilise Array.from pour bien découper en code points (et non en UTF-16
  // surrogate pairs), nécessaire pour certains alphabets.
  const chars = Array.from(s)
  for (let i = chars.length - 1; i >= 0; i--) {
    const c = chars[i]
    if (/\p{L}/u.test(c)) return c
  }
  return null
}

/**
 * État du cycle de vie suppression de l'expert (mission S3). Quand il est
 * fourni et non-actif, le nom est REMPLACÉ par un placeholder côté ORG :
 *   - anonymized_at posé (purgé)         → « Utilisateur supprimé »
 *   - deletion_scheduled_at posé (grâce) → « Interlocuteur indisponible »
 * Sinon comportement inchangé (masquage prénom + lettre). Garde-fou C : le
 * placeholder vit UNIQUEMENT ici, jamais dans les pages org.
 */
export type ExpertAccountState = {
  deletion_scheduled_at?: string | null
  anonymized_at?: string | null
}

export function maskExpertNameForOrg(
  first_name: string | null | undefined,
  last_name: string | null | undefined,
  state?: ExpertAccountState | null,
): string {
  if (state?.anonymized_at) return 'Utilisateur supprimé'
  if (state?.deletion_scheduled_at) return 'Interlocuteur indisponible'

  const first = (first_name ?? '').trim()
  const last = (last_name ?? '').trim()

  if (!first && !last) return 'Expert'
  if (!last) return first

  const lastChar = lastAlphaChar(last)
  if (!lastChar) {
    // last_name présent mais aucun caractère alphabétique (ex. "—" ou "??")
    return first || 'Expert'
  }
  const upper = lastChar.toLocaleUpperCase()

  if (!first) return upper   // Pas de prénom → juste la lettre (cas edge)
  return `${first} ${upper}`
}
