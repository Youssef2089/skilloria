/**
 * CHAQUE ÉCRITURE DU GRAND LIVRE SE LIT COMME UNE PHRASE (décision de Youssef, 01/10/2026, ARRÊT 22, §D.33).
 *
 * « Vérification conclue » ne disait ni QUI, ni QUEL profil, ni le RÉSULTAT ; la liste montrait des clés (`motif`,
 * `de`) et des codes (`note_insuffisante`). Une personne non technique qui ne connaît pas la plateforme doit lire :
 * « La plateforme a vérifié le profil de Mehdi Ben ayed : note 6/10, sous la note d’approbation automatique, envoyé
 * en revue manuelle. » — qui, quoi, sur quoi (nommé), et le résultat ; dans sa langue.
 *
 * LES CODES EN BASE NE CHANGENT PAS (renommage reporté par Youssef le 26/09/2026) : seul l'AFFICHAGE change. Ce module
 * traduit une ligne en une PHRASE — une clé de traduction et ses arguments typés — puis la rend avec le traducteur de
 * l'écran. Aucun code n'atteint l'écran : un code se traduit par sa DIMENSION (`journal.valeurs.<dimension>.<code>`),
 * un code inconnu devient « une autre information » (jamais le code), un objet se nomme par `libelles_journal()`
 * (relu à l'affichage, jamais écrit au journal : §D.26), ou par son nom commun (« un profil effacé »).
 *
 * ⚠️ MODULE PUR, SANS IMPORT : `diag-journal-lisible` l'EXÉCUTE pour chaque action, dans les quatre langues, avec des
 *    valeurs fabriquées — et rougit sur un code brut, un nom de champ, un identifiant ou un mot propre à la plateforme
 *    non expliqué. Une phrase qui ne se rend pas n'est pas « à peu près lisible » : elle est fausse.
 * ⚠️ Les lignes ANCIENNES ont d'autres formes (clés absentes, actions retirées) : chaque phrase tolère l'absence et
 *    retombe sur une variante plus courte, jamais sur une clé.
 */

export type ReferenceObjet = { type: string; id: string }
export type NomObjet = { nom: string | null; contexte: string | null }
/** Les noms relus par `libelles_journal()`, par `type:id`. */
export type NomsJournal = Record<string, NomObjet>
export const cleObjet = (type: string, id: string): string => `${type}:${id}`

export type LignePhrase = {
  type_action: string
  statut: string
  origine: string
  acteur_id: string | null
  acteur_nom?: string | null
  acteur_supprime?: boolean
  sujet_type: string | null
  sujet_id: string | null
  detail: Record<string, unknown> | null
}

/**
 * LES DIMENSIONS — chaque famille de codes qu'une phrase traduit, avec la liste des codes CONNUS. Chaque code a son
 * libellé dans `journal.valeurs.<dimension>.<code>`, dans les quatre langues (gardé par `diag-journal-lisible`, qui
 * recoupe aussi plusieurs listes avec leur source dans le code : champs, tâches, événements, types de compte…).
 */
