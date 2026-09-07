import type { SupabaseClient } from '@supabase/supabase-js'
import type { CausePanne } from './ai-assessment'

/**
 * ENREGISTRER UN RÉSUMÉ QUI N'A PAS PU ÊTRE ÉCRIT.
 *
 * ═══ POURQUOI ═════════════════════════════════════════════════════════════
 *   `candidature_ai_health()` compte les candidatures sans jugement, mais elle
 *   confond les trois raisons en une seule. Or elles n'appellent pas la même
 *   action : un plafond atteint se relève, une panne de modèle se répare, une
 *   réponse illisible se surveille.
 *
 *   Le jour où plus aucun résumé n'est produit, un compteur unique dirait
 *   seulement « il en manque beaucoup ».
 *
 * ═══ CE QUE CE MODULE N'EST PAS ═══════════════════════════════════════════
 *   Ni une file de modération, ni une file de rejeu. Il n'écrit AUCUN texte, il
 *   ne déclenche AUCUNE reprise. Il compte, et c'est tout.
 *
 * ═══ BEST-EFFORT, ET C'EST DÉLIBÉRÉ ═══════════════════════════════════════
 *   Si l'enregistrement de la panne échoue, on journalise et on continue. Faire
 *   échouer un dépôt de candidature parce qu'on n'a pas su COMPTER une panne
 *   serait absurde — ce serait transformer un défaut d'observation en perte de
 *   dossier.
 */

export type SurfacePanne = 'candidature' | 'pitch'

export async function enregistrerPanne(
  supabaseAdmin: SupabaseClient,
  args: {
    cause: CausePanne
    surface: SurfacePanne
    domain_id?: string | null
    entity_id?: string | null
    detail?: string
  },
): Promise<void> {
  const { error } = await supabaseAdmin.from('ai_redaction_failures').insert({
    cause: args.cause,
    surface: args.surface,
    domain_id: args.domain_id ?? null,
    entity_id: args.entity_id ?? null,
    // Le détail est une phrase de journal, jamais le texte produit : une panne
    // n'a pas de contenu.
    detail: args.detail ?? null,
  })
  if (error) {
    console.error('[pannes] panne NON COMPTÉE — le compteur va sous-estimer', {
      cause: args.cause,
      surface: args.surface,
      message: error.message,
    })
  }
}
