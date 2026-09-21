'use client'

import { useCallback, useRef, useState } from 'react'
import { useSecureFetch } from '@/lib/secure-fetch'
import type { IssueDeRecherche } from '@/lib/matching/issue-de-recherche'

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ LA RECHERCHE DE MISSIONS, CÔTÉ ÉCRAN — ELLE FINIT QUAND ELLE FINIT.      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ┌─ CE QUE CE HOOK REMPLACE, ET POURQUOI IL N'A AUCUN CHRONOMÈTRE ─────────┐
 * │ Deux modules décidaient à eux deux de ce que l'expert voyait, et ni     │
 * │ l'un ni l'autre ne savait quoi que ce soit du moteur :                  │
 * │                                                                         │
 * │   `useMatchingAnalyzing` — une roue qui tournait, et s'arrêtait à       │
 * │     SOIXANTE-QUINZE SECONDES « en retrait silencieux », ou dès que la   │
 * │     liste des identifiants changeait.                                   │
 * │   `matching-resync-hint` — une fenêtre de CENT VINGT SECONDES en        │
 * │     `sessionStorage`, pendant laquelle l'écran affichait « analyse en   │
 * │     cours » et sondait toutes les trois secondes.                       │
 * │                                                                         │
 * │ Aucun des deux ne mesurait un travail : ils mesuraient le TEMPS. Et le  │
 * │ travail, lui, était programmé pour SOIXANTE MINUTES plus tard. Les deux │
 * │ chronomètres expiraient donc toujours avant que quoi que ce soit ne se  │
 * │ produise, et l'écran concluait « aucune mission ne correspond » — un    │
 * │ résultat affirmé sans recherche.                                       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ICI, LA FIN DE LA RECHERCHE EST LA FIN DE LA REQUÊTE. La route exécute le
 * moteur et rend son issue ; il n'y a rien à deviner, donc rien à chronométrer.
 *
 * ⚠️ UNE RÉPONSE HORS SUJET NE DOIT PAS ÉCRASER LA DERNIÈRE. Deux bascules
 *    rapprochées lancent deux requêtes ; si la première revient après la
 *    seconde, elle raconterait un état périmé. Chaque recherche porte donc un
 *    numéro, et seule la plus récente a le droit d'écrire.
 */

export type EtatDeRecherche =
  /** Rien n'a été demandé — ou l'issue précédente a été acquittée. */
  | { phase: 'repos' }
  /** Le moteur tourne, et on attend VRAIMENT sa fin. */
  | { phase: 'en_cours' }
  /** Le moteur a rendu son verdict. Toujours nommé, jamais vide. */
  | { phase: 'terminee'; issue: IssueDeRecherche }

type Reponse = {
  ok?: boolean
  mode?: string
  issue?: IssueDeRecherche
}

export function useRechercheDeMissions(): {
  etat: EtatDeRecherche
  /** Vrai tant que le moteur tourne. Sert à désactiver les interrupteurs. */
  enCours: boolean
  /** L'issue de la dernière recherche achevée, ou `null`. */
  issue: IssueDeRecherche | null
  /** Lance une recherche et ATTEND sa fin. Ne lève jamais. */
  chercher: () => Promise<void>
  /** Acquitte l'issue affichée (l'expert a lu, ou l'a corrigée). */
  acquitter: () => void
} {
  const secureFetch = useSecureFetch()
  const [etat, setEtat] = useState<EtatDeRecherche>({ phase: 'repos' })
  const numeroRef = useRef(0)

  const chercher = useCallback(async () => {
    const numero = ++numeroRef.current
    setEtat({ phase: 'en_cours' })

    const poser = (issue: IssueDeRecherche) => {
      // Une recherche plus récente a pris la main : celle-ci n'a plus rien à
      // dire. Elle ne « corrige » pas l'affichage, elle le périmerait.
      if (numero !== numeroRef.current) return
      setEtat({ phase: 'terminee', issue })
    }

    try {
      const res = await secureFetch('/api/me/sync-matching', { method: 'POST' })
      const corps = (await res.json().catch(() => null)) as Reponse | null

      // L'élagage ne cherche rien : il raccourcit une liste. Il n'a donc AUCUNE
      // issue à annoncer, et en inventer une serait la faute symétrique de
      // celle qu'on vient de corriger.
      if (corps?.mode === 'elagage') {
        if (numero === numeroRef.current) setEtat({ phase: 'repos' })
        return
      }

      if (corps?.issue) {
        poser(corps.issue)
        return
      }

      // Pas d'issue dans le corps : la route a refusé avant d'en produire une
      // (profil illisible, session périmée, panne de passerelle). On le DIT.
      console.warn('[recherche-de-missions] réponse sans issue', { status: res.status })
      poser({ etat: 'echec', raison: 'lecture_en_panne' })
    } catch (err) {
      // Réseau coupé, requête tuée par le couperet (§E.5) : c'est un échec
      // NOMMÉ. Laisser la roue tourner indéfiniment serait le défaut d'avant,
      // sous une autre forme.
      console.warn('[recherche-de-missions] requête en échec', err)
      poser({ etat: 'echec', raison: 'lecture_en_panne' })
    }
  }, [secureFetch])

  const acquitter = useCallback(() => {
    // Le numéro avance : une réponse encore en vol ne réveillera pas un
    // bandeau que l'expert vient de fermer.
    numeroRef.current++
    setEtat({ phase: 'repos' })
  }, [])

  return {
    etat,
    enCours: etat.phase === 'en_cours',
    issue: etat.phase === 'terminee' ? etat.issue : null,
    chercher,
    acquitter,
  }
}
