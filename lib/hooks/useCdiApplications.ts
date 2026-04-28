'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type ApplicationItem = {
  id: string
  created_at: string | null
  status: string | null
}

export type UseCdiApplicationsState = {
  loading: boolean
  count: number
  items: ApplicationItem[]
}

const initialState: UseCdiApplicationsState = {
  loading: true,
  count: 0,
  items: [],
}

export function useCdiApplications(): UseCdiApplicationsState {
  const [state, setState] = useState<UseCdiApplicationsState>(initialState)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (cancelled) return
        if (!session) {
          setState({ loading: false, count: 0, items: [] })
          return
        }

        const { data, error } = await supabase
          .from('applications')
          .select('id, created_at, status')
          .eq('candidate_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(50)

        if (cancelled) return
        if (error) {
          setState({ loading: false, count: 0, items: [] })
          return
        }

        const items = (data ?? []) as ApplicationItem[]
        setState({ loading: false, count: items.length, items })
      } catch {
        if (cancelled) return
        setState({ loading: false, count: 0, items: [] })
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
