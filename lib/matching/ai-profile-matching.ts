import Anthropic from '@anthropic-ai/sdk'
import type { AnnonceType } from '@/types/annonce'
import type {
  AiMatchProposal,
  MatchingConfig,
  PublicationForMatching,
  ProfileCandidate,
} from './types'

/**
 * Appel IA Claude pour le matching profils ↔ publication (Lot 2a).
 *
 * Pattern propre, ISOLÉ — NE PAS refactoriser avec les 2 autres fonctions IA
 * (lib/verification/ai-fallback.ts et ai-publication-quality.ts) dans ce lot.
 * Factorisation des 3 = lot dédié futur, testé sur les 3 chemins.
 *
 * Pas de fallback modèle dans ce premier jet : on appelle UN modèle (lu depuis
 * la config BDD via verification_providers). Si l'appel échoue, on retourne
 * une erreur typée — le caller (runMatching) loggue et continue sans crash.
 *
 * INPUT : la publication + le lot de profils candidats du domaine, déjà filtré
 * frontière (domain + user_type + actif + consentement). L'IA NE FAIT QUE
 * choisir le sous-ensemble pertinent et le scorer. Aucun pré-filtre métier
 * côté backend.
 *
 * OUTPUT : `{ proposals: [{ profile_id, score, reason }, ...] }` — sous-ensemble
 * trié, JAMAIS un scoring exhaustif des N candidats.
 *
 * SÉCURITÉ PII : seuls les champs SAFE de ProfileCandidate sont sérialisés
 * dans le prompt. user_id, phone, email, address, photo_url, cv_url,
 * linkedin_url ne sont JAMAIS présents dans le type ProfileCandidate.
 */

const REQUEST_TIMEOUT_MS = 60_000

const ALLOWED_FLAGS: ReadonlyArray<string> = [] // pas de flags ici, juste score+reason

