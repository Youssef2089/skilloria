import Anthropic from '@anthropic-ai/sdk'
import { consommationJetons, type ConsommationIA } from '../ai-consommation.ts'
import { causeEchecModele, type CauseEchecModele } from '../profil/cause-echec-modele.ts'
import { tranchesPourConsigne } from '../profil/seniorites.ts'

/**
 * Analyseur de cohérence IA — VÉRIFICATION EXPERT (2 axes).
 *
 * Patron : ai-fallback.ts (vérification org 11G).
 *   - Claude Haiku 4.5 (PRIMARY) → Sonnet 4.6 (FALLBACK)
 *   - AUCUN outil : ni recherche web, ni ouverture de page (recette du 01/10/2026,
 *     décision de Youssef — voir « LinkedIn est ignoré » ci-dessous)
 *   - JSON strict + sanitize anti-prompt-injection
 *   - Fail-safe : timeout / erreur SDK / JSON non parsable → result='error'
 *     ⇒ dispatcher promeut en `pending_admin_review` (JAMAIS auto-approve)
 *
 * ─── 3 AXES (verdict structuré) ─────────────────────────────────────────────
 *
 * 1) CV ↔ profil déclaré (cohérence interne)
 *    Le contenu déclaré (skills/seniority/years_experience/title/summary +
 *    experiences/educations) doit être COHÉRENT en lui-même :
 *      • séniorité ↔ years_experience plausible (tranches de lib/profil/seniorites.ts,
 *        semi-ouvertes : chaque valeur appartient à UNE tranche)
 *      • skills déclarés ↔ rôles tenus (un "developer C++" qui liste 0 skill
 *        C++ est incohérent)
 *      • dates des expériences sans trou inexpliqué incompatible avec years_experience
 *      • une MISSION nomme un CLIENT, pas un employeur ; des missions qui se
 *        chevauchent sont NORMALES pour un freelance (plusieurs clients à la fois)
 *
 * 2) COHÉRENCE DOMAINE (disqualifiant : DOMAIN_MISMATCH cap 5)
 *    Le DOMAINE PRINCIPAL déclaré (branche/spécialité + titre) doit s'aligner
 *    avec le domaine de la plateforme (ici : Microsoft).
 *    ⚠️ Le flag ne se déclenche QUE sur un vrai désalignement de l'orientation
 *    principale (titre "Consultant SAP MM" + branche "Salesforce" sur une
 *    plateforme Microsoft). Un expert multi-éco qui mentionne du Salesforce
 *    EN PLUS de Microsoft NE doit PAS être plafonné.
 *
 * LINKEDIN EST IGNORÉ (recette du 01/10/2026, décision de Youssef). LinkedIn bloque
 *    les robots : chaque tentative échouait, posait LINKEDIN_UNVERIFIABLE, et l'échelle
 *    rangeait alors le profil en « 5-6 → corroboration LinkedIn impossible » — tous les
 *    profils seraient partis en revue manuelle. L'adresse n'est plus transmise, aucun
 *    outil n'est offert (aucune recherche payée), le drapeau n'est plus accepté et
 *    l'échelle ne cite plus LinkedIn.
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
  // Référentiel produits/mots-clés de l'écosystème, issu de domain_configs.tags
  // (source canonique par domaine). VIDE = aucun référentiel connu → l'IA juge
  // alors sur la seule cohérence CV/profil, SANS verdict DOMAIN_MISMATCH possible.
  domain_tags: string[]
  expert_type: 'expert_freelance' | 'expert_cdi' | null
  title: string | null
  summary: string | null
  seniorities: string[]
  years_experience: number | null
  years_total_experience: number | null
  branch_name: string | null
  speciality_names: string[]
  skills: string[]
  languages: string[]
  certifications_count: number
  // Expériences/formations injectées en format compact (whitelist)
  experiences: Array<{
    /** 'career' (un poste chez un employeur) ou 'project' (une mission pour un client). */
    experience_type: string | null
    role: string | null
    employer: string | null
    /** Le CLIENT d'une mission — distinct de l'employeur (point 12 de la recette). */
    client_name: string | null
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

// LINKEDIN_UNVERIFIABLE n'est plus un drapeau que le modèle peut poser (LinkedIn est
// ignoré) ; un verdict ANCIEN peut encore le porter, et l'admin le lit tel quel.
export type ExpertVerificationFlag =
  | 'DOMAIN_MISMATCH'
  | 'CV_PROFILE_INCOHERENT'
  | 'SUSPICIOUS_CONTENT'

