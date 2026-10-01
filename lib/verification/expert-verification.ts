import type { ContexteJournal } from '@/lib/journal/contexte'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  runExpertCoherenceCheck,
  type ExpertVerificationConfig,
  type ExpertVerificationFlag,
  type ExpertVerificationInput,
  type ExpertVerificationOutput,
} from './ai-expert-verification'
import { dashboardUrlForUserType } from '@/lib/auth-routing'
import { texteNotificationStatut, voieDuCompte } from '@/lib/profil/notification-statut'
import { nomDeLangue } from '@/lib/profil/langues'
import { budgetDisponible, enregistrerDepenseIA } from '@/lib/ai-budget'

/**
 * LA VÉRIFICATION D'UN EXPERT — ÉVALUER, sans rien écrire du verdict (§D.30).
 *
 * ═══ CE QUI A CHANGÉ LE 30/09/2026 ═════════════════════════════════════════
 *   Elle tournait DANS la requête de publication (plafond 60 s) et écrivait son
 *   verdict en deux appels. Coupée, elle laissait « vérification en cours » pour
 *   toujours. Désormais :
 *     · `evaluerVerificationExpert` LIT et JUGE, et rend une INTENTION —
 *       conclure (approuvé, ou déféré à un humain avec un motif NOMMÉ), rejouer
 *       (une panne de notre côté ou du fournisseur), abandonner ;
 *     · l'exécutant des travaux d'IA (lib/travaux-ia/executer-verification.ts)
 *       CONCLUT par `conclure_verification_expert` : le profil, le drapeau du
 *       compte, son état et la ligne `verification_conclue`, en UNE transaction ;
 *     · le pilote pg_cron clôt un travail perdu en revue humaine. Jamais
 *       d'approbation sur une panne ; jamais de profil « en cours » pour toujours.
 *
 *   La décision est inchangée : note ≥ `auto_approve_threshold` ET aucun drapeau
 *   bloquant → approuvé ; sinon revue humaine. PAS d'auto-refus.
 */

const PROVIDER_TYPE = 'profile_verification'
const VALID_LOCALES = ['fr', 'en', 'es', 'de'] as const
type Locale = (typeof VALID_LOCALES)[number]

export type ExpertVerificationVerdict = {
  status: 'ok' | 'error' | 'skipped'
  verification_status: 'approved' | 'pending_admin_review' | 'pending' | null
  score: number | null
  notes: string
  flags: string[]
  discrepancies: string[]
  model: string | null
  reason?: string                  // motif si skipped (consent manquant, etc.)
}

type ProfileRow = {
  id: string
  user_id: string
  domain_id: string
  expert_type: string | null
  title: string | null
  summary: string | null
  seniorities: string[] | null
  years_experience: number | null
  years_total_experience: number | null
  branch_id: string | null
  speciality_ids: string[] | null
  skills: string[] | null
  certifications: unknown
  visible: boolean | null
  ai_consent_at: string | null
  cv_parsing_status: string | null
  verification_status: string | null
  branches: { name: string } | { name: string }[] | null
  users: { id: string; locale: string | null; user_type: string | null } | { id: string; locale: string | null; user_type: string | null }[] | null
}

type RawConfig = {
  model?: unknown
  fallback_model?: unknown
  max_tokens?: unknown
  request_timeout_ms?: unknown
  auto_approve_threshold?: unknown
  domain_mismatch_cap?: unknown
  blocking_flags?: unknown
}

// Flags de cohérence qui bloquent l'auto-approbation si la config n'en fournit
// pas (defense in depth).
const DEFAULT_BLOCKING_FLAGS: ExpertVerificationFlag[] = ['CV_PROFILE_INCOHERENT', 'SUSPICIOUS_CONTENT', 'DOMAIN_MISMATCH']

// LINKEDIN_UNVERIFIABLE n'est plus un drapeau (LinkedIn est ignoré, recette du 01/10/2026).
const KNOWN_FLAGS: readonly ExpertVerificationFlag[] = ['DOMAIN_MISMATCH', 'CV_PROFILE_INCOHERENT', 'SUSPICIOUS_CONTENT']

