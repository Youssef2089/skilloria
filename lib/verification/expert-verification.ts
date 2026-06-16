import type { SupabaseClient } from '@supabase/supabase-js'
import {
  runExpertCoherenceCheck,
  type ExpertVerificationConfig,
  type ExpertVerificationFlag,
  type ExpertVerificationInput,
  type ExpertVerificationOutput,
} from './ai-expert-verification'
import { dashboardUrlForUserType } from '@/lib/auth-routing'

/**
 * Dispatcher VÉRIFICATION EXPERT — fonction AUTONOME + IDEMPOTENTE.
 *
 * Pattern aligné sur lib/matching/runMatching :
 *   - Charge la config provider en BDD (verification_providers / 'profile_verification')
 *   - Charge profile + jointures + tables liées (experiences/educations/languages)
 *   - Garde RGPD : ai_consent_at IS NOT NULL (sinon status reste 'pending')
 *   - Pose verification_status='pending' AVANT l'appel (transparence UX)
 *   - Appelle ai-expert-verification (3 axes, web_search natif)
 *   - Décision :
 *       • score ≥ auto_approve_threshold ET aucun flag disqualifiant → approved
 *         + verified_at=now() + verified_by=NULL (auto) + flip users.is_verified
 *       • sinon → pending_admin_review  (admin tranche approve/reject + motif)
 *       • result='error' (timeout / rate-limit / JSON invalide) → pending_admin_review
 *         (fail-safe, JAMAIS auto-approve)
 *   - Notification expert (best-effort) : type='verification_result'
 *
 * Idempotent : appelable plusieurs fois sur le même profile_id. Re-jouer
 * écrase la dernière décision avec un nouveau verdict. Useful pour le diag
 * (a/b/e) et pour les re-runs manuels.
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
  seniority: string | null
  years_experience: number | null
  years_total_experience: number | null
  branch_id: string | null
  speciality_id: string | null
  skills: string[] | null
  certifications: unknown
  linkedin_url: string | null
  visible: boolean | null
  ai_consent_at: string | null
  cv_parsing_status: string | null
  verification_status: string | null
  branches: { name: string } | { name: string }[] | null
  specialities: { name: string } | { name: string }[] | null
  users: { id: string; locale: string | null; user_type: string | null } | { id: string; locale: string | null; user_type: string | null }[] | null
}

type RawConfig = {
  model?: unknown
  fallback_model?: unknown
  max_tokens?: unknown
  request_timeout_ms?: unknown
  auto_approve_threshold?: unknown
  web_search_max_uses?: unknown
  domain_mismatch_cap?: unknown
  blocking_flags?: unknown
}

// Flags de cohérence qui bloquent l'auto-approbation si la config n'en fournit
// pas (defense in depth). LINKEDIN_UNVERIFIABLE volontairement exclu.
const DEFAULT_BLOCKING_FLAGS: ExpertVerificationFlag[] = ['CV_PROFILE_INCOHERENT', 'SUSPICIOUS_CONTENT', 'DOMAIN_MISMATCH']

const KNOWN_FLAGS: readonly ExpertVerificationFlag[] = ['DOMAIN_MISMATCH', 'CV_PROFILE_INCOHERENT', 'LINKEDIN_UNVERIFIABLE', 'SUSPICIOUS_CONTENT']

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

async function loadConfig(supabaseAdmin: SupabaseClient): Promise<ExpertVerificationConfig | null> {
  const { data, error } = await supabaseAdmin
    .from('verification_providers')
    .select('confidence_threshold, is_active, config, country_code')
    .eq('provider_type', PROVIDER_TYPE)
    .eq('is_active', true)
    .order('priority', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[expert-verification] config load failed', error.message)
    return null
  }
  if (!data) return null
  const row = data as unknown as { confidence_threshold: number; is_active: boolean; config: RawConfig | null }
  const cfg = (row.config ?? {}) as RawConfig
  const model = typeof cfg.model === 'string' && cfg.model.length > 0 ? cfg.model : null
  const fallback_model = typeof cfg.fallback_model === 'string' && cfg.fallback_model.length > 0 ? cfg.fallback_model : null
  const max_tokens = typeof cfg.max_tokens === 'number' && cfg.max_tokens > 0 ? Math.min(cfg.max_tokens, 8000) : null
  const request_timeout_ms = typeof cfg.request_timeout_ms === 'number' && cfg.request_timeout_ms > 0 ? Math.min(cfg.request_timeout_ms, 120000) : 45000
  const auto_approve = typeof cfg.auto_approve_threshold === 'number' ? Math.max(0, Math.min(10, cfg.auto_approve_threshold)) : null
  const web_search_max_uses = typeof cfg.web_search_max_uses === 'number' && cfg.web_search_max_uses > 0 ? Math.min(cfg.web_search_max_uses, 10) : 4
  const domain_mismatch_cap = typeof cfg.domain_mismatch_cap === 'number' ? Math.max(0, Math.min(10, cfg.domain_mismatch_cap)) : 5
  const blocking_flags = parseBlockingFlags(cfg.blocking_flags)
  if (!model || !fallback_model || !max_tokens || auto_approve == null) {
    console.error('[expert-verification] config incomplete', { model, fallback_model, max_tokens, auto_approve })
    return null
  }
  return { model, fallback_model, max_tokens, request_timeout_ms, auto_approve_threshold: auto_approve, web_search_max_uses, domain_mismatch_cap, blocking_flags }
}

async function loadProfileForVerification(
  supabaseAdmin: SupabaseClient,
  profileId: string,
): Promise<{ row: ProfileRow; experiences: ExpertVerificationInput['experiences']; educations: ExpertVerificationInput['educations']; languages: string[]; domain_name: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select(
      'id, user_id, domain_id, expert_type, title, summary, seniority, years_experience, ' +
        'years_total_experience, branch_id, speciality_id, skills, certifications, ' +
        'linkedin_url, visible, ai_consent_at, cv_parsing_status, verification_status, ' +
        'branches(name), specialities(name), users!profiles_user_id_fkey(id, locale, user_type)',
    )
    .eq('id', profileId)
    .maybeSingle()
  if (error) {
    console.error('[expert-verification] profile load failed', error.message)
    return null
  }
  if (!data) return null
  const row = data as unknown as ProfileRow

  // Charger experiences / educations / languages (tables structurées, optionnelles)
  const [expRes, eduRes, langRes, domRes] = await Promise.all([
    supabaseAdmin.from('profile_experiences').select('role, employer, sector, start_date, end_date, is_current, description').eq('profile_id', profileId).order('start_date', { ascending: false }).limit(20),
    supabaseAdmin.from('profile_educations').select('school, degree, field, start_year, end_year').eq('profile_id', profileId).order('start_year', { ascending: false }).limit(10),
    supabaseAdmin.from('profile_languages').select('language, level').eq('profile_id', profileId).limit(15),
    supabaseAdmin.from('domains').select('name').eq('id', row.domain_id).maybeSingle(),
  ])
  const experiences = ((expRes.data ?? []) as unknown as ExpertVerificationInput['experiences'])
  const educations = ((eduRes.data ?? []) as unknown as ExpertVerificationInput['educations'])
  const languages = ((langRes.data ?? []) as { language: string; level?: string }[]).map((l) => l.language)
  const domain_name = ((domRes.data as { name?: string } | null)?.name) ?? 'Microsoft'

  return { row, experiences, educations, languages, domain_name }
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

async function notifyExpertResult(args: {
  supabaseAdmin: SupabaseClient
  user_id: string
  domain_id: string
  user_type: string | null
  locale: Locale
  verification_status: 'approved' | 'pending_admin_review' | 'rejected'
  reason: string | null
}): Promise<void> {
  const { supabaseAdmin, user_id, domain_id, user_type, locale, verification_status, reason } = args
  const titles: Record<Locale, Record<string, string>> = {
    fr: {
      approved: 'Votre profil est vérifié ✓',
      pending_admin_review: 'Votre profil est en cours de validation',
      rejected: 'Votre demande de vérification n\'a pas abouti',
    },
    en: {
      approved: 'Your profile is verified ✓',
      pending_admin_review: 'Your profile is under review',
      rejected: 'Your verification request was not approved',
    },
    es: {
      approved: 'Tu perfil está verificado ✓',
      pending_admin_review: 'Tu perfil está en revisión',
      rejected: 'Tu solicitud de verificación no fue aprobada',
    },
    de: {
      approved: 'Ihr Profil ist verifiziert ✓',
      pending_admin_review: 'Ihr Profil wird gerade geprüft',
      rejected: 'Ihre Verifizierungsanfrage wurde nicht genehmigt',
    },
  }
  const bodies: Record<Locale, Record<string, string>> = {
    fr: {
      approved: 'Votre profil est désormais visible des entreprises. Vous apparaissez dans les recommandations IA.',
      pending_admin_review: 'Notre équipe vérifie quelques points avant de valider votre profil. Vous serez notifié de la décision.',
      rejected: reason ? `Motif : ${reason}` : 'Vous pouvez ajuster votre profil et soumettre à nouveau.',
    },
    en: {
      approved: 'Your profile is now visible to companies. You will appear in AI recommendations.',
      pending_admin_review: 'Our team is verifying a few details before approving your profile. You will be notified of the decision.',
      rejected: reason ? `Reason: ${reason}` : 'You can adjust your profile and submit again.',
    },
    es: {
      approved: 'Tu perfil es ahora visible para las empresas. Aparecerás en las recomendaciones IA.',
      pending_admin_review: 'Nuestro equipo verifica algunos puntos antes de aprobar tu perfil. Te avisaremos de la decisión.',
      rejected: reason ? `Motivo: ${reason}` : 'Puedes ajustar tu perfil y volver a enviarlo.',
    },
    de: {
      approved: 'Ihr Profil ist nun für Unternehmen sichtbar. Sie erscheinen in den KI-Empfehlungen.',
      pending_admin_review: 'Unser Team prüft einige Punkte vor der Freigabe Ihres Profils. Sie werden über die Entscheidung benachrichtigt.',
      rejected: reason ? `Grund: ${reason}` : 'Sie können Ihr Profil anpassen und erneut einreichen.',
    },
  }
  // Lien notif conditionné user_type (parité freelance/CDI). Source de
  // vérité partagée : dashboardUrlForUserType (lib/auth-routing.ts).
  const linkUrl = dashboardUrlForUserType(user_type)
  try {
    await supabaseAdmin.from('notifications').insert({
      user_id, domain_id,
      type: 'verification_result',
      channel: 'inapp',
      title: titles[locale][verification_status] ?? titles.fr[verification_status],
      body: bodies[locale][verification_status] ?? bodies.fr[verification_status],
      link_url: linkUrl,
      status: 'pending',
      entity_id: null,
    })
  } catch (err) {
    console.error('[expert-verification] notif insert threw', err)
  }
}

export async function runExpertVerification(args: {
  supabaseAdmin: SupabaseClient
  profile_id: string
}): Promise<ExpertVerificationVerdict> {
  const { supabaseAdmin, profile_id } = args

  // 1. Config
  const config = await loadConfig(supabaseAdmin)
  if (!config) {
    // Pas de provider → on remonte le profil en pending_admin_review (jamais auto)
    await supabaseAdmin
      .from('profiles')
      .update({
        verification_status: 'pending_admin_review',
        verification_method: 'manual_only',
        verification_data: { notes: 'Provider profile_verification non configuré — vérif manuelle requise.' },
      })
      .eq('id', profile_id)
    return { status: 'skipped', verification_status: 'pending_admin_review', score: null, notes: '', flags: [], discrepancies: [], model: null, reason: 'provider_not_configured' }
  }

  // 2. Profile + tables liées
  const loaded = await loadProfileForVerification(supabaseAdmin, profile_id)
  if (!loaded) {
    return { status: 'skipped', verification_status: null, score: null, notes: '', flags: [], discrepancies: [], model: null, reason: 'profile_not_found' }
  }
  const { row, experiences, educations, languages, domain_name } = loaded

  // 3. Pré-conditions (RGPD + CV parsé)
  if (!row.ai_consent_at) {
    await supabaseAdmin
      .from('profiles')
      .update({ verification_status: 'pending', verification_data: { notes: 'ai_consent manquant — vérif IA en attente.' } })
      .eq('id', profile_id)
    return { status: 'skipped', verification_status: 'pending', score: null, notes: '', flags: [], discrepancies: [], model: null, reason: 'ai_consent_missing' }
  }
  if (row.cv_parsing_status !== 'done') {
    await supabaseAdmin
      .from('profiles')
      .update({ verification_status: 'pending', verification_data: { notes: 'CV non parsé — vérif IA en attente.' } })
      .eq('id', profile_id)
    return { status: 'skipped', verification_status: 'pending', score: null, notes: '', flags: [], discrepancies: [], model: null, reason: 'cv_not_parsed' }
  }

  // 4. Pose status='pending' AVANT l'appel IA (transparence UX)
  await supabaseAdmin
    .from('profiles')
    .update({ verification_status: 'pending' })
    .eq('id', profile_id)

  // 5. Préparer l'input IA
  const user = pickRel(row.users)
  const branch = pickRel(row.branches)
  const speciality = pickRel(row.specialities)
  const locale = normalizeLocale(user?.locale)
  const input: ExpertVerificationInput = {
    domain_name,
    expert_type: (row.expert_type as ExpertVerificationInput['expert_type']) ?? null,
    title: row.title,
    summary: row.summary,
    seniority: row.seniority,
    years_experience: row.years_experience,
    years_total_experience: row.years_total_experience,
    branch_name: branch?.name ?? null,
    speciality_name: speciality?.name ?? null,
    skills: Array.isArray(row.skills) ? row.skills : [],
    languages,
    certifications_count: countCerts(row.certifications),
    linkedin_url: row.linkedin_url,
    experiences,
    educations,
    locale,
  }

  // 6. Appel IA
  let aiOut: ExpertVerificationOutput
  try {
    aiOut = await runExpertCoherenceCheck(input, config)
  } catch (err) {
    console.error('[expert-verification] AI call threw', err)
    aiOut = {
      result: 'error',
      provider_name: 'claude_expert_coherence_check',
      model_used: config.fallback_model,
      confidence_score: 0,
      notes: 'Erreur SDK Anthropic',
      discrepancies: [],
      flags: [],
      web_search_used: false,
      raw_response: null,
    }
  }

  // 7. Décision (PAS d'auto-reject V1)
  //   Un flag BLOQUANT (liste config.blocking_flags) interdit l'auto-approbation
  //   QUEL QUE SOIT le score → pending_admin_review. C'est le vrai filet de
  //   sécurité : un profil incohérent (CV_PROFILE_INCOHERENT) ne passe plus
  //   "vérifié" même s'il atteint le seuil. DOMAIN_MISMATCH garde EN PLUS son
  //   cap de score spécifique appliqué côté ai-expert-verification (shapeOutput).
  const blockingFlagsHit = aiOut.flags.filter((f) => config.blocking_flags.includes(f))
  const hasDisqualifyingFlag = blockingFlagsHit.length > 0
  const isApproved =
    aiOut.result === 'ok' &&
    aiOut.confidence_score >= config.auto_approve_threshold &&
    !hasDisqualifyingFlag

  const finalStatus: 'approved' | 'pending_admin_review' = isApproved ? 'approved' : 'pending_admin_review'

  // 8. Trace verification_attempts (best-effort, mirror pattern 11G)
  try {
    await supabaseAdmin.from('verification_attempts').insert({
      // Pas de FK organization_id pour les experts — laisser NULL si schéma permet,
      // sinon on saute. La table verification_attempts existe pour les orgs avec
      // organization_id NOT NULL : on tente, on log l'erreur sans bloquer.
      organization_id: null as never,
      provider_used: aiOut.provider_name,
      result: aiOut.result,
      confidence_score: aiOut.confidence_score,
      raw_response: aiOut.raw_response as never,
      triggered_admin_review: !isApproved,
    } as never)
  } catch {
    // best-effort — la table peut exiger organization_id NOT NULL ; on n'échoue pas dessus.
  }

  // 9. Écrire le verdict sur profiles
  const verifData = {
    score: aiOut.confidence_score,
    notes: aiOut.notes,
    discrepancies: aiOut.discrepancies,
    flags: aiOut.flags,
    blocking_flags_hit: blockingFlagsHit,   // flags qui ont forcé pending_admin_review (si non vide)
    web_search_used: aiOut.web_search_used,
    model_used: aiOut.model_used,
    provider_name: aiOut.provider_name,
    ai_result: aiOut.result,
    decided_at: new Date().toISOString(),
  }
  const updatePayload: Record<string, unknown> = {
    verification_status: finalStatus,
    verification_method: 'ai_web_search',
    verification_score: aiOut.confidence_score,
    verification_data: verifData,
  }
  if (isApproved) {
    updatePayload.verified_at = new Date().toISOString()
    updatePayload.verified_by = null         // auto-approve : pas d'admin
    updatePayload.review_reason = null
  }
  const { error: updErr } = await supabaseAdmin
    .from('profiles')
    .update(updatePayload)
    .eq('id', profile_id)
  if (updErr) {
    console.error('[expert-verification] profile update failed', updErr.message)
    return { status: 'error', verification_status: null, score: aiOut.confidence_score, notes: aiOut.notes, flags: aiOut.flags, discrepancies: aiOut.discrepancies, model: aiOut.model_used, reason: 'profile_update_failed' }
  }

  // 10. Si approved → flip users.is_verified=true (drapeau agrégé UI)
  if (isApproved && user?.id) {
    const { error: uErr } = await supabaseAdmin
      .from('users')
      .update({ is_verified: true })
      .eq('id', user.id)
    if (uErr) console.error('[expert-verification] users.is_verified flip failed', uErr.message)
  }

  // 11. Notif expert (best-effort) — user_type passé pour router le lien
  //     vers /dashboard/cdi vs /dashboard/freelance.
  if (user?.id) {
    await notifyExpertResult({
      supabaseAdmin,
      user_id: user.id,
      domain_id: row.domain_id,
      user_type: user.user_type ?? null,
      locale,
      verification_status: finalStatus,
      reason: null,
    })
  }

  return {
    status: aiOut.result === 'ok' ? 'ok' : 'error',
    verification_status: finalStatus,
    score: aiOut.confidence_score,
    notes: aiOut.notes,
    flags: aiOut.flags,
    discrepancies: aiOut.discrepancies,
    model: aiOut.model_used,
  }
}
