export type DomainConfig = {
  id: string
  subdomain: string
  name: string
  ecosystemName: string
  tagline: string
  primaryColor: string
  secondaryColor: string
  logoUrl: string | null
  faviconUrl: string | null
  isActive: boolean
  tags: string[]
  ecosystemTerms: {
    expertLabel: string
    communityLabel: string
    specialityLabel: string
    domainSearchLabel: string
  }
}

export const defaultDomainConfig: DomainConfig = {
  id: 'default',
  subdomain: 'microsoft',
  name: 'Skilloria 365',
  ecosystemName: 'Microsoft',
  tagline: 'For Microsoft Ecosystem Experts',
  primaryColor: '#0ea5e9',
  secondaryColor: '#6366f1',
  logoUrl: null,
  faviconUrl: null,
  isActive: true,
  tags: ['Azure', 'Dynamics 365', 'Power Platform', 'Power BI', 'SharePoint', 'Teams', 'Microsoft 365', 'Copilot', 'Fabric', 'SQL Server'],
  ecosystemTerms: {
    expertLabel: 'expert Microsoft certifié',
    communityLabel: 'écosystème Microsoft',
    specialityLabel: 'Spécialité Microsoft principale',
    domainSearchLabel: 'Domaine Microsoft recherché',
  },
}
