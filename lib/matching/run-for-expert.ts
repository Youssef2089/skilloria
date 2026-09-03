import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnnonceType } from '@/types/annonce'
import { annonceTypesForExpert, type ExpertKind } from '@/lib/annonces/audience'
import { loadMatchingSettings } from './settings'
import { buildAnnonceQuery, buildExpertDocument, documentUtilisable } from './document'
import { rerankerTout, type DocumentANoter } from './rerank'
import { reconcileMatches, type ReconcileDesired } from './reconcile'
import { notifyAndFlip, pickRel, type NotifySpec } from './shared'
import type { MatchingVerdict } from './types'

/**
 * MISE EN RELATION — sens EXPERT → ANNONCES.
 *
 * Le symétrique de index.ts, avec une asymétrie qui n'est pas un détail :
 *
 *   Un reranker compare UNE requête à N documents. Dans le sens annonce →
 *   experts, la requête est l'annonce et les documents sont les profils : un
 *   appel par lot. Dans ce sens-ci, l'expert est la requête et les annonces sont
 *   les documents — même forme, même coût, même absence de compétition. Le
 *   moteur est donc le MÊME, retourné, et non un second moteur qui dériverait.
 *
 * CE QUI DÉCLENCHE CE SENS : un profil approuvé, un CV reparsé, une ouverture
 * croisée cochée. Autrement dit, l'expert vient de changer — pas les annonces.
 */

type LigneProfil = {
  id: string
  user_id: string
  domain_id: string
  title: string | null
  summary: string | null
  skills: string[] | null
  certifications: unknown
  years_total_experience: number | null
  branch_id: string | null
  speciality_ids: string[] | null
  seniorities: string[] | null
  work_zone_countries: string[] | null
  visible: boolean | null
  ai_consent_at: string | null
  cv_parsing_status: string | null
  verification_status: string | null
  availability_status: string | null
  cdi_status: string | null
  open_to_cdi: boolean | null
  open_to_freelance: boolean | null
  last_matching_scope: unknown
  users: { user_type: string; locale: string } | { user_type: string; locale: string }[] | null
}

type LigneAnnonce = {
  id: string
  type: string
  title: string | null
  description: string | null
  skills_required: string[] | null
  branch_id: string | null
  speciality_ids: string[] | null
  seniorities: string[] | null
  work_zone_countries: string[] | null
  created_by: string | null
  status: string
}

const SELECT_PROFIL =
  'id, user_id, domain_id, title, summary, skills, certifications, years_total_experience, ' +
  'branch_id, speciality_ids, seniorities, work_zone_countries, ' +
  'visible, ai_consent_at, cv_parsing_status, verification_status, ' +
  'availability_status, cdi_status, open_to_cdi, open_to_freelance, last_matching_scope, ' +
  'users!profiles_user_id_fkey!inner(user_type, locale)'

/**
 * L'expert est-il éligible à recevoir des recommandations ?
 *
 * Exactement les mêmes conditions que côté vivier — écrites une seule fois ici
 * pour ce sens, et vérifiées AVANT toute dépense. Un profil non éligible qu'on
 * noterait quand même serait de l'argent dépensé pour un résultat qu'on jette.
 */
function expertEligible(p: LigneProfil, kind: ExpertKind): { ok: true } | { ok: false; raison: string } {
  if (p.visible !== true) return { ok: false, raison: 'profil non visible' }
  if (p.cv_parsing_status !== 'done') return { ok: false, raison: 'CV non analysé' }
  if (!p.ai_consent_at) return { ok: false, raison: 'consentement IA absent' }
  if (p.verification_status !== 'approved') return { ok: false, raison: 'profil non approuvé' }
  if (kind === 'expert_freelance' && p.availability_status === 'do_not_disturb') {
    return { ok: false, raison: 'expert en « ne pas déranger »' }
  }
  if (kind === 'expert_cdi' && p.cdi_status === 'employed') {
    return { ok: false, raison: 'expert non en recherche' }
  }
  return { ok: true }
}

