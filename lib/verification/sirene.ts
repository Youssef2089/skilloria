import type { VerificationInput, VerificationOutput } from './types'

/**
 * Provider INSEE Sirene v3.11.
 *
 * Endpoint : `https://api.insee.fr/entreprises/sirene/V3.11/siret?q=siren:<siren>`
 * Auth : `Authorization: Bearer <SIRENE_API_TOKEN>`
 *
 * Mapping `etatAdministratifUniteLegale` :
 *   - 'A' (Active)        → result='approved', confidence=10
 *   - 'C' (Cessée)        → result='rejected', notes='entreprise dissoute' (Q5)
 *   - autre / absent      → result='inconclusive', confidence=0
 *
 * Erreurs réseau / 4xx / 5xx → result='error', confidence=0 (jamais throw,
 * pour ne pas faire crasher `register-org`).
 */

const SIRENE_BASE_URL = 'https://api.insee.fr/entreprises/sirene/V3.11'
const PROVIDER_NAME = 'sirene_insee'
const REQUEST_TIMEOUT_MS = 8_000

type SireneRow = {
  uniteLegale?: {
    etatAdministratifUniteLegale?: string
    denominationUniteLegale?: string | null
    sigleUniteLegale?: string | null
  }
}

type SireneResponse = {
  etablissements?: SireneRow[]
}

export async function verifyWithSirene(
  input: VerificationInput,
): Promise<VerificationOutput> {
  if (input.country_code !== 'FR') {
    return {
      provider_name: PROVIDER_NAME,
      result: 'inconclusive',
      confidence_score: 0,
      raw_response: { skipped: 'country_code_not_FR', country: input.country_code },
      notes: 'Sirene applicable uniquement pour FR',
    }
  }

  const siren = (input.siren ?? '').replace(/\s/g, '')
  if (!/^\d{9}$/.test(siren)) {
    return {
      provider_name: PROVIDER_NAME,
      result: 'inconclusive',
      confidence_score: 0,
      raw_response: { skipped: 'invalid_siren', siren },
      notes: 'SIREN absent ou format invalide (9 chiffres attendus)',
    }
  }

  const token = process.env.SIRENE_API_TOKEN
  if (!token) {
    console.error('[verification:sirene] SIRENE_API_TOKEN missing')
    return {
      provider_name: PROVIDER_NAME,
      result: 'error',
      confidence_score: 0,
      raw_response: { error: 'SIRENE_API_TOKEN missing' },
      notes: 'Token API non configuré',
    }
  }

  const url = `${SIRENE_BASE_URL}/siret?q=siren:${siren}&nombre=1`

  let res: Response
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
    clearTimeout(timeout)
  } catch (err) {
    console.error('[verification:sirene] fetch threw', { siren, err })
    return {
      provider_name: PROVIDER_NAME,
      result: 'error',
      confidence_score: 0,
      raw_response: { error: err instanceof Error ? err.message : String(err) },
      notes: 'Erreur réseau Sirene',
    }
  }

  if (res.status === 404) {
    return {
      provider_name: PROVIDER_NAME,
      result: 'rejected',
      confidence_score: 10,
      raw_response: { http_status: 404 },
      notes: 'SIREN inconnu chez l’INSEE',
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[verification:sirene] HTTP error', { siren, status: res.status })
    return {
      provider_name: PROVIDER_NAME,
      result: 'error',
      confidence_score: 0,
      raw_response: { http_status: res.status, body: text.slice(0, 500) },
      notes: `Erreur INSEE HTTP ${res.status}`,
    }
  }

  const json = (await res.json().catch(() => null)) as SireneResponse | null
  const etab = json?.etablissements?.[0]
  const etat = etab?.uniteLegale?.etatAdministratifUniteLegale

  if (etat === 'A') {
    return {
      provider_name: PROVIDER_NAME,
      result: 'approved',
      confidence_score: 10,
      raw_response: json,
      notes: 'Entreprise active à l’INSEE',
    }
  }
  if (etat === 'C') {
    return {
      provider_name: PROVIDER_NAME,
      result: 'rejected',
      confidence_score: 10,
      raw_response: json,
      notes: 'Entreprise dissoute à l’INSEE',
    }
  }

  return {
    provider_name: PROVIDER_NAME,
    result: 'inconclusive',
    confidence_score: 0,
    raw_response: json ?? {},
    notes: `Statut Sirene non standard : ${etat ?? 'absent'}`,
  }
}
