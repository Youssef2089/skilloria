// lib/get-domain-config.ts
import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { defaultDomainConfig, type DomainConfig } from './domain-config'

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

function mapRowToDomainConfig(row: DomainRow): DomainConfig {
  const cfg = row.domain_configs

  if (!cfg) {
    return {
      ...defaultDomainConfig,
      id: row.id,
      subdomain: row.slug,
      name: row.name,
      tagline: row.tagline ?? defaultDomainConfig.tagline,
      isActive: row.active,
    }
  }

  return {
    id: row.id,
    subdomain: row.slug,
    name: row.name,
    ecosystemName: row.name,
    tagline: row.tagline ?? '',
    primaryColor: cfg.primary_color,
    secondaryColor: cfg.secondary_color,
    logoUrl: cfg.logo_url,
    faviconUrl: cfg.favicon_url,
    isActive: row.active,
    tags: cfg.tags ?? [],
    featuredProducts: cfg.featured_products ?? [],
    ecosystemTerms: {
      expertLabel: cfg.ecosystem_expert_label,
      communityLabel: cfg.ecosystem_community_label,
      specialityLabel: cfg.ecosystem_speciality_label,
      domainSearchLabel: cfg.ecosystem_domain_search_label,
    },
  }
}

export async function getDomainConfig(): Promise<DomainConfig> {
  let slug: string
  try {
    const h = await headers()
    slug = h.get('x-subdomain') ?? defaultDomainConfig.subdomain
  } catch {
    return defaultDomainConfig
  }

  try {
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('domains')
      .select(`
        id, slug, name, description, tagline, active,
        domain_configs (
          logo_url, favicon_url,
          primary_color, secondary_color,
          tags, featured_products,
          ecosystem_expert_label,
          ecosystem_community_label,
          ecosystem_speciality_label,
          ecosystem_domain_search_label
        )
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

    return mapRowToDomainConfig(row)
  } catch (err) {
    console.error('[getDomainConfig] Exception, fallback utilisé:', err)
    return defaultDomainConfig
  }
}