/** La trace du périmètre du dernier run — le routeur de synchronisation la lit. */
async function ecrireTraceDePerimetre(
  supabaseAdmin: SupabaseClient,
  profileId: string,
  ouvertureCroisee: boolean,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ last_matching_scope: { crossOpen: ouvertureCroisee, evaluated_at: new Date().toISOString() } })
    .eq('id', profileId)
  if (error) console.warn('[matching-expert] trace de périmètre non écrite', error.message)
}

function ouvertureCroiseeDe(p: LigneProfil, kind: ExpertKind): boolean {
  return kind === 'expert_freelance' ? p.open_to_cdi === true : p.open_to_freelance === true
}

export async function runMatchingForExpert(args: {
  supabaseAdmin: SupabaseClient
  profileId: string
  locale?: string
}): Promise<MatchingVerdict> {
  const { supabaseAdmin, profileId } = args

  // ── 1. Le profil ─────────────────────────────────────────────────────────
  const { data: profData, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select(SELECT_PROFIL)
    .eq('id', profileId)
    .maybeSingle()
  if (profErr) {
    console.error('[matching-expert] lecture du profil en échec', { profileId, message: profErr.message })
    return { status: 'error', proposals: [], notes: `Lecture du profil en échec : ${profErr.message}`, model: null }
  }
  if (!profData) {
    return { status: 'error', proposals: [], notes: 'Profil introuvable.', model: null }
  }
  const p = profData as unknown as LigneProfil
  const u = pickRel(p.users)
  const kind: ExpertKind = u?.user_type === 'expert_cdi' ? 'expert_cdi' : 'expert_freelance'
  const locale = args.locale ?? u?.locale ?? 'fr'

  const eligibilite = expertEligible(p, kind)
  if (!eligibilite.ok) {
    return { status: 'empty_pool', proposals: [], notes: `Expert non éligible : ${eligibilite.raison}.`, model: null }
  }

  // ── 2. Les réglages ──────────────────────────────────────────────────────
  const reglages = await loadMatchingSettings(supabaseAdmin, p.domain_id)
  if (!reglages.ok) {
    return { status: 'no_config', proposals: [], notes: reglages.detail, model: null }
  }
  const s = reglages.settings

  const ouvertureCroisee = ouvertureCroiseeDe(p, kind)
  const typesAutorises = annonceTypesForExpert(kind, ouvertureCroisee)

  // ── 3. Le vivier d'annonces ──────────────────────────────────────────────
  //  Mêmes critères DÉCLARÉS que dans l'autre sens, appliqués depuis l'autre
  //  bout : la branche de l'expert, ses spécialités, ses séniorités, ses zones.
  //  Ensemble vide CÔTÉ ANNONCE = aucune contrainte, jamais « personne ».
  //  L'inverse n'est pas vrai : un expert sans zone n'est pas visible du tout,
  //  et l'éligibilité l'a déjà écarté.
  let q = supabaseAdmin
    .from('publications')
    .select(
      'id, type, title, description, skills_required, branch_id, speciality_ids, ' +
        'seniorities, work_zone_countries, created_by, status',
    )
    .eq('domain_id', p.domain_id)
    .eq('status', 'published')
    .in('type', typesAutorises)
  if (p.branch_id) q = q.eq('branch_id', p.branch_id)
  if ((p.work_zone_countries ?? []).length > 0) {
    q = q.overlaps('work_zone_countries', p.work_zone_countries as string[])
  }
  // Un expert ne se voit pas proposer son propre besoin de sous-traitance.
  q = q.neq('created_by', p.user_id)

  const { data: pubsData, error: pubsErr } = await q
  if (pubsErr) {
    console.error('[matching-expert] chargement des annonces en échec', { profileId, message: pubsErr.message })
    return { status: 'error', proposals: [], notes: `Chargement des annonces : ${pubsErr.message}`, model: s.rerank_model }
  }
  const annonces = (pubsData ?? []) as unknown as LigneAnnonce[]

  // ── 4. Ce que l'expert a DÉJÀ DÉCIDÉ ─────────────────────────────────────
  //  Décliné, ou déjà postulé : on ne paie pas pour renoter ce qui est tranché,
  //  et la réconciliation préserve ces deux cas de toute façon.
  const [declinesRes, postulesRes] = await Promise.all([
    supabaseAdmin.from('matches').select('publication_id').eq('profile_id', profileId).eq('status', 'dismissed'),
    supabaseAdmin.from('candidatures').select('publication_id').eq('profile_id', profileId),
  ])
  if (declinesRes.error || postulesRes.error) {
    const detail = declinesRes.error?.message ?? postulesRes.error?.message ?? 'inconnue'
    console.error('[matching-expert] décisions déjà prises illisibles', { profileId, detail })
    return { status: 'error', proposals: [], notes: `Décisions déjà prises illisibles : ${detail}`, model: s.rerank_model }
  }
  const tranchees = new Set<string>([
    ...(declinesRes.data ?? []).map((r) => (r as { publication_id: string }).publication_id),
    ...(postulesRes.data ?? []).map((r) => (r as { publication_id: string }).publication_id),
  ])

  // Les critères MULTIVALUÉS de l'annonce se recoupent en mémoire : ils vivent
  // sur la ligne annonce, pas sur la ligne profil, et PostgREST ne sait pas
  // comparer deux colonnes tableau entre elles dans un filtre.
  const specialitesExpert = new Set(p.speciality_ids ?? [])
  const senioritesExpert = new Set(p.seniorities ?? [])
  const recoupe = (exigees: string[] | null, possedees: Set<string>): boolean =>
    (exigees ?? []).length === 0 || (exigees ?? []).some((x) => possedees.has(x))

  const retenues = annonces.filter(
    (a) =>
      !tranchees.has(a.id) &&
      recoupe(a.speciality_ids, specialitesExpert) &&
      recoupe(a.seniorities, senioritesExpert),
  )

  const requete = buildExpertDocument({
    title: p.title,
    summary: p.summary,
    skills: p.skills,
    certifications_count: Array.isArray(p.certifications) ? p.certifications.length : 0,
    years_total_experience: p.years_total_experience,
    experiences: [],
  })
  if (!documentUtilisable(requete)) {
    return {
      status: 'empty_pool',
      proposals: [],
      notes: 'Profil trop court pour être comparé (titre + résumé + compétences).',
      model: s.rerank_model,
    }
  }

  const documents: DocumentANoter[] = retenues
    .map((a) => ({
      id: a.id,
      texte: buildAnnonceQuery({ title: a.title, description: a.description, skills_required: a.skills_required }),
    }))
    .filter((d) => documentUtilisable(d.texte))

  if (documents.length === 0) {
    await ecrireTraceDePerimetre(supabaseAdmin, profileId, ouvertureCroisee)
    return { status: 'empty_pool', proposals: [], notes: 'Aucune annonce à noter pour cet expert.', model: s.rerank_model }
  }

  // ── 5. La notation ───────────────────────────────────────────────────────
  const notation = await rerankerTout({
    supabaseAdmin,
    domainId: p.domain_id,
    model: s.rerank_model,
    tailleLot: s.rerank_batch_size,
    requete,
    documents,
    contexte: { profile_id: profileId },
  })

  const parAnnonce = new Map(retenues.map((a) => [a.id, a]))
  const desired: ReconcileDesired[] = []
  for (const [publicationId, score] of notation.scores) {
    if (score < s.feed_threshold) continue
    if (!parAnnonce.has(publicationId)) continue
    desired.push({
      profile_id: profileId,
      publication_id: publicationId,
      relevance_score: score,
      relevance_tier: s.notify_threshold > 0 && score >= s.notify_threshold ? 'strong' : 'normal',
      reason: '',
      pitch_org: null,
    })
  }

  // ── 6. Réconciliation ────────────────────────────────────────────────────
  let stats
  try {
    stats = await reconcileMatches({
      supabaseAdmin,
      scope: { byProfileId: profileId },
      domainId: p.domain_id,
      desired,
      model: notation.model,
      inScopeFreeAxisIds: retenues.map((a) => a.id),
    })
  } catch (err) {
    const note = err instanceof Error ? err.message : String(err)
    return { status: 'error', proposals: [], notes: `Réconciliation en échec : ${note}`, model: notation.model }
  }

  // ── 7. Notifications ─────────────────────────────────────────────────────
  let notifies = 0
  if (s.notify_enabled && stats.inserted.length > 0) {
    const forts = new Set(desired.filter((d) => d.relevance_tier === 'strong').map((d) => d.publication_id))
    const specs: NotifySpec[] = []
    for (const i of stats.inserted) {
      if (!forts.has(i.publication_id)) continue
      const a = parAnnonce.get(i.publication_id)
      if (!a) continue
      specs.push({
        user_id: p.user_id,
        profile_id: profileId,
        publication_id: i.publication_id,
        publication_title: a.title ?? '',
        publication_type: a.type as AnnonceType,
        user_type: kind,
        domain_id: p.domain_id,
        locale,
      })
    }
    if (specs.length > 0) {
      await notifyAndFlip({ supabaseAdmin, specs })
      notifies = specs.length
    }
  }

  await ecrireTraceDePerimetre(supabaseAdmin, profileId, ouvertureCroisee)

  const acheve = notation.lots_en_echec === 0 && !notation.arret
  const resume =
    `Annonces ${retenues.length} · notées ${notation.notes} · retenues ${desired.length} · ` +
    `notifiées ${notifies} · +${stats.inserted.length} ~${stats.updated} -${stats.deleted}` +
    (notation.arret ? ` · ARRÊTÉ : ${notation.arret}` : '') +
    (notation.lots_en_echec > 0 ? ` · ${notation.lots_en_echec} lot(s) NON noté(s)` : '')

  return {
    status: acheve ? 'ok' : 'error',
    proposals: desired.map((d) => ({ profile_id: d.profile_id, relevance_score: d.relevance_score })),
    notes: resume,
    model: notation.model,
  }
}

/**
 * Retrait de toutes les recommandations d'un expert (rétrogradation, rejet).
 *
 * Réutilise le primitif idempotent : `desired: []` supprime les recommandations
 * pures et PRÉSERVE les décisions de l'expert (décliné) comme les actes engagés
 * (candidatures). Aucune logique nouvelle, donc aucune divergence possible.
 */
export async function clearExpertRecommendations(args: {
  supabaseAdmin: SupabaseClient
  profileId: string
}): Promise<{ ok: boolean; deleted: number }> {
  const { supabaseAdmin, profileId } = args
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('domain_id')
    .eq('id', profileId)
    .maybeSingle()
  if (error) {
    console.error('[matching-expert] retrait : lecture du profil en ÉCHEC', error.message)
    return { ok: false, deleted: 0 }
  }
  if (!data) {
    console.warn('[matching-expert] retrait : profil introuvable', { profileId })
    return { ok: false, deleted: 0 }
  }
  const domainId = (data as { domain_id: string }).domain_id

  try {
    const stats = await reconcileMatches({
      supabaseAdmin,
      scope: { byProfileId: profileId },
      domainId,
      desired: [],
      model: 'retrait-sans-notation',
    })
    return { ok: true, deleted: stats.deleted }
  } catch (err) {
    console.error('[matching-expert] retrait : réconciliation a levé', err)
    return { ok: false, deleted: 0 }
  }
}

/**
 * ÉLAGAGE SEUL — aucun appel au reranker, donc aucune dépense.
 *
 * Cas d'usage : l'expert DÉCOCHE son ouverture croisée. Le périmètre rétrécit ;
 * le seul travail nécessaire est de retirer les matches vers des annonces
 * sorties du périmètre. C'est du SQL pur, exécutable sans délai d'attente et
 * sans rien coûter.
 *
 * Les scores existants sont RÉUTILISÉS TELS QUELS pour les annonces conservées :
 * les renoter changerait des scores que rien n'a rendus faux, et ferait payer un
 * décochage.
 */
export async function runPruneForExpert(args: {
  supabaseAdmin: SupabaseClient
  profileId: string
}): Promise<{ ok: boolean; deleted: number; kept: number; crossOpen: boolean }> {
  const { supabaseAdmin, profileId } = args

  const { data: profData, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('id, domain_id, open_to_cdi, open_to_freelance, users!profiles_user_id_fkey!inner(user_type)')
    .eq('id', profileId)
    .maybeSingle()
  if (profErr || !profData) {
    console.error('[matching-prune] lecture du profil en échec', profErr?.message ?? 'introuvable')
    return { ok: false, deleted: 0, kept: 0, crossOpen: false }
  }
  const p = profData as unknown as {
    id: string
    domain_id: string
    open_to_cdi: boolean | null
    open_to_freelance: boolean | null
    users: { user_type: string | null } | { user_type: string | null }[] | null
  }
  const u = pickRel(p.users) as { user_type: string | null } | null
  const kind: ExpertKind = u?.user_type === 'expert_cdi' ? 'expert_cdi' : 'expert_freelance'
  const ouvertureCroisee =
    kind === 'expert_freelance' ? p.open_to_cdi === true : p.open_to_freelance === true
  const typesAutorises: string[] = annonceTypesForExpert(kind, ouvertureCroisee)

  const { data: existData, error: exErr } = await supabaseAdmin
    .from('matches')
    .select('id, publication_id, relevance_score, relevance_tier, explanation, publications!inner(type, status, domain_id)')
    .eq('profile_id', profileId)
  if (exErr) {
    console.error('[matching-prune] chargement des matches en échec', exErr.message)
    return { ok: false, deleted: 0, kept: 0, crossOpen: ouvertureCroisee }
  }
  const lignes = (existData ?? []) as unknown as Array<{
    id: string
    publication_id: string
    relevance_score: number | null
    relevance_tier: string | null
    explanation: { reason?: string; pitch_org?: string | null } | null
    publications: { type: string; status: string; domain_id: string } | { type: string; status: string; domain_id: string }[] | null
  }>

  const desired: ReconcileDesired[] = []
  for (const r of lignes) {
    const pub = pickRel(r.publications) as { type: string; status: string; domain_id: string } | null
    if (!pub) continue
    if (pub.status !== 'published') continue
    if (pub.domain_id !== p.domain_id) continue
    if (!typesAutorises.includes(pub.type)) continue
    desired.push({
      profile_id: profileId,
      publication_id: r.publication_id,
      relevance_score: r.relevance_score == null ? 0 : Number(r.relevance_score),
      relevance_tier: r.relevance_tier === 'strong' ? 'strong' : 'normal',
      reason: r.explanation?.reason ?? '',
      pitch_org: r.explanation?.pitch_org ?? null,
    })
  }

  let deleted = 0
  try {
    const stats = await reconcileMatches({
      supabaseAdmin,
      scope: { byProfileId: profileId },
      domainId: p.domain_id,
      desired,
      model: 'elagage-sans-notation',
    })
    deleted = stats.deleted
  } catch (err) {
    console.error('[matching-prune] réconciliation a levé', err)
    return { ok: false, deleted: 0, kept: desired.length, crossOpen: ouvertureCroisee }
  }

  await ecrireTraceDePerimetre(supabaseAdmin, profileId, ouvertureCroisee)
  return { ok: true, deleted, kept: desired.length, crossOpen: ouvertureCroisee }
}
