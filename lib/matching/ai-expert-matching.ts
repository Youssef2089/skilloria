import Anthropic from '@anthropic-ai/sdk'
import type { AnnonceType } from '@/types/annonce'
import type {
  MatchingConfig,
  ProfileCandidate,
  PublicationForMatching,
} from './types'

/**
 * Appel IA inverse — 1 EXPERT vs N PUBLICATIONS (miroir de
 * ai-profile-matching.ts qui fait 1 publication vs N candidats).
 *
 * Pourquoi un 2e prompt :
 *   - Côté annonce → on cherche LES experts qui matchent UNE annonce.
 *   - Côté expert → on cherche LES annonces qui matchent UN expert (entrée
 *     dans la marketplace, modification de profil, fin DND…).
 * Les 2 directions partagent le MÊME provider (verification_providers /
 * 'profile_matching'), la MÊME échelle 0-10, la MÊME contrainte PII (aucun
 * champ identifiant dans le prompt — la whitelist ProfileCandidate / les
 * champs publications sont déjà non-PII).
 *
 * Le moteur IA NE LIT JAMAIS Supabase. Tous les champs viennent du caller,
 * pré-filtrés frontière (domaine, type, eligibility) côté serveur.
 *
 * INPUT  : un ProfileCandidate (l'expert) + N PublicationForMatching (le pool
 *          d'annonces compatibles déjà chargées par le caller).
 * OUTPUT : `{ proposals: [{ publication_id, score, reason, pitch_org? }] }` —
 *          sous-ensemble jugé pertinent par l'IA (score >= 5), trié décroissant.
 */

const REQUEST_TIMEOUT_MS = 60_000

type ClaudeMatch = {
  publication_id?: unknown
  score?: unknown
  reason?: unknown
  pitch_org?: unknown
}

type ClaudeOutput = {
  matches?: unknown
}

function sanitize(s: string | null | undefined, max: number): string {
  return (s ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, max)
}

function sanitizeList(values: string[] | null | undefined, maxItems: number, maxLen: number): string {
  if (!values || values.length === 0) return '—'
  return (
    values
      .slice(0, maxItems)
      .map((v) => sanitize(v, maxLen))
      .filter((s) => s.length > 0)
      .join(', ') || '—'
  )
}

function languageName(locale: string): string {
  switch (locale) {
    case 'fr': return 'français'
    case 'en': return 'anglais'
    case 'es': return 'espagnol'
    case 'de': return 'allemand'
    default:   return 'français'
  }
}

function formatBudget(min: number | null | undefined, max: number | null | undefined, type: AnnonceType): string {
  if (min == null && max == null) return '(non précisé)'
  // offre = salaire annuel ; mission ET sous_traitance = TJM journalier.
  const unit = type === 'offre' ? '€/an' : '€/jour'
  if (min != null && max != null) return `${min} – ${max} ${unit}`
  if (min != null) return `à partir de ${min} ${unit}`
  return `jusqu'à ${max as number} ${unit}`
}

/**
 * `poolHasCross` : le pool contient au moins une opportunité de format croisé
 * (cross_type_opt_in). Ici l'expert est le PIVOT décrit UNE fois pour un pool
 * potentiellement mixte (missions natives + offres croisées) : on ne peut donc
 * pas retirer ses préférences de format globalement (les opportunités natives
 * en ont besoin). On les ISOLE : critères universels toujours transmis ; comp.
 * + mode d'engagement regroupés sous un libellé qui les cantonne au format
 * natif — à ignorer pour les opportunités croisées (renforcé par la Règle 3).
 */
