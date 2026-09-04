import Anthropic from '@anthropic-ai/sdk'

/**
 * Analyseur qualité d'une PUBLICATION (annonce de mission / offre CDI).
 *
 * Flux SÉPARÉ de la vérification ORG (lib/verification/ai-fallback.ts) :
 *   - Pas de Sirene, pas d'INSEE, pas de web_search.
 *   - Évaluation purement textuelle du contenu de l'annonce.
 *   - 4 axes : cohérence/complétude, spam/sabotage, contournement de
 *     plateforme (coordonnées en clair), discrimination/illégalité.
 *
 * provider_name = 'claude_opportunity_quality' — aligné sur le row
 * `verification_providers` seedé par la migration cœur (provider_type
 * 'opportunity_quality_check', threshold 7).
 *
 * Helpers (callClaude / extractFinalText / isModelToolError) DUPLIQUÉS de
 * ai-fallback.ts pour ne pas toucher le flux org (consigne Lot 1a). Si une
 * 3e fonction IA arrive, factoriser dans lib/verification/_anthropic.ts.
 */

const PROVIDER_NAME = 'claude_opportunity_quality'
const PRIMARY_MODEL = 'claude-haiku-4-5-20251001'
const FALLBACK_MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 1500

/**
 * BUDGET DE TEMPS — le TOTAL de la gate reste 30 s, quel que soit le nombre
 * d'essais. C'était déjà le plafond avant l'ajout du repli sur échec
 * transitoire : deux essais de 30 s auraient fait 60 s, or toute la route
 * `/publish` est plafonnée à 60 s (maxDuration) et doit encore y loger le
 * matching. Le repli est donc GRATUIT en temps de mur — il consomme le budget
 * restant du premier essai, il ne l'ajoute pas.
 *
 *   TOTAL_BUDGET_MS      plafond dur de la gate, tous essais confondus.
 *   PER_ATTEMPT_MS       plafond d'UN essai (le reste du budget sert au repli).
 *   MIN_RETRY_BUDGET_MS  en dessous, on ne tente pas le repli : un essai
 *                        étranglé échouerait de toute façon, et on préfère
 *                        rendre la main à l'admin que brûler le budget du
 *                        matching qui suit.
 */
const TOTAL_BUDGET_MS = 30_000
const PER_ATTEMPT_MS = 20_000
const MIN_RETRY_BUDGET_MS = 8_000

export const PUBLICATION_QUALITY_FLAGS = [
  'incoherent',
  'spam',
  'contact_info',
  'discriminatory',
  'illegal',
] as const
export type PublicationQualityFlag = (typeof PUBLICATION_QUALITY_FLAGS)[number]

/**
 * Flags qui BLOQUENT systématiquement la publication automatique, quel
 * que soit le score. Conservé dans le dispatcher (publication-verification.ts)
 * pour rester unique source de vérité métier — exporté ici à titre indicatif.
 */
export const BLOCKING_FLAGS: readonly PublicationQualityFlag[] = [
  'contact_info',
  'discriminatory',
  'illegal',
]

export type PublicationLocale = 'fr' | 'en' | 'es' | 'de'

export type PublicationQualityInput = {
  type: 'mission' | 'offre'
  title: string
  description: string
  skills_required: string[]
  // Multiple depuis le passage aux critères multivalués. Un ensemble vide dit
  // « aucune contrainte de séniorité », pas « personne ».
  seniorities?: string[] | null
  work_mode?: string | null
  // Texte libre d'appoint. Ce n'est PAS un critère de mise en relation — ce
  // sont les zones de travail qui la décident.
  location_note?: string | null
  duration?: string | null
  budget_min?: number | null
  budget_max?: number | null
  locale: PublicationLocale
}

export type PublicationQualityOutput = {
  provider_name: typeof PROVIDER_NAME
  /** 'ok' = parsing OK (le score est exploitable). 'error' = échec IA (admin tranche). */
  result: 'ok' | 'error'
  /** 0..10 entier. Si result='error', score=0 et flags=[]. */
  score: number
  notes: string
  flags: PublicationQualityFlag[]
}

