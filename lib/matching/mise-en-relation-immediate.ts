import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContexteJournal } from '@/lib/journal/contexte'
import { runMatchingForExpert } from '@/lib/matching'
import type { VerdictExpert } from '@/lib/matching/types'
import { codeDEchec, echouerRelance, marquerTentativeRelance, runAcheve, solderRelance } from '@/lib/matching/relance'

/**
 * UNE RECHERCHE IMMÉDIATE POUR UN EXPERT — et, si elle échoue, elle est REJOUÉE
 * et l'écran le DIT (§C.14, audit du 30/09/2026 : M5).
 *
 * ═══ POURQUOI UN SEUL CHEMIN ═══════════════════════════════════════════════
 *   Trois moments lancent une recherche tout de suite : l'approbation par un
 *   administrateur, l'auto-approbation (le verdict d'un travail de vérification),
 *   la ré-analyse d'un CV d'un expert déjà approuvé. L'auto-approbation lançait le
 *   moteur SANS compter la tentative ni enregistrer l'échec — le jumeau non corrigé
 *   de l'approbation (§E.20). Un chemin, trois appelants.
 *
 * ═══ CE QUI SE PASSE SUR UN ÉCHEC ══════════════════════════════════════════
 *   `echouerRelance` pose le code de l'échec ET, s'il n'y en a pas, une échéance
 *   (migration premiere_recherche_rejouee) : le pilote `expert_relance_trigger` la
 *   reprend, bornée par le plafond de tentatives, et l'écran « missions » comme
 *   l'accueil disent « la dernière recherche n'a pas abouti » au lieu d'« aucune
 *   opportunité ».
 */
export async function lancerMiseEnRelationImmediate(
  admin: SupabaseClient,
  profileId: string,
  journal: ContexteJournal,
): Promise<{ verdict: VerdictExpert; acheve: boolean }> {
  // LA TENTATIVE SE COMPTE AVANT LE RUN (§C.14) : un processus tué laisserait sinon un compteur immobile.
  await marquerTentativeRelance(admin, profileId)
  const debutRun = new Date()
  const verdict = await runMatchingForExpert({ supabaseAdmin: admin, profileId, journal })
  const acheve = runAcheve(verdict)
  if (acheve) {
    await solderRelance(admin, profileId, debutRun)
  } else {
    await echouerRelance(admin, profileId, codeDEchec(verdict))
  }
  return { verdict, acheve }
}
