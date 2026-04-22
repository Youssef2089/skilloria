import { headers } from 'next/headers'
import { DomainConfig, defaultDomainConfig } from '@/lib/domain-config'

export async function getDomainConfig(): Promise<DomainConfig> {
  const headersList = await headers()
  const subdomain = headersList.get('x-subdomain')

  if (!subdomain) {
    return defaultDomainConfig
  }

  return {
    ...defaultDomainConfig,
    subdomain,
  }
}