export const DIMENSIONS = {
  type_annonce: ['mission', 'offre', 'sous_traitance'],
  // `work_mode` et `duration` restent : les lignes écrites avant le 03/10/2026 les nomment. Les critères qui les
  // remplacent (§D.39) suivent.
  champ_annonce: ['title', 'description', 'skills_required', 'seniorities', 'work_mode', 'location_note', 'duration',
    'start_date', 'budget_min', 'budget_max', 'branch_id', 'speciality_ids', 'speciality_other', 'confidential', 'work_zone_ids',
    'work_modes', 'jours_sur_site', 'jours_teletravail', 'temps_travail', 'duree_valeur', 'duree_unite'],
  champ_profil: ['title', 'summary', 'seniorities', 'years_experience', 'skills', 'certifications', 'languages', 'location',
    'work_modes', 'temps_travail', 'tjm_min', 'tjm_max', 'availability_date', 'linkedin_url', 'phone', 'address_line', 'postal_code', 'city',
    'country', 'birth_year', 'photo_url', 'years_total_experience', 'availability_status', 'branch_id', 'speciality_ids',
    'speciality_other', 'work_zone_ids', 'cdi_status', 'cdi_notice_period', 'cdi_availability_date', 'cdi_confidential_mode',
    'cdi_salary_min', 'cdi_salary_max', 'cdi_variable_pct', 'cdi_benefits', 'cdi_company_size', 'cdi_sectors',
    'cdi_geo_mobility', 'cdi_contract_types', 'cdi_motivations', 'cdi_career_goals',
    // les listes (« blocs ») du profil
    'experiences', 'educations', 'languages_structured', 'formations', 'langues'],
  champ_dispo: ['availability_status', 'cdi_status', 'open_to_cdi', 'open_to_freelance'],
  valeur_dispo: ['available', 'do_not_disturb', 'employed', 'open_to_work', 'true', 'false', 'aucune'],
  nature_travail: ['analyse_cv', 'verification_expert'],
  code_travail: ['profil_illisible', 'profil_introuvable', 'compte_illisible', 'voie_inconnue', 'document_absent',
    'stockage_illisible', 'referentiel_illisible', 'quota_non_configure', 'quota_illisible', 'plafond_depense',
    'ecriture_en_panne', 'modele_indisponible', 'configuration', 'document_refuse', 'reponse_illisible',
    'configuration_illisible', 'specialites_illisibles', 'exception_interne', 'delai_depasse', 'non_execute'],
  raison_ineligible: ['profil_non_visible', 'cv_non_analyse', 'consentement_absent', 'profil_non_approuve', 'compte_suspendu',
    'compte_en_suppression', 'compte_anonymise', 'ne_pas_deranger', 'non_en_recherche'],
  etape_recherche: ['lecture', 'reglages', 'vivier', 'filtrage', 'notation', 'correspondances'],
  cause_recherche: ['lecture_en_panne', 'introuvable', 'reglages_absents', 'durees_illisibles', 'vivier_en_panne',
    'decisions_illisibles', 'annonce_sans_matiere', 'notation_arretee', 'lots_en_echec', 'reconciliation_en_panne'],
  arret_notation: ['interrupteur_ferme', 'cle_absente', 'aucun_document', 'plafond_atteint'],
  type_compte: ['expert_freelance', 'expert_cdi', 'client', 'cabinet', 'admin'],
  voie: ['inscription_expert', 'preinscription_organisation', 'invitation', 'administrateur'],
  org_type: ['client', 'cabinet', 'esn'],
  motif_verification: ['note_suffisante', 'note_insuffisante', 'drapeau_bloquant', 'travail_echoue', 'config_non_configure',
    'config_ambigu', 'config_incomplet', 'domaine_sans_nom', 'consentement_absent', 'cv_non_analyse', 'plafond_ia',
    'configuration', 'document_refuse', 'reponse_illisible', 'modele_indisponible'],
  champ_identite: ['first_name', 'last_name'],
  role_org: ['admin', 'editor', 'viewer'],
  champ_organisation: ['company_name', 'sector', 'size', 'description', 'website_url', 'country'],
  periode_paiement: ['monthly', 'yearly', 'one_time'],
  action_ia: ['matching_pool', 'cv_parsing', 'candidature_assessment', 'pitch', 'expert_verification', 'org_verification',
    'publication_quality'],
  reglage: ['duree_reglages', 'ai_model_tarifs', 'ai_spend_caps', 'ai_spend_seuils_acteur', 'ai_quotas', 'matching_settings',
    'verification_providers', 'packages_default', 'grand_livre_conservation', 'blocked_email_domains', 'public_email_domains',
    'packages', 'organizations', 'packages_stripe'],
  cle_reglage: ['vie_annonce_jours', 'fenetre_echange_jours', 'invitation_jours', 'conservation_ip_mois',
    'usd_par_1m_entree', 'usd_par_1m_sortie', 'usd_par_unite', 'usd_par_recherche', 'usd_par_recherche_web',
    'claude', 'rerank', 'organization', 'profile', 'max_per_window', 'window_hours',
    'feed_threshold', 'notify_threshold', 'notify_enabled', 'rerank_model', 'rerank_batch_size', 'note',
    'name', 'slug', 'target_role', 'price_monthly', 'price_yearly', 'currency', 'active', 'is_free', 'is_default', 'scope',
    'package_started_at', 'package_valid_until', 'conservation_mois', 'plancher_mois', 'actif'],
  valeur_reglage: ['expert_freelance', 'expert_cdi', 'client', 'cabinet', 'all', 'organization', 'user', 'organization_per_seat'],
  note_de: ['experts', 'entreprises', 'annonces'],
  champ_plafond_compte: ['seuil_mensuel_usd', 'plafond_mensuel_usd'],
  mode_paiement: ['test', 'live'],
  liste_domaines: ['bloques', 'publics'],
  objet_taxo: ['branche', 'specialite'],
  champ_taxo: ['name', 'active', 'sort_order', 'slug'],
  langue: ['fr', 'en', 'es', 'de'],
  champ_ecosysteme: ['name', 'ecosystem_name', 'tagline', 'description', 'active', 'launch_date', 'couleur_fond_page',
    'couleur_bandeau', 'couleur_cartes', 'couleur_bordures', 'couleur_texte_principal', 'couleur_texte_secondaire',
    'primary_color', 'accent_color', 'secondary_color', 'ecosystem_expert_label', 'ecosystem_community_label',
    'ecosystem_speciality_label', 'ecosystem_domain_search_label', 'tags', 'logo_url', 'favicon_url'],
  visuel: ['logo', 'favicon'],
  tache: ['constats_trigger', 'cron_run_log_purge', 'cron_run_reconcile', 'expert_relance_trigger', 'ip_retention_purge',
    'matching_notes_partielles_purge', 'matching_retry_trigger', 'purge_deletions_trigger', 'purge_inactive_trigger',
    'rate_limit_hits_purge', 'stripe_reconcile_trigger', 'travaux_ia_pilote'],
  cause_avertissement: ['origine_inconnaissable', 'sans_email', 'lien_sans_ecosysteme', 'exception', 'missing_env',
    'invalid_to', 'resend_error', 'timeout'],
  famille: ['annonce', 'profil', 'recherche', 'candidature', 'devoilement', 'messagerie', 'compte', 'organisation',
    'commerce', 'administration', 'rgpd', 'journal', 'refus'],
  evenement: ['new_match_opportunity', 'new_candidature_received', 'new_message'],
  cause_depot: ['plafond', 'modele_indisponible', 'reponse_illisible'],
  effacement: ['profil_anonymise', 'cv_supprime', 'avatar_supprime'],
  // les journaux détaillés d'un geste (écran des écritures liées)
  canal_notification: ['email', 'inapp', 'both', 'sms'],
  statut_notification: ['pending', 'sent', 'failed', 'read'],
} as const
export type Dim = keyof typeof DIMENSIONS

/** Les types d'objet qu'une phrase sait désigner (`journal.designe.<type>`, `journal.designe_absent.<type>`). */
export const OBJETS = ['users', 'profiles', 'organizations', 'publications', 'candidatures', 'matches', 'candidature_depots',
  'organization_invitations', 'organization_members', 'domains', 'packages', 'branches', 'specialities',
  'expert', 'membre'] as const
export type TypeObjet = (typeof OBJETS)[number]

/** Les types qui désignent une PERSONNE : seuls eux peuvent exister sans nom (`journal.designe_sans_nom.<type>`). */
export const OBJETS_PERSONNE = ['users', 'profiles', 'expert', 'membre'] as const

type Arg =
  | { k: 'n'; v: number }
  | { k: 'texte'; v: string }
  | { k: 'code'; dim: Dim; v: unknown }
  | { k: 'codes'; dim: Dim; v: unknown }
  | { k: 'objet'; type: TypeObjet; ref: ReferenceObjet | null; role: 'nom' | 'contexte' }
  | { k: 'date'; v: string }
  | { k: 'argent'; v: number; devise: string }
  | { k: 'qui'; milieu?: boolean }
  | { k: 'sous'; phrase: Phrase }
  | { k: 'liste'; elements: Phrase[] }

export type Phrase = { cle: string; args?: Record<string, Arg> }

// ─── Les petites lectures, tolérantes : une ligne ancienne peut manquer de n'importe quelle clé ────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const chaine = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const vrai = (v: unknown): boolean => v === true
const liste = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v : null)
const dateIso = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null)

