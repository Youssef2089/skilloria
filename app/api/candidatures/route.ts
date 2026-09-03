import { NextRequest, after } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { dispatchNotificationsForUsers } from '@/lib/notifications/dispatch'
import { newCandidatureInappLabels } from '@/lib/notifications/inapp-labels'
import { getOrgEntitlements } from '@/lib/entitlements'
// performUnlock est factorisé dans lib/unlock.ts (Lot 3), partagé avec la route
// unlock — garantit un chemin de dévoilement STRICTEMENT identique.
import { performUnlock } from '@/lib/unlock'
// A4 : dérivation CENTRALISÉE du deep-link notif selon le type d'org (org
// personnelle freelance → dashboard expert ; org cliente → dashboard entreprise).
import { publicationCandidaturesLinkForOrg } from '@/lib/collaboration-links'
import { isActivePublished } from '@/lib/publications/expiry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Nécessaire au `after()` du POST : sans plafond explicite, les envois lancés
// après la réponse n'ont pas le temps de s'exécuter sur Vercel.
export const maxDuration = 60

/**
 * POST /api/candidatures — l'expert candidate à une publication MATCHÉE.
 *
 * Body : { publication_id: uuid, cover_message?: string (0-2000) }
 *
 * Garde stricte :
 *  - requireAuth → expert authentifié
 *  - profile expert résolu via profiles.user_id = auth.uid()
 *  - MATCH EXIGÉ : un row matches WHERE publication_id=X AND profile_id=expert
 *    doit exister (sinon 403 forbidden — borrnage curation).
 *    + RLS candidatures_expert_insert exige déjà ce match côté base (défense
 *    en profondeur, cf. migration 20260603160000).
 *  - status FORCÉ à 'received' côté serveur.
 *  - match_id et ai_match_score copiés du match correspondant.
 *  - preview construite côté serveur (whitelist safe-fields).
 *  - UNIQUE (publication_id, profile_id) → re-candidature → PG 23505 → 409.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type Body = {
  publication_id?: unknown
  cover_message?: unknown
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

/**
 * Whitelist de construction de `candidatures.preview` — strictement les
 * champs NON-SENSIBLES (cf. migration boucle cœur §4).
 *
 * AUTORISÉS (24) : title, summary, skills, seniority, expert_type, tjm_min/max,
 *   salary_min/max, years_experience, years_total_experience, work_modes,
 *   languages, country, city, availability_status, availability_date,
 *   profile_score, branch_id, speciality_id, + 6 signaux CDI non-PII :
 *   cdi_status, cdi_notice_period, cdi_geo_mobility, cdi_contract_types,
 *   cdi_company_size, cdi_sectors.
 *
 * JAMAIS : phone, email, first_name, last_name, cv_url, cv_file_path,
 *   linkedin_url, address_line, postal_code, photo_url, birth_year, user_id,
 *   cdi_salary_min/max (déjà couverts par salary_min/max), cdi_motivations,
 *   cdi_career_goals (textes libres — réservés post-unlock).
 */
