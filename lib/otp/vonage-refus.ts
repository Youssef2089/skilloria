/**
 * lib/otp/vonage-refus.ts — CE QUE VONAGE DIT VRAIMENT, RENDU DISABLE.
 *
 * ═══ LE DÉFAUT ════════════════════════════════════════════════════════════
 *   Vonage Verify v2 répond en `application/problem+json` : un `title` court et
 *   un `detail` exploitable. Le dépôt en faisait ceci :
 *     · `detail` n'était renvoyé QUE sur 400/422, dans un champ `error` que
 *       AUCUN client n'affiche (tous lisent `code`) ;
 *     · `title` était purement et simplement jeté ;
 *     · tout autre statut — 403, 409, 402… — était écrasé en `vonage_error`,
 *       c'est-à-dire « Service SMS temporairement indisponible ».
 *   L'utilisateur lisait donc « réessayez » pour une situation où réessayer ne
 *   changerait rien.
 *
 * ═══ POURQUOI ON TRADUIT EN CODES PLUTÔT QUE DE RECOPIER LE TEXTE ═════════
 *   Le `detail` de Vonage est en ANGLAIS, et rédigé pour un intégrateur, pas
 *   pour un candidat à l'inscription. Le renvoyer tel quel à un utilisateur
 *   francophone remplacerait un message générique par un message incompris —
 *   ce n'est pas un progrès.
 *
 *   On fait donc l'inverse : on RECONNAÎT la situation et on rend un code
 *   STABLE, que les écrans traduisent dans les quatre langues. Le texte brut de
 *   Vonage part dans les journaux serveur, où il sert à qui débogue.
 *
 * ═══ LES DEUX SITUATIONS QUI COMPTENT, ET POURQUOI ELLES SONT SÉPARÉES ════
 *   `sms_pays_non_pris_en_charge` — les SMS ne partent pas vers ce pays.
 *       Réessayer est INUTILE. L'utilisateur a une issue : nous écrire.
 *   `vonage_error` — panne passagère du fournisseur.
 *       Réessayer a du sens, et il n'y a rien d'autre à faire.
 *   Les confondre, c'est soit faire attendre indéfiniment quelqu'un que rien ne
 *   débloquera, soit envoyer au support quelqu'un qu'une minute aurait suffi à
 *   servir.
 *
 * ⚠️ CE MODULE NE TOUCHE PAS AU CANAL SMS DE NOTIFICATION (§D.2). Verify v2
 *    (`api.nexmo.com/v2/verify`) et le canal de notification
 *    (`rest.nexmo.com/sms/json`, fermé au dispatcher) n'ont aucun point commun.
 */

/** Codes de refus rendus par les routes OTP. Contrat avec les écrans et l'i18n. */
export type CodeRefusOtp =
  /** Les SMS ne sont pas acheminés vers ce pays. Réessayer ne sert à rien. */
  | 'sms_pays_non_pris_en_charge'
  /** Le numéro est refusé par le fournisseur (format, ligne inexistante). */
  | 'vonage_invalid_request'
  /** Trop de demandes — côté fournisseur. */
  | 'rate_limited'
  /** Une vérification est déjà en cours sur ce numéro. */
  | 'verification_en_cours'
  /** Panne passagère, ou situation non reconnue. Réessayer a du sens. */
  | 'vonage_error'

export type RefusVonage = {
  code: CodeRefusOtp
  /** Statut HTTP à rendre à l'appelant. */
  status: number
  /**
   * Texte BRUT de Vonage, pour les journaux serveur UNIQUEMENT.
   * Jamais affiché : il est en anglais et écrit pour un intégrateur.
   */
  detailFournisseur: string
}

/**
 * Motifs reconnus comme « ce pays n'est pas desservi ».
 *
 * ⚠️ ON RECONNAÎT DES MOTS, PAS DES CODES, et il faut le dire : Verify v2 ne
 *    publie pas de code d'erreur distinct pour la restriction géographique. On
 *    lit donc `title` et `detail`. Une formulation qui changerait chez Vonage
 *    ferait retomber le cas dans `vonage_error` — c'est-à-dire dans le
 *    comportement d'AVANT ce lot, jamais dans quelque chose de pire.
 *
 * Contexte vérifié : la Tunisie (+216) est bloquée par Vonage sur Verify. Ce
 * n'est ni Fraud Defender ni une Traffic Rule, c'est une liste de pays
 * restreints propre à Verify, qui exige un ticket au support. Ce point est
 * SUIVI HORS DU CODE (cf. §H de CLAUDE.md) — ici on rend l'échec VISIBLE, on ne
 * le corrige pas.
 */
const MOTIFS_PAYS_NON_DESSERVI = [
  'country',
  'destination',
  'not supported',
  'unsupported',
  'restricted',
  'blocked',
  'not permitted',
  'barred',
] as const

/** Motifs indiquant une vérification déjà en cours sur le même numéro. */
const MOTIFS_CONCURRENCE = ['concurrent', 'in progress', 'already'] as const

function contient(texte: string, motifs: readonly string[]): boolean {
  const t = texte.toLowerCase()
  return motifs.some((m) => t.includes(m))
}

/**
 * Traduit une réponse d'erreur Verify v2 en code stable.
 *
 * @param status statut HTTP rendu par Vonage
 * @param payload corps `problem+json` (`title`, `detail`), éventuellement null
 */
export function lireRefusVonage(
  status: number,
  payload: { title?: unknown; detail?: unknown } | null,
): RefusVonage {
  const title = typeof payload?.title === 'string' ? payload.title : ''
  const detail = typeof payload?.detail === 'string' ? payload.detail : ''
  const texte = `${title} ${detail}`.trim()
  const detailFournisseur = texte.length > 0 ? texte.slice(0, 300) : `HTTP ${status}`

  // LE PAYS D'ABORD : c'est la seule situation sans issue technique, et la
  // reconnaître prime sur le statut. Un blocage géographique sort tantôt en
  // 422, tantôt en 403 selon le compte.
  if (texte.length > 0 && contient(texte, MOTIFS_PAYS_NON_DESSERVI)) {
    return { code: 'sms_pays_non_pris_en_charge', status: 422, detailFournisseur }
  }

  if (status === 409 || (texte.length > 0 && contient(texte, MOTIFS_CONCURRENCE))) {
    return { code: 'verification_en_cours', status: 409, detailFournisseur }
  }

  if (status === 429) {
    return { code: 'rate_limited', status: 429, detailFournisseur }
  }

  // 422 / 400 sans motif reconnu : le fournisseur a refusé la DEMANDE — le plus
  // souvent le numéro lui-même. Réessayer à l'identique ne sert à rien, mais
  // corriger le numéro, si.
  if (status === 422 || status === 400) {
    return { code: 'vonage_invalid_request', status: 400, detailFournisseur }
  }

  // Tout le reste : panne. C'est le SEUL cas où « réessayez » est un conseil
  // honnête.
  return { code: 'vonage_error', status: 502, detailFournisseur }
}
