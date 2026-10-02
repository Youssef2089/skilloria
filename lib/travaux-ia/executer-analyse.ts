import type { SupabaseClient } from '@supabase/supabase-js'
import { parseCV } from '@/lib/cv-parser'
import { parseCdiCV } from '@/lib/cv-parser-cdi'
import { estRejouable, type CauseEchecModele } from '@/lib/profil/cause-echec-modele'
import { normaliserAnalyse } from '@/lib/profil/normaliser-analyse'
import { rattacheurDeLangues, type NomDeLangueConnu } from '@/lib/profil/langues'
import { loadCvParsingQuota, QuotaConfigMissing } from '@/lib/ai-quotas'
import { budgetDisponible, enregistrerDepenseIA } from '@/lib/ai-budget'
import { cvTeleverse } from '@/lib/profil/journal-profil'
import { JournalError } from '@/lib/journal/journaliser'
import { contexteDuTravail, echouerTravail, type Travail } from './travail'
import { lectureIncomplete, lireToutesLesLignes } from '@/lib/matching/lecture-paginee'

/**
 * L'ANALYSE D'UN CV, HORS DE LA REQUÊTE DE L'EXPERT (§D.30, §E.88).
 *
 * ═══ CE QUI A CHANGÉ, ET POURQUOI ══════════════════════════════════════════
 *   Les routes `upload-cv` et `cdi-upload-cv` faisaient tout dans la requête :
 *   stockage, référentiel, modèle (jusqu'à deux appels de 30 s), écriture — sous
 *   un plafond de 60 s. Coupée, la requête laissait « analyse en cours » pour
 *   toujours. Les routes STOCKENT et DÉPOSENT ; ce module fait le reste, sous le
 *   bail d'un travail, et la base clôt ce qu'il n'a pas pu finir.
 *
 * ═══ UNE ERREUR DE NOTRE CÔTÉ NE COÛTE RIEN À L'EXPERT (point 5) ═══════════
 *   · le QUOTA ne compte que les analyses ABOUTIES, et il se compte dans la
 *     transaction qui écrit l'analyse (`ecrire_analyse_cv`) ;
 *   · la DÉPENSE réellement payée au fournisseur reste comptée (§D.24), mais une
 *     analyse que NOUS n'avons pas su écrire est imputée `non_imputable`, avec sa
 *     raison — jamais au plafond du compte de l'expert.
 *
 * ═══ CE QUI SE REJOUE, CE QUI NE SE REJOUE PAS ══════════════════════════════
 *   Rejoué (jusqu'au plafond de tentatives) : le document illisible dans le
 *   stockage, le référentiel en panne, le modèle injoignable, l'écriture en panne.
 *   Clos tout de suite, avec un motif nommé que l'écran traduit : la clé du
 *   fournisseur absente, le plafond de dépense atteint, un document que le
 *   fournisseur refuse, une réponse illisible — les rejouer produirait la même
 *   issue, payée une fois de plus.
 */

export type IssueAnalyse =
  | { issue: 'reussi'; ecarts: number }
  | { issue: 'annule' }
  | { issue: 'rejoue' | 'echoue' | 'inconnu'; code: string }

const COLONNES_PROFIL =
  'id, user_id, domain_id, visible, verification_status, ai_consent_at, title, summary, seniorities, ' +
  'years_experience, skills, certifications, branch_id, speciality_ids, speciality_other, languages, location, ' +
  'tjm_min, tjm_max, linkedin_url, phone, address_line, postal_code, city, country, birth_year, ' +
  'years_total_experience, work_modes, cdi_status, cdi_notice_period, cdi_salary_min, cdi_salary_max, ' +
  'cdi_variable_pct, cdi_career_goals, cdi_motivations'

/**
 * CE QU'UN NOUVEAU DOCUMENT REMPLACE, ET CE QU'IL NE TOUCHE PAS (décision de
 * Youssef, 30/09/2026 : le profil se remplit par le CV ou l'export LinkedIn).
 *   · Les FAITS du document sont remplacés par ceux du nouveau document — un
 *     nouveau CV qui ne changerait rien serait un mur.
 *   · Les CHOIX de l'expert — séniorités acceptées, modes de travail, tarif,
 *     branche et spécialités confirmées, disponibilité CDI — ne sont PAS écrasés :
 *     un document les propose seulement quand ils sont vides.
 */
const CHOIX_DE_L_EXPERT = new Set([
  'seniorities', 'work_modes', 'tjm_min', 'tjm_max', 'branch_id', 'speciality_ids',
  'cdi_status', 'cdi_notice_period', 'cdi_salary_min', 'cdi_salary_max', 'cdi_variable_pct',
])

const vide = (v: unknown): boolean =>
  v === null || v === undefined || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && v.trim() === '')

/** Le contexte d'une ligne de dépense de ce travail : le travail, et si l'analyse a abouti. */
const contexteDepense = (t: Travail, aboutie: boolean) => ({ travail_id: t.id, aboutie })

