import Anthropic from '@anthropic-ai/sdk'
import type { SireneData, VerificationInput, VerificationOutput } from './types'

/**
 * Analyseur de cohérence IA — DÉCIDEUR SYSTÉMATIQUE AVEC RECHERCHE WEB (11G.2).
 *
 * 11G a rendu l'analyse systématique. 11G.2 l'enrichit :
 *   - Recherche web active via le tool natif Anthropic `web_search_20250305`
 *     (server-side, Anthropic exécute la recherche et fournit les résultats
 *     directement à Claude). Sources citées dans la réponse.
 *   - Retrait du plafond "ne JAMAIS donner ≥ 9 sans données INSEE" : le
 *     score reflète la confiance réelle (cohérence + vérifiabilité), sans
 *     plafond a priori. Une org étrangère cohérente et vérifiable peut
 *     être auto-approuvée.
 *   - Hiérarchie des sources imposée (D ajustement) :
 *       1. Registres officiels (annuaire-entreprises.data.gouv.fr,
 *          infogreffe.fr, etc.) → source de vérité prioritaire
 *       2. Site officiel de l'entreprise → confirmation déclarative
 *       3. Presse pro / LinkedIn entreprise → recoupement secondaire
 *     Règle : en cas de contradiction, le registre officiel l'emporte.
 *     Un score élevé doit s'appuyer sur une source officielle.
 *
 * Modèle : Claude Haiku 4.5 (D3, suffisant pour ce cas qualification).
 * Fallback automatique sur Sonnet 4.6 si Haiku + tool incompatible.
 *
 * Gestion d'échec :
 *   - Activation Console manquante OU rate-limit → retry sans tools
 *   - Timeout SDK → result='error', l'admin tranche en review
 *   - JSON non parsable → score=5 (review admin)
 *
 * Décision finale prise par le dispatcher (index.ts) : score vs threshold
 * lu en BDD via provider_type='ai_web_search' (= 7 depuis 11G.2).
 *
 * provider_name = 'ai_coherence_check' (migration 11G).
 */

const PROVIDER_NAME = 'ai_coherence_check'
const PRIMARY_MODEL = 'claude-haiku-4-5-20251001'
const FALLBACK_MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 2000
const REQUEST_TIMEOUT_MS = 45_000
const WEB_SEARCH_MAX_USES = 5

type ClaudeJson = {
  score?: number
  notes?: string
  discrepancies?: string[]
}

/** Sanitize : cap chaque champ pour limiter la prompt injection. */
function sanitize(value: string | null | undefined, maxLen: number): string {
  return (value ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, maxLen)
}

type SireneStatusForPrompt = 'ok' | 'not_found' | 'error' | 'skipped' | null