type ClaudeJson = {
  score?: unknown
  notes?: unknown
  flags?: unknown
}

/** Sanitize : cap les chaînes pour limiter la prompt injection. */
function sanitize(value: string | null | undefined, maxLen: number): string {
  return (value ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, maxLen)
}

function sanitizeArray(values: string[] | null | undefined, maxItems: number, maxLen: number): string {
  if (!values || values.length === 0) return '(aucune)'
  return values
    .slice(0, maxItems)
    .map((s) => sanitize(s, maxLen))
    .filter((s) => s.length > 0)
    .join(', ') || '(aucune)'
}

/**
 * Format budget avec unité dérivée du type :
 *   mission (freelance)  → tarif journalier → "€/jour"
 *   offre   (CDI)        → salaire annuel  → "€/an"
 *
 * L'unité est INDISPENSABLE pour que l'IA n'ait pas à deviner et ne
 * descende pas le score pour "budget sans unité". Convention rappelée
 * en plus dans le prompt (cf. ligne "Le budget est exprimé par JOUR
 * pour une mission, par AN pour une offre.").
 */
function formatBudget(
  min: number | null | undefined,
  max: number | null | undefined,
  type: 'mission' | 'offre',
): string {
  if (min == null && max == null) return '(non précisé)'
  const unitSuffix = type === 'mission' ? '€/jour' : '€/an'
  if (min != null && max != null) return `${min} – ${max} ${unitSuffix}`
  if (min != null) return `à partir de ${min} ${unitSuffix}`
  return `jusqu'à ${max as number} ${unitSuffix}`
}

function languageName(locale: PublicationLocale): string {
  switch (locale) {
    case 'fr': return 'français'
    case 'en': return 'anglais'
    case 'es': return 'espagnol'
    case 'de': return 'allemand'
  }
}

