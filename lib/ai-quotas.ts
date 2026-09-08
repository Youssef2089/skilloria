import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * lib/ai-quotas.ts — LES QUOTAS ANTI-ABUS DES FONCTIONNALITÉS IA.
 *
 * ┌─ SOURCE UNIQUE, ET AUCUN REPLI ─────────────────────────────────────────┐
 * │ « 3 analyses par 24 h » vivait en dur dans SIX écritures : deux          │
 * │ constantes RATE_LIMIT (freelance et CDI), deux calculs de fenêtre à la   │
 * │ main, et deux fois le chiffre 3 réécrit dans le texte du refus. Relever  │
 * │ le quota supposait un déploiement ; le relever à moitié ne signalait     │
 * │ rien.                                                                    │
 * │                                                                          │
 * │ Ce module est désormais le SEUL endroit qui connaît la valeur, et il ne  │
 * │ l'invente jamais : il la LIT. Ligne absente ou illisible ⇒ il LÈVE.      │
 * │ Un repli à 3 « au cas où » serait un second réglage, invisible, prenant  │
 * │ la main sans que personne le sache — exactement le défaut corrigé.       │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * La FENÊTRE voyage AVEC le nombre : « 3 par 24 h » est un seul réglage à deux
 * valeurs. Un appelant qui obtiendrait l'un sans l'autre pourrait changer le
 * nombre en croyant avoir changé la durée.
 */

/** Un quota lu en base. Les deux valeurs vont ensemble, toujours. */
export type AiQuota = {
  /** Nombre d'opérations autorisées dans la fenêtre. */
  maxPerWindow: number
  /** Durée de la fenêtre glissante, en heures. */
  windowHours: number
}

/** Levée quand le réglage est absent : la route doit répondre 503, pas deviner. */
export class QuotaConfigMissing extends Error {
  readonly code = 'quota_config_missing'
  constructor(quota: string, detail: string) {
    super(`Quota '${quota}' illisible : ${detail}`)
    this.name = 'QuotaConfigMissing'
  }
}

/**
 * Le quota d'analyses de CV, lu en base.
 *
 * Aucune mémoïsation : la lecture est une ligne par clé primaire, et un réglage
 * mis en cache continuerait d'appliquer l'ancienne valeur après une correction
 * au back-office — un administrateur relèverait le quota et ne verrait rien
 * changer, sans savoir pourquoi.
 *
 * @throws {QuotaConfigMissing} si la ligne manque ou si la lecture échoue.
 */
export async function loadCvParsingQuota(admin: SupabaseClient): Promise<AiQuota> {
  const { data, error } = await admin
    .from('ai_quotas')
    .select('max_per_window, window_hours')
    .eq('quota', 'cv_parsing')
    .maybeSingle()

  if (error) throw new QuotaConfigMissing('cv_parsing', error.message)
  if (!data) {
    throw new QuotaConfigMissing(
      'cv_parsing',
      'aucune ligne en base (la migration du quota a-t-elle été appliquée ?)',
    )
  }

  const maxPerWindow = Number(data.max_per_window)
  const windowHours = Number(data.window_hours)
  if (!Number.isInteger(maxPerWindow) || maxPerWindow < 1) {
    throw new QuotaConfigMissing('cv_parsing', `max_per_window invalide (${String(data.max_per_window)})`)
  }
  if (!Number.isInteger(windowHours) || windowHours < 1) {
    throw new QuotaConfigMissing('cv_parsing', `window_hours invalide (${String(data.window_hours)})`)
  }

  return { maxPerWindow, windowHours }
}

/** Fin de la fenêtre qui s'ouvre maintenant. Le calcul vit ICI, pas dans les routes. */
export function windowEndsAt(quota: AiQuota, now: Date): string {
  return new Date(now.getTime() + quota.windowHours * 60 * 60 * 1000).toISOString()
}