function parseBlockingFlags(raw: unknown): ExpertVerificationFlag[] {
  if (!Array.isArray(raw)) return DEFAULT_BLOCKING_FLAGS
  const out: ExpertVerificationFlag[] = []
  for (const v of raw) {
    if (typeof v === 'string' && (KNOWN_FLAGS as readonly string[]).includes(v) && !out.includes(v as ExpertVerificationFlag)) {
      out.push(v as ExpertVerificationFlag)
    }
  }
  // Tableau vide explicite ou que des valeurs inconnues → on retombe sur le
  // défaut plutôt que de désactiver tout garde-flag par mégarde.
  return out.length > 0 ? out : DEFAULT_BLOCKING_FLAGS
}

function pickRel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function normalizeLocale(raw: string | null | undefined): Locale {
  if (raw && (VALID_LOCALES as readonly string[]).includes(raw)) return raw as Locale
  return 'fr'
}

/**
 * QUATRE SITUATIONS, QUATRE MOTIFS — et elles rendaient toutes `null`.
 *
 *   `runExpertVerification` écrivait alors, EN BASE et sous les yeux de
 *   l'administrateur, « Provider profile_verification non configuré ». Sur une
 *   erreur de LECTURE ou sur une configuration AMBIGUË, cette phrase est
 *   fausse : elle envoie configurer un fournisseur qui l'est déjà, et le vrai
 *   défaut — la panne, ou les deux lignes actives — reste invisible.
 *
 *   L'issue ne change pas (revue manuelle, aucun appel IA, aucune
 *   auto-approbation) : c'est le MOTIF qui devient exact (§E.22).
 */
type MotifConfigAbsente = 'lecture_impossible' | 'non_configure' | 'ambigu' | 'incomplet'