function buildPreview(profile: Record<string, unknown>): Record<string, unknown> {
  return {
    title: profile.title ?? null,
    summary: profile.summary ?? null,
    skills: Array.isArray(profile.skills) ? profile.skills : [],
    seniority: profile.seniority ?? null,
    expert_type: profile.expert_type ?? null,
    years_experience: profile.years_experience ?? null,
    years_total_experience: profile.years_total_experience ?? null,
    tjm_min: profile.tjm_min ?? null,
    tjm_max: profile.tjm_max ?? null,
    salary_min: profile.salary_min ?? null,
    salary_max: profile.salary_max ?? null,
    work_modes: Array.isArray(profile.work_modes) ? profile.work_modes : [],
    languages: Array.isArray(profile.languages) ? profile.languages : [],
    country: profile.country ?? null,
    city: profile.city ?? null,
    availability_status: profile.availability_status ?? null,
    availability_date: profile.availability_date ?? null,
    profile_score: profile.profile_score ?? null,
    branch_id: profile.branch_id ?? null,
    speciality_id: profile.speciality_id ?? null,
    // Lot synthèse candidat CDI — 6 signaux non-PII pour les candidatures
    // sur publications de type 'offre'. Affichés uniquement quand
    // publicationType==='offre' côté UI.
    cdi_status: profile.cdi_status ?? null,
    cdi_notice_period: profile.cdi_notice_period ?? null,
    cdi_geo_mobility: profile.cdi_geo_mobility ?? null,
    cdi_contract_types: Array.isArray(profile.cdi_contract_types) ? profile.cdi_contract_types : [],
    cdi_company_size: Array.isArray(profile.cdi_company_size) ? profile.cdi_company_size : [],
    cdi_sectors: Array.isArray(profile.cdi_sectors) ? profile.cdi_sectors : [],
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // ── Body ────────────────────────────────────────────────────────────────
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON', code: 'invalid_json' }, 400)
  }

  const publicationId = asString(body.publication_id)
  if (!publicationId || !UUID_REGEX.test(publicationId)) {
    return json({ error: 'Invalid publication_id', code: 'invalid_publication_id' }, 400)
  }
  const coverRaw = asString(body.cover_message)
  if (coverRaw && coverRaw.length > 2000) {
    return json({ error: 'cover_message too long (max 2000)', code: 'invalid_cover_message' }, 400)
  }
  const coverMessage = coverRaw

  // ── Profile expert ──────────────────────────────────────────────────────
  //  Lot synthèse candidat CDI : on charge aussi les 6 signaux non-PII
  //  cdi_* pour les inclure dans le snapshot preview (Lot UX synthèse).
  const { data: profile, error: pErr } = await auth.supabaseAdmin
    .from('profiles')
    .select(
      'id, user_id, domain_id, title, summary, skills, seniority, expert_type, ' +
        'years_experience, years_total_experience, tjm_min, tjm_max, salary_min, salary_max, ' +
        'work_modes, languages, country, city, availability_status, availability_date, ' +
        'profile_score, branch_id, speciality_id, ' +
        'cdi_status, cdi_notice_period, cdi_geo_mobility, cdi_contract_types, ' +
        'cdi_company_size, cdi_sectors',
    )
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (pErr || !profile) {
    return json({ error: 'Profile not found', code: 'profile_missing' }, 404)
  }
  const profileRow = profile as unknown as Record<string, unknown> & { id: string; domain_id: string }

  // ── Match requis (borrnage curation) ────────────────────────────────────
  const { data: match, error: mErr } = await auth.supabaseAdmin
    .from('matches')
    .select('id, score, status')
    .eq('publication_id', publicationId)
    .eq('profile_id', profileRow.id)
    .maybeSingle()
  if (mErr) {
    console.error('[candidatures:POST] match query failed', mErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!match) {
    return json({ error: 'No match for this publication', code: 'not_matched' }, 403)
  }
  const matchRow = match as unknown as { id: string; score: number; status: string }

  // ── Vérif publication : publiée + type candidatable + pas son propre besoin ─
  //  `created_by` = l'auteur de la publication (pour un besoin sous_traitance,
  //  l'expert publiant = owner de son organisation personnelle).
  const { data: pub, error: pubErr } = await auth.supabaseAdmin
    .from('publications')
    .select('id, status, type, created_by, published_at, expires_at')
    .eq('id', publicationId)
    .maybeSingle()
  if (pubErr || !pub) {
    return json({ error: 'Publication not found', code: 'not_found' }, 404)
  }
  const pubRow = pub as {
    id: string; status: string; type: string; created_by: string | null
    published_at: string | null; expires_at: string | null
  }
  // Ouverte = published NON expirée (règle 30j read-time, lib/publications/expiry).
  // On ne peut pas postuler à une annonce expirée.
  if (!isActivePublished(pubRow)) {
    return json({ error: 'Publication not available', code: 'publication_not_published' }, 409)
  }

  // ── C1 : types candidatables (whitelist EXPLICITE, incl. sous_traitance) ──
  //  L'exigence « candidat = expert » est déjà garantie IDENTIQUEMENT pour les
  //  3 types par (a) le profil expert résolu ci-dessus — un compte entreprise
  //  n'a PAS de profil (profiles = experts uniquement) → 404 profile_missing
  //  avant d'arriver ici — et (b) le match requis (les matches ne lient que des
  //  profils experts). Aucun compte entreprise ne peut donc candidater, ni à un
  //  besoin de sous-traitance ni à une mission/offre.
  const CANDIDATABLE_TYPES = ['mission', 'offre', 'sous_traitance']
  if (!CANDIDATABLE_TYPES.includes(pubRow.type)) {
    return json({ error: 'Type not candidatable', code: 'type_not_candidatable' }, 403)
  }

  // ── C2b : filet serveur — on ne candidate JAMAIS à son propre besoin ──────
  //  (le pool de matching exclut déjà l'expert publiant, cf. loadEligibleProfiles
  //  + run-for-expert ; ceci est la garde applicative de dernier recours.)
  if (pubRow.created_by && pubRow.created_by === auth.user.id) {
    return json({ error: 'Cannot apply to your own need', code: 'cannot_apply_own_need' }, 403)
  }

  // ── INSERT candidature ─────────────────────────────────────────────────
  const preview = buildPreview(profileRow)
  const { data: inserted, error: insertErr } = await auth.supabaseAdmin
    .from('candidatures')
    .insert({
      publication_id: publicationId,
      profile_id: profileRow.id,
      match_id: matchRow.id,
      domain_id: profileRow.domain_id,
      cover_message: coverMessage,
      ai_match_score: matchRow.score,
      status: 'received',
      preview,
    })
    .select('id, status, created_at')
    .single()

  if (insertErr) {
    // Re-candidature : PG 23505 unique_violation sur (publication_id, profile_id)
    if ((insertErr as { code?: string }).code === '23505') {
      return json({ error: 'Already applied', code: 'already_applied' }, 409)
    }
    console.error('[candidatures:POST] insert failed', insertErr.message)
    return json({ error: 'Insert failed', code: 'db_error' }, 500)
  }
  const row = inserted as unknown as { id: string; status: string; created_at: string }

  // ── Notif ORG : nouvelle candidature (best-effort, n'invalide pas le 201) ─
  //  Lot 2c — D3 : on notifie chaque membre actif de l'org propriétaire de la
  //  publication. La locale de chaque membre est lue depuis users.locale.
  //  channel='inapp', type='new_candidature_received', entity_id=candidature.id,
  //  link_url → vue candidatures de l'annonce.
  try {
    //  A4 : on charge aussi le TYPE d'org (+ propriétaire pour l'org perso) afin
    //  de dériver un deep-link joignable par le propriétaire (org cliente →
    //  dashboard entreprise ; org personnelle freelance → dashboard expert).
    const { data: pubOrg } = await auth.supabaseAdmin
      .from('publications')
      .select('id, organization_id, title, organizations(org_type, owner_user_id)')
      .eq('id', publicationId)
      .maybeSingle()
    const pubInfo = pubOrg as {
      id: string
      organization_id: string
      title: string
      organizations: { org_type: string | null; owner_user_id: string | null }
        | { org_type: string | null; owner_user_id: string | null }[]
        | null
    } | null
    if (pubInfo) {
      const orgRel = Array.isArray(pubInfo.organizations)
        ? pubInfo.organizations[0]
        : pubInfo.organizations
      const orgType = orgRel?.org_type ?? null
      // user_type du propriétaire (org personnelle uniquement) → segment expert.
      let ownerUserType: string | null = null
      if (orgType === 'freelance' && orgRel?.owner_user_id) {
        const { data: ownerRow } = await auth.supabaseAdmin
          .from('users')
          .select('user_type')
          .eq('id', orgRel.owner_user_id)
          .maybeSingle()
        ownerUserType = (ownerRow as { user_type: string | null } | null)?.user_type ?? null
      }
      const { data: members } = await auth.supabaseAdmin
        .from('organization_members')
        // `role` ajouté : il départage la CLOCHE (tous les membres actifs) des
        // envois externes (admin/editor seulement, cf. plus bas).
        .select('user_id, role, users!organization_members_user_id_fkey(id, locale)')
        .eq('organization_id', pubInfo.organization_id)
        .eq('status', 'active')
      type Member = {
        user_id: string
        role: string | null
        users: { id: string; locale: string | null } | { id: string; locale: string | null }[]
      }
      const membersTyped = (members ?? []) as unknown as Member[]
      const linkUrl = publicationCandidaturesLinkForOrg(publicationId, { orgType, ownerUserType })
      // Libellés de la cloche : i18n partagée avec l'e-mail du même événement
      // (cf. lib/notifications/inapp-labels). Ils vivaient en dur ici, dans
      // deux tables `Record<locale, …>`.
      const rows = membersTyped.map((m) => {
        const u = Array.isArray(m.users) ? m.users[0] : m.users
        const inapp = newCandidatureInappLabels(u?.locale ?? null, pubInfo.title)
        return {
          user_id: m.user_id,
          domain_id: profileRow.domain_id,
          type: 'new_candidature_received',
          channel: 'inapp',
          title: inapp.title,
          body: inapp.body,
          link_url: linkUrl,
          status: 'pending',
          entity_id: row.id,
        }
      })
      if (rows.length > 0) {
        const { error: notifErr } = await auth.supabaseAdmin.from('notifications').insert(rows)
        if (notifErr) {
          console.error('[candidatures:POST] org notif insert failed', notifErr.message)
        } else {
          // E-MAIL / SMS : `admin` et `editor` SEULEMENT. Un `viewer` est en
          // lecture seule — débloquer, refuser ou sélectionner un candidat
          // exigent `requireOrgRole(auth, 'editor')`. Lui envoyer un SMS
          // payant pour une action qu'il n'a pas le droit d'exécuter, c'est le
          // rappeler vers une impasse. La CLOCHE, elle, reste pour tout le
          // monde : elle est passive et informative.
          const actingUserIds = membersTyped
            .filter((m) => m.role === 'admin' || m.role === 'editor')
            .map((m) => m.user_id)
          if (actingUserIds.length > 0) {
            // ⚠️ PIÈGE VERCEL : sans `after()`, ce travail lancé après la
            // réponse est TUÉ silencieusement — rien ne partirait et aucune
            // erreur ne s'afficherait. `after()` + `maxDuration` (en tête de
            // fichier) sont indispensables.
            after(async () => {
              try {
                await dispatchNotificationsForUsers(auth.supabaseAdmin, actingUserIds, {
                  events: ['new_candidature_received'],
                })
              } catch (e) {
                console.error('[candidatures:POST] dispatch failed (best-effort)', e)
              }
            })
          }
        }
      }
    }
  } catch (err) {
    console.error('[candidatures:POST] org notif threw', err)
  }

  // ── Audit best-effort ──────────────────────────────────────────────────
  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: profileRow.domain_id,
    action: 'candidature_submitted',
    entity_type: 'candidature',
    entity_id: row.id,
    detail: {
      publication_id: publicationId,
      match_id: matchRow.id,
      ai_match_score: matchRow.score,
      has_cover_message: coverMessage !== null,
    },
  })

  // ── AUTO-DÉVOILEMENT TOP-1 (Lot 2) — règle « 1 candidat dévoilé » du free ─
  //  Si le package de l'org donne revealed_candidates_per_publication = N (non
  //  illimité) et qu'il reste des places (déjà dévoilées < N), on dévoile
  //  AUTOMATIQUEMENT la candidature qui a le MEILLEUR ai_match_score de la
  //  publication — via le MÊME chemin que l'unlock manuel (performUnlock), mais
  //  SANS consommer manual_unlocks (c'est le dévoilement inclus).
  //
  //  V1 assumée — on ne « rétrograde » JAMAIS un dévoilé : si un meilleur score
  //  arrive après que la place est prise (déjà dévoilées >= N), il ne remplace
  //  pas le dévoilé en place (premier meilleur servi).
  //
  //  Entièrement NON-BLOQUANT : toute erreur ici n'invalide pas la création de
  //  candidature (la candidature reste créée ; l'org pourra dévoiler manuellement).
  try {
    const { data: pubForEnts } = await auth.supabaseAdmin
      .from('publications')
      .select('organization_id, domain_id')
      .eq('id', publicationId)
      .maybeSingle()
    const pubEnts = pubForEnts as { organization_id: string; domain_id: string } | null
    if (pubEnts) {
      const ents = await getOrgEntitlements(auth.supabaseAdmin, pubEnts.organization_id)
      const revealN = ents.limits.revealedCandidatesPerPublication
      // null = illimité → aucun auto : l'org dévoile manuellement sans limite.
      if (revealN !== null) {
        const { count: revealedCount } = await auth.supabaseAdmin
          .from('candidatures')
          .select('id', { count: 'exact', head: true })
          .eq('publication_id', publicationId)
          .in('status', ['unlocked', 'selected'])
        if ((revealedCount ?? 0) < revealN) {
          // La candidature qui vient d'être créée est-elle le meilleur score de
          // la publication ? (égalité de score → la plus ancienne l'emporte.)
          const { data: topRow } = await auth.supabaseAdmin
            .from('candidatures')
            .select('id')
            .eq('publication_id', publicationId)
            .order('ai_match_score', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()
          const top = topRow as { id: string } | null
          if (top && top.id === row.id) {
            const res = await performUnlock(auth.supabaseAdmin, row.id, {
              auto: true,
              actorUserId: auth.user.id,
            })
            if (!res.ok) {
              console.warn('[candidatures:POST] auto-reveal performUnlock failed', res.code)
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[candidatures:POST] auto-reveal block threw (non-blocking)', err)
  }

  return json(
    {
      id: row.id,
      status: row.status,
      created_at: row.created_at,
    },
    201,
  )
}
