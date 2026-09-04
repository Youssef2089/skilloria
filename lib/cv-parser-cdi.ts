import Anthropic from '@anthropic-ai/sdk'

// =============================================================================
// CV Parser — Variant CDI
// =============================================================================
// Variant du parser freelance dédié aux candidats CDI.
// Différences notables vs cv-parser.ts :
//   - PAS de tjm_min / tjm_max → remplacé par cdi_salary_min / cdi_salary_max /
//     cdi_variable_pct (salaire annuel brut, % variable)
//   - Détection optionnelle de cdi_status / cdi_notice_period si le CV mentionne
//     "Cherche un CDI", "Open to opportunities", "Préavis de X mois", etc.
//   - Détection cdi_career_goals / cdi_motivations depuis sections explicites
//     ("Objectifs", "Looking for", "Motivations", "Why a change")
//
// TODO post-merge V1+V3 : factoriser le ToolBuilder et le system prompt
// commun entre cv-parser.ts et cv-parser-cdi.ts (~150 LOC dupliquées).
// =============================================================================

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

export type ParsedCdiCV = {
  title: string | null
  summary: string | null
  /** Niveaux que le CV ÉTABLIT, jamais ceux que la personne pourrait accepter. */
  seniorities: Array<'junior' | 'confirmed' | 'senior' | 'expert'>
  years_experience: number | null
  skills: string[]
  certifications: Array<{ name: string; issuer: string | null; year: number | null }>
  branch_slug: string | null
  /** Toutes celles que le parcours démontre réellement. */
  speciality_slugs: string[]
  languages: string[]
  location: string | null
  // CDI-specific (instead of TJM)
  cdi_status: 'employed' | 'open_to_work' | null
  cdi_notice_period: 'immediate' | '1_month' | '2_months' | '3_months' | 'negotiable' | null
  cdi_salary_min: number | null
  cdi_salary_max: number | null
  cdi_variable_pct: number | null
  cdi_career_goals: string | null
  cdi_motivations: string | null
  // Common
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

export type ParseCdiResult =
  | { success: true; data: ParsedCdiCV }
  | { success: false; error: string }

const MODEL = 'claude-haiku-4-5-20251001'
const TIMEOUT_MS = 30_000
const MAX_TOKENS = 8192

function buildToolCdi(ctx: DomainContext) {
  return {
    name: 'record_cdi_cv',
    description:
      "Record the structured data extracted from a CDI candidate CV. Use null or [] when a field is unknown. This candidate is looking for a permanent employment contract — do NOT extract daily rates (TJM).",
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
            "Niveaux que le parcours ÉTABLIT (un, ou deux à la charnière). Jamais un élargissement vers le bas : ce choix appartient à la personne.",
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
        // CDI-specific fields
        cdi_status: {
          type: ['string', 'null'],
          enum: ['employed', 'open_to_work', null],
          description:
            'Disposition du candidat. employed = Ne pas déranger (en poste, ne cherche pas), open_to_work = à l\'écoute / en recherche. Déduis depuis "Looking for", "Cherche un CDI", "Open to opportunities", "Currently employed", "Actively seeking", etc. null si non déductible. Si le candidat est clairement en recherche active, mapper sur open_to_work (V1 : 2 états seulement).',
        },
        cdi_notice_period: {
          type: ['string', 'null'],
          enum: ['immediate', '1_month', '2_months', '3_months', 'negotiable', null],
          description:
            "Préavis. Déduis depuis 'Préavis de X mois', 'Notice period: X', 'Available immediately'. null si non mentionné.",
        },
        cdi_salary_min: {
          type: ['number', 'null'],
          description:
            'Salaire annuel brut min en euros (entier). Déduis depuis "60k€", "70-80K€/an", "salary expectations". null si non mentionné.',
        },
        cdi_salary_max: {
          type: ['number', 'null'],
          description: 'Salaire annuel brut max en euros (entier). null si non mentionné.',
        },
        cdi_variable_pct: {
          type: ['number', 'null'],
          description:
            'Variable / bonus en % du fixe (entier 0-100). Déduis depuis "10% bonus", "variable 15%". null si non mentionné.',
        },
        cdi_career_goals: {
          type: ['string', 'null'],
          description:
            "Objectifs de carrière publics du candidat. Extrait depuis sections 'Objectifs', 'Career goals', 'Looking for', 'What I'm looking for'. Texte libre 1-3 phrases. null si pas de section dédiée.",
        },
        cdi_motivations: {
          type: ['string', 'null'],
          description:
            "Motivations privées du candidat (pourquoi changer). Extrait depuis 'Motivations', 'Why a change', 'Pourquoi je change'. Texte libre. null si pas de section dédiée.",
        },
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
                description: "Nom de l'employeur pour une entrée 'career'. null pour 'project'.",
              },
              client_name: {
                type: ['string', 'null'],
                description: "Nom du client pour une entrée 'project'. null pour 'career'.",
              },
              sector: {
                type: ['string', 'null'],
                description: "Secteur d'activité pour 'project'. null pour 'career'.",
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
        'languages', 'location',
        'cdi_status', 'cdi_notice_period',
        'cdi_salary_min', 'cdi_salary_max', 'cdi_variable_pct',
        'cdi_career_goals', 'cdi_motivations',
        'linkedin_url', 'phone', 'address_line', 'postal_code', 'city', 'country',
        'birth_year', 'photo_url', 'years_total_experience',
        'work_modes', 'experiences', 'educations', 'languages_structured',
      ],
    },
  }
}

