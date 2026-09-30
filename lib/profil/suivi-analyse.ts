'use client'

/**
 * SUIVRE L'ANALYSE D'UN CV JUSQU'À SON ISSUE RÉELLE (§D.30) — une implémentation
 * pour les DEUX écrans de dépôt (freelance, CDI : §E.20).
 *
 * Depuis le 30/09/2026 l'analyse est un TRAVAIL : la route répond tout de suite, et
 * l'écran sonde `/api/profile/cv-status/[jobId]`. Ce que ce module rend, et que
 * l'écran traduit :
 *   · `aboutie` — l'analyse est écrite ; `ecarts` dit ce qui a été ramené ou écarté ;
 *   · `echouee` — avec le CODE nommé (clé de message : lib/profil/refus-depot-cv.ts) ;
 *   · `toujours_en_cours` — l'attente de l'écran est finie, PAS le travail : il
 *     aboutira ou sera clos par la base, et le tableau de bord le dira. Ce n'est
 *     jamais présenté comme un échec (§D.13 : ce qui expire est l'attente).
 * Pendant l'attente, `surReprise` est appelé quand un incident de NOTRE côté fait
 * rejouer l'analyse : l'écran le dit, sans alarmer (rien n'est décompté).
 */

export type Reprise = { code: string; tentative: number; sur: number }

export type IssueSuivi =
  | { issue: 'aboutie'; ecarts: unknown[] }
  | { issue: 'echouee'; code: string }
  | { issue: 'toujours_en_cours' }

/** L'écran attend au plus dix minutes : une analyse rejouée deux fois tient largement dedans. */
export const ATTENTE_MAX_MS = 10 * 60_000
const INTERVALLE_MS = 2000

export async function suivreAnalyse(
  secureFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  jobId: string,
  surReprise?: (r: Reprise | null) => void,
): Promise<IssueSuivi> {
  const debut = Date.now()
  while (Date.now() - debut < ATTENTE_MAX_MS) {
    await new Promise((r) => setTimeout(r, INTERVALLE_MS))
    let payload: { status?: string; code?: string; reprise?: Reprise; ecarts?: unknown[] } = {}
    try {
      const res = await secureFetch(`/api/profile/cv-status/${jobId}`, { method: 'GET' })
      // Une panne de LECTURE du suivi (503) n'est pas un échec de l'analyse : on continue de sonder.
      if (!res.ok) continue
      payload = await res.json()
    } catch {
      continue
    }
    if (payload.status === 'done') return { issue: 'aboutie', ecarts: Array.isArray(payload.ecarts) ? payload.ecarts : [] }
    if (payload.status === 'failed') return { issue: 'echouee', code: typeof payload.code === 'string' ? payload.code : 'cv_parsing_failed' }
    surReprise?.(payload.reprise ?? null)
  }
  return { issue: 'toujours_en_cours' }
}