function describeExpert(c: ProfileCandidate, isFreelance: boolean, poolHasCross: boolean): string {
  const lines: string[] = []
  if (c.title) lines.push(`- Titre déclaré : ${sanitize(c.title, 200)}`)
  if (c.summary) lines.push(`- Résumé : ${sanitize(c.summary, 800)}`)
  if (c.seniority) lines.push(`- Séniorité : ${sanitize(c.seniority, 50)}`)
  if (c.years_experience != null) lines.push(`- Années d'expérience (rôle) : ${c.years_experience}`)
  if (c.years_total_experience != null) lines.push(`- Années d'expérience (total) : ${c.years_total_experience}`)
  if (c.branch_name) lines.push(`- Branche : ${sanitize(c.branch_name, 100)}`)
  if (c.speciality_name) lines.push(`- Spécialité : ${sanitize(c.speciality_name, 100)}`)
  // D6 : spécialité hors référentiel (« Autre ») — au même titre que la spécialité.
  else if (c.speciality_other) lines.push(`- Spécialité (précisée) : ${sanitize(c.speciality_other, 100)}`)
  if (c.skills.length > 0) lines.push(`- Compétences : ${sanitizeList(c.skills, 30, 80)}`)
  if (c.languages.length > 0) lines.push(`- Langues : ${sanitizeList(c.languages, 10, 30)}`)
  if (c.certifications_count > 0) lines.push(`- Certifications : ${c.certifications_count}`)

  // Préférences universelles (valent pour TOUTE opportunité du pool) vs
  // préférences liées au FORMAT natif (compensation + mode d'engagement).
  const universal: string[] = []
  const formatSpecific: string[] = []
  if (isFreelance) {
    if (c.tjm_min != null || c.tjm_max != null) {
      formatSpecific.push(`- TJM souhaité : ${formatBudget(c.tjm_min, c.tjm_max, 'mission')}`)
    }
    if (c.work_modes.length > 0) formatSpecific.push(`- Modes de travail acceptés : ${sanitizeList(c.work_modes, 5, 20)}`)
    if (c.mobility) universal.push(`- Mobilité : ${sanitize(c.mobility, 100)}`)
    if (c.availability_status) universal.push(`- Disponibilité : ${sanitize(c.availability_status, 50)}`)
    if (c.availability_date) universal.push(`- Date dispo : ${c.availability_date}`)
  } else {
    if (c.cdi_salary_min != null || c.cdi_salary_max != null) {
      formatSpecific.push(`- Salaire souhaité : ${formatBudget(c.cdi_salary_min, c.cdi_salary_max, 'offre')}`)
    }
    if (c.cdi_status) formatSpecific.push(`- Statut CDI : ${sanitize(c.cdi_status, 50)}`)
    if (c.cdi_notice_period) formatSpecific.push(`- Préavis : ${sanitize(c.cdi_notice_period, 50)}`)
    if (c.cdi_contract_types && c.cdi_contract_types.length > 0) {
      formatSpecific.push(`- Types de contrat : ${sanitizeList(c.cdi_contract_types, 5, 30)}`)
    }
    if (c.cdi_sectors && c.cdi_sectors.length > 0) universal.push(`- Secteurs visés : ${sanitizeList(c.cdi_sectors, 8, 40)}`)
    if (c.cdi_geo_mobility) universal.push(`- Mobilité géographique : ${sanitize(c.cdi_geo_mobility, 100)}`)
  }

  lines.push(...universal)
  if (formatSpecific.length > 0) {
    // Pool mixte : on cantonne explicitement ces préférences au format natif.
    if (poolHasCross) {
      lines.push(
        `- ⚠ Préférences liées au FORMAT NATIF de l'expert — s'appliquent UNIQUEMENT aux opportunités du type natif ; À IGNORER TOTALEMENT pour les opportunités marquées cross_type_opt_in :`,
      )
    }
    lines.push(...formatSpecific)
  }

  if (c.city || c.country) {
    lines.push(`- Localisation : ${sanitize(c.city, 80)}${c.city && c.country ? ', ' : ''}${sanitize(c.country, 80)}`)
  }
  if (c.expert_type) lines.push(`- Type : ${sanitize(c.expert_type, 30)}`)
  return lines.join('\n')
}

