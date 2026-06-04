'use client'

import { use } from 'react'
import MessagesInbox from '@/components/dashboard/MessagesInbox'

/**
 * /dashboard/cdi/messages/[id] — layout 2 panneaux avec conv pré-sélectionnée
 * (SC7b Lot UX Finitions 2, miroir freelance). Deep-link conservé pour notifs
 * et bookmarks.
 */
export default function CdiConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <MessagesInbox side="cdi" selectedConvId={id} />
}
