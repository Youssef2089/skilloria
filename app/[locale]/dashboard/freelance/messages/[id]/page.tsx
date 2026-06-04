'use client'

import { use } from 'react'
import MessagesInbox from '@/components/dashboard/MessagesInbox'

/**
 * /dashboard/freelance/messages/[id] — layout 2 panneaux avec conv
 * pré-sélectionnée (Point 6 finitions UX). Le deep link reste fonctionnel
 * (URL conservée pour notifs + bookmarks).
 */
export default function FreelanceConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <MessagesInbox side="freelance" selectedConvId={id} />
}
