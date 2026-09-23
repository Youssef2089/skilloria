import { lectureIncomplete, lireToutesLesLignes } from '@/lib/matching/lecture-paginee'
import { enTranches, TAILLE_TRANCHE_IDS } from '@/lib/matching/tranches'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnnonceType } from '@/types/annonce'
// LA RÈGLE D'ÉLIGIBILITÉ, ÉCRITE UNE FOIS ET PLIÉE ICI (§D.20).
import {
  appelsPostgrest,
  COLONNES_COMPTE,
  COLONNES_PROFIL,
  type AppelPostgrest,
} from '@/lib/matching/eligibilite'
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

/**
 * POSE UN FILTRE D'ÉLIGIBILITÉ DÉCRIT PAR LA RÈGLE.
 *
 * Quatre lignes, et c'est tout ce que ce fichier sait des conditions : il ne
 * les nomme pas, il ne les compte pas, il les POSE. Ajouter une condition à
 * `CONDITIONS_ELIGIBILITE` la fait apparaître ici sans toucher à ce fichier —
 * et il n'existe aucun endroit où l'on puisse en poser une qui n'y soit pas.
 *
 * Le `switch` est exhaustif sur `AppelPostgrest` : un opérateur ajouté demain
 * à la grammaire refuse de compiler tant qu'il n'est pas traité ici.
 */
function poser<Q extends {
  eq: (c: string, v: unknown) => Q
  neq: (c: string, v: unknown) => Q
  is: (c: string, v: null) => Q
  not: (c: string, o: string, v: null) => Q
  or: (e: string) => Q
}>(q: Q, appel: AppelPostgrest): Q {
  switch (appel.methode) {
    case 'eq':
      return q.eq(appel.colonne, appel.valeur)
    case 'neq':
      return q.neq(appel.colonne, appel.valeur)
    case 'is_null':
      return q.is(appel.colonne, null)
    case 'not_null':
      return q.not(appel.colonne, 'is', null)
    case 'or':
      return q.or(appel.expression)
  }
}

const pickRel = <T,>(v: T | T[] | null | undefined): T | null =>
  !v ? null : Array.isArray(v) ? (v[0] ?? null) : v

