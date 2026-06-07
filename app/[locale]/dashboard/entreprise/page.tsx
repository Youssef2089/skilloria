'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import OrgSetupModal from '@/components/OrgSetupModal'
import OrganisationDashboard, {
  type OrganisationFull,
} from '@/components/dashboard/OrganisationDashboard'
import type { Annonce } from '@/types/annonce'
import { useLiveResource } from '@/hooks/useLiveResource'
import { dashboardUrlForUserType } from '@/lib/auth-routing'

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
 * Source des annonces (Lot 1b.1) : GET /api/publications via useSecureFetch.
 * La route applique RLS publications_member_read côté service_role + projection
 * DTO Annonce sans aucun champ sensible. Comptages candidatures = 0 V1
 * (Lot 2 branchera l'agrégat).
 */

type SetupState =
  | { kind: 'loading' }
  | { kind: 'needs_setup'; organization: OrganisationFull }
  | { kind: 'ready'; organization: OrganisationFull }
  | { kind: 'session_expired' }
  | { kind: 'no_org' }
  | { kind: 'error'; message?: string }

export default function DashboardEntreprise() {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('dashboard_entreprise')
  const tCommon = useTranslations('common')
  const [state, setState] = useState<SetupState>({ kind: 'loading' })
  const [needsRedirect, setNeedsRedirect] = useState(false)

  /**
   * Distingue les 3 branches d'erreur après la query org :
   *   1. JWT/session expirée → kind: 'session_expired' (bouton 'se reconnecter')
   *   2. User n'a pas d'org → redirect par user_type (expert → /freelance,
   *      admin → /admin, autres → /)
   *   3. Vraie erreur technique → kind: 'error' avec message
   */
  function classifyError(errorMessage: string | null | undefined): 'session_expired' | 'error' {
    if (!errorMessage) return 'error'
    const m = errorMessage.toLowerCase()
    if (m.includes('jwt') || m.includes('expired') || m.includes('invalid_token') || m.includes('unauthorized')) {
      return 'session_expired'
    }
    return 'error'
  }

  async function redirectByUserType(userId: string): Promise<void> {
    const { data: u } = await supabase.from('users').select('user_type').eq('id', userId).maybeSingle()
    const userType = (u as { user_type?: string | null } | null)?.user_type ?? null
    // Source unique de routage par rôle (lib/auth-routing.ts).
    // expert_cdi → /dashboard/cdi (avant fix : /dashboard/freelance par erreur).
    if (userType === 'expert_freelance' || userType === 'expert_cdi') {
      router.replace(dashboardUrlForUserType(userType))
    } else if (userType === 'admin') {
      router.replace('/admin')
    } else {
      router.replace('/')
    }
  }

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
      const kind = classifyError(error.message)
      setState(kind === 'session_expired' ? { kind: 'session_expired' } : { kind: 'error', message: error.message })
      return
    }
    const orgRow = Array.isArray(memberRow?.organizations)
      ? memberRow.organizations[0]
      : memberRow?.organizations
    if (!orgRow) {
      // Branche no_org : user authentifié mais sans organisation. Redirect par
      // user_type (expert_* → /dashboard/freelance, admin → /admin, autres → /).
      setState({ kind: 'no_org' })
      void redirectByUserType(session.user.id)
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

  // Lot bascule badges par item : plus de markSectionVisited. annonces_org
  // = alias de candidatures_org côté /api/me/badges → décrément automatique
  // quand l'org consulte/marque ses candidatures sur la page candidatures.

  useEffect(() => {
    if (needsRedirect) {
      router.replace('/connexion')
    }
  }, [needsRedirect, router])

  // Chargement annonces via useLiveResource (SWR + diff). Plus de reset
  // 'loading' au poll : data précédente reste affichée pendant la revalidation
  // → fin du flicker dashboard entreprise.
  // holdNewItems=false : pas pertinent ici (les status changes doivent
  // apparaître direct, et la liste annonces est déjà compacte).
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

  if (state.kind === 'session_expired') {
    return (
      <div style={{ padding: 48, textAlign: 'center', fontFamily: 'Inter, system-ui, sans-serif', maxWidth: 480, margin: '0 auto' }}>
        <div style={{ fontSize: 32, marginBottom: 14 }} aria-hidden>🔒</div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>{t('errors.session_expired_title')}</h1>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20, lineHeight: 1.6 }}>{t('errors.session_expired_body')}</p>
        <button
          type="button"
          onClick={async () => { await supabase.auth.signOut(); router.replace('/connexion') }}
          style={{ padding: '10px 20px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {t('errors.reconnect_cta')}
        </button>
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div style={{ padding: 48, textAlign: 'center', fontFamily: 'Inter, system-ui, sans-serif', maxWidth: 480, margin: '0 auto' }}>
        <div style={{ fontSize: 32, marginBottom: 14 }} aria-hidden>⚠️</div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>{t('errors.technical_title')}</h1>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20, lineHeight: 1.6 }}>{t('errors.technical_body')}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          style={{ padding: '10px 20px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {tCommon('retry')}
        </button>
      </div>
    )
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
