'use client'

import { useTranslations } from 'next-intl'
import { useDomain } from '@/context/DomainContext'

type ContractTypeKey = 'cdi' | 'cdd' | 'alternance'
type GeoMobilityKey = 'local' | 'regional' | 'national' | 'international'
type CompanySizeKey = 'startup' | 'pme' | 'eti' | 'grand_groupe'
type SectorKey =
  | 'banque'
  | 'retail'
  | 'industrie'
  | 'public'
  | 'sante'
  | 'education'
  | 'tech'
  | 'consulting'
  | 'energie'
  | 'transport'
type BenefitKey =
  | 'remote_full'
  | 'remote_partial'
  | 'health_insurance'
  | 'rtt'
  | 'training_budget'
  | 'stock_options'
  | 'meal_vouchers'
  | 'transport'
  | 'gym'

type Props = {
  contractTypes: string[] | null
  workModes: string[] | null
  geoMobility: string | null
  companySize: string[] | null
  sectors: string[] | null
  benefits: string[] | null
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '14px 0',
        borderBottom: '1px solid #f1f5f9',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#64748b',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
    </div>
  )
}

function Pill({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: `${color}14`,
        color,
        padding: '5px 12px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

export default function CdiPreferencesDisplay(props: Props) {
  const t = useTranslations('cdi_profile_view')
  const tWorkMode = useTranslations('profile_validation.sections.availability')
  const domain = useDomain()
  const c = domain.primaryColor

  const contractTypes = (props.contractTypes ?? []) as ContractTypeKey[]
  const workModes = props.workModes ?? []
  const geoMobility = props.geoMobility as GeoMobilityKey | null
  const companySize = (props.companySize ?? []) as CompanySizeKey[]
  const sectors = (props.sectors ?? []) as SectorKey[]
  const benefits = (props.benefits ?? []) as BenefitKey[]

  const hasContract = contractTypes.length > 0
  const hasWorkMode = workModes.length > 0
  const hasGeo = !!geoMobility
  const hasCompany = companySize.length > 0
  const hasSectors = sectors.length > 0
  const hasBenefits = benefits.length > 0

  if (!hasContract && !hasWorkMode && !hasGeo && !hasCompany && !hasSectors && !hasBenefits) {
    return (
      <div style={{ fontSize: 14, color: '#94a3b8', fontStyle: 'italic' }}>
        {t('empty_states.no_search_preferences')}
      </div>
    )
  }

  return (
    <div>
      {hasContract && (
        <Row label={t('labels.contract_types')}>
          {contractTypes.map(v => (
            <Pill key={v} color={c}>
              {t(`contract_types_options.${v}`)}
            </Pill>
          ))}
        </Row>
      )}
      {hasWorkMode && (
        <Row label={t('labels.work_mode')}>
          {workModes.map(v => {
            const key = v as 'remote' | 'onsite' | 'hybrid'
            const isKnown = key === 'remote' || key === 'onsite' || key === 'hybrid'
            return (
              <Pill key={v} color={c}>
                {isKnown ? tWorkMode(`work_mode_${key}`) : v}
              </Pill>
            )
          })}
        </Row>
      )}
      {hasGeo && geoMobility && (
        <Row label={t('labels.geo_mobility')}>
          <Pill color={c}>{t(`geo_mobility_options.${geoMobility}`)}</Pill>
        </Row>
      )}
      {hasCompany && (
        <Row label={t('labels.company_size')}>
          {companySize.map(v => (
            <Pill key={v} color={c}>
              {t(`company_size_options.${v}`)}
            </Pill>
          ))}
        </Row>
      )}
      {hasSectors && (
        <Row label={t('labels.sectors')}>
          {sectors.map(v => (
            <Pill key={v} color={c}>
              {t(`sectors_options.${v}`)}
            </Pill>
          ))}
        </Row>
      )}
      {hasBenefits && (
        <Row label={t('labels.benefits')}>
          {benefits.map(v => (
            <Pill key={v} color={c}>
              {t(`benefits_options.${v}`)}
            </Pill>
          ))}
        </Row>
      )}
    </div>
  )
}
