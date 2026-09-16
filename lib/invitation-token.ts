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

/**
 * DATE D'EXPIRATION D'UNE INVITATION — SOURCE UNIQUE.
 *
 * ═══ POURQUOI CETTE FONCTION EXISTE ═════════════════════════════════════════
 *   `7 * 24 * 60 * 60 * 1000` vivait en dur, et dans **DEUX** fichiers : la
 *   route de création et celle de renvoi. Deux fichiers qui portent le même
 *   nombre divergeront un jour — c'est ce que `lib/org-target-role.ts` a fermé
 *   pour le mappage des offres, où **six** copies avaient déjà dérivé au point
 *   de faire hériter une offre entreprise à l'organisation personnelle d'un
 *   expert.
 *
 *   La durée vient désormais de `duree_reglages.invitation_jours`, lue par les
 *   routes (cf. lib/durees.ts). **Aucun défaut ici** : l'argument est requis,
 *   un appel qui l'oublie ne compile pas.
 *
 * ═══ ET CE RÉGLAGE N'EST PAS RÉTROACTIF ═════════════════════════════════════
 *   La date est **ÉCRITE** — à la création, et réécrite au renvoi. Une
 *   invitation déjà partie garde donc la sienne : passer la durée à 3 jours ne
 *   raccourcit aucune invitation en circulation. Même comportement que la
 *   fenêtre d'échange, et l'inverse de la vie d'une annonce, qui se recalcule à
 *   chaque lecture.
 */
export function invitationExpiryIso(
  ctx: { invitationJours: number },
  from: Date = new Date(),
): string {
  return new Date(from.getTime() + ctx.invitationJours * 24 * 60 * 60 * 1000).toISOString()
}
