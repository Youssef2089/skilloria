import { createHash } from 'node:crypto'

/**
 * lib/admin/identifiant-derive.ts — un UUID STABLE pour ce qui n'en a pas.
 *
 * ═══ LE PROBLÈME, ET IL A DÉJÀ COÛTÉ ═══════════════════════════════════════
 *   `audit_logs.entity_id` est **uuid NOT NULL**. Une tâche planifiée, un
 *   réglage d'argent (`ai_model_tarifs.model` est un TEXTE, `ai_spend_caps`
 *   est clée par `provider`), le catalogue Stripe : aucun n'a d'UUID.
 *
 *   Sept appels à `logAudit` passaient `entity_id: null`. `logAudit` est
 *   best-effort — il journalise l'échec en console et n'échoue jamais
 *   l'appelant —, donc Postgres REJETAIT l'insert et la route répondait
 *   « enregistré ». **Six de ces sept étaient des réglages d'ARGENT** :
 *   tarifs, plafonds, alertes, quotas. Mesuré le 24/09/2026, sur le dépôt.
 *   Aucune de ces traces n'a jamais existé.
 *
 * ═══ LA SOLUTION, ET ELLE EXISTAIT DÉJÀ POUR UN CAS ═════════════════════════
 *   `cronJobAuditId` dérivait un UUID du nom d'une tâche. La même règle vaut
 *   pour tout ce qui a une clé textuelle : on la GÉNÉRALISE au lieu de la
 *   recopier (§E.20 — un second dériveur divergerait du premier sur un
 *   préfixe, et deux lignes du même réglage ne se regrouperaient plus).
 *
 *   Deux propriétés utiles :
 *     · stable dans le temps → toutes les actions sur un même objet portent
 *       le même `entity_id` et se regroupent naturellement ;
 *     · défini pour TOUT objet, y compris non catalogué — on ne dépend
 *       d'aucune ligne en base.
 *
 *   ⚠️ CE N'EST PAS UNE CLÉ ÉTRANGÈRE. Aucune table ne porte cet identifiant :
 *      c'est une empreinte, pas une référence. Le nom lisible va TOUJOURS dans
 *      `detail` — c'est lui qu'on lit, jamais l'UUID.
 *
 *   L'ESPACE est obligatoire, et il est la moitié qui compte : `'cron_job'`
 *   et `'reglage'` avec la même clé donnent deux UUID différents. Sans espace,
 *   une tâche nommée comme un réglage aurait la même empreinte, et l'écran
 *   d'audit mélangerait les deux histoires.
 */

/** Les espaces connus. Fermer la liste : un espace inventé ne se regroupe avec rien. */
export type EspaceDerive = 'cron_job' | 'reglage' | 'catalogue'

export function identifiantDerive(espace: EspaceDerive, cle: string): string {
  const h = createHash('md5').update(`${espace}:${cle}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
