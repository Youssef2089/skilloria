/**
 * lib/otp/vonage-refus.ts — CE QUE VONAGE DIT VRAIMENT, RENDU DISABLE.
 *
 * ═══ LE DÉFAUT ════════════════════════════════════════════════════════════
 *   Vonage Verify v2 répond en `application/problem+json` : un `type` (une URL
 *   dont le fragment nomme l'erreur : `…/api-errors#low-balance`), un `title`
 *   court et un `detail` exploitable. Le dépôt en faisait ceci :
 *     · `detail` n'était renvoyé QUE sur 400/422, dans un champ `error` que
 *       AUCUN client n'affiche (tous lisent `code`) ;
 *     · `title` était purement et simplement jeté ;
 *     · tout autre statut — 403, 409, 402… — était écrasé en `vonage_error`,
 *       c'est-à-dire « Service SMS temporairement indisponible ».
 *   L'utilisateur lisait donc « réessayez » pour une situation où réessayer ne
 *   changerait rien.
 *
 * ═══ ET LE SECOND DÉFAUT (§E.86, 29/09/2026) ══════════════════════════════
 *   Le lot précédent avait séparé le PAYS de la PANNE, mais pas la CONFIGURATION :
 *   des identifiants refusés (401), un crédit épuisé (402, `out-of-credit` en
 *   403), un compte suspendu, et même une clé ABSENTE du déploiement (`missing_env`,
 *   que l'écran ne connaissait pas) tombaient encore dans « temporairement
 *   indisponible ». C'est ce que Youssef a lu sur staging, et la seule piste était
 *   une ligne de journal sans cause. Désormais :
 *     · le champ `type` est lu — c'est le seul nom STABLE que Vonage publie
 *       (référence des erreurs : developer.vonage.com/en/api-errors, lue le 29/09/2026) ;
 *     · chaque situation porte une CAUSE nommée (`CauseOtp`), journalisée ;
 *     · l'écran reçoit `sms_non_configure` pour tout ce qui ne dépend pas de la
 *       personne, et « temporairement » n'est plus dit que quand c'est vrai.
 *
 * ═══ POURQUOI ON TRADUIT EN CODES PLUTÔT QUE DE RECOPIER LE TEXTE ═════════
 *   Le `detail` de Vonage est en ANGLAIS, et rédigé pour un intégrateur, pas
 *   pour un candidat à l'inscription. On RECONNAÎT la situation et on rend un code
 *   STABLE, que les écrans traduisent dans les quatre langues. Le texte brut de
 *   Vonage part dans les journaux serveur, où il sert à qui débogue.
 *
 * ═══ LES QUATRE ISSUES POUR LA PERSONNE ═══════════════════════════════════
 *   `sms_pays_non_pris_en_charge` — les SMS ne partent pas vers ce numéro.
 *       Réessayer est INUTILE. Issue : un autre numéro, ou nous écrire.
 *   `sms_non_configure` — le service est indisponible pour une raison de NOTRE
 *       côté (configuration, compte, crédit). Réessayer est INUTILE. Issue : nous écrire.
 *   `vonage_invalid_request` — le numéro est refusé. Issue : le corriger.
 *   `vonage_error` — panne passagère ou fournisseur injoignable.
 *       Réessayer a du sens : c'est le SEUL cas où « temporairement » est vrai.
 *
 * ⚠️ CE MODULE NE TOUCHE PAS AU CANAL SMS DE NOTIFICATION (§D.2). Verify v2
 *    (`api.nexmo.com/v2/verify`) et le canal de notification
 *    (`rest.nexmo.com/sms/json`, fermé au dispatcher) n'ont aucun point commun.
 */

/** Codes de refus rendus par les routes OTP. Contrat avec les écrans et l'i18n. */
export type CodeRefusOtp =
  /** Les SMS ne sont pas acheminés vers ce numéro (pays, anti-fraude). Réessayer ne sert à rien. */
  | 'sms_pays_non_pris_en_charge'
  /** Indisponible pour une raison de NOTRE côté (configuration, compte, crédit). Réessayer ne sert à rien. */
  | 'sms_non_configure'
  /** Le numéro est refusé par le fournisseur (format, ligne inexistante). */
  | 'vonage_invalid_request'
  /** Trop de demandes — côté fournisseur. */
  | 'rate_limited'
  /** Une vérification est déjà en cours sur ce numéro. */
  | 'verification_en_cours'
  /** Panne passagère, ou fournisseur injoignable. Réessayer a du sens. */
  | 'vonage_error'

/**
 * LA CAUSE NOMMÉE. Le code rendu à l'écran dit ce que la PERSONNE peut faire ; la
 * cause dit à qui lit les journaux ce qui s'est PASSÉ. Un identifiant refusé, un
 * crédit épuisé et une variable absente disent la même chose à l'écran — « ce n'est
 * pas de votre fait » — et trois choses différentes à régler.
 */