async function loadConfig(
  supabaseAdmin: SupabaseClient,
): Promise<ExpertVerificationConfig | MotifConfigAbsente> {
  // ── AUCUN `limit(1)` : UNE CONFIGURATION AMBIGUË SE DIT, ELLE NE SE TRANCHE
  //    PAS EN SILENCE ────────────────────────────────────────────────────────
  //
  //  Ce chargement prenait la PREMIÈRE ligne active du type, quel que soit le
  //  pays. Tant qu'une seule ligne existe, le résultat est juste ; le jour où un
  //  second pays en obtient une, `order + limit(1)` en choisit une **au hasard
  //  du tri**, et l'écart ne se voit nulle part.
  //
  //  On ne filtre PAS par pays, et c'est DÉLIBÉRÉ : la vérification d'un expert
  //  porte sur une PERSONNE et son expertise, pas sur un registre national —
  //  contrairement à la vérification d'entreprise (lib/verification/index.ts),
  //  qui est scopée `country_code` parce qu'elle interroge un registre.
  //  Mais « pas de filtre » doit être un choix ÉNONCÉ, pas un effet de bord :
  //  deux lignes actives ⇒ refus nommé, à l'admin de trancher depuis
  //  `/admin/seuils`.
  const { data, error } = await supabaseAdmin
    .from('verification_providers')
    .select('confidence_threshold, is_active, config, country_code')
    .eq('provider_type', PROVIDER_TYPE)
    .eq('is_active', true)
    .order('priority', { ascending: true })
  if (error) {
    console.error('[expert-verification] config load failed', error.message)
    return 'lecture_impossible'
  }
  const lignes = (data ?? []) as unknown as {
    confidence_threshold: number
    is_active: boolean
    config: RawConfig | null
    country_code: string
  }[]
  if (lignes.length === 0) return 'non_configure'
  if (lignes.length > 1) {
    console.error('[expert-verification] configuration ambiguë — plusieurs lignes actives', {
      provider_type: PROVIDER_TYPE,
      pays: lignes.map((l) => l.country_code),
    })
    return 'ambigu'
  }
  const row = lignes[0]
  const cfg = (row.config ?? {}) as RawConfig

  // ── PLUS AUCUNE VALEUR FABRIQUÉE ────────────────────────────────────────
  //
  //  ⚠️ `web_search_max_uses` N'EST PLUS LU (recette du 01/10/2026) : le vérificateur
  //  n'offre plus aucun outil au modèle — la recherche web n'existait que pour LinkedIn.
  //  La clé peut rester en base ; elle ne gouverne rien et n'est plus EXIGÉE (§D.11 :
  //  un réglage inerte qui refuserait la vérification serait pire qu'un réglage absent).
  //
  //  `request_timeout_ms`, `web_search_max_uses` et `domain_mismatch_cap`
  //  retombaient sur 45000, 4 et 5 quand la clé manquait. Les trois valeurs
  //  EXISTENT aujourd'hui en base et coïncident exactement avec ces replis —
  //  ce qui rend l'invention INVISIBLE, et c'est précisément ce qui la rend
  //  dangereuse : elle ne mordrait que le jour où quelqu'un retirerait une clé,
  //  en croyant désactiver un réglage.
  //
  //  UN RÉGLAGE INVENTÉ EST PIRE QU'UN RÉGLAGE ABSENT : il a l'air d'avoir été
  //  décidé. Les trois sont désormais EXIGÉES, au même titre que le seuil
  //  d'auto-approbation — et une clé manquante produit un refus nommé, pas un
  //  comportement supposé (§D.7).
  const model = typeof cfg.model === 'string' && cfg.model.length > 0 ? cfg.model : null
  const fallback_model = typeof cfg.fallback_model === 'string' && cfg.fallback_model.length > 0 ? cfg.fallback_model : null
  const max_tokens = typeof cfg.max_tokens === 'number' && cfg.max_tokens > 0 ? Math.min(cfg.max_tokens, 8000) : null
  const request_timeout_ms =
    typeof cfg.request_timeout_ms === 'number' && cfg.request_timeout_ms > 0
      ? Math.min(cfg.request_timeout_ms, 120000)
      : null
  const auto_approve = typeof cfg.auto_approve_threshold === 'number' ? Math.max(0, Math.min(10, cfg.auto_approve_threshold)) : null
  const domain_mismatch_cap =
    typeof cfg.domain_mismatch_cap === 'number' ? Math.max(0, Math.min(10, cfg.domain_mismatch_cap)) : null
  const blocking_flags = parseBlockingFlags(cfg.blocking_flags)
  if (
    !model ||
    !fallback_model ||
    !max_tokens ||
    auto_approve == null ||
    request_timeout_ms == null ||
    domain_mismatch_cap == null
  ) {
    console.error('[expert-verification] config incomplete', {
      model,
      fallback_model,
      max_tokens,
      auto_approve,
      request_timeout_ms,
      domain_mismatch_cap,
    })
    return 'incomplet'
  }
  return { model, fallback_model, max_tokens, request_timeout_ms, auto_approve_threshold: auto_approve, domain_mismatch_cap, blocking_flags }
}

async function loadProfileForVerification(
  supabaseAdmin: SupabaseClient,
  profileId: string,
): Promise<
  | { row: ProfileRow; experiences: ExpertVerificationInput['experiences']; educations: ExpertVerificationInput['educations']; languages: string[]; domain_name: string; domain_tags: string[] }
  | null
  | 'indisponible'
> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select(
      'id, user_id, domain_id, expert_type, title, summary, seniorities, years_experience, ' +
        'years_total_experience, branch_id, speciality_ids, skills, certifications, ' +
        'visible, ai_consent_at, cv_parsing_status, verification_status, ' +
        'branches(name), users!profiles_user_id_fkey(id, locale, user_type)',
    )
    .eq('id', profileId)
    .maybeSingle()
  if (error) {
    // Message distinct du « profil absent » : ici la ligne existe et c'est la
    // REQUÊTE qui a échoué (colonne inconnue, droits…). Les confondre envoie
    // chercher un profil disparu qui se porte très bien.
    console.error('[expert-verification] requête profil en échec', {
      profileId,
      message: error.message,
    })
    // ⚠️ LE COMMENTAIRE CI-DESSUS ÉTAIT JUSTE, LE CODE NE LE SUIVAIT PAS.
    //    Il nommait la distinction puis rendait `null` dans les deux cas :
    //    l'appelant sortait en `profile_not_found` SANS RIEN ÉCRIRE, et le
    //    profil restait en `pending` — donc « vérification en cours » à
    //    l'écran, indéfiniment, sans qu'aucun humain soit saisi. Un mensonge
    //    par omission coûte plus cher qu'un refus (§E.22).
    return 'indisponible'
  }
  if (!data) {
    console.warn('[expert-verification] profil introuvable', { profileId })
    return null
  }
  const row = data as unknown as ProfileRow

  // Charger experiences / educations / languages (tables structurées, optionnelles)
  const [expRes, eduRes, langRes, domRes] = await Promise.all([
    // `experience_type` et `client_name` : une mission se lit avec son CLIENT (recette du 01/10/2026, point 12).
    supabaseAdmin.from('profile_experiences').select('experience_type, role, employer, client_name, sector, start_date, end_date, is_current, description').eq('profile_id', profileId).order('start_date', { ascending: false }).limit(20),
    supabaseAdmin.from('profile_educations').select('school, degree, field, start_year, end_year').eq('profile_id', profileId).order('start_year', { ascending: false }).limit(10),
    supabaseAdmin.from('profile_languages').select('language, level').eq('profile_id', profileId).limit(15),
    // Référentiel écosystème : nom du domaine + tags (source canonique
    // domain_configs.tags) pour la vérif multi-écosystème (fin du référentiel
    // Microsoft figé). Pas de fallback en dur : un domaine sans nom = anomalie
    // traitée par le caller (pending_admin_review), jamais masquée.
    supabaseAdmin.from('domains').select('name, domain_configs(tags)').eq('id', row.domain_id).maybeSingle(),
  ])
  // ⚠️ MÊME APPEL, DEUX STANDARDS — ET C'ÉTAIT VISIBLE À L'ŒIL NU.
  //    Le QUATRIÈME élément de ce `Promise.all` porte, en commentaire, « Pas de
  //    fallback en dur : un domaine sans nom = anomalie traitée par le caller,
  //    jamais masquée ». Les TROIS PREMIERS retombaient sur `[]`.
  //
  //    Ce que ça produisait : l'IA jugeait un expert à ZÉRO EXPÉRIENCE, sans
  //    formation et sans langue. Elle notait bas, le score passait sous le
  //    seuil, et la note — FAUSSE — partait EN BASE, lue ensuite par un
  //    administrateur. C'est le cas ⑦ de §E.22, sur le chemin des DONNÉES
  //    cette fois et non de la configuration. Et on PAYAIT l'appel.
  //
  //    Une règle écrite à côté d'une ligne ne couvre pas ses voisines.
  // ⚠️ LE DOMAINE AUSSI (audit du 30/09/2026, m3) : son erreur n'était pas lue, et
  //    une panne de lecture se disait « domaine introuvable ou sans nom — anomalie de
  //    données ». Une panne se REJOUE ; une anomalie se défère. Deux motifs.
  if (expRes.error || eduRes.error || langRes.error || domRes.error) {
    console.error('[expert-verification] tables structurées en échec — aucun jugement', {
      profileId,
      experiences: expRes.error?.message ?? null,
      educations: eduRes.error?.message ?? null,
      langues: langRes.error?.message ?? null,
      domaine: domRes.error?.message ?? null,
    })
    return 'indisponible'
  }
  const experiences = ((expRes.data ?? []) as unknown as ExpertVerificationInput['experiences'])
  const educations = ((eduRes.data ?? []) as unknown as ExpertVerificationInput['educations'])
  // Des CODES en base (recette du 01/10/2026, point 3) : nommés en français, la langue de la consigne.
  const languages = ((langRes.data ?? []) as { language: string; level?: string }[]).map((l) => nomDeLangue(l.language, 'fr'))
  const domRow = domRes.data as { name?: string | null; domain_configs?: { tags?: string[] | null } | { tags?: string[] | null }[] | null } | null
  const domain_name = (domRow?.name ?? '').trim()   // '' → anomalie (cf. caller), plus de défaut 'Microsoft'
  const domCfg = Array.isArray(domRow?.domain_configs) ? domRow?.domain_configs[0] : domRow?.domain_configs
  const domain_tags = Array.isArray(domCfg?.tags) ? (domCfg!.tags as string[]) : []

  return { row, experiences, educations, languages, domain_name, domain_tags }
}

