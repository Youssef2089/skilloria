// lib/candidatures/origine-devoilement.ts
//
// QUI A OUVERT L'ÉCHANGE ? — l'entreprise, ou le dévoilement INCLUS dans son offre, automatique au dépôt
// (lot alertes et recommandations).
//
// LE CAS (recette staging, compte d'essai freelance) : une minute après sa candidature, le suivi de l'expert disait
// « Échange ouvert par l'entreprise ». Personne, à l'entreprise, n'avait rien fait : la candidature était la mieux notée
// à son arrivée, et le dévoilement inclus dans l'offre (`performUnlock(…, { auto: true })`, lib/candidatures/depot.ts)
// l'avait ouverte. Le suivi attribuait à l'entreprise un geste qu'elle n'avait pas fait.
//
// OÙ LE FAIT EST ÉCRIT : la candidature ne garde que `unlocked_at`. L'origine est portée par la ligne
// `devoilement_ouvert` du grand livre, écrite DANS LA MÊME TRANSACTION que la bascule (`devoiler_candidature`), clé
// `auto` de sa liste blanche (§D.26). On la LIT ici — on n'écrit rien, et on ne dérive pas l'origine d'un délai
// (« ouverte moins d'une minute après » serait une devinette que le premier clic rapide de l'entreprise démentirait).
//
// CE QU'ON NE SAIT PAS SE DIT : une ligne absente (le nettoyage du journal, réglé dans l'administration, a pu l'effacer)
// ou une lecture en panne rendent `null`, et le suivi écrit « Échange ouvert » sans nommer personne — jamais « par
// l'entreprise » par défaut (§E.22 : une panne ne se déguise pas en fait).

import type { SupabaseClient } from '@supabase/supabase-js'
// Import RELATIF avec extension : `diag-alertes-recommandations` exécute ce module tel quel, sur une base simulée (§E.3).
import { enTranches, TAILLE_TRANCHE_IDS } from '../matching/tranches.ts'

/** `inclus` : ouvert automatiquement au dépôt (dévoilement inclus dans l'offre) ; `entreprise` : ouvert par elle. */
export type OrigineDevoilement = 'inclus' | 'entreprise'

/**
 * L'origine du dévoilement de chaque candidature demandée, lue au grand livre. Une candidature absente de la carte
 * rendue n'a pas d'origine CONNUE — l'appelant n'en invente pas.
 */
export async function originesDesDevoilements(
  admin: SupabaseClient,
  candidatureIds: readonly string[],
): Promise<Map<string, OrigineDevoilement>> {
  const origines = new Map<string, OrigineDevoilement>()
  if (candidatureIds.length === 0) return origines
  for (const tranche of enTranches([...candidatureIds], TAILLE_TRANCHE_IDS)) {
    const { data, error } = await admin
      .from('grand_livre')
      .select('sujet_id, detail')
      .eq('type_action', 'devoilement_ouvert')
      .eq('statut', 'reussi')
      .eq('sujet_type', 'candidatures')
      .in('sujet_id', tranche)
    if (error) {
      // L'origine n'est pas connue : le suivi le dira sans nommer personne. Les autres tranches méritent d'être lues.
      console.error('[candidatures] origine des dévoilements ILLISIBLE — « Échange ouvert » sans attribution', {
        demandees: tranche.length,
        message: error.message,
      })
      continue
    }
    for (const ligne of (data ?? []) as Array<{ sujet_id: string | null; detail: unknown }>) {
      if (!ligne.sujet_id) continue
      const auto = (ligne.detail as { auto?: unknown } | null)?.auto
      if (auto === true) origines.set(ligne.sujet_id, 'inclus')
      else if (auto === false) origines.set(ligne.sujet_id, 'entreprise')
    }
  }
  return origines
}