function describePublication(p: PublicationForMatching): string {
  const lines: string[] = []
  lines.push(`publication_id: ${p.id}`)
  lines.push(`- Type : ${p.type}`)
  // Marquage NEUTRE de l'ouverture croisée (même champ dans les deux sens).
  if (p.cross_type_opt_in) lines.push(`- cross_type_opt_in : true`)
  lines.push(`- Titre : ${sanitize(p.title, 250)}`)
  if (p.branch_name) lines.push(`- Branche : ${sanitize(p.branch_name, 100)}`)
  if (p.speciality_name) lines.push(`- Spécialité : ${sanitize(p.speciality_name, 100)}`)
  // D6 : spécialité hors référentiel (« Autre »).
  else if (p.speciality_other) lines.push(`- Spécialité (précisée) : ${sanitize(p.speciality_other, 100)}`)
  if (p.skills_required.length > 0) lines.push(`- Compétences requises : ${sanitizeList(p.skills_required, 40, 80)}`)
  if (p.seniority) lines.push(`- Séniorité visée : ${sanitize(p.seniority, 50)}`)
  if (p.work_mode) lines.push(`- Mode de travail : ${sanitize(p.work_mode, 50)}`)
  if (p.location) lines.push(`- Localisation : ${sanitize(p.location, 200)}`)
  if (p.duration) lines.push(`- Durée : ${sanitize(p.duration, 100)}`)
  if (p.budget_min != null || p.budget_max != null) {
    lines.push(`- Budget : ${formatBudget(p.budget_min, p.budget_max, p.type)}`)
  }
  lines.push(`- Description : ${sanitize(p.description, 2500)}`)
  return lines.join('\n')
}

