'use client'

import { useCallback, useRef } from 'react'
import { useLocale } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * useDemanderPitch — le pitch, demandé quand une carte est RÉELLEMENT ouverte.
 *
 * ═══ UN APPEL PAR PROFIL OUVERT, PAS UN DE PLUS ═══════════════════════════
 *   Une annonce peut avoir des centaines de candidats. Rédiger un pitch pour
 *   chacun d'avance coûterait des centaines d'appels dont l'organisation n'en
 *   lirait qu'une poignée. Le carrousel appelle donc ce hook au moment où une
 *   carte passe sous le projecteur — et pas avant.
 *
 * ═══ DEUX GARDES CONTRE LA RÉPÉTITION, ET ELLES SONT COMPLÉMENTAIRES ══════
 *   Ici, en mémoire : une même carte parcourue trois fois dans un sens puis
 *   dans l'autre ne déclenche qu'UNE demande. C'est la garde de confort.
 *
 *   Au serveur : le texte vit dans `matches.explanation` et n'est jamais
 *   régénéré. C'est la garde qui compte — celle qui tient après un
 *   rafraîchissement de page, sur un autre poste, pour un autre membre de
 *   l'organisation.
 *
 *   La garde mémoire ne remplace pas la garde serveur : elle lui évite du
 *   trafic. Si elle disparaissait, rien ne serait payé deux fois.
 *
 * ═══ BEST-EFFORT ══════════════════════════════════════════════════════════
 *   Un échec ne bloque rien. La carte s'affiche sans pitch — un texte
 *   d'agrément ne doit pas empêcher de lire un dossier.
 */
export function useDemanderPitch(): (candidatureId: string) => Promise<string | null> {
  const secureFetch = useSecureFetch()
  const locale = useLocale()
  // Les demandes déjà parties dans cette session d'écran. La valeur porte la
  // promesse en cours : deux ouvertures rapprochées partagent le même appel.
  const enCours = useRef<Map<string, Promise<string | null>>>(new Map())

  return useCallback(
    (candidatureId: string) => {
      if (!candidatureId) return Promise.resolve(null)
      const dejaDemande = enCours.current.get(candidatureId)
      if (dejaDemande) return dejaDemande

      const promesse = (async (): Promise<string | null> => {
        try {
          const res = await secureFetch(
            `/api/candidatures/${candidatureId}/pitch?locale=${encodeURIComponent(locale)}`,
            { method: 'POST' },
          )
          if (!res.ok) {
            console.warn('[pitch] demande non aboutie', { candidatureId, status: res.status })
            return null
          }
          const charge = (await res.json()) as { pitch?: string | null; raison?: string }
          if (!charge.pitch && charge.raison) {
            // La raison est journalisée : un pitch absent sans raison enverrait
            // chercher un bug là où il n'y a qu'un plafond atteint.
            console.info('[pitch] non rédigé', { candidatureId, raison: charge.raison })
          }
          return charge.pitch ?? null
        } catch (err) {
          console.warn('[pitch] demande en échec', { candidatureId, err })
          return null
        }
      })()

      enCours.current.set(candidatureId, promesse)
      return promesse
    },
    [secureFetch, locale],
  )
}