const n = (v: number): Arg => ({ k: 'n', v })
const code = (dim: Dim, v: unknown): Arg => ({ k: 'code', dim, v })
const codes = (dim: Dim, v: unknown): Arg => ({ k: 'codes', dim, v })
const qui: Arg = { k: 'qui' }
const sous = (phrase: Phrase): Arg => ({ k: 'sous', phrase })

/** L'objet SUJET de la ligne, désigné (« le profil de Mehdi Ben ayed », « l’annonce « X » »). */
function sujet(l: LignePhrase, type?: TypeObjet, role: 'nom' | 'contexte' = 'nom'): Arg {
  const t = (type ?? l.sujet_type ?? 'users') as TypeObjet
  return { k: 'objet', type: t, ref: l.sujet_type && l.sujet_id ? { type: l.sujet_type, id: l.sujet_id } : null, role }
}
/** Un objet cité par son identifiant dans le détail. */
function objet(type: TypeObjet, sujetType: string, id: unknown, role: 'nom' | 'contexte' = 'nom'): Arg {
  const i = uuid(id)
  return { k: 'objet', type, ref: i ? { type: sujetType, id: i } : null, role }
}

/** Un geste fait par un utilisateur sur son PROPRE compte ou profil (l'origine `utilisateur` ne touche que le sien). */
const surSoi = (l: LignePhrase) => l.origine === 'utilisateur' && l.acteur_id != null

/** Les références que les phrases nomment — `libelles_journal()` les relit (lib/journal/libelles.ts). */
export function referencesDe(l: Pick<LignePhrase, 'type_action' | 'sujet_type' | 'sujet_id' | 'detail'>): ReferenceObjet[] {
  const refs: ReferenceObjet[] = []
  if (l.sujet_type && uuid(l.sujet_id)) refs.push({ type: l.sujet_type, id: l.sujet_id as string })
  const d = l.detail ?? {}
  const ajouter = (type: string, v: unknown) => { const i = uuid(v); if (i) refs.push({ type, id: i }) }
  ajouter('publications', d.publication_id)
  ajouter('organizations', d.organization_id)
  ajouter('profiles', d.profile_id)
  ajouter('users', d.membre_user_id)
  ajouter('packages', d.package_id)
  return refs
}

/** La recherche, désignée selon ce qu'elle cherche : des missions pour un profil, des experts pour une annonce. */
function recherche(l: LignePhrase): Arg {
  if (l.sujet_type === 'publications') return sous({ cle: '_recherche.annonce', args: { annonce: sujet(l, 'publications') } })
  if (surSoi(l)) return sous({ cle: '_recherche.profil_soi' })
  return sous({ cle: '_recherche.profil', args: { profil: sujet(l, 'profiles') } })
}
/** « annonces examinées » (une recherche pour un profil) ou « profils examinés » (une recherche pour une annonce). */
const versant = (l: LignePhrase) => (l.sujet_type === 'publications' ? 'profils' : 'annonces')

/**
 * Les compteurs d'une recherche — l'exemple validé : « 14 annonces examinées, 3 retenues dont 1 forte ». Examinées,
 * retenues et FORTES sont exigées (sinon `null`, la phrase simple) ; les NOTIFICATIONS ne le sont pas : une recherche
 * qui n'a prévenu personne n'écrit pas `notifiees`, et « aucune notification envoyée » est alors exact (relecture du
 * 01/10/2026, point 14 — la phrase retombait sur « terminée normalement », et disait « nouvelles » au lieu de « fortes »).
 */
function compteurs(d: Record<string, unknown>): Record<string, Arg> | null {
  const exigees = ['examinees', 'retenues', 'fortes'] as const
  const v = exigees.map((c) => nombre(d[c]))
  if (v.some((x) => x === null)) return null
  return { ...Object.fromEntries(exigees.map((c, i) => [c, n(v[i] as number)])), notifiees: n(nombre(d.notifiees) ?? 0) }
}

/** Les champs modifiés d'un réglage — « durée de vie d’une annonce : de 30 à 45 » ; une valeur illisible n'est pas montrée. */
function changementsReglage(d: Record<string, unknown>): Phrase[] {
  const avant = (d.avant && typeof d.avant === 'object' && !Array.isArray(d.avant) ? d.avant : {}) as Record<string, unknown>
  const apres = (d.apres && typeof d.apres === 'object' && !Array.isArray(d.apres) ? d.apres : {}) as Record<string, unknown>
  const connues = DIMENSIONS.cle_reglage as readonly string[]
  const sorties: Phrase[] = []
  for (const cle of new Set([...Object.keys(avant), ...Object.keys(apres)])) {
    if (!connues.includes(cle)) continue
    const a = valeurReglage(avant[cle])
    const b = valeurReglage(apres[cle])
    if (a === undefined || b === undefined) continue
    if (JSON.stringify(avant[cle] ?? null) === JSON.stringify(apres[cle] ?? null)) continue
    sorties.push({ cle: '_changement', args: { champ: code('cle_reglage', cle), avant: a, apres: b } })
  }
  return sorties
}
/** Une valeur de réglage affichable — `undefined` : elle ne s'affiche pas (identifiant, liste, objet). */
function valeurReglage(v: unknown): Arg | undefined {
  if (v === null || v === undefined) return sous({ cle: '_vide' })
  if (typeof v === 'boolean') return sous({ cle: v ? '_oui' : '_non' })
  if (typeof v === 'number') return n(v)
  if (typeof v === 'string') {
    if (UUID.test(v)) return undefined
    if ((DIMENSIONS.valeur_reglage as readonly string[]).includes(v)) return code('valeur_reglage', v)
    if (/^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v))) return { k: 'date', v }
    if (/^-?\d+(\.\d+)?$/.test(v)) return n(Number(v))
    if (/_/.test(v)) return undefined
    return { k: 'texte', v }
  }
  return undefined
}

/** Le détail d'un effacement de compte : « profil anonymisé, CV supprimé, photo supprimée ». */
function effacements(d: Record<string, unknown>): string[] {
  return (DIMENSIONS.effacement as readonly string[]).filter((c) => vrai(d[c]))
}

