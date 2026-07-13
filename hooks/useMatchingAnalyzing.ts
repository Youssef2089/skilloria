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
 *     résultats arrivés), OU au timeout de sécurité ~75s (retrait SILENCIEUX,
 *     l'absence de changement étant un résultat normal).
 *
 * Timeout à 75s (au lieu de 45s) : couvre le pire cas orchestration —
 * cooldown M2 serveur (≤60s) + run IA (~10-15s) quand un retry est programmé
 * après un 429 (cf. F2). Un run direct (2xx) se termine bien avant.
 *
 * Retry unique après 429 (F2) : le HANDLER lit la réponse de sync-matching et,
 * sur 429, programme UN re-POST via scheduleRetry(). Le hook centralise le
 * cycle de vie du timer de retry (nettoyage à l'unmount ET dès que l'analyse se
 * termine — signature changée ou timeout). Aucune boucle : le handler ne
 * rappelle scheduleRetry qu'une seule fois.
 *
 * Le re-fetch lui-même est assuré ailleurs (useLiveResource, poll 3s pendant la
 * fenêtre du hint). Ce hook ne fait que piloter l'état visible + sa fin.
 */
const ANALYZE_TIMEOUT_MS = 75_000

export function useMatchingAnalyzing(signature: string): {
  analyzing: boolean
  startAnalyzing: () => void
  scheduleRetry: (fn: () => void, delayMs: number) => void
} {
  const [analyzing, setAnalyzing] = useState(false)
  const capturedSigRef = useRef<string | null>(null)
  const sigRef = useRef(signature)
  const timeoutRef = useRef<number | null>(null)
  const retryRef = useRef<number | null>(null)

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

  const clearRetry = useCallback(() => {
    if (retryRef.current !== null) {
      window.clearTimeout(retryRef.current)
      retryRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    clearTimer()
    clearRetry()
    capturedSigRef.current = null
    setAnalyzing(false)
  }, [clearTimer, clearRetry])

  const startAnalyzing = useCallback(() => {
    capturedSigRef.current = sigRef.current // signature AVANT re-fetch
    setAnalyzing(true)
    clearTimer()
    clearRetry() // repart propre : aucun retry d'un cycle précédent en vol
    timeoutRef.current = window.setTimeout(() => {
      // Timeout de sécurité : retrait silencieux (pas de message) + annulation
      // d'un éventuel retry encore en attente.
      timeoutRef.current = null
      clearRetry()
      capturedSigRef.current = null
      setAnalyzing(false)
    }, ANALYZE_TIMEOUT_MS)
  }, [clearTimer, clearRetry])

  // Retry unique programmé par le handler (F2). Écrase tout retry précédent —
  // le handler garantit déjà « 1 seul retry », ceci n'est qu'une sécurité.
  const scheduleRetry = useCallback(
    (fn: () => void, delayMs: number) => {
      clearRetry()
      retryRef.current = window.setTimeout(() => {
        retryRef.current = null
        fn()
      }, delayMs)
    },
    [clearRetry],
  )

  // Fin de l'analyse dès que les résultats changent (signature différente) :
  // annule aussi le retry en vol (plus besoin de relancer, ça a bougé).
  useEffect(() => {
    if (!analyzing) return
    if (capturedSigRef.current !== null && signature !== capturedSigRef.current) {
      stop()
    }
  }, [signature, analyzing, stop])

  // Nettoyage à l'unmount (les deux timers).
  useEffect(
    () => () => {
      clearTimer()
      clearRetry()
    },
    [clearTimer, clearRetry],
  )

  return { analyzing, startAnalyzing, scheduleRetry }
}