function countCerts(certifications: unknown): number {
  if (!certifications) return 0
  if (Array.isArray(certifications)) return certifications.length
  if (typeof certifications === 'object') {
    const arr = (certifications as { items?: unknown }).items
    if (Array.isArray(arr)) return arr.length
  }
  return 0
}

export async function notifyExpertResult(args: {
  supabaseAdmin: SupabaseClient
  user_id: string
  domain_id: string
  user_type: string | null
  locale: Locale
  /**
   * `pending` : posée À LA PUBLICATION (recette du 01/10/2026, point 7) — l'expert apprenait
   * que son profil était « en cours de validation » une minute après, seulement si l'IA
   * déférait à un humain. Les trois autres : le verdict.
   */
  verification_status: 'pending' | 'approved' | 'pending_admin_review' | 'rejected'
  reason: string | null
  /** La pièce du geste qui la pose (§D.26, phase B 2.5). */
  piece: string
}): Promise<void> {
  const { supabaseAdmin, user_id, domain_id, user_type, locale, verification_status, reason, piece } = args
  // LES TEXTES SONT CEUX DE L'ÉCRAN (recette du 01/10/2026, point 5) : « Statut de votre
  // profil : <état> » et la phrase qui dit la suite, lus dans l'espace `statut_profil` —
  // le même que la pastille et l'étape 3. Ils vivaient ici, en dur, avec d'autres mots.
  const etat = verification_status === 'pending_admin_review' ? 'admin_review' : verification_status
  const { titre, corps } = texteNotificationStatut(etat, voieDuCompte(user_type), locale)
  const motif = verification_status === 'rejected' && reason ? `\n${reason}` : ''
  // Lien notif conditionné user_type (parité freelance/CDI). Source de
  // vérité partagée : dashboardUrlForUserType (lib/auth-routing.ts).
  const linkUrl = dashboardUrlForUserType(user_type)
  // supabase-js ne LÈVE pas : l'erreur se lit dans la réponse, ou elle se perd.
  const { error } = await supabaseAdmin.from('notifications').insert({
    user_id, domain_id, piece,
    type: 'verification_result',
    channel: 'inapp',
    title: titre,
    body: corps + motif,
    link_url: linkUrl,
    status: 'pending',
    entity_id: null,
  })
  if (error) console.error('[expert-verification] notification de statut NON posée', { user_id, etat, message: error.message })
}

/**
 * L'INTENTION que l'évaluation rend à l'exécutant — jamais un verdict déjà écrit.
 *   · `conclure` : le verdict (approuvé, ou déféré à un humain) et son MOTIF, un code ;
 *   · `rejouer` : une panne de notre côté ou du fournisseur — le travail reprendra ;
 *   · `abandonner` : rien à vérifier (profil disparu) — le travail est clos.
 */
export type IntentionVerification =
  | {
      issue: 'conclure'
      approuve: boolean
      methode: 'ai_web_search' | 'manual_only'
      score: number | null
      donnees: Record<string, unknown>
      motif: string
    }
  | { issue: 'rejouer'; code: string }
  | { issue: 'abandonner'; code: string }

