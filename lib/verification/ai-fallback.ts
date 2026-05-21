import Anthropic from '@anthropic-ai/sdk'
import type { SireneData, VerificationInput, VerificationOutput } from './types'

/**
 * Analyseur de cohérence IA — DÉCIDEUR SYSTÉMATIQUE (11G).
 *
 * Anciennement "fallback IA" : appelé uniquement si Sirene échouait.
 * Désormais : tourne TOUJOURS, peu importe le résultat Sirene. Si Sirene
 * a réussi, l'IA reçoit `sireneData` (snapshot INSEE) et compare chaque
 * champ saisi avec son équivalent INSEE. Si Sirene a échoué, l'IA évalue
 * la cohérence interne des données saisies (nom ↔ domaine email ↔ site web,
 * format SIREN/TVA, signaux suspects).
 *
 * Sortie : { score 0..10, notes textuel, discrepancies[] }
 *   - score reflète la COHÉRENCE GLOBALE (pas la "légitimité" abstraite)
 *   - discrepancies[] liste les écarts précis détectés (champ par champ)
 *
 * Décision finale : prise par le dispatcher (index.ts) qui compare le score
 * au threshold du row provider_type='ai_web_search' (config BDD).
 *
 * provider_name = 'ai_coherence_check' (migration 11G renomme le row
 * `claude_web_fallback` → `ai_coherence_check` en BDD). Le code ne dépend
 * pas du nom — c'est juste un label de log dans verification_attempts.
 */

const PROVIDER_NAME = 'ai_coherence_check'
const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 1200
const REQUEST_TIMEOUT_MS = 25_000

type ClaudeJson = {
  score?: number
  notes?: string
  discrepancies?: string[]
}

/** Sanitize : cap chaque champ pour limiter la prompt injection. */
function sanitize(value: string | null | undefined, maxLen: number): string {
  return (value ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, maxLen)
}

function formatSireneBlock(s: SireneData | null): string {
  if (!s) {
    return 'Données INSEE : NON DISPONIBLES (Sirene n’a pas trouvé le SIREN ou n’a pas pu être interrogé). L’analyse repose UNIQUEMENT sur les données saisies.'
  }
  const lines: string[] = ['Données INSEE récupérées :']
  if (s.denomination) lines.push(`- Raison sociale officielle (denomination) : ${sanitize(s.denomination, 300)}`)
  if (s.sigle) lines.push(`- Sigle : ${sanitize(s.sigle, 100)}`)
  if (s.prenom_nom) lines.push(`- Personne physique : ${sanitize(s.prenom_nom, 200)}`)
  if (s.etat_administratif) {
    const label =
      s.etat_administratif === 'A'
        ? 'Active'
        : s.etat_administratif === 'C'
          ? 'CESSÉE (signal négatif fort)'
          : `code ${s.etat_administratif}`
    lines.push(`- État administratif : ${label}`)
  }
  if (s.categorie_juridique) lines.push(`- Catégorie juridique (code INSEE) : ${sanitize(s.categorie_juridique, 50)}`)
  if (s.activite_principale) lines.push(`- Code APE / NAF : ${sanitize(s.activite_principale, 50)}`)
  if (s.date_creation) lines.push(`- Date de création : ${sanitize(s.date_creation, 50)}`)
  if (s.tranche_effectifs) lines.push(`- Tranche d’effectifs (code) : ${sanitize(s.tranche_effectifs, 10)}`)
  if (s.adresse_complete) lines.push(`- Adresse de l’établissement : ${sanitize(s.adresse_complete, 300)}`)
  return lines.join('\n')
}

