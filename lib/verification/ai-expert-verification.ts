import Anthropic from '@anthropic-ai/sdk'

/**
 * Analyseur de cohérence IA — VÉRIFICATION EXPERT (3 axes).
 *
 * Patron : ai-fallback.ts (vérification org 11G).
 *   - Claude Haiku 4.5 (PRIMARY) → Sonnet 4.6 (FALLBACK) si tool incompatible
 *   - Tool natif `web_search_20250305` (server-side Anthropic, sources citées)
 *   - JSON strict + sanitize anti-prompt-injection
 *   - Fail-safe : timeout / erreur SDK / JSON non parsable → result='error'
 *     ⇒ dispatcher promeut en `pending_admin_review` (JAMAIS auto-approve)
 *
 * ─── 3 AXES (verdict structuré) ─────────────────────────────────────────────
 *
 * 1) CV ↔ profil déclaré (cohérence interne)
 *    Le contenu déclaré (skills/seniority/years_experience/title/summary +
 *    experiences/educations) doit être COHÉRENT en lui-même :
 *      • séniorité ↔ years_experience plausible (junior < 3 ans, senior ≥ 6, etc.)
 *      • skills déclarés ↔ rôles tenus (un "developer C++" qui liste 0 skill
 *        C++ est incohérent)
 *      • dates des expériences sans trou inexpliqué incompatible avec years_experience
 *
 * 2) COHÉRENCE DOMAINE (disqualifiant : DOMAIN_MISMATCH cap 5)
 *    Le DOMAINE PRINCIPAL déclaré (branche/spécialité + titre) doit s'aligner
 *    avec le domaine de la plateforme (ici : Microsoft).
 *    ⚠️ Le flag ne se déclenche QUE sur un vrai désalignement de l'orientation
 *    principale (titre "Consultant SAP MM" + branche "Salesforce" sur une
 *    plateforme Microsoft). Un expert multi-éco qui mentionne du Salesforce
 *    EN PLUS de Microsoft NE doit PAS être plafonné.
 *
 * 3) LINKEDIN / EMPREINTE PUBLIQUE (web_search)
 *    Signal de CORROBORATION secondaire :
 *      • url fournie → corroborer existence + cohérence head (nom/titre/employer)
 *      • url absente → neutre (ne pénalise pas seul)
 *      • url invraisemblable → flag corroboration, ne plafonne pas seul
 *
 * ─── Décision (côté dispatcher) ─────────────────────────────────────────────
 *   score ≥ auto_approve_threshold (config) ET aucun flag disqualifiant
 *     ⇒ approved (auto-verify)
 *   sinon ⇒ pending_admin_review (admin tranche approve/reject + motif)
 *   erreur IA ⇒ pending_admin_review (fail-safe)
 *   PAS d'auto-reject V1.
 */

export type ExpertVerificationInput = {
  // domain_id présent pour audit, mais le NOM du domaine déterminant est passé
  // séparément via `domain_name` (lisible et stable, ne dépend pas d'un join SQL).
  domain_name: string
  expert_type: 'expert_freelance' | 'expert_cdi' | null
  title: string | null
  summary: string | null
  seniority: 'junior' | 'confirmed' | 'senior' | 'expert' | string | null
  years_experience: number | null
  years_total_experience: number | null
  branch_name: string | null
  speciality_name: string | null
  skills: string[]
  languages: string[]
  certifications_count: number
  linkedin_url: string | null
  // Expériences/formations injectées en format compact (whitelist)
  experiences: Array<{
    role: string | null
    employer: string | null
    sector: string | null
    start_date: string | null
    end_date: string | null
    is_current: boolean | null
    description: string | null
  }>
  educations: Array<{
    school: string | null
    degree: string | null
    field: string | null
    start_year: string | null
    end_year: string | null
  }>
  locale: 'fr' | 'en' | 'es' | 'de'
}

