'use client'

import { useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { verdictCompte, CODE_COMPTE_DIFFERENT } from '@/lib/identite/verdict'

/**
 * lib/identite/compte-affiche.ts — LE COMPTE QUE CET ONGLET AFFICHE, ET CE QUI ARRIVE QUAND UN AUTRE PREND
 * LA MAIN (§E.87, 30/09/2026).
 *
 * Un onglet retient le compte qu'il a affiché au montage de sa coquille (menu, en-tête). Toute requête
 * authentifiée le déclare au serveur (`useSecureFetch`), et toute lecture d'identité le compare à la session
 * du navigateur. Quand ils divergent — un autre compte s'est connecté dans ce navigateur —, l'onglet se
 * déconnecte PROPREMENT et le dit à l'écran de connexion (`?reason=compte_different`). Jamais un mélange.
 *
 * ⚠️ L'état vit dans le MODULE : un par onglet (un bundle client par page). Aucun stockage du navigateur :
 *    une copie persistée serait une identité de plus à garder cohérente — le défaut même qu'on ferme.
 */

let compteAffiche: string | null = null
let ejectionEnCours = false

/** Retient le compte que l'écran vient d'afficher (appelé par la coquille, au chargement de l'identité). */
export function fixerCompteAffiche(id: string | null): void {
  compteAffiche = id && id.trim() ? id : null
}

/** Le compte que cet onglet affiche, ou `null` s'il n'a encore rien affiché. */
export function lireCompteAffiche(): string | null {
  return compteAffiche
}

/**
 * Un autre compte agit dans ce navigateur : on se DÉCONNECTE (session locale purgée — un navigateur, un
 * compte) et on part sur l'écran de connexion, qui dit pourquoi. Navigation COMPLÈTE : aucun état de
 * l'ancien compte ne survit dans la page.
 */
export function ejecterCompteDifferent(): void {
  if (ejectionEnCours || typeof window === 'undefined') return
  ejectionEnCours = true
  compteAffiche = null
  const langue = window.location.pathname.split('/')[1] || 'fr'
  void supabase.auth.signOut({ scope: 'local' }).finally(() => {
    window.location.assign(`/${langue}/connexion?reason=${CODE_COMPTE_DIFFERENT}`)
  })
}

/**
 * La session du navigateur, SI elle appartient au compte que l'écran affiche. Sinon : éjection, et `'ejecte'`
 * — distinct de `null` (personne n'est connecté), pour que l'appelant ne lance pas une seconde navigation.
 * À utiliser partout où une page lit l'identité pour AGIR ou AFFICHER (salutation, profil, dépôt de CV).
 */
export async function sessionDuCompteAffiche(): Promise<Session | null | 'ejecte'> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const verdict = verdictCompte(compteAffiche, session?.user?.id)
  if (verdict === 'different') {
    ejecterCompteDifferent()
    return 'ejecte'
  }
  // Plus personne n'agit : on OUBLIE le compte affiché (une connexion suivante, sans rechargement,
  // ne doit pas être comparée à lui). La page, elle, dit « session expirée » comme avant.
  if (verdict === 'absent') fixerCompteAffiche(null)
  return session
}

/**
 * LA GARDE DE LA COQUILLE : une fois le compte affiché connu, on écoute la session. Un changement de compte
 * — ou une déconnexion — dans un autre onglet, ou au retour sur cet onglet, éjecte. Le menu ne montre donc
 * jamais un compte qui n'agit plus.
 */
export function useGardeCompteAffiche(idAffiche: string | null): void {
  useEffect(() => {
    if (!idAffiche) return
    fixerCompteAffiche(idAffiche)
    const verifier = (idSession: string | null | undefined) => {
      const verdict = verdictCompte(idAffiche, idSession)
      // UN AUTRE COMPTE agit : on éjecte, avec le motif `compte_different`.
      if (verdict === 'different') ejecterCompteDifferent()
      // PLUS AUCUN compte : c'est une déconnexion. On ne l'annonce PAS comme un autre compte — la
      // déconnexion volontaire, la session remplacée et le compte suspendu naviguent eux-mêmes, avec
      // LEUR motif (audit du 30/09/2026, M1 : ma garde de l'ARRÊT 18 les écrasait tous). On oublie
      // seulement le compte affiché, pour qu'une connexion suivante ne lui soit pas comparée.
      else if (verdict === 'absent') fixerCompteAffiche(null)
    }
    const { data: abonnement } = supabase.auth.onAuthStateChange((_evenement, session) => {
      verifier(session?.user?.id)
    })
    // Au retour sur l'onglet : la session a pu changer pendant qu'il était caché.
    const auRetour = () => {
      if (document.visibilityState !== 'visible') return
      void supabase.auth.getSession().then(({ data: { session } }) => verifier(session?.user?.id))
    }
    document.addEventListener('visibilitychange', auRetour)
    window.addEventListener('focus', auRetour)
    return () => {
      abonnement.subscription.unsubscribe()
      document.removeEventListener('visibilitychange', auRetour)
      window.removeEventListener('focus', auRetour)
    }
  }, [idAffiche])
}
