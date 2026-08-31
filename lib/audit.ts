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
 * n'est que journalisée). Toujours les fournir.
 */
export type AuditLogParams = {
  supabaseAdmin: SupabaseClient
  user_id: string
  domain_id: string | null
  action: string
  entity_type?: string | null
  entity_id?: string | null
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
      entity_type: entity_type ?? null,
      entity_id: entity_id ?? null,
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