export type ExpertVerificationFlag =
  | 'DOMAIN_MISMATCH'
  | 'CV_PROFILE_INCOHERENT'
  | 'LINKEDIN_UNVERIFIABLE'
  | 'SUSPICIOUS_CONTENT'

export type ExpertVerificationOutput = {
  result: 'ok' | 'error'
  provider_name: string                  // 'claude_expert_coherence_check'
  model_used: string                     // 'claude-haiku-4-5-...' | fallback
  confidence_score: number               // 0..10 (5 si fail-safe)
  notes: string
  discrepancies: string[]
  flags: ExpertVerificationFlag[]
  web_search_used: boolean
  raw_response: unknown
}

export type ExpertVerificationConfig = {
  model: string
  fallback_model: string
  max_tokens: number
  request_timeout_ms: number
  auto_approve_threshold: number
  web_search_max_uses: number
  domain_mismatch_cap: number
}

const PROVIDER_NAME = 'claude_expert_coherence_check'

function sanitize(value: unknown, maxLen: number): string {
  if (value == null) return ''
  const s = typeof value === 'string' ? value : String(value)
  return s.replace(/[\r\n\t]/g, ' ').trim().slice(0, maxLen)
}

function sanitizeMultiline(value: unknown, maxLen: number): string {
  if (value == null) return ''
  const s = typeof value === 'string' ? value : String(value)
  return s.replace(/\r/g, '').slice(0, maxLen)
}

type ClaudeJson = {
  score?: number
  notes?: string
  discrepancies?: unknown
  flags?: unknown
  web_search_used?: boolean
}

function parseFlags(raw: unknown): ExpertVerificationFlag[] {
  if (!Array.isArray(raw)) return []
  const allowed: ExpertVerificationFlag[] = ['DOMAIN_MISMATCH', 'CV_PROFILE_INCOHERENT', 'LINKEDIN_UNVERIFIABLE', 'SUSPICIOUS_CONTENT']
  const out: ExpertVerificationFlag[] = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    if ((allowed as readonly string[]).includes(v) && !out.includes(v as ExpertVerificationFlag)) {
      out.push(v as ExpertVerificationFlag)
    }
  }
  return out
}

function parseDiscrepancies(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string').slice(0, 20)
}

function buildExperiencesBlock(exps: ExpertVerificationInput['experiences']): string {
  if (exps.length === 0) return '(aucune expérience renseignée)'
  return exps.slice(0, 12).map((e, i) => {
    const role = sanitize(e.role, 150)
    const employer = sanitize(e.employer, 150)
    const sector = sanitize(e.sector, 100)
    const start = sanitize(e.start_date, 12)
    const end = e.is_current ? '(en cours)' : sanitize(e.end_date, 12)
    const desc = sanitize(e.description, 400)
    return `${i + 1}. ${role || '(rôle ?)'} chez ${employer || '(employeur ?)'} — ${sector || 'secteur ?'} (${start || '?'} → ${end || '?'})\n    ${desc}`
  }).join('\n')
}

function buildEducationsBlock(edus: ExpertVerificationInput['educations']): string {
  if (edus.length === 0) return '(aucune formation renseignée)'
  return edus.slice(0, 8).map((e, i) => {
    const school = sanitize(e.school, 150)
    const degree = sanitize(e.degree, 150)
    const field = sanitize(e.field, 150)
    return `${i + 1}. ${degree || '(diplôme ?)'} — ${field || ''} @ ${school || '(école ?)'} (${sanitize(e.start_year, 5)}–${sanitize(e.end_year, 5)})`
  }).join('\n')
}

