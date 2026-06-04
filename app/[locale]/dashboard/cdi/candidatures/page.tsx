'use client'

import CandidaturesTrackingView from '@/components/dashboard/CandidaturesTrackingView'

/**
 * /dashboard/cdi/candidatures — wrapper thin (SC7b Lot UX Finitions 2, miroir
 * freelance). CandidaturesTrackingView avec side='cdi' rebase les hrefs
 * messages/missions vers /dashboard/cdi.
 */
export default function CdiCandidaturesPage() {
  return <CandidaturesTrackingView side="cdi" />
}
