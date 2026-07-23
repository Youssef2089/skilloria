'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /dashboard/entreprise/organisation — page « Mon entreprise » (Lot A).
 *
 * LECTURE : client-direct. La policy `organizations_member_read` couvre tous
 * les membres ACTIFS de l'org (n'importe quel rôle), et
 * `organization_members_select_self_or_org` laisse lire sa propre ligne — on
 * récupère donc rôle + org en une requête, comme le fait déjà
 * entreprise/annonces.
 *
 * ÉCRITURE : jamais client-direct. PATCH /api/me/organisation, qui refait la
 * garde admin côté serveur, applique une whitelist de champs et trace un
 * audit `organization_updated` (cf. commentaire de la route).
 *
 * ⚠️ LOGO : il n'existe aujourd'hui QUE deux buckets Storage (`cv`, `avatars`),
 * et les policies `avatars` sont scopées sur `(storage.foldername(name))[1] =
 * auth.uid()` — donc utilisateur, pas organisation. Aucun bucket `logos` n'est
 * disponible pour un fichier porté par l'ORG. Le Lot A n'introduisant aucune
 * migration, `logo_url` reste une SAISIE D'URL simple ; l'upload façon
 * AvatarUploadModal viendra avec le bucket dédié.
 */

const fontJakarta = 'var(--font-jakarta), system-ui, sans-serif'

/** CHECK organizations_size_check de la baseline. */
const SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'] as const

/** Champs éditables — miroir exact de la whitelist de PATCH /api/me/organisation. */
type EditableForm = {
  company_name: string
  sector: string
  size: string
  description: string
  website_url: string
  logo_url: string
}

type Org = {
  id: string
  company_name: string | null
  org_type: string | null
  siren: string | null
  vat_number: string | null
  sector: string | null
  country: string | null
  size: string | null
  description: string | null
  logo_url: string | null
  website_url: string | null
  email_domain: string | null
  is_verified: boolean | null
  verification_status: string | null
  review_reason: string | null
}

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'no_org' }
  | { kind: 'ready'; org: Org; isAdmin: boolean }

const VERIF_STATUSES = [
  'approved',
  'pending_provider_check',
  'pending_admin_review',
  'rejected',
  'requires_more_info',
] as const

/** Palette du chip de statut — sobriété alignée sur le pattern expert. */
const CHIP_COLORS: Record<string, { bg: string; fg: string; bd: string }> = {
  approved: { bg: '#ECFDF5', fg: '#065F46', bd: '#A7F3D0' },
  pending_provider_check: { bg: '#FFFBEB', fg: '#92400E', bd: '#FDE68A' },
  pending_admin_review: { bg: '#FFFBEB', fg: '#92400E', bd: '#FDE68A' },
  requires_more_info: { bg: '#FFFBEB', fg: '#92400E', bd: '#FDE68A' },
  rejected: { bg: '#FEF2F2', fg: '#991B1B', bd: '#FECACA' },
  unknown: { bg: '#F1F5F9', fg: '#475569', bd: '#E2E8F0' },
}

// ─── primitives UI (alignées sur components/settings/SettingsView.tsx) ───────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>
      {children}
    </label>
  )
}

function Help({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.5, color: '#64748b' }}>{children}</p>
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: '#fff',
        border: '1.5px solid #eef2f7',
        borderRadius: 18,
        padding: 'clamp(18px, 3vw, 26px)',
      }}
    >
      <h2 style={{ margin: '0 0 18px', fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{title}</h2>
      {children}
    </section>
  )
}

/** Grille 2 colonnes qui retombe en 1 colonne sous ~640px. */
function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
      {children}
    </div>
  )
}