function buildSystemPromptCdi(ctx: DomainContext): string {
  return [
    "Tu es un analyste qui extrait des informations structurées d'un CV PDF pour la marketplace Skilloria.",
    'Le candidat cherche un emploi en CDI (contrat à durée indéterminée). Il est SALARIÉ, pas freelance.',
    'NE PAS extraire de TJM (tarif journalier) — ce n\'est pas pertinent pour un CDI.',
    'Langue cible : français.',
    "Tu DOIS appeler l'outil `record_cdi_cv` avec un JSON strict. Ne renvoie jamais de texte libre.",
    `Normalise les compétences contre la liste suivante quand c'est possible : ${ctx.tags.join(', ')}.`,
    `La branche doit être l'un des slugs suivants (sinon null) : ${ctx.branches.join(', ')}.`,
    `Les spécialités doivent être des slugs de cette liste : ${ctx.specialities.join(', ')}.`,
    'Pour les champs inconnus, renvoie null (ou [] pour les listes).',
    '',
    'CHAMPS MULTIPLES — et les deux ne se déduisent PAS de la même façon.',
    '',
    "SPÉCIALITÉS (`speciality_slugs`) : un CV en montre souvent PLUSIEURS, et c'est un FAIT qu'on lit, pas une préférence qu'on suppose. Retiens TOUTES celles que le parcours démontre réellement — postes, projets, certifications à l'appui. N'en ajoute aucune que le CV ne prouve pas : une spécialité inventée fera proposer à cette personne des postes qu'elle ne sait pas tenir.",
    '',
    "SÉNIORITÉS (`seniorities`) : ici la prudence est INVERSE. Un CV démontre un NIVEAU ATTEINT ; il ne dit rien de ce que la personne ACCEPTE. Retiens uniquement le ou les niveaux que le parcours établit — deux seulement si l'expérience est franchement à la charnière. N'ÉLARGIS JAMAIS vers le bas : ce choix appartient à la personne, et l'écran le lui demandera.",
    '',
    "ZONES DE TRAVAIL : ne les déduis PAS. Un CV dit où quelqu'un a TRAVAILLÉ, jamais où il ACCEPTE de travailler. Le schéma ne prévoit aucun champ pour cela — c'est délibéré.",
    '',
    'Extrais TOUTES les expériences professionnelles du CV en deux catégories :',
    '',
    "1. CARRIÈRE (experience_type='career') : l'historique d'emploi par employeur. Pour chaque ligne d'employeur :",
    "- role : intitulé du poste",
    "- employer : nom de l'employeur",
    '- client_name : null',
    '- sector : null',
    '- dates précises au format YYYY-MM-DD (1er du mois si jour inconnu), end_date null si actuel',
    '- description : phrase ou paragraphe de synthèse',
    '',
    "2. PROJETS / MISSIONS (experience_type='project') : missions concrètes par client. Pour chaque mission :",
    "- role : rôle exact",
    '- employer : null',
    "- client_name : nom du client si mentionné, sinon 'Confidentiel'",
    "- sector : secteur d'activité",
    '- dates précises au format YYYY-MM-DD',
    "- description : PARAGRAPHE RICHE ET DÉTAILLÉ regroupant le périmètre, responsabilités, livrables, technologies, contexte. 3-8 phrases en français, lisibles, sans listes à puces.",
    '',
    'Règle commune : `is_current=true` si et seulement si `end_date` est null.',
    '',
    'Extrais TOUTES les formations : école, diplôme, domaine, années, lieu.',
    '',
    'Pour les langues, déduis le niveau CEFR ("A1", "A2", "B1", "B2", "C1", "C2") ou "native" pour la langue maternelle. `is_primary=true` pour la langue maternelle si déductible.',
    '',
    "Pour `years_total_experience`, somme intelligente des durées d'expériences en ignorant les chevauchements.",
    '',
    "Pour `birth_year` : déduis depuis l'âge mentionné, sinon null.",
    '',
    'Pour `country` : code ISO 3166-1 alpha-2 (FR, BE, CH, LU, CA…). Null si non déductible.',
    '',
    "Pour `work_modes` : déduis les modes de travail acceptés (remote, onsite, hybrid). [] si rien n'est mentionné.",
    '',
    "Pour `photo_url` : uniquement si un lien URL externe vers une photo est présent dans le CV (LinkedIn, GitHub…), sinon null.",
    '',
    '── CHAMPS SPÉCIFIQUES CDI ──',
    '',
    "Pour `cdi_status` : déduis depuis le CV.",
    "  • 'employed' si le candidat est clairement en poste et ne cherche pas activement",
    "  • 'open_to_work' s'il mentionne 'Open to opportunities', 'À l'écoute du marché', 'Considering offers'",
    "  • 'actively_searching' s'il mentionne 'Actively seeking', 'Cherche un CDI', 'Currently looking', 'En recherche active'",
    "  • null si rien de déductible",
    '',
    "Pour `cdi_notice_period` : déduis depuis 'Préavis de X mois', 'Notice period', 'Available immediately'.",
    "  • 'immediate', '1_month', '2_months', '3_months', 'negotiable'",
    "  • null si non mentionné",
    '',
    "Pour `cdi_salary_min` / `cdi_salary_max` : SALAIRE ANNUEL BRUT EN EUROS (entiers). Exemples :",
    "  • '60-80K€/an' → cdi_salary_min=60000, cdi_salary_max=80000",
    "  • 'Around 75K€' → cdi_salary_min=70000, cdi_salary_max=80000 (estime fourchette ±5K)",
    "  • Pas de mention de salaire → les deux à null",
    "  • Convertis automatiquement depuis K€, k€ vers euros entiers",
    '',
    "Pour `cdi_variable_pct` : pourcentage de variable/bonus du salaire fixe (0-100). Exemples :",
    "  • 'Variable 15%' → 15",
    "  • '10% bonus' → 10",
    "  • Pas de mention → null",
    '',
    "Pour `cdi_career_goals` : extrait UNIQUEMENT s'il existe une section explicite 'Objectifs', 'Career goals', 'Looking for', 'What I'm looking for', 'Aspirations professionnelles'. Texte libre 1-3 phrases en français. null si pas de section dédiée — N'INVENTE PAS.",
    '',
    "Pour `cdi_motivations` : extrait UNIQUEMENT s'il existe une section explicite 'Motivations', 'Why a change', 'Pourquoi je change', 'Reasons for leaving'. Texte libre. null si pas de section dédiée — N'INVENTE PAS.",
  ].join('\n')
}

