import { contexteDepuisAuth } from '@/lib/journal/contexte'
import { JournalError } from '@/lib/journal/journaliser'
import { disponibiliteBasculee, profilModifie, profilPublie } from '@/lib/profil/journal-profil'
import { NextRequest, after } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { missingForVisibility } from '@/lib/profile-visibility'
import { deposerVerificationExpert } from '@/lib/travaux-ia/travail'
import { langueDeNotification, notifyExpertResult } from '@/lib/verification/expert-verification'
import { LISTES_DE_PROFIL, estListeDeProfil, type ListeDeProfil } from '@/lib/lecture/liste'
import { clesModifiees, listeModifiee } from '@/lib/profil/changements'
import { contientAutre } from '@/lib/taxonomie/specialite-autre'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// La vérification d'expert ne tourne PLUS ici (§D.30) : la publication DÉPOSE un travail
// d'IA, que l'exécutant `/api/cron/travaux-ia` exécute hors de cette requête. Coupée à
// 60 s, elle laissait « vérification en cours » pour toujours (audit du 30/09/2026, B3).
export const maxDuration = 30

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * LES DEUX REFUS TEMPORAIRES DE CETTE ROUTE, ÉCRITS UNE FOIS.
 *
 * Trois lectures de référentiel et deux comptages de complétude tombaient
 * chacun sur un refus MÉTIER — « cette branche n’existe pas », « expériences
 * manquantes » — alors que la cause était une lecture en panne. Cinq sites,
 * une seule nature : **on ne sait pas**.
 *
 * Le refus ne se relâche pas : on n’écrit pas un identifiant qu’on n’a pas
 * résolu, et on ne publie pas un profil dont on n’a pas pu vérifier la
 * complétude. Ce qui change est le MOTIF et le STATUT — **503**, jamais 400
 * (§E.22 règle 1). Un 400 envoie corriger une saisie qui est bonne.
 *
 * DEUX CODES ET NON UN : ils n’appellent pas la même suite. « Le référentiel
 * ne répond pas » concerne une SAISIE en cours ; « je n’ai pas pu vérifier la
 * complétude » concerne une PUBLICATION. On ne multiplie pas les états quand
 * l’action est la même — ici elle ne l’est pas.
 */
function referentielIndisponible(message: string, table: string): Response {
  console.error('[profile PATCH] référentiel ILLISIBLE — aucune résolution possible', { table, message })
  return json(
    { error: 'Reference data unavailable', code: 'referentiel_indisponible' },
    503,
  )
}

function completudeIndisponible(message: string, table: string): Response {
  console.error('[profile PATCH] complétude ILLISIBLE — publication ni accordée ni refusée sur le fond', {
    table,
    message,
  })
  return json(
    { error: 'Could not verify profile completeness', code: 'completude_indisponible' },
    503,
  )
}

type ExperienceInput = {
  experience_type: 'career' | 'project'
  role: string
  employer?: string | null
  client_name?: string | null
  sector?: string | null
  start_date: string
  end_date?: string | null
  is_current?: boolean
  description?: string | null
}

type EducationInput = {
  school: string
  degree: string
  field?: string | null
  start_year?: number | null
  end_year?: number | null
  location?: string | null
}

type LanguageInput = {
  language: string
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'native'
  is_primary?: boolean
}

type PatchBody = Partial<{
  title: string | null
  summary: string | null
  /**
   * SÉNIORITÉS — multiple. Un expert peut se déclarer « confirmé » ET
   * « senior » : ce sont deux niveaux de mission qu'il accepte, pas une
   * identité. La colonne à valeur unique a été supprimée avec la migration
   * profil_annonce_multivalues.
   */
  seniorities: Array<'junior' | 'confirmed' | 'senior' | 'expert'> | null
  years_experience: number | null
  skills: string[] | null
  certifications: Array<{ name: string; issuer?: string | null; year?: number | null }> | null
  branch_slug: string | null
  /**
   * SPÉCIALITÉS — multiple, transmises en SLUGS. Le client n'envoie jamais
   * d'uuid de taxonomie : le serveur résout, et refuse un slug inconnu ou
   * appartenant à un autre écosystème (règle 20).
   */
  speciality_slugs: string[] | null
  /**
   * ZONES DE TRAVAIL — transmises en CODES stables ('EU', 'C_FR'), résolues
   * serveur pour la même raison.
   */
  work_zone_codes: string[] | null
  speciality_other: string | null
  languages: string[] | null
  location: string | null
  work_modes: Array<'remote' | 'onsite' | 'hybrid'>
  tjm_min: number | null
  tjm_max: number | null
  availability_date: string | null
  linkedin_url: string | null
  visible: boolean
  phone: string | null
  address_line: string | null
  postal_code: string | null
  city: string | null
  country: string | null
  birth_year: number | null
  photo_url: string | null
  years_total_experience: number | null
  availability_status: string | null
  experiences: ExperienceInput[]
  educations: EducationInput[]
  languages_structured: LanguageInput[]
  // ── CDI-specific (acceptés UNIQUEMENT si users.user_type === 'expert_cdi') ──
  cdi_status: 'employed' | 'open_to_work' | null
  cdi_notice_period: 'immediate' | '1_month' | '2_months' | '3_months' | 'negotiable' | null
  cdi_availability_date: string | null
  cdi_confidential_mode: boolean | null
  cdi_salary_min: number | null
  cdi_salary_max: number | null
  cdi_variable_pct: number | null
  cdi_benefits: string[] | null
  cdi_company_size: string[] | null
  cdi_sectors: string[] | null
  cdi_geo_mobility: 'local' | 'regional' | 'national' | 'international' | null
  cdi_contract_types: Array<'cdi' | 'cdd' | 'alternance'> | null
  cdi_motivations: string | null
  cdi_career_goals: string | null
}>