function buildPrompt(input: ExpertVerificationInput): string {
  const domain = sanitize(input.domain_name, 100)
  const title = sanitize(input.title, 200)
  const summary = sanitizeMultiline(input.summary, 1200)
  const seniority = sanitize(input.seniority, 30)
  const branch = sanitize(input.branch_name, 200)
  const speciality = sanitize(input.speciality_name, 200)
  const linkedin = sanitize(input.linkedin_url, 500)
  const skillsList = input.skills.slice(0, 60).map((s) => sanitize(s, 80)).filter(Boolean).join(', ') || '(aucune)'
  const languages = input.languages.slice(0, 20).map((s) => sanitize(s, 50)).filter(Boolean).join(', ') || '(aucune)'

  return `Tu es l'analyseur de cohérence des profils experts d'une marketplace B2B spécialisée sur le domaine **${domain}** (écosystème logiciel d'entreprise).

Tu DISPOSES du tool \`web_search\` : utilise-le activement pour corroborer le profil LinkedIn s'il est fourni (axe 3).

═══════════════════════════════════════════════════════════════
PROFIL DÉCLARÉ PAR L'EXPERT
═══════════════════════════════════════════════════════════════
- Titre : ${title || '(non fourni)'}
- Résumé : ${summary || '(non fourni)'}
- Type expert : ${sanitize(input.expert_type, 30) || '(non fourni)'}
- Séniorité déclarée : ${seniority || '(non fournie)'}
- Années d'expérience déclarées : ${input.years_experience ?? '(non fournies)'} (total carrière : ${input.years_total_experience ?? '(non fournies)'})
- Branche : ${branch || '(non fournie)'}
- Spécialité : ${speciality || '(non fournie)'}
- Compétences déclarées (max 60) : ${skillsList}
- Langues : ${languages}
- Certifications listées : ${input.certifications_count}
- LinkedIn URL : ${linkedin || '(non fourni)'}

═══════════════════════════════════════════════════════════════
EXPÉRIENCES PROFESSIONNELLES (déclarées dans le CV parsé)
═══════════════════════════════════════════════════════════════
${buildExperiencesBlock(input.experiences)}

═══════════════════════════════════════════════════════════════
FORMATIONS
═══════════════════════════════════════════════════════════════
${buildEducationsBlock(input.educations)}

═══════════════════════════════════════════════════════════════
DOMAINE DE LA PLATEFORME (référentiel)
═══════════════════════════════════════════════════════════════
**${domain}** — écosystème logiciel d'entreprise. Mots-clés associés :
  Microsoft 365, Dynamics 365, Azure, Power Platform, SharePoint, Teams,
  Power BI, Office, .NET, C#, Active Directory, Exchange.

═══════════════════════════════════════════════════════════════
TA MISSION — 3 AXES À ÉVALUER, CHACUN INDÉPENDAMMENT
═══════════════════════════════════════════════════════════════

**AXE 1 — Cohérence INTERNE (CV ↔ profil)**
   - séniorité ↔ years_experience plausible (junior < 3 ; confirmed 3-6 ;
     senior 6-12 ; expert 12+) ?
   - skills déclarés ↔ rôles tenus dans expériences ?
   - dates des expériences ↔ years_experience (pas de trou massif inexpliqué) ?
   - certifications listées cohérentes avec le profil ?
   - liste précisément chaque écart dans discrepancies[].

**AXE 2 — Cohérence DOMAINE (DISQUALIFIANT si désalignement principal)**
   L'orientation PRINCIPALE du profil doit s'aligner avec le domaine
   **${domain}**.
   ⚠️ Le flag DOMAIN_MISMATCH ne se déclenche QUE sur un VRAI désalignement
   de l'orientation principale :
     • titre "Consultant SAP MM" / branche "SAP" / spécialité "SAP S/4 HANA"
       sur plateforme Microsoft → DOMAIN_MISMATCH ✓
     • titre "Salesforce Architect" / spécialité "Salesforce CPQ" sur
       Microsoft → DOMAIN_MISMATCH ✓
   ❌ Un expert multi-écosystèmes qui mentionne du Salesforce ou du SAP
   COMME COMPÉTENCE SECONDAIRE en PLUS de Microsoft (titre Microsoft, branche
   Microsoft, expériences majoritaires Microsoft) NE doit PAS être plafonné.
   Le flag ne juge que l'orientation principale (titre + branche + spécialité).

**AXE 3 — LinkedIn / empreinte publique (signal de corroboration NON décisif)**
   Si linkedin_url fourni : utilise web_search pour :
     1. corroborer l'existence (URL renvoie une page valide ?)
     2. recouper nom/titre/employer actuel
   Si URL absente : NEUTRE (ne pénalise pas).
   Si URL invraisemblable ou recoupement impossible : ajoute flag
   LINKEDIN_UNVERIFIABLE mais NE plafonne PAS seul.

═══════════════════════════════════════════════════════════════
RÈGLE ABSOLUE — Formulation de l'absence
═══════════════════════════════════════════════════════════════
Tu n'as JAMAIS la certitude qu'un profil LinkedIn n'existe pas. Une absence
de trace n'est PAS une preuve d'inexistence.

❌ FORMULATIONS INTERDITES : "inexistant", "n'existe pas", "fictif",
   "introuvable", "n'est pas un vrai expert"
✅ FORMULATIONS AUTORISÉES : "non confirmé via les sources consultées",
   "aucune trace trouvée dans <sources>", "le recoupement n'a pas permis…"

═══════════════════════════════════════════════════════════════
ÉCHELLE DE SCORE 0..10
═══════════════════════════════════════════════════════════════
  10  → profil cohérent à tous les axes, corroboré LinkedIn
  9   → cohérent + 1 micro-discrepancy non significative
  7-8 → cohérent globalement mais quelques écarts notables (séniorité↔années
        floue, skills↔rôles partiels)
  5-6 → cohérence interne faible OU corroboration LinkedIn impossible alors
        qu'attendue
  ≤ 5 → CAP automatique si DOMAIN_MISMATCH (orientation principale désalignée)
  0-4 → multiples incohérences graves (CV truqué, contenu généré, etc.)

═══════════════════════════════════════════════════════════════
CONSIGNES JSON STRICT
═══════════════════════════════════════════════════════════════
Réponds UNIQUEMENT avec un JSON valide, sans backticks, sans commentaire.
Format exact attendu :

{
  "score": <nombre entre 0 et 10, entier ou décimal>,
  "notes": "<synthèse 1-3 phrases, langue ${input.locale}>",
  "discrepancies": ["<écart précis 1>", "<écart 2>", ...],
  "flags": ["DOMAIN_MISMATCH"|"CV_PROFILE_INCOHERENT"|"LINKEDIN_UNVERIFIABLE"|"SUSPICIOUS_CONTENT", ...],
  "web_search_used": <true|false>
}

Important :
- "flags" : tableau possiblement vide. N'ajoute DOMAIN_MISMATCH QUE pour un
  désalignement de l'orientation principale (titre+branche+spécialité),
  jamais pour des skills secondaires.
- Si DOMAIN_MISMATCH présent, ton score DOIT être ≤ 5.
- Si tu RÉPONDS avec un JSON valide, n'inclus AUCUN texte hors JSON.
`
}