export async function executerAnalyseCv(admin: SupabaseClient, t: Travail): Promise<IssueAnalyse> {
  const journal = contexteDuTravail(t)
  const echouer = async (code: string, rejouable: boolean): Promise<IssueAnalyse> => {
    const statut = await echouerTravail(admin, t.id, code, rejouable)
    console.error('[travaux-ia:analyse] échec', { travailId: t.id, code, rejouable, statut })
    return { issue: statut === 'en_attente' ? 'rejoue' : statut === 'echoue' ? 'echoue' : 'inconnu', code }
  }

  // ── 1. Le profil et la voie de l'expert ──────────────────────────────────
  const { data: prof, error: profErr } = await admin.from('profiles').select(COLONNES_PROFIL).eq('id', t.profile_id).maybeSingle()
  if (profErr) return echouer('profil_illisible', true)
  if (!prof) return echouer('profil_introuvable', false)
  const profil = prof as unknown as Record<string, unknown> & { id: string; user_id: string; domain_id: string }
  const { data: u, error: uErr } = await admin.from('users').select('user_type').eq('id', profil.user_id).maybeSingle()
  if (uErr) return echouer('compte_illisible', true)
  const voie = (u as { user_type?: string } | null)?.user_type
  if (voie !== 'expert_freelance' && voie !== 'expert_cdi') return echouer('voie_inconnue', false)

  // ── 2. Le document, dans le stockage privé ───────────────────────────────
  const chemin = typeof t.charge.chemin === 'string' ? t.charge.chemin : null
  if (!chemin) return echouer('document_absent', false)
  const { data: blob, error: dlErr } = await admin.storage.from('cv').download(chemin)
  if (dlErr || !blob) return echouer('stockage_illisible', true)
  const buffer = Buffer.from(await blob.arrayBuffer())

  // ── 3. Le référentiel de l'écosystème — sans lui, l'analyse serait payée puis inclassable ──
  // La liste FERMÉE des langues et leurs noms connus : la règle de `code_de_langue()`, sur les mêmes lignes
  // (relecture du 01/10/2026, point 20 — plus de seconde liste dans le code).
  // LES DEUX LISTES SONT LUES EN ENTIER (relecteur, 02/10/2026) : l'API rend au plus 1 000 lignes par requête, et
  // `langues_noms` en compte déjà 467 — au-delà de 1 000, la liste se serait coupée EN SILENCE, et une langue connue de
  // la base n'aurait plus été rattachée. Pages de 1 000, ordre total sur la clé, compte confronté ; incomplète, la
  // lecture est une panne de notre côté (rejouée), jamais une liste plus courte.
  const [branchRes, specialityRes, configRes, codesLus, nomsLus] = await Promise.all([
    admin.from('branches').select('id, slug').eq('domain_id', profil.domain_id),
    admin.from('specialities').select('id, slug, active').eq('domain_id', profil.domain_id),
    admin.from('domain_configs').select('tags').eq('domain_id', profil.domain_id).maybeSingle(),
    lireToutesLesLignes<{ code: string }>({
      construire: (o) => admin.from('langues').select('code', o),
      departageUnique: 'code',
      identite: (l) => l.code,
      contexte: 'liste des langues',
    }),
    lireToutesLesLignes<NomDeLangueConnu>({
      construire: (o) => admin.from('langues_noms').select('nom, code', o),
      departageUnique: 'nom',
      identite: (l) => l.nom,
      contexte: 'noms des langues',
    }),
  ])
  if (branchRes.error || specialityRes.error || configRes.error) return echouer('referentiel_illisible', true)
  if (codesLus.erreur || nomsLus.erreur || lectureIncomplete(codesLus) || lectureIncomplete(nomsLus)) return echouer('referentiel_illisible', true)
  const rattacher = rattacheurDeLangues(
    codesLus.lignes.map((l) => l.code),
    nomsLus.lignes,
  )
  const branches = (branchRes.data ?? []) as Array<{ id: string; slug: string }>
  const specialites = (specialityRes.data ?? []) as Array<{ id: string; slug: string; active: boolean }>
  const ctx = {
    tags: ((configRes.data as { tags?: string[] | null } | null)?.tags ?? []) as string[],
    branches: branches.map((b) => b.slug),
    specialities: specialites.filter((s) => s.active).map((s) => s.slug),
  }

  // ── 4. La fenêtre du quota (elle est comptée à l'écriture, si l'analyse aboutit) ──
  let fenetreHeures: number
  try {
    fenetreHeures = (await loadCvParsingQuota(admin)).windowHours
  } catch (err) {
    if (err instanceof QuotaConfigMissing) return echouer('quota_non_configure', false)
    return echouer('quota_illisible', true)
  }

  // ── 5. Le plafond de dépense, AVANT d'appeler (fail-closed, lib/ai-budget.ts) ──
  const budget = await budgetDisponible(admin, 'claude', { acteur: { type: 'profile', id: profil.id }, action: 'cv_parsing' }, journal)
  if (!budget.ok) return echouer('plafond_depense', false)

  // ── 6. Le modèle ─────────────────────────────────────────────────────────
  const resultat = voie === 'expert_cdi' ? await parseCdiCV(buffer, ctx) : await parseCV(buffer, ctx)
  if (!resultat.success) {
    const cause: CauseEchecModele = resultat.cause
    // Le modèle a répondu (réponse illisible, document refusé) : c'est le document de l'expert qui a été lu.
    if (resultat.usage) {
      await enregistrerDepenseIA(admin, {
        provider: 'claude', action: 'cv_parsing', journal, domain_id: t.domain_id,
        acteur: { type: 'profile', id: profil.id },
        consommation: resultat.usage, context: contexteDepense(t, false),
      })
    }
    return echouer(cause, estRejouable(cause))
  }
  const brut = resultat.data as unknown as Record<string, unknown>

  // ── 7. Les formes (ici) ; les bornes, en base ────────────────────────────
  const n = normaliserAnalyse(brut, rattacher)
  const branchSlug = typeof brut.branch_slug === 'string' ? brut.branch_slug : null
  const slugs = Array.isArray(brut.speciality_slugs) ? (brut.speciality_slugs as unknown[]).filter((s): s is string => typeof s === 'string') : []
  const propose: Record<string, unknown> = {
    ...n.profil,
    branch_id: branchSlug ? branches.find((b) => b.slug === branchSlug)?.id ?? null : null,
    speciality_ids: specialites.filter((s) => s.active && slugs.includes(s.slug)).map((s) => s.id),
  }
  // Ce qui s'écrit : les faits du document (non vides) ; les choix de l'expert s'ils sont vides.
  const aEcrire: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(propose)) {
    if (vide(v)) continue
    if (CHOIX_DE_L_EXPERT.has(k) && !vide(profil[k])) continue
    aEcrire[k] = v
  }

  // ── 8. L'écriture ET la clôture du travail, dans une transaction ─────────
  const { data: ecrit, error: ecErr } = await admin.rpc('terminer_analyse_cv', {
    p_travail: t.id,
    p_profil: aEcrire,
    p_experiences: n.experiences,
    p_formations: n.formations,
    p_langues: n.langues,
    p_fenetre_quota: `${fenetreHeures} hours`,
    p_ecarts_amont: n.ecarts,
  })
  if (ecErr) {
    // NOTRE écriture a échoué : la dépense payée n'est pas imputée à l'expert (point 5).
    if (resultat.usage) {
      await enregistrerDepenseIA(admin, {
        provider: 'claude', action: 'cv_parsing', journal, domain_id: t.domain_id,
        acteur: { type: 'non_imputable', pourquoi: `analyse non écrite (${ecErr.code ?? 'sans code'})` },
        consommation: resultat.usage, context: contexteDepense(t, false),
      })
    }
    console.error('[travaux-ia:analyse] écriture en panne', { travailId: t.id, sqlstate: ecErr.code, message: ecErr.message })
    return echouer('ecriture_en_panne', true)
  }
  const r = (ecrit ?? {}) as { ecrit?: boolean; ecarts?: unknown[]; comptes?: Record<string, number> }
  if (r.ecrit !== true) {
    // Un CV plus récent a été déposé pendant l'analyse : celle-ci ne s'écrit pas, et c'est une issue.
    if (resultat.usage) {
      await enregistrerDepenseIA(admin, {
        provider: 'claude', action: 'cv_parsing', journal, domain_id: t.domain_id,
        acteur: { type: 'profile', id: profil.id },
        consommation: resultat.usage, context: contexteDepense(t, false),
      })
    }
    return { issue: 'annule' }
  }
  if (resultat.usage) {
    await enregistrerDepenseIA(admin, {
      provider: 'claude', action: 'cv_parsing', journal, domain_id: t.domain_id,
      acteur: { type: 'profile', id: profil.id },
      consommation: resultat.usage, context: contexteDepense(t, true),
    })
  }

  // ── 9. La ligne du geste, sous SA pièce (§D.26) ──────────────────────────
  const ecarts = Array.isArray(r.ecarts) ? r.ecarts.length : 0
  try {
    await cvTeleverse(admin, journal, {
      profileId: profil.id,
      octets: typeof t.charge.octets === 'number' ? t.charge.octets : buffer.length,
      analyse: 'done',
      premierConsentement: t.charge.premier_consentement === true,
      experiences: r.comptes?.experiences ?? 0,
      formations: r.comptes?.formations ?? 0,
      langues: r.comptes?.langues ?? 0,
      ecarts,
    })
  } catch (err) {
    if (!(err instanceof JournalError)) throw err
    console.error('[travaux-ia:analyse] grand livre en échec après écriture', { travailId: t.id, message: err.message })
  }

  // ── 10. Un expert DÉJÀ en ligne : son document a changé, on le recherche tout de suite ──
  if (profil.verification_status === 'approved' && profil.visible === true && profil.ai_consent_at != null) {
    try {
      const { lancerMiseEnRelationImmediate } = await import('@/lib/matching/mise-en-relation-immediate')
      await lancerMiseEnRelationImmediate(admin, profil.id, journal)
    } catch (err) {
      console.error('[travaux-ia:analyse] mise en relation en échec (l analyse, elle, est écrite)', {
        travailId: t.id,
        cause: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { issue: 'reussi', ecarts }
}
