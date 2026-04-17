 'use client'

import { createContext, useContext } from 'react'
import { DomainConfig, defaultDomainConfig } from '@/lib/domain-config'

const DomainContext = createContext<DomainConfig>(defaultDomainConfig)

export function DomainProvider({
  children,
  config,
}: {
  children: React.ReactNode
  config: DomainConfig
}) {
  return (
    <DomainContext.Provider value={config}>
      {children}
    </DomainContext.Provider>
  )
}

export function useDomain() {
  return useContext(DomainContext)
}