/** Champ en lecture seule (non éditable ou membre non-admin). */
function ReadOnlyField({ label, value, fallback }: { label: string; value: string | null; fallback: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <p
        style={{
          margin: 0,
          padding: '11px 13px',
          border: '1.5px solid #f1f5f9',
          background: '#f8fafc',
          borderRadius: 10,
          fontSize: 14,
          color: value ? '#0f172a' : '#94a3b8',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {value || fallback}
      </p>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '11px 13px',
  border: '1.5px solid #e2e8f0',
  borderRadius: 10,
  fontSize: 14,
  outline: 'none',
  fontFamily: fontJakarta,
  background: '#fff',
}

export default function MonEntreprisePage() {
  const t = useTranslations('dashboard_entreprise.organisation')
  const secureFetch = useSecureFetch()

  const [state, setState] = useState<State>({ kind: 'loading' })
  const [form, setForm] = useState<EditableForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const notify = useCallback((msg: string, kind: 'success' | 'error' = 'success') => {
    setToast({ msg, kind })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }, [])

  const hydrate = useCallback((org: Org) => {
    setForm({
      company_name: org.company_name ?? '',
      sector: org.sector ?? '',
      size: org.size ?? '',
      description: org.description ?? '',
      website_url: org.website_url ?? '',
      logo_url: org.logo_url ?? '',
    })
  }, [])

  // ── Chargement (client-direct, couvert par la RLS de lecture) ──────────────
  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      setState({ kind: 'error' })
      return
    }
    const { data: memberRow, error } = await supabase
      .from('organization_members')
      .select(
        'role_in_org, organizations(id, company_name, org_type, siren, vat_number, sector, country, size, description, logo_url, website_url, email_domain, is_verified, verification_status, review_reason)',
      )
      .eq('user_id', session.user.id)
      .eq('status', 'active')
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[entreprise/organisation] org lookup error', error.message)
      setState({ kind: 'error' })
      return
    }
    const orgRow = Array.isArray(memberRow?.organizations)
      ? memberRow.organizations[0]
      : memberRow?.organizations
    if (!orgRow) {
      setState({ kind: 'no_org' })
      return
    }
    const org = orgRow as unknown as Org
    hydrate(org)
    setState({ kind: 'ready', org, isAdmin: memberRow?.role_in_org === 'admin' })
  }, [hydrate])

  useEffect(() => { void load() }, [load])

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  const verifState = state.kind === 'ready' ? state.org.verification_status : null
  const chipKey = useMemo(
    () => ((VERIF_STATUSES as readonly string[]).includes(verifState ?? '') ? (verifState as string) : 'unknown'),
    [verifState],
  )

  // ── Enregistrement (toujours par la route serveur) ─────────────────────────
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (state.kind !== 'ready' || !form || saving) return
    if (!form.company_name.trim()) {
      notify(t('company_name_required'), 'error')
      return
    }
    setSaving(true)
    try {
      const res = await secureFetch('/api/me/organisation', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        notify(t('save_error'), 'error')
        return
      }
      const body = (await res.json()) as { organization: Org }
      setState({ kind: 'ready', org: body.organization, isAdmin: state.isAdmin })
      hydrate(body.organization)
      notify(t('saved'))
    } catch (err) {
      console.error('[entreprise/organisation] save failed', err)
      notify(t('save_error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (state.kind === 'loading') {
    return <div style={{ padding: 24, fontFamily: fontJakarta, color: '#64748b' }}>{t('loading')}</div>
  }
  if (state.kind === 'error') {
    return <div style={{ padding: 24, fontFamily: fontJakarta, color: '#991B1B' }}>{t('error_load')}</div>
  }
  if (state.kind === 'no_org') {
    return <div style={{ padding: 24, fontFamily: fontJakarta, color: '#64748b' }}>{t('no_org')}</div>
  }

  const { org, isAdmin } = state
  const f = form as EditableForm
  const set = (k: keyof EditableForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((prev) => (prev ? { ...prev, [k]: e.target.value } : prev))

  const orgTypeLabel =
    org.org_type === 'client' ? t('org_type_client')
      : org.org_type === 'cabinet' ? t('org_type_cabinet')
        : org.org_type === 'esn' ? t('org_type_esn')
          : null

  const chip = CHIP_COLORS[chipKey]

  return (
    // Pleine largeur, aligné gauche, padding 24px. Pas de PageHeader : le titre
    // « Mon entreprise » est porté par la topbar du DashboardShell (résolution
    // pathname → shell.page_titles.organisation) — même choix que SettingsView.
    <form
      onSubmit={onSubmit}
      style={{
        fontFamily: fontJakarta,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        width: '100%',
        padding: '24px 26px 28px',
        boxSizing: 'border-box',
      }}
    >
      {/* ─── Statut de vérification ─────────────────────────────────────────
          Réplique du pattern posé côté expert sur mon-profil : un chip sobre,
          et le motif de refus dans un bloc discret JUSTE EN DESSOUS — pas de
          bandeau pleine largeur. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: chip.bg,
            color: chip.fg,
            border: `1px solid ${chip.bd}`,
            borderRadius: 999,
            padding: '4px 12px',
            fontSize: 12.5,
            fontWeight: 700,
          }}
        >
          {t('verification_label')} · {t(`status_${chipKey}` as 'status_approved')}
        </span>

        {chipKey === 'rejected' && org.review_reason && (
          <div
            role="alert"
            style={{
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              color: '#991B1B',
              borderRadius: 10,
              padding: '10px 14px',
              fontSize: 13,
              lineHeight: 1.55,
              maxWidth: 560,
            }}
          >
            <span style={{ fontWeight: 700 }}>{t('rejected_reason_label')} </span>
            <span style={{ whiteSpace: 'pre-wrap' }}>{org.review_reason}</span>
          </div>
        )}

        {!isAdmin && (
          <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{t('read_only_notice')}</p>
        )}
      </div>

      {/* ─── Identité (éditable par un admin) ──────────────────────────────── */}
      <Card title={t('section_identity')}>
        <Grid>
          {isAdmin ? (
            <div>
              <Label>{t('field_company_name')}</Label>
              <input style={inputStyle} value={f.company_name} onChange={set('company_name')} maxLength={200} required />
            </div>
          ) : (
            <ReadOnlyField label={t('field_company_name')} value={org.company_name} fallback={t('not_set')} />
          )}

          {isAdmin ? (
            <div>
              <Label>{t('field_sector')}</Label>
              <input style={inputStyle} value={f.sector} onChange={set('sector')} maxLength={100} />
            </div>
          ) : (
            <ReadOnlyField label={t('field_sector')} value={org.sector} fallback={t('not_set')} />
          )}

          {isAdmin ? (
            <div>
              <Label>{t('field_size')}</Label>
              <select style={inputStyle} value={f.size} onChange={set('size')}>
                <option value="">{t('size_placeholder')}</option>
                {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          ) : (
            <ReadOnlyField label={t('field_size')} value={org.size} fallback={t('not_set')} />
          )}

          {/* country n'est pas dans la whitelist éditable : lecture seule. */}
          <ReadOnlyField label={t('field_country')} value={org.country} fallback={t('not_set')} />
        </Grid>
      </Card>

      {/* ─── Présentation (éditable par un admin) ──────────────────────────── */}
      <Card title={t('section_presentation')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {isAdmin ? (
            <div>
              <Label>{t('field_description')}</Label>
              <textarea
                style={{ ...inputStyle, minHeight: 120, resize: 'vertical', lineHeight: 1.55 }}
                value={f.description}
                onChange={set('description')}
              />
              <Help>{t('description_help')}</Help>
            </div>
          ) : (
            <ReadOnlyField label={t('field_description')} value={org.description} fallback={t('not_set')} />
          )}

          <Grid>
            {isAdmin ? (
              <div>
                <Label>{t('field_website_url')}</Label>
                <input style={inputStyle} value={f.website_url} onChange={set('website_url')} maxLength={500} inputMode="url" />
              </div>
            ) : (
              <ReadOnlyField label={t('field_website_url')} value={org.website_url} fallback={t('not_set')} />
            )}

            {isAdmin ? (
              <div>
                <Label>{t('field_logo_url')}</Label>
                <input style={inputStyle} value={f.logo_url} onChange={set('logo_url')} maxLength={500} inputMode="url" />
                <Help>{t('logo_url_help')}</Help>
              </div>
            ) : (
              <ReadOnlyField label={t('field_logo_url')} value={org.logo_url} fallback={t('not_set')} />
            )}
          </Grid>
        </div>
      </Card>

      {/* ─── Informations légales : JAMAIS éditables ────────────────────────
          Ces champs engagent la vérification légale (Sirene / Companies House
          + décision IA). Ils sont hors whitelist de la route PATCH. */}
      <Card title={t('section_legal')}>
        <Grid>
          <ReadOnlyField label={t('field_org_type')} value={orgTypeLabel} fallback={t('not_set')} />
          <ReadOnlyField label={t('field_siren')} value={org.siren} fallback={t('not_set')} />
          <ReadOnlyField label={t('field_vat_number')} value={org.vat_number} fallback={t('not_set')} />
          <ReadOnlyField label={t('field_email_domain')} value={org.email_domain} fallback={t('not_set')} />
        </Grid>
        <Help>{t('legal_help')}</Help>
      </Card>

      {isAdmin && (
        <div>
          <button
            type="submit"
            disabled={saving}
            style={{
              border: 'none',
              borderRadius: 10,
              padding: '11px 22px',
              fontSize: 14,
              fontWeight: 700,
              fontFamily: fontJakarta,
              color: '#fff',
              background: saving ? '#94a3b8' : 'var(--sk-accent, #0369a1)',
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      )}

      {toast && (
        <div
          role="status"
          style={{
            position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)', zIndex: 900,
            padding: '12px 20px', borderRadius: 12, fontSize: 14, fontWeight: 600, fontFamily: fontJakarta,
            color: '#fff', background: toast.kind === 'error' ? '#dc2626' : '#16a34a',
            boxShadow: '0 10px 30px rgba(15,23,42,0.2)',
          }}
        >
          {toast.msg}
        </div>
      )}
    </form>
  )
}
