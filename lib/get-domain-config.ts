// lib/get-domain-config.ts
import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { defaultDomainConfig, type DomainConfig } from './domain-config'
import { resolvePalette } from './palette'
import { loadTranslations, tBDD } from './translations'
import {
  ecosystemeFaviconStoragePath,
  ecosystemeLogoStoragePath,
  urlPubliqueEcosysteme,
} from './org-logo'
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
 * ⚠️ `readAccentOverride` A DISPARU ICI, et ce n'est pas une perte : sa lecture
 * tolérante — une colonne qui peut ne pas exister encore — vit désormais dans
 * `resolvePalette`, qui traite les HUIT rôles de la même façon. La sélection
 * imbriquée reste `domain_configs (*)` pour la même raison qu'avant : nommer
 * les colonnes ferait échouer la requête ENTIÈRE sur un environnement où la
 * migration n'est pas passée, et la page publique retomberait sur le domaine
 * par défaut — une panne totale pour une colonne manquante.
 */
async function mapRowToDomainConfig(row: DomainRow, locale: Locale): Promise<DomainConfig> {
  const cfg = row.domain_configs
  const translations = await loadTranslations(locale)
  // Un seul client pour les deux adresses : `getSupabaseAdmin()` construit un
  // client à chaque appel, et `getPublicUrl` ne fait que composer une chaîne.
  const stockage = getSupabaseAdmin()

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

  // LA PALETTE EST RÉSOLUE ICI, AU SERVEUR, ET UNE SEULE FOIS.
  // `accentColor` n'est plus calculée à part : elle EST `palette.boutons`.
  // Deux calculs auraient été deux jumeaux qui divergent (§E.20) — et celui-ci
  // dépend du fond de page de l'écosystème, que seule la palette connaît.
  const palette = resolvePalette(cfg)

  return {
    id: row.id,
    subdomain: row.slug,
    name: tBDD(translations, 'domains', row.id, 'name', row.name),
    ecosystemName: tBDD(translations, 'domains', row.id, 'ecosystem_name', row.name),
    tagline: tBDD(translations, 'domains', row.id, 'tagline', row.tagline ?? ''),
    primaryColor: palette.marque,
    secondaryColor: cfg.secondary_color,
    accentColor: palette.boutons,
    palette,
    // ⚠️ `cfg.logo_url` / `cfg.favicon_url` SONT DES CHEMINS DE STOCKAGE, plus
    //    des adresses (migration 20260916300000). Les servir tels quels
    //    produirait `<img src="<uuid>/logo">` — une adresse relative, donc une
    //    image cassée sur la Navbar, le Footer et les pages légales.
    //
    //    Avant cette migration, c'était pire que cassé : la colonne portait une
    //    URL SAISIE dans /admin/ecosystemes, servie telle quelle à TOUT
    //    VISITEUR, y compris non connecté. Un mouchard à l'échelle du site.
    //
    //    L'adresse est désormais DÉRIVÉE de `domain_id` et pointe vers notre
    //    stockage. Publique et non signée, à dessein : ces pages sont publiques
    //    ET cachées, et une signature de 300 s y serait morte (cf. le
    //    commentaire de `BUCKET_ECOSYSTEME`).
    logoUrl: urlPubliqueEcosysteme(
      stockage,
      ecosystemeLogoStoragePath(row.id),
      cfg.logo_url,
    ),
    faviconUrl: urlPubliqueEcosysteme(
      stockage,
      ecosystemeFaviconStoragePath(row.id),
      cfg.favicon_url,
    ),
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