/** Les traductions d'un écosystème (« domains.name.en ») : le champ et la langue, lisibles. */
function traductionsEcosysteme(v: unknown): Phrase[] {
  return liste(v).map((t) => {
    const [, champ, langue] = t.split('.')
    return { cle: '_traduction', args: { champ: code('champ_ecosysteme', champ), langue: code('langue', langue) } }
  })
}

/**
 * LA PHRASE D'UNE LIGNE. Une action sans phrase propre retombe sur `_generique` (« {action} : {objet} ») — et le
 * contrôle exige qu'AUCUNE action n'y tombe : chaque action a sa phrase.
 */
export function phraseDe(l: LignePhrase): Phrase {
  const d = (l.detail ?? {}) as Record<string, unknown>
  const echec = l.statut !== 'reussi'
  switch (l.type_action) {
    // ── Annonces ──
    case 'annonce_creee':
      return { cle: 'annonce_creee', args: { qui, annonce: sujet(l, 'publications'), type: code('type_annonce', d.type ?? 'mission') } }
    case 'sous_traitance_creee':
      return { cle: 'sous_traitance_creee', args: { qui, annonce: sujet(l, 'publications') } }
    case 'annonce_publiee':
    case 'sous_traitance_publiee': {
      const note = nombre(d.verification_score)
      // La voie ADMINISTRATEUR (lot S3) : l'annonce était en revue, un administrateur l'a validée. Une ligne ancienne
      // n'a pas de voie : elle se lit comme une publication directe, ce qu'elle était.
      if (d.voie === 'administrateur') {
        return note === null
          ? { cle: `${l.type_action}.validee`, args: { qui, annonce: sujet(l, 'publications') } }
          : { cle: `${l.type_action}.validee_note`, args: { qui, annonce: sujet(l, 'publications'), note: n(note) } }
      }
      return note === null
        ? { cle: `${l.type_action}.simple`, args: { qui, annonce: sujet(l, 'publications') } }
        : { cle: `${l.type_action}.note`, args: { qui, annonce: sujet(l, 'publications'), note: n(note) } }
    }
    case 'annonce_refusee': {
      // Le motif n'est jamais au journal (texte libre) : la phrase dit qu'il a été transmis, pas ce qu'il dit.
      const note = nombre(d.verification_score)
      const genre = d.type === 'sous_traitance' ? 'sous_traitance' : 'annonce'
      return note === null
        ? { cle: `annonce_refusee.${genre}`, args: { qui, annonce: sujet(l, 'publications') } }
        : { cle: `annonce_refusee.${genre}_note`, args: { qui, annonce: sujet(l, 'publications'), note: n(note) } }
    }
    case 'annonce_modifiee': {
      const champs = liste(d.champs)
      return champs.length
        ? { cle: 'annonce_modifiee.champs', args: { qui, annonce: sujet(l, 'publications'), champs: codes('champ_annonce', champs) } }
        : { cle: 'annonce_modifiee.simple', args: { qui, annonce: sujet(l, 'publications') } }
    }
    case 'annonce_depubliee':
      return { cle: 'annonce_depubliee', args: { qui, annonce: sujet(l, 'publications') } }
    case 'annonce_expiree': {
      const jours = nombre(d.vie_annonce_jours)
      return jours === null
        ? { cle: 'annonce_expiree.simple', args: { qui, annonce: sujet(l, 'publications') } }
        : { cle: 'annonce_expiree.jours', args: { qui, annonce: sujet(l, 'publications'), jours: n(jours) } }
    }

    // ── Profils ──
    case 'cv_televerse': {
      const soi = surSoi(l) ? 'soi' : 'autre'
      if (echec || d.analyse === 'failed') return { cle: `cv_televerse.echec_${soi}`, args: { qui, profil: sujet(l, 'profiles') } }
      const e = nombre(d.experiences), f = nombre(d.formations), g = nombre(d.langues)
      return e !== null && f !== null && g !== null
        ? { cle: `cv_televerse.lu_${soi}`, args: { qui, profil: sujet(l, 'profiles'), experiences: n(e), formations: n(f), langues: n(g) } }
        : { cle: `cv_televerse.simple_${soi}`, args: { qui, profil: sujet(l, 'profiles') } }
    }
    case 'profil_publie':
      return { cle: surSoi(l) ? 'profil_publie.soi' : 'profil_publie.autre', args: { qui, profil: sujet(l, 'profiles') } }
    case 'profil_modifie': {
      const champs = [...liste(d.champs), ...liste(d.blocs)]
      const soi = surSoi(l) ? 'soi' : 'autre'
      return champs.length
        ? { cle: `profil_modifie.champs_${soi}`, args: { qui, profil: sujet(l, 'profiles'), champs: codes('champ_profil', champs) } }
        : { cle: `profil_modifie.simple_${soi}`, args: { qui, profil: sujet(l, 'profiles') } }
    }
    case 'disponibilite_basculee': {
      const v = (x: unknown) => (x === null || x === undefined ? 'aucune' : String(x))
      return { cle: surSoi(l) ? 'disponibilite_basculee.soi' : 'disponibilite_basculee.autre', args: {
        qui, profil: sujet(l, 'profiles'), champ: code('champ_dispo', d.champ),
        de: code('valeur_dispo', v(d.de)), vers: code('valeur_dispo', v(d.vers)),
      } }
    }
    case 'photo_deposee': {
      const quoi = vrai(d.remplacement) ? 'remplacement' : 'depot'
      return { cle: `photo_deposee.${quoi}_${surSoi(l) ? 'soi' : 'autre'}`, args: { qui, profil: sujet(l, 'profiles') } }
    }
    case 'cv_consulte':
      return { cle: 'cv_consulte', args: { qui, profil: sujet(l, 'profiles') } }
    case 'cv_reinitialise':
      return { cle: vrai(d.retire_de_la_vitrine) ? 'cv_reinitialise.vitrine' : 'cv_reinitialise.simple', args: { qui, profil: sujet(l, 'profiles') } }
    case 'travail_ia_echoue': {
      const t = nombre(d.tentatives)
      return { cle: t === null ? 'travail_ia_echoue.simple' : 'travail_ia_echoue.tentatives', args: {
        qui, nature: code('nature_travail', d.nature), profil: sujet(l, 'profiles'), code: code('code_travail', d.code ?? d.code_origine),
        ...(t === null ? {} : { tentatives: n(t) }),
      } }
    }
    case 'travail_ia_relance':
      return { cle: 'travail_ia_relance', args: {
        qui, nature: code('nature_travail', d.nature), profil: sujet(l, 'profiles'), code: code('code_travail', d.code_origine ?? d.code),
      } }

    // ── Recherche ──
    case 'recherche_terminee': {
      const issue = chaine(d.issue) ?? 'ok'
      if (issue === 'ineligible') return { cle: 'recherche_terminee.ineligible', args: { qui, recherche: recherche(l), raison: code('raison_ineligible', d.raison) } }
      if (issue === 'vivier_vide') return { cle: `recherche_terminee.vivier_vide_${versant(l)}`, args: { qui, recherche: recherche(l) } }
      if (issue === 'annonce_expiree' || issue === 'sans_matiere') return { cle: `recherche_terminee.${issue}`, args: { qui, recherche: recherche(l) } }
      const c = compteurs(d)
      return c
        ? { cle: `recherche_terminee.ok_${versant(l)}`, args: { qui, recherche: recherche(l), ...c } }
        : { cle: 'recherche_terminee.ok_simple', args: { qui, recherche: recherche(l) } }
    }
    case 'recherche_echouee':
    case 'recherche_abandonnee': {
      const pourquoi = chaine(d.arret)
        ? code('arret_notation', d.arret)
        : code('cause_recherche', d.cause)
      const t = nombre(l.type_action === 'recherche_abandonnee' ? d.tentatives : d.tentative)
      return { cle: `${l.type_action}.${t === null ? 'simple' : 'tentatives'}`, args: {
        qui, recherche: recherche(l), etape: code('etape_recherche', d.etape), pourquoi, ...(t === null ? {} : { tentatives: n(t) }),
      } }
    }
    // Retirées (ARRÊT 22) — les lignes anciennes restent lisibles.
    case 'recherche_lancee':
      return { cle: 'recherche_lancee', args: { qui, recherche: recherche(l) } }
    case 'recherche_filtree':
    case 'recherche_classee':
    case 'recherche_correspondances':
    case 'recherche_notifiee':
      return { cle: l.type_action, args: { recherche: recherche(l) } }

    // ── Candidatures ── (la candidature : son annonce en nom, son expert en contexte)
    case 'candidature_deposee':
    case 'sous_traitance_candidature': {
      const note = nombre(d.ai_match_score)
      const relance = d.origine_depot === 'relance_admin' ? 'relance' : 'expert'
      return { cle: `${l.type_action}.${relance}_${note === null ? 'simple' : 'note'}`, args: {
        qui, annonce: sujet(l, 'candidatures'), expert: sujet(l, 'expert', 'contexte'), ...(note === null ? {} : { note: n(note) }),
      } }
    }
    case 'candidature_declinee':
      return { cle: vrai(d.has_reason) ? 'candidature_declinee.raison' : 'candidature_declinee.simple', args: {
        qui, annonce: sujet(l, 'candidatures'), expert: sujet(l, 'expert', 'contexte'),
      } }
    case 'candidature_retenue':
      return { cle: 'candidature_retenue', args: { qui, annonce: sujet(l, 'candidatures'), expert: sujet(l, 'expert', 'contexte') } }
    case 'mission_ecartee':
      return { cle: 'mission_ecartee', args: { qui, annonce: sujet(l, 'matches') } }

    // ── Coordonnées ──
    case 'devoilement_ouvert':
      return { cle: vrai(d.auto) ? 'devoilement_ouvert.auto' : 'devoilement_ouvert.main', args: {
        qui, annonce: sujet(l, 'candidatures'), expert: sujet(l, 'expert', 'contexte'),
      } }
    case 'devoilement_ferme':
      return { cle: 'devoilement_ferme', args: { qui, annonce: sujet(l, 'candidatures'), expert: sujet(l, 'expert', 'contexte') } }
    case 'message_envoye':
      return { cle: 'message_envoye', args: { qui } }

    // ── Comptes ──
    case 'compte_cree': {
      const tel = d.telephone_verifie === true ? '_tel' : d.telephone_verifie === false ? '_sans_tel' : ''
      if (d.voie_declaree === 'administrateur' || !surSoi(l)) {
        return { cle: 'compte_cree.autre', args: { qui, compte: sujet(l, 'users'), type: code('type_compte', d.type_de_compte) } }
      }
      return { cle: `compte_cree.soi${tel}`, args: { qui, type: code('type_compte', d.type_de_compte), voie: code('voie', d.voie_declaree) } }
    }
    case 'expert_inscrit': {
      const nb = nombre(d.nb_specialites)
      return { cle: nb === null ? 'expert_inscrit.simple' : vrai(d.specialite_autre) ? 'expert_inscrit.autre_specialite' : 'expert_inscrit.specialites', args: {
        qui, ...(nb === null ? {} : { specialites: n(nb) }),
      } }
    }
    case 'organisation_preinscrite':
      return { cle: vrai(d.domaine_public) ? 'organisation_preinscrite.adresse_publique' : 'organisation_preinscrite.simple', args: {
        qui, organisation: sujet(l, 'organizations'), type: code('org_type', d.org_type),
      } }
    case 'compte_valide':
    case 'compte_refuse':
      return { cle: `${l.type_action}.${vrai(d.has_reason) ? 'raison' : 'simple'}`, args: {
        qui, objet: sujet(l, l.sujet_type === 'organizations' ? 'organizations' : 'profiles'),
      } }
    case 'verification_conclue': {
      const note = nombre(d.note)
      const issue = d.approuve === true ? 'approuve' : 'revue'
      return { cle: `verification_conclue.${issue}_${note === null ? 'simple' : 'note'}`, args: {
        qui, profil: sujet(l, 'profiles'), motif: code('motif_verification', d.motif), ...(note === null ? {} : { note: n(note) }),
      } }
    }
    case 'compte_suspendu':
    case 'compte_reactive':
      return { cle: l.type_action, args: { qui, compte: sujet(l, 'users') } }
    case 'session_revoquee':
    case 'mot_de_passe_change':
      return { cle: l.type_action, args: { qui } }
    case 'suppression_programmee': {
      const quand = dateIso(d.echeance)
      return quand
        ? { cle: 'suppression_programmee.date', args: { qui, date: { k: 'date', v: quand } } }
        : { cle: 'suppression_programmee.simple', args: { qui } }
    }
    case 'suppression_annulee':
      return { cle: vrai(d.visibilite_restauree) ? 'suppression_annulee.visible' : 'suppression_annulee.simple', args: { qui } }
    case 'email_change':
      return { cle: d.etape === 'confirme' ? 'email_change.confirme' : 'email_change.demande', args: { qui } }
    case 'telephone_verifie':
      return { cle: 'telephone_verifie', args: { qui } }
    case 'identite_modifiee': {
      const champs = liste(d.champs)
      return champs.length
        ? { cle: 'identite_modifiee.champs', args: { qui, champs: codes('champ_identite', champs) } }
        : { cle: 'identite_modifiee.simple', args: { qui } }
    }

    // ── Organisations ── (une invitation ou un membre : l'organisation en nom ; un membre : son nom en contexte)
    case 'membre_invite':
      return { cle: vrai(d.email_already_exists) ? 'membre_invite.compte_existant' : 'membre_invite.simple', args: {
        qui, organisation: sujet(l, 'organization_invitations'), role: code('role_org', d.role_in_org),
      } }
    case 'invitation_renvoyee':
    case 'invitation_revoquee':
      return { cle: l.type_action, args: { qui, organisation: sujet(l, 'organization_invitations') } }
    case 'invitation_acceptee':
      return { cle: vrai(d.reintegre) ? 'invitation_acceptee.retour' : vrai(d.deja_membre) ? 'invitation_acceptee.deja' : 'invitation_acceptee.simple', args: {
        qui, organisation: sujet(l, 'organization_invitations'), role: code('role_org', d.role_in_org),
      } }
    case 'membre_retire':
      return { cle: 'membre_retire', args: { qui, organisation: sujet(l, 'organization_members'), membre: sujet(l, 'membre', 'contexte') } }
    case 'membre_parti':
      return { cle: 'membre_parti', args: { qui, organisation: sujet(l, 'organization_members') } }
    case 'role_membre_change':
      return { cle: 'role_membre_change', args: {
        qui, organisation: sujet(l, 'organization_members'), membre: sujet(l, 'membre', 'contexte'),
        de: code('role_org', d.role_de), vers: code('role_org', d.role_vers),
      } }
    case 'organisation_modifiee': {
      if (d.operation === 'logo_depose' || d.operation === 'logo_retire') {
        return { cle: `organisation_modifiee.${d.operation}`, args: { qui, organisation: sujet(l, 'organizations') } }
      }
      const champs = liste(d.champs)
      return champs.length
        ? { cle: 'organisation_modifiee.champs', args: { qui, organisation: sujet(l, 'organizations'), champs: codes('champ_organisation', champs) } }
        : { cle: 'organisation_modifiee.simple', args: { qui, organisation: sujet(l, 'organizations') } }
    }

    // ── Commerce ──
    case 'paiement_recu': {
      const montant = nombre(d.montant)
      const devise = chaine(d.devise)
      return montant !== null && devise
        ? { cle: 'paiement_recu.montant', args: { qui, organisation: sujet(l, 'organizations'), montant: { k: 'argent', v: montant, devise }, periode: code('periode_paiement', d.periode) } }
        : { cle: 'paiement_recu.simple', args: { qui, organisation: sujet(l, 'organizations') } }
    }
    case 'plafond_atteint':
    case 'refus_plafond_atteint': {
      const depense = nombre(d.depense_mois_usd), plafond = nombre(d.plafond_mensuel_usd)
      const global = d.portee === 'global' || l.sujet_type === 'ai_spend_caps'
      const montants = depense !== null && plafond !== null
      const args: Record<string, Arg> = { qui: { k: 'qui', milieu: true }, action: code('action_ia', d.action) }
      if (!global) args.objet = sujet(l, l.sujet_type === 'organizations' ? 'organizations' : 'profiles')
      if (montants) { args.depense = { k: 'argent', v: depense as number, devise: 'USD' }; args.plafond = { k: 'argent', v: plafond as number, devise: 'USD' } }
      return { cle: `${l.type_action}.${global ? 'global' : 'compte'}_${montants ? 'montants' : 'simple'}`, args }
    }
    case 'evenement_stripe_rouvert': {
      const recu = dateIso(d.recu_le)
      return recu
        ? { cle: 'evenement_stripe_rouvert.date', args: { qui, date: { k: 'date', v: recu } } }
        : { cle: 'evenement_stripe_rouvert.simple', args: { qui } }
    }

    // ── Administration ──
    case 'reglage_modifie': {
      const quoi = reglageDesigne(l, d)
      if (echec) return { cle: 'reglage_modifie.echec', args: { qui, reglage: quoi } }
      const ch = changementsReglage(d)
      return ch.length
        ? { cle: 'reglage_modifie.changements', args: { qui, reglage: quoi, changements: { k: 'liste', elements: ch } } }
        : { cle: 'reglage_modifie.simple', args: { qui, reglage: quoi } }
    }
    case 'taxonomie_modifiee': {
      const type: TypeObjet = d.objet === 'specialite' || l.sujet_type === 'specialities' ? 'specialities' : 'branches'
      const op = d.operation === 'creee' || d.operation === 'supprimee' ? d.operation : 'modifiee'
      if (op !== 'modifiee') return { cle: `taxonomie_modifiee.${op}`, args: { qui, objet: sujet(l, type) } }
      const champs = liste(d.champs), langues = liste(d.traductions)
      return champs.length || langues.length
        ? { cle: 'taxonomie_modifiee.modifiee', args: { qui, objet: sujet(l, type), changements: { k: 'liste', elements: [
            ...champs.map((c): Phrase => ({ cle: '_champ', args: { champ: code('champ_taxo', c) } })),
            ...langues.map((c): Phrase => ({ cle: '_traduction_nom', args: { langue: code('langue', c) } })),
          ] } } }
        : { cle: 'taxonomie_modifiee.simple', args: { qui, objet: sujet(l, type) } }
    }
    case 'ecosysteme_cree':
      return chaine(d.slug) && !/_/.test(d.slug as string)
        ? { cle: 'ecosysteme_cree.adresse', args: { qui, ecosysteme: sujet(l, 'domains'), adresse: { k: 'texte', v: d.slug as string } } }
        : { cle: 'ecosysteme_cree.simple', args: { qui, ecosysteme: sujet(l, 'domains') } }
    case 'ecosysteme_modifie': {
      const op = chaine(d.operation) ?? 'modification'
      if (op === 'activation' || op === 'desactivation') {
        // OUVRIR EN RENOMMANT : les deux se disent (relecture du 01/10/2026, point 17) — la ligne porte l'ouverture
        // ET les autres champs ; la phrase ne taisait que le second.
        const autres: Phrase[] = [
          ...liste(d.champs).filter((c) => c !== 'active').map((c): Phrase => ({ cle: '_champ', args: { champ: code('champ_ecosysteme', c) } })),
          ...traductionsEcosysteme(d.traductions),
        ]
        return autres.length
          ? { cle: `ecosysteme_modifie.${op}_et_modification`, args: { qui, ecosysteme: sujet(l, 'domains'), changements: { k: 'liste', elements: autres } } }
          : { cle: `ecosysteme_modifie.${op}`, args: { qui, ecosysteme: sujet(l, 'domains') } }
      }
      if (op === 'visuel_depose' || op === 'visuel_retire') return { cle: `ecosysteme_modifie.${op}`, args: { qui, ecosysteme: sujet(l, 'domains'), visuel: code('visuel', d.visuel) } }
      if (op === 'sous_domaine') {
        const sd = (d.sous_domaine ?? {}) as Record<string, unknown>
        return chaine(sd.avant) && chaine(sd.apres)
          ? { cle: 'ecosysteme_modifie.adresse', args: { qui, ecosysteme: sujet(l, 'domains'), avant: { k: 'texte', v: sd.avant as string }, apres: { k: 'texte', v: sd.apres as string } } }
          : { cle: 'ecosysteme_modifie.adresse_simple', args: { qui, ecosysteme: sujet(l, 'domains') } }
      }
      const elements: Phrase[] = [
        ...liste(d.champs).map((c): Phrase => ({ cle: '_champ', args: { champ: code('champ_ecosysteme', c) } })),
        ...traductionsEcosysteme(d.traductions),
      ]
      return elements.length
        ? { cle: 'ecosysteme_modifie.modification', args: { qui, ecosysteme: sujet(l, 'domains'), changements: { k: 'liste', elements } } }
        : { cle: 'ecosysteme_modifie.simple', args: { qui, ecosysteme: sujet(l, 'domains') } }
    }
    case 'administrateur_cree':
      if (echec) return { cle: 'administrateur_cree.echec', args: { qui, compte: sujet(l, 'users') } }
      return { cle: vrai(d.jour_zero) ? 'administrateur_cree.premier' : 'administrateur_cree.simple', args: { qui, compte: sujet(l, 'users') } }
    case 'tache_lancee_a_la_main':
      if (echec) return { cle: 'tache_lancee_a_la_main.echec', args: { qui, tache: code('tache', d.tache) } }
      return { cle: d.etait_active === false ? 'tache_lancee_a_la_main.inactive' : 'tache_lancee_a_la_main.simple', args: { qui, tache: code('tache', d.tache) } }

    // ── Données personnelles ──
    case 'inactivite_avertie': {
      if (echec) return { cle: 'inactivite_avertie.echec', args: { qui, compte: sujet(l, 'users'), cause: code('cause_avertissement', d.cause) } }
      const quand = dateIso(d.echeance_purge)
      return quand
        ? { cle: 'inactivite_avertie.date', args: { qui, compte: sujet(l, 'users'), date: { k: 'date', v: quand } } }
        : { cle: 'inactivite_avertie.simple', args: { qui, compte: sujet(l, 'users') } }
    }
    case 'compte_purge_inactivite':
    case 'compte_purge_demande':
    case 'compte_purge_admin': {
      const e = effacements(d)
      return e.length
        ? { cle: `${l.type_action}.detail`, args: { qui, compte: sujet(l, 'users'), effacements: codes('effacement', e) } }
        : { cle: `${l.type_action}.simple`, args: { qui, compte: sujet(l, 'users') } }
    }
    case 'ip_effacees': {
      if (echec) return { cle: 'ip_effacees.echec', args: { qui } }
      const mois = nombre(d.mois), a = nombre(d.audit_logs), s = nombre(d.session_logs)
      return mois !== null && a !== null && s !== null
        ? { cle: 'ip_effacees.detail', args: { qui, mois: n(mois), audit: n(a), sessions: n(s) } }
        : { cle: 'ip_effacees.simple', args: { qui } }
    }
    case 'desabonnement_email':
      return { cle: 'desabonnement_email', args: { qui, evenement: code('evenement', d.evenement) } }

    // ── Journal ──
    case 'journal_nettoye': {
      const total = nombre(d.lignes)
      const familles = Array.isArray(d.familles)
        ? (d.familles as unknown[]).map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>).famille : f))
        : []
      return total === null
        ? { cle: 'journal_nettoye.simple', args: { qui } }
        : familles.length
          ? { cle: 'journal_nettoye.familles', args: { qui, lignes: n(total), familles: codes('famille', familles) } }
          : { cle: 'journal_nettoye.total', args: { qui, lignes: n(total) } }
    }

    // ── Refus ──
    case 'refus_depot_sans_jugement':
      return { cle: 'refus_depot_sans_jugement', args: {
        qui, annonce: l.sujet_type === 'candidature_depots' ? sujet(l, 'candidature_depots') : objet('publications', 'publications', d.publication_id),
        cause: code('cause_depot', d.cause),
      } }
    case 'refus_expert_inapte':
      return { cle: 'refus_expert_inapte', args: { qui, raison: code('raison_ineligible', d.raison) } }
    case 'refus_garde_eligibilite':
    case 'refus_quota_cv':
    case 'refus_recherche_en_cours':
      return { cle: l.type_action, args: { qui } }

    default:
      return { cle: '_generique', args: { qui } }
  }
}

