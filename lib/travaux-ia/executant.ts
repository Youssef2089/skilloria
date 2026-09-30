import type { SupabaseClient } from '@supabase/supabase-js'
import { executerAnalyseCv } from './executer-analyse'
import { executerVerification } from './executer-verification'
import { echouerTravail, type Travail } from './travail'

/**
 * L'EXÉCUTANT DES TRAVAUX D'IA — il prend ce qui est dû, sous bail, et l'exécute
 * tant qu'il lui reste le temps d'en finir un (§D.30).
 *
 * ═══ LE BAIL ET LE TEMPS ═══════════════════════════════════════════════════
 *   Le bail (`prendre_travail_ia`) dure plus que la route (`maxDuration`) : un
 *   travail en cours n'est jamais repris par un second exécutant tant que le
 *   premier vit. S'il meurt, le bail expire et le pilote pg_cron le remet en file
 *   (ou le clôt, à la dernière tentative) — rien ne reste « en cours ».
 *
 *   On ne PREND un travail que s'il reste de quoi le finir : une vérification peut
 *   faire trois appels de 45 s. Plusieurs exécutants peuvent tourner en même temps
 *   (`for update skip locked`) : aucun bail de route n'est nécessaire.
 */

/** Ce qu'un travail peut durer au plus, marge comprise — vérification : 3 × 45 s, plus les reprises. */
export const DUREE_MAX_TRAVAIL_S = 180
/** Le bail : plus long que la route, pour qu'un exécutant vivant ne soit jamais doublé. */
export const DUREE_BAIL_S = 330

export type BilanExecutant = {
  pris: number
  issues: Array<{ travail: string; nature: string; issue: string; code?: string }>
  arret: 'file_vide' | 'temps' | 'file_illisible'
  erreur?: string
}

export async function executerTravauxDus(admin: SupabaseClient, finAuPlusTard: number): Promise<BilanExecutant> {
  const bilan: BilanExecutant = { pris: 0, issues: [], arret: 'file_vide' }
  for (;;) {
    if (Date.now() + DUREE_MAX_TRAVAIL_S * 1000 > finAuPlusTard) {
      bilan.arret = 'temps'
      return bilan
    }
    const { data, error } = await admin.rpc('prendre_travail_ia', { p_duree_bail: `${DUREE_BAIL_S} seconds` })
    if (error) {
      console.error('[travaux-ia] file illisible', error.message)
      bilan.arret = 'file_illisible'
      bilan.erreur = error.message
      return bilan
    }
    const t = (Array.isArray(data) ? data[0] : data) as Travail | undefined
    if (!t?.id) return bilan
    bilan.pris++
    try {
      const issue = t.nature === 'analyse_cv' ? await executerAnalyseCv(admin, t) : await executerVerification(admin, t)
      bilan.issues.push({ travail: t.id, nature: t.nature, issue: issue.issue, code: 'code' in issue ? issue.code : undefined })
    } catch (err) {
      // Une exception de NOTRE code : le travail est rejoué (jusqu'au plafond), jamais laissé en cours.
      console.error('[travaux-ia] exception pendant le travail', { travailId: t.id, nature: t.nature, cause: err instanceof Error ? err.message : String(err) })
      const statut = await echouerTravail(admin, t.id, 'exception_interne', true)
      bilan.issues.push({ travail: t.id, nature: t.nature, issue: statut, code: 'exception_interne' })
    }
  }
}