function formatSireneBlock(
  s: SireneData | null,
  status: SireneStatusForPrompt,
): string {
  if (!s) {
    if (status === 'error') {
      return 'Données INSEE : INDISPONIBLES PAR DÉFAILLANCE TECHNIQUE (timeout ou erreur réseau côté INSEE après retry). La confirmation officielle du nom et du statut n\'a PAS pu être obtenue cette fois. ⚠️ Voir D4 dans la section "ÉCARTS DISQUALIFIANTS" ci-dessous.'
    }
    if (status === 'not_found') {
      return 'Données INSEE : SIREN non trouvé via l\'endpoint INSEE consulté (possible cas légitime, possible cas edge de l\'endpoint). Utilise la recherche web pour creuser via un autre registre.'
    }
    if (status === 'skipped') {
      return 'Données INSEE : NON APPLICABLES (pays ≠ FR ou SIREN absent). Recherche le registre équivalent du pays via web_search (Companies House UK, Handelsregister DE, Registro Mercantil ES, etc.).'
    }
    return 'Données INSEE : NON DISPONIBLES. Utilise la recherche web pour combler.'
  }
  const lines: string[] = ['Données INSEE récupérées (source officielle FR) :']
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

function buildPrompt(
  input: VerificationInput,
  sireneData: SireneData | null,
  sireneStatus: SireneStatusForPrompt,
): string {
  const company = sanitize(input.company_name, 200)
  const country = sanitize(input.country_code, 2)
  const emailDomain = sanitize(input.email_domain, 200)
  const siren = sanitize(input.siren, 50)
  const vat = sanitize(input.vat_number, 50)
  const website = sanitize(input.website_url, 500)
  const orgType = sanitize(input.org_type, 50)

  return `Tu es l’analyseur de cohérence d’une marketplace B2B. Tu dois ÉVALUER si l’entreprise candidate est réelle, active, et si les données qu’elle a saisies correspondent bien aux données officielles.

Tu DISPOSES de l’outil \`web_search\` : utilise-le activement pour vérifier l’existence et croiser les informations. Ne te contente jamais du déclaratif.

═══════════════════════════════════════════════════════════════
DONNÉES SAISIES PAR L’UTILISATEUR (à vérifier)
═══════════════════════════════════════════════════════════════
- Nom d’entreprise déclaré : ${company || '(non fourni)'}
- Pays : ${country || '(non fourni)'}
- Domaine email professionnel : ${emailDomain || '(non fourni)'}
- SIREN / SIRET : ${siren || '(non fourni)'}
- Numéro de TVA : ${vat || '(non fourni)'}
- Site web : ${website || '(non fourni)'}
- Type d’organisation déclaré : ${orgType || '(non fourni)'} (client = client final / cabinet = cabinet de recrutement / esn = ESN)

═══════════════════════════════════════════════════════════════
DONNÉES OFFICIELLES INSEE (référence, FR uniquement)
═══════════════════════════════════════════════════════════════
${formatSireneBlock(sireneData, sireneStatus)}

═══════════════════════════════════════════════════════════════
HIÉRARCHIE DES SOURCES (IMPÉRATIVE)
═══════════════════════════════════════════════════════════════
1. **Registres officiels** (annuaire-entreprises.data.gouv.fr, infogreffe.fr,
   societe.com, registres équivalents par pays : Companies House UK,
   Handelsregister DE, Registro Mercantil ES, etc.) → **source de vérité prioritaire**.
2. **Site officiel de l’entreprise** → confirmation, mais c’est du déclaratif
   (l’entreprise écrit ce qu’elle veut). Ne lui donne PAS le poids d’un registre.
3. **Presse pro / LinkedIn entreprise / annuaires sérieux** → recoupement
   secondaire.

ÉCARTE explicitement : pages obsolètes, homonymes douteux, forums, annuaires
non vérifiés, contenus marketing flatteurs sans contrepartie officielle.

**Règle de tranchage** : en cas de contradiction entre sources, le **registre
officiel l’emporte**. Un score élevé doit s’appuyer sur une source de niveau 1.
Si tu ne trouves aucune source de niveau 1 (ni INSEE ni registre équivalent),
le score plafonne naturellement (cohérence interne seulement).

═══════════════════════════════════════════════════════════════
RÈGLE ABSOLUE — Formulation de l'absence
═══════════════════════════════════════════════════════════════
Tu n'as JAMAIS la certitude qu'une entreprise n'existe pas. Une absence
de trace dans tes recherches n'est PAS une preuve d'inexistence. Les
registres en ligne peuvent être incomplets, à jour avec délai, ou tu as
pu rater la bonne requête.

❌ FORMULATIONS INTERDITES (sur-confiance dangereuse) :
   "inexistant", "introuvable", "n'existe pas", "le SIREN n'existe pas",
   "absent du registre", "n'a jamais existé", "n'est pas immatriculé"

✅ FORMULATIONS AUTORISÉES (prudence factuelle) :
   "non confirmé via les sources consultées",
   "aucune trace trouvée dans <sources listées>",
   "n'a pas été retrouvé via <sources listées>",
   "la recherche n'a pas permis de confirmer <champ>"

Un score bas doit s'appuyer sur : (a) données manifestement incohérentes
entre elles, (b) état CESSÉE confirmé, (c) signaux frauduleux clairs
(domaine jetable, nom évidemment factice), OU (d) absence de confirmation
par des sources de niveau 1. PAS sur une affirmation d'inexistence.

═══════════════════════════════════════════════════════════════
TA MISSION
═══════════════════════════════════════════════════════════════
1. **Recoupe activement avec le web** (web_search) :
   - Si le SIREN n'est pas fourni OU si Sirene n'a rien renvoyé : cherche
     "<nom entreprise> <pays> SIREN" ou équivalent registre du pays.
   - Trouve le site officiel de l'entreprise et vérifie qu'il correspond au
     website_url saisi (s'il est fourni).
   - Recoupe la raison sociale, le secteur d'activité, l'adresse, l'état.

2. **Compare** les données saisies (et INSEE le cas échéant) aux sources
   trouvées en ligne. Liste précisément chaque écart (champ + valeur saisie +
   valeur officielle + URL source).

3. **Détecte les signaux suspects** : nom générique ("test", "société", "SAS"
   seul), domaine email jetable, format SIREN/TVA invalide, état CESSÉE
   confirmé par registre, etc.

═══════════════════════════════════════════════════════════════
ÉCARTS DISQUALIFIANTS (plafonnent le score à 5 max)
═══════════════════════════════════════════════════════════════
Certains écarts NE FONT PAS qu'enlever quelques points : ils
PLAFONNENT le score à **5 maximum**, peu importe le reste. Une org
dans ce cas doit ABSOLUMENT passer en review admin manuel — c'est
la signature des scénarios de fraude type (usage du SIREN d'une
autre entreprise, organisation dissoute, défaillance de vérification).

Sont DISQUALIFIANTS :

**D1. NOM ≠ RAISON SOCIALE OFFICIELLE**
    Le \`company_name\` saisi ne correspond PAS à la raison sociale
    officielle retournée par Sirene/INSEE (ou registre équivalent
    par pays) pour le SIREN fourni.

    ✅ NE SONT PAS DISQUALIFIANTS (tolérances) :
      - Différences de casse ("Acme" vs "ACME")
      - Accents / ponctuation ("Café SAS" vs "Cafe SAS")
      - Forme juridique en suffixe ("Acme" vs "Acme SAS")
      - Nom commercial vs dénomination si l'enseigne est
        documentée par une source officielle (marque déposée, etc.)

    ❌ EXEMPLES DISQUALIFIANTS :
      - "SAS" vs "WINOPS" (nom totalement différent)
      - "Acme" vs "Tesla Inc."
      - Sigle ≠ entreprise réelle du SIREN

**D2. ÉTAT ADMINISTRATIF CESSÉ / FERMÉ confirmé par registre.**
    Une org dissoute ne doit pas être auto-approuvée.

**D3. 3+ écarts simultanés** portant sur des champs identifiants
    (nom + adresse + type d'activité par exemple).

**D4. CONFIRMATION OFFICIELLE INDISPONIBLE PAR DÉFAILLANCE TECHNIQUE**
    Si \`sirene_status = 'error'\` (timeout INSEE, erreur réseau après
    retry — voir le bloc DONNÉES INSEE ci-dessus) : tu n'as AUCUNE
    confirmation officielle du nom et du statut. Tu ne peux PAS
    valider l'org sur la seule base du déclaratif + recherche web.
    L'admin doit trancher manuellement.

    Logique : un fraudeur ne doit pas pouvoir profiter d'un timeout
    INSEE ponctuel pour faire passer une org sans contrôle.

    NB : ce D4 ne s'applique PAS quand \`sirene_status\` est :
      - 'ok'        → données récupérées, applique D1 normalement
      - 'not_found' → SIREN absent du registre (cas légitime possible) → score modéré
      - 'skipped'   → pays ≠ FR, registre étranger peut confirmer via web

═══════════════════════════════════════════════════════════════
ÉCARTS MINEURS (pas de plafond, perte de points modérée)
═══════════════════════════════════════════════════════════════
- **Domaine email GÉNÉRIQUE grand public** (gmail.com, outlook.com,
  yahoo.com, hotmail.com, free.fr, orange.fr, etc.) : EXPLICITEMENT
  AUTORISÉ par la décision produit. N'enlève pas de points significatifs,
  ne plafonne JAMAIS le score.
  ≠ domaine JETABLE (mailinator, tempmail, 10minutemail, guerrillamail,
  yopmail, etc.) : CELA reste un signal suspect (mais pas disqualifiant
  à lui seul).
- Absence de site web fourni : information manquante, pas contradictoire.
- Absence de TVA fournie : idem.
- Variations mineures du nom (cf. tolérances D1).

═══════════════════════════════════════════════════════════════
BARÈME DU SCORE (0-10)
═══════════════════════════════════════════════════════════════
Le score reflète la **confiance globale** : cohérence + vérifiabilité.

⚠️ **AVANT de poser un score ≥ 6**, vérifie qu'AUCUN écart
disqualifiant (D1/D2/D3/D4) n'est présent. Si écart disqualifiant
détecté → **score MAX = 5**, quelles que soient les autres données.

- **9-10** : Entreprise confirmée par registre officiel (niveau 1),
  données saisies parfaitement cohérentes (au sens des tolérances),
  AUCUN écart disqualifiant, aucun signal suspect. Tu peux donner
  ce score même sans INSEE (org étrangère) si une source de niveau 1
  le confirme.
- **7-8** : Entreprise vraisemblablement réelle, AUCUN écart
  disqualifiant, ≥ 1 écart mineur OU vérification partielle.
- **4-6** : Plusieurs écarts mineurs OU aucune source de niveau 1
  n'a confirmé OU données suspectes sans certitude. **Plafond 5
  si écart disqualifiant détecté** (D1/D2/D3/D4).
- **0-3** : Données manifestement incohérentes entre elles
  (ex : nom + email + champs totalement déconnectés) OU plusieurs
  écarts disqualifiants simultanés OU signaux frauduleux clairs
  (domaine jetable + nom factice + SIREN bidon). PAS uniquement
  parce que la recherche n'a rien trouvé.

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON STRICT, sans markdown, sans texte autour)
═══════════════════════════════════════════════════════════════
{
  "score": <entier 0..10>,
  "notes": "<2 à 4 phrases en français : conclusion + raison principale + indication des sources principales utilisées. Respecte la RÈGLE ABSOLUE ci-dessus pour formuler les absences. Si écart disqualifiant détecté, le mentionner explicitement : 'Écart disqualifiant détecté : <type D1/D2/D3/D4> → score plafonné à 5.'>",
  "discrepancies": [
    "<écart 1 : champ + valeur saisie + valeur officielle + URL source>",
    "<écart 2 : ...>"
  ]
}

Pour chaque entrée de "discrepancies" :
- **Si écart DISQUALIFIANT** (D1/D2/D3/D4) : préfixer par "[DISQUALIFIANT] "
  Exemple : "[DISQUALIFIANT] D1 — company_name saisi 'SAS' ne correspond pas à la raison sociale officielle INSEE 'WINOPS' (source: annuaire-entreprises.data.gouv.fr/etablissement/...)"
- Si tu as une source officielle qui contredit la saisie : "<champ> saisi '<valeur>' ne correspond pas à <valeur officielle> selon <URL/registre>".
- Si tu n'as PAS pu confirmer un champ : "<champ> saisi '<valeur>' : non confirmé via <sources consultées>" (formulation prudente, jamais "inexistant").

Si AUCUN écart détecté, "discrepancies" doit être un tableau vide [].
Si tu n'as pas pu vérifier (web search indisponible, aucune source trouvée),
explique-le dans "notes" avec la formulation prudente et donne un score
reflétant cette incertitude (typiquement 4-6, jamais 0-1 sur la seule
absence de trace).`
}

type WebSearchToolParam = {
  type: 'web_search_20250305'
  name: 'web_search'
  max_uses: number
}

async function callClaude(args: {
  apiKey: string
  model: string
  prompt: string
  withWebSearch: boolean
}): Promise<Anthropic.Messages.Message> {
  const { apiKey, model, prompt, withWebSearch } = args
  const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS })
  const tools: WebSearchToolParam[] = withWebSearch
    ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: WEB_SEARCH_MAX_USES }]
    : []
  return await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
    // Cast `as never` : le SDK Anthropic accepte les server tools (web_search,
    // code_execution) mais leur typing varie selon la version. Le runtime
    // valide. Si le SDK est régénéré plus tard avec ces types natifs, on
    // pourra retirer le cast.
    ...(tools.length > 0 ? { tools: tools as never } : {}),
  })
}