export type ExpertVerificationOutput = {
  result: 'ok' | 'error'
  provider_name: string                  // 'claude_expert_coherence_check'
  model_used: string                     // 'claude-haiku-4-5-...' | fallback
  confidence_score: number               // 0..10 (5 si fail-safe)
  notes: string
  discrepancies: string[]
  flags: ExpertVerificationFlag[]
  /** Toujours `false` : aucun outil n'est offert. Gardé pour la forme du verdict écrit. */
  web_search_used: boolean
  raw_response: unknown
  /**
   * Ce que CHAQUE tentative a consommé — RENDU, jamais enregistré ici.
   * Ce module est PUR : pas de client Supabase, pas d'écriture. C'est
   * l'appelant, qui a le client et les identifiants, qui enregistre.
   * Une tentative dont la réponse était illisible a été PAYÉE : elle y est
   * (audit du 30/09/2026, m4 — seule la tentative retenue était comptée).
   */
  usages: ConsommationIA[]
  /** Quand `result === 'error'` : POURQUOI — rejouable ou non (lib/profil/cause-echec-modele.ts). */
  echec?: CauseEchecModele
}

export type ExpertVerificationConfig = {
  model: string
  fallback_model: string
  max_tokens: number
  request_timeout_ms: number
  auto_approve_threshold: number
  domain_mismatch_cap: number
  // Flags de cohérence qui INTERDISENT l'auto-approbation, quel que soit le
  // score. Configurable via verification_providers.config.blocking_flags.
  blocking_flags: ExpertVerificationFlag[]
}

const PROVIDER_NAME = 'claude_expert_coherence_check'

function sanitize(value: unknown, maxLen: number): string {
  if (value == null) return ''
  const s = typeof value === 'string' ? value : String(value)
  return s.replace(/[\r\n\t]/g, ' ').trim().slice(0, maxLen)
}

/**
 * Champs devenus MULTIPLES (séniorités, spécialités). Le prompt les reçoit
 * joints — « confirmé, senior » — plutôt que sous forme de liste : la
 * consigne de vérification les lit comme une déclaration, et une déclaration
 * à plusieurs valeurs se lit très bien en toutes lettres.
 */
function sanitizeList(values: unknown, maxItems: number, maxLen: number): string {
  if (!Array.isArray(values)) return ''
  return values
    .slice(0, maxItems)
    .map((v) => sanitize(v, maxLen))
    .filter((v) => v.length > 0)
    .join(', ')
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
}

