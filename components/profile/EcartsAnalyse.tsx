'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'
import { CODES_ECART, type Ecart } from '@/lib/profil/normaliser-analyse'

/**
 * CE QUE LA DERNIÈRE ANALYSE A RAMENÉ OU ÉCARTÉ — dit à l'expert, sur l'écran de
 * validation (§E.88, point 5 du mandat du 30/09/2026).
 *
 * Une valeur fautive d'un CV (une date « 2020-01 », une fin avant le début, un texte
 * trop long, une année hors bornes, une décimale) ne rejette plus l'analyse entière :
 * elle est ramenée ou écartée — et SIGNALÉE, ici. L'expert sait quoi relire, et la
 * liste dit « expérience 3 » comme il lit son CV (rang à partir de 1).
 *
 * Silencieux quand il n'y a rien, ou quand le suivi n'a pas pu être lu : une liste
 * qu'on n'a pas su lire ne se remplace pas par « rien à signaler » — on se tait.
 * Les DEUX voies le montent (§E.20).
 */
export default function EcartsAnalyse({ profileId }: { profileId: string | null }) {
  const t = useTranslations('ecarts_analyse')
  const secureFetch = useSecureFetch()
  const [ecarts, setEcarts] = useState<Ecart[]>([])

  useEffect(() => {
    if (!profileId) return
    let vivant = true
    void (async () => {
      try {
        const res = await secureFetch(`/api/profile/cv-status/${profileId}`, { method: 'GET' })
        if (!res.ok) return
        const p = (await res.json()) as { ecarts?: unknown[] }
        if (!vivant || !Array.isArray(p.ecarts)) return
        setEcarts(
          p.ecarts.filter(
            (e): e is Ecart =>
              !!e && typeof e === 'object' && (CODES_ECART as readonly string[]).includes((e as Ecart).code),
          ),
        )
      } catch {
        /* le suivi illisible : on se tait */
      }
    })()
    return () => {
      vivant = false
    }
  }, [profileId, secureFetch])

  if (ecarts.length === 0) return null
  return (
    <section
      role="status"
      style={{
        background: 'var(--sk-amber-soft)',
        border: '1px solid var(--sk-amber-soft)',
        borderRadius: 12,
        padding: '12px 16px',
        marginBottom: 20,
        fontSize: 13,
        color: 'var(--sk-amber)',
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{t('titre', { count: ecarts.length })}</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {ecarts.map((e, i) => (
          <li key={`${e.bloc}-${e.rang ?? 0}-${e.champ ?? ''}-${e.code}-${i}`}>
            {e.rang != null
              ? t('ligne_avec_rang', { bloc: t(`blocs.${e.bloc}`), rang: e.rang, motif: t(`codes.${e.code}`) })
              : t('ligne', { bloc: t(`blocs.${e.bloc}`), motif: t(`codes.${e.code}`) })}
          </li>
        ))}
      </ul>
    </section>
  )
}
