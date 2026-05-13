import type { VerificationInput, VerificationOutput } from './types'

/**
 * Provider INSEE Sirene v3.11 — nouveau portail (mai 2026).
 *
 * Endpoint : `https://api.insee.fr/api-sirene/3.11/siret?q=siren:<siren>`
 *   (l'ancien `api.insee.fr/entreprises/sirene/V3.11` est déprécié depuis
 *    février 2025)
 * Auth     : `X-INSEE-Api-Key-Integration: <SIRENE_API_TOKEN>`
 *   (l'ancien `Authorization: Bearer` n'est plus accepté sur le nouveau portail)
 *
 * Mapping `etatAdministratifUniteLegale` (aligné règle métier figée
 * "JAMAIS de rejected automatique") :
 *   - 'A' (Active)        → result='approved', confidence=10
 *   - 'C' (Cessée)        → result='inconclusive' (fallback IA + admin tranchent)
 *   - autre / absent      → result='inconclusive', confidence=0
 *
 * HTTP 404 (SIREN non trouvé) → result='inconclusive' (PAS rejected) — laisse
 * place au fallback IA. Le dispatcher (lib/verification/index.ts) ne shorte
 * plus sur un 'rejected' provider.
 *
 * Erreurs réseau / 4xx (sauf 404) / 5xx → result='error', confidence=0
 * (jamais throw, pour ne pas faire crasher `register-org`).
 */

// TODO V2 : lire provider.api_endpoint depuis verification_providers au lieu
// de cette const locale. Nécessite refacto de la signature ProviderFn pour
// accepter le provider row. Cf. migration doc 20260513120000_doc_provider_endpoint_not_used.sql.
const SIRENE_BASE_URL = 'https://api.insee.fr/api-sirene/3.11'
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
        // Nouveau portail Sirene (mai 2026) : header X-INSEE-Api-Key-Integration
        // remplace Bearer token. Cf. doc INSEE api-sirene/3.11.
        'X-INSEE-Api-Key-Integration': token,
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
    // 404 INSEE = SIREN non trouvé. Règle métier figée : JAMAIS de rejected
    // automatique → on remonte 'inconclusive' pour laisser place au fallback IA
    // (le dispatcher continuera la chaîne de providers).
    const text = await res.text().catch(() => '')
    console.warn('[verification:sirene] 404 (SIREN unknown)', {
      siren,
      body: text.slice(0, 1000),
    })
    return {
      provider_name: PROVIDER_NAME,
      result: 'inconclusive',
      confidence_score: 0,
      raw_response: { http_status: 404, body: text.slice(0, 1000) },
      notes: 'SIREN inconnu chez l’INSEE — fallback IA requis',
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.warn('[verification:sirene] HTTP error', {
      siren,
      status: res.status,
      body: text.slice(0, 1000),
    })
    return {
      provider_name: PROVIDER_NAME,
      result: 'error',
      confidence_score: 0,
      raw_response: { http_status: res.status, body: text.slice(0, 1000) },
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
    // Entreprise marquée cessée à l'INSEE. Règle métier figée : JAMAIS de
    // rejected automatique → on remonte 'inconclusive' pour laisser IA + admin
    // trancher (l'admin verra le drapeau et la note pour décider).
    return {
      provider_name: PROVIDER_NAME,
      result: 'inconclusive',
      confidence_score: 0,
      raw_response: json,
      notes: 'Sirene signale entreprise dissoute — IA + admin tranchent',
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
