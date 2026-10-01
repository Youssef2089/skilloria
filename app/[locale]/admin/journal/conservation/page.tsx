'use client'

import { useTranslations } from 'next-intl'
import PageHeader from '@/components/ui/PageHeader'
import ConservationJournal from '@/components/admin/journal/ConservationJournal'

/**
 * /admin/journal/conservation — COMBIEN DE TEMPS LE JOURNAL GARDE SES ÉCRITURES, ET LE NETTOYAGE (ARRÊT 22, §D.33).
 * Page de MENU (lib/nav-config.ts) : aucun bouton Retour. Séparée de la lecture du journal (décision de Youssef,
 * 01/10/2026) : on n'efface pas là où l'on enquête. Pleine largeur, alignée à gauche, la marge est celle de l'admin.
 */
export default function ConservationJournalPage() {
  const t = useTranslations('admin_back_office.conservation')
  return (
    <div style={{ width: '100%', textAlign: 'left', display: 'grid', gap: 16 }}>
      <PageHeader flush title={t('title')} subtitle={t('intro')} />
      <ConservationJournal />
    </div>
  )
}