function isHaikuToolError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  // Heuristique : si l'erreur évoque un tool non supporté par le modèle ou
  // une activation manquante, on tente le fallback Sonnet OU le retry sans tool.
  return /tool|web_search|model.*support|unavailable|invalid_request/i.test(msg)
}

function extractFinalText(response: Anthropic.Messages.Message): string {
  // Concatène tous les blocs `text` finaux. Avec server tools, la réponse
  // contient une alternance text / server_tool_use / web_search_tool_result /
  // text final avec citations. On ignore tout sauf le texte.
  let out = ''
  for (const block of response.content) {
    if (block.type === 'text' && 'text' in block) {
      out += block.text + '\n'
    }
  }
  return out
}

export async function verifyAiCoherence(
  input: VerificationInput,
  sireneData: SireneData | null,
  /**
   * État du provider Sirene après ses tentatives (cf. lib/verification/index.ts).
   * Détermine notamment l'application du disqualifiant D4 (Sirene indisponible
   * par défaillance technique → plafond 5).
   * `undefined` = compat ascendante : le prompt verra "Données INSEE non
   * disponibles" sans pouvoir distinguer error/not_found/skipped.
   */
  sireneStatus: 'ok' | 'not_found' | 'error' | 'skipped' | null = null,
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

  const prompt = buildPrompt(input, sireneData, sireneStatus)

  // ── Tentatives d'appel Claude avec dégradation gracieuse ────────────────
  // 1. Haiku 4.5 + web_search (cas nominal — recherche web active)
  // 2. Si KO et erreur évoque le tool/modèle : Sonnet 4.6 + web_search
  //    (fallback modèle, web search reste actif — fiabilité préservée)
  // 3. Si KO encore : Haiku 4.5 SANS tools (mode 11G — déclaratif uniquement)
  //    Le prompt sait gérer (cf. instruction "Si tu n'as pas pu vérifier...")
  let response: Anthropic.Messages.Message | null = null
  const attempts: Array<{ model: string; withWebSearch: boolean; ok: boolean; err?: string }> = []

  try {
    response = await callClaude({ apiKey, model: PRIMARY_MODEL, prompt, withWebSearch: true })
    attempts.push({ model: PRIMARY_MODEL, withWebSearch: true, ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    attempts.push({ model: PRIMARY_MODEL, withWebSearch: true, ok: false, err: msg })
    console.warn('[verification:ai-coherence] Haiku+web_search failed', { msg })

    if (isHaikuToolError(err)) {
      try {
        response = await callClaude({ apiKey, model: FALLBACK_MODEL, prompt, withWebSearch: true })
        attempts.push({ model: FALLBACK_MODEL, withWebSearch: true, ok: true })
      } catch (err2) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2)
        attempts.push({ model: FALLBACK_MODEL, withWebSearch: true, ok: false, err: msg2 })
        console.warn('[verification:ai-coherence] Sonnet+web_search failed', { msg2 })
      }
    }

    if (!response) {
      try {
        response = await callClaude({ apiKey, model: PRIMARY_MODEL, prompt, withWebSearch: false })
        attempts.push({ model: PRIMARY_MODEL, withWebSearch: false, ok: true })
      } catch (err3) {
        const msg3 = err3 instanceof Error ? err3.message : String(err3)
        attempts.push({ model: PRIMARY_MODEL, withWebSearch: false, ok: false, err: msg3 })
        console.error('[verification:ai-coherence] all attempts failed', { msg3 })
        return {
          provider_name: PROVIDER_NAME,
          result: 'error',
          confidence_score: 0,
          raw_response: { attempts },
          notes: 'Tous les appels IA ont échoué — admin tranche manuellement',
          discrepancies: [],
        }
      }
    }
  }

  // ── Parsing de la réponse ───────────────────────────────────────────────
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
    console.warn('[verification:ai-coherence] could not parse JSON from Claude', {
      preview: rawText.slice(0, 200),
      attempts,
    })
    return {
      provider_name: PROVIDER_NAME,
      result: 'inconclusive',
      confidence_score: 5,
      raw_response: { raw_text: rawText.slice(0, 1500), attempts },
      notes: 'Réponse IA non parsable, admin tranche manuellement',
      discrepancies: [],
    }
  }

  const rawScore = typeof parsed.score === 'number' ? parsed.score : 5
  const score = Math.max(0, Math.min(10, Math.round(rawScore)))
  const notes = (parsed.notes ?? 'Analyse IA sans détails').slice(0, 1500)
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
    raw_response: {
      parsed,
      raw_text_preview: rawText.slice(0, 800),
      attempts,
      usage: response!.usage,
    },
    notes,
    discrepancies,
  }
}

/**
 * Alias historique (compatibilité avec le registry pre-11G).
 * @deprecated Utiliser `verifyAiCoherence` directement.
 */
export const verifyWithAiFallback = verifyAiCoherence
