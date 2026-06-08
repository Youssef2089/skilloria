'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import OrgSetupModal from '@/components/OrgSetupModal'
import OrganisationDashboard, {
  type OrganisationFull,
} from '@/components/dashboard/OrganisationDashboard'
import type { Annonce } from '@/types/annonce'
import { useLiveResource } from '@/hooks/useLiveResource'

/**
 * /dashboard/entreprise/annonces — page "Mes annonces" (Lot refonte
 * dashboard org).
 *
 * Cette page reprend le rôle historique de l'ex `/dashboard/entreprise` :
 * lister les annonces de l'org avec onglets de statut, recherche, et
 * compteurs entonnoir par annonce. Le tableau de bord (`/dashboard/entreprise`)
 * devient un dashboard de SUIVI distinct (2 blocs publications + candidatures).
 *
 * Implémentation : on délègue à `<OrganisationDashboard>` qui contient déjà
 * toute la mécanique (chargement live, onglets, recherche, grille de cards).
 * Le `basePath` reste '/dashboard/entreprise' pour les liens internes
 * (annonces/nouvelle, annonces/[id], etc.).
 */

type SetupState =
  | { kind: 'loading' }
  | { kind: 'needs_setup'; organization: OrganisationFull }
  | { kind: 'ready'; organization: OrganisationFull }
  | { kind: 'session_expired' }
  | { kind: 'no_org' }
  | { kind: 'error'; message?: string }

export default function MesAnnoncesPage() {
  const router = useRouter()
  const locale = useLocale()
  const [state, setState] = useState<SetupState>({ kind: 'loading' })
  const [needsRedirect, setNeedsRedirect] = useState(false)

  const refresh = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      setNeedsRedirect(true)
      return
    }
    const { data: memberRow, error } = await supabase
      .from('organization_members')
      .select('organizations(id, company_name, logo_url, verification_status, setup_completed_at, org_type)')
      .eq('user_id', session.user.id)
      .eq('status', 'active')
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[entreprise/annonces] org lookup error', error.message)
      const m = (error.message ?? '').toLowerCase()
      if (m.includes('jwt') || m.includes('expired') || m.includes('invalid_token') || m.includes('unauthorized')) {
        setState({ kind: 'session_expired' })
      } else {
        setState({ kind: 'error', message: error.message })
      }
      return
    }
    const orgRow = Array.isArray(memberRow?.organizations)
      ? memberRow.organizations[0]
      : memberRow?.organizations
    if (!orgRow) {
      setState({ kind: 'no_org' })
      router.replace('/dashboard/entreprise')
      return
    }
    const organization: OrganisationFull = {
      id: (orgRow as { id: string }).id,
      company_name: (orgRow as { company_name: string | null }).company_name ?? null,
      logo_url: (orgRow as { logo_url: string | null }).logo_url ?? null,
      verification_status:
        (orgRow as { verification_status: string | null }).verification_status ?? null,
      setup_completed_at:
        (orgRow as { setup_completed_at: string | null }).setup_completed_at ?? null,
      org_type: (orgRow as { org_type: string | null }).org_type ?? null,
    }
    setState(
      organization.setup_completed_at
        ? { kind: 'ready', organization }
        : { kind: 'needs_setup', organization },
    )
  }, [router])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (needsRedirect) router.replace('/connexion')
  }, [needsRedirect, router])

  const annoncesUrl = state.kind === 'ready'
    ? `/api/publications?locale=${encodeURIComponent(locale)}`
    : null
  const annoncesLive = useLiveResource<{ publications: Annonce[] }, Annonce>({
    url: annoncesUrl,
    itemsOf: (d) => d.publications ?? [],
    identityOf: (a) => a.id,
    versionOf: (a) => a.published_at ?? a.created_at,
    holdNewItems: false,
  })

  if (state.kind === 'loading' || state.kind === 'no_org' || needsRedirect) {
    return (
      <div style={{ padding: 48, textAlign: 'center', fontFamily: 'Inter, system-ui, sans-serif', color: '#64748b' }}>
        …
      </div>
    )
  }
  if (state.kind === 'session_expired' || state.kind === 'error') {
    // Délègue le rendu de l'écran d'erreur au dashboard (logique identique).
    router.replace('/dashboard/entreprise')
    return null
  }

  const annonces: Annonce[] = annoncesLive.data?.publications ?? []
  return (
    <>
      <OrganisationDashboard
        organization={state.organization}
        basePath="/dashboard/entreprise"
        annonces={annonces}
      />
      {state.kind === 'needs_setup' && (
        <OrgSetupModal onComplete={() => void refresh()} />
      )}
    </>
  )
}