// ⚠️ LES COLONNES D'ÉLIGIBILITÉ SONT **DÉRIVÉES** DE LA RÈGLE, pas listées.
//    Le vivier n'a pas besoin de LIRE les colonnes qu'il filtre en SQL — mais
//    les charger rend le vivier jugeable par la MÊME fonction que l'autre sens,
//    et c'est ce qui permet au contrôle de prouver que les deux verdicts
//    coïncident sur une ligne donnée.
const SELECT_PROFIL =
  'id, user_id, title, summary, skills, certifications, years_total_experience, ' +
  `${COLONNES_PROFIL.join(', ')}, ` +
  `users!profiles_user_id_fkey!inner(user_type, locale, ${COLONNES_COMPTE.join(', ')})`

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
 * Les exclusions sont poussées EN SQL — charger 50 000 profils pour en jeter
 * 49 000 ne tient pas, et c'est l'ordre de grandeur visé.
 *
 * UNE SEULE EXCEPTION, et elle est justifiée sur place : les décisions déjà
 * prises (déclinées, candidatures) sont retirées EN MÉMOIRE, parce qu'un filtre
 * NÉGATIF ne se découpe pas et qu'entier il dépasse la longueur d'URL admise.
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
  const exclusSet = new Set(exclus)

  // ── Filtres communs, tous sur des données DÉCLARÉES ──────────────────────
  const base = (options?: { count?: 'exact'; head?: boolean }) => {
    let q = supabaseAdmin
      .from('profiles')
      .select(SELECT_PROFIL, options)
      .eq('domain_id', annonce.domain_id)

    // ── L'ÉLIGIBILITÉ VIENT DE LA RÈGLE, ELLE N'EST PLUS ÉCRITE ICI ───────
    //
    //  Sept filtres vivaient à cet endroit, en toutes lettres. Ils étaient
    //  JUSTES — c'est l'autre sens du moteur qui en avait trois de moins, sous
    //  un commentaire affirmant l'inverse. Ce qui manquait n'était pas une
    //  condition : c'était un endroit UNIQUE où les écrire (§E.20).
    //
    //  Le domaine, lui, reste au-dessus : ce n'est pas une condition
    //  d'éligibilité mais une règle d'ACCÈS (§D.3), et elle n'a pas d'équivalent
    //  dans le sens expert → annonces.
    for (const appel of appelsPostgrest(publicNatif, ['toujours'])) {
      q = poser(q, appel)
    }

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

    // LES DÉCISIONS DÉJÀ PRISES — retirées EN MÉMOIRE, et c'est la seule
    // exception à la règle « tout filtrer en SQL ». Voir plus bas : un filtre
    // NÉGATIF ne se découpe pas, et non découpé il dépasse la longueur d'URL
    // admise dès quelques centaines de décisions.

    return q
  }

  // DISPONIBILITÉ — celle du type de l'EXPERT, jamais celle de l'annonce. Un
  // freelance en « ne pas déranger » et un salarié qui ne cherche pas ne sont
  // pas la même donnée, et l'annonce n'a pas à en décider.
  //
  // ⚠️ LA FORME `is.null OR neq` N'EST PAS UN CAPRICE, ET ELLE VIENT DE LA
  //    RÈGLE. En SQL, `colonne <> 'x'` vaut NULL quand la colonne est NULL, et
  //    la ligne est ÉCARTÉE ; en mémoire, `p.colonne === 'x'` est faux sur
  //    `null` et la ligne est GARDÉE. Un `neq` simple ferait donc diverger les
  //    deux sens sur exactement les profils qui n'ont jamais touché à ce
  //    réglage. La règle porte l'opérateur `neq_ou_null` pour ça.
  const avecDisponibilite = (q: ReturnType<typeof base>, kind: ExpertKind) => {
    let sortie = q
    for (const appel of appelsPostgrest(kind, [kind])) sortie = poser(sortie, appel)
    return sortie
  }

  const autrePublic: ExpertKind =
    publicNatif === 'expert_freelance' ? 'expert_cdi' : 'expert_freelance'
  const drapeauOuverture = publicNatif === 'expert_freelance' ? 'open_to_freelance' : 'open_to_cdi'

  const [natifsRes, croisesRes] = await Promise.all([
    lireToutesLesLignes<LigneProfil>({
      construire: (o) => avecDisponibilite(base(o).eq('users.user_type', publicNatif), publicNatif),
      // `profiles.id` est la clé primaire : l'ordre devient TOTAL, donc stable
      // d'une page à l'autre. Sans lui, PostgreSQL peut rendre une même ligne
      // sur deux pages et en oublier une autre — un expert disparaît du vivier
      // sans erreur ni trace.
      departageUnique: 'id',
      identite: (r) => r.id,
      contexte: `vivier natif (${annonce.id})`,
    }),
    // OUVERTURE CROISÉE : l'autre public, mais SEULEMENT ceux qui l'ont
    // explicitement demandée. C'est un critère déclaré, avec sa propre garde de
    // disponibilité.
    lireToutesLesLignes<LigneProfil>({
      construire: (o) =>
        avecDisponibilite(
          base(o).eq('users.user_type', autrePublic).eq(drapeauOuverture, true),
          autrePublic,
        ),
      departageUnique: 'id',
      identite: (r) => r.id,
      contexte: `vivier croisé (${annonce.id})`,
    }),
  ])

  if (natifsRes.erreur || croisesRes.erreur) {
    const detail = natifsRes.erreur ?? croisesRes.erreur ?? 'inconnue'
    console.error('[vivier] chargement en échec', { annonce: annonce.id, detail })
    return { ...vide, erreur: `chargement du vivier en échec : ${detail}` }
  }

  // ── LE NOMBRE DE PROFILS DISTINCTS EST CONFRONTÉ AU NOMBRE ATTENDU ───────
  //
  //  ⚠️ ON COMPTE DES PROFILS DISTINCTS, PLUS DES LIGNES. La version précédente
  //     comparait `lignes.length` à `attendu` — et c'est exactement au moment
  //     où elle devait parler qu'elle se taisait : une pagination sans ordre
  //     total rend une même ligne deux fois ET en oublie une autre, donc le
  //     compte de LIGNES tombe juste pendant que le périmètre est faux. Le
  //     dédoublonnage absorbait ensuite les doublons en silence.
  //
  //  Une garde qui compte la mauvaise chose est pire qu'une absence de garde :
  //  elle rassure.
  const divergence = [natifsRes, croisesRes].find(lectureIncomplete)
  if (divergence) {
    console.error('[vivier] LECTURE INCOMPLÈTE — le vivier ne couvre pas tout le périmètre', {
      annonce: annonce.id,
      distincts: divergence.distincts,
      attendus: divergence.attendu,
      doublons: divergence.doublons,
    })
    return {
      ...vide,
      erreur: `vivier incomplet : ${divergence.distincts} profils distincts lus pour ${divergence.attendu} attendus`,
    }
  }

  // Un doublon rendu par la pagination n'est jamais normal : il dit que l'ordre
  // n'était pas total. Le dédoublonnage l'a absorbé, mais le taire referait le
  // silence qu'on vient de corriger.
  const doublons = natifsRes.doublons + croisesRes.doublons
  if (doublons > 0) {
    console.error('[vivier] pagination INSTABLE — des lignes ont été rendues deux fois', {
      annonce: annonce.id,
      doublons,
    })
  }

  const vues = new Set<string>()
  const profils: ProfilDuVivier[] = []
  for (const r of [
    ...(natifsRes.lignes as unknown as LigneProfil[]),
    ...(croisesRes.lignes as unknown as LigneProfil[]),
  ]) {
    if (vues.has(r.id)) continue
    // LES DÉCISIONS DÉJÀ PRISES, appliquées ici plutôt qu'en SQL.
    //
    //  Un `not in (…)` porte la liste entière dans l'URL, et un filtre NÉGATIF
    //  ne se découpe pas : l'union de « pas dans A » et « pas dans B » réadmet
    //  ce que chaque moitié excluait. La seule découpe correcte serait une
    //  intersection, qui reviendrait à réécrire la même URL trop longue.
    //
    //  On charge donc ces profils et on les retire ici. Le coût est de lire
    //  quelques lignes de plus ; le bénéfice est que le mur d'URL disparaît, et
    //  qu'il tombait dès quelques centaines de décisions — bien avant l'échelle
    //  promise.
    if (exclus.length > 0 && exclusSet.has(r.id)) continue
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
    // DÉCOUPÉE : injectés d'un bloc, ces identifiants écrivent un filtre d'URL
    // qui dépasse la longueur admise dès quelques centaines de profils. Le
    // filtre est POSITIF, donc l'union des tranches est exactement le résultat
    // entier — contrairement au filtre négatif des décisions, plus haut.
    //
    // ── ET PAGINÉE, PAS SEULEMENT DÉCOUPÉE ────────────────────────────────
    //  Découper les identifiants borne la longueur de l'URL, pas le nombre de
    //  LIGNES RENDUES. 200 profils × 5 expériences font 1 000 lignes : très
    //  exactement la limite qu'on venait de contourner ailleurs. Au-delà, des
    //  parcours manquaient — le document envoyé au fournisseur était plus
    //  pauvre, la note plus basse, et AUCUNE TRACE ne le disait. Un expert mal
    //  noté parce qu'on n'a pas lu son parcours entier est le pire des défauts
    //  silencieux : il ressemble à un mauvais dossier.
    type LigneParcours = {
      id: string
      profile_id: string
      role: string | null
      sector: string | null
      description: string | null
    }
    const exps: LigneParcours[] = []
    let expErr: { message: string } | null = null
    for (const tranche of enTranches(ids, TAILLE_TRANCHE_IDS)) {
      const lu = await lireToutesLesLignes<LigneParcours>({
        construire: (o) =>
          supabaseAdmin
            .from('profile_experiences')
            .select('id, profile_id, role, sector, description, start_date', o)
            .in('profile_id', tranche)
            // Le tri MÉTIER reste celui-ci ; le départage unique s'ajoute après
            // lui et ne le contredit pas — deux expériences de même date sont
            // simplement rendues dans un ordre désormais reproductible.
            .order('start_date', { ascending: false }),
        departageUnique: 'id',
        identite: (e) => e.id,
        contexte: `parcours (${tranche.length} profils)`,
      })
      if (lu.erreur) {
        expErr = { message: lu.erreur }
        break
      }
      // Même discipline qu'au vivier : une lecture partielle se DIT.
      if (lectureIncomplete(lu)) {
        expErr = {
          message: `parcours incomplet : ${lu.distincts} expériences distinctes lues pour ${lu.attendu} attendues`,
        }
        break
      }
      exps.push(...lu.lignes)
    }
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