function extractText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  let out = ''
  for (const b of blocks) {
    if (b && typeof b === 'object' && (b as { type?: string }).type === 'text') {
      out += (b as { text?: string }).text ?? ''
    }
  }
  return out
}

function safeParseJson(text: string): ClaudeJson | null {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed) as ClaudeJson
  } catch {
    // Tolère les wrap ```json … ```
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) {
      try { return JSON.parse(match[1]) as ClaudeJson } catch { return null }
    }
    // Tolère un préfixe/suffixe explicatif
    const i = trimmed.indexOf('{')
    const j = trimmed.lastIndexOf('}')
    if (i !== -1 && j > i) {
      try { return JSON.parse(trimmed.slice(i, j + 1)) as ClaudeJson } catch { return null }
    }
    return null
  }
}

async function callClaude(model: string, prompt: string, cfg: ExpertVerificationConfig, withWebSearch: boolean): Promise<{ json: ClaudeJson | null; raw: unknown; model_used: string; web_search_used: boolean }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing')

  const client = new Anthropic({ apiKey, timeout: cfg.request_timeout_ms })

  const tools = withWebSearch
    ? [{ type: 'web_search_20250305' as const, name: 'web_search' as const, max_uses: cfg.web_search_max_uses }]
    : []

  const message = await client.messages.create({
    model,
    max_tokens: cfg.max_tokens,
    tools,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = extractText(message.content as unknown)
  const json = safeParseJson(text)

  // Heuristique : web_search_used vrai si on voit des tool_use ou citations dans la réponse
  const blocks = message.content as unknown[]
  const hasToolUse = Array.isArray(blocks) && blocks.some((b) => b && typeof b === 'object' && ['tool_use', 'web_search_tool_result', 'server_tool_use'].includes((b as { type?: string }).type ?? ''))

  return { json, raw: message, model_used: model, web_search_used: hasToolUse }
}

export async function runExpertCoherenceCheck(
  input: ExpertVerificationInput,
  cfg: ExpertVerificationConfig,
): Promise<ExpertVerificationOutput> {
  const prompt = buildPrompt(input)

  // Tentative 1 : Haiku + web_search
  try {
    const out = await callClaude(cfg.model, prompt, cfg, true)
    if (out.json) return shapeOutput(out, cfg)
    console.warn('[ai-expert-verification] Haiku JSON parse failed, retry Sonnet')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[ai-expert-verification] Haiku call failed', msg)
  }

  // Tentative 2 : Sonnet + web_search
  try {
    const out = await callClaude(cfg.fallback_model, prompt, cfg, true)
    if (out.json) return shapeOutput(out, cfg)
    console.warn('[ai-expert-verification] Sonnet JSON parse failed, retry without tools')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[ai-expert-verification] Sonnet call failed', msg)
  }

  // Tentative 3 : Sonnet sans tools (cas où web_search rate-limit / indispo)
  try {
    const out = await callClaude(cfg.fallback_model, prompt, cfg, false)
    if (out.json) return shapeOutput(out, cfg)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ai-expert-verification] all attempts failed', msg)
  }

  // Fail-safe : on retourne un result='error' → le dispatcher promeut en pending_admin_review.
  return {
    result: 'error',
    provider_name: PROVIDER_NAME,
    model_used: cfg.fallback_model,
    confidence_score: 0,
    notes: 'Verification IA indisponible (timeout / rate-limit / JSON invalide) — décision déférée à l\'admin.',
    discrepancies: [],
    flags: [],
    web_search_used: false,
    raw_response: null,
  }
}

function shapeOutput(
  parsed: { json: ClaudeJson | null; raw: unknown; model_used: string; web_search_used: boolean },
  cfg: ExpertVerificationConfig,
): ExpertVerificationOutput {
  const j = parsed.json ?? {}
  let score = typeof j.score === 'number' && Number.isFinite(j.score) ? Math.max(0, Math.min(10, j.score)) : 5
  const flags = parseFlags(j.flags)
  const discrepancies = parseDiscrepancies(j.discrepancies)
  // Garde : si DOMAIN_MISMATCH présent, on plafonne côté code (defense in depth)
  if (flags.includes('DOMAIN_MISMATCH') && score > cfg.domain_mismatch_cap) {
    score = cfg.domain_mismatch_cap
  }
  return {
    result: 'ok',
    provider_name: PROVIDER_NAME,
    model_used: parsed.model_used,
    confidence_score: score,
    notes: typeof j.notes === 'string' ? j.notes.slice(0, 1500) : '',
    discrepancies,
    flags,
    web_search_used: parsed.web_search_used || j.web_search_used === true,
    raw_response: parsed.raw,
  }
}