export type CauseOtp =
  /** VONAGE_API_KEY ou VONAGE_API_SECRET absente du déploiement. */
  | 'vonage_identifiants_absents'
  /** Vonage refuse les identifiants (401, `unauthorized`, `invalid-api-key`). */
  | 'vonage_identifiants_refuses'
  /** Crédit du compte Vonage insuffisant (402, `low-balance`, `out-of-credit`). */
  | 'vonage_credit_insuffisant'
  /** Compte Vonage suspendu (`account-suspended`). */
  | 'vonage_compte_suspendu'
  /** Le compte n'a pas le droit de faire cette opération (403, `forbidden`). */
  | 'vonage_acces_refuse'
  /** La destination n'est pas desservie (pays restreint, liste propre à Verify). */
  | 'vonage_destination_refusee'
  /** Refus de l'anti-fraude de Vonage (`fraud-check`). */
  | 'vonage_antifraude'
  /** Une vérification est déjà en cours sur ce numéro (409, `concurrent`). */
  | 'vonage_verification_en_cours'
  /** Limite de débit de Vonage (429, `throttled`). */
  | 'vonage_limite_de_debit'
  /** Paramètres refusés — le plus souvent le numéro (400, 422, `invalid-params`). */
  | 'vonage_parametres_refuses'
  /** Panne de Vonage (5xx). */
  | 'vonage_panne'
  /** Délai dépassé avant la réponse de Vonage. */
  | 'vonage_delai_depasse'
  /** Vonage injoignable (réseau). */
  | 'vonage_injoignable'
  /** Réponse de Vonage sans `request_id` ni erreur lisible. */
  | 'vonage_reponse_illisible'
  /** Statut non reconnu. */
  | 'vonage_reponse_inconnue'
  /** PHONE_OTP_HMAC_SECRET (et son repli SUPABASE_JWT_SECRET) absente ou trop courte : le code était bon, le jeton ne se signe pas. */
  | 'jeton_telephone_non_signable'
  /** Clé de service Supabase absente : le limiteur d'essais ne peut pas tourner, la vérification est refusée. */
  | 'limiteur_indisponible'

export type ErreurOtp = {
  code: CodeRefusOtp
  cause: CauseOtp
  /** Statut HTTP à rendre à l'appelant. */
  status: number
  /**
   * Texte BRUT du fournisseur, pour les journaux serveur UNIQUEMENT.
   * Jamais affiché : il est en anglais et écrit pour un intégrateur.
   */
  detailFournisseur: string
}

/** Nom historique, gardé pour les appelants : c'est la même forme. */
export type RefusVonage = ErreurOtp

/**
 * Motifs reconnus comme « ce pays n'est pas desservi ».
 *
 * ⚠️ ON RECONNAÎT DES MOTS, en SECOND : Verify v2 ne publie pas de `type` distinct
 *    pour la restriction géographique. Une formulation qui changerait chez Vonage
 *    ferait retomber le cas dans une cause par STATUT — jamais dans quelque chose
 *    de pire que le comportement d'avant.
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

/** Le nom de l'erreur publié par Vonage : le fragment de `type` (`…/api-errors#low-balance` → `low-balance`). */
function typeVonage(type: unknown): string {
  if (typeof type !== 'string') return ''
  const i = type.lastIndexOf('#')
  return (i >= 0 ? type.slice(i + 1) : type.slice(type.lastIndexOf('/') + 1)).trim().toLowerCase()
}

/** Les situations qui ne dépendent pas de la personne : même écran, une cause chacune, 503. */
function nonConfigure(cause: CauseOtp, detailFournisseur: string): ErreurOtp {
  return { code: 'sms_non_configure', cause, status: 503, detailFournisseur }
}

/**
 * Traduit une réponse d'erreur Verify v2 en code d'écran et en cause nommée.
 *
 * @param status statut HTTP rendu par Vonage
 * @param payload corps `problem+json` (`type`, `title`, `detail`), éventuellement null
 */