/** Le réglage modifié, désigné : « les durées », « le tarif du modèle d’IA X », « la conservation des Annonces »… */
function reglageDesigne(l: LignePhrase, d: Record<string, unknown>): Arg {
  switch (l.sujet_type) {
    case 'ai_model_tarifs':
      return chaine(d.model) ? sous({ cle: '_reglage.ai_model_tarifs', args: { modele: { k: 'texte', v: d.model as string } } }) : sous({ cle: '_reglage.ai_model_tarifs_simple' })
    case 'ai_spend_seuils_acteur':
      return sous({ cle: '_reglage.ai_spend_seuils_acteur', args: { champ: code('champ_plafond_compte', d.champ) } })
    case 'verification_providers':
      return sous({ cle: '_reglage.verification_providers', args: { de: code('note_de', d.note_de) } })
    case 'grand_livre_conservation':
      return sous({ cle: '_reglage.grand_livre_conservation', args: { famille: code('famille', d.famille) } })
    case 'blocked_email_domains':
    case 'public_email_domains':
      return sous({ cle: `_reglage.${l.sujet_type}` })
    case 'packages':
      return sous({ cle: '_reglage.packages', args: { offre: sujet(l, 'packages') } })
    case 'organizations':
      return sous({ cle: '_reglage.organizations', args: { organisation: sujet(l, 'organizations') } })
    case 'packages_stripe':
      return sous({ cle: '_reglage.packages_stripe', args: { mode: code('mode_paiement', d.mode) } })
    case 'packages_default':
      return sous({ cle: '_reglage.packages_default', args: { cible: code('valeur_reglage', d.target_role) } })
    default:
      return code('reglage', l.sujet_type)
  }
}