function buildPrompt(input: PublicationQualityInput): string {
  const type = sanitize(input.type, 10)
  const title = sanitize(input.title, 300)
  const description = sanitize(input.description, 10_000)
  const skills = sanitizeArray(input.skills_required, 50, 80)
  const seniority = sanitize((input.seniorities ?? []).join(', '), 100) || '(non précisé)'
  const workMode = sanitize(input.work_mode, 50) || '(non précisé)'
  const location = sanitize(input.location_note, 200) || '(non précisé)'
  const duration = sanitize(input.duration, 100) || '(non précisé)'
  const budget = formatBudget(input.budget_min, input.budget_max, input.type)
  const langName = languageName(input.locale)
  const flagsList = PUBLICATION_QUALITY_FLAGS.map((f) => `'${f}'`).join(', ')

  return `Tu es l'analyseur qualité de la marketplace B2B Skilloria, qui publie des annonces de missions freelance ('mission') et de postes CDI ('offre'). Tu reçois une annonce et tu dois en évaluer la CLARTÉ, la LÉGITIMITÉ et la CONFORMITÉ avant publication automatique.

═══════════════════════════════════════════════════════════════
PRINCIPE DIRECTEUR
═══════════════════════════════════════════════════════════════
Skilloria veut faciliter la mise en relation. Une annonce CLAIRE et LÉGITIME
doit passer la gate automatique, MÊME SI plusieurs champs optionnels sont vides.

La COMPLÉTUDE n'est PAS un critère de score. Une annonce avec titre clair,
description compréhensible, branche et compétences cohérentes DOIT scorer ≥ 7,
même si séniorité / mode / localisation / durée / budget sont marqués
'(non précisé)'.

L'incomplétude peut donner lieu à une remarque BIENVEILLANTE dans \`notes\`
("préciser le budget améliorerait le matching"), mais JAMAIS à une baisse de score.

La gate reste STRICTE sur 3 axes uniquement : spam/sabotage, contournement de
plateforme (coordonnées personnelles), et discrimination/illégalité.

═══════════════════════════════════════════════════════════════
CONVENTIONS DE LECTURE
═══════════════════════════════════════════════════════════════
- Champs marqués '(non précisé)' = champs optionnels laissés vides par l'auteur.
  N'INVENTE PAS d'incohérence à leur sujet.
- Le budget est exprimé par JOUR pour une mission (tarif journalier freelance),
  par AN pour une offre (salaire brut annuel CDI). L'unité est intégrée à la
  valeur affichée ; aucune unité manquante.

═══════════════════════════════════════════════════════════════
ANNONCE À ÉVALUER
═══════════════════════════════════════════════════════════════
Langue de l'annonce : ${input.locale} (${langName})
Type : ${type} (mission = freelance, offre = poste CDI)
Titre : ${title}
Description :
${description}

Compétences requises : ${skills}
Séniorité : ${seniority}
Mode de travail : ${workMode}
Localisation : ${location}
Durée : ${duration}
Budget : ${budget}

═══════════════════════════════════════════════════════════════
TA MISSION — ÉVALUER SUR 4 AXES
═══════════════════════════════════════════════════════════════

1. COHÉRENCE & CLARTÉ
   - Le titre annonce-t-il clairement le rôle ou la mission ?
   - La description est-elle compréhensible ?
   - Les compétences requises sont-elles cohérentes avec le titre ?
   → flag 'incoherent' UNIQUEMENT si le texte est réellement incohérent,
     hors-sujet, ou du charabia. JAMAIS pour de l'incomplétude (champ vide
     ou description courte mais compréhensible).

2. SPAM / SABOTAGE
   - Texte de test ("test", "essai", "lorem ipsum", "aaa", contenu absurde) ?
   - Annonce vide de sens, contenu visiblement généré au hasard ?
   - Insultes, contenu agressif ou hors-sujet ?
   → flag 'spam'.

3. ⚠️ CONTOURNEMENT DE PLATEFORME (CRITIQUE)
   L'annonce contient-elle des coordonnées en clair pour bypasser Skilloria ?
   - Email visible (toto@exemple.fr, "contact at gmail dot com", domaines pro perso)
   - Numéro de téléphone (06 12 34 56 78, +33 1..., "appelez le ...")
   - URL externe demandant de postuler ailleurs (linkedin.com/in/...,
     calendly.com/..., formulaires Google, sites de candidature externes)
   - Mentions explicites : "envoyez votre CV à <email>", "contactez-moi sur
     LinkedIn", "passez par mon site"
   → flag 'contact_info'. **BLOQUE LA PUBLICATION AUTOMATIQUE.**
   NB : la mention du site web officiel de l'entreprise dans un contexte
   descriptif normal ("notre site : exemple.fr") n'est PAS un contournement.

4. ⚠️ DISCRIMINATION / ILLÉGALITÉ (CRITIQUE)
   - Critères discriminatoires interdits (âge, sexe, origine, religion, situation
     familiale, orientation sexuelle, état de santé, handicap, apparence,
     opinions politiques/syndicales) ?
   - Exigences manifestement illégales (rémunération sous le SMIC, travail
     dissimulé, "stage gratuit" déguisé en poste, durée de travail abusive,
     contrat fictif) ?
   - Annonce racoleuse sans rapport avec une activité professionnelle déclarée ?
   → flag 'discriminatory' (discrimination) ou 'illegal' (illégalité).
     **BLOQUE LA PUBLICATION AUTOMATIQUE.**

═══════════════════════════════════════════════════════════════
BARÈME DU SCORE (0–10)
═══════════════════════════════════════════════════════════════
Le score reflète CLARTÉ + LÉGITIMITÉ + CONFORMITÉ. La complétude N'EST PAS
un critère.

⚠️ RÈGLE D'OR : une annonce CLAIRE et LÉGITIME, même avec des champs
optionnels vides, doit scorer ≥ 7.

- 9–10 : Annonce claire, légitime, cohérente, lisible. Aucun signal négatif.
- 7–8  : Annonce correcte, intelligible, sans signal négatif. Les éventuels
          champs '(non précisé)' n'impactent PAS le score à ce niveau.
- 4–6  : Description vague ou confuse au point de gêner la compréhension ;
          OU doute sérieux sur la légitimité (l'annonce ressemble à autre
          chose qu'une vraie offre).
- 0–3  : Charabia, spam, hors-sujet, contenu de test ; OU au moins un flag
          BLOQUANT détecté ('contact_info' / 'discriminatory' / 'illegal').

⚠️ RÈGLES STRICTES :
- Si UN flag bloquant est détecté, le score DOIT être ≤ 3, quelle que soit
  la qualité par ailleurs.
- Les champs '(non précisé)' ne JUSTIFIENT JAMAIS un score < 7. Ils peuvent
  inspirer une remarque douce dans \`notes\` ("préciser X améliorerait le
  matching") sans aucune pénalité.

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON STRICT, sans markdown, sans texte autour)
═══════════════════════════════════════════════════════════════
{
  "score": <entier 0..10>,
  "notes": "<2 à 4 phrases EN ${langName.toUpperCase()} : conclusion + raisons principales + flags détectés s'il y en a. Les remarques sur des champs '(non précisé)' sont bienvenues mais doivent rester des SUGGESTIONS, jamais des reproches.>",
  "flags": [<sous-ensemble de ${flagsList} ; tableau vide [] si aucun flag>]
}

Réponds STRICTEMENT en JSON, sans aucun texte avant ou après.`
}

