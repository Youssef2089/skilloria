'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import OrgSetupModal from '@/components/OrgSetupModal'
import OrganisationDashboard, {
  type OrganisationFull,
} from '@/components/dashboard/OrganisationDashboard'
import type { Annonce } from '@/types/annonce'

/**
 * Dashboard entreprise (B3.5 + B3.5.fix).
 *
 * Préserve la logique B3.4 :
 *   1. Charge l'org via RLS organization_members
 *   2. Si setup_completed_at IS NULL → affiche OrgSetupModal (bloquant)
 *   3. Fallback redirect /connexion si pas de session ou requête échoue
 *
 * Une fois setup OK, délègue le rendu à <OrganisationDashboard>.
 *
 * UNIFICATION DASHBOARD ORG (B3.5.fix) :
 *   `/dashboard/entreprise` est désormais l'unique dashboard organisation
 *   pour les 3 sous-types (client / esn / cabinet). `/dashboard/cabinet`
 *   redirige vers ici. La prop `basePath` du composant reste utile (les
 *   liens internes en dépendent), mais vaut toujours '/dashboard/entreprise'.
 *
 * `org_type` est sélectionné et transmis pour permettre la différenciation
 * future des fonctionnalités par sous-type dans OrganisationDashboard.
 *
 * Source des annonces (V1) : aucune table dédiée — voir types/annonce.ts.
 * On passe `annonces=[]` constant. La vraie table sera créée en B4+.
 */

type SetupState =
  | { kind: 'loading' }
  | { kind: 'needs_setup'; organization: OrganisationFull }
  | { kind: 'ready'; organization: OrganisationFull }
  | { kind: 'error' }

const ANNONCES_V1: Annonce[] = []

export default function DashboardEntreprise() {
  const router = useRouter()
  const [state, setState] = useState<SetupState>({ kind: 'loading' })
  const [needsRedirect, setNeedsRedirect] = useState(false)

  const refresh = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.user) {
      setNeedsRedirect(true)
      return
    }
    const { data: memberRow, error } = await supabase
      .from('organization_members')
      .select(
        'organizations(id, company_name, logo_url, verification_status, setup_completed_at, org_type)',
      )
      .eq('user_id', session.user.id)
      .eq('status', 'active')
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[dashboard/entreprise] org lookup error', error.message)
      setState({ kind: 'error' })
      return
    }
    const orgRow = Array.isArray(memberRow?.organizations)
      ? memberRow.organizations[0]
      : memberRow?.organizations
    if (!orgRow) {
      setState({ kind: 'error' })
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
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (needsRedirect) {
      router.replace('/connexion')
    }
  }, [needsRedirect, router])

  if (state.kind === 'loading' || needsRedirect) {
    return (
      <div
        style={{
          padding: 48,
          textAlign: 'center',
          fontFamily: 'Inter, system-ui, sans-serif',
          color: '#64748b',
        }}
      >
        …
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div
        style={{
          padding: 48,
          textAlign: 'center',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <p style={{ fontSize: 14, color: '#b91c1c' }}>
          Une erreur est survenue. Veuillez vous reconnecter.
        </p>
      </div>
    )
  }

  return (
    <>
      <OrganisationDashboard
        organization={state.organization}
        basePath="/dashboard/entreprise"
        annonces={ANNONCES_V1}
      />
      {state.kind === 'needs_setup' && (
        <OrgSetupModal onComplete={() => void refresh()} />
      )}
    </>
  )
}
