'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import EmptyState from '@/components/ui/EmptyState'
import CandidatureDetailPanel, { type Candidature } from '@/components/dashboard/CandidatureDetailPanel'
import { useMarkCandidatureViewed } from '@/lib/candidature-view-client'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * CandidatureDetailView — page de DÉTAIL d'une candidature (route dédiée
 * /dashboard/{side}/candidatures/[id], FL + CDI). Wrapper de fetch autour du
 * panneau partagé CandidatureDetailPanel (même rendu que le master-detail).
 *
 * Données : il n'existe pas d'endpoint single-candidature ; on lit la liste
 * `/api/me/candidatures` (déjà enrichie côté serveur, scope RLS = mes
 * candidatures) et on sélectionne par id → shape STRICTEMENT identique au
 * master-detail, zéro nouvel endpoint, aucune logique matching/messagerie.
 *
 * Pas de bouton Retour bespoke : c'est une page de détail sous DashboardShell,
 * le GlobalBackButton s'affiche tout seul (« Retour au tableau de bord » quand
 * on vient du dashboard). Marque la candidature consultée (parité master-detail).
 */

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'not_found' }
  | { kind: 'ready'; candidature: Candidature }

export default function CandidatureDetailView({
  candidatureId,
  side,
}: {
  candidatureId: string | null
  side: 'freelance' | 'cdi'
}) {
  const t = useTranslations('candidatures_tracking')
  const locale = useLocale()
  const secureFetch = useSecureFetch()
  const markCandidatureViewed = useMarkCandidatureViewed()
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    if (!candidatureId) return
    let cancelled = false
    setState({ kind: 'loading' })
    void (async () => {
      try {
        // `?filter=all` — OBLIGATOIRE ICI. Sans lui, `parseBucketFilter` retombe
        // sur 'active' et cette page annonçait « introuvable » sur une
        // candidature ARCHIVÉE qui existe bel et bien : un écran mort sur une
        // donnée présente. La notion de bucket n'a aucun sens sur une vue de
        // DÉTAIL désignée par son id — c'est une liste filtrée qui a des
        // onglets, pas une fiche.
        //
        // On élargit la RECHERCHE, jamais le périmètre : le bornage à
        // l'utilisateur vient de requireAuth + profiles.user_id +
        // candidatures.profile_id, côté serveur, indépendamment de `filter`
        // (appliqué APRÈS la requête, sur des lignes déjà bornées). L'état
        // « introuvable » reste donc atteignable pour les vrais cas — id
        // inexistant, candidature d'un autre utilisateur.
        //
        // Le `lifecycle` dérivé continue d'être servi et affiché : l'expert
        // voit que sa candidature est archivée, et pourquoi.
        const res = await secureFetch(`/api/me/candidatures?locale=${encodeURIComponent(locale)}&filter=all`, { method: 'GET' })
        if (!res.ok) { if (!cancelled) setState({ kind: 'error' }); return }
        const data = await res.json()
        const list: Candidature[] = data.candidatures ?? []
        const found = list.find((c) => c.id === candidatureId) ?? null
        if (cancelled) return
        setState(found ? { kind: 'ready', candidature: found } : { kind: 'not_found' })
      } catch {
        if (!cancelled) setState({ kind: 'error' })
      }
    })()
    return () => { cancelled = true }
  }, [candidatureId, locale, secureFetch])

  // Ouvrir le détail marque la candidature comme consultée (badge -1), comme
  // le clic sur un item du master-detail.
  useEffect(() => {
    if (candidatureId) void markCandidatureViewed(candidatureId)
  }, [candidatureId, markCandidatureViewed])

  if (state.kind === 'loading') {
    return <div style={{ padding: '24px 26px', color: 'var(--sk-muted)' }}>{t('loading')}</div>
  }
  if (state.kind === 'error') {
    return (
      <div style={{ padding: '24px 26px' }}>
        <EmptyState icon="⚠️" title={t('error_generic')} surface="card" />
      </div>
    )
  }
  if (state.kind === 'not_found') {
    return (
      <div style={{ padding: '24px 26px' }}>
        <EmptyState icon="📭" title={t('detail_not_found_title')} body={t('detail_not_found_body')} surface="card" />
      </div>
    )
  }
  return (
    <div style={{ padding: '24px 26px', maxWidth: 980 }}>
      <CandidatureDetailPanel candidature={state.candidature} side={side} />
    </div>
  )
}