function parseFlags(raw: unknown): ExpertVerificationFlag[] {
  if (!Array.isArray(raw)) return []
  // LINKEDIN_UNVERIFIABLE n'y est plus : un modèle qui le poserait quand même ne fait rien tomber.
  const allowed: ExpertVerificationFlag[] = ['DOMAIN_MISMATCH', 'CV_PROFILE_INCOHERENT', 'SUSPICIOUS_CONTENT']
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

/**
 * UNE MISSION N'A PAS D'EMPLOYEUR, ELLE A UN CLIENT (recette du 01/10/2026, point 12).
 * L'analyseur range la mission d'un freelance en `project` : `employer` vide, le client
 * dans `client_name`. Ce bloc écrivait « chez (employeur ?) » sur CHAQUE mission, sans
 * le client, et le modèle comptait « 10 employeurs non nommés sur 12 » chez un freelance
 * au parcours parfaitement nommé. Chaque ligne dit maintenant ce qu'elle est.
 */
export function ligneExperience(e: ExpertVerificationInput['experiences'][number]): string {
  const role = sanitize(e.role, 150) || '(rôle ?)'
  const employer = sanitize(e.employer, 150)
  const client = sanitize(e.client_name, 150)
  const sector = sanitize(e.sector, 100)
  const start = sanitize(e.start_date, 12)
  const end = e.is_current ? '(en cours)' : sanitize(e.end_date, 12)
  const quoi =
    e.experience_type === 'project'
      ? `MISSION — ${role} pour le client ${client || '(client confidentiel)'}${employer ? ` (portée par ${employer})` : ''}`
      : `POSTE — ${role} chez ${employer || '(employeur non renseigné)'}`
  return `${quoi} — ${sector || 'secteur ?'} (${start || '?'} → ${end || '?'})`
}

function buildExperiencesBlock(exps: ExpertVerificationInput['experiences']): string {
  if (exps.length === 0) return '(aucune expérience renseignée)'
  return exps.slice(0, 12).map((e, i) => `${i + 1}. ${ligneExperience(e)}\n    ${sanitize(e.description, 400)}`).join('\n')
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
  const seniority = sanitizeList(input.seniorities, 4, 30)
  const branch = sanitize(input.branch_name, 200)
  const speciality = sanitizeList(input.speciality_names, 10, 100)
  const skillsList = input.skills.slice(0, 60).map((s) => sanitize(s, 80)).filter(Boolean).join(', ') || '(aucune)'
  const languages = input.languages.slice(0, 20).map((s) => sanitize(s, 50)).filter(Boolean).join(', ') || '(aucune)'
  // Référentiel produits par domaine (domain_configs.tags). Vide → pas de
  // référentiel → aucun DOMAIN_MISMATCH possible (cf. bloc DOMAINE ci-dessous).
  const keywordsRef = (input.domain_tags ?? [])
    .map((s) => sanitize(s, 60))
    .filter(Boolean)
    .slice(0, 40)
    .join(', ')
  const hasRef = keywordsRef.length > 0

  return `Tu es l'analyseur de cohérence des profils experts d'une marketplace B2B spécialisée sur le domaine **${domain}** (écosystème logiciel d'entreprise).

Tu n'as AUCUN outil : tu juges uniquement ce qui est écrit ci-dessous. LinkedIn n'est ni fourni ni consulté, et son absence ne compte JAMAIS.

═══════════════════════════════════════════════════════════════
PROFIL DÉCLARÉ PAR L'EXPERT
═══════════════════════════════════════════════════════════════
- Titre : ${title || '(non fourni)'}
- Résumé : ${summary || '(non fourni)'}
- Type expert : ${sanitize(input.expert_type, 30) || '(non fourni)'}
- Séniorités déclarées : ${seniority || '(non fournie)'}
- Années d'expérience déclarées : ${input.years_experience ?? '(non fournies)'} (total carrière : ${input.years_total_experience ?? '(non fournies)'})
- Branche : ${branch || '(non fournie)'}
- Spécialités : ${speciality || '(non fournie)'}
- Compétences déclarées (max 60) : ${skillsList}
- Langues : ${languages}
- Certifications listées : ${input.certifications_count}

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
**${domain}** — écosystème logiciel d'entreprise.${
  keywordsRef
    ? ` Produits/mots-clés associés :\n  ${keywordsRef}.`
    : `\n  (Aucun référentiel produits n'est renseigné pour ce domaine : NE fais AUCUN jugement d'alignement d'écosystème — le flag DOMAIN_MISMATCH est INTERDIT dans ce cas. Évalue uniquement la cohérence interne CV/profil.)`
}

═══════════════════════════════════════════════════════════════
TA MISSION — 3 AXES À ÉVALUER, CHACUN INDÉPENDAMMENT
═══════════════════════════════════════════════════════════════

**AXE 1 — Cohérence INTERNE (CV ↔ profil)**
   - séniorité ↔ years_experience plausible ? Les tranches, sans recouvrement (la
     borne basse comprise, la borne haute exclue) : ${tranchesPourConsigne()}.
     Une valeur appartient à UNE seule tranche ; ne la cite jamais dans deux.
   - skills déclarés ↔ rôles tenus dans expériences ?
   - dates des expériences ↔ years_experience (pas de trou massif inexpliqué) ?
   - certifications listées cohérentes avec le profil ?
   - liste précisément chaque écart dans discrepancies[].
   CE QUI N'EST PAS UN ÉCART :
   - une MISSION (ligne « MISSION — … pour le client … ») n'a pas d'employeur :
     elle a un client, et un client confidentiel est normal. Ne compte JAMAIS une
     mission comme un « employeur non nommé ».
   - des périodes qui se CHEVAUCHENT sont normales : un freelance mène plusieurs
     missions en parallèle, et un poste peut couvrir les missions menées pendant
     ce poste. Ne les signale pas, ne les pénalise pas, et ne les additionne pas
     comme si elles étaient successives.

**AXE 2 — Cohérence DOMAINE (DISQUALIFIANT si désalignement principal)**${
  hasRef
    ? `
   L'orientation PRINCIPALE du profil doit s'aligner avec le domaine
   **${domain}** (référentiel produits ci-dessus).
   ⚠️ Le flag DOMAIN_MISMATCH ne se déclenche QUE sur un VRAI désalignement
   de l'orientation principale (titre + branche + spécialité) :
     • Si l'orientation principale relève MANIFESTEMENT d'un AUTRE écosystème
       logiciel d'entreprise que **${domain}** (produits/mots-clés étrangers au
       référentiel dominant le titre ET la branche ET la spécialité)
       → DOMAIN_MISMATCH ✓
   ❌ Un expert multi-écosystèmes qui mentionne des produits d'un autre
   écosystème COMME COMPÉTENCE SECONDAIRE, en PLUS de **${domain}** (titre,
   branche et expériences majoritairement alignés **${domain}**), NE doit PAS
   être plafonné. Le flag ne juge que l'orientation principale.`
    : `
   ⚠️ Aucun référentiel produits n'est renseigné pour **${domain}** : tu NE
   PEUX PAS statuer sur l'alignement d'écosystème. Le flag DOMAIN_MISMATCH est
   INTERDIT. Ignore cet axe et n'en tiens aucun compte dans le score.`
}

═══════════════════════════════════════════════════════════════
RÈGLE ABSOLUE — Formulation
═══════════════════════════════════════════════════════════════
❌ FORMULATIONS INTERDITES : "inexistant", "n'existe pas", "fictif",
   "introuvable", "n'est pas un vrai expert"
✅ Décris ce qui est ÉCRIT et en quoi c'est incohérent — jamais un soupçon sur
   l'existence de la personne.

═══════════════════════════════════════════════════════════════
ÉCHELLE DE SCORE 0..10
═══════════════════════════════════════════════════════════════
  10  → profil cohérent sur les deux axes
  9   → cohérent + 1 micro-discrepancy non significative
  7-8 → cohérent globalement mais quelques écarts notables (séniorité↔années
        floue, skills↔rôles partiels)
  5-6 → cohérence interne faible
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
  "flags": ["DOMAIN_MISMATCH"|"CV_PROFILE_INCOHERENT"|"SUSPICIOUS_CONTENT", ...]
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

async function callClaude(model: string, prompt: string, cfg: ExpertVerificationConfig, usages: ConsommationIA[]): Promise<{ json: ClaudeJson | null; raw: unknown; model_used: string; web_search_used: boolean }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing')

  // AUCUN rejeu du SDK (maxRetries: 0) : les tentatives sont celles d'ici, et le travail
  // d'IA est rejoué par son exécutant avec un délai croissant (§D.30). Le SDK en ajoutait
  // deux de plus par tentative, et un délai de 45 s devenait 135 s.
  const client = new Anthropic({ apiKey, timeout: cfg.request_timeout_ms, maxRetries: 0 })

  // AUCUN OUTIL (recette du 01/10/2026). La recherche web n'existait que pour LinkedIn,
  // qui bloque les robots : chaque recherche était PAYÉE (§D.24, facturée à la recherche)
  // pour un échec certain, puis comptée contre l'expert. Sans outil : ni recherche, ni tour
  // mis en pause à reprendre.
  const message = await client.messages.create({
    model,
    max_tokens: cfg.max_tokens,
    messages: [{ role: 'user', content: prompt }],
  })
  // Poussé dans `usages` AU MOMENT où l'appel est payé, avant même qu'on sache si sa
  // réponse est lisible ; au tarif de `model` — le repli n'a pas le même prix.
  usages.push(consommationJetons(model, message.usage))

  return {
    json: safeParseJson(extractText(message.content as unknown)),
    raw: message,
    model_used: model,
    web_search_used: false,
  }
}

export async function runExpertCoherenceCheck(
  input: ExpertVerificationInput,
  cfg: ExpertVerificationConfig,
): Promise<ExpertVerificationOutput> {
  const prompt = buildPrompt(input)
  const usages: ConsommationIA[] = []
  // LA CAUSE du dernier échec, NOMMÉE : l'exécutant rejoue une panne de passage, il défère le reste.
  let echec: CauseEchecModele = 'reponse_illisible'

  const tentatives: Array<{ model: string; etiquette: string }> = [
    { model: cfg.model, etiquette: 'principal' },
    { model: cfg.fallback_model, etiquette: 'repli' },
  ]
  for (const t of tentatives) {
    try {
      const out = await callClaude(t.model, prompt, cfg, usages)
      if (out.json) return shapeOutput(out, cfg, usages)
      echec = 'reponse_illisible'
      console.warn('[ai-expert-verification] réponse illisible', { tentative: t.etiquette })
    } catch (err) {
      echec = causeEchecModele(err)
      console.warn('[ai-expert-verification] appel en échec', { tentative: t.etiquette, cause: echec, message: err instanceof Error ? err.message : String(err) })
      // Une clé absente ou refusée ne se répare pas en changeant de modèle.
      if (echec === 'configuration') break
    }
  }

  // Aucune tentative n'a rendu de verdict lisible : result='error', AVEC sa cause. L'exécutant
  // rejoue une panne de passage (plus tard, sans rien coûter à l'expert) et défère le reste à un humain.
  return {
    result: 'error',
    provider_name: PROVIDER_NAME,
    model_used: cfg.fallback_model,
    confidence_score: 0,
    notes: '',
    discrepancies: [],
    flags: [],
    web_search_used: false,
    raw_response: null,
    usages,
    echec,
  }
}

function shapeOutput(
  parsed: { json: ClaudeJson | null; raw: unknown; model_used: string; web_search_used: boolean },
  cfg: ExpertVerificationConfig,
  usages: ConsommationIA[],
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
    usages,
    result: 'ok',
    provider_name: PROVIDER_NAME,
    model_used: parsed.model_used,
    confidence_score: score,
    notes: typeof j.notes === 'string' ? j.notes.slice(0, 1500) : '',
    discrepancies,
    flags,
    web_search_used: false,
    raw_response: parsed.raw,
  }
}
