'use client'

import { use } from 'react'
import ConversationView from '@/components/dashboard/ConversationView'

export default function FreelanceConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <ConversationView convId={id} side="freelance" />
}
