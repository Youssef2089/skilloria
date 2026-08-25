'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR, { type SWRConfiguration } from 'swr'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * useLiveResource — couche SWR + "hold new items" pour les listes live.
 *
 * Pourquoi ce wrapper plutôt que useSWR direct :
 *  1. Loading affiché UNIQUEMENT au 1er mount (pas pendant les revalidations).
 *     SWR avec `keepPreviousData: true` garde la dernière data → on s'appuie
 *     dessus, et on n'expose `kind: 'loading'` que si `data === undefined`.
 *  2. Erreur ne purge pas la data (kind 'error' uniquement si pas de cache).
 *  3. Listener `skilloria:notif-bump` → mutate() = revalidation immédiate.
 *  4. Couche optionnelle `holdNewItems` : si SEULEMENT des nouveaux items
 *     apparaissent (aucun update/delete), on les retient dans `pendingItems`
 *     au lieu de pousser la liste affichée vers le bas. Une pastille top
 *     "N nouveaux" + clic = applyPending() fusionne.
 *  5. Diff fin par id + version (updated_at) pour ne pas re-rendre si data
 *     est identique au sens métier (utile quand le serveur normalise les
 *     timestamps).
 *
 * NE PAS confondre avec un Realtime : c'est toujours du polling 30s côté
 * client. Latence : 0 à pollMs. Realtime (Supabase) reste une option future.
 */

export type UseLiveResourceState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; status?: number }
  | { kind: 'ready' }

export type UseLiveResourceOptions<T, Item> = {
  /** URL absolue de la route /api/... — déclenche un fetch SWR. null = pause. */
  url: string | null
  pollMs?: number
  revalidateOnFocus?: boolean
  /** Si true, écoute window 'skilloria:notif-bump' → mutate(). */
  revalidateOnBump?: boolean
  /** Dédup : ne fetch pas 2x dans la même fenêtre (par défaut pollMs/3). */
  dedupingMs?: number
  /** Extracteur d'items pour le diff/holdNewItems. Si retourne null → couche items désactivée. */
  itemsOf: (data: T) => Item[] | null
  /** Identité stable pour le diff (souvent `i => i.id`). */
  identityOf: (item: Item) => string
  /** Version optionnelle (souvent `i => i.updated_at`). Si absente, diff sur identité seule. */
  versionOf?: (item: Item) => string | number | null
  /** Si true : les nouveaux items entrants sont retenus en pendingItems. */
  holdNewItems?: boolean
  /**
   * Hash des MÉTADONNÉES hors-items (Lot global C1).
   *
   *  `holdNewItems: true` retient les nouveaux items en pendingItems et NE
   *  met PAS à jour `displayed`. C'est correct quand seul le LISTING change.
   *  Mais quand une MÉTADONNÉE de la réponse change (ex. `expert_status.is_dnd`
   *  → false après "Réactiver"), on doit propager l'update IMMÉDIATEMENT à
   *  `displayed`, sinon l'UI lit toujours l'ancienne metadata (empty-state
   *  rouge bloqué).
   *
   *  Si défini : à chaque revalidation, on calcule le hash de serverData ;
   *  s'il diffère du hash précédent, on force `setDisplayed(serverData)` et
   *  on vide `pendingItems`. Indépendant de holdNewItems.
   */
  metadataHash?: (data: T) => string
  /** Transform optionnel après fetch (avant exposition). */
  transform?: (raw: unknown) => T
  /** Désactive complètement le hook (passe les data en undefined). */
  enabled?: boolean
}

export type UseLiveResource<T, Item> = {
  state: UseLiveResourceState
  /** Data effectivement affichée — exclut les pending (cf. holdNewItems). */
  data: T | null
  /** Vrai pendant un poll silencieux (data déjà présente). */
  isRevalidating: boolean
  /** Nombre d'items retenus en attente. 0 si holdNewItems=false. */
  pendingCount: number
  /** Items retenus, exposés pour debug/transparence. */
  pendingItems: Item[]
  /** Applique les pending dans la liste affichée. */
  applyPending: () => void
  /** Force un fetch immédiat (silencieux). */
  refresh: () => Promise<void>
}

