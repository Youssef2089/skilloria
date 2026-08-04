// lib/home-ecosystem.ts
//
// D4 — Les pastilles « L'écosystème … en profondeur » de la page d'accueil
// dérivent désormais de la TAXONOMIE RÉELLE (branches + spécialités), source
// unique de vérité partagée avec le profil expert, la publication et le matching.
// Fini les `domain_configs.featured_products` (paire {label, icon} dont le champ
// `icon` contenait un code, d'où le doublon « copilot Copilot ») : cette section
// ne les consomme plus (colonnes conservées en base, mais plus lues ici).
//
// Chargement côté serveur (bon SEO, pas de flash), traduit via public.translations
// (tBDD, repli FR), scopé au domaine servi — donc multi-écosystème par construction.

import { createClient } from '@supabase/supabase-js'
import { loadTranslations, tBDD } from './translations'
import { routing, type Locale } from '@/i18n/routing'

/** Une branche de l'écosystème et ses spécialités, prêtes à afficher. */
export type EcosystemBranch = {
  id: string
  label: string
  specialities: string[]
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function normalizeLocale(locale?: string): Locale {
  return (routing.locales as readonly string[]).includes(locale ?? '')
    ? (locale as Locale)
    : routing.defaultLocale
}

/**
 * Branches actives du domaine + leurs spécialités actives, triées par sort_order,
 * libellés traduits. Fail-safe : renvoie [] sur toute erreur (la section se masque
 * alors d'elle-même), jamais d'exception qui casserait la page d'accueil.
 */
export async function loadHomeEcosystem(
  domainId: string | undefined | null,
  locale?: string,
): Promise<EcosystemBranch[]> {
  if (!domainId) return []

  const supabase = getSupabaseAdmin()
  if (!supabase) return []

  try {
    const resolvedLocale = normalizeLocale(locale)
    const translations = await loadTranslations(resolvedLocale)

    const [branchesRes, specialitiesRes] = await Promise.all([
      supabase
        .from('branches')
        .select('id, name, sort_order')
        .eq('domain_id', domainId)
        .eq('active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('specialities')
        .select('id, name, branch_id, sort_order')
        .eq('domain_id', domainId)
        .eq('active', true)
        .order('sort_order', { ascending: true }),
    ])

    if (branchesRes.error || !branchesRes.data) return []

    const specialities = specialitiesRes.data ?? []

    return branchesRes.data.map(branch => ({
      id: branch.id,
      label: tBDD(translations, 'branches', branch.id, 'name', branch.name),
      specialities: specialities
        .filter(s => s.branch_id === branch.id)
        .map(s => tBDD(translations, 'specialities', s.id, 'name', s.name)),
    }))
  } catch (err) {
    console.error('[loadHomeEcosystem] exception, section masquée:', err)
    return []
  }
}
