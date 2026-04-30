import Anthropic from '@anthropic-ai/sdk'
import type { VerificationInput, VerificationOutput } from './types'

/**
 * Fallback IA Claude — analyse "best effort" sans recherche web native.
 *
 * Le SDK Anthropic V1 n'expose pas encore le tool `web_search` côté API.
 * On envoie au modèle les inputs structurés et on lui demande de noter
 * la légitimité de l'entreprise sur 0..10 + raison.
 *
 * Si Claude n'a pas assez d'info → score 5 (Q-B2.b.2) → tombe en
 * `pending_admin_review` côté dispatcher (puisque threshold=9 par défaut).
 *
 * [TODO B5+] basculer sur tool use `web_search` quand l'API le supportera,
 * pour réduire les pending_admin_review faux positifs.
 */

const PROVIDER_NAME = 'claude_web_fallback'
const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 600
const REQUEST_TIMEOUT_MS = 20_000

type ClaudeJson = {
  score?: number
  legitimacy?: 'legitimate' | 'unknown' | 'suspicious'
  notes?: string
  reason?: string
}

/** Sanitize : cap chaque champ pour éviter prompt injection à grande échelle. */
function sanitizeInput(value: string | null | undefined, maxLen: number): string {
  return (value ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, maxLen)
}

export async function verifyWithAiFallback(
  input: VerificationInput,
): Promise<VerificationOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[verification:ai-fallback] ANTHROPIC_API_KEY missing')
    return {
      provider_name: PROVIDER_NAME,
      result: 'error',
      confidence_score: 0,
      raw_response: { error: 'ANTHROPIC_API_KEY missing' },
      notes: 'Clé API IA non configurée',
    }
  }

  const company = sanitizeInput(input.company_name, 200)
  const country = sanitizeInput(input.country_code, 2)
  const emailDomain = sanitizeInput(input.email_domain, 200)
  const siren = sanitizeInput(input.siren, 50)
  const vat = sanitizeInput(input.vat_number, 50)

  const prompt = `Tu analyses la légitimité d'une entreprise candidate à l'inscription sur une marketplace B2B.

Entreprise déclarée :
- Nom : ${company || '(non fourni)'}
- Pays : ${country || '(non fourni)'}
- Domaine email pro : ${emailDomain || '(non fourni)'}
- SIREN/SIRET : ${siren || '(non fourni)'}
- Numéro TVA : ${vat || '(non fourni)'}

Tu n'as PAS accès à internet. Sur la base UNIQUEMENT des informations ci-dessus, évalue la cohérence et la plausibilité de cette entreprise.

Critères :
- Le nom semble-t-il correspondre à une entreprise réelle plutôt qu'à un test ?
- Le domaine email correspond-il au nom de l'entreprise (ex. acme-corp.com pour ACME Corp) ?
- Les identifiants (SIREN/TVA) ont-ils un format valide pour le pays ?
- Détectes-tu des signaux suspects (domaine email jetable, nom générique, etc.) ?

Réponds STRICTEMENT en JSON valide, sans markdown ni texte autour :
{"score": <0..10>, "legitimacy": "legitimate"|"unknown"|"suspicious", "notes": "<1-2 phrases courtes>"}

Si tu n'es pas sûr, score=5 et legitimacy="unknown".`

  let response: Anthropic.Messages.Message
  try {
    const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS })
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (err) {
    console.error('[verification:ai-fallback] Claude call threw', {
      err: err instanceof Error ? err.message : String(err),
    })
    return {
      provider_name: PROVIDER_NAME,
      result: 'error',
      confidence_score: 0,
      raw_response: { error: err instanceof Error ? err.message : String(err) },
      notes: 'Erreur appel Claude',
    }
  }

  const textBlock = response.content.find(b => b.type === 'text')
  const rawText = textBlock && 'text' in textBlock ? textBlock.text : ''

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
    console.warn('[verification:ai-fallback] could not parse JSON from Claude', {
      preview: rawText.slice(0, 200),
    })
    return {
      provider_name: PROVIDER_NAME,
      result: 'inconclusive',
      confidence_score: 5,
      raw_response: { raw_text: rawText.slice(0, 1000) },
      notes: 'Réponse IA non parsable, fallback admin review',
    }
  }

  const rawScore = typeof parsed.score === 'number' ? parsed.score : 5
  const score = Math.max(0, Math.min(10, Math.round(rawScore)))

  const legitimacy = parsed.legitimacy ?? 'unknown'
  const notes = parsed.notes ?? parsed.reason ?? 'Analyse IA sans détails'

  let result: VerificationOutput['result']
  if (legitimacy === 'suspicious' && score <= 3) {
    result = 'rejected'
  } else if (legitimacy === 'legitimate' && score >= 9) {
    // Le seuil exact d'auto-approve est appliqué côté dispatcher
    result = 'approved'
  } else {
    result = 'inconclusive'
  }

  return {
    provider_name: PROVIDER_NAME,
    result,
    confidence_score: score,
    raw_response: { parsed, raw_text_preview: rawText.slice(0, 500) },
    notes,
  }
}