// ═══ LE RENDU ══════════════════════════════════════════════════════════════════════════════════════════════════

export type Traducteur = {
  /** Le traducteur de l'écran, sur l'espace `journal` (`useTranslations('journal')`). */
  t: (cle: string, valeurs?: Record<string, string | number>) => string
  has: (cle: string) => boolean
}
export type ContexteRendu = {
  ligne: LignePhrase
  noms: NomsJournal
  /** La relecture des noms a réussi : un nom absent veut dire « effacé ». Sinon : le nom commun, sans jugement. */
  nomsDisponibles: boolean
  locale: string
  tr: Traducteur
}

function valeurCode(dim: Dim, v: unknown, tr: Traducteur): string {
  const c = typeof v === 'boolean' ? String(v) : typeof v === 'string' ? v : null
  const espace = dim === 'famille' ? 'familles' : `valeurs.${dim}`
  if (c !== null && (DIMENSIONS[dim] as readonly string[]).includes(c) && tr.has(`${espace}.${c}`)) return tr.t(`${espace}.${c}`)
  return tr.t('valeurs.inconnu')
}

// Les formateurs Intl coûtent cher à construire : un par langue (et par devise), gardés.
const FORMATEURS = new Map<string, { format: (x: never) => string }>()
function formateur<T extends { format: (x: never) => string }>(cle: string, fabriquer: () => T): T {
  let f = FORMATEURS.get(cle)
  if (!f) { f = fabriquer(); FORMATEURS.set(cle, f) }
  return f as T
}

