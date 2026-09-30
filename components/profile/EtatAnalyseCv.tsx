'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useSecureFetch } from '@/lib/secure-fetch'
import { sessionDuCompteAffiche } from '@/lib/identite/compte-affiche'
import { cleMessageDepotCv } from '@/lib/profil/refus-depot-cv'
import { suivreAnalyse } from '@/lib/profil/suivi-analyse'

/**
 * L'ÉTAT DE L'ANALYSE DU CV, EN TÊTE DE LA PAGE D'IMPORT (§D.30, décision de Youssef
 * du 30/09/2026 : le profil se remplit par le CV ou l'export LinkedIn).
 *
 * Toutes les entrées du tableau de bord (bandeau, « Compléter mon profil », étapes de
 * démarrage) mènent désormais ICI, à l'import. Un expert dont le document est déjà
 * analysé ne doit pas croire qu'il faut tout recommencer : ce bloc lui dit où il en
 * est — analysé (« Reprendre la validation »), en cours (suivi jusqu'à l'issue), ou
 * échoué (la cause, et quoi faire). Silencieux s'il n'y a encore rien.
 *
 * Les DEUX voies le montent (§E.20) ; seule l'adresse de validation diffère.
 */

type Etat =
  | { k: 'rien' }
  | { k: 'fait' }
  | { k: 'en_cours'; profileId: string }
  | { k: 'echoue'; code: string }

export default function EtatAnalyseCv({ validerHref }: { validerHref: string }) {
  const t = useTranslations('profile_upload')
  const router = useRouter()
  const secureFetch = useSecureFetch()
  const [etat, setEtat] = useState<Etat>({ k: 'rien' })

  useEffect(() => {
    let vivant = true
    const lire = async () => {
      const session = await sessionDuCompteAffiche()
      if (!session || session === 'ejecte') return
      const { data, error } = await supabase
        .from('profiles')
        .select('id, cv_parsing_status, cv_parsing_error')
        .eq('user_id', session.user.id)
        .maybeSingle()
      // Une lecture en panne : on se TAIT (l'import reste possible) — pas d'état inventé.
      if (error || !data || !vivant) return
      const p = data as { id: string; cv_parsing_status: string | null; cv_parsing_error: string | null }
      if (p.cv_parsing_status === 'done') setEtat({ k: 'fait' })
      else if (p.cv_parsing_status === 'processing') setEtat({ k: 'en_cours', profileId: p.id })
      else if (p.cv_parsing_status === 'failed') {
        const brut = (p.cv_parsing_error ?? '').trim()
        setEtat({ k: 'echoue', code: cleMessageDepotCv(brut) === 'inattendu' ? 'cv_parsing_failed' : brut })
      }
    }
    void lire()
    return () => {
      vivant = false
    }
  }, [])

  // Une analyse EN COURS se suit jusqu'à son issue, comme après un dépôt.
  useEffect(() => {
    if (etat.k !== 'en_cours') return
    let vivant = true
    void suivreAnalyse(secureFetch, etat.profileId).then((issue) => {
      if (!vivant) return
      if (issue.issue === 'aboutie') router.push(validerHref)
      else if (issue.issue === 'echouee') setEtat({ k: 'echoue', code: issue.code })
    })
    return () => {
      vivant = false
    }
  }, [etat, secureFetch, router, validerHref])

  if (etat.k === 'rien') return null

  const cadre = {
    border: '1px solid var(--sk-border)',
    background: 'var(--sk-surface)',
    borderRadius: 14,
    padding: '16px 18px',
    marginBottom: 18,
  } as const

  if (etat.k === 'fait') {
    return (
      <section role="status" style={cadre}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sk-text)', marginBottom: 4 }}>{t('etat_analyse.fait_titre')}</div>
        <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: '0 0 12px', lineHeight: 1.55 }}>{t('etat_analyse.fait_texte')}</p>
        <Link
          href={validerHref}
          style={{
            display: 'inline-block', padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 600,
            background: 'var(--sk-accent)', color: 'var(--sk-sur-accent)', textDecoration: 'none',
          }}
        >
          {t('etat_analyse.reprendre')}
        </Link>
      </section>
    )
  }
  if (etat.k === 'en_cours') {
    return (
      <section role="status" style={cadre}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sk-text)', marginBottom: 4 }}>{t('etat_analyse.en_cours_titre')}</div>
        <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: 0, lineHeight: 1.55 }}>{t('etat_analyse.en_cours_texte')}</p>
      </section>
    )
  }
  const cle = cleMessageDepotCv(etat.code)
  return (
    <section role="alert" style={{ ...cadre, border: '1px solid var(--sk-red-soft)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sk-red)', marginBottom: 4 }}>{t('etat_analyse.echoue_titre')}</div>
      <p style={{ fontSize: 13, color: 'var(--sk-text)', margin: 0, lineHeight: 1.55 }}>
        {cle === 'inattendu' ? t('errors.inattendu', { code: etat.code }) : t(`errors.${cle}` as 'errors.parsing_default')}
      </p>
    </section>
  )
}
