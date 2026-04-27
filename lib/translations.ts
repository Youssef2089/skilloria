// lib/translations.ts
// Helper module-level pour résoudre les traductions BDD (table public.translations).
// Pattern : 1 chargement par locale, cache mémoire, fallback FR automatique.

import { createClient } from '@supabase/supabase-js'
import type { Locale } from '@/i18n/routing'

type TranslationKey = string // `${table}.${rowId}.${field}`
export type TranslationsMap = Map<TranslationKey, string>

const cache = new Map<Locale, TranslationsMap>()

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

export async function loadTranslations(locale: Locale): Promise<TranslationsMap> {
  const cached = cache.get(locale)
  if (cached) return cached

  const map: TranslationsMap = new Map()

  try {
    const supabase = getSupabaseAdmin()
    const locales = locale === 'fr' ? ['fr'] : [locale, 'fr']

    const { data, error } = await supabase
      .from('translations')
      .select('table_name, row_id, field, locale, value')
      .in('locale', locales)

    if (error) {
      console.error('[translations] load error:', error.message)
      return map
    }

    // Charger FR d'abord (fallback), puis écraser avec la locale demandée.
    data
      ?.filter(t => t.locale === 'fr')
      .forEach(t => map.set(`${t.table_name}.${t.row_id}.${t.field}`, t.value))

    if (locale !== 'fr') {
      data
        ?.filter(t => t.locale === locale)
        .forEach(t => map.set(`${t.table_name}.${t.row_id}.${t.field}`, t.value))
    }

    cache.set(locale, map)
    return map
  } catch (err) {
    console.error('[translations] exception:', err)
    return map
  }
}

export function tBDD(
  translations: TranslationsMap,
  table: string,
  rowId: string,
  field: string,
  fallback = '',
): string {
  return translations.get(`${table}.${rowId}.${field}`) ?? fallback
}

export function clearTranslationCache(locale?: Locale) {
  if (locale) cache.delete(locale)
  else cache.clear()
}
