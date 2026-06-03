'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'
import { useDomain } from '@/context/DomainContext'
import PublicationForm from '@/components/dashboard/PublicationForm'
import type { PublicationDraft } from '@/types/publication'

/**
 * /dashboard/entreprise/annonces/[id]/modifier — édition.
 *
 * Wrapper qui charge GET /api/publications/[id] puis monte PublicationForm
 * en mode edit avec l'`initial`. Gère 3 états : loading / error / ready.
 *
 * Hard guards côté serveur (ownership + status éditable) : si l'API renvoie
 * 403/404, on affiche le message correspondant et un bouton retour.
 */

type Props = { params: Promise<{ id: string }> }

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; initial: PublicationDraft }

export default function ModifierAnnoncePage({ params }: Props) {
  const t = useTranslations('publications')
  const router = useRouter()
  const secureFetch = useSecureFetch()
  const domain = useDomain()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const load = useCallback(async () => {
    const { id } = await params
    setState({ kind: 'loading' })
    try {
      const res = await secureFetch(`/api/publications/${encodeURIComponent(id)}`, {
        method: 'GET',
      })
      const payload = (await res.json().catch(() => ({} as { code?: string; publication?: PublicationDraft })))
      if (!res.ok) {
        const code = payload.code
        const msg =
          code === 'not_found' ? t('errors.not_found') :
          code === 'forbidden' ? t('errors.forbidden') :
          code === 'org_required' ? t('errors.org_required') :
          t('errors.generic')
        setState({ kind: 'error', message: msg })
        return
      }
      if (!payload.publication) {
        setState({ kind: 'error', message: t('errors.generic') })
        return
      }
      setState({ kind: 'ready', initial: payload.publication })
    } catch (err) {
      console.error('[modifier] fetch threw', err)
      setState({ kind: 'error', message: t('errors.generic') })
    }
  }, [params, secureFetch, t])

  useEffect(() => {
    void load()
  }, [load])

  if (state.kind === 'loading') {
    return (
      <div style={{ padding: 48, textAlign: 'center', fontFamily: 'Inter, sans-serif', color: '#64748b', fontSize: 14 }}>
        …
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 24px', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
        <p style={{ fontSize: 14, color: '#b91c1c', marginBottom: 18 }}>{state.message}</p>
        <button
          type="button"
          onClick={() => router.push('/dashboard/entreprise')}
          style={{
            padding: '10px 18px',
            background: domain.primaryColor,
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {t('form.button_back_to_list')}
        </button>
      </div>
    )
  }

  return <PublicationForm mode="edit" initial={state.initial} />
}