async function callClaude(args: {
  apiKey: string
  model: string
  prompt: string
  timeoutMs: number
}): Promise<Anthropic.Messages.Message> {
  const { apiKey, model, prompt, timeoutMs } = args
  const client = new Anthropic({ apiKey, timeout: timeoutMs })
  return await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  })
}

/** Code HTTP porté par l'erreur, `null` si l'appel n'a jamais atteint l'API. */
function httpStatusOf(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('status' in err)) return null
  const status = (err as { status: unknown }).status
  return typeof status === 'number' && Number.isFinite(status) ? status : null
}

/**
 * L'échec mérite-t-il un SECOND essai sur le modèle de repli ?
 *
 * TRANSITOIRE → oui. Le premier essai est tombé sur une circonstance, pas sur
 * un défaut de la requête : modèle inconnu ou retiré (404 — c'est le cas
 * historique qui a justifié le repli), délai dépassé, coupure réseau,
 * surcharge (429), panne côté fournisseur (5xx).
 *
 * DÉFINITIF → non. Réessayer ne ferait que coûter : clé absente ou invalide
 * (401), droits insuffisants (403), requête malformée (400), charge utile trop
 * grande (413). Le second appel échouerait à l'identique.
 *
 * INCONNU → non, volontairement. Ne pas réessayer envoie l'annonce en revue
 * admin : c'est le sens SÛR (aucune publication automatique sur un verdict
 * qu'on n'a pas), et cela évite de brûler le budget de temps du matching qui
 * s'exécute juste après dans la même requête.
 *
 * Le code HTTP est lu PAR FORME (`err.status`) plutôt que via `instanceof
 * Anthropic.APIError` : c'est la même information, sans coupler la décision à
 * la hiérarchie de classes du SDK, et cela reste éprouvable à l'exécution sans
 * réseau ni clé API. Les pannes de transport, elles, n'exposent rien
 * d'exploitable par la forme et exigent le `instanceof` (cf. plus bas).
 *
 * Exporté pour être ÉPROUVÉ à l'exécution (scripts/diag-publication-gate.mjs).
 */
