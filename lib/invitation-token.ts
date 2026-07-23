import { randomBytes, createHash } from 'node:crypto'

/**
 * Jetons d'invitation d'organisation (Lot B).
 *
 * Même modèle de sécurité que les jetons de session (lib/session-token.ts,
 * décision D1) : le token est généré côté serveur, ENVOYÉ EN CLAIR dans le lien
 * d'email, et STOCKÉ HACHÉ (sha256) en base (organization_invitations.token).
 * La vérification hache le token reçu avant le lookup. JAMAIS de token en clair
 * en base.
 *
 * On duplique volontairement `hashInvitationToken` (plutôt que de réutiliser
 * `hashSessionToken`) : même algorithme, mais domaine sémantique distinct — un
 * jeton de session et un jeton d'invitation ne doivent pas être confondus au
 * call-site.
 */

/**
 * Token aléatoire fort — 32 octets (256 bits d'entropie) en hexadécimal, propre
 * en URL (`/invitation/<token>`). Non brute-forçable / non dictionnable, donc
 * un sha256 non salé suffit pour le stockage (cf. justification session-token).
 */
export function generateInvitationToken(): string {
  return randomBytes(32).toString('hex')
}

/** sha256 (hex) du token d'invitation — valeur stockée en base. */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