export async function PATCH(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    console.error('[profile PATCH] auth error', err)
    return json({ error: 'Auth failed', code: 'auth_error' }, 500)
  }
  // LA PIÈCE, À L'ENTRÉE DU GESTE (§D.26) — elle traverse tout ce qui suit, after() compris.
  const journal = contexteDepuisAuth(auth)

  let body: PatchBody
  try {
    body = (await request.json()) as PatchBody
  } catch {
    return json({ error: 'Invalid JSON', code: 'bad_body' }, 400)
  }

  const { supabaseAdmin, user } = auth

  // ── Branchement user_type pour valider/whitelister selon le rôle ──
  // (Lecture isolée : ne touche pas requireAuth() pour rester chirurgical.)
  const { data: userMetaRow, error: userMetaErr } = await supabaseAdmin
    .from('users')
    // `locale` : la notification posée à la publication est écrite dans la langue de l'expert.
    .select('user_type, locale')
    .eq('id', user.id)
    .maybeSingle()
  // ⚠️ RIEN NE S’OUVRAIT ICI : LA GARDE CHOISISSAIT LE MAUVAIS ÉTAT (§E.37).
  //    `userType` tombait à `null`, `isCdi` à faux, et le PATCH d'un expert
  //    **CDI** était validé avec la liste blanche **FREELANCE** — champs
  //    `cdi_*` non retenus, et le prédicat de visibilité appliqué avec le
  //    mauvais parcours. Aucun refus contourné, aucun code d’erreur menteur :
  //    le profil part simplement un cran à côté.
  //    C’est la seule occurrence réelle de §E.37 trouvée à ce jour, et sa
  //    forme est celle d’une AFFECTATION, pas d’une condition — c’est
  //    pourquoi aucun balayage de `return` ne la voit.
  if (userMetaErr) {
    console.error('[profile PATCH] type de compte ILLISIBLE — aucune validation appliquée', {
      userId: user.id,
      message: userMetaErr.message,
    })
    return json(
      { error: 'Could not read the account type', code: 'profil_verification_indisponible' },
      503,
    )
  }
  const userType = (userMetaRow?.user_type as string | null) ?? null
  const isCdi = userType === 'expert_cdi'

  // currentProfile : on étend le select avec les colonnes nécessaires à la
  // validation CDI uniquement si isCdi (pas de surcoût pour le freelance).
  // `visible` est LU pour dire si une publication est la première ou une republication (§D.26) — une colonne absente se lit undefined (§E.1).
  const baseSelect = 'id, title, summary, skills, branch_id, speciality_ids, speciality_other, seniorities, work_zone_ids, work_modes, availability_status, cdi_status, verification_status, cv_parsing_status, ai_consent_at, visible'
  // `cdi_status` est désormais dans le socle : la garde de visibilité en a
  // besoin pour TOUS les experts (elle teste « au moins l'une des deux
  // disponibilités »). Ne pas le redemander ici.
  const cdiSelectExtra = ', cdi_salary_min, cdi_salary_max, cdi_notice_period'
  const profileSelect = isCdi ? baseSelect + cdiSelectExtra : baseSelect

  const { data: currentProfile, error: fetchErr } = await supabaseAdmin
    .from('profiles')
    .select(profileSelect)
    .eq('user_id', user.id)
    .maybeSingle()
  // Une lecture de `profiles` en panne n'est pas un profil absent (§E.42) :
  // 503 qui se reessaie, jamais le 404 qui se croit. L'absence reelle garde son code.
  if (fetchErr) {
    console.error('[profile PATCH] profil ILLISIBLE', { userId: user.id, message: fetchErr.message })
    return json(
      { error: 'Could not read the profile', code: 'profil_verification_indisponible' },
      503,
    )
  }
  if (!currentProfile) {
    return json({ error: 'Profile not found', code: 'profile_missing' }, 404)
  }
  // Cast nécessaire car `profileSelect` est une chaîne dynamique
  // (supabase-js ne peut typer le retour qu'avec un littéral statique).
  const cp = currentProfile as unknown as Record<string, any> & { id: string }

  // LE CHAMP DE DISPONIBILITÉ DE CHAQUE VOIE — une seule table, lue par le
  // journal du profil (§D.14 : parité, pas deux listes).
  const CHAMP_DISPONIBILITE = { expert_freelance: 'availability_status', expert_cdi: 'cdi_status' } as const

  const patch: Record<string, unknown> = {}
  const directFields: Array<keyof PatchBody> = [
    'title', 'summary', 'seniorities', 'years_experience',
    'skills', 'certifications',
    'languages', 'location', 'work_modes', 'tjm_min', 'tjm_max',
    'availability_date', 'linkedin_url', 'visible',
    'phone', 'address_line', 'postal_code', 'city', 'country',
    'birth_year', 'photo_url', 'years_total_experience', 'availability_status',
  ]
  for (const k of directFields) {
    if (k in body) patch[k] = body[k] as unknown
  }
  // LE RÉSUMÉ EST ROGNÉ AVANT D'ÊTRE ÉCRIT : la base mesure `btrim(summary)` (espaces seulement), le
  // code mesurait `trim()` (tous les blancs). Un retour à la ligne en bordure faisait passer l'un et
  // refuser l'autre (audit du 30/09/2026, m8). Rogné ici, les deux mesurent la même chose.
  if (typeof patch.summary === 'string') patch.summary = (patch.summary as string).trim()

  // ── Whitelist additionnelle pour les expert_cdi : 14 colonnes cdi_* ──
  // Si l'utilisateur n'est PAS expert_cdi, ces champs sont ignorés
  // silencieusement (backward-compatible : aucune régression freelance).
  if (isCdi) {
    const cdiFields: Array<keyof PatchBody> = [
      'cdi_status',
      'cdi_notice_period',
      'cdi_availability_date',
      'cdi_confidential_mode',
      'cdi_salary_min',
      'cdi_salary_max',
      'cdi_variable_pct',
      'cdi_benefits',
      'cdi_company_size',
      'cdi_sectors',
      'cdi_geo_mobility',
      'cdi_contract_types',
      'cdi_motivations',
      'cdi_career_goals',
    ]
    for (const k of cdiFields) {
      if (k in body) patch[k] = body[k] as unknown
    }
  }

  if ('branch_slug' in body) {
    if (body.branch_slug === null) {
      patch.branch_id = null
    } else if (body.branch_slug) {
      const { data: br, error: brErr } = await supabaseAdmin
        .from('branches')
        .select('id')
        .eq('domain_id', user.domain_id)
        .eq('slug', body.branch_slug)
        .maybeSingle()
      // ⚠️ « CETTE BRANCHE N’EXISTE PAS », DIT D’UNE BRANCHE RÉELLE.
      //    Le refus est juste — on n’écrit pas un identifiant qu’on n’a pas
      //    résolu — mais 400 `bad_branch` envoie l’expert corriger une
      //    saisie qui est bonne, et il est **bloqué à l’enregistrement**
      //    sans aucun moyen d’avancer (§E.22 ③).
      if (brErr) return referentielIndisponible(brErr.message, 'branches')
      if (!br) return json({ error: 'Unknown branch', code: 'bad_branch' }, 400)
      patch.branch_id = br.id
    }
  }
  // SPÉCIALITÉS multiples. Le serveur résout les slugs EN LOT et exige que
  // TOUTES existent dans l'écosystème de l'utilisateur : un slug inconnu fait
  // échouer la requête entière plutôt que d'être ignoré en silence. Ignorer
  // reviendrait à enregistrer une sélection amputée sans que l'expert le sache
  // — et à le rendre invisible sur un axe qu'il croit avoir renseigné.
  if ('speciality_slugs' in body) {
    const slugs = Array.isArray(body.speciality_slugs)
      ? [...new Set(body.speciality_slugs.filter((s): s is string => typeof s === 'string' && s.length > 0))]
      : []
    if (slugs.length === 0) {
      patch.speciality_ids = []
    } else {
      const { data: sps, error: spsErr } = await supabaseAdmin
        .from('specialities')
        .select('id, slug, name, active')
        .eq('domain_id', user.domain_id)
        .in('slug', slugs)
      // Même chose, en pire : la comparaison de longueur transforme une
      // lecture vide en « TOUTES vos spécialités sont inconnues ».
      if (spsErr) return referentielIndisponible(spsErr.message, 'specialities')
      const lues = (sps ?? []) as Array<{ id: string; slug: string; name: string; active: boolean }>
      if (lues.length !== slugs.length) {
        const inconnus = slugs.filter((s) => !lues.some((t) => t.slug === s))
        return json(
          { error: 'Unknown speciality', code: 'bad_speciality', unknown: inconnus },
          400,
        )
      }
      // UNE SPÉCIALITÉ DÉSACTIVÉE PENDANT QUE L'ÉCRAN ÉTAIT OUVERT n'empêche pas d'enregistrer (relecture du 01/10/2026,
      // §E.72) : le lot suivant désactive la ligne « Autre » du référentiel ; une page chargée avant son push l'envoie
      // encore. Elle ne rentre pas dans les spécialités ; si c'est « Autre » (la base le DIT, une définition), son NOM
      // devient la précision quand l'écran n'en envoie aucune — exactement ce que fait la reprise
      // (`retirer_specialites_autre`). Toute autre spécialité désactivée sort simplement. Un slug INCONNU reste refusé.
      const actives = lues.filter((t) => t.active)
      const retirees = lues.filter((t) => !t.active)
      const precisionEnvoyee = typeof body.speciality_other === 'string' && body.speciality_other.trim() !== ''
      if (!precisionEnvoyee) {
        for (const r of retirees) {
          const autre = await contientAutre(supabaseAdmin, [r.name], r.slug)
          if (autre === 'illisible') return referentielIndisponible('est_specialite_autre', 'specialities')
          if (autre === 'autre') { patch.speciality_other = r.name; break }
        }
      }
      patch.speciality_ids = actives.map((t) => t.id)
    }
  }

  // ZONES DE TRAVAIL. Résolution par CODE stable, jamais par uuid transmis par
  // le client. La colonne dérivée work_zone_countries est remplie par le
  // trigger de base : elle n'est jamais écrite ici (cf. migration).
  if ('work_zone_codes' in body) {
    const codes = Array.isArray(body.work_zone_codes)
      ? [...new Set(body.work_zone_codes.filter((c): c is string => typeof c === 'string' && c.length > 0))]
      : []
    if (codes.length === 0) {
      patch.work_zone_ids = []
    } else {
      const { data: wzs, error: wzsErr } = await supabaseAdmin
        .from('work_zones')
        .select('id, code')
        .eq('active', true)
        .in('code', codes)
      if (wzsErr) return referentielIndisponible(wzsErr.message, 'work_zones')
      const trouvees = (wzs ?? []) as Array<{ id: string; code: string }>
      if (trouvees.length !== codes.length) {
        const inconnus = codes.filter((c) => !trouvees.some((t) => t.code === c))
        return json(
          { error: 'Unknown work zone', code: 'bad_work_zone', unknown: inconnus },
          400,
        )
      }
      patch.work_zone_ids = trouvees.map((t) => t.id)
    }
  }
  // D6 : précision libre « Autre » (bornée). Renseignée quand speciality_id est
  // nul, effacée sinon — le formulaire envoie null quand une spécialité listée
  // est choisie. On ne l'accepte que comme string bornée à 100 caractères.
  if ('speciality_other' in body) {
    const raw = typeof body.speciality_other === 'string' ? body.speciality_other.trim() : ''
    if (raw.length > 100) {
      return json({ error: 'speciality_other too long', code: 'bad_speciality_other' }, 400)
    }
    // Vide, il garde le nom d'une spécialité retirée posé plus haut (une page d'avant le lot suivant, « Autre » coché).
    patch.speciality_other = raw.length > 0 ? raw : (patch.speciality_other ?? null)
  }

  // Validation pour publication
  // ─────────────────────────────────────────────────────────────────────
  // Branchement strict : freelance vs CDI.
  // - Freelance (default) : règles INCHANGÉES (backward-compat)
  // - CDI : règles spécifiques (cdi_status, cdi_salary_*, cdi_notice_period,
  //   summary>=20, ET pas de validation work_modes — informatif seulement)
  // ─────────────────────────────────────────────────────────────────────
  if (body.visible === true) {
    const cur = cp

    // ── Barrière CV obligatoire (Lot CV) — SÉCURITÉ SERVEUR ────────────────
    //  Règle métier non contournable : impossible de publier sans un CV
    //  déposé ET parsé, et sans avoir accepté la vérification IA. Mêmes
    //  critères que ceux exigés en interne par evaluerVerificationExpert et par
    //  le déclencheur de matching (cf. after() plus bas).
    //  S'applique aux DEUX flows (freelance + CDI) — la condition est commune.
    const cvReady =
      (cur as { cv_parsing_status?: string | null }).cv_parsing_status === 'done' &&
      (cur as { ai_consent_at?: string | null }).ai_consent_at != null
    if (!cvReady) {
      return json({ error: 'CV not ready for publication', code: 'cv_not_ready' }, 400)
    }

    // experiences >= 1 (body ou BDD) — commun
    let experiencesCount: number
    if ('experiences' in body) {
      experiencesCount = Array.isArray(body.experiences)
        ? body.experiences.filter(e => e.role?.trim()).length
        : 0
    } else {
      const { count, error: cErr } = await supabaseAdmin
        .from('profile_experiences')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', cur.id)
      // ⚠️ `?? 0` FAISAIT CONCLURE À LA GARDE QUE LE PROFIL EST VIDE.
      //    L'expert lisait « expériences manquantes » — et **ne pouvait plus
      //    se rendre visible** — avec dix expériences en base. C’est le
      //    compteur de §E.22 ⑨, cette fois dans une BARRIÈRE et plus
      //    seulement à l’écran : un zéro qu’on n’a pas su compter devient un
      //    refus de publication.
      if (cErr) return completudeIndisponible(cErr.message, 'profile_experiences')
      experiencesCount = count ?? 0
    }

    // languages_structured >= 1 (body ou BDD) — commun
    let languagesCount: number
    if ('languages_structured' in body) {
      languagesCount = Array.isArray(body.languages_structured)
        ? body.languages_structured.filter(l => l.language?.trim()).length
        : 0
    } else {
      const { count, error: cErr } = await supabaseAdmin
        .from('profile_languages')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', cur.id)
      if (cErr) return completudeIndisponible(cErr.message, 'profile_languages')
      languagesCount = count ?? 0
    }

    // ── LE PRÉDICAT, EN UN SEUL EXEMPLAIRE ────────────────────────────────
    //  Il vivait ici en DEUX versions (freelance et CDI), plus une troisième
    //  dans chaque formulaire, plus une quatrième en contrainte de base.
    //  Quatre copies du même test dérivent : un écran finit par annoncer
    //  « complet » pendant que le serveur refuse, sans que personne puisse
    //  dire lequel a raison.
    //
    //  Désormais lib/profile-visibility.ts est la seule écriture. Cette route
    //  reste LA BARRIÈRE (règle 20) — le formulaire ne fait que prévenir plus
    //  tôt, avec exactement la même liste.
    //
    //  L'unique différence entre freelance et CDI qui subsiste est le champ de
    //  disponibilité, et elle est portée par le paramètre `expertKind`.
    const missing = missingForVisibility(
      {
        title: (patch.title ?? cur.title) as string | null,
        summary: (patch.summary ?? cur.summary) as string | null,
        skills: (patch.skills ?? cur.skills) as string[] | null,
        branch_id: (patch.branch_id ?? cur.branch_id) as string | null,
        speciality_ids: (patch.speciality_ids ?? cur.speciality_ids) as string[] | null,
        speciality_other: ('speciality_other' in patch ? patch.speciality_other : cur.speciality_other) as string | null,
        seniorities: (patch.seniorities ?? cur.seniorities) as string[] | null,
        work_zone_ids: (patch.work_zone_ids ?? cur.work_zone_ids) as string[] | null,
        availability_status: (patch.availability_status ?? cur.availability_status) as string | null,
        cdi_status: (patch.cdi_status ?? cur.cdi_status) as string | null,
        experiences_count: experiencesCount,
        languages_count: languagesCount,
        cv_parsing_status: (cur as { cv_parsing_status?: string | null }).cv_parsing_status ?? null,
        ai_consent_at: (cur as { ai_consent_at?: string | null }).ai_consent_at ?? null,
      },
      isCdi ? 'expert_cdi' : 'expert_freelance',
    )

    if (missing.length) {
      return json({ error: 'Profile incomplete', code: 'incomplete', missing }, 400)
    }
  }

  // ── LA GARDE LIT LA LISTE QUI SERA ÉCRITE, PAS CELLE QUI EST ENVOYÉE ──
  //
  //  ⚠️ LA BARRIÈRE DU LOT 4.1b NE COUVRAIT QUE LE VIDE ENVOYÉ.
  //     Les trois blocs ci-dessous FILTRENT avant d’insérer — un rôle vide,
  //     une école sans diplôme, une langue sans nom disparaissent. Une liste
  //     NON VIDE qui se filtre à rien passait donc la barrière, déclenchait
  //     le `delete` (inconditionnel, ici), et ne réinsérait RIEN.
  //
  //     C’est §E.36 À L’INTÉRIEUR D’UNE FONCTION : la garde teste `X`,
  //     l’action consomme `f(X)`. Il suffit de deux lectures — pas besoin de
  //     deux fichiers. Les deux analyseurs de CV portaient le même défaut sur
  //     leur bloc langues ; les TROIS écrivains portent désormais la même
  //     garde, sur la liste qui sera écrite.
  {
    /** Ce qui, dans une entree, la rend ECRIVABLE — exactement le predicat des
     *  trois `.filter()` ci-dessous. Recopie ici, il divergerait ; il est donc
     *  le MEME, ecrit une fois. */
    type Entree = Record<string, unknown>
    const texte = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    const utilisables: Record<ListeDeProfil, (l: Entree[]) => number> = {
      experiences: (l) => l.filter((e) => texte(e.role)).length,
      educations: (l) => l.filter((e) => texte(e.school) && texte(e.degree)).length,
      languages_structured: (l) => l.filter((x) => texte(x.language)).length,
    }
    for (const cle of LISTES_DE_PROFIL) {
      if (!(cle in body)) continue
      const envoyee = (body as Record<string, unknown>)[cle]
      if (!Array.isArray(envoyee) || envoyee.length === 0) continue
      if (utilisables[cle](envoyee as Entree[]) > 0) continue
      // Non vide, et pourtant rien d’écrivable : on ne supprime pas. Le refus
      // est NOMMÉ — « vide » et « illisible » ne se disent pas pareil.
      console.error('[profile PATCH] liste non vide mais entièrement illisible', { liste: cle })
      return json(
        { error: 'List has no usable entry', code: 'liste_illisible', liste: cle },
        400,
      )
    }
  }

  const touchedBlocks: string[] = []
  // Les listes dont le CONTENU change (relues avant d'être remplacées) — celles qu'écrit « Profil modifié ».
  const blocsModifies: ListeDeProfil[] = []
  const shouldUpdateScalars = Object.keys(patch).length > 0

  // Empty body check: must have either scalars or at least one block
  const hasAnyBlock =
    'experiences' in body || 'educations' in body || 'languages_structured' in body
  if (!shouldUpdateScalars && !hasAnyBlock) {
    return json({ error: 'Empty patch', code: 'no_fields' }, 400)
  }

  // ── BARRIÈRE D'EFFACEMENT DE MASSE — §E.22, DANS SA FORME « ÉCRITURE » ────
  //
  //   ⚠️ UNE LECTURE EN PANNE POUVAIT DEVENIR UN PATCH, ET LE PATCH DÉTRUISAIT.
  //
  //   Les deux écrans de validation chargeaient leurs listes par
  //   `(res.data ?? [])`. Une panne rendait donc un formulaire VIDE ; l'expert
  //   enregistrait son brouillon ; le corps portait `experiences: []` ; et les
  //   trois blocs ci-dessous appliquent une liste vide par un `delete()` qui
  //   ne réinsère rien. « Brouillon enregistré » s'affichait à la seconde
  //   exacte où la carrière entière disparaissait.
  //
  //   LES ÉCRANS SONT CORRIGÉS (`lib/lecture/liste.ts` : ils n'envoient plus
  //   une liste qu'ils n'ont pas su lire). MAIS UN CORRECTIF D'ÉCRAN N'EST PAS
  //   UNE BARRIÈRE : celle-ci est au SERVEUR, et elle tient si un écran
  //   régresse, si un troisième apparaît, ou si la route est appelée à la main.
  //
  //   LA FORME EST CELLE DE `acknowledge_org_lockout` (§E.22 ②) : une action
  //   irréversible ne se prend pas sur une liste qu'on n'a pas constatée. Le
  //   corps DÉCLARE `listes_lues` ; sans cette déclaration, remplacer par le
  //   VIDE une liste NON VIDE est refusé.
  //
  //   CE QUI N'EST PAS REFUSÉ, ET C'EST VOULU : remplacer par une liste non
  //   vide (rien ne se perd qu'on n'ait décidé), et vider une liste déjà vide
  //   (il n'y a rien à perdre). La barrière est posée EXACTEMENT sur
  //   l'irréversible, jamais plus large — une barrière qui gêne le cas normal
  //   est une barrière qu'on retire.
  {
    const declarees = Array.isArray((body as { listes_lues?: unknown }).listes_lues)
      ? ((body as { listes_lues: unknown[] }).listes_lues.filter(estListeDeProfil) as ListeDeProfil[])
      : []
    const TABLE_DE_LA_LISTE: Record<ListeDeProfil, string> = {
      experiences: 'profile_experiences',
      educations: 'profile_educations',
      languages_structured: 'profile_languages',
    }
    for (const cle of LISTES_DE_PROFIL) {
      if (!(cle in body)) continue
      const envoyee = (body as Record<string, unknown>)[cle]
      // Non-tableau ou tableau non vide : aucun effacement de masse possible.
      if (!Array.isArray(envoyee) || envoyee.length > 0) continue
      if (declarees.includes(cle)) continue

      // Le corps veut VIDER cette liste sans avoir déclaré l'avoir lue.
      // On compte ce qu'on s'apprête à détruire AVANT de trancher.
      const { count, error: cntErr } = await supabaseAdmin
        .from(TABLE_DE_LA_LISTE[cle])
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', cp.id)
      if (cntErr) {
        // ⚠️ ET ICI ON NE RETOMBE PAS DANS LA CLASSE QU'ON FERME. Ne pas savoir
        //    combien de lignes on effacerait n'autorise pas à les effacer :
        //    503, motif nommé, aucune écriture. Même règle que `ai-budget`
        //    (§E.9) — « ne pas savoir ne permet pas d'agir ».
        console.error('[profile PATCH] comptage avant effacement indisponible', cle, cntErr.message)
        return json(
          { error: 'Could not verify what would be erased', code: 'effacement_verification_indisponible' },
          503,
        )
      }
      if ((count ?? 0) > 0) {
        return json(
          {
            error: 'Empty list would erase existing rows',
            code: 'effacement_non_declare',
            liste: cle,
            lignes_existantes: count ?? 0,
          },
          409,
        )
      }
    }
  }

  // ── LES LISTES D'ABORD, EN UNE FOIS, OU PAS DU TOUT (audit du 30/09/2026, M4) ──────────
  //  La route supprimait puis réinsérait chaque liste, et une réinsertion refusée n'était que
  //  JOURNALISÉE : « Brouillon enregistré » s'affichait pendant que la liste disparaissait.
  //  `remplacer_listes_profil` remplace les listes envoyées DANS UNE TRANSACTION : la première
  //  ligne refusée annule tout, et la base dit laquelle et pourquoi (LP001) — l'écran nomme le champ.
  //  Elles passent AVANT les champs simples : un refus ici n'a rien écrit du tout.
  const listeEnvoyee = (cle: ListeDeProfil): unknown[] | null => {
    if (!(cle in body)) return null
    const v = (body as Record<string, unknown>)[cle]
    return Array.isArray(v) ? v : []
  }
  if (hasAnyBlock) {
    const experiences = listeEnvoyee('experiences')
    const formations = listeEnvoyee('educations')
    // Les langues : dédoublonnées sur le nom, une seule principale — la forme que la table accepte.
    const languesBrutes = listeEnvoyee('languages_structured')
    let langues: Array<{ language: string; level: unknown; is_primary: boolean }> | null = null
    if (languesBrutes) {
      const vues = new Set<string>()
      let principale = false
      langues = []
      for (const l of languesBrutes as LanguageInput[]) {
        const nom = typeof l?.language === 'string' ? l.language.trim() : ''
        const cleLangue = nom.toLowerCase()
        if (!nom || vues.has(cleLangue)) continue
        vues.add(cleLangue)
        const estPrincipale = !!l.is_primary && !principale
        if (estPrincipale) principale = true
        langues.push({ language: nom, level: l.level, is_primary: estPrincipale })
      }
    }
    const pExperiences = experiences
      ? (experiences as ExperienceInput[]).filter((e) => typeof e?.role === 'string' && e.role.trim())
      : null
    const pFormations = formations
      ? (formations as EducationInput[]).filter((e) => typeof e?.school === 'string' && e.school.trim() && typeof e?.degree === 'string' && e.degree.trim())
      : null
    // CE QUI CHANGE VRAIMENT (décision de Youssef, 01/10/2026, ARRÊT 22) : chaque liste envoyée est relue AVANT d'être
    // remplacée ; une liste renvoyée à l'identique n'est pas « modifiée ». Une relecture en panne compte comme un
    // changement (le doute écrit, il ne tait rien).
    const envoyees: Array<[ListeDeProfil, string, unknown[] | null]> = [
      ['experiences', 'profile_experiences', pExperiences],
      ['educations', 'profile_educations', pFormations],
      ['languages_structured', 'profile_languages', langues],
    ]
    for (const [cle, table, nouvelles] of envoyees) {
      if (nouvelles === null) continue
      const { data: lues, error: luesErr } = await supabaseAdmin.from(table).select('*').eq('profile_id', cp.id)
      // Les EXPÉRIENCES gardent leur rang (sort_order) : les réordonner est une modification (décision de Youssef).
      if (luesErr || listeModifiee((lues ?? []) as Array<Record<string, unknown>>, nouvelles as Array<Record<string, unknown>>, cle === 'experiences')) {
        blocsModifies.push(cle)
      }
    }
    const { error: listesErr } = await supabaseAdmin.rpc('remplacer_listes_profil', {
      p_profile_id: cp.id,
      p_experiences: pExperiences,
      p_formations: pFormations,
      p_langues: langues,
    })
    if (listesErr) {
      if (listesErr.code === 'LP001') {
        // La cause, NOMMÉE par la base : la liste, le rang (à partir de 1), la colonne.
        let cause: Record<string, unknown> = {}
        try {
          cause = JSON.parse(listesErr.message) as Record<string, unknown>
        } catch {
          cause = { cause: 'ligne_refusee' }
        }
        return json({ error: 'A list entry was refused', code: 'liste_refusee', ...cause }, 400)
      }
      console.error('[profile PATCH] listes NON écrites — rien n a été modifié', { message: listesErr.message })
      return json({ error: 'Lists could not be saved', code: 'listes_non_ecrites' }, 503)
    }
    for (const cle of LISTES_DE_PROFIL) if (cle in body) touchedBlocks.push(cle)
  }

  // ② Les champs simples : la valeur envoyée contre la valeur LUE avant l'écriture — seules les vraies différences
  //    entrent dans « Profil modifié ». Une lecture en panne compte tout comme modifié (le doute écrit).
  let champsReellementModifies: string[] = Object.keys(patch)
  if (shouldUpdateScalars) {
    const { data: avant, error: avantErr } = await supabaseAdmin
      .from('profiles')
      .select(Object.keys(patch).join(', '))
      .eq('id', cp.id)
      .maybeSingle()
    if (!avantErr && avant) champsReellementModifies = clesModifiees(patch, avant as unknown as Record<string, unknown>)
  }

  let updatedProfile: unknown = null
  if (shouldUpdateScalars) {
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update(patch)
      .eq('id', cp.id)
      .select('*')
      .single()

    if (updateErr) {
      // UNE VALEUR QUE LA BASE REFUSE NOMME SON CHAMP (audit du 30/09/2026, m6) : la contrainte
      // porte le nom de la colonne ; « Erreur lors de la sauvegarde » ne disait ni lequel ni pourquoi.
      const contrainte = /constraint "([a-z0-9_]+)"/.exec(updateErr.message ?? '')?.[1] ?? null
      const CHAMP_DE_LA_CONTRAINTE: Record<string, string> = {
        profiles_birth_year_check: 'birth_year',
        profiles_years_total_experience_check: 'years_total_experience',
        profiles_cdi_salary_min_check: 'cdi_salary_min',
        profiles_cdi_salary_max_check: 'cdi_salary_max',
        profiles_cdi_salary_range_check: 'cdi_salary_max',
        profiles_cdi_variable_pct_check: 'cdi_variable_pct',
        profiles_availability_status_check: 'availability',
        profiles_work_modes_valid: 'work_modes',
        profiles_seniorities_check: 'seniorities',
        profiles_visible_requiert_criteres_check: 'visibilite',
      }
      if (updateErr.code === '23514' && contrainte && CHAMP_DE_LA_CONTRAINTE[contrainte]) {
        return json({ error: 'A field was refused', code: 'champ_refuse', champ: CHAMP_DE_LA_CONTRAINTE[contrainte] }, 400)
      }
      if (updateErr.code === '22001') {
        return json({ error: 'A text is too long', code: 'texte_trop_long' }, 400)
      }
      console.error('[profile PATCH] update failed', updateErr)
      return json({ error: 'Update failed', code: 'db_error' }, 500)
    }
    updatedProfile = updated
  }

  // Un refus du grand livre est GARDÉ et rendu à la fin : le profil est
  // enregistré, la vérification et la mise en relation partent quand même,
  // seule la trace manque — et la réponse le dit (§D.26, §C.21).
  let journalRefuse: JournalError | null = null
  // La vérification n'a pas pu être DÉPOSÉE : le profil est enregistré, la réponse le dit.
  let verificationNonDeposee = false

  // LA LIGNE DE LA MODIFICATION — les NOMS des champs et des blocs touchés, hors
  // `visible` (la publication a sa ligne) et hors le champ de disponibilité (la
  // bascule a la sienne). Rien à écrire si le geste n'était que l'un des deux.
  const champDispo = CHAMP_DISPONIBILITE[isCdi ? 'expert_cdi' : 'expert_freelance']
  // Une photo DÉPOSÉE a sa propre ligne, `photo_deposee` (POST /api/profile/photo, remplacement compris) : `photo_url`
  // n'est nommée ici que si la photo est RETIRÉE (null) — une ligne lisible par geste, pas deux (fusion S1, 01/10/2026).
  const champsModifies = champsReellementModifies.filter((k) => k !== 'visible' && k !== champDispo && !(k === 'photo_url' && patch.photo_url != null))
  if (champsModifies.length > 0 || blocsModifies.length > 0) {
    try {
      await profilModifie(supabaseAdmin, journal, { profileId: cp.id, champs: champsModifies, blocs: blocsModifies })
    } catch (err) {
      if (!(err instanceof JournalError)) throw err
      journalRefuse = err
      console.error('[profile PATCH] grand livre en échec après écriture', { profileId: cp.id, message: err.message })
    }
  }

  // LA BASCULE DE DISPONIBILITÉ — le champ de la voie, l'état d'AVANT (lu avec
  // le profil) et l'état d'après. Une valeur renvoyée inchangée n'est pas une
  // bascule : rien à écrire.
  if (champDispo in patch && patch[champDispo] !== cp[champDispo]) {
    try {
      await disponibiliteBasculee(supabaseAdmin, journal, { profileId: cp.id, champ: champDispo, de: (cp[champDispo] as string | null) ?? null, vers: (patch[champDispo] as string | null) ?? null })
    } catch (err) {
      if (!(err instanceof JournalError)) throw err
      journalRefuse = err
      console.error('[profile PATCH] grand livre en échec après écriture', { profileId: cp.id, message: err.message })
    }
  }

  // Passage en review si publication
  if (body.visible === true) {
    const { error: userUpdErr } = await supabaseAdmin
      .from('users')
      .update({ status: 'in_review' })
      .eq('id', user.id)
    if (userUpdErr) {
      console.error('[profile PATCH] user status update failed', userUpdErr)
    }

    // LA LIGNE DU GRAND LIVRE — la (re)publication, AVANT la vérification qui
    // en découle et avant l'audit best-effort (§E.68). Première fois ou
    // republication : `visible` a été LU avant l'écriture.
    // « Profil publié » s'écrit quand le profil DEVIENT visible (décision de Youssef, 01/10/2026, ARRÊT 22) ; une
    // republication d'un profil déjà visible n'en écrit plus — la vérification qu'elle relance a sa propre ligne.
    try {
      if (cp.visible !== true) {
        await profilPublie(supabaseAdmin, journal, { profileId: cp.id, dejaVisible: false, verificationAvant: (cp.verification_status as string | null) ?? null })
      }
    } catch (err) {
      if (!(err instanceof JournalError)) throw err
      journalRefuse = err
      console.error('[profile PATCH] grand livre en échec après écriture', { profileId: cp.id, message: err.message })
    }

    // ── LA VÉRIFICATION EST DÉPOSÉE, PAS EXÉCUTÉE ICI (§D.30, audit du 30/09/2026 : B3) ──
    //  Toute (re)publication relance la vérification, comme avant. Mais elle tournait DANS
    //  cette requête (jusqu'à trois appels de 45 s) sous un plafond de 60 s : coupée, le
    //  profil restait « vérification en cours » pour toujours, et l'expert lisait « Erreur
    //  lors de la sauvegarde » alors que son profil était publié. Désormais un TRAVAIL est
    //  déposé — le profil passe « en cours » (sauf s'il est déjà approuvé) dans la même
    //  transaction — et l'exécutant `/api/cron/travaux-ia` conclut hors de la requête.
    const depot = await deposerVerificationExpert(supabaseAdmin, journal, { profileId: cp.id })
    if (!depot.ok) {
      console.error('[profile PATCH] vérification NON déposée — le profil est publié, sa vérification ne part pas', {
        profileId: cp.id,
        message: depot.message,
      })
      verificationNonDeposee = true
    } else if (cp.verification_status !== 'approved') {
      // LA NOTIFICATION « L'IA VÉRIFIE » PART À LA PUBLICATION (recette du 01/10/2026, point 7) :
      // elle n'existait qu'au verdict, et seulement si l'IA déférait à un humain — l'expert
      // l'apprenait une minute après. Pas pour un profil DÉJÀ validé qui republie : il reste
      // validé pendant sa re-vérification (§H.5), et la pastille le dit ; une notification
      // « en cours » la contredirait. Le dépôt a réussi : c'est bien ce qui se passe.
      await notifyExpertResult({
        supabaseAdmin,
        user_id: user.id,
        domain_id: user.domain_id,
        user_type: userType,
        locale: langueDeNotification((userMetaRow as { locale?: string | null } | null)?.locale ?? null),
        verification_status: 'pending',
        reason: null,
        piece: journal.piece,
      })
    }
  }

  await logAudit({
    piece: journal.piece,
    supabaseAdmin,
    user_id: user.id,
    domain_id: user.domain_id,
    action: 'profile_update',
    entity_type: 'profile',
    entity_id: cp.id,
    detail: { keys: Object.keys(patch), blocks: touchedBlocks },
  })

  // ── Matching réconcilié — déclencheur EXPERT (post-PATCH profile) ────────
  // Non-bloquant POUR LE USER : on retourne la response immédiatement, et le
  // matching IA (~10-15s) tourne via `after()` après l'envoi de la response
  // mais AVANT que le runtime serverless ne soit suspendu. Sans `after()`, un
  // simple `void promise` serait tué par Vercel quand la response part
  // (bug constaté sur Achwek : trigger jamais exécuté en prod).
  //
  // On relit verification_status post-update (l'auto-approve inline ci-dessus
  // a pu basculer le statut). Coût IA : 1 appel batché par enregistrement.
  after(async () => {
    try {
      const { data: postUpd, error: postUpdErr } = await supabaseAdmin
        .from('profiles')
        .select('verification_status, visible, ai_consent_at, cv_parsing_status')
        .eq('id', cp.id)
        .maybeSingle()

      // ══════════════════════════════════════════════════════════════════
      //  ⚠️ CETTE RELECTURE DÉCIDE D'UNE ÉCRITURE. ELLE NE PEUT PAS ÉCHOUER
      //     EN SILENCE.
      //
      //     L'erreur n'était pas récupérée. `postUpd` tombait à `null`,
      //     `status` valait `null`, `null !== 'approved'` était VRAI, et la
      //     branche DÉMOTION ci-dessous s’exécutait : les recommandations
      //     étaient supprimées et `users.is_verified` repassait à FAUX.
      //
      //     **UNE LECTURE EN PANNE ÉCRIVAIT EN BASE** — §E.27 forme A, sur
      //     l'enregistrement d'un simple brouillon par un expert APPROUVÉ.
      //
      //     ET RIEN NE LE RATTRAPAIT. Pour un expert, `is_verified: true`
      //     n'est écrit QUE par `/api/admin/approve-expert` : la colonne
      //     `verification_status` restait `approved` (donc aucune revue ne
      //     s'ouvrait), pendant que le badge et les recommandations
      //     disparaissaient. L'invariant que trois autres routes énoncent —
      //     `is_verified === (verification_status === 'approved')` — était
      //     rompu, sans réconciliation et sans trace.
      //
      //     ON NE DÉMOTE PAS SUR UN ÉTAT QU'ON N'A PAS LU. Ni démotion, ni
      //     remise en relation : les deux consomment `status`. Le profil est
      //     déjà enregistré, la réponse est partie ; ce qui reste à faire
      //     ici se refera au prochain enregistrement, ou à la ré-approbation.
      //     Les deux causes sont journalisées SÉPARÉMENT : une lecture en
      //     panne se rejoue, un profil disparu non (§E.29).
      // ══════════════════════════════════════════════════════════════════
      if (postUpdErr) {
        console.error(
          '[profile:PATCH] statut post-enregistrement ILLISIBLE — ni démotion, ni mise en relation',
          { profileId: cp.id, message: postUpdErr.message },
        )
        return
      }
      if (!postUpd) {
        console.error(
          '[profile:PATCH] profil INTROUVABLE juste après son propre enregistrement',
          { profileId: cp.id },
        )
        return
      }
      const status = postUpd.verification_status ?? null

      if (status !== 'approved') {
        // ── DÉMOTION ───────────────────────────────────────────────────────
        // Re-publication non approuvée (pending_admin_review / rejected /
        // pending) : les missions recommandées suivent STRICTEMENT le statut.
        //  → on retire les recommandations (préserve dismissed + candidaturés)
        //    ET on remet users.is_verified=false (badge "vérifié" + gating home).
        // L'expert n'est plus matchable tant qu'il n'est pas ré-approuvé.
        const { clearExpertRecommendations } = await import('@/lib/matching')
        const cleared = await clearExpertRecommendations({ supabaseAdmin, profileId: cp.id })
        const { error: vErr } = await supabaseAdmin
          .from('users')
          .update({ is_verified: false })
          .eq('id', user.id)
        if (vErr) console.error('[profile:PATCH] is_verified=false failed', vErr.message)
        console.log('[profile:PATCH] demotion cleanup', {
          profileId: cp.id,
          status,
          matches_removed: cleared.deleted,
        })
        return
      }

      // ── APPROUVÉ : (re)matching réconcilié ────────────────────────────────
      // reconcile efface d'abord les matches obsolètes puis insère les frais
      // (sans doublon — contrainte UNIQUE — ni re-spam de notif). Garde les
      // mêmes pré-conditions de "vraiment live" (visible + consent + CV parsé).
      // `postUpd` est NON NUL ici, par construction : les deux refus
      // ci-dessus sont sortis. Garder `?.` laisserait croire l'inverse.
      const ready =
        postUpd.visible === true &&
        postUpd.ai_consent_at != null &&
        postUpd.cv_parsing_status === 'done'
      if (!ready) return

      // ══════════════════════════════════════════════════════════════════
      //  DEUX CAS, ET UN SEUL EST UNE RAFALE.
      //
      //  ① LE PROFIL VIENT D'ÊTRE APPROUVÉ → ON EXÉCUTE, TOUT DE SUITE.
      //     `lib/matching/relance.ts` énonce cette règle en toutes lettres
      //     depuis le lot 6 — « IMMÉDIAT À L'APPROBATION. C'est le moment qui
      //     compte pour l'expert : son profil vient d'être validé, il doit
      //     voir des annonces tout de suite. » — et le code ne l'appliquait
      //     PAS : tout partait en relance à soixante minutes.
      //
      //     La conséquence se lisait à l'écran, mesurée le 21/09/2026 : la
      //     page de validation posait un jalon « analyse en cours », le
      //     tableau de bord l'affichait deux minutes, puis annonçait « aucune
      //     mission ne correspond à votre profil ». Un expert fraîchement
      //     approuvé lisait donc un REFUS là où rien n'avait encore tourné.
      //
      //     Ce n'est pas une rafale : on ne se fait approuver qu'une fois. Le
      //     report n'y absorbait rien et ne protégeait aucun coût.
      //
      //  ② TOUT AUTRE ENREGISTREMENT → ON REPORTE.
      //     Le moteur tournait ici à CHAQUE enregistrement. Un expert qui
      //     reprend son profil en dix fois déclenchait dix runs — ou, pire, un
      //     seul suivi de neuf refus de débit, et ses neuf dernières
      //     modifications n'étaient JAMAIS notées. L'échéance est repoussée à
      //     chaque nouvel enregistrement : on attend qu'il ait fini, puis on
      //     note UNE fois, sur son état final. Rien n'est perdu, et rien n'est
      //     payé dix fois. C'est ici, et seulement ici, que la rafale existe.
      // ══════════════════════════════════════════════════════════════════
      // UN PROFIL QUI N'ÉTAIT PAS APPROUVÉ n'a rien à lancer ici : sa première mise en relation
      // part du VERDICT de sa vérification (lib/travaux-ia/executer-verification.ts), immédiate
      // et rejouée si elle échoue. Ce qui reste ici est la rafale d'un profil DÉJÀ approuvé.
      const etaitApprouve = (cp.verification_status ?? null) === 'approved'
      if (!etaitApprouve) {
        return
      }

      const { programmerRelance } = await import('@/lib/matching/relance')
      const prog = await programmerRelance(supabaseAdmin, cp.id, 'profil_modifie')
      if (!prog.ok) {
        console.error(
          '[profile:PATCH] relance NON programmée — ces modifications ne seront pas notées',
          { profileId: cp.id, raison: prog.raison },
        )
      }
    } catch (err) {
      // L'échec est SANS CONSÉQUENCE immédiate pour l'expert : on tourne dans
      // un after(), la réponse est partie, son profil est enregistré. Mais sa
      // relance n'est pas programmée, donc ses modifications ne seront pas
      // notées — et un flux qui reste vide sans explication est exactement le
      // faux défaut qu'on passe des heures à diagnostiquer.
      console.error(
        '[profile:PATCH] relance impossible — le profil est enregistré, ' +
          'mais ces modifications ne seront pas prises en compte par la mise en relation.',
        { profileId: cp.id, cause: err instanceof Error ? err.message : String(err) },
      )
    }
  })

  // Le profil est ENREGISTRÉ dans les deux cas : la réponse dit ce qui manque, avec un code que l'écran traduit.
  if (verificationNonDeposee) {
    return json({ error: 'Profile saved, verification not started', code: 'verification_non_deposee', profile_id: cp.id }, 503)
  }
  if (journalRefuse) return json({ error: 'Journal failed', code: 'journal_error', profile_id: cp.id }, 500)
  return json({ profile: updatedProfile, verification: body.visible === true ? 'deposee' : null })
}