export function isRetryableFailure(err: unknown): boolean {
  const status = httpStatusOf(err)
  if (status !== null) {
    if (status >= 500) return true            // panne fournisseur
    if (status === 429) return true           // surcharge / quota de débit
    if (status === 408) return true           // délai dépassé côté API
    if (status === 404) return true           // modèle inconnu → l'autre existe peut-être
    return false                              // 400 / 401 / 403 / 413 / tout autre 4xx
  }

  // Aucun code HTTP : l'appel n'a pas abouti (réseau, délai local, abandon).
  //
  // Le SDK enveloppe TOUTE panne de transport dans APIConnectionError (et sa
  // sous-classe …TimeoutError) — un test signalé par le diagnostic : ces
  // erreurs ne portent PAS de `name` distinctif (il reste 'Error') et leur
  // message est un laconique « Connection error. ». Le `instanceof` est donc le
  // seul signal fiable ; le reste ci-dessous couvre ce qui serait levé hors du
  // SDK ou par une version future.
  if (err instanceof Anthropic.APIConnectionError) return true

  const name = err instanceof Error ? err.name : ''
  if (name.startsWith('APIConnection')) return true
  if (name === 'AbortError' || name === 'TimeoutError') return true

  const msg = err instanceof Error ? err.message : String(err)
  return /timeout|timed out|aborted|connection error|econnreset|econnrefused|enotfound|etimedout|eai_again|socket hang up|network|fetch failed/i.test(
    msg,
  )
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

/**
 * Lecture STRICTE du score. `null` = l'IA n'a rien jugé : champ absent, vide,
 * non numérique, NaN ou Infini. L'appelant en fait un ÉCHEC — jamais une valeur
 * de repli.
 *
 * POURQUOI : ce champ décide seul, avec les flags, si une annonce est publiée
 * automatiquement. Un repli à 5 (comportement historique) n'était le jugement
 * de personne ; selon le seuil configuré en base il pouvait PUBLIER une annonce
 * que rien n'avait évaluée. Une valeur de repli qui ressemble à un verdict est
 * un mensonge — l'absence de verdict doit ressortir comme telle.
 *
 * On accepte une chaîne numérique ("8") : c'est bien un score, juste mal typé
 * par le modèle, et le reste du projet coerce déjà de la même façon
 * (cf. lib/matching/ai-profile-matching.ts). On refuse en revanche `null`,
 * `true`, `[]` ou `""`, que `Number()` convertirait silencieusement en 0 ou 1 —
 * un 0 fabriqué serait, lui aussi, un verdict que personne n'a rendu.
 *
 * Exporté pour être ÉPROUVÉ à l'exécution (scripts/diag-publication-gate.mjs).
 */
export function readPublicationScore(value: unknown): number | null {
  let raw: number
  if (typeof value === 'number') raw = value
  else if (typeof value === 'string' && value.trim().length > 0) raw = Number(value)
  else return null
  if (!Number.isFinite(raw)) return null
  return Math.max(0, Math.min(10, Math.round(raw)))
}

/**
 * Lecture STRICTE des signalements. `null` = la clé `flags` est absente ou
 * n'est pas un tableau : les axes bloquants n'ont PAS été évalués. L'appelant
 * en fait un ÉCHEC.
 *
 * POURQUOI : un `[]` de repli affirme « aucun contournement de plateforme,
 * aucune discrimination, aucune illégalité ». C'est le verdict le plus lourd du
 * fichier, et il va dans le sens qui PUBLIE — exactement le même défaut que le
 * score par défaut, en plus grave. Un `[]` explicitement renvoyé par l'IA reste
 * un verdict valide et passe normalement.
 *
 * Les libellés inconnus sont ignorés en silence : ils ne peuvent pas être
 * bloquants (BLOCKING_FLAGS est une liste fermée), et un modèle qui invente
 * 'suspicious' ne doit pas faire échouer une réponse par ailleurs exploitable.
 *
 * Exporté pour être ÉPROUVÉ à l'exécution (scripts/diag-publication-gate.mjs).
 */
export function readPublicationFlags(value: unknown): PublicationQualityFlag[] | null {
  if (!Array.isArray(value)) return null
  const seen = new Set<PublicationQualityFlag>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    if ((PUBLICATION_QUALITY_FLAGS as readonly string[]).includes(item)) {
      seen.add(item as PublicationQualityFlag)
    }
  }
  return Array.from(seen)
}

/**
 * UNIQUE forme d'échec du fichier. Clé absente, appel raté, réponse illisible,
 * score manquant, flags manquants : tous empruntent ce chemin et aboutissent au
 * même endroit — `result='error'`, score 0, aucun flag, et donc
 * 'pending_review' côté dispatcher (cf. publication-verification.ts). Il n'y a
 * pas de demi-verdict : soit l'IA a jugé, soit l'admin tranche.
 */
function failure(notes: string): PublicationQualityOutput {
  return {
    provider_name: PROVIDER_NAME,
    result: 'error',
    score: 0,
    notes,
    flags: [],
  }
}

