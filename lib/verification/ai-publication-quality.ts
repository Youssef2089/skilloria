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
const REQUEST_TIMEOUT_MS = 30_000

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
  seniority?: string | null
  work_mode?: string | null
  location?: string | null
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
  score?: number
  notes?: string
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
  const seniority = sanitize(input.seniority, 50) || '(non précisé)'
  const workMode = sanitize(input.work_mode, 50) || '(non précisé)'
  const location = sanitize(input.location, 200) || '(non précisé)'
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
}): Promise<Anthropic.Messages.Message> {
  const { apiKey, model, prompt } = args
  const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS })
  return await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  })
}

function isModelError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  // Heuristique : erreur évoquant le modèle indisponible / non supporté →
  // on tente le fallback Sonnet.
  return /model|unavailable|not_found|invalid_request/i.test(msg)
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

function normalizeFlags(value: unknown): PublicationQualityFlag[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<PublicationQualityFlag>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    if ((PUBLICATION_QUALITY_FLAGS as readonly string[]).includes(item)) {
      seen.add(item as PublicationQualityFlag)
    }
  }
  return Array.from(seen)
}

export async function verifyAiPublicationQuality(
  input: PublicationQualityInput,
): Promise<PublicationQualityOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[verification:publication-quality] ANTHROPIC_API_KEY missing')
    return {
      provider_name: PROVIDER_NAME,
      result: 'error',
      score: 0,
      notes: 'Clé API IA non configurée — admin tranche manuellement.',
      flags: [],
    }
  }

  const prompt = buildPrompt(input)

  // ── Retry Haiku 4.5 → Sonnet 4.6 ─────────────────────────────────────────
  let response: Anthropic.Messages.Message | null = null
  try {
    response = await callClaude({ apiKey, model: PRIMARY_MODEL, prompt })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[verification:publication-quality] Haiku failed', { msg })
    if (isModelError(err)) {
      try {
        response = await callClaude({ apiKey, model: FALLBACK_MODEL, prompt })
      } catch (err2) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2)
        console.error('[verification:publication-quality] Sonnet also failed', { msg2 })
        return {
          provider_name: PROVIDER_NAME,
          result: 'error',
          score: 0,
          notes: 'Échec des appels IA (Haiku + Sonnet) — admin tranche manuellement.',
          flags: [],
        }
      }
    } else {
      return {
        provider_name: PROVIDER_NAME,
        result: 'error',
        score: 0,
        notes: 'Échec de l’appel IA — admin tranche manuellement.',
        flags: [],
      }
    }
  }

  // ── Parsing JSON strict ──────────────────────────────────────────────────
  const rawText = extractFinalText(response!)
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
    return {
      provider_name: PROVIDER_NAME,
      result: 'error',
      score: 0,
      notes: 'Réponse IA non parsable — admin tranche manuellement.',
      flags: [],
    }
  }

  const rawScore = typeof parsed.score === 'number' ? parsed.score : 5
  const score = Math.max(0, Math.min(10, Math.round(rawScore)))
  const notes = (typeof parsed.notes === 'string' ? parsed.notes : 'Analyse IA sans détails.').slice(0, 1500)
  const flags = normalizeFlags(parsed.flags)

  return {
    provider_name: PROVIDER_NAME,
    result: 'ok',
    score,
    notes,
    flags,
  }
}