function listeLisible(elements: string[], locale: string): string {
  const uniques = [...new Set(elements)]
  try {
    return formateur(`liste:${locale}`, () => new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' })).format(uniques)
  } catch {
    return uniques.join(', ')
  }
}

/** « Mehdi Ben ayed », « La plateforme », « Une tâche automatique », « Un compte supprimé ». */
export function quiLisible(l: LignePhrase, tr: Traducteur, milieu = false): string {
  const espace = milieu ? 'qui_milieu' : 'qui'
  if (!l.acteur_id) return tr.t(`${espace}.${['utilisateur', 'tache_planifiee', 'administrateur', 'systeme'].includes(l.origine) ? l.origine : 'systeme'}`)
  if (l.acteur_supprime) return tr.t(`${espace}.supprime`)
  return l.acteur_nom && l.acteur_nom.trim() ? l.acteur_nom : tr.t(`${espace}.sans_nom`)
}

function rendreArg(a: Arg, c: ContexteRendu): string | number {
  const { tr, locale } = c
  switch (a.k) {
    case 'n': return a.v
    case 'texte': return a.v
    case 'code': return valeurCode(a.dim, a.v, tr)
    case 'codes': return listeLisible((Array.isArray(a.v) ? a.v : []).map((x) => valeurCode(a.dim, x, tr)), locale)
    case 'objet': {
      const nom = a.ref ? c.noms[cleObjet(a.ref.type, a.ref.id)]?.[a.role] ?? null : null
      if (nom) return tr.t(`designe.${a.type}`, { nom })
      // '' : le compte EXISTE et n'a jamais donné de nom — ce n'est pas un compte effacé (relecture du 01/10/2026, point 18).
      if (nom === '' && c.nomsDisponibles && tr.has(`designe_sans_nom.${a.type}`)) return tr.t(`designe_sans_nom.${a.type}`)
      return tr.t(`${a.ref && c.nomsDisponibles ? 'designe_absent' : 'designe_inconnu'}.${a.type}`)
    }
    case 'date':
      return formateur(`date:${locale}`, () => new Intl.DateTimeFormat(locale, { dateStyle: 'long' })).format(new Date(a.v))
    case 'argent':
      try {
        return formateur(`argent:${locale}:${a.devise.toUpperCase()}`, () => new Intl.NumberFormat(locale, { style: 'currency', currency: a.devise.toUpperCase() })).format(a.v)
      } catch {
        return formateur(`nombre:${locale}`, () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })).format(a.v)
      }
    case 'qui': return quiLisible(c.ligne, tr, a.milieu)
    case 'sous': return rendrePhrase(a.phrase, c)
    case 'liste': return listeLisible(a.elements.map((p) => rendrePhrase(p, c)), locale)
  }
}

export function rendrePhrase(p: Phrase, c: ContexteRendu): string {
  const valeurs: Record<string, string | number> = {}
  for (const [k, a] of Object.entries(p.args ?? {})) valeurs[k] = rendreArg(a, c)
  return c.tr.t(`phrases.${p.cle}`, valeurs)
}

/** La phrase d'une ligne, rendue — ce que l'écran affiche. */
export function phraseLisible(c: ContexteRendu): string {
  return rendrePhrase(phraseDe(c.ligne), c)
}