export async function verifyAiPublicationQuality(
  input: PublicationQualityInput,
): Promise<PublicationQualityOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[verification:publication-quality] ANTHROPIC_API_KEY missing')
    return failure('Clé API IA non configurée — admin tranche manuellement.')
  }

  const prompt = buildPrompt(input)

  // ── Essai principal, puis repli sur ÉCHEC TRANSITOIRE uniquement ─────────
  //  Budget de temps partagé : les deux essais tiennent dans TOTAL_BUDGET_MS
  //  (cf. constantes en tête). Le repli ne rallonge donc jamais la requête de
  //  publication, il se contente d'occuper ce qui reste.
  const deadline = Date.now() + TOTAL_BUDGET_MS
  const remainingMs = () => deadline - Date.now()
  const attemptTimeoutMs = () => Math.min(PER_ATTEMPT_MS, Math.max(0, remainingMs()))

  let response: Anthropic.Messages.Message
  try {
    response = await callClaude({ apiKey, model: PRIMARY_MODEL, prompt, timeoutMs: attemptTimeoutMs() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const retryable = isRetryableFailure(err)
    console.warn('[verification:publication-quality] Haiku failed', { msg, retryable })

    if (!retryable) {
      // Clé invalide, droits, requête malformée : le repli échouerait pareil.
      return failure('Échec définitif de l’appel IA (non rejouable) — admin tranche manuellement.')
    }
    if (remainingMs() < MIN_RETRY_BUDGET_MS) {
      console.warn('[verification:publication-quality] retry skipped — budget exhausted', {
        remaining_ms: remainingMs(),
      })
      return failure('Échec de l’appel IA, budget de temps épuisé — admin tranche manuellement.')
    }

    try {
      response = await callClaude({ apiKey, model: FALLBACK_MODEL, prompt, timeoutMs: attemptTimeoutMs() })
    } catch (err2) {
      const msg2 = err2 instanceof Error ? err2.message : String(err2)
      console.error('[verification:publication-quality] Sonnet also failed', { msg2 })
      return failure('Échec des appels IA (Haiku + Sonnet) — admin tranche manuellement.')
    }
  }

  // ── Parsing JSON strict ──────────────────────────────────────────────────
  const rawText = extractFinalText(response)
  let parsed: ClaudeJson | null = null
  const match = rawText.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      parsed = JSON.parse(match[0]) as ClaudeJson
    } catch {
      parsed = null
    }
  }

  if (!parsed) {
    console.warn('[verification:publication-quality] could not parse JSON from Claude', {
      preview: rawText.slice(0, 200),
    })
    return failure('Réponse IA non parsable — admin tranche manuellement.')
  }

  // ── Verdict : les DEUX champs décisionnels doivent avoir été rendus ──────
  //  Un JSON lisible ne suffit pas. `score` et `flags` pilotent seuls la
  //  publication automatique : s'ils manquent, personne n'a jugé, et aucune
  //  valeur de repli ne doit prendre la place d'un verdict absent.
  const score = readPublicationScore(parsed.score)
  if (score === null) {
    console.warn('[verification:publication-quality] score absent ou non numérique', {
      raw_score: parsed.score,
    })
    return failure('Score absent ou non numérique dans la réponse IA — annonce non évaluée, admin tranche manuellement.')
  }

  const flags = readPublicationFlags(parsed.flags)
  if (flags === null) {
    console.warn('[verification:publication-quality] flags absents de la réponse', {
      raw_flags: parsed.flags,
    })
    return failure('Signalements absents de la réponse IA — axes bloquants non évalués, admin tranche manuellement.')
  }

  // `notes` est purement informatif (admin) et n'entre dans aucune décision :
  // son absence se CONSTATE, elle ne se remplace pas par un commentaire qui
  // laisserait croire à une analyse.
  const notes = (typeof parsed.notes === 'string' && parsed.notes.trim().length > 0
    ? parsed.notes
    : 'Aucune note renvoyée par l’IA.'
  ).slice(0, 1500)

  return {
    provider_name: PROVIDER_NAME,
    result: 'ok',
    score,
    notes,
    flags,
  }
}
