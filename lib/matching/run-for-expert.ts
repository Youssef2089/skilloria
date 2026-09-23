import { memoriserNotesParAnnonce, notesDejaAcquisesPourAnnonces } from '@/lib/matching/reprise'
import { empreinteDeNote } from '@/lib/matching/empreinte'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnnonceType } from '@/types/annonce'
import { annonceTypesForExpert, type ExpertKind } from '@/lib/annonces/audience'
import { loadMatchingSettings } from './settings'
import { buildAnnonceQuery, buildExpertDocument, documentUtilisable } from './document'
import { rerankerTout, type DocumentANoter } from './rerank'
import { reconcileMatches, type ReconcileDesired } from './reconcile'
import { notifyAndFlip, pickRel, type NotifySpec } from './shared'
import type { VerdictExpert } from './types'
import {
  COLONNES_COMPTE,
  COLONNES_PROFIL,
  jugerEligibilite,
  type RaisonIneligible,
} from './eligibilite'
// La MÊME source que l'autre sens. Une seconde expression de la règle ici
// aurait fait deux moteurs qui ne s'accordent pas sur ce qu'est une annonce
// active — et rien ne l'aurait dit (§E.20, §E.24).
import { chargerDurees } from '@/lib/durees'
import { activePublishedOrClause } from '@/lib/publications/expiry'

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

// ⚠️ LES COLONNES D'ÉLIGIBILITÉ SONT **DÉRIVÉES**, JAMAIS RECOPIÉES ICI.
//    C'est la moitié du défaut de ce lot : trois conditions manquaient de ce
//    côté, et elles n'étaient même pas CHARGEABLES — le `select` ne demandait
//    ni `status`, ni `deletion_scheduled_at`, ni `anonymized_at`. Un test sur
//    une colonne absente ne lève rien : il lit `undefined` et conclut (§E.1).
//    Écrites ici à la main, elles auraient pu se désaccorder de la règle à la
//    première condition ajoutée.
const SELECT_PROFIL =
  'id, user_id, domain_id, title, summary, skills, certifications, years_total_experience, ' +
  'branch_id, speciality_ids, seniorities, work_zone_countries, ' +
  `${COLONNES_PROFIL.join(', ')}, ` +
  'open_to_cdi, open_to_freelance, last_matching_scope, ' +
  `users!profiles_user_id_fkey!inner(user_type, locale, ${COLONNES_COMPTE.join(', ')})`

/**
 * L'expert est-il éligible à recevoir des recommandations ?
 *
 * ⚠️ CETTE FONCTION NE DÉCIDE PLUS RIEN, ET C'EST LE LOT. Elle portait SA
 *    PROPRE liste de conditions, sous un commentaire qui affirmait « exactement
 *    les mêmes conditions que côté vivier ». Trois y manquaient — compte
 *    suspendu, en suppression, anonymisé — et le `select` ne chargeait même
 *    pas de quoi les tester.
 *    Conséquence ATTEIGNABLE, par deux chemins qui ne passent pas par
 *    `requireAuth` : le cron de relance et l'approbation par un
 *    administrateur. Un expert suspendu était noté (dépense réelle) et
 *    NOTIFIÉ.
 *
 * La règle vit dans [lib/matching/eligibilite.ts](./eligibilite.ts), module
 * PUR que les DEUX sens plient. La phrase de journal en vient aussi : elle
 * était une seconde table indexée par la raison, donc une seconde occasion
 * d'oublier une entrée.
 */
function expertEligible(
  p: LigneProfil,
  kind: ExpertKind,
): { ok: true } | { ok: false; raison: RaisonIneligible; journal: string } {
  return jugerEligibilite(p as unknown as Record<string, unknown>, kind)
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

/**
 * LA RAISON POUR LAQUELLE CET EXPERT NE RECEVRA RIEN — connue en UNE LECTURE.
 *
 * Appelée AVANT de lancer quoi que ce soit, pour que l'écran dise au clic ce
 * qu'il savait déjà au clic. Elle n'appelle aucun fournisseur, ne dépense rien,
 * et ne touche à aucune ligne.
 *
 * ⚠️ UNE LECTURE EN PANNE N'EST PAS UNE INÉLIGIBILITÉ. Elle remonte en
 *    `indisponible`, et l'appelant décide — confondre les deux ferait dire à
 *    un expert parfaitement éligible que son profil ne l'est pas, sur une
 *    panne de base (§E.22, §E.42).
 */
export async function raisonIneligibilite(
  supabaseAdmin: SupabaseClient,
  profileId: string,
): Promise<
  | { etat: 'eligible' }
  | { etat: 'ineligible'; raison: RaisonIneligible }
  | { etat: 'indisponible'; detail: string }
> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select(SELECT_PROFIL)
    .eq('id', profileId)
    .maybeSingle()
  if (error) return { etat: 'indisponible', detail: error.message }
  if (!data) return { etat: 'indisponible', detail: 'profil introuvable' }

  const p = data as unknown as LigneProfil
  const kind: ExpertKind = pickRel(p.users)?.user_type === 'expert_cdi' ? 'expert_cdi' : 'expert_freelance'

  const verdict = expertEligible(p, kind)
  return verdict.ok ? { etat: 'eligible' } : { etat: 'ineligible', raison: verdict.raison }
}