async function callAnthropicCdi(
  client: Anthropic,
  pdfBase64: string,
  ctx: DomainContext,
  signal: AbortSignal,
): Promise<ParsedCdiCV> {
  const tool = buildToolCdi(ctx)

  const response = await client.messages.create(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildSystemPromptCdi(ctx),
      tools: [tool],
      tool_choice: { type: 'tool', name: 'record_cdi_cv' },
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
              text: 'Extrais les données structurées de ce CV de candidat CDI et appelle record_cdi_cv.',
            },
          ],
        },
      ],
    },
    { signal },
  )

  const toolUse = response.content.find(
    (b: any) => b.type === 'tool_use' && b.name === 'record_cdi_cv',
  ) as { input: ParsedCdiCV } | undefined

  if (!toolUse) {
    throw new Error("Le modèle n'a pas renvoyé d'appel à record_cdi_cv")
  }
  return toolUse.input
}

export async function parseCdiCV(
  pdfBuffer: Buffer,
  ctx: DomainContext,
): Promise<ParseCdiResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[cv-parser-cdi] ANTHROPIC_API_KEY manquante')
    return { success: false, error: 'AI provider not configured' }
  }

  const client = new Anthropic({ apiKey })
  const pdfBase64 = pdfBuffer.toString('base64')

  const attempt = async (): Promise<ParsedCdiCV> => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      return await callAnthropicCdi(client, pdfBase64, ctx, ctrl.signal)
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
      console.error('[cv-parser-cdi] parse failed (no retry)', msg)
      return { success: false, error: msg }
    }
    console.warn('[cv-parser-cdi] network error, retrying once:', msg)
    try {
      return { success: true, data: await attempt() }
    } catch (err2) {
      const msg2 = err2 instanceof Error ? err2.message : String(err2)
      console.error('[cv-parser-cdi] parse failed after retry', msg2)
      return { success: false, error: msg2 }
    }
  }
}
