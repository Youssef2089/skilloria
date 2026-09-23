// lib/candidatures/depot.ts
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ UNE CANDIDATURE EXISTE AVEC SA NOTE ET SON RÉSUMÉ, OU ELLE N'EXISTE PAS. ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ LA DÉCISION, ARBITRÉE PAR YOUSSEF LE 23/09/2026 ───────────────────────┐
// │ « Une candidature avec sa note et son résumé, ou pas de candidature.     │
// │   Une candidature nue chez un client, c'est amateur. On ne la livre      │
// │   pas. »                                                                 │
// │                                                                          │
// │ ELLE REMPLACE la règle précédente — « rien ne bloque une candidature » — │
// │ qui vivait en tête de `20260907200000_pannes_de_redaction.sql` et dans   │
// │ un commentaire de la route de dépôt.                                     │
// └──────────────────────────────────────────────────────────────────────────┘
//
// ═══ L'ORDRE EST LE CORRECTIF. TOUT LE RESTE EN DÉCOULE ═══════════════════
//   AVANT : insertion → réponse 201 → jugement dans un `after()` → mise à
//   jour de la note. Entre l'insertion et la mise à jour, la candidature
//   existait NUE ; si le jugement échouait, elle le restait pour toujours.
//   APRÈS : jugement → insertion AVEC sa note. Le jugement échoue ⇒ rien n'est
//   écrit. Il n'y a plus d'instant où l'objet incomplet existe.
//
// ═══ CE QUE CE MODULE EST : LE **SEUL** CHEMIN DE DÉPÔT ══════════════════
//   Deux appelants — `POST /api/candidatures` (l'expert) et
//   `POST /api/admin/depots-en-echec` (le bouton RELANCER). Le second rejoue
//   EXACTEMENT le premier, parce que c'est la même fonction et non une copie :
//   mêmes gardes, même jugement, même insertion, même dévoilement, même
//   notification, même audit. Un chemin parallèle serait un jumeau (§E.20), et
//   un jumeau de rejeu est le pire de tous — il ne sert que le jour où le
//   chemin normal a déjà échoué.
//
// ═══ L'EXPERT N'EST PAS PRÉVENU, ET C'EST ARBITRÉ ════════════════════════
//   « L'expert ne paie pas une panne qui ne le concerne pas, et on ne lui
//   montre pas nos coulisses. » Aucun message d'erreur, aucun bouton
//   « réessayer ».
//
//   ⚠️ IL FAUT DIRE CE QUE ÇA COÛTE, PARCE QUE ÇA RESSEMBLE À §E.27 :
//      l'écran affiche « votre candidature a été envoyée » alors que rien n'a
//      été écrit. C'est un tampon de succès sur un travail qui n'a pas eu
//      lieu — la forme exacte du défaut qu'on ferme ailleurs.
//      Youssef a nommé cette conséquence lui-même (« l'expert croit avoir
//      postulé, l'organisation ignore qu'elle devait recevoir quelque chose »)
//      et c'est PRÉCISÉMENT la raison pour laquelle l'écran d'erreurs
//      `/admin/depots-en-echec` est BLOQUANT en supervision tant qu'il n'est
//      pas vide. Le tampon est assumé ; ce qui le rend tenable est qu'il ne
//      soit jamais silencieux CÔTÉ PLATEFORME.
//      Sans cet écran, ce module serait un défaut. Avec lui, c'est un
//      arbitrage. La différence tient à un seul contrôle, et il est gardé.
//
// ═══ ET LE REJEU N'EST JAMAIS AUTOMATIQUE ════════════════════════════════
//   Refusé par Youssef : « ça tournerait en boucle et ça coûterait. » Une
//   relance est un geste d'administrateur, sur une ligne qu'il a lue.

import { after } from 'next/server'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'
import { dispatchNotificationsForUsers } from '@/lib/notifications/dispatch'
import { newCandidatureInappLabels } from '@/lib/notifications/inapp-labels'
import { getOrgEntitlements } from '@/lib/entitlements'
import { performUnlock } from '@/lib/unlock'
import { publicationCandidaturesLinkForOrg } from '@/lib/collaboration-links'
import { isActivePublished } from '@/lib/publications/expiry'
import { jugerCandidature, type CausePanne } from '@/lib/candidatures/ai-assessment'
import { chargerDurees, DUREES_ILLISIBLES_CODE, type Durees } from '@/lib/durees'
import { FENETRE_DEPOT_MS } from '@/lib/candidatures/depot-etats'

/**
 * LES REFUS, AVEC LEUR STATUT — une seule table, lue par les deux appelants.
 *
 * Elle vit ici et non dans la route : le bouton RELANCER doit rendre le MÊME
 * verdict que le dépôt, et deux tables de correspondance divergeraient
 * (§E.20). Le jour où un refus s'ajoute, il s'ajoute une fois.
 */
export const REFUS_DEPOT = {
  [DUREES_ILLISIBLES_CODE]: 503,
  profile_missing: 404,
  profil_verification_indisponible: 503,
  not_matched: 403,
  db_error: 500,
  objet_verification_indisponible: 503,
  not_found: 404,
  publication_not_published: 409,
  type_not_candidatable: 403,
  cannot_apply_own_need: 403,
  already_applied: 409,
} as const

export type CodeRefus = keyof typeof REFUS_DEPOT

/**
 * TROIS ISSUES, ET AUCUNE QUATRIÈME.
 *
 * L'union est FERMÉE : un appelant qui oublie une branche ne compile pas. Il
 * n'existe pas d'état « on ne sait pas » qui pourrait se lire comme un succès
 * — c'est la leçon de §D.13, appliquée ici à un verdict plutôt qu'à un écran.
 */
