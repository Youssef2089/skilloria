import { identifiantDerive } from '@/lib/admin/identifiant-derive'

/**
 * lib/admin/cron-audit-id.ts — identifiant d'audit d'une tâche planifiée.
 *
 * ═══ LE PROBLÈME ═══════════════════════════════════════════════════════════
 *   `audit_logs.entity_id` est de type **uuid NOT NULL**. Une tâche pg_cron,
 *   elle, n'a pas d'UUID : son identité est un NOM (`cron.job.jobname`) et un
 *   `jobid` bigint.
 *
 *   Or `logAudit` est best-effort : il journalise l'échec en console et
 *   n'échoue jamais l'appelant (lib/audit.ts). Passer un nom de tâche dans
 *   `entity_id` ne lèverait donc rien — l'insert serait simplement REJETÉ par
 *   Postgres, et l'action sensible ne laisserait AUCUNE trace.
 *
 *   Un écran de supervision dont les actions ne sont pas tracées reproduirait
 *   exactement le défaut qu'il combat : quelque chose se passe, personne ne
 *   peut le voir.
 *
 * ═══ LA SOLUTION ═══════════════════════════════════════════════════════════
 *   Un UUID DÉRIVÉ du nom, de façon déterministe. Deux propriétés utiles :
 *     - stable dans le temps → toutes les actions sur une même tâche portent
 *       le même `entity_id` et se regroupent naturellement ;
 *     - défini pour TOUTE tâche, y compris non cataloguée — on ne dépend pas
 *       d'une ligne en base qui pourrait ne pas exister.
 *
 *   ⚠️ CE N'EST PAS UNE CLÉ ÉTRANGÈRE. Aucune table ne porte cet identifiant :
 *      c'est une empreinte, pas une référence. Le nom lisible est écrit dans
 *      `detail.job_name` — c'est LUI qu'on lit pour comprendre une ligne
 *      d'audit, jamais l'UUID.
 *
 *   Le préfixe `cron_job:` évite toute collision avec un identifiant dérivé
 *   d'un autre domaine qui viendrait à utiliser le même procédé.
 */
export function cronJobAuditId(jobName: string): string {
  // ⚠️ DÉLÈGUE, ne recopie pas. Le même procédé sert désormais aux réglages
  //    d'argent (lib/admin/identifiant-derive.ts) ; deux dériveurs auraient
  //    fini par différer sur un préfixe, et les lignes d'une même tâche
  //    auraient cessé de se regrouper (§E.20). L'espace `'cron_job'` et la
  //    clé sont INCHANGÉS : les UUID déjà écrits en base restent les mêmes.
  return identifiantDerive('cron_job', jobName)
}
