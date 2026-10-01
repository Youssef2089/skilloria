// lib/profil/notification-statut.ts
//
// LE TEXTE D'UNE NOTIFICATION DE STATUT EST CELUI DE L'ÉCRAN (recette staging du
// 01/10/2026, point 5). Les titres et corps des notifications de vérification vivaient
// en dur dans lib/verification/expert-verification.ts, dans quatre langues, avec leurs
// propres mots (« en cours de validation ») ; la pastille en avait d'autres, l'étape 3
// d'autres encore. Ils sont désormais lus dans l'espace `statut_profil` des messages,
// le même que la pastille : « Statut de votre profil : <état> », puis la phrase qui dit
// ce qui va se passer.

import fr from '@/messages/fr.json'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import de from '@/messages/de.json'
import { cleLibelleStatut, clePhraseStatut, type EtatAffiche } from '@/lib/verification-state'

const MESSAGES = { fr, en, es, de } as const
export type LangueNotification = keyof typeof MESSAGES

function lire(langue: LangueNotification, cle: string): string | null {
  let n: unknown = (MESSAGES[langue] as Record<string, unknown>).statut_profil
  for (const part of cle.split('.')) {
    if (!n || typeof n !== 'object') return null
    n = (n as Record<string, unknown>)[part]
  }
  return typeof n === 'string' ? n : null
}

/** La voie de l'expert, depuis `users.user_type` : un CDI reçoit des offres, un freelance des missions. */
export function voieDuCompte(userType: string | null | undefined): 'freelance' | 'cdi' {
  return userType === 'expert_cdi' ? 'cdi' : 'freelance'
}

export function texteNotificationStatut(
  etat: EtatAffiche,
  voie: 'freelance' | 'cdi',
  langue: LangueNotification,
): { titre: string; corps: string } {
  const libelle = lire(langue, cleLibelleStatut(etat)) ?? lire('fr', cleLibelleStatut(etat)) ?? etat
  const gabarit = lire(langue, 'titre') ?? lire('fr', 'titre') ?? '{etat}'
  const phrase = lire(langue, clePhraseStatut(etat, voie)) ?? lire('fr', clePhraseStatut(etat, voie)) ?? ''
  return { titre: gabarit.replace('{etat}', () => libelle), corps: phrase }
}
