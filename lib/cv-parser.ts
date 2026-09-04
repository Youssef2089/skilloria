import Anthropic from '@anthropic-ai/sdk'

export type DomainContext = {
  tags: string[]
  branches: string[]
  specialities: string[]
}

export type ParsedExperience = {
  experience_type: 'career' | 'project'
  role: string
  employer: string | null
  client_name: string | null
  sector: string | null
  start_date: string
  end_date: string | null
  is_current: boolean
  description: string | null
}

export type ParsedEducation = {
  school: string
  degree: string
  field: string | null
  start_year: number | null
  end_year: number | null
  location: string | null
}

export type ParsedLanguageStructured = {
  language: string
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'native'
  is_primary: boolean
}

export type ParsedCV = {
  title: string | null
  summary: string | null
  /**
   * SÉNIORITÉS — les niveaux que le CV ÉTABLIT, jamais ceux que la personne
   * pourrait accepter. Cette nuance est écrite dans le prompt : l'élargir
   * reviendrait à décider à sa place.
   */
  seniorities: Array<'junior' | 'confirmed' | 'senior' | 'expert'>
  years_experience: number | null
  skills: string[]
  certifications: Array<{ name: string; issuer: string | null; year: number | null }>
  branch_slug: string | null
  /** SPÉCIALITÉS — toutes celles que le parcours démontre réellement. */
  speciality_slugs: string[]
  languages: string[]
  location: string | null
  tjm_min: number | null
  tjm_max: number | null
  linkedin_url: string | null
  phone: string | null
  address_line: string | null
  postal_code: string | null
  city: string | null
  country: string | null
  birth_year: number | null
  photo_url: string | null
  years_total_experience: number | null
  work_modes: Array<'remote' | 'onsite' | 'hybrid'>
  experiences: ParsedExperience[]
  educations: ParsedEducation[]
  languages_structured: ParsedLanguageStructured[]
}

export type ParseResult =
  | { success: true; data: ParsedCV }
  | { success: false; error: string }

