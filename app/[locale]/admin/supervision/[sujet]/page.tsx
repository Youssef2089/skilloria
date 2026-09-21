'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/supervision/[sujet] — OUVRIR UNE LIGNE.
 *
 * Un total ne permet d'agir sur rien. « Six mises en relation jamais tentées »
 * ne dit pas LESQUELLES, et c'est la seule chose qu'on veuille savoir en le
 * lisant. Cet écran répond à cette question, et à aucune autre : on n'y règle
 * rien.
 *
 * ⚠️ AUCUNE IDENTITÉ D'EXPERT N'EST AFFICHÉE ICI, et c'est le serveur qui le
 *    garantit (§D.4) : la route ne projette qu'un identifiant. Un écran de
 *    supervision n'a pas besoin de savoir QUI.
 */

type Ligne = Record<string, unknown>
type Reponse = { sujet: string; lignes: Ligne[]; limite: number; code?: string }

/** Les colonnes rendues, par sujet. Ordre volontaire : le QUOI avant le QUAND. */
const COLONNES: Record<string, string[]> = {
  inacheves: ['etat', 'title', 'published_at', 'matching_attempts', 'matching_attempted_at'],
  operations: ['created_at', 'action', 'provider', 'cost_usd', 'model', 'acteur_type', 'acteur_nom'],
  resumes: ['created_at', 'cause', 'surface', 'entity_id'],
  relances: ['created_at', 'origine', 'profile_id'],
}

const cellule: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 13,
  borderBottom: '1px solid var(--sk-border)',
  textAlign: 'left',
  verticalAlign: 'top',
}

/** Une valeur, rendue lisible sans jamais inventer. */
function afficher(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? '✓' : '—'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString()
  return String(v)
}

export default function SupervisionDetailPage({ params }: { params: Promise<{ sujet: string }> }) {
  // Next 16 : `params` est une promesse, résolue ici par `use()`.
  const { sujet } = use(params)
  const t = useTranslations('admin_back_office.supervision')
  const secureFetch = useSecureFetch()

  const [data, setData] = useState<Reponse | null>(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)

  const charger = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    try {
      const res = await secureFetch(`/api/admin/supervision/${encodeURIComponent(sujet)}`)
      const body = (await res.json()) as Reponse
      if (!res.ok) {
        // Un sujet inconnu se dit comme tel : ce n'est pas « rien à voir ».
        setErreur(body.code === 'unknown_subject' ? t('detail_unknown') : t('err_load'))
        return
      }
      setData(body)
    } catch {
      setErreur(t('err_load'))
    } finally {
      setChargement(false)
    }
  }, [secureFetch, sujet, t])

  useEffect(() => {
    void charger()
  }, [charger])

  const colonnes = COLONNES[sujet] ?? []

  return (
    <div style={{ width: '100%', textAlign: 'left' }}>
      <p style={{ margin: '0 0 10px' }}>
        <Link href="/admin/supervision" style={{ fontSize: 13, color: 'var(--sk-accent)' }}>
          {t('back')}
        </Link>
      </p>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px', color: 'var(--sk-text)' }}>
        {t(`detail_title.${sujet}` as 'detail_title.inacheves')}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: '0 0 20px', maxWidth: 720 }}>
        {t(`detail_intro.${sujet}` as 'detail_intro.inacheves')}
      </p>

      {chargement ? (
        <p style={{ fontSize: 13, color: 'var(--sk-muted)' }}>{t('loading')}</p>
      ) : erreur ? (
        <p role="alert" style={{ fontSize: 13, color: 'var(--sk-red)' }}>
          {erreur}
        </p>
      ) : (data?.lignes.length ?? 0) === 0 ? (
        /* VIDE EST UN ÉTAT, et ici c'est même une bonne nouvelle : rien à ouvrir. */
        <p style={{ fontSize: 13, color: 'var(--sk-muted)' }}>{t('detail_empty')}</p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
              <thead>
                <tr>
                  {colonnes.map((c) => (
                    <th
                      key={c}
                      style={{
                        ...cellule,
                        fontWeight: 600,
                        color: 'var(--sk-muted)',
                        fontSize: 12,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t(`column.${c}` as 'column.etat')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.lignes.map((l, i) => (
                  <tr key={String(l.id ?? i)}>
                    {colonnes.map((c) => (
                      <td key={c} style={cellule}>
                        {/* ⚠️ UN IDENTIFIANT DE BASE N'EST PAS UN NOM (§E.26).
                            `cause` et `surface` s'affichaient BRUTS —
                            « modele_indisponible », « reponse_illisible » —,
                            c'est-à-dire des clés, sur l'écran où un exploitant
                            décide. L'ancien écran les traduisait ; la refonte a
                            gardé la mesure et perdu ses libellés. */}
                        {c === 'etat'
                          ? t(`state.${String(l.etat)}` as 'state.jamais_tente')
                          : c === 'action' && l.action
                            ? t(`action.${String(l.action)}` as 'action.cv_parsing')
                            : c === 'cause' && l.cause
                              ? t(`cause.${String(l.cause)}` as 'cause.plafond')
                              : c === 'surface' && l.surface
                                ? t(`surface.${String(l.surface)}` as 'surface.candidature')
                                : c === 'origine' && l.origine
                                  ? t(`origine.${String(l.origine)}` as 'origine.profil_modifie')
                                  : afficher(l[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* LA LIMITE EST DITE. Une liste tronquée qui ne le dit pas fait
              croire qu'on a tout vu — et c'est sur ce genre d'écran qu'on
              décide de ne rien faire. */}
          {(data?.lignes.length ?? 0) >= (data?.limite ?? 0) && (
            <p style={{ fontSize: 12, color: 'var(--sk-faint)', marginTop: 12 }}>
              {t('detail_truncated', { limit: data?.limite ?? 0 })}
            </p>
          )}
        </>
      )}
    </div>
  )
}