export function useLiveResource<T, Item>(opts: UseLiveResourceOptions<T, Item>): UseLiveResource<T, Item> {
  const {
    url,
    pollMs = 30_000,
    revalidateOnFocus = true,
    revalidateOnBump = true,
    dedupingMs,
    itemsOf,
    identityOf,
    versionOf,
    holdNewItems = false,
    metadataHash,
    transform,
    enabled = true,
  } = opts

  const secureFetch = useSecureFetch()
  const secureFetchRef = useRef(secureFetch)
  useEffect(() => { secureFetchRef.current = secureFetch }, [secureFetch])

  const fetcher = useCallback(async (u: string): Promise<T> => {
    const res = await secureFetchRef.current(u, { method: 'GET' })
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({} as { error?: string }))) as { error?: string }
      // On expose le status HTTP sur l'erreur pour que les pages distinguent
      // un état attendu (ex. 403 not_verified → empty-state) d'une vraie panne.
      const err = new Error(payload.error ?? `HTTP ${res.status}`) as Error & { status?: number }
      err.status = res.status
      throw err
    }
    const raw = await res.json()
    return (transform ? transform(raw) : (raw as T))
  }, [transform])

  const swrConfig: SWRConfiguration<T> = {
    refreshInterval: enabled ? pollMs : 0,
    revalidateOnFocus,
    keepPreviousData: true,
    dedupingInterval: dedupingMs ?? Math.floor(pollMs / 3),
    shouldRetryOnError: false,
  }
  const key = enabled ? url : null

  const swr = useSWR<T>(key, fetcher, swrConfig)
  // `isLoading` (SWR v2) = requête en vol ET aucune donnée chargée POUR LA CLÉ
  // COURANTE. Avec `keepPreviousData: true`, `data` porte encore la charge utile
  // de la clé précédente pendant ce temps : `isLoading` est le SEUL signal qui
  // permet de savoir à quelle collection `data` appartient. Cf. l'effet ci-dessous.
  const { data: serverData, error, isValidating, isLoading, mutate } = swr

  // Listener bump → mutate().
  useEffect(() => {
    if (!revalidateOnBump || !enabled) return
    const onBump = () => { void mutate() }
    window.addEventListener('skilloria:notif-bump', onBump)
    return () => { window.removeEventListener('skilloria:notif-bump', onBump) }
  }, [revalidateOnBump, enabled, mutate])

  // ── Couche "hold new items" ──────────────────────────────────────────────
  //  Stratégie : on garde une référence "displayedData" séparée. À chaque
  //  nouveau serverData, on diffe par id+version :
  //   - SEULEMENT des nouveaux items entrants → on les retient (pendingItems).
  //   - Updates / deletes / mix → on applique en place (la liste affichée
  //     suit serverData).
  const [displayed, setDisplayed] = useState<T | null>(null)
  const [pendingItems, setPendingItems] = useState<Item[]>([])

  /**
   * Clé SWR à laquelle `displayed` correspond. `undefined` = rien encore
   * appliqué (sentinelle : `key` vaut `string | null`, jamais `undefined`).
   *
   * POURQUOI CETTE RÉFÉRENCE EXISTE
   *   `displayed` est un état SÉPARÉ de `serverData`. Sans mémoire de la clé,
   *   un changement d'URL (donc de filtre) était vu par le diff ci-dessous
   *   comme « des items apparaissent dans la même liste » : avec
   *   `holdNewItems`, ils partaient en `pendingItems` et `displayed` restait
   *   sur la charge utile de l'ANCIEN filtre. Vécu : onglet « Archivées (3) »
   *   au-dessus d'une liste vide, parce que `counts` est calculé sur la
   *   totalité (donc identique dans les deux charges utiles) alors que la
   *   liste, elle, était périmée.
   *
   *   Un changement de clé signifie AUTRE COLLECTION, jamais NOUVEAUX ITEMS.
   */
  const appliedKeyRef = useRef<string | null | undefined>(undefined)

  // Effet UNIQUE : bascule de collection PUIS diff. Les deux ne peuvent pas
  // être séparés — deux effets distincts se marcheraient dessus au render où
  // la nouvelle charge utile arrive (le second diffe encore contre l'ancien
  // `displayed`, que le premier vient seulement de programmer).
  useEffect(() => {
    // ── (1) CHANGEMENT DE COLLECTION ─────────────────────────────────────
    if (appliedKeyRef.current !== key) {
      // PURGE IMMÉDIATE de la charge utile précédente.
      //
      //   Conserver l'ancienne pendant le fetch faisait dire au hook « ready »
      //   pour une collection que l'appelant ne demande plus. La vue lisait
      //   alors une liste vide — celle de l'ancien bucket — et affichait
      //   « Aucune candidature archivée » AVANT d'avoir la réponse. Pire, avec
      //   un ancien bucket non vide, elle affichait ses items sous le nouveau
      //   libellé. Un écran ne doit jamais affirmer « il n'y a rien » tant
      //   qu'il ne sait pas.
      //
      //   `displayed = null` ⇒ `state.kind === 'loading'` mécaniquement : les
      //   9 consommateurs sont couverts sans être modifiés, et le prochain
      //   écran filtré le sera aussi.
      //
      //   `key !== null` : une clé nulle n'est PAS une autre collection, c'est
      //   une MISE EN PAUSE (url conditionnelle : `enabled`, `isApproved`,
      //   setup non prêt…). On conserve alors l'affichage — comportement
      //   strictement inchangé pour les consommateurs qui alternent url ↔ null.
      if (key !== null && displayed !== null) {
        setDisplayed(null)
        setPendingItems([])
      }
      // PIÈGE `keepPreviousData` : tant que le fetch de la nouvelle clé est en
      // vol, `serverData` porte ENCORE la charge utile de l'ancienne. On
      // attend — sinon on afficherait les données d'un autre filtre sous le
      // nouvel onglet.
      if (isLoading) return
      if (error) {
        // Aucune donnée valide pour cette clé : `displayed` est déjà purgé,
        // l'état bascule sur 'error' plutôt que de mentir.
        appliedKeyRef.current = key
        setDisplayed(null)
        setPendingItems([])
        return
      }
      if (serverData === undefined) return
      // Collection différente ⇒ application IMMÉDIATE, `holdNewItems`
      // court-circuité, pending vidés (ils appartenaient à l'ancienne liste).
      // Même esprit que le court-circuit `metadataHash` plus bas.
      appliedKeyRef.current = key
      setDisplayed(serverData)
      setPendingItems([])
      return
    }

    // ── (2) MÊME COLLECTION : diff habituel ──────────────────────────────
    if (serverData === undefined) return
    if (displayed === null) {
      // Reprise après une erreur sur cette même clé.
      setDisplayed(serverData)
      setPendingItems([])
      return
    }
    // Lot global C1 : si une métadonnée hors-items change (ex.
    // expert_status.is_dnd), on applique en place IMMÉDIATEMENT et on vide
    // les pending. Indépendant de holdNewItems. Court-circuit avant tout
    // calcul de diff items.
    if (metadataHash) {
      const oldHash = metadataHash(displayed)
      const newHash = metadataHash(serverData)
      if (oldHash !== newHash) {
        setDisplayed(serverData)
        setPendingItems([])
        return
      }
    }
    const newItems = itemsOf(serverData)
    const oldItems = itemsOf(displayed)
    if (newItems === null || oldItems === null) {
      // Couche items désactivée → on applique en place.
      setDisplayed(serverData)
      setPendingItems([])
      return
    }
    const oldByKey = new Map<string, Item>()
    for (const it of oldItems) oldByKey.set(identityOf(it), it)
    const newByKey = new Map<string, Item>()
    for (const it of newItems) newByKey.set(identityOf(it), it)

    let hasUpdates = false
    let hasDeletes = false
    const newlyAdded: Item[] = []

    for (const it of newItems) {
      const k = identityOf(it)
      const prev = oldByKey.get(k)
      if (!prev) {
        newlyAdded.push(it)
      } else if (versionOf) {
        if (versionOf(it) !== versionOf(prev)) hasUpdates = true
      }
    }
    for (const k of oldByKey.keys()) {
      if (!newByKey.has(k)) hasDeletes = true
    }

    if (!hasUpdates && !hasDeletes && newlyAdded.length === 0) {
      // Aucun changement métier → ne rien faire (économise un re-render).
      return
    }

    if (holdNewItems && newlyAdded.length > 0 && !hasUpdates && !hasDeletes) {
      // SEULEMENT des nouveautés → on les retient.
      setPendingItems((prev) => {
        const seen = new Set(prev.map(identityOf))
        const merged = [...prev]
        for (const it of newlyAdded) if (!seen.has(identityOf(it))) merged.push(it)
        return merged
      })
      return
    }

    // Sinon : applique en place. On reset les pending qui sont peut-être déjà
    // intégrés.
    setDisplayed(serverData)
    if (pendingItems.length > 0) {
      const stillPending = pendingItems.filter((p) => !newByKey.has(identityOf(p)))
      if (stillPending.length !== pendingItems.length) {
        setPendingItems(stillPending)
      }
    }
  // `key` / `isLoading` / `error` entrent dans les deps : ce sont eux qui
  // portent l'identité de la collection et la validité de la charge utile.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, isLoading, error, serverData])

  const applyPending = useCallback(() => {
    if (serverData === undefined) return
    setDisplayed(serverData)
    setPendingItems([])
  }, [serverData])

  const refresh = useCallback(async () => { await mutate() }, [mutate])

  const state: UseLiveResourceState = useMemo(() => {
    if (displayed !== null) return { kind: 'ready' }
    if (error) return { kind: 'error', message: error.message ?? 'Network error', status: (error as Error & { status?: number }).status }
    return { kind: 'loading' }
  }, [displayed, error])

  const isRevalidating = !!isValidating && displayed !== null
  return {
    state,
    data: displayed,
    isRevalidating,
    pendingCount: pendingItems.length,
    pendingItems,
    applyPending,
    refresh,
  }
}
