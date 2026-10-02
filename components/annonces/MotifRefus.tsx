'use client'

import { useTranslations } from 'next-intl'

/**
 * LE MOTIF D'UN REFUS, POUR L'AUTEUR DE L'ANNONCE (regroupement, ARRÊT 28 — la resoumission que S3 avait laissée).
 *
 * Une annonce refusée par l'administration se MODIFIE puis se soumet à nouveau : le texte modifié repasse par la
 * vérification automatique, et cette nouvelle soumission ne compte pas une seconde fois dans les publications du mois
 * (décision de Youssef). Ce bandeau dit le motif et ce qui suit, une écriture pour les quatre surfaces de l'auteur :
 * la fiche de l'annonce et son formulaire (organisation), la fiche et le formulaire du besoin de sous-traitance (expert).
 *
 * `motif` vient du serveur (`motif_refus`, servi seulement pour une annonce refusée) ; vide, rien ne s'affiche.
 */
export default function MotifRefus({ motif, avecSuite = true }: { motif: string | null | undefined; avecSuite?: boolean }) {
  const t = useTranslations('publications.refus')
  if (!motif || !motif.trim()) return null
  return (
    <div
      role="status"
      style={{
        background: 'var(--sk-red-soft)',
        border: '1px solid var(--sk-red-soft)',
        color: 'var(--sk-text)',
        padding: '12px 16px',
        borderRadius: 10,
        fontSize: 13,
        lineHeight: 1.5,
        marginBottom: 16,
      }}
    >
      <div style={{ fontWeight: 700, color: 'var(--sk-red)', marginBottom: 4 }}>{t('titre')}</div>
      <div style={{ whiteSpace: 'pre-wrap', marginBottom: avecSuite ? 6 : 0 }}>
        <span style={{ fontWeight: 600 }}>{t('motif')} </span>
        {motif}
      </div>
      {avecSuite && <div style={{ color: 'var(--sk-muted)' }}>{t('suite')}</div>}
    </div>
  )
}
