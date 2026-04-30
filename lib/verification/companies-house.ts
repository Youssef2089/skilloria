import type { VerificationInput, VerificationOutput } from './types'

/**
 * Provider Companies House (UK) — STUB V1.
 *
 * Pattern provider ancré pour permettre de seeder un row
 * `verification_providers` (country_code='GB') dès maintenant
 * sans refacto applicatif futur.
 *
 * Implémentation réelle prévue en B5 (back-office admin) :
 *   - Endpoint : https://api.company-information.service.gov.uk/company/{number}
 *   - Auth : Basic <COMPANIES_HOUSE_API_KEY>
 *   - Mapping : `company_status='active'` → approved ; `dissolved` → rejected
 *
 * Pour l'instant on retourne `inconclusive` pour que le dispatcher passe
 * au provider suivant (typiquement le fallback IA).
 */

const PROVIDER_NAME = 'companies_house_uk'

export async function verifyWithCompaniesHouse(
  input: VerificationInput,
): Promise<VerificationOutput> {
  if (input.country_code !== 'GB') {
    return {
      provider_name: PROVIDER_NAME,
      result: 'inconclusive',
      confidence_score: 0,
      raw_response: { skipped: 'country_code_not_GB', country: input.country_code },
      notes: 'Companies House applicable uniquement pour GB',
    }
  }

  console.warn('[verification:companies-house] not yet implemented (stub V1)')

  return {
    provider_name: PROVIDER_NAME,
    result: 'inconclusive',
    confidence_score: 0,
    raw_response: { stub: true, todo: 'B5_implement_companies_house' },
    notes: 'Provider non implémenté en V1, fallback IA pris en charge ensuite',
  }
}
