import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnnonceType } from '@/types/annonce'
import {
  expertKindForAnnonce,
  peutViserSonAuteur,
  type ExpertKind,
} from '@/lib/annonces/audience'

/**
 * LE VIVIER — qui entre, et POUR QUELLE RAISON on n'entre pas.
 *
 * ═══ LA RÈGLE, ET C'EST ELLE QUE CE FICHIER APPLIQUE ══════════════════════
 *   « Aucun profil n'est écarté sans une raison NOMMABLE et CONTESTABLE. Le
 *     backend peut FILTRER sur des critères DÉCLARÉS PAR L'EXPERT LUI-MÊME. Il
 *     ne peut jamais exclure sur un jugement de pertinence. »
 *
 *   Chaque filtre ci-dessous porte donc sur une donnée que l'expert a saisie :
 *   sa branche, ses spécialités, ses séniorités, ses zones, sa disponibilité,
 *   son ouverture croisée — et, depuis ce lot, ses DÉCISIONS : avoir décliné une
 *   annonce, ou y avoir déjà postulé. Un refus et une candidature sont des actes
 *   de l'expert, pas des jugements portés sur lui.
 *
 *   Il n'y a AUCUN plafond de vivier. Il y en avait un — 100 candidats, sans
 *   ORDER BY, donc une liste d'autorisés stable et invisible. Le reranking note
 *   chaque couple indépendamment : il n'y a plus rien à couper.
 *
 * ═══ LA SÉMANTIQUE DE L'ENSEMBLE VIDE ═════════════════════════════════════
 *   Côté ANNONCE, un ensemble vide veut dire « aucune contrainte sur cet axe »,
 *   jamais « ne correspond à personne ». Une annonce sans spécialité déclarée
 *   cherche large ; elle ne cherche pas rien.
 *   Côté ZONES, c'est l'inverse : elles sont obligatoires pour publier, parce
 *   qu'une annonce sans zone ne recouperait personne (`&&` sur un ensemble vide
 *   est toujours faux) et serait publiée silencieusement invisible.
 *
 * ═══ CE QUE LE COMPTE-RENDU SERT ══════════════════════════════════════════
 *   Chaque filtre rend son propre décompte. Sans cela, « 3 candidats » ne dit
 *   pas si le vivier est petit ou si un filtre est trop serré — et personne ne
 *   sait quoi corriger.
 */

/** Ce qu'un profil apporte au reranking. Aucune donnée nominative. */
export type ProfilDuVivier = {
  profile_id: string
  user_id: string
  user_type: ExpertKind
  locale: string
  /** Sorti du public natif de l'annonce : il a coché l'ouverture croisée. */
  ouverture_croisee: boolean
  title: string | null
  summary: string | null
  skills: string[]
  certifications_count: number
  years_total_experience: number | null
  experiences: Array<{ role: string | null; sector: string | null; description: string | null }>
}

export type CompteRenduVivier = {
  /** Après TOUS les filtres. C'est le périmètre que le reranking doit couvrir. */
  profils: ProfilDuVivier[]
  ecartes: {
    deja_decline: number
    deja_postule: number
  }
  /** Une lecture en échec n'est jamais un vivier vide : on le dit. */
  erreur?: string
}

type LigneProfil = {
  id: string
  user_id: string
  title: string | null
  summary: string | null
  skills: string[] | null
  certifications: unknown
  years_total_experience: number | null
  users: { user_type: string; locale: string } | { user_type: string; locale: string }[] | null
}

const pickRel = <T,>(v: T | T[] | null | undefined): T | null =>
  !v ? null : Array.isArray(v) ? (v[0] ?? null) : v

const SELECT_PROFIL =
  'id, user_id, title, summary, skills, certifications, years_total_experience, ' +
  'users!profiles_user_id_fkey!inner(user_type, locale)'

/**
 * Critères déclarés PAR L'ANNONCE. Un tableau vide = aucune contrainte sur cet
 * axe (sauf les zones, exigées pour publier).
 */
export type CriteresAnnonce = {
  id: string
  domain_id: string
  type: AnnonceType
  created_by: string | null
  branch_id: string | null
  speciality_ids: string[]
  seniorities: string[]
  work_zone_countries: string[]
}