export type IssueDepot =
  /** La candidature existe, complète. */
  | { issue: 'deposee'; candidatureId: string; status: string; createdAt: string }
  /** Une garde a refusé. Rien n'a été tenté, rien n'a été payé. */
  | { issue: 'refusee'; code: CodeRefus }
  /**
   * Le jugement n'a pas abouti : AUCUNE candidature n'a été écrite, et la
   * ligne de journal attend une relance d'administrateur.
   */
  | { issue: 'sans_jugement'; cause: CausePanne; raison: string }

/**
 * Whitelist de construction de `candidatures.preview` — strictement les
 * champs NON-SENSIBLES (cf. migration boucle cœur §4).
 *
 * AUTORISÉS (24) : title, summary, skills, seniorities, expert_type, tjm_min/max,
 *   salary_min/max, years_experience, years_total_experience, work_modes,
 *   languages, country, city, availability_status, availability_date,
 *   profile_score, branch_id, speciality_ids, + 6 signaux CDI non-PII :
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
    seniorities: Array.isArray(profile.seniorities) ? profile.seniorities : [],
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
    speciality_ids: Array.isArray(profile.speciality_ids) ? profile.speciality_ids : [],
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

/** Les types de publication auxquels un expert peut candidater. */
const CANDIDATABLE_TYPES = ['mission', 'offre', 'sous_traitance']


type ProfilDepot = Record<string, unknown> & {
  id: string
  user_id: string
  domain_id: string
}

type AnnonceDepot = {
  id: string
  status: string
  type: string
  created_by: string | null
  published_at: string | null
  expires_at: string | null
  domain_id: string
  title: string | null
  description: string | null
  skills_required: string[] | null
  seniorities: string[] | null
}

/**
 * LE DÉPÔT — gardes, jugement, écriture, dévoilement, notification, audit.
 *
 * Ne lève jamais pour un refus métier : il rend une issue. Une exception qui
 * traverse est une vraie panne, et elle doit remonter.
 */