function buildPrompt(expert: ProfileCandidate, publications: PublicationForMatching[], locale: string): string {
  const isFreelance = (expert.expert_type ?? '').toLowerCase().includes('freelance') ||
    publications.some((p) => p.type === 'mission')
  // Pool mixte ? → on cantonne les préférences de format de l'expert (cf. Règle 3).
  const poolHasCross = publications.some((p) => p.cross_type_opt_in)
  const expertBlock = describeExpert(expert, isFreelance, poolHasCross)
  const pubsBlock = publications.map((p, i) => `── Publication #${i + 1} ──\n${describePublication(p)}`).join('\n\n')
  const langName = languageName(locale)

  return `Tu es le moteur de matching IA de Skilloria, une marketplace B2B. Cette fois tu reçois UN expert (whitelist anonymisée, aucune PII) et UN POOL DE PUBLICATIONS déjà filtré frontière (même domaine d'expertise, type d'annonce compatible avec le statut de l'expert).

Ton travail : sélectionner LES PUBLICATIONS les plus pertinentes pour cet expert, les classer et justifier chaque choix.

═══════════════════════════════════════════════════════════════
EXPERT (whitelist anonymisée — aucune PII)
═══════════════════════════════════════════════════════════════
${expertBlock}

═══════════════════════════════════════════════════════════════
POOL DE ${publications.length} PUBLICATION(S) (déjà filtré frontière)
═══════════════════════════════════════════════════════════════
${pubsBlock}

═══════════════════════════════════════════════════════════════
TA MISSION
═══════════════════════════════════════════════════════════════
1. Analyse chaque publication à la lumière du profil expert.
2. Identifie celles dont le fit est raisonnable (compétences proches, séniorité
   adaptée, budget/durée/mode/localisation compatibles…).
3. CLASSE-les par pertinence DÉCROISSANTE.
4. Pour chacune, produis DEUX textes :
   • "reason" : justification NEUTRE/FACTUELLE (1–2 phrases) ADRESSÉE À
     L'EXPERT ("Cette mission correspond à votre expertise X…").
   • "pitch_org" : pitch ORIENTÉ CHASSE (1–2 phrases) ADRESSÉ À L'ENTREPRISE
     qui a publié ("Ce candidat couvre votre besoin Y…"). Premium, factuel,
     pas de superlatifs creux, pas de "parfait".
5. Attribue un score 0–10.
6. NE retourne QUE les publications pertinentes (score >= 5).

⚠ CONTRAINTE PII : l'expert ci-dessus est strictement anonymisé. NE PRODUIS
JAMAIS de nom inventé, d'identité supposée, ou de référence à une personne
nominale. Reste sur les compétences/parcours.

ÉCHELLE DE SCORE :
- 9–10 : fit excellent (compétences-clés couvertes, séniorité OK, budget OK).
- 7–8  : bon fit avec un point d'attention.
- 5–6  : fit moyen — vaut une suggestion mais pas une notification prioritaire.
- 0–4  : pas pertinent (NE PAS inclure).

CONTRAINTES STRICTES :
- publication_id DOIT correspondre EXACTEMENT à l'un des publication_id du
  pool. N'invente JAMAIS un publication_id.
- Aucun élément hors du pool fourni.
- Le ton est PROFESSIONNEL et FACTUEL, en ${langName.toUpperCase()}.

⚠ RÈGLE ABSOLUE 1 — OPPORTUNITÉS MARQUÉES cross_type_opt_in
Le type de contrat a DÉJÀ ÉTÉ VALIDÉ par l'expert lui-même : il a explicitement
demandé à recevoir ce type. Traite cette opportunité EXACTEMENT comme si elle
était du type natif de l'expert.
- Le score doit être IDENTIQUE à celui que tu donnerais si le contrat était du
  type habituel de l'expert. Le type de contrat vaut ZÉRO point, ni positif ni
  négatif.
- N'écris AUCUNE réserve, nuance, restriction ou « bien que » portant sur : le
  type de contrat, le statut de l'expert, ses habitudes de travail, sa
  « démarche », son « contexte habituel », sa préférence supposée pour un mode
  d'engagement.
- Si tu ressens le besoin d'écrire une nuance sur le contrat ou le statut, NE
  L'ÉCRIS PAS : elle est hors-sujet par construction.
Ces règles valent dans "reason" ET dans "pitch_org".

⚠ RÈGLE ABSOLUE 2 — RÉMUNÉRATION HORS-SUJET POUR LES OPPORTUNITÉS cross_type_opt_in
Pour les opportunités marquées cross_type_opt_in, FAIS TOTALEMENT ABSTRACTION
de la rémunération : ni le salaire proposé, ni le TJM proposé, ni la
compensation souhaitée par l'expert n'entrent dans le score, sous aucune forme.
Raison : l'expert n'a jamais renseigné de prétention pour ce format de contrat
(un freelance n'a pas de salaire souhaité, un salarié n'a pas de TJM). Toute
comparaison serait inventée.
- N'évoque PAS la rémunération dans "reason" ni dans "pitch_org" pour ces
  opportunités.
- Ne convertis JAMAIS un salaire annuel en TJM ni l'inverse.
- N'écris aucune réserve du type « budget inférieur à », « rémunération à
  confirmer », « écart de compensation ».
(Pour les opportunités NON marquées cross_type_opt_in, la rémunération reste un
critère normal, comme aujourd'hui.)

⚠ RÈGLE 3 — PRÉFÉRENCES DE FORMAT ABSENTES POUR LES OPPORTUNITÉS cross_type_opt_in
Les préférences de rémunération et de mode d'engagement de l'expert ci-dessus
concernent son format NATIF. Pour une opportunité marquée cross_type_opt_in, tu
ne disposes PAS des préférences de l'expert pour CE format : n'applique aucune
des préférences de format ci-dessus, ne formule aucune hypothèse à leur sujet
et ne pénalise pas leur absence.

CE QUE TU DOIS SCORER (pour TOUTES les opportunités) : adéquation des
compétences, séniorité, secteur/industrie, technologies, localisation
géographique, disponibilité. Un expert dont les compétences collent à ~90 %
doit obtenir 8–9, que le contrat soit natif ou croisé.

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON STRICT, sans markdown, sans texte autour)
═══════════════════════════════════════════════════════════════
{
  "matches": [
    {
      "publication_id": "<UUID exact d'une publication ci-dessus>",
      "score": <entier 0..10, >= 5>,
      "reason": "<1–2 phrases factuelles ADRESSÉES À L'EXPERT, en ${langName.toUpperCase()}>",
      "pitch_org": "<1–2 phrases factuelles ADRESSÉES À L'ENTREPRISE, en ${langName.toUpperCase()}>"
    },
    ...
  ]
}

Si AUCUNE publication ne fit : retourne { "matches": [] }.

Réponds STRICTEMENT en JSON, sans aucun texte avant ou après.`
}