/**
 * Le vivier d'une annonce.
 *
 * Toutes les exclusions sont poussées EN SQL, jamais faites en mémoire après
 * chargement : charger 50 000 profils pour en jeter 49 000 ne tient pas, et
 * c'est l'ordre de grandeur visé.
 */
export async function chargerVivierPourAnnonce(
  supabaseAdmin: SupabaseClient,
  annonce: CriteresAnnonce,
): Promise<CompteRenduVivier> {
  const vide: CompteRenduVivier = { profils: [], ecartes: { deja_decline: 0, deja_postule: 0 } }

  const publicNatif = expertKindForAnnonce(annonce.type)

  // ── Ce que l'expert a DÉJÀ DÉCIDÉ ────────────────────────────────────────
  //  Un profil qui a décliné cette annonce, ou qui y a déjà postulé, n'a rien à
  //  faire dans le vivier : on paierait pour le noter, et le résultat serait
  //  ignoré — la réconciliation préserve ces deux cas sans jamais les relire.
  //  Ce sont des DÉCISIONS de l'expert, donc des critères déclarés au même titre
  //  que ses zones.
  const [declinesRes, postulesRes] = await Promise.all([
    supabaseAdmin
      .from('matches')
      .select('profile_id')
      .eq('publication_id', annonce.id)
      .eq('status', 'dismissed'),
    // TOUS les statuts de candidature, retrait compris : se retirer est une
    // décision, pas une absence de décision. Reproposer l'annonce reviendrait à
    // ignorer ce que la personne a dit.
    supabaseAdmin.from('candidatures').select('profile_id').eq('publication_id', annonce.id),
  ])
  if (declinesRes.error || postulesRes.error) {
    // On REFUSE de continuer : sans ces deux listes, on renoterait des profils
    // qui ont déjà tranché — et on paierait pour rien.
    const detail = declinesRes.error?.message ?? postulesRes.error?.message ?? 'inconnue'
    console.error('[vivier] décisions de l expert illisibles', { annonce: annonce.id, detail })
    return { ...vide, erreur: `décisions déjà prises illisibles : ${detail}` }
  }
  const declines = new Set((declinesRes.data ?? []).map((r) => (r as { profile_id: string }).profile_id))
  const postules = new Set((postulesRes.data ?? []).map((r) => (r as { profile_id: string }).profile_id))
  const exclus = [...new Set([...declines, ...postules])]

  // ── Filtres communs, tous sur des données DÉCLARÉES ──────────────────────
  const base = () => {
    let q = supabaseAdmin
      .from('profiles')
      .select(SELECT_PROFIL)
      .eq('domain_id', annonce.domain_id)
      .eq('visible', true)
      .eq('cv_parsing_status', 'done')
      .not('ai_consent_at', 'is', null)
      .eq('verification_status', 'approved')

    // BRANCHE — déclarée des deux côtés, et obligatoire des deux côtés.
    if (annonce.branch_id) q = q.eq('branch_id', annonce.branch_id)

    // SPÉCIALITÉS et SÉNIORITÉS — recoupement, et seulement si l'annonce en
    // déclare. Ensemble vide côté annonce = aucune contrainte.
    if (annonce.speciality_ids.length > 0) q = q.overlaps('speciality_ids', annonce.speciality_ids)
    if (annonce.seniorities.length > 0) q = q.overlaps('seniorities', annonce.seniorities)

    // ZONES — recoupement sur les codes pays APLATIS. L'aplatissement rend le
    // recoupement symétrique par construction : « Monde entier » et « France »
    // se recoupent sans qu'aucun code n'ait à connaître la hiérarchie.
    if (annonce.work_zone_countries.length > 0) {
      q = q.overlaps('work_zone_countries', annonce.work_zone_countries)
    }

    // L'AUTEUR — un expert publiant un besoin ne se propose pas à lui-même.
    if (!peutViserSonAuteur(annonce.type) && annonce.created_by) {
      q = q.neq('user_id', annonce.created_by)
    }

    // LES DÉCISIONS DÉJÀ PRISES.
    if (exclus.length > 0) q = q.not('id', 'in', `(${exclus.join(',')})`)

    return q
  }

  // DISPONIBILITÉ — celle du type de l'EXPERT, jamais celle de l'annonce. Un
  // freelance en « ne pas déranger » et un salarié qui ne cherche pas ne sont
  // pas la même donnée, et l'annonce n'a pas à en décider.
  const avecDisponibilite = (q: ReturnType<typeof base>, kind: ExpertKind) =>
    kind === 'expert_freelance'
      ? q.or('availability_status.is.null,availability_status.neq.do_not_disturb')
      : q.or('cdi_status.is.null,cdi_status.neq.employed')

  const autrePublic: ExpertKind =
    publicNatif === 'expert_freelance' ? 'expert_cdi' : 'expert_freelance'
  const drapeauOuverture = publicNatif === 'expert_freelance' ? 'open_to_freelance' : 'open_to_cdi'

  const [natifsRes, croisesRes] = await Promise.all([
    avecDisponibilite(base().eq('users.user_type', publicNatif), publicNatif),
    // OUVERTURE CROISÉE : l'autre public, mais SEULEMENT ceux qui l'ont
    // explicitement demandée. C'est un critère déclaré, avec sa propre garde de
    // disponibilité.
    avecDisponibilite(
      base().eq('users.user_type', autrePublic).eq(drapeauOuverture, true),
      autrePublic,
    ),
  ])

  if (natifsRes.error || croisesRes.error) {
    const detail = natifsRes.error?.message ?? croisesRes.error?.message ?? 'inconnue'
    console.error('[vivier] chargement en échec', { annonce: annonce.id, detail })
    return { ...vide, erreur: `chargement du vivier en échec : ${detail}` }
  }

  const vues = new Set<string>()
  const profils: ProfilDuVivier[] = []
  for (const r of [
    ...((natifsRes.data ?? []) as unknown as LigneProfil[]),
    ...((croisesRes.data ?? []) as unknown as LigneProfil[]),
  ]) {
    if (vues.has(r.id)) continue
    vues.add(r.id)
    const u = pickRel(r.users)
    const kind: ExpertKind = u?.user_type === 'expert_cdi' ? 'expert_cdi' : 'expert_freelance'
    profils.push({
      profile_id: r.id,
      user_id: r.user_id,
      user_type: kind,
      locale: u?.locale ?? 'fr',
      ouverture_croisee: kind !== publicNatif,
      title: r.title,
      summary: r.summary,
      skills: Array.isArray(r.skills) ? r.skills : [],
      certifications_count: Array.isArray(r.certifications) ? r.certifications.length : 0,
      years_total_experience: r.years_total_experience,
      experiences: [],
    })
  }

  // ── Le parcours, en UNE requête pour tout le vivier ──────────────────────
  //  Une requête par profil serait invisible à dix profils et fatale à dix
  //  mille : c'est le genre de boucle qu'on n'aperçoit qu'en production.
  if (profils.length > 0) {
    const ids = profils.map((p) => p.profile_id)
    const { data: exps, error: expErr } = await supabaseAdmin
      .from('profile_experiences')
      .select('profile_id, role, sector, description, start_date')
      .in('profile_id', ids)
      .order('start_date', { ascending: false })
    if (expErr) {
      // Le parcours ENRICHIT le document, il ne le conditionne pas. Un profil
      // sans parcours reste notable sur son titre, son résumé et ses
      // compétences : on continue, mais on le dit.
      console.warn('[vivier] parcours illisible — notation sur le reste du profil', {
        message: expErr.message,
      })
    } else {
      const parProfil = new Map<string, ProfilDuVivier['experiences']>()
      for (const e of (exps ?? []) as Array<{
        profile_id: string
        role: string | null
        sector: string | null
        description: string | null
      }>) {
        const liste = parProfil.get(e.profile_id) ?? []
        liste.push({ role: e.role, sector: e.sector, description: e.description })
        parProfil.set(e.profile_id, liste)
      }
      for (const p of profils) p.experiences = parProfil.get(p.profile_id) ?? []
    }
  }

  return {
    profils,
    ecartes: { deja_decline: declines.size, deja_postule: postules.size },
  }
}