const MODEL = 'claude-haiku-4-5-20251001'
const TIMEOUT_MS = 30_000
const MAX_TOKENS = 8192

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
        seniorities: {
          type: 'array',
          items: { type: 'string', enum: ['junior', 'confirmed', 'senior', 'expert'] },
          description:
            "Niveaux que le parcours ÉTABLIT (un, ou deux si l'expérience est à la charnière). Jamais un élargissement vers le bas : ce choix appartient à la personne.",
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
        speciality_slugs: {
          type: 'array',
          items: { type: 'string' },
          description: `Toutes celles que le parcours démontre, parmi : ${ctx.specialities.join(', ')}. [] si aucune n'est établie.`,
        },
        languages: { type: 'array', items: { type: 'string' } },
        location: { type: ['string', 'null'] },
        tjm_min: { type: ['number', 'null'] },
        tjm_max: { type: ['number', 'null'] },
        linkedin_url: { type: ['string', 'null'] },
        phone: { type: ['string', 'null'] },
        address_line: { type: ['string', 'null'] },
        postal_code: { type: ['string', 'null'] },
        city: { type: ['string', 'null'] },
        country: {
          type: ['string', 'null'],
          description: 'Code ISO 3166-1 alpha-2 (FR, BE, CH, LU, GB, US, CA, MA, TN, DZ, AE…).',
        },
        birth_year: { type: ['number', 'null'] },
        photo_url: { type: ['string', 'null'] },
        years_total_experience: { type: ['number', 'null'] },
        work_modes: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['remote', 'onsite', 'hybrid'],
          },
          description:
            'Modes de travail acceptés (plusieurs possibles). Valeurs : remote, onsite, hybrid.',
        },
        experiences: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              experience_type: {
                type: 'string',
                enum: ['career', 'project'],
                description:
                  "'career' pour une entrée d'historique d'emploi (par employeur). 'project' pour une mission / projet concret par client.",
              },
              role: { type: 'string' },
              employer: {
                type: ['string', 'null'],
                description: "Nom de l'employeur pour une entrée 'career' (ex: 'Prodware'). null pour 'project'.",
              },
              client_name: {
                type: ['string', 'null'],
                description: "Nom du client pour une entrée 'project' (ou 'Confidentiel'). null pour 'career'.",
              },
              sector: {
                type: ['string', 'null'],
                description: "Secteur d'activité du client pour 'project'. null pour 'career'.",
              },
              start_date: {
                type: 'string',
                description: 'Format YYYY-MM-DD (1er du mois si jour inconnu).',
              },
              end_date: {
                type: ['string', 'null'],
                description: 'Format YYYY-MM-DD, ou null si en cours.',
              },
              is_current: { type: 'boolean' },
              description: { type: ['string', 'null'] },
            },
            required: [
              'experience_type', 'role', 'employer', 'client_name', 'sector',
              'start_date', 'end_date', 'is_current', 'description',
            ],
          },
        },
        educations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              school: { type: 'string' },
              degree: { type: 'string' },
              field: { type: ['string', 'null'] },
              start_year: { type: ['number', 'null'] },
              end_year: { type: ['number', 'null'] },
              location: { type: ['string', 'null'] },
            },
            required: ['school', 'degree', 'field', 'start_year', 'end_year', 'location'],
          },
        },
        languages_structured: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              language: { type: 'string' },
              level: {
                type: 'string',
                enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'],
              },
              is_primary: { type: 'boolean' },
            },
            required: ['language', 'level', 'is_primary'],
          },
        },
      },
      required: [
        'title', 'summary', 'seniorities', 'years_experience',
        'skills', 'certifications',
        'branch_slug', 'speciality_slugs',
        'languages', 'location', 'tjm_min', 'tjm_max', 'linkedin_url',
        'phone', 'address_line', 'postal_code', 'city', 'country',
        'birth_year', 'photo_url', 'years_total_experience',
        'work_modes', 'experiences', 'educations', 'languages_structured',
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
    `Les spécialités doivent être des slugs de cette liste : ${ctx.specialities.join(', ')}.`,
    'Pour les champs inconnus, renvoie null (ou [] pour les listes).',
    '',
    'CHAMPS MULTIPLES — et les deux ne se déduisent PAS de la même façon.',
    '',
    "SPÉCIALITÉS (`speciality_slugs`) : un CV en montre souvent PLUSIEURS, et c'est un FAIT qu'on lit, pas une préférence qu'on suppose. Un consultant qui a mené des projets Finance ET Supply Chain a bien les deux. Retiens TOUTES celles que le parcours démontre réellement — missions, projets, certifications à l'appui. N'en ajoute aucune que le CV ne prouve pas : une spécialité inventée fera proposer à cette personne des missions qu'elle ne sait pas faire.",
    '',
    "SÉNIORITÉS (`seniorities`) : ici la prudence est INVERSE. Un CV démontre un NIVEAU ATTEINT ; il ne dit rien de ce que la personne ACCEPTE. Retiens donc uniquement le ou les niveaux que le parcours établit — deux seulement si l'expérience est franchement à la charnière entre deux (par exemple 7 ans, entre confirmé et senior). N'ÉLARGIS JAMAIS vers le bas en supposant qu'un senior accepterait des missions de junior : c'est un choix qui appartient à la personne, et l'écran le lui demandera.",
    '',
    "ZONES DE TRAVAIL : ne les déduis PAS, et ne les invente sous aucune forme. Un CV dit où quelqu'un a TRAVAILLÉ, jamais où il ACCEPTE de travailler. Le schéma ne prévoit d'ailleurs aucun champ pour cela — c'est délibéré.",
    '',
    'Extrais TOUTES les expériences professionnelles du CV en deux catégories :',
    '',
    "1. CARRIÈRE (experience_type='career') : l'historique d'emploi par employeur. Cherche dans la section 'Career', 'Carrière', 'Experience' synthétique. Pour chaque ligne d'employeur, crée une entrée avec :",
    "- role : intitulé du poste (ex: 'Lead consultant supply chain', 'Architecte solution')",
    "- employer : nom de l'employeur (ex: 'Acme Consulting', 'Nexeo')",
    '- client_name : null',
    '- sector : null',
    '- dates précises au format YYYY-MM-DD (1er du mois si jour inconnu), end_date null si actuel',
    '- description : phrase ou paragraphe de synthèse sur le rôle chez cet employeur',
    '',
    "2. PROJETS / MISSIONS (experience_type='project') : les missions concrètes par client. Cherche dans 'Main Projects', 'Projects', 'Missions'. Pour chaque mission, crée une entrée avec :",
    "- role : rôle exact sur la mission (ex: 'Solution Architect')",
    '- employer : null',
    "- client_name : nom du client si mentionné, sinon 'Confidentiel'",
    "- sector : secteur d'activité du client (ex: 'Agri-food', 'Automotive')",
    '- dates précises au format YYYY-MM-DD',
    "- description : PARAGRAPHE RICHE ET DÉTAILLÉ qui regroupe TOUT le contenu de la mission : périmètre fonctionnel (Area:), responsabilités, tâches réalisées, livrables, technologies utilisées, contexte du projet. Synthétise en 3-8 phrases lisibles, en français, en évitant les listes à puces. Le texte doit être suffisamment riche pour que le matching IA puisse comprendre la nature exacte de la mission.",
    '',
    'Règle commune : `is_current=true` si et seulement si `end_date` est null.',
    '',
    'Extrais TOUTES les formations : école, diplôme, domaine/spécialité, année de début, année de fin, lieu.',
    '',
    'Pour les langues, déduis le niveau CEFR ("A1", "A2", "B1", "B2", "C1", "C2") ou "native" pour la langue maternelle. `is_primary=true` pour la langue maternelle si déductible (une seule langue principale au maximum).',
    '',
    "Pour `years_total_experience`, somme intelligente des durées d'expériences professionnelles en ignorant les chevauchements (si deux expériences se recouvrent, ne compte pas deux fois).",
    '',
    "Pour `birth_year` : déduis depuis l'âge mentionné (année courante − âge) si un âge explicite figure dans le CV, sinon null.",
    '',
    'Pour `country` : code ISO 3166-1 alpha-2 (FR, BE, CH, LU, CA, MA, TN, DZ, GB, US, AE…). Null si non déductible.',
    '',
    "Pour `work_modes` : déduis les modes de travail acceptés (remote, onsite, hybrid — plusieurs possibles, par exemple ['remote', 'hybrid']). Si rien n'est mentionné explicitement, retourne [].",
    '',
    "Pour `photo_url` : uniquement si un lien URL externe vers une photo est présent dans le CV (LinkedIn, GitHub…), sinon null. N'essaye pas d'extraire la photo du PDF lui-même.",
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