function extractFinalText(response: Anthropic.Messages.Message): string {
  let out = ''
  for (const block of response.content) {
    if (block.type === 'text' && 'text' in block) {
      out += block.text + '\n'
    }
  }
  return out
}

export type ExpertMatchProposal = {
  publication_id: string
  score: number
  reason: string
  pitch_org?: string
}

function normalizeProposal(item: unknown, publicationIds: Set<string>): ExpertMatchProposal | null {
  if (!item || typeof item !== 'object') return null
  const m = item as ClaudeMatch
  const pubId = typeof m.publication_id === 'string' ? m.publication_id.trim() : ''
  const rawScore = typeof m.score === 'number' ? m.score : Number(m.score)
  const reason = typeof m.reason === 'string' ? m.reason.trim().slice(0, 800) : ''
  const pitchOrg = typeof m.pitch_org === 'string' ? m.pitch_org.trim().slice(0, 800) : ''
  if (!pubId || !publicationIds.has(pubId)) return null
  if (!Number.isFinite(rawScore)) return null
  const score = Math.max(0, Math.min(10, Math.round(rawScore)))
  if (!reason) return null
  return pitchOrg
    ? { publication_id: pubId, score, reason, pitch_org: pitchOrg }
    : { publication_id: pubId, score, reason }
}

export type ExpertMatchingResult =
  | { ok: true; proposals: ExpertMatchProposal[]; model: string }
  | { ok: false; error: string }

export async function callExpertMatchingAi(args: {
  config: MatchingConfig
  expert: ProfileCandidate
  publications: PublicationForMatching[]
  locale: 'fr' | 'en' | 'es' | 'de'
}): Promise<ExpertMatchingResult> {
  const { config, expert, publications, locale } = args
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY missing' }
  if (publications.length === 0) return { ok: true, proposals: [], model: config.model }

  const publicationIds = new Set(publications.map((p) => p.id))
  const prompt = buildPrompt(expert, publications, locale)

  const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS })

  let response: Anthropic.Messages.Message
  try {
    response = await client.messages.create({
      model: config.model,
      max_tokens: config.max_tokens,
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Claude call failed: ${msg}` }
  }

  const rawText = extractFinalText(response)
  let parsed: ClaudeOutput | null = null
  const match = rawText.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      parsed = JSON.parse(match[0]) as ClaudeOutput
    } catch {
      parsed = null
    }
  }
  if (!parsed) {
    return { ok: false, error: 'AI response not parsable as JSON' }
  }

  const rawMatches = Array.isArray(parsed.matches) ? parsed.matches : []
  const proposals: ExpertMatchProposal[] = []
  const seen = new Set<string>()
  for (const item of rawMatches) {
    const p = normalizeProposal(item, publicationIds)
    if (!p) continue
    if (seen.has(p.publication_id)) continue
    seen.add(p.publication_id)
    proposals.push(p)
  }
  proposals.sort((a, b) => b.score - a.score)

  return { ok: true, proposals, model: config.model }
}
