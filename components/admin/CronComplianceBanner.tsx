'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * Bandeau « CONFORMITÉ SUSPENDUE » — monté dans le layout /admin, donc présent
 * sur TOUTES les pages du back-office.
 *
 * POURQUOI DANS LE LAYOUT ET PAS SUR L'ÉCRAN DES TÂCHES
 *   Une obligation légale désactivée est justement la chose qu'on n'ira pas
 *   vérifier spontanément. Si le bandeau ne vivait que sur
 *   /admin/taches-planifiees, il faudrait déjà soupçonner le problème pour le
 *   voir. Le bandeau doit trouver l'administrateur, pas l'inverse.
 *
 *   Corollaire : l'écran des tâches ne rend PAS son propre bandeau. Un seul
 *   bandeau, un seul endroit — même raisonnement que le bouton Retour global.
 *
 * NE CASSE JAMAIS LE LAYOUT
 *   Toute erreur (403, migration non poussée, réseau) → on ne rend RIEN. Un
 *   bandeau d'alerte qui empêcherait d'afficher le back-office serait pire que
 *   le problème qu'il signale. Le silence ici n'est pas un silence sur l'état
 *   des tâches : l'écran dédié, lui, dit explicitement ce qui ne va pas.
 */

type CronJobLite = {
  job_name: string
  label_key: string | null
  health: string
}

export default function CronComplianceBanner() {
  const t = useTranslations('admin_back_office.cron')
  const secureFetch = useSecureFetch()
  const [disabled, setDisabled] = useState<CronJobLite[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await secureFetch('/api/admin/cron-jobs', { method: 'GET' })
        if (!res.ok) return
        const payload = (await res.json()) as { jobs?: CronJobLite[] }
        if (cancelled) return
        setDisabled((payload.jobs ?? []).filter((j) => j.health === 'legal_disabled'))
      } catch {
        /* le bandeau reste absent — voir § NE CASSE JAMAIS LE LAYOUT */
      }
    })()
    return () => { cancelled = true }
  }, [secureFetch])

  if (disabled.length === 0) return null

  const names = disabled
    .map((j) => (j.label_key ? t(j.label_key as 'title') : j.job_name))
    .join(', ')

  return (
    <div
      role="alert"
      style={{
        marginBottom: 18, padding: '14px 18px', borderRadius: 12,
        background: '#FEE2E2', border: '1.5px solid #FCA5A5', color: '#991B1B',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: '#DC2626' }} />
        <strong style={{ fontSize: 14, fontWeight: 700 }}>{t('banner_title')}</strong>
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
        {t('banner_body', { count: disabled.length, jobs: names })}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 4, opacity: 0.9 }}>
        {t('banner_hint')}
      </div>
      <Link
        href="/admin/taches-planifiees"
        style={{
          display: 'inline-block', marginTop: 10, fontSize: 13, fontWeight: 700,
          color: '#991B1B', textDecoration: 'underline',
        }}
      >
        {t('banner_action')}
      </Link>
    </div>
  )
}
