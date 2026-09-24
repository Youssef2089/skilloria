import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractIp, extractUserAgent } from '@/lib/request-meta'

/**
 * Helper centralisé pour insérer une ligne dans `audit_logs`.
 *
 * Best-effort : si l'insert échoue, on log un warning mais on ne propage
 * jamais l'erreur — l'audit ne doit pas casser la requête métier.
 *
 * Schéma de la table (rappel) :
 *   audit_logs(user_id, domain_id, action, entity_type, entity_id, detail jsonb,
 *              ip_address, user_agent, created_at)
 *
 * ⚠️ `entity_type`, `entity_id` et `domain_id` sont NOT NULL en base. Un appel
 * qui les omet échoue SILENCIEUSEMENT (l'insert est best-effort et l'erreur
 * n'est que journalisée).
 *
 * ═══ CETTE PHRASE A ÉTÉ ÉCRITE, ET N'A PAS SUFFI ═══════════════════════════
 *   Sept appels passaient `entity_id: null` — SIX sur des réglages d'ARGENT
 *   (tarifs, plafonds, alertes, quotas). L'insert était rejeté par Postgres,
 *   la console le disait, et la route répondait « enregistré ». Aucune de ces
 *   traces n'a jamais existé. Mesuré le 24/09/2026 (§E.68).
 *
 *   « Toujours les fournir » est une DISCIPLINE. La parade est le TYPE : ces
 *   trois champs sont désormais OBLIGATOIRES et non nuls dans `AuditLogParams`,
 *   et le compilateur nomme chaque appel qui ne les donne pas. Un objet sans
 *   UUID naturel — un réglage clé par un texte, une tâche, un catalogue —
 *   passe par `identifiantDerive()` (lib/admin/identifiant-derive.ts).
 */
export type AuditLogParams = {
  supabaseAdmin: SupabaseClient
  user_id: string
  /** NOT NULL en base. Le domaine de l'ACTEUR (convention des actions existantes). */
  domain_id: string
  action: string
  /** NOT NULL en base. Ce qui est touché — un nom de table ou d'objet, jamais vide. */
  entity_type: string
  /** NOT NULL en base. Un UUID réel, ou dérivé par `identifiantDerive()` s'il n'y en a pas. */
  entity_id: string
  detail?: Record<string, unknown> | null
  /**
   * Requête à l'origine de l'action. Fournie ⇒ on renseigne `ip_address` et
   * `user_agent`, deux colonnes présentes depuis l'origine et jamais remplies.
   *
   * À FOURNIR SUR LES ACTIONS DE SÉCURITÉ (suspension, révocation de session,
   * changement de rôle par un administrateur plateforme) : sur ces actions-là,
   * « qui, quand, quoi » ne suffit pas — il faut aussi « depuis où ». Optionnel
   * ailleurs, pour ne pas imposer une signature à 54 call-sites existants dont
   * la plupart n'ont rien de sensible.
   */
  request?: NextRequest | Request | null
}

export async function logAudit(params: AuditLogParams): Promise<void> {
  const { supabaseAdmin, user_id, domain_id, action, entity_type, entity_id, detail, request } =
    params

  try {
    const { error } = await supabaseAdmin.from('audit_logs').insert({
      user_id,
      domain_id,
      action,
      entity_type,
      entity_id,
      detail: detail ?? null,
      ip_address: request ? extractIp(request) : null,
      user_agent: request ? extractUserAgent(request) : null,
    })

    if (error) {
      console.error('[audit] insert failed', {
        action,
        entity_type,
        entity_id,
        msg: error.message,
      })
    }
  } catch (err) {
    console.error('[audit] insert threw', {
      action,
      entity_type,
      entity_id,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}
