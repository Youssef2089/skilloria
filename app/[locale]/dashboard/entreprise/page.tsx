'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import OrgSetupModal from '@/components/OrgSetupModal'

type SetupState =
  | { kind: 'loading' }
  | { kind: 'needs_setup' }
  | { kind: 'ready' }
  | { kind: 'error' }

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
    // RLS organization_member_read autorise la lecture pour les membres actifs.
    const { data: memberRow, error } = await supabase
      .from('organization_members')
      .select('organizations(id, setup_completed_at)')
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
    setState(
      (orgRow as { setup_completed_at: string | null }).setup_completed_at
        ? { kind: 'ready' }
        : { kind: 'needs_setup' },
    )
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Redirection /connexion si pas de session — separée pour ne pas appeler
  // router.replace pendant le render (leçon B3.1).
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
      <div
        style={{
          padding: 48,
          textAlign: 'center',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#0f172a', marginBottom: 16 }}>
          Dashboard Entreprise
        </h1>
        <p style={{ fontSize: 15, color: '#64748b' }}>
          Cette section est en cours de construction.
        </p>
      </div>
      {state.kind === 'needs_setup' && (
        <OrgSetupModal onComplete={() => void refresh()} />
      )}
    </>
  )
}