type ClaudeMatch = {
  profile_id?: unknown
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
  return values
    .slice(0, maxItems)
    .map((v) => sanitize(v, maxLen))
    .filter((s) => s.length > 0)
    .join(', ') || '—'
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

function describeCandidate(c: ProfileCandidate, isMission: boolean): string {
  const lines: string[] = []
  lines.push(`profile_id: ${c.profile_id}`)
  // Marquage NEUTRE de l'ouverture croisée (même champ dans les deux sens).
  if (c.cross_type_opt_in) lines.push(`- cross_type_opt_in : true`)
  if (c.title) lines.push(`- Titre déclaré : ${sanitize(c.title, 200)}`)
  if (c.summary) lines.push(`- Résumé : ${sanitize(c.summary, 500)}`)
  if (c.seniority) lines.push(`- Séniorité : ${sanitize(c.seniority, 50)}`)
  if (c.years_experience != null) lines.push(`- Années d'expérience (rôle) : ${c.years_experience}`)
  if (c.years_total_experience != null) lines.push(`- Années d'expérience (total) : ${c.years_total_experience}`)
  if (c.branch_name) lines.push(`- Branche : ${sanitize(c.branch_name, 100)}`)
  if (c.speciality_name) lines.push(`- Spécialité : ${sanitize(c.speciality_name, 100)}`)
  // D6 : spécialité hors référentiel (« Autre »).
  else if (c.speciality_other) lines.push(`- Spécialité (précisée) : ${sanitize(c.speciality_other, 100)}`)
  if (c.skills.length > 0) lines.push(`- Compétences : ${sanitizeList(c.skills, 30, 80)}`)
  if (c.languages.length > 0) lines.push(`- Langues : ${sanitizeList(c.languages, 10, 30)}`)
  if (c.certifications_count > 0) lines.push(`- Certifications : ${c.certifications_count}`)
  // CAUSE RACINE (Règle 3) : le bloc de préférences ci-dessous suit le format de
  // L'ANNONCE. Pour un candidat CROISÉ, ce sont les préférences d'un format qu'il
  // n'a jamais renseigné (ses champs de CE format sont vides ; ses vraies
  // préférences appartiennent à l'autre format et seraient non pertinentes ici).
  // On les RETIRE totalement — l'IA ne doit ni les comparer ni pénaliser leur
  // absence (la disponibilité reste garantie en amont par la garde de pool).
  if (!c.cross_type_opt_in) {
    if (isMission) {
      if (c.tjm_min != null || c.tjm_max != null) {
        lines.push(`- TJM : ${formatBudget(c.tjm_min, c.tjm_max, 'mission')}`)
      }
      if (c.work_modes.length > 0) lines.push(`- Modes de travail : ${sanitizeList(c.work_modes, 5, 20)}`)
      if (c.mobility) lines.push(`- Mobilité : ${sanitize(c.mobility, 100)}`)
      if (c.availability_status) lines.push(`- Disponibilité : ${sanitize(c.availability_status, 50)}`)
      if (c.availability_date) lines.push(`- Date dispo : ${c.availability_date}`)
    } else {
      if (c.cdi_status) lines.push(`- Statut CDI : ${sanitize(c.cdi_status, 50)}`)
      if (c.cdi_notice_period) lines.push(`- Préavis : ${sanitize(c.cdi_notice_period, 50)}`)
      if (c.cdi_salary_min != null || c.cdi_salary_max != null) {
        lines.push(`- Salaire souhaité : ${formatBudget(c.cdi_salary_min, c.cdi_salary_max, 'offre')}`)
      }
      if (c.cdi_sectors && c.cdi_sectors.length > 0) lines.push(`- Secteurs visés : ${sanitizeList(c.cdi_sectors, 8, 40)}`)
      if (c.cdi_geo_mobility) lines.push(`- Mobilité géographique : ${sanitize(c.cdi_geo_mobility, 100)}`)
      if (c.cdi_contract_types && c.cdi_contract_types.length > 0) {
        lines.push(`- Types de contrat : ${sanitizeList(c.cdi_contract_types, 5, 30)}`)
      }
    }
  }
  if (c.city || c.country) {
    lines.push(`- Localisation : ${sanitize(c.city, 80)}${c.city && c.country ? ', ' : ''}${sanitize(c.country, 80)}`)
  }
  if (c.expert_type) lines.push(`- Type : ${sanitize(c.expert_type, 30)}`)
  return lines.join('\n')
}

function buildPrompt(pub: PublicationForMatching, candidates: ProfileCandidate[]): string {
  const isMission = pub.type === 'mission'
  const candidatesBlock = candidates.map((c, i) => `── Candidat #${i + 1} ──\n${describeCandidate(c, isMission)}`).join('\n\n')
  const langName = languageName(pub.locale)

  return `Tu es le moteur de matching IA de Skilloria, une marketplace B2B qui met en relation des organisations et des experts. Tu reçois UNE annonce ${pub.type === 'mission' ? "de mission freelance" : "d'offre CDI"} et un POOL de candidats déjà filtré par frontière (domaine, type d'expert, profils actifs ayant consenti au traitement IA).

Ton travail : sélectionner les candidats les PLUS PERTINENTS pour cette annonce, les classer et justifier brièvement chaque choix. Tu n'as PAS à scorer tous les candidats ; tu choisis ceux qui valent une notification à l'expert.

═══════════════════════════════════════════════════════════════
ANNONCE
═══════════════════════════════════════════════════════════════
- Type : ${pub.type} (${isMission ? 'mission freelance — TJM journalier' : 'offre CDI — salaire annuel'})
- Titre : ${sanitize(pub.title, 300)}
- Branche : ${sanitize(pub.branch_name, 100) || '(non précisé)'}
- Spécialité : ${sanitize(pub.speciality_name, 100) || sanitize(pub.speciality_other, 100) || '(non précisé)'}
- Compétences requises : ${sanitizeList(pub.skills_required, 50, 80)}
- Séniorité visée : ${sanitize(pub.seniority, 50) || '(non précisé)'}
- Mode de travail : ${sanitize(pub.work_mode, 50) || '(non précisé)'}
- Localisation : ${sanitize(pub.location, 200) || '(non précisé)'}
- Durée : ${sanitize(pub.duration, 100) || '(non précisé)'}
- Budget : ${formatBudget(pub.budget_min, pub.budget_max, pub.type)}
- Description :
${sanitize(pub.description, 5000)}

═══════════════════════════════════════════════════════════════
POOL DE ${candidates.length} CANDIDATS (déjà filtrés frontière)
═══════════════════════════════════════════════════════════════
${candidatesBlock}

═══════════════════════════════════════════════════════════════
TA MISSION
═══════════════════════════════════════════════════════════════
1. Analyse chaque candidat à la lumière de l'annonce.
2. Identifie ceux dont le profil "fit" raisonnablement (compétences proches,
   expérience adaptée, dispo/budget compatibles, mobilité ok…).
3. CLASSE-les par pertinence DÉCROISSANTE.
4. Pour chacun, produis DEUX textes complémentaires :
   • "reason" : justification NEUTRE/FACTUELLE (1–2 phrases) destinée au
     CANDIDAT lui-même ("Vous correspondez bien — vos N ans X…"). Points-clés
     du fit (compétences, expérience, dispo, budget).
   • "pitch_org" : pitch ORIENTÉ CHASSE/RECRUTEUR (1–2 phrases) destiné à
     l'ENTREPRISE qui a publié ("Ce candidat couvre votre besoin X et apporte
     Y", "Profil senior aligné sur vos exigences en Z"). Ton premium mais
     toujours FACTUEL — pas de superlatifs creux, pas de "parfait", pas de
     promesses commerciales. Sert d'accroche dans la fiche candidature côté org.
5. Pour chacun, attribue aussi un score 0–10.
6. NE retourne QUE les candidats que tu juges pertinents (typiquement 3 à 20).
   Pas besoin de retourner tous les candidats — ceux qui n'ont rien à voir
   restent en dehors de ta liste.

⚠ CONTRAINTE PII GRAVÉE : le pool de candidats ci-dessus est strictement
anonymisé (whitelist : pas de nom, e-mail, téléphone, contact). Le texte que
tu produis NE DOIT JAMAIS contenir d'identité supposée, d'invention de nom,
ou de référence à une personne nominale. Reste sur les compétences/parcours.

ÉCHELLE DE SCORE :
- 9–10 : fit excellent (compétences-clés couvertes, séniorité OK, dispo + budget OK).
- 7–8  : bon fit avec un point d'attention (un critère légèrement décalé, mais
         l'essentiel correspond).
- 5–6  : fit moyen — vaut une suggestion mais pas une notification prioritaire.
- 0–4  : pas pertinent (NE PAS inclure dans la liste).

CONTRAINTES STRICTES :
- profile_id DOIT correspondre EXACTEMENT à l'un des profile_id ci-dessus.
  N'invente JAMAIS un profile_id.
- Aucun candidat hors du pool fourni.
- Le ton de la justification est PROFESSIONNEL et FACTUEL, en ${langName.toUpperCase()}
  (langue de l'annonce). Pas de jargon marketing, pas de promesses.
- Évite la redondance — si plusieurs candidats partagent un fit similaire,
  différencie-les en pointant ce qui les distingue.

⚠ RÈGLE ABSOLUE 1 — CANDIDATS MARQUÉS cross_type_opt_in
Le type de contrat a DÉJÀ ÉTÉ VALIDÉ par le candidat lui-même : il a
explicitement demandé à recevoir ce type. Traite ce candidat EXACTEMENT comme
si l'annonce était de son type natif.
- Le score doit être IDENTIQUE à celui que tu donnerais si le candidat était du
  type natif de l'annonce. Le type de contrat vaut ZÉRO point, ni positif ni
  négatif.
- N'écris AUCUNE réserve, nuance, restriction ou « bien que » portant sur : le
  type de contrat, le statut du candidat, ses habitudes de travail, sa
  « démarche », son « contexte habituel », sa préférence supposée pour un mode
  d'engagement.
- Si tu ressens le besoin d'écrire une nuance sur le contrat ou le statut, NE
  L'ÉCRIS PAS : elle est hors-sujet par construction.
Ces règles valent dans "reason" ET dans "pitch_org" (destiné à l'organisation).

⚠ RÈGLE ABSOLUE 2 — RÉMUNÉRATION HORS-SUJET POUR LES CANDIDATS cross_type_opt_in
Pour les candidats marqués cross_type_opt_in, FAIS TOTALEMENT ABSTRACTION de la
rémunération : ni le salaire de l'annonce, ni son TJM, ni la compensation
souhaitée par le candidat n'entrent dans le score, sous aucune forme.
Raison : le candidat n'a jamais renseigné de prétention pour ce format de
contrat (un freelance n'a pas de salaire souhaité, un salarié n'a pas de TJM).
Toute comparaison serait inventée.
- N'évoque PAS la rémunération dans "reason" ni dans "pitch_org" pour ces
  candidats.
- Ne convertis JAMAIS un salaire annuel en TJM ni l'inverse.
- N'écris aucune réserve du type « budget inférieur à », « rémunération à
  confirmer », « écart de compensation ».
(Pour les candidats NON marqués cross_type_opt_in, la rémunération reste un
critère normal, comme aujourd'hui.)

⚠ RÈGLE 3 — PRÉFÉRENCES DE FORMAT ABSENTES POUR LES CANDIDATS cross_type_opt_in
Pour les candidats marqués cross_type_opt_in, tu ne disposes PAS de leurs
préférences de format (compensation souhaitée, mode d'engagement lié au
format) : elles ont été volontairement retirées car elles concernent l'autre
format. Ne formule aucune hypothèse à leur sujet et ne pénalise pas leur
absence.

CE QUE TU DOIS SCORER (pour TOUS les candidats) : adéquation des compétences,
séniorité, secteur/industrie, technologies, localisation géographique,
disponibilité. Un candidat dont les compétences collent à ~90 % doit obtenir
8–9, que le contrat soit natif ou croisé.

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON STRICT, sans markdown, sans texte autour)
═══════════════════════════════════════════════════════════════
{
  "matches": [
    {
      "profile_id": "<UUID exact d'un candidat ci-dessus>",
      "score": <entier 0..10, >= 5>,
      "reason": "<1–2 phrases factuelles ADRESSÉES AU CANDIDAT, en ${langName.toUpperCase()}>",
      "pitch_org": "<1–2 phrases factuelles ADRESSÉES À L'ENTREPRISE, en ${langName.toUpperCase()}>"
    },
    ...
  ]
}

Si AUCUN candidat ne fit (pool vraiment hors-sujet) : retourne { "matches": [] }.

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

function normalizeProposal(item: unknown, candidateIds: Set<string>): AiMatchProposal | null {
  if (!item || typeof item !== 'object') return null
  const m = item as ClaudeMatch
  const profileId = typeof m.profile_id === 'string' ? m.profile_id.trim() : ''
  const rawScore = typeof m.score === 'number' ? m.score : Number(m.score)
  const reason = typeof m.reason === 'string' ? m.reason.trim().slice(0, 800) : ''
  const pitchOrg = typeof m.pitch_org === 'string' ? m.pitch_org.trim().slice(0, 800) : ''
  if (!profileId || !candidateIds.has(profileId)) return null
  if (!Number.isFinite(rawScore)) return null
  const score = Math.max(0, Math.min(10, Math.round(rawScore)))
  if (!reason) return null
  // pitch_org optionnel : si absent (modèle ancien / parse partiel), on accepte
  // la proposition sans bloquer — le dispatcher orgazon utilisera le fallback reason.
  return pitchOrg ? { profile_id: profileId, score, reason, pitch_org: pitchOrg } : { profile_id: profileId, score, reason }
}

export type ProfileMatchingResult =
  | { ok: true; proposals: AiMatchProposal[]; model: string }
  | { ok: false; error: string }

export async function callProfileMatchingAi(args: {
  config: MatchingConfig
  publication: PublicationForMatching
  candidates: ProfileCandidate[]
}): Promise<ProfileMatchingResult> {
  const { config, publication, candidates } = args
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY missing' }
  if (candidates.length === 0) return { ok: true, proposals: [], model: config.model }

  const candidateIds = new Set(candidates.map((c) => c.profile_id))
  const prompt = buildPrompt(publication, candidates)

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
  const proposals: AiMatchProposal[] = []
  const seen = new Set<string>()
  for (const item of rawMatches) {
    const p = normalizeProposal(item, candidateIds)
    if (!p) continue
    if (seen.has(p.profile_id)) continue   // dédupe au cas où l'IA renvoie un doublon
    seen.add(p.profile_id)
    proposals.push(p)
  }
  // Tri sécurité serveur — score décroissant
  proposals.sort((a, b) => b.score - a.score)

  // ALLOWED_FLAGS reservé pour évolution future (déprecate la const inutilisée).
  void ALLOWED_FLAGS

  return { ok: true, proposals, model: config.model }
}