function buildPrompt(input: VerificationInput, sireneData: SireneData | null): string {
  const company = sanitize(input.company_name, 200)
  const country = sanitize(input.country_code, 2)
  const emailDomain = sanitize(input.email_domain, 200)
  const siren = sanitize(input.siren, 50)
  const vat = sanitize(input.vat_number, 50)
  const website = sanitize(input.website_url, 500)
  const orgType = sanitize(input.org_type, 50)

  return `Tu es l’analyseur de cohérence d’une marketplace B2B. Tu dois ÉVALUER si l’entreprise candidate à l’inscription est COHÉRENTE — c’est-à-dire si les données qu’elle a saisies correspondent bien à une vraie entreprise, ET si elles correspondent aux données officielles INSEE (Sirene) quand celles-ci sont disponibles.

Tu n’as PAS accès à internet. Base-toi UNIQUEMENT sur les informations ci-dessous.

═══════════════════════════════════════════════════════════════
DONNÉES SAISIES PAR L’UTILISATEUR (à comparer) :
═══════════════════════════════════════════════════════════════
- Nom d’entreprise déclaré : ${company || '(non fourni)'}
- Pays : ${country || '(non fourni)'}
- Domaine email professionnel : ${emailDomain || '(non fourni)'}
- SIREN / SIRET : ${siren || '(non fourni)'}
- Numéro de TVA : ${vat || '(non fourni)'}
- Site web : ${website || '(non fourni)'}
- Type d’organisation déclaré : ${orgType || '(non fourni)'}

═══════════════════════════════════════════════════════════════
DONNÉES OFFICIELLES INSEE (référence) :
═══════════════════════════════════════════════════════════════
${formatSireneBlock(sireneData)}

═══════════════════════════════════════════════════════════════
TA MISSION
═══════════════════════════════════════════════════════════════
Évalue la COHÉRENCE GLOBALE et liste les ÉCARTS précis.

1. SI des données INSEE sont disponibles :
   - Compare le NOM saisi à la raison sociale officielle (ou prénom/nom pour personne physique).
     Tolère : sigles, suffixes juridiques (SAS, SARL...), variations de casse / espaces.
     N’accepte PAS : un nom totalement différent (ex : "SAS" générique vs raison sociale "Acme Foo SAS" → ÉCART MAJEUR).
   - Compare le TYPE d’organisation déclaré ('client' = client final / 'cabinet' = cabinet de recrutement / 'esn' = ESN) à la catégorie juridique INSEE et au code APE. Cohérence raisonnable attendue.
   - Vérifie que l’ÉTAT administratif INSEE n’est pas "CESSÉE" — sinon, écart majeur.
   - Vérifie que le domaine email pro a une plausibilité avec la raison sociale INSEE (ex : "acmefoo.com" pour "Acme Foo" est OK).
   - Vérifie que le site web (s’il est fourni) est cohérent avec la raison sociale.

2. SI les données INSEE ne sont PAS disponibles :
   - Évalue uniquement la cohérence interne des données saisies.
   - Le score doit refléter cette incertitude (ne JAMAIS donner ≥ 9 sans données INSEE — par règle métier la validation auto exige les données officielles).

3. Détecte les signaux suspects : nom générique ("test", "société", "SAS" seul, "company"), domaine email jetable, format SIREN/TVA invalide, etc.

═══════════════════════════════════════════════════════════════
BARÈME DU SCORE (0-10)
═══════════════════════════════════════════════════════════════
- 9 ou 10 : Cohérence parfaite. Données INSEE disponibles, tous les champs correspondent (nom, type, état, etc.). Aucun signal suspect. → Auto-approbation possible.
- 6 à 8  : Cohérent globalement mais quelques écarts mineurs (ex : sigle vs raison sociale longue) OU données INSEE indisponibles avec saisie plausible. → Review admin.
- 3 à 5  : Plusieurs écarts détectés, ou nom ne correspond pas à INSEE, ou état CESSÉE, ou données suspectes. → Review admin nécessaire.
- 0 à 2  : Données manifestement incohérentes. → Review admin urgente.

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON STRICT, sans markdown, sans texte autour)
═══════════════════════════════════════════════════════════════
{
  "score": <entier 0..10>,
  "notes": "<2 à 4 phrases en français : conclusion globale + raison principale du score>",
  "discrepancies": [
    "<écart 1 : champ + valeur saisie + valeur attendue/INSEE>",
    "<écart 2 : ...>"
  ]
}

Si AUCUN écart détecté, "discrepancies" doit être un tableau vide [].
Si tu n’as pas assez d’information pour trancher, score=5, notes="Données insuffisantes pour valider automatiquement", discrepancies=[].`
}

export async function verifyAiCoherence(
  input: VerificationInput,
  sireneData: SireneData | null,
): Promise<VerificationOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[verification:ai-coherence] ANTHROPIC_API_KEY missing')
    return {
      provider_name: PROVIDER_NAME,
      result: 'error',
      confidence_score: 0,
      raw_response: { error: 'ANTHROPIC_API_KEY missing' },
      notes: 'Clé API IA non configurée',
      discrepancies: [],
    }
  }

  const prompt = buildPrompt(input, sireneData)

  let response: Anthropic.Messages.Message
  try {
    const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS })
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (err) {
    console.error('[verification:ai-coherence] Claude call threw', {
      err: err instanceof Error ? err.message : String(err),
    })
    return {
      provider_name: PROVIDER_NAME,
      result: 'error',
      confidence_score: 0,
      raw_response: { error: err instanceof Error ? err.message : String(err) },
      notes: 'Erreur appel Claude',
      discrepancies: [],
    }
  }

  const textBlock = response.content.find((b) => b.type === 'text')
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
    console.warn('[verification:ai-coherence] could not parse JSON from Claude', {
      preview: rawText.slice(0, 200),
    })
    return {
      provider_name: PROVIDER_NAME,
      result: 'inconclusive',
      confidence_score: 5,
      raw_response: { raw_text: rawText.slice(0, 1000) },
      notes: 'Réponse IA non parsable, fallback admin review',
      discrepancies: [],
    }
  }

  const rawScore = typeof parsed.score === 'number' ? parsed.score : 5
  const score = Math.max(0, Math.min(10, Math.round(rawScore)))
  const notes = (parsed.notes ?? 'Analyse IA sans détails').slice(0, 1000)
  const discrepancies = Array.isArray(parsed.discrepancies)
    ? parsed.discrepancies
        .filter((d): d is string => typeof d === 'string')
        .map((d) => d.slice(0, 500))
        .slice(0, 20)
    : []

  // 11G : on remonte toujours 'inconclusive' côté output — la décision
  // finale (approved vs pending_admin_review) est prise par le dispatcher
  // en comparant le score au threshold du row ai_web_search (config BDD).
  return {
    provider_name: PROVIDER_NAME,
    result: 'inconclusive',
    confidence_score: score,
    raw_response: { parsed, raw_text_preview: rawText.slice(0, 500) },
    notes,
    discrepancies,
  }
}

/**
 * Alias historique (compatibilité avec le registry pre-11G).
 * @deprecated Utiliser `verifyAiCoherence` directement.
 */
export const verifyWithAiFallback = verifyAiCoherence
