'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /dashboard/entreprise/offre — page « Mon offre » (Lot A).
 *
 * Remplace l'entrée « Factures et paiements » : Stripe n'est pas branché et
 * `transactions` est indexée sur user_id (inexploitable par organisation), donc
 * une page Factures n'aurait strictement rien à afficher. On montre à la place
 * ce qui EXISTE déjà : l'offre effective de l'org et sa consommation du mois.
 *
 * ⚠️ AUCUNE mention de facture, de paiement ni de moyen de paiement tant que
 * Stripe n'est pas branché — et pas de bouton « Changer d'offre » (le
 * libre-service viendra avec Stripe), seulement une ligne de contact.
 *
 * Les données viennent de GET /api/me/organisation/offre : `usage_peek` et
 * `getOrgEntitlements` sont service-role only, donc inatteignables en
 * client-direct.
 */

const fontJakarta = 'var(--font-jakarta), system-ui, sans-serif'

type Payload = {
  available: boolean
  reason?: string
  package?: { slug: string; name: string | null; price_monthly: number | null; currency: string }
  // null = illimité (convention entitlements.ts).
  limits?: {
    publicationsPerMonth: number | null
    activePublicationsMax: number | null
    revealedCandidatesPerPublication: number | null
    manualUnlocksPerMonth: number | null
  }
  usage?: { publications: number; manual_unlocks: number }
  period_start?: string
  package_valid_until?: string | null
}

/**
 * Limites → clés i18n du back-office. On NE recrée PAS de libellés : on
 * réutilise le mapping `feature_label_*` déjà traduit dans les 4 langues sous
 * `admin_back_office.packages` (cf. app/[locale]/admin/packages/[id]/page.tsx).
 */
const LIMIT_ROWS = [
  { key: 'publicationsPerMonth', labelKey: 'feature_label_publications_per_month' },
  { key: 'activePublicationsMax', labelKey: 'feature_label_active_publications_max' },
  { key: 'revealedCandidatesPerPublication', labelKey: 'feature_label_revealed_candidates_per_publication' },
  { key: 'manualUnlocksPerMonth', labelKey: 'feature_label_manual_unlocks_per_month' },
] as const

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
      <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{title}</h2>
      {children}
    </section>
  )
}

/** Ligne label / valeur, séparateur discret. */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 16,
        padding: '10px 0',
        borderBottom: '1px solid #f1f5f9',
        fontSize: 14,
      }}
    >
      <span style={{ color: '#475569' }}>{label}</span>
      <span style={{ color: '#0f172a', fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

/** Barre de consommation. `limit` null = illimité → pas de barre. */
function UsageRow({ label, used, limit, unlimitedLabel }: {
  label: string
  used: number
  limit: number | null
  unlimitedLabel: string
}) {
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const atLimit = limit != null && used >= limit
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 14, marginBottom: limit == null ? 0 : 8 }}>
        <span style={{ color: '#475569' }}>{label}</span>
        <span style={{ color: atLimit ? '#B45309' : '#0f172a', fontWeight: 600 }}>
          {limit == null ? `${used} · ${unlimitedLabel}` : `${used} / ${limit}`}
        </span>
      </div>
      {limit != null && (
        <div style={{ height: 6, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}>
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              borderRadius: 999,
              background: atLimit ? '#F59E0B' : 'var(--sk-accent, #0369a1)',
            }}
          />
        </div>
      )}
    </div>
  )
}

export default function MonOffrePage() {
  const t = useTranslations('dashboard_entreprise.offre')
  const tFeat = useTranslations('admin_back_office.packages')
  const locale = useLocale()
  const secureFetch = useSecureFetch()

  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; data: Payload }>({
    kind: 'loading',
  })

  const load = useCallback(async () => {
    try {
      const res = await secureFetch('/api/me/organisation/offre')
      if (!res.ok) {
        setState({ kind: 'error' })
        return
      }
      setState({ kind: 'ready', data: (await res.json()) as Payload })
    } catch (err) {
      console.error('[entreprise/offre] load failed', err)
      setState({ kind: 'error' })
    }
  }, [secureFetch])

  useEffect(() => { void load() }, [load])

  if (state.kind === 'loading') {
    return <div style={{ padding: 24, fontFamily: fontJakarta, color: '#64748b' }}>{t('loading')}</div>
  }
  if (state.kind === 'error') {
    return <div style={{ padding: 24, fontFamily: fontJakarta, color: '#991B1B' }}>{t('error_load')}</div>
  }
  if (!state.data.available) {
    return <div style={{ padding: 24, fontFamily: fontJakarta, color: '#64748b' }}>{t('unavailable')}</div>
  }

  const { package: pkg, limits, usage, package_valid_until: validUntil } = state.data

  // Prix : null ou 0 → « Gratuit » (V1 de lancement).
  const price = pkg?.price_monthly ?? null
  const priceLabel =
    price == null || Number(price) === 0
      ? t('free')
      : `${new Intl.NumberFormat(locale, { style: 'currency', currency: pkg?.currency || 'EUR' }).format(Number(price))} ${t('per_month')}`

  const validUntilLabel = validUntil
    ? t('valid_until', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(validUntil)) })
    : null

  return (
    // Pleine largeur, aligné gauche, padding 24px. Titre porté par la topbar.
    <div
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
      {/* ─── Offre courante ─────────────────────────────────────────────────── */}
      <Card title={t('current_plan')}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>
            {/* name null (lookup dégradé) → repli sur le slug, jamais vide. */}
            {pkg?.name || pkg?.slug}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#475569' }}>{priceLabel}</span>
        </div>

        {validUntilLabel && (
          <p style={{ margin: '10px 0 0', fontSize: 12.5, color: '#64748b' }}>{validUntilLabel}</p>
        )}

        {/* Pas de bouton « Changer d'offre » : le libre-service arrivera avec
            Stripe. Ligne de contact sobre en attendant. */}
        <p style={{ margin: '14px 0 0', fontSize: 13, color: '#475569' }}>{t('contact_to_change')}</p>
      </Card>

      {/* ─── Limites de l'offre (libellés du back-office) ───────────────────── */}
      <Card title={t('limits_title')}>
        <div>
          {LIMIT_ROWS.map(({ key, labelKey }) => {
            const v = limits?.[key] ?? null
            return (
              <Row
                key={key}
                label={tFeat(labelKey as 'feature_label_publications_per_month')}
                value={v == null ? t('unlimited') : v}
              />
            )
          })}
        </div>
      </Card>

      {/* ─── Consommation du mois ───────────────────────────────────────────── */}
      <Card title={t('usage_title')}>
        <div>
          <UsageRow
            label={t('usage_publications')}
            used={usage?.publications ?? 0}
            limit={limits?.publicationsPerMonth ?? null}
            unlimitedLabel={t('unlimited')}
          />
          <UsageRow
            label={t('usage_manual_unlocks')}
            used={usage?.manual_unlocks ?? 0}
            limit={limits?.manualUnlocksPerMonth ?? null}
            unlimitedLabel={t('unlimited')}
          />
        </div>
      </Card>
    </div>
  )
}