export function lireRefusVonage(
  status: number,
  payload: { type?: unknown; title?: unknown; detail?: unknown } | null,
): ErreurOtp {
  const type = typeVonage(payload?.type)
  const title = typeof payload?.title === 'string' ? payload.title : ''
  const detail = typeof payload?.detail === 'string' ? payload.detail : ''
  const texte = `${title} ${detail}`.trim()
  const detailFournisseur = `${type ? `[${type}] ` : ''}${texte.length > 0 ? texte : `HTTP ${status}`}`.slice(0, 300)

  // ① LE NOM PUBLIÉ PAR VONAGE D'ABORD : c'est le seul signal stable.
  if (type === 'unauthorized' || type === 'invalid-api-key') return nonConfigure('vonage_identifiants_refuses', detailFournisseur)
  if (type === 'low-balance' || type === 'out-of-credit') return nonConfigure('vonage_credit_insuffisant', detailFournisseur)
  if (type === 'account-suspended') return nonConfigure('vonage_compte_suspendu', detailFournisseur)
  if (type === 'fraud-check') return { code: 'sms_pays_non_pris_en_charge', cause: 'vonage_antifraude', status: 422, detailFournisseur }
  if (type === 'concurrent') return { code: 'verification_en_cours', cause: 'vonage_verification_en_cours', status: 409, detailFournisseur }
  if (type === 'throttled') return { code: 'rate_limited', cause: 'vonage_limite_de_debit', status: 429, detailFournisseur }

  // ② LE PAYS : la seule situation sans issue technique, reconnue par ses mots. Un blocage
  //    géographique sort tantôt en 422, tantôt en 403 selon le compte — il prime sur le statut.
  if (texte.length > 0 && contient(texte, MOTIFS_PAYS_NON_DESSERVI)) {
    return { code: 'sms_pays_non_pris_en_charge', cause: 'vonage_destination_refusee', status: 422, detailFournisseur }
  }

  // ③ LE STATUT, en dernier recours.
  if (status === 401) return nonConfigure('vonage_identifiants_refuses', detailFournisseur)
  if (status === 402) return nonConfigure('vonage_credit_insuffisant', detailFournisseur)
  if (status === 403) return nonConfigure('vonage_acces_refuse', detailFournisseur)
  if (status === 409 || (texte.length > 0 && contient(texte, MOTIFS_CONCURRENCE))) {
    return { code: 'verification_en_cours', cause: 'vonage_verification_en_cours', status: 409, detailFournisseur }
  }
  if (status === 429) return { code: 'rate_limited', cause: 'vonage_limite_de_debit', status: 429, detailFournisseur }

  // 422 / 400 sans motif reconnu : le fournisseur a refusé la DEMANDE — le plus
  // souvent le numéro lui-même. Réessayer à l'identique ne sert à rien, mais
  // corriger le numéro, si.
  if (status === 422 || status === 400 || type === 'invalid-params') {
    return { code: 'vonage_invalid_request', cause: 'vonage_parametres_refuses', status: 400, detailFournisseur }
  }

  // ④ Une panne 5xx : le SEUL cas, avec le fournisseur injoignable, où « réessayez » est honnête.
  if (status >= 500) return { code: 'vonage_error', cause: 'vonage_panne', status: 502, detailFournisseur }
  return { code: 'vonage_error', cause: 'vonage_reponse_inconnue', status: 502, detailFournisseur }
}

/** VONAGE_API_KEY ou VONAGE_API_SECRET absente : ce n'est PAS « temporairement indisponible ». */
export function identifiantsVonageAbsents(): ErreurOtp {
  return nonConfigure('vonage_identifiants_absents', 'VONAGE_API_KEY ou VONAGE_API_SECRET absente du déploiement')
}

/** Le jeton du téléphone ne se signe pas (secret absent) : le code SMS était juste, la configuration non. */
export function jetonTelephoneNonSignable(err: unknown): ErreurOtp {
  return nonConfigure('jeton_telephone_non_signable', (err instanceof Error ? err.message : String(err)).slice(0, 300))
}

/** Le limiteur d'essais ne tourne pas (clé de service absente) : refus, et on dit pourquoi — jamais « trop d'essais ». */
export function limiteurIndisponible(): ErreurOtp {
  return nonConfigure('limiteur_indisponible', 'SUPABASE_SERVICE_ROLE_KEY ou NEXT_PUBLIC_SUPABASE_URL absente')
}

/** L'appel à Vonage a levé : délai dépassé ou réseau. Avec la panne 5xx, le seul cas où « réessayez » est honnête. */
export function vonageInjoignable(err: unknown): ErreurOtp {
  const delai = err instanceof Error && err.name === 'AbortError'
  return {
    code: 'vonage_error',
    cause: delai ? 'vonage_delai_depasse' : 'vonage_injoignable',
    status: 502,
    detailFournisseur: (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 300),
  }
}

/** Une réponse 2xx sans `request_id` : on ne sait pas ce qui s'est passé, et on le dit. */
export function reponseVonageIllisible(status: number): ErreurOtp {
  return { code: 'vonage_error', cause: 'vonage_reponse_illisible', status: 502, detailFournisseur: `HTTP ${status} sans request_id` }
}

/**
 * LA CAUSE PART DANS LES JOURNAUX, NOMMÉE, à chaque refus — une seule forme pour
 * les quatre routes OTP. L'écran reçoit le CODE ; Vercel reçoit la CAUSE et le
 * texte brut du fournisseur. Une ligne suffit à trancher : `[otp] … — <cause>`.
 */
export function journaliserErreurOtp(route: string, e: ErreurOtp): void {
  console.error(`[otp] ${route} — ${e.cause}`, { cause: e.cause, code: e.code, status: e.status, detail: e.detailFournisseur })
}

/**
 * La réponse JSON d'un refus : le CODE seul, pour l'écran. La cause reste au serveur — elle dirait à
 * n'importe quel visiteur l'état du compte Vonage (crédit, identifiants) ; les journaux suffisent à trancher.
 */
export function reponseErreurOtp(route: string, e: ErreurOtp): Response {
  journaliserErreurOtp(route, e)
  return new Response(JSON.stringify({ error: 'OTP refused', code: e.code }), {
    status: e.status,
    headers: { 'content-type': 'application/json' },
  })
}
