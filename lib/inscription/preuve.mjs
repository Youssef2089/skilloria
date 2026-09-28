// @ts-check
/**
 * lib/inscription/preuve.mjs — LA PREUVE D'INSCRIPTION, SIGNÉE PAR LE SERVEUR (§D.27).
 *
 * ═══ CE QU'ELLE FERME ══════════════════════════════════════════════════════
 *   La clé PUBLIQUE de Supabase permet d'appeler le service d'authentification
 *   directement. Un compte créé ainsi échappait à tout ce que les routes
 *   vérifient. Désormais `handle_new_user` exige cette preuve : un HMAC-SHA256,
 *   calculé avec un secret que seul le serveur connaît, sur ce que la route a
 *   vérifié (l'adresse, le rôle, l'écosystème, la voie, la pièce, l'échéance,
 *   la version des CGU, le téléphone, l'invitation, l'acteur). Sans le secret,
 *   elle ne se forge pas ; pour une autre adresse, elle ne vaut pas.
 *
 * ═══ UN MODULE .mjs, PAS .ts — ET C'EST VOULU ══════════════════════════════
 *   Deux appelants qui ne partagent pas de compilateur : les routes (Next,
 *   TypeScript) et le script du premier administrateur (Node nu). Une seule
 *   définition de la chaîne signée pour les deux ; une copie divergerait.
 *
 * ═══ LA CHAÎNE SIGNÉE EST UN CONTRAT AVEC LA BASE ══════════════════════════
 *   `preuve_inscription_canonique()` (migration porte_inscription) la construit
 *   dans le MÊME ordre : 'v1', l'adresse en minuscules, puis CHAMPS_SIGNES,
 *   séparés par un saut de ligne, un champ absent valant ''. `diag-porte-inscription`
 *   compare les deux ordres, et rejoue le vecteur du test pgTAP.
 *
 * ═══ L'ÉCHÉANCE VIT ICI — exception nommée (§D.27) ═════════════════════════
 *   Cinq minutes. La preuve est signée puis vérifiée dans la MÊME requête (la
 *   route signe, puis crée le compte) : l'échéance borne un rejeu, elle ne
 *   décide rien du produit. Même rang que le TTL du jeton OTP
 *   (lib/phone-otp-token.ts) et que le plafond de relance de §D.7.
 *
 * ═══ LE SECRET — deux copies, comme `cron_secret` ══════════════════════════
 *   `INSCRIPTION_HMAC_SECRET` (Vercel) et `inscription_hmac_secret` (Vault). Ils
 *   doivent être ÉGAUX. Rotation : docs/architecture.md §D.27.
 */
import { createHmac } from 'node:crypto'

/** L'ORDRE des champs signés après l'adresse — celui de `preuve_inscription_canonique()`. */
export const CHAMPS_SIGNES = Object.freeze([
  'role',
  'domain_slug',
  'voie',
  'piece',
  'preuve_expire_a',
  'cgu_version',
  'telephone',
  'invitation_id',
  'invitation_statuts',
  'acteur_id',
])

/** L'échéance de la preuve, en secondes (exception nommée, §D.27). */
export const ECHEANCE_PREUVE_SECONDES = 300

/**
 * La chaîne signée.
 * @param {string} email
 * @param {Record<string, string | null | undefined>} champs
 * @returns {string}
 */
export function canoniquePreuve(email, champs) {
  return [
    'v1',
    String(email ?? '').trim().toLowerCase(),
    ...CHAMPS_SIGNES.map((k) => (champs[k] == null ? '' : String(champs[k]))),
  ].join('\n')
}

/**
 * Le secret du serveur. Lève s'il manque ou s'il est trop court : sans lui, aucune
 * inscription n'aboutirait, et le dire ici vaut mieux qu'un refus IN008 en base.
 * @returns {string}
 */
export function secretPreuve() {
  const s = process.env.INSCRIPTION_HMAC_SECRET
  if (!s || s.trim().length < 32) {
    throw new Error('INSCRIPTION_HMAC_SECRET absent ou trop court (32 caractères au moins)')
  }
  return s
}

/**
 * Signe les champs d'une inscription pour une adresse. Rend les champs SIGNÉS (échéance
 * comprise) et la preuve : c'est exactement ce qui part dans les métadonnées.
 * @param {string} email
 * @param {Record<string, string | null | undefined>} champs
 * @param {{ secret?: string, maintenant?: number }} [options]
 * @returns {Record<string, string>}
 */
export function signerPreuveInscription(email, champs, options = {}) {
  const secret = options.secret ?? secretPreuve()
  const maintenant = options.maintenant ?? Date.now()
  /** @type {Record<string, string>} */
  const signes = {}
  for (const k of CHAMPS_SIGNES) signes[k] = champs[k] == null ? '' : String(champs[k])
  signes.preuve_expire_a = String(Math.floor(maintenant / 1000) + ECHEANCE_PREUVE_SECONDES)
  const preuve = createHmac('sha256', secret).update(canoniquePreuve(email, signes), 'utf8').digest('hex')
  return { ...signes, preuve }
}