export async function runMatchingForExpert(args: {
  supabaseAdmin: SupabaseClient
  profileId: string
  locale?: string
}): Promise<VerdictExpert> {
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
    return {
      status: 'empty_pool',
      proposals: [],
      notes: `Expert non éligible : ${eligibilite.journal}.`,
      model: null,
      empechement: { quoi: 'ineligible', raison: eligibilite.raison },
    }
  }

  // ── 2. Les réglages ──────────────────────────────────────────────────────
  const reglages = await loadMatchingSettings(supabaseAdmin, p.domain_id)
  if (!reglages.ok) {
    return { status: 'no_config', proposals: [], notes: reglages.detail, model: null }
  }
  const s = reglages.settings

  // ⚠️ LA MÊME RÈGLE QUE L'AUTRE SENS, LUE AU MÊME ENDROIT (§E.20).
  //    Sans elle, un expert se voyait proposer des annonces expirées, payées
  //    au reranker, et invisibles ensuite dans son flux — qui filtre, lui.
  const lectureDurees = await chargerDurees(supabaseAdmin)
  if (!lectureDurees.ok) {
    return {
      status: 'no_config',
      proposals: [],
      notes: `Durées de la place illisibles : ${lectureDurees.raison}`,
      model: null,
    }
  }
  const vieAnnonceJours = lectureDurees.durees.vieAnnonceJours

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
    // L'EXPIRATION, DÉRIVÉE — jamais recopiée. Une annonce expirée n'est pas
    // « une annonce de moins » : c'est une annonce qu'on aurait PAYÉE pour
    // rien, et dont l'expert n'aurait rien vu.
    .or(activePublishedOrClause({ vieAnnonceJours }))
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
  //
  //  MÊME REPRISE QUE DANS L'AUTRE SENS. Le brouillon est indexé par le couple
  //  (annonce, profil) : il sert donc les deux directions sans distinction, et
  //  une note acquise ici épargne aussi le run de l'annonce correspondante.
  //
  //  ⚠️ L'EMPREINTE EST CALCULÉE DANS L'ORDRE (ANNONCE, PROFIL), PAS DANS
  //     L'ORDRE DE L'APPEL. Ici la requête est le PROFIL et les documents sont
  //     les ANNONCES — l'inverse de l'autre sens. Hacher dans l'ordre de
  //     l'appel donnerait deux empreintes différentes pour le même couple de
  //     textes, et supprimerait le partage que le paragraphe ci-dessus décrit :
  //     une régression de coût, décidée par accident.
  const empreintes = new Map(documents.map((d) => [d.id, empreinteDeNote(d.texte, requete)]))
  const acquises = await notesDejaAcquisesPourAnnonces(
    supabaseAdmin,
    documents.map((d) => d.id),
    profileId,
    s.rerank_model,
    empreintes,
  )
  const aNoter = acquises.size > 0 ? documents.filter((d) => !acquises.has(d.id)) : documents

  const notation = await rerankerTout({
    supabaseAdmin,
    domainId: p.domain_id,
    model: s.rerank_model,
    tailleLot: s.rerank_batch_size,
    requete,
    documents: aNoter,
    // SENS EXPERT → ANNONCES : c'est l'expert qui déclenche la notation, et non
    // les organisations dont les annonces sont notées. L'acteur est l'inverse
    // de l'autre sens — d'où l'argument obligatoire côté rerank.
    acteur: { type: 'profile', id: profileId },
    contexte: { profile_id: profileId },
    // Ici l'identifiant noté est celui de l'ANNONCE, et le profil est fixe :
    // c'est l'inverse de l'autre sens, mais la même clé de brouillon.
    memoriser: (notes) =>
      memoriserNotesParAnnonce(supabaseAdmin, profileId, s.rerank_model, notes, empreintes),
  })

  for (const [publicationId, score] of acquises) {
    if (!notation.scores.has(publicationId)) notation.scores.set(publicationId, score)
  }

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
    // `aucun_document` n'est PAS un empêchement : c'est un vivier vide, donc un
    // résultat que l'écran a le droit d'annoncer comme tel.
    empechement:
      notation.arret_code && notation.arret_code !== 'aucun_document'
        ? { quoi: 'arret_de_notation', code: notation.arret_code }
        : undefined,
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
