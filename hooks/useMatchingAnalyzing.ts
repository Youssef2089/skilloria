'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * État « analyse matching en cours » pour la section Missions recommandées,
 * y compris quand la liste est DÉJÀ non vide (toggle croisé / bascule dispo).
 *
 * Cycle (cf. spec) :
 *   - startAnalyzing() au DÉCLENCHEMENT : capture la signature des résultats
 *     AVANT tout re-fetch (les match_id joints).
 *   - fin quand la signature courante DIFFÈRE de celle capturée (nouveaux
 *     résultats arrivés), OU au timeout de sécurité ~45s (retrait SILENCIEUX,
 *     l'absence de changement étant un résultat normal).
 *
 * Le re-fetch lui-même est assuré ailleurs (useLiveResource, poll 3s pendant la
 * fenêtre du hint). Ce hook ne fait que piloter l'état visible + sa fin.
 * Nettoyage du timeout à l'unmount.
 */
const ANALYZE_TIMEOUT_MS = 45_000

export function useMatchingAnalyzing(signature: string): {
  analyzing: boolean
  startAnalyzing: () => void
} {
  const [analyzing, setAnalyzing] = useState(false)
  const capturedSigRef = useRef<string | null>(null)
  const sigRef = useRef(signature)
  const timeoutRef = useRef<number | null>(null)

  // Réf toujours à jour de la signature courante (pour la capture au démarrage).
  useEffect(() => {
    sigRef.current = signature
  }, [signature])

  const clearTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    clearTimer()
    capturedSigRef.current = null
    setAnalyzing(false)
  }, [clearTimer])

  const startAnalyzing = useCallback(() => {
    capturedSigRef.current = sigRef.current // signature AVANT re-fetch
    setAnalyzing(true)
    clearTimer()
    timeoutRef.current = window.setTimeout(() => {
      // Timeout de sécurité : retrait silencieux (pas de message).
      timeoutRef.current = null
      capturedSigRef.current = null
      setAnalyzing(false)
    }, ANALYZE_TIMEOUT_MS)
  }, [clearTimer])

  // Fin de l'analyse dès que les résultats changent (signature différente).
  useEffect(() => {
    if (!analyzing) return
    if (capturedSigRef.current !== null && signature !== capturedSigRef.current) {
      stop()
    }
  }, [signature, analyzing, stop])

  // Nettoyage à l'unmount.
  useEffect(() => clearTimer, [clearTimer])

  return { analyzing, startAnalyzing }
}
