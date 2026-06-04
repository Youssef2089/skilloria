'use client'

import { use } from 'react'
import MessagesInbox from '@/components/dashboard/MessagesInbox'

/**
 * /dashboard/entreprise/messages/[id] — layout 2 panneaux avec conv
 * pré-sélectionnée (Point 6 finitions UX).
 */
export default function EntrepriseConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <MessagesInbox side="entreprise" selectedConvId={id} />
}