export async function deposerCandidature(args: {
  supabaseAdmin: SupabaseClient
  profileId: string
  publicationId: string
  coverMessage: string | null
  /**
   * D'où vient ce dépôt. N'entre dans AUCUNE décision — seulement dans le
   * journal et dans l'audit. Si elle décidait de quelque chose, le rejeu
   * cesserait d'être le même chemin.
   */
  origine: 'expert' | 'relance_admin'
}): Promise<IssueDepot> {
  const { supabaseAdmin, profileId, publicationId, coverMessage } = args

  // ── LES DURÉES SONT LUES ICI ────────────────────────────────────────────
  //  Aucun défaut dans le code (cf. lib/durees.ts) : illisibles, on REFUSE en
  //  le nommant plutôt que de servir une durée inventée. Même parti pris que
  //  `matching_settings` — un repli codé en dur devient une seconde source de
  //  vérité, et elle prend la main le jour où l'on comprend le moins.
  const lectureDurees = await chargerDurees(supabaseAdmin)
  if (!lectureDurees.ok) {
    console.error('[depot] durées de la place illisibles', lectureDurees.raison)
    return { issue: 'refusee', code: DUREES_ILLISIBLES_CODE }
  }
  const durees: Durees = lectureDurees.durees

  // ── Profil expert ───────────────────────────────────────────────────────
  //  Lot synthèse candidat CDI : on charge aussi les 6 signaux non-PII cdi_*
  //  pour les inclure dans le snapshot preview.
  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select(
      'id, user_id, domain_id, title, summary, skills, seniorities, expert_type, ' +
        'years_experience, years_total_experience, tjm_min, tjm_max, salary_min, salary_max, ' +
        'work_modes, languages, country, city, availability_status, availability_date, ' +
        'profile_score, branch_id, speciality_ids, ' +
        'cdi_status, cdi_notice_period, cdi_geo_mobility, cdi_contract_types, ' +
        'cdi_company_size, cdi_sectors',
    )
    .eq('id', profileId)
    .maybeSingle()
  // Une lecture de `profiles` en panne n'est pas un profil absent (§E.42) :
  // 503 qui se réessaie, jamais le 404 qui se croit.
  if (pErr) {
    console.error('[depot] profil ILLISIBLE', { profileId, message: pErr.message })
    return { issue: 'refusee', code: 'profil_verification_indisponible' }
  }
  if (!profile) return { issue: 'refusee', code: 'profile_missing' }
  const profileRow = profile as unknown as ProfilDepot

  // ── Match requis (bornage curation) ─────────────────────────────────────
  const { data: match, error: mErr } = await supabaseAdmin
    .from('matches')
    .select('id, relevance_score, status')
    .eq('publication_id', publicationId)
    .eq('profile_id', profileRow.id)
    .maybeSingle()
  if (mErr) {
    console.error('[depot] match illisible', mErr.message)
    return { issue: 'refusee', code: 'db_error' }
  }
  if (!match) return { issue: 'refusee', code: 'not_matched' }
  const matchRow = match as unknown as { id: string; relevance_score: number | null; status: string }

  // ── Vérif publication : publiée + type candidatable + pas son propre besoin ─
  const { data: pub, error: pubErr } = await supabaseAdmin
    .from('publications')
    .select(
      'id, status, type, created_by, published_at, expires_at, domain_id, ' +
        'title, description, skills_required, seniorities',
    )
    .eq('id', publicationId)
    .maybeSingle()
  // « Cette annonce n'existe pas », dit d'une annonce réelle au moment de
  // postuler (§E.42). La panne sort en 503, l'absence garde son 404.
  if (pubErr) {
    console.error('[depot] annonce ILLISIBLE', { publicationId, message: pubErr.message })
    return { issue: 'refusee', code: 'objet_verification_indisponible' }
  }
  if (!pub) return { issue: 'refusee', code: 'not_found' }
  const pubRow = pub as unknown as AnnonceDepot

  // Ouverte = published NON expirée (règle read-time, lib/publications/expiry).
  if (!isActivePublished(pubRow, { vieAnnonceJours: durees.vieAnnonceJours })) {
    return { issue: 'refusee', code: 'publication_not_published' }
  }

  //  L'exigence « candidat = expert » est déjà garantie IDENTIQUEMENT pour les
  //  3 types par (a) le profil expert résolu ci-dessus — un compte entreprise
  //  n'a PAS de profil (profiles = experts uniquement) — et (b) le match requis
  //  (les matches ne lient que des profils experts).
  if (!CANDIDATABLE_TYPES.includes(pubRow.type)) {
    return { issue: 'refusee', code: 'type_not_candidatable' }
  }

  // ── On ne candidate JAMAIS à son propre besoin ──────────────────────────
  //  ⚠️ LA COMPARAISON PORTE SUR L'EXPERT, PAS SUR L'APPELANT. Sur le chemin
  //     normal les deux coïncident (le profil est résolu depuis la session) ;
  //     sur une relance, l'appelant est un administrateur. Comparer à
  //     l'appelant aurait laissé passer, en relance, exactement ce que cette
  //     garde refuse.
  if (pubRow.created_by && pubRow.created_by === profileRow.user_id) {
    return { issue: 'refusee', code: 'cannot_apply_own_need' }
  }

  // ── DÉJÀ CANDIDATÉ ? ON REGARDE **AVANT** DE PAYER ──────────────────────
  //  L'unicité (publication_id, profile_id) reste la garantie — elle est en
  //  base et ne dépend d'aucune discipline (§E.31). Ce test-ci n'est PAS une
  //  seconde garde : il évite d'appeler le modèle pour un dossier qui sera
  //  refusé trois lignes plus bas. Tant que le jugement suivait l'insertion,
  //  la question ne se posait pas ; elle se pose depuis qu'il la précède.
  const { data: dejaRow, error: dejaErr } = await supabaseAdmin
    .from('candidatures')
    .select('id')
    .eq('publication_id', publicationId)
    .eq('profile_id', profileRow.id)
    .maybeSingle()
  if (dejaErr) {
    console.error('[depot] candidature existante illisible', dejaErr.message)
    return { issue: 'refusee', code: 'db_error' }
  }
  if (dejaRow) return { issue: 'refusee', code: 'already_applied' }

  // ── L'IDENTIFIANT EST POSÉ ICI, AVANT L'APPEL ───────────────────────────
  //  Le jugement le porte dans sa comptabilité de dépense et dans ses
  //  journaux. Le laisser à la base l'obligerait à naître APRÈS l'appel, et
  //  la ligne de dépense ne désignerait plus rien.
  const candidatureId = randomUUID()

  // ── LE JOURNAL DU DÉPÔT, ÉCRIT **AVANT** LE JUGEMENT ────────────────────
  //
  //  ⚠️ C'EST LA MOITIÉ QUI COMPTE. L'appel au modèle dure jusqu'à 30 s DANS
  //     la requête, et c'est exactement là qu'une fonction se fait tuer.
  //     Écrite après, cette ligne n'existerait pas dans le seul cas où elle
  //     est indispensable — §E.63, payé huit jours plus tôt sur les verdicts
  //     de cron.
  //
  //  BEST-EFFORT, ET C'EST DÉLIBÉRÉ : si le journal refuse, on DÉPOSE quand
  //  même. Faire échouer un dépôt parce qu'on n'a pas su l'OBSERVER
  //  transformerait un défaut d'observation en perte de dossier. La
  //  conséquence est nommée : ce dépôt-là ne sera pas relançable, et il ne
  //  fera pas attendre le dévoilement d'un concurrent.
  await ouvrirJournal(supabaseAdmin, {
    publicationId,
    profileId: profileRow.id,
    domainId: pubRow.domain_id,
    coverMessage,
  })

  // ── LE JUGEMENT, **AVANT** L'ÉCRITURE ───────────────────────────────────
  //
  //  C'est ICI que Claude intervient, et nulle part ailleurs : il répond à
  //  « que vaut ce dossier ? », pas à « pourquoi ce profil apparaît-il ? » —
  //  cette seconde question appartient au reranking.
  //
  //  Rôle et secteur, rien d'autre, n'est demandé au parcours. Aucune date :
  //  ce qu'on ne charge pas ne peut pas fuir.
  const { data: expRows, error: expErr } = await supabaseAdmin
    .from('profile_experiences')
    .select('role, sector')
    .eq('profile_id', profileRow.id)
    .limit(20)
  if (expErr) {
    // Le parcours ENRICHIT le jugement, il ne le conditionne pas : on juge sur
    // le reste plutôt que de ne pas juger. Mais on le DIT.
    console.warn('[depot] parcours illisible — jugement sur le reste du dossier', {
      publicationId,
      profileId: profileRow.id,
      message: expErr.message,
    })
  }
  const parcours = ((expRows ?? []) as Array<{ role: string | null; sector: string | null }>).map(
    (e) => ({ role: e.role, sector: e.sector }),
  )

  const resultat = await jugerCandidature({
    supabaseAdmin,
    domainId: pubRow.domain_id,
    candidatureId,
    // L'expert qui dépose : c'est lui qui déclenche le jugement.
    profileId: profileRow.id,
    entree: {
      locale: 'fr',
      annonce: {
        type: pubRow.type,
        title: pubRow.title ?? '',
        description: pubRow.description ?? '',
        skills_required: pubRow.skills_required ?? [],
        seniorities: pubRow.seniorities ?? [],
      },
      profil: {
        title: (profileRow.title as string | null) ?? null,
        summary: (profileRow.summary as string | null) ?? null,
        skills: Array.isArray(profileRow.skills) ? (profileRow.skills as string[]) : [],
        seniorities: Array.isArray(profileRow.seniorities)
          ? (profileRow.seniorities as string[])
          : [],
        years_total_experience:
          typeof profileRow.years_total_experience === 'number'
            ? profileRow.years_total_experience
            : null,
        // Rôles et secteurs seulement. L'employeur n'est PAS sélectionné : il
        // ne peut donc pas partir, même par étourderie — et le pitch est lu
        // par l'organisation AVANT le déverrouillage.
        experiences: parcours,
      },
    },
  })

  if (!resultat.ok) {
    // RIEN N'EST ÉCRIT. Le journal porte la cause, et l'écran d'erreurs la
    // rend relançable — c'est le seul endroit où ce dépôt existe encore.
    console.warn('[depot] aucun jugement rendu — AUCUNE candidature écrite', {
      publicationId,
      profileId: profileRow.id,
      cause: resultat.cause,
      raison: resultat.raison,
    })
    await solderJournalEnEchec(supabaseAdmin, {
      publicationId,
      profileId: profileRow.id,
      cause: resultat.cause,
      detail: resultat.raison,
    })
    return { issue: 'sans_jugement', cause: resultat.cause, raison: resultat.raison }
  }

  // ── L'ÉCRITURE — UNE SEULE, AVEC SA NOTE ET SON RÉSUMÉ ──────────────────
  const preview = buildPreview(profileRow)
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('candidatures')
    .insert({
      id: candidatureId,
      publication_id: publicationId,
      profile_id: profileRow.id,
      match_id: matchRow.id,
      domain_id: profileRow.domain_id,
      cover_message: coverMessage,
      // LA NOTE EST ÉCRITE ICI, DANS LA MÊME OPÉRATION QUE LA CANDIDATURE.
      // Elle ne peut donc pas manquer : il n'existe aucun instant entre les
      // deux. La contrainte `candidatures_complete_ou_inexistante` refuse de
      // toute façon toute autre écriture (§E.31).
      ai_match_score: resultat.jugement.score,
      ai_assessment: {
        reason: resultat.jugement.reason,
        pitch_org: resultat.jugement.pitch_org,
        model: resultat.jugement.model,
        evaluated_at: new Date().toISOString(),
      },
      ai_model: resultat.jugement.model,
      status: 'received',
      preview,
    })
    .select('id, status, created_at')
    .single()

  if (insertErr) {
    // Re-candidature : PG 23505 unique_violation sur (publication_id, profile_id).
    // Le test préalable l'a déjà écartée ; rester ici signifie qu'une
    // candidature concurrente est arrivée PENDANT le jugement. Rare, et payé —
    // il n'y a rien à faire d'autre que de le dire.
    if ((insertErr as { code?: string }).code === '23505') {
      console.warn('[depot] candidature concurrente arrivée pendant le jugement', {
        publicationId,
        profileId: profileRow.id,
      })
      await solderJournalEnDepot(supabaseAdmin, {
        publicationId,
        profileId: profileRow.id,
        candidatureId: null,
      })
      return { issue: 'refusee', code: 'already_applied' }
    }
    console.error('[depot] insertion refusée', insertErr.message)
    // ⚠️ LA CONTRAINTE DE COMPLÉTUDE PEUT ÊTRE LA CAUSE, et alors le jugement
    //    a rendu quelque chose que la base juge nu. On garde la ligne en
    //    ÉCHEC plutôt qu'en cours : c'est bien un dépôt qui n'a pas abouti.
    await solderJournalEnEchec(supabaseAdmin, {
      publicationId,
      profileId: profileRow.id,
      cause: 'reponse_illisible',
      detail: `insertion refusée : ${insertErr.message}`,
    })
    return { issue: 'refusee', code: 'db_error' }
  }
  const row = inserted as unknown as { id: string; status: string; created_at: string }

  await solderJournalEnDepot(supabaseAdmin, {
    publicationId,
    profileId: profileRow.id,
    candidatureId: row.id,
  })

  // ── LE DÉVOILEMENT INCLUS, DANS LA REQUÊTE ──────────────────────────────
  //  Il vivait dans un `after()`, derrière le jugement. Le jugement est
  //  maintenant devant : le peu qui reste (quelques lectures et, au plus, un
  //  dévoilement) ne pèse rien face aux trente secondes déjà attendues, et il
  //  cesse d'être exposé au couperet d'après-réponse (§E.5).
  //  Et surtout : la RELANCE doit rendre l'état final, pas un état en cours.
  await devoilementInclus(supabaseAdmin, {
    publicationId,
    candidatureId: row.id,
    acteurUserId: profileRow.user_id,
    fenetreEchangeJours: durees.fenetreEchangeJours,
  })

  await notifierOrganisation(supabaseAdmin, {
    publicationId,
    candidatureId: row.id,
    domainId: profileRow.domain_id,
  })

  // ── Audit ───────────────────────────────────────────────────────────────
  await logAudit({
    supabaseAdmin,
    // L'AUTEUR DE L'ACTE EST L'EXPERT, sur les deux chemins. Une relance
    // d'administrateur écrit SA propre ligne d'audit, séparément : deux actes
    // distincts, deux traces (cf. app/api/admin/depots-en-echec).
    user_id: profileRow.user_id,
    domain_id: profileRow.domain_id,
    action: 'candidature_submitted',
    entity_type: 'candidature',
    entity_id: row.id,
    detail: {
      publication_id: publicationId,
      match_id: matchRow.id,
      // LA NOTE EXISTE AU MOMENT DE L'AUDIT, et c'est nouveau : elle était
      // laissée nulle ici parce que le jugement n'avait pas encore eu lieu.
      ai_match_score: resultat.jugement.score,
      has_cover_message: coverMessage !== null,
      origine: args.origine,
    },
  })

  return {
    issue: 'deposee',
    candidatureId: row.id,
    status: row.status,
    createdAt: row.created_at,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  LE JOURNAL DES DÉPÔTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ouvre — ou rouvre — la ligne de journal du couple (annonce, expert).
 *
 * `upsert` sur la clé (publication_id, profile_id) : une relance reprend la
 * MÊME ligne et incrémente son compteur, plutôt que d'empiler des doublons que
 * l'écran d'erreurs devrait ensuite dédoublonner.
 */
async function ouvrirJournal(
  admin: SupabaseClient,
  args: {
    publicationId: string
    profileId: string
    domainId: string | null
    coverMessage: string | null
  },
): Promise<void> {
  const { data, error } = await admin.rpc('ouvrir_depot_candidature', {
    p_publication_id: args.publicationId,
    p_profile_id: args.profileId,
    p_domain_id: args.domainId,
    p_cover_message: args.coverMessage,
  })
  if (error) {
    console.error('[depot] journal NON OUVERT — ce dépôt ne sera pas relançable', {
      publicationId: args.publicationId,
      profileId: args.profileId,
      message: error.message,
    })
    return
  }
  if (data !== true) {
    // Aucune ligne n'a bougé : ce n'est pas « rien à faire ». Une valeur
    // neutre n'est pas un fait (§E.22).
    console.error('[depot] journal NON OUVERT — aucune ligne écrite', {
      publicationId: args.publicationId,
      profileId: args.profileId,
    })
  }
}

async function solderJournalEnEchec(
  admin: SupabaseClient,
  args: { publicationId: string; profileId: string; cause: CausePanne; detail: string },
): Promise<void> {
  const { error } = await admin
    .from('candidature_depots')
    .update({
      etat: 'echec',
      cause: args.cause,
      // Le détail est une phrase de journal, jamais le texte produit : une
      // panne n'a pas de contenu.
      detail: args.detail,
      termine_at: new Date().toISOString(),
    })
    .eq('publication_id', args.publicationId)
    .eq('profile_id', args.profileId)
  if (error) {
    console.error('[depot] échec NON JOURNALISÉ — il n apparaîtra sur aucun écran', {
      publicationId: args.publicationId,
      profileId: args.profileId,
      message: error.message,
    })
  }
}

async function solderJournalEnDepot(
  admin: SupabaseClient,
  args: { publicationId: string; profileId: string; candidatureId: string | null },
): Promise<void> {
  if (args.candidatureId === null) {
    // Une candidature concurrente occupe déjà le couple : notre ligne n'a plus
    // d'objet. On la SUPPRIME plutôt que de la marquer « déposée » en
    // désignant la candidature d'un autre passage — la contrainte l'interdit
    // d'ailleurs, et elle a raison.
    const { error } = await admin
      .from('candidature_depots')
      .delete()
      .eq('publication_id', args.publicationId)
      .eq('profile_id', args.profileId)
    if (error) {
      console.error('[depot] ligne concurrente NON RETIRÉE — elle restera « en cours »', {
        publicationId: args.publicationId,
        message: error.message,
      })
    }
    return
  }
  const { error } = await admin
    .from('candidature_depots')
    .update({
      etat: 'depose',
      cause: null,
      detail: null,
      // LE MESSAGE DE MOTIVATION PART ICI. Il ne servait qu'à rejouer ; le
      // dépôt a abouti, la candidature le porte. Le garder serait une
      // conservation sans finalité.
      cover_message: null,
      candidature_id: args.candidatureId,
      termine_at: new Date().toISOString(),
    })
    .eq('publication_id', args.publicationId)
    .eq('profile_id', args.profileId)
  if (error) {
    console.error('[depot] dépôt abouti NON SOLDÉ — la ligne restera sur l écran d erreurs', {
      publicationId: args.publicationId,
      candidatureId: args.candidatureId,
      message: error.message,
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  LA NOTIFICATION DE L'ORGANISATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * On notifie chaque membre actif de l'org propriétaire de la publication.
 * La locale de chaque membre est lue depuis `users.locale`.
 *
 * Entièrement best-effort : le dépôt est acquis, on ne le défait pas.
 */
async function notifierOrganisation(
  admin: SupabaseClient,
  args: { publicationId: string; candidatureId: string; domainId: string },
): Promise<void> {
  try {
    //  On charge aussi le TYPE d'org (+ propriétaire pour l'org perso) afin de
    //  dériver un deep-link joignable par le propriétaire (org cliente →
    //  dashboard entreprise ; org personnelle freelance → dashboard expert).
    const { data: pubOrg, error: pubOrgErr } = await admin
      .from('publications')
      .select('id, organization_id, title, organizations(org_type, owner_user_id)')
      .eq('id', args.publicationId)
      .maybeSingle()
    // ⚠️ CETTE PANNE-LÀ EST PIRE QUE CELLE DES MEMBRES, PLUS BAS : `pubInfo`
    //    nul saute le bloc ENTIER — pas de destinataires, pas de cloche, pas
    //    d'e-mail, et pas une ligne de journal. Le dépôt, lui, a réussi :
    //    l'expert croit avoir postulé auprès de quelqu'un qui ne saura jamais
    //    qu'il existe.
    //    Le dépôt est acquis, on ne le défait pas — on JOURNALISE, et on
    //    sépare les deux causes, parce qu'elles ne se réparent pas pareil :
    //    une lecture en panne se rejoue, une annonce disparue non.
    if (pubOrgErr) {
      console.error('[depot] annonce ILLISIBLE — PERSONNE ne sera notifié', {
        publicationId: args.publicationId,
        message: pubOrgErr.message,
      })
    } else if (!pubOrg) {
      console.error('[depot] annonce INTROUVABLE — personne ne sera notifié', {
        publicationId: args.publicationId,
      })
    }
    const pubInfo = pubOrg as {
      id: string
      organization_id: string
      title: string
      organizations:
        | { org_type: string | null; owner_user_id: string | null }
        | { org_type: string | null; owner_user_id: string | null }[]
        | null
    } | null
    if (!pubInfo) return

    const orgRel = Array.isArray(pubInfo.organizations)
      ? pubInfo.organizations[0]
      : pubInfo.organizations
    const orgType = orgRel?.org_type ?? null
    // user_type du propriétaire (org personnelle uniquement) → segment expert.
    let ownerUserType: string | null = null
    if (orgType === 'freelance' && orgRel?.owner_user_id) {
      const { data: ownerRow, error: ownerErr } = await admin
        .from('users')
        .select('user_type')
        .eq('id', orgRel.owner_user_id)
        .maybeSingle()
      // ⚠️ EXCEPTION DÉCLARÉE : ON CONTINUE ALORS QUE LA SUITE CONSOMME CE QUI
      //    A ÉCHOUÉ. `ownerUserType` ne sert qu'à choisir le SEGMENT du lien
      //    (`freelance` | `cdi`) ; inconnu, `expertDashboardSegment` rend son
      //    défaut prudent `freelance`. Pour un propriétaire `cdi`, le lien
      //    pointe donc sur le mauvais segment — et la garde de routage le
      //    REDIRIGE vers son propre tableau de bord. Il arrive ailleurs que
      //    sur la candidature ; il n'arrive pas nulle part.
      //    L'alternative — ne pas notifier du tout — coûte infiniment plus
      //    cher : la cloche est le seul signal de l'événement central du
      //    produit. On continue, et on journalise pour que le lien de travers
      //    ait une trace.
      if (ownerErr) {
        console.error(
          '[depot] user_type du propriétaire ILLISIBLE — lien de la cloche potentiellement sur le mauvais segment',
          {
            publicationId: args.publicationId,
            ownerUserId: orgRel.owner_user_id,
            message: ownerErr.message,
          },
        )
      }
      ownerUserType = (ownerRow as { user_type: string | null } | null)?.user_type ?? null
    }

    const { data: members, error: membersErr } = await admin
      .from('organization_members')
      // `role` : il départage la CLOCHE (tous les membres actifs) des envois
      // externes (admin/editor seulement, cf. plus bas).
      .select('user_id, role, users!organization_members_user_id_fkey(id, locale)')
      .eq('organization_id', pubInfo.organization_id)
      .eq('status', 'active')
    // ⚠️ UNE PANNE ICI, ET L'ORGANISATION N'APPREND JAMAIS QU'UNE CANDIDATURE
    //    EST ARRIVÉE. C'est l'événement central du produit : la liste des
    //    membres à prévenir tombait à `[]`, personne n'était notifié, et rien
    //    ne le disait. On ne bloque PAS le dépôt (il est déjà acquis) : on
    //    journalise, bruyamment, parce que ce silence-là ne se voit nulle part.
    if (membersErr) {
      console.error('[depot] membres à prévenir ILLISIBLES — personne ne sera notifié', {
        publicationId: args.publicationId,
        message: membersErr.message,
      })
    }
    type Member = {
      user_id: string
      role: string | null
      users: { id: string; locale: string | null } | { id: string; locale: string | null }[]
    }
    const membersTyped = (members ?? []) as unknown as Member[]
    const linkUrl = publicationCandidaturesLinkForOrg(args.publicationId, {
      orgType,
      ownerUserType,
    })
    // Libellés de la cloche : i18n partagée avec l'e-mail du même événement
    // (cf. lib/notifications/inapp-labels).
    const rows = membersTyped.map((m) => {
      const u = Array.isArray(m.users) ? m.users[0] : m.users
      const inapp = newCandidatureInappLabels(u?.locale ?? null, pubInfo.title)
      return {
        user_id: m.user_id,
        domain_id: args.domainId,
        type: 'new_candidature_received',
        channel: 'inapp',
        title: inapp.title,
        body: inapp.body,
        link_url: linkUrl,
        status: 'pending',
        entity_id: args.candidatureId,
      }
    })
    if (rows.length === 0) return

    const { error: notifErr } = await admin.from('notifications').insert(rows)
    if (notifErr) {
      console.error('[depot] cloche non posée', notifErr.message)
      return
    }
    // E-MAIL / SMS : `admin` et `editor` SEULEMENT. Un `viewer` est en lecture
    // seule — débloquer, refuser ou sélectionner un candidat exigent
    // `requireOrgRole(auth, 'editor')`. Lui envoyer un SMS payant pour une
    // action qu'il n'a pas le droit d'exécuter, c'est le rappeler vers une
    // impasse. La CLOCHE, elle, reste pour tout le monde : elle est passive.
    const actingUserIds = membersTyped
      .filter((m) => m.role === 'admin' || m.role === 'editor')
      .map((m) => m.user_id)
    if (actingUserIds.length === 0) return

    // ⚠️ PIÈGE VERCEL : sans `after()`, ce travail lancé après la réponse est
    //    TUÉ silencieusement — rien ne partirait et aucune erreur ne
    //    s'afficherait. `after()` + `maxDuration` (en tête des routes
    //    appelantes) sont indispensables.
    after(async () => {
      try {
        await dispatchNotificationsForUsers(admin, actingUserIds, {
          events: ['new_candidature_received'],
        })
      } catch (e) {
        console.error('[depot] dispatch failed (best-effort)', e)
      }
    })
  } catch (err) {
    console.error('[depot] notification de l organisation a levé', err)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  LE DÉVOILEMENT INCLUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * DÉVOILEMENT INCLUS — la place offerte va au MEILLEUR dossier.
 *
 * Si l'offre de l'organisation inclut N candidats dévoilés et qu'il reste une
 * place, on dévoile automatiquement la candidature à la meilleure note de
 * l'annonce — par le MÊME chemin que le dévoilement manuel, mais sans consommer
 * de crédit.
 *
 * V1 assumée : on ne rétrograde JAMAIS un dévoilé. Un meilleur dossier arrivé
 * après que la place est prise ne remplace pas celui qui l'occupe.
 *
 * Entièrement NON-BLOQUANT : une erreur ici n'invalide rien — la candidature
 * existe, et l'organisation peut dévoiler à la main.
 */
async function devoilementInclus(
  admin: SupabaseClient,
  args: {
    publicationId: string
    candidatureId: string
    /**
     * L'expert qui dépose. C'est l'acteur enregistré par `performUnlock`, sur
     * les DEUX chemins : une relance d'administrateur ne réécrit pas l'auteur
     * du dévoilement, sinon le même dépôt laisserait deux traces différentes
     * selon la manière dont il a abouti.
     */
    acteurUserId: string
    /**
     * Fenêtre d'échange, EXIGÉE. Elle DESCEND du dépôt plutôt que d'être relue
     * ici : une relecture pourrait voir une valeur changée entre-temps, et la
     * conversation créée ne durerait pas ce que le dépôt a promis.
     */
    fenetreEchangeJours: number
  },
): Promise<void> {
  const { publicationId, candidatureId } = args
  try {
    const { data: pubForEnts, error: pubForEntsErr } = await admin
      .from('publications')
      .select('organization_id, domain_id')
      .eq('id', publicationId)
      .maybeSingle()
    // ⚠️ UNE PRESTATION PAYÉE, SAUTÉE SANS UNE LIGNE DE JOURNAL.
    //    `pubEnts` nul saute tout le bloc : aucun dévoilement automatique,
    //    alors que c'est précisément ce que l'offre vend — « les N meilleurs
    //    candidats sont dévoilés automatiquement ». L'organisation ne voit pas
    //    un refus, elle voit une place vide, et elle paiera un dévoilement
    //    manuel pour ce qui lui était dû.
    if (pubForEntsErr) {
      console.error('[depot] annonce ILLISIBLE — dévoilement inclus NON APPLIQUÉ', {
        publicationId,
        candidatureId,
        message: pubForEntsErr.message,
      })
    }
    const pubEnts = pubForEnts as { organization_id: string; domain_id: string } | null
    if (!pubEnts) return

    const ents = await getOrgEntitlements(admin, pubEnts.organization_id)
    const revealN = ents.limits.revealedCandidatesPerPublication

    // ┌─ « ILLIMITÉ » DÉVOILE TOUT LE MONDE, PAS PERSONNE ─────────────────┐
    // │ Ce test était `if (revealN !== null)`, et il produisait l'INVERSE   │
    // │ de ce que le back-office annonce : `package_features.value =        │
    // │ 'unlimited'` → `parseLimit()` → `null` → le bloc entier était SAUTÉ │
    // │ → zéro dévoilement. Cocher « Illimité » retirait donc le            │
    // │ dévoilement au lieu de le rendre total.                             │
    // └────────────────────────────────────────────────────────────────────┘
    //   null (illimité) → toute candidature est dévoilée, celle-ci comprise.
    //   N (nombre)      → au plus N dévoilées, et seulement si celle-ci est
    //                     en tête.
    let devoile = revealN === null

    if (revealN !== null) {
      const { count: revealedCount, error: revealedErr } = await admin
        .from('candidatures')
        .select('id', { count: 'exact', head: true })
        .eq('publication_id', publicationId)
        .in('status', ['unlocked', 'selected'])
      // ⚠️ `(revealedCount ?? 0) < revealN` ÉTAIT VRAI SUR UNE PANNE.
      //    Le compteur tombait à `null`, donc à 0, donc « la place est libre »
      //    — et un (N+1)ᵉ profil était dévoilé. C'est le plafond de
      //    dévoilement par annonce, c'est-à-dire le cœur du modèle économique
      //    ET une identité livrée : un dévoilement NE SE REPREND PAS.
      //    NE PAS SAVOIR NE VAUT JAMAIS DÉVOILER.
      if (revealedErr) {
        console.error('[depot] plafond de dévoilement ILLISIBLE — aucun dévoilement', {
          publicationId,
          message: revealedErr.message,
        })
      } else if ((revealedCount ?? 0) < revealN) {
        // ── ON NE DÉPARTAGE PAS SUR UNE COHORTE INSTABLE ──────────────────
        //
        //  LE DÉFAUT, ET IL A CHANGÉ DE FORME AVEC CE LOT. Il se lisait
        //  autrefois « une candidature déjà écrite n'a pas encore sa note » ;
        //  cet état n'existe plus — une candidature naît notée. Ce qui existe
        //  désormais, c'est un DÉPÔT COMMENCÉ dont la candidature n'est pas
        //  encore écrite : trente secondes d'appel au modèle pendant
        //  lesquelles un meilleur dossier est invisible.
        //
        //  On pose donc la question au bon endroit : y a-t-il un autre dépôt
        //  EN COURS sur cette annonce, commencé assez récemment pour pouvoir
        //  encore aboutir ? Si oui, on ne décide pas maintenant : celui qui
        //  finira après nous verra tout le monde et tranchera. Aucun travail
        //  planifié, aucune rétrogradation.
        //
        //  ⚠️ SANS CE BLOC, LE CORRECTIF DE COMPLÉTUDE ROUVRIRAIT CE QU'IL
        //     AVAIT FERMÉ (§E.62) : la place irait au PREMIER déposant et non
        //     au meilleur, exactement le défaut que la version précédente
        //     avait corrigé — avec une fenêtre de même durée.
        //
        //  LE FILET, ET IL EST OBLIGATOIRE : au-delà de la fenêtre, un dépôt
        //  en cours ne bloque plus rien. Si son jugement n'aboutit jamais —
        //  modèle en panne, fonction tuée — la place serait sinon restée VIDE
        //  pour toujours.
        const limiteFenetre = new Date(Date.now() - FENETRE_DEPOT_MS).toISOString()
        const { count: enCours, error: enCoursErr } = await admin
          .from('candidature_depots')
          .select('id', { count: 'exact', head: true })
          .eq('publication_id', publicationId)
          .eq('etat', 'en_cours')
          .gte('commence_at', limiteFenetre)

        // ⚠️ COHORTE INCONNUE ⇒ ON DIFFÈRE, comme si elle était instable.
        //    `(enCours ?? 0) > 0` valait `false` quand le comptage échouait :
        //    le report ne se faisait pas, et on départageait exactement sur la
        //    cohorte incomplète que ce bloc existe pour attendre. Un
        //    commentaire qui affirme qu'un défaut est fermé décrit l'intention,
        //    jamais l'état (§E.29).
        if (enCoursErr) {
          console.error('[depot] cohorte de dépôts ILLISIBLE — dévoilement différé', {
            publicationId,
            message: enCoursErr.message,
          })
          // ⚠️ LE `return` EST LA MOITIÉ QUI COMPTE. Journaliser puis continuer,
          //    c'est départager quand même — le demi-correctif aurait laissé le
          //    défaut intact avec un log rassurant.
          return
        }
        if ((enCours ?? 0) > 0) {
          console.log('[depot] dévoilement différé — dépôts en cours', {
            publicationId,
            en_cours: enCours,
          })
          return
        }

        // La candidature qui vient d'être créée est-elle la meilleure note de
        // la publication ? (égalité → la plus ancienne l'emporte.)
        const { data: topRow, error: topErr } = await admin
          .from('candidatures')
          .select('id')
          .eq('publication_id', publicationId)
          .order('ai_match_score', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        // ⚠️ `topRow` nul rend `devoile = false` : le dévoilement INCLUS DANS
        //    L'OFFRE ne se déclenche pas, et l'organisation voit une place vide
        //    au lieu d'un candidat auquel elle a droit. Ce qui manquait est la
        //    TRACE — ce silence-là n'apparaît nulle part.
        if (topErr) {
          console.error('[depot] départage ILLISIBLE — dévoilement inclus NON APPLIQUÉ', {
            publicationId,
            candidatureId,
            message: topErr.message,
          })
        }
        const top = topRow as { id: string } | null
        devoile = top !== null && top.id === candidatureId
      }
    }

    if (devoile) {
      // ── LA PLACE EST RÉSERVÉE EN BASE, PAS COMPTÉE EN MÉMOIRE ─────────────
      //
      //  Le comptage ci-dessus est un lire-puis-écrire : deux dépôts qui
      //  finissent au même instant lisent tous deux « 0 place prise », concluent
      //  tous deux qu'il en reste une, et dévoilent tous deux. Une organisation à
      //  UNE place incluse en obtiendrait DEUX — un droit payant donné
      //  gratuitement, et non rattrapable puisqu'on ne rétrograde jamais.
      //
      //  Aucune vérification avant écriture ne peut corriger cela. C'est la base
      //  qui tranche : un index unique partiel sur le numéro de place accepte la
      //  première réservation et refuse la seconde.
      //
      //  À PLAFOND ILLIMITÉ, la fonction rend `true` sans rien écrire : aucun
      //  numéro n'est attribué, donc rien ne peut être refusé.
      const { data: place, error: placeErr } = await admin.rpc('reserver_place_incluse', {
        p_candidature_id: candidatureId,
        p_plafond: revealN,
      })
      if (placeErr) {
        // Une panne de réservation n'accorde RIEN : dans le doute, on ferme.
        console.error('[depot] réservation de place en échec', placeErr.message)
        return
      }
      if (place !== true) {
        // REFUS NORMAL, PAS UNE PANNE : la place vient d'être prise par une
        // candidature concurrente, ou le plafond est atteint.
        console.log('[depot] place incluse non obtenue', { publicationId, candidatureId })
        return
      }

      const res = await performUnlock(admin, candidatureId, {
        auto: true,
        actorUserId: args.acteurUserId,
        fenetreEchangeJours: args.fenetreEchangeJours,
      })
      if (res.ok) return

      console.warn('[depot] dévoilement inclus refusé', res.code)
      // LA PLACE REPART. Réservée puis non honorée, elle serait perdue pour
      // toujours. Si cette libération échoue à son tour, on aura SOUS-attribué —
      // la bonne direction d'échec : on peut donner moins que le dû, jamais plus.
      const { error: libErr } = await admin.rpc('liberer_place_incluse', {
        p_candidature_id: candidatureId,
      })
      if (libErr) {
        console.error('[depot] place non libérée — elle restera inutilisée', libErr.message)
      }
    }
  } catch (err) {
    console.warn('[depot] dévoilement inclus a levé (non bloquant)', err)
  }
}
