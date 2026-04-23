import Anthropic from '@anthropic-ai/sdk'

export type DomainContext = {
  tags: string[]
  branches: string[]
  specialities: string[]
}

export type ParsedCV = {
  title: string | null
  summary: string | null
  seniority: 'junior' | 'confirmed' | 'senior' | 'expert' | null
  years_experience: number | null
  skills: string[]
  certifications: Array<{ name: string; issuer: string | null; year: number | null }>
  branch_slug: string | null
  speciality_slug: string | null
  languages: string[]
  location: string | null
  tjm_min: number | null
  tjm_max: number | null
  linkedin_url: string | null
}

export type ParseResult =
  | { success: true; data: ParsedCV }
  | { success: false; error: string }

const MODEL = 'claude-haiku-4-5-20251001'
const TIMEOUT_MS = 30_000
const MAX_TOKENS = 4096

function buildTool(ctx: DomainContext) {
  return {
    name: 'record_cv',
    description:
      'Record the structured data extracted from the candidate CV. Use null or [] when a field is unknown.',
    input_schema: {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        title: { type: ['string', 'null'] },
        summary: { type: ['string', 'null'] },
        seniority: {
          type: ['string', 'null'],
          enum: ['junior', 'confirmed', 'senior', 'expert', null],
        },
        years_experience: { type: ['number', 'null'] },
        skills: {
          type: 'array',
          items: { type: 'string' },
          description: `Compétences, normalisées contre : ${ctx.tags.join(', ')}.`,
        },
        certifications: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              issuer: { type: ['string', 'null'] },
              year: { type: ['number', 'null'] },
            },
            required: ['name', 'issuer', 'year'],
          },
        },
        branch_slug: {
          type: ['string', 'null'],
          description: `Un parmi : ${ctx.branches.join(', ')} (null si inconnu).`,
        },
        speciality_slug: {
          type: ['string', 'null'],
          description: `Un parmi : ${ctx.specialities.join(', ')} (null si inconnu).`,
        },
        languages: { type: 'array', items: { type: 'string' } },
        location: { type: ['string', 'null'] },
        tjm_min: { type: ['number', 'null'] },
        tjm_max: { type: ['number', 'null'] },
        linkedin_url: { type: ['string', 'null'] },
      },
      required: [
        'title', 'summary', 'seniority', 'years_experience',
        'skills', 'certifications',
        'branch_slug', 'speciality_slug',
        'languages', 'location', 'tjm_min', 'tjm_max', 'linkedin_url',
      ],
    },
  }
}

function buildSystemPrompt(ctx: DomainContext): string {
  return [
    "Tu es un analyste qui extrait des informations structurées d'un CV PDF pour la marketplace Skilloria.",
    'Langue cible : français.',
    'Tu DOIS appeler l\'outil `record_cv` avec un JSON strict. Ne renvoie jamais de texte libre.',
    `Normalise les compétences contre la liste suivante quand c'est possible : ${ctx.tags.join(', ')}.`,
    `La branche doit être l'un des slugs suivants (sinon null) : ${ctx.branches.join(', ')}.`,
    `La spécialité doit être l'un des slugs suivants (sinon null) : ${ctx.specialities.join(', ')}.`,
    'Pour les champs inconnus, renvoie null (ou [] pour les listes).',
  ].join('\n')
}

async function callAnthropic(
  client: Anthropic,
  pdfBase64: string,
  ctx: DomainContext,
  signal: AbortSignal,
): Promise<ParsedCV> {
  const tool = buildTool(ctx)

  const response = await client.messages.create(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(ctx),
      tools: [tool],
      tool_choice: { type: 'tool', name: 'record_cv' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: 'Extrais les données structurées de ce CV et appelle record_cv.',
            },
          ],
        },
      ],
    },
    { signal },
  )

  const toolUse = response.content.find(
    (b: any) => b.type === 'tool_use' && b.name === 'record_cv',
  ) as { input: ParsedCV } | undefined

  if (!toolUse) {
    throw new Error('Le modèle n\'a pas renvoyé d\'appel à record_cv')
  }
  return toolUse.input
}

export async function parseCV(
  pdfBuffer: Buffer,
  ctx: DomainContext,
): Promise<ParseResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[cv-parser] ANTHROPIC_API_KEY manquante')
    return { success: false, error: 'AI provider not configured' }
  }

  const client = new Anthropic({ apiKey })
  const pdfBase64 = pdfBuffer.toString('base64')

  const attempt = async (): Promise<ParsedCV> => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      return await callAnthropic(client, pdfBase64, ctx, ctrl.signal)
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    return { success: true, data: await attempt() }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isNetwork = /network|fetch|timeout|abort|ECONN|EAI|socket/i.test(msg)
    if (!isNetwork) {
      console.error('[cv-parser] parse failed (no retry)', msg)
      return { success: false, error: msg }
    }
    console.warn('[cv-parser] network error, retrying once:', msg)
    try {
      return { success: true, data: await attempt() }
    } catch (err2) {
      const msg2 = err2 instanceof Error ? err2.message : String(err2)
      console.error('[cv-parser] parse failed after retry', msg2)
      return { success: false, error: msg2 }
    }
  }
}