/** Un renvoi en revue humaine, avec la note lue par l'administrateur sur /admin/experts/[id]. */
const deferer = (motif: string, notes: string, score: number | null = null): IntentionVerification => ({
  issue: 'conclure',
  approuve: false,
  methode: 'manual_only',
  score,
  donnees: { notes, code: motif },
  motif,
})

export async function evaluerVerificationExpert(args: {
  supabaseAdmin: SupabaseClient
  profile_id: string
  /** Le geste qui a déposé la vérification (§D.26) — la dépense s'écrit sous sa pièce. */
  journal: ContexteJournal
}): Promise<IntentionVerification> {
  const { supabaseAdmin, profile_id, journal } = args

  // 1. La configuration du fournisseur — une panne de LECTURE se rejoue ; les trois défauts se défèrent.
  const config = await loadConfig(supabaseAdmin)
  if (config === 'lecture_impossible') return { issue: 'rejouer', code: 'configuration_illisible' }
  if (typeof config === 'string') {
    const NOTE: Record<Exclude<MotifConfigAbsente, 'lecture_impossible'>, string> = {
      non_configure: 'Provider profile_verification non configuré — vérif manuelle requise.',
      ambigu:
        'PLUSIEURS lignes actives pour profile_verification : la configuration est ambiguë et n’a pas été tranchée au hasard. Vérif manuelle requise, puis corrigez /admin/seuils.',
      incomplet:
        'La configuration de profile_verification est INCOMPLÈTE (un champ requis manque) — vérif manuelle requise, puis corrigez /admin/seuils.',
    }
    return deferer(`config_${config}`, NOTE[config])
  }

  // 2. Le profil et ses tables — une panne se REJOUE, elle ne se juge pas.
  const loaded = await loadProfileForVerification(supabaseAdmin, profile_id)
  if (loaded === 'indisponible') return { issue: 'rejouer', code: 'profil_illisible' }
  if (!loaded) return { issue: 'abandonner', code: 'profil_introuvable' }
  const { row, experiences, educations, languages, domain_name, domain_tags } = loaded

  // 2bis. Un domaine sans nom, LU SANS ERREUR, est une anomalie de données : on défère.
  if (!domain_name) {
    console.error('[expert-verification] domaine sans nom', { profile_id, domain_id: row.domain_id })
    return deferer('domaine_sans_nom', 'Domaine sans nom — vérification déférée à l’admin (anomalie de données).')
  }

  // 3. Les pré-conditions. La publication les exige déjà ; les voir manquer ici est une
  //    incohérence, qui part en revue humaine NOMMÉE — plus jamais un « en cours » sans fin.
  if (!row.ai_consent_at) return deferer('consentement_absent', 'Consentement à l’analyse IA absent — vérification manuelle requise.')
  if (row.cv_parsing_status !== 'done') return deferer('cv_non_analyse', 'CV non analysé au moment de la vérification — vérification manuelle requise.')

  // 4. Les libellés des spécialités — une panne se rejoue (on ne juge pas un dossier amputé).
  const user = pickRel(row.users)
  const branch = pickRel(row.branches)
  let specialityNames: string[] = []
  const ids = row.speciality_ids ?? []
  if (ids.length > 0) {
    const { data: sps, error: spsErr } = await supabaseAdmin.from('specialities').select('name').in('id', ids)
    if (spsErr) return { issue: 'rejouer', code: 'specialites_illisibles' }
    specialityNames = ((sps ?? []) as Array<{ name: string }>).map((x) => x.name)
  }
  const locale = normalizeLocale(user?.locale)
  // La voie, dans le vocabulaire du prompt (`expert_freelance` / `expert_cdi`) : la colonne
  // `expert_type` dit `freelance` / `cdi` (audit du 30/09/2026 : les deux se mélangeaient).
  const expertType: ExpertVerificationInput['expert_type'] =
    user?.user_type === 'expert_cdi' || row.expert_type === 'cdi'
      ? 'expert_cdi'
      : user?.user_type === 'expert_freelance' || row.expert_type === 'freelance'
        ? 'expert_freelance'
        : null
  const input: ExpertVerificationInput = {
    domain_name,
    domain_tags,
    expert_type: expertType,
    title: row.title,
    summary: row.summary,
    seniorities: row.seniorities ?? [],
    years_experience: row.years_experience,
    years_total_experience: row.years_total_experience,
    branch_name: branch?.name ?? null,
    speciality_names: specialityNames,
    skills: Array.isArray(row.skills) ? row.skills : [],
    languages,
    certifications_count: countCerts(row.certifications),
    experiences,
    educations,
    locale,
  }

  // 5. Le plafond, AVANT d'appeler (fail-closed). Au plafond : revue humaine, jamais une approbation sans examen.
  const budget = await budgetDisponible(supabaseAdmin, 'claude', { acteur: { type: 'profile', id: profile_id }, action: 'expert_verification' }, journal)
  if (!budget.ok) return deferer('plafond_ia', 'Plafond de dépense IA atteint — vérification manuelle requise. ' + budget.raison)

  // 6. Le modèle.
  let aiOut: ExpertVerificationOutput
  try {
    aiOut = await runExpertCoherenceCheck(input, config)
  } catch (err) {
    console.error('[expert-verification] appel IA en exception', err)
    return { issue: 'rejouer', code: 'modele_indisponible' }
  }

  // 7. LA DÉPENSE DE CHAQUE TENTATIVE — une réponse illisible se paie autant qu'une bonne
  //    (audit du 30/09/2026, m4 : seule la tentative retenue était comptée).
  for (const usage of aiOut.usages) {
    await enregistrerDepenseIA(supabaseAdmin, {
      provider: 'claude',
      action: 'expert_verification',
      journal,
      acteur: { type: 'profile', id: profile_id },
      consommation: usage,
      domain_id: row.domain_id,
      context: {},
    })
  }

  // 8. Un échec du modèle : rejoué s'il est de passage, déféré sinon — avec SA cause (m3).
  if (aiOut.result === 'error') {
    if (aiOut.echec === 'modele_indisponible') return { issue: 'rejouer', code: 'modele_indisponible' }
    const NOTE_ECHEC: Record<string, string> = {
      configuration: 'La clé du fournisseur d’IA est absente ou refusée — vérification manuelle requise, puis corrigez la configuration.',
      document_refuse: 'Le fournisseur d’IA a refusé la demande — vérification manuelle requise.',
      reponse_illisible: 'Les réponses du modèle étaient illisibles (trois tentatives) — vérification manuelle requise.',
    }
    const cause = aiOut.echec ?? 'reponse_illisible'
    return deferer(cause, NOTE_ECHEC[cause] ?? NOTE_ECHEC.reponse_illisible)
  }

  // 9. La décision (PAS d'auto-refus). Un drapeau BLOQUANT interdit l'approbation, quelle que soit la note.
  const blockingFlagsHit = aiOut.flags.filter((f) => config.blocking_flags.includes(f))
  const isApproved = aiOut.confidence_score >= config.auto_approve_threshold && blockingFlagsHit.length === 0
  const donnees = {
    score: aiOut.confidence_score,
    notes: aiOut.notes,
    discrepancies: aiOut.discrepancies,
    flags: aiOut.flags,
    blocking_flags_hit: blockingFlagsHit,
    web_search_used: aiOut.web_search_used,
    model_used: aiOut.model_used,
    provider_name: aiOut.provider_name,
    ai_result: aiOut.result,
    decided_at: new Date().toISOString(),
  }
  return {
    issue: 'conclure',
    approuve: isApproved,
    methode: 'ai_web_search',
    score: aiOut.confidence_score,
    donnees,
    motif: isApproved ? 'note_suffisante' : blockingFlagsHit.length > 0 ? 'drapeau_bloquant' : 'note_insuffisante',
  }
}

/** La langue de l'expert, pour la notification du verdict. */
export { normalizeLocale as langueDeNotification }
