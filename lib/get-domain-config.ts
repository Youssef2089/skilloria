// lib/get-domain-config.ts
import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { defaultDomainConfig, resolveAccentColor, type DomainConfig } from './domain-config'
import { loadTranslations, tBDD } from './translations'
import type { Locale } from '@/i18n/routing'
import { routing } from '@/i18n/routing'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Variables Supabase manquantes (URL ou SERVICE_ROLE_KEY)')
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

type DomainRow = {
  id: string
  slug: string
  name: string
  description: string | null
  tagline: string | null
  active: boolean
  domain_configs: {
    id: string
    logo_url: string | null
    favicon_url: string | null
    primary_color: string
    secondary_color: string
    tags: string[]
    featured_products: Array<{ label: string; icon: string }>
    ecosystem_expert_label: string
    ecosystem_community_label: string
    ecosystem_speciality_label: string
    ecosystem_domain_search_label: string
  } | null
}

/**
 * Lit l'override d'accent sans jamais casser si la colonne n'existe pas encore.
 *
 * La migration 20260710000001 est additive et peut ne pas être appliquée dans un
 * environnement donné ; la sélection imbriquée `domain_configs (*)` renvoie alors
 * simplement une ligne sans `accent_color`, et l'accent est dérivé de la couleur
 * primaire. Aucune requête supplémentaire, aucune erreur PostgREST.
 */
function readAccentOverride(config: unknown): string | null {
  const value = (config as { accent_color?: unknown } | null)?.accent_color
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

async function mapRowToDomainConfig(row: DomainRow, locale: Locale): Promise<DomainConfig> {
  const cfg = row.domain_configs
  const translations = await loadTranslations(locale)

  if (!cfg) {
    return {
      ...defaultDomainConfig,
      id: row.id,
      subdomain: row.slug,
      name: tBDD(translations, 'domains', row.id, 'name', row.name),
      tagline: tBDD(translations, 'domains', row.id, 'tagline', row.tagline ?? defaultDomainConfig.tagline),
      isActive: row.active,
    }
  }

  return {
    id: row.id,
    subdomain: row.slug,
    name: tBDD(translations, 'domains', row.id, 'name', row.name),
    ecosystemName: tBDD(translations, 'domains', row.id, 'ecosystem_name', row.name),
    tagline: tBDD(translations, 'domains', row.id, 'tagline', row.tagline ?? ''),
    primaryColor: cfg.primary_color,
    secondaryColor: cfg.secondary_color,
    accentColor: resolveAccentColor(cfg.primary_color, readAccentOverride(cfg)),
    logoUrl: cfg.logo_url,
    faviconUrl: cfg.favicon_url,
    isActive: row.active,
    tags: cfg.tags ?? [],
    featuredProducts: cfg.featured_products ?? [],
    ecosystemTerms: {
      expertLabel: tBDD(translations, 'domain_configs', cfg.id, 'ecosystem_expert_label', cfg.ecosystem_expert_label),
      communityLabel: tBDD(translations, 'domain_configs', cfg.id, 'ecosystem_community_label', cfg.ecosystem_community_label),
      specialityLabel: tBDD(translations, 'domain_configs', cfg.id, 'ecosystem_speciality_label', cfg.ecosystem_speciality_label),
      domainSearchLabel: tBDD(translations, 'domain_configs', cfg.id, 'ecosystem_domain_search_label', cfg.ecosystem_domain_search_label),
    },
  }
}

function normalizeLocale(locale?: string): Locale {
  return (routing.locales as readonly string[]).includes(locale ?? '')
    ? (locale as Locale)
    : routing.defaultLocale
}

export async function getDomainConfig(locale?: string): Promise<DomainConfig> {
  const resolvedLocale = normalizeLocale(locale)

  let slug: string
  try {
    const h = await headers()
    slug = h.get('x-subdomain') ?? defaultDomainConfig.subdomain
  } catch {
    return defaultDomainConfig
  }

  try {
    const supabase = getSupabaseAdmin()

    // `domain_configs (*)` plutôt qu'une liste explicite : la sélection reste
    // valide que la migration 20260710000001 (accent_color) soit appliquée ou
    // non. Une liste nommant accent_color ferait échouer la requête entière
    // avant migration, et la page publique retomberait sur le domaine par défaut.
    const { data, error } = await supabase
      .from('domains')
      .select(`
        id, slug, name, description, tagline, active,
        domain_configs (*)
      `)
      .eq('slug', slug)
      .eq('active', true)
      .maybeSingle()

    if (error) {
      console.error('[getDomainConfig] Supabase error:', error.message)
      return defaultDomainConfig
    }

    if (!data) {
      console.warn(`[getDomainConfig] Domaine inconnu pour slug="${slug}", fallback utilisé`)
      return defaultDomainConfig
    }

    const row: DomainRow = {
      ...data,
      domain_configs: Array.isArray(data.domain_configs)
        ? (data.domain_configs[0] ?? null)
        : data.domain_configs,
    }

    return await mapRowToDomainConfig(row, resolvedLocale)
  } catch (err) {
    console.error('[getDomainConfig] Exception, fallback utilisé:', err)
    return defaultDomainConfig
  }
}
