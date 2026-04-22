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
  featuredProducts: Array<{ label: string; icon: string }>
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
    expertLabel: 'experts Microsoft certifiés',
    communityLabel: 'écosystème Microsoft',
    specialityLabel: 'Spécialité Microsoft principale',
    domainSearchLabel: 'Domaine Microsoft recherché',
  },
  featuredProducts: [
    { label: 'Azure', icon: '☁️' },
    { label: 'Business Central', icon: '📊' },
    { label: 'Power BI', icon: '📈' },
    { label: 'Power Platform', icon: '⚡' },
    { label: 'D365 Finance & Ops', icon: '💼' },
    { label: 'SharePoint', icon: '🗂️' },
    { label: 'Copilot Studio', icon: '🤖' },
    { label: 'Azure DevOps', icon: '🔧' },
    { label: 'Dynamics CRM', icon: '🤝' },
    { label: 'Microsoft Fabric', icon: '🧵' },
  ],
}
