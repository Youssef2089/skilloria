/**
 * lib/pays/numero-identification.ts — LE NUMERO D'IDENTIFICATION SUIT LE PAYS.
 *
 * ═══ LE DEFAUT QU'ON FERME ════════════════════════════════════════════════
 *   Le numéro d'identification d'une entreprise était validé par `/^\d{9}$/` —
 *   neuf chiffres, le format **français** — aux DEUX bouts : dans le composant
 *   de saisie ([components/OrgSetupModal.tsx](../../components/OrgSetupModal.tsx))
 *   et dans la route serveur. Le libellé disait « SIREN », le placeholder
 *   « 123456789 », le refus « 9 chiffres attendus ».
 *
 *   Un numéro britannique (8 alphanumériques) ou un ICE marocain (15 chiffres)
 *   était donc **refusé à la saisie**, avant d'atteindre la moindre
 *   vérification. C'est le même défaut que le pays figé à « FR », un champ plus
 *   loin — et que le badge « FR » du téléphone, un écran plus loin encore.
 *
 * ═══ UNE SEULE RÈGLE, DEUX BOUTS ══════════════════════════════════════════
 *   Ce module est la SOURCE UNIQUE. Le serveur refuse (c'est lui qui fait foi,
 *   checklist), le client prévient avant l'envoi avec la MÊME fonction. Deux
 *   copies divergeraient — le dépôt en porte déjà trois preuves, et la dernière
 *   a laissé un correctif vivant sur son jumeau pendant six mois.
 *
 * ═══ ON NE REFUSE JAMAIS SUR UNE RÈGLE QU'ON N'A PAS ══════════════════════
 *   Un pays sans règle connue (`longueurMin`/`longueurMax` à NULL) ACCEPTE ce
 *   qui est saisi, et la revue humaine juge. Inventer une règle fermerait la
 *   porte à une organisation légitime pour une raison interne — exactement ce
 *   qu'on corrige.
 *
 * ⚠️ CE N'EST PAS UNE VALIDATION D'EXISTENCE. On contrôle une FORME. Qu'un
 *    numéro existe, qu'il corresponde à cette société, c'est le registre ou
 *    l'examen humain qui le disent — jamais ce module.
 */

/** La règle d'un pays, telle qu'elle vit sur `countries`. */
export type RegleNumero = {
  /** Nom du numéro dans ce pays (« SIREN »). Nom propre, jamais traduit. */
  libelle: string | null
  /** Exemple pour le placeholder. Vient du PAYS, pas de la langue. */
  exemple: string | null
  longueurMin: number | null
  longueurMax: number | null
  /** Le numéro peut-il contenir des lettres ? */
  alphanumerique: boolean
}

/**
 * Retire ce qui n'est que mise en forme : espaces, points, tirets.
 *
 * Les registres impriment leurs numéros formatés (`123 456 789`,
 * `CHE-123.456.789`). Refuser la forme lue sur un document officiel serait
 * absurde — et c'est déjà ce que faisait la route, qui retirait les espaces
 * avant de tester.
 */
export function normaliserNumeroIdentification(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[\s.\-/]/g, '').trim()
}

/**
 * Le numéro NORMALISÉ est-il acceptable pour ce pays ?
 *
 * @param numero  numéro déjà passé par `normaliserNumeroIdentification`
 * @param regle   règle du pays, ou `null` si le pays est inconnu du référentiel
 */
export function numeroIdentificationAccepte(numero: string, regle: RegleNumero | null): boolean {
  // Vide : traité par l'appelant (le numéro est facultatif à l'inscription).
  if (numero.length === 0) return true

  // AUCUNE RÈGLE CONNUE ⇒ ON ACCEPTE. Le seul garde-fou est une borne de
  // longueur absurde, qui n'est pas une règle de pays mais une protection
  // contre une saisie qui n'en est pas une.
  if (!regle || regle.longueurMin == null || regle.longueurMax == null) {
    return numero.length <= 40
  }

  if (numero.length < regle.longueurMin || numero.length > regle.longueurMax) return false

  // Jeu de caractères : chiffres seuls, ou lettres et chiffres.
  // Pas d'expression régulière venue de la base — cf. l'en-tête de la migration
  // `format_numero_identification` : une regex lue en base et exécutée ici
  // ouvrirait un risque de déni de service par retour arrière.
  return regle.alphanumerique ? /^[A-Za-z0-9]+$/.test(numero) : /^[0-9]+$/.test(numero)
}

/**
 * Lit la règle depuis une ligne de `countries`.
 *
 * ⚠️ LES CLIENTS SUPABASE NE SONT PAS TYPÉS. Une colonne renommée ou absente
 *    arriverait `undefined` sans qu'aucune erreur ne se lève — et
 *    `undefined` deviendrait « aucune règle », donc « on accepte ». C'est la
 *    bonne direction d'échec (on n'invente pas un refus), mais elle doit être
 *    VOULUE et non subie : on convertit explicitement, et un non-nombre
 *    devient `null`, pas `NaN`.
 */
export function regleDepuisLignePays(ligne: Record<string, unknown> | null | undefined): RegleNumero | null {
  if (!ligne) return null
  const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const texte = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
  return {
    libelle: texte(ligne.registre_numero_libelle),
    exemple: texte(ligne.registre_numero_exemple),
    longueurMin: nombre(ligne.registre_numero_longueur_min),
    longueurMax: nombre(ligne.registre_numero_longueur_max),
    alphanumerique: ligne.registre_numero_alphanumerique === true,
  }
}

/** Colonnes à sélectionner pour construire une `RegleNumero`. Source unique. */
export const COLONNES_REGLE_NUMERO =
  'registre_numero_libelle, registre_numero_exemple, registre_numero_longueur_min, registre_numero_longueur_max, registre_numero_alphanumerique'
