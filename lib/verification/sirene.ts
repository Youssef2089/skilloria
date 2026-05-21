import type { SireneData, VerificationInput, VerificationOutput } from './types'

/**
 * Provider INSEE Sirene v3.11 — fournisseur de données (11G).
 *
 * ⚠️ 11G — RÔLE NOUVEAU : Sirene est désormais un FOURNISSEUR DE DONNÉES,
 * pas un décideur. Il extrait les champs INSEE structurés (raison sociale,
 * forme juridique, APE, adresse, etc.) et les transmet à l'IA via
 * `VerificationOutput.structured_data`. Sirene retourne TOUJOURS
 * `result='inconclusive'` (il ne tranche jamais).
 *
 * La décision de cohérence (approved / pending_admin_review) est prise
 * par l'IA en aval, qui compare les données saisies aux données INSEE.
 *
 * Endpoint : `https://api.insee.fr/api-sirene/3.11/siret?q=siren:<siren>`
 * Auth     : `X-INSEE-Api-Key-Integration: <SIRENE_API_TOKEN>`
 *
 * Mapping `etatAdministratifUniteLegale` → seulement informatif (transmis à
 * l'IA) :
 *   - 'A' (Active)   : entreprise active à l'INSEE
 *   - 'C' (Cessée)   : entreprise dissoute (signal négatif fort à pondérer par l'IA)
 *   - autre / absent : statut non standard
 *
 * HTTP 404 / erreur réseau / 5xx → result='inconclusive' avec
 * structured_data=null. L'IA en aval tournera sur les données saisies seules.
 */

// TODO V2 : lire provider.api_endpoint depuis verification_providers au lieu
// de cette const locale. Nécessite refacto de la signature ProviderFn pour
// accepter le provider row. Cf. migration doc 20260513120000_doc_provider_endpoint_not_used.sql.
const SIRENE_BASE_URL = 'https://api.insee.fr/api-sirene/3.11'
const PROVIDER_NAME = 'sirene_insee'
const REQUEST_TIMEOUT_MS = 8_000

type SireneAdresse = {
  numeroVoieEtablissement?: string | null
  typeVoieEtablissement?: string | null
  libelleVoieEtablissement?: string | null
  codePostalEtablissement?: string | null
  libelleCommuneEtablissement?: string | null
}

type SireneUniteLegale = {
  etatAdministratifUniteLegale?: string | null
  denominationUniteLegale?: string | null
  sigleUniteLegale?: string | null
  prenom1UniteLegale?: string | null
  nomUniteLegale?: string | null
  categorieJuridiqueUniteLegale?: string | null
  activitePrincipaleUniteLegale?: string | null
  dateCreationUniteLegale?: string | null
  trancheEffectifsUniteLegale?: string | null
}

type SireneRow = {
  uniteLegale?: SireneUniteLegale
  adresseEtablissement?: SireneAdresse
}

type SireneResponse = {
  etablissements?: SireneRow[]
}

function buildAdresseComplete(a: SireneAdresse | undefined): string | null {
  if (!a) return null
  const parts = [
    a.numeroVoieEtablissement,
    a.typeVoieEtablissement,
    a.libelleVoieEtablissement,
    a.codePostalEtablissement,
    a.libelleCommuneEtablissement,
  ]
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0)
  if (parts.length === 0) return null
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function extractSireneData(json: SireneResponse | null): SireneData | null {
  const etab = json?.etablissements?.[0]
  if (!etab) return null
  const u = etab.uniteLegale ?? {}
  const denomination = u.denominationUniteLegale ?? null
  const prenom = (u.prenom1UniteLegale ?? '').trim()
  const nom = (u.nomUniteLegale ?? '').trim()
  const prenomNom = prenom || nom ? `${prenom} ${nom}`.trim() : null
  return {
    denomination,
    sigle: u.sigleUniteLegale ?? null,
    prenom_nom: prenomNom,
    etat_administratif: u.etatAdministratifUniteLegale ?? null,
    categorie_juridique: u.categorieJuridiqueUniteLegale ?? null,
    activite_principale: u.activitePrincipaleUniteLegale ?? null,
    date_creation: u.dateCreationUniteLegale ?? null,
    tranche_effectifs: u.trancheEffectifsUniteLegale ?? null,
    adresse_complete: buildAdresseComplete(etab.adresseEtablissement),
  }
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
      structured_data: null,
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
      structured_data: null,
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
      structured_data: null,
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
      structured_data: null,
    }
  }

  if (res.status === 404) {
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
      notes: 'SIREN inconnu chez l’INSEE — l’IA analysera les seules données saisies',
      structured_data: null,
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
      structured_data: null,
    }
  }

  const json = (await res.json().catch(() => null)) as SireneResponse | null
  const sireneData = extractSireneData(json)

  if (!sireneData) {
    return {
      provider_name: PROVIDER_NAME,
      result: 'inconclusive',
      confidence_score: 0,
      raw_response: json ?? {},
      notes: 'Réponse Sirene vide ou inattendue',
      structured_data: null,
    }
  }

  // 11G : Sirene NE TRANCHE PLUS — toujours 'inconclusive', juste enrichi
  // de structured_data pour que l'IA compare en aval. Le statut INSEE
  // (Active / Cessée / autre) est dans sireneData.etat_administratif et
  // sera évalué par l'IA.
  const etat = sireneData.etat_administratif
  const notes =
    etat === 'A'
      ? 'Données INSEE récupérées — entreprise active. L’IA va comparer avec les données saisies.'
      : etat === 'C'
        ? 'Données INSEE récupérées — entreprise marquée cessée. À pondérer par l’IA et l’admin.'
        : `Données INSEE récupérées (statut: ${etat ?? 'inconnu'}). À évaluer par l’IA.`

  return {
    provider_name: PROVIDER_NAME,
    result: 'inconclusive',
    confidence_score: 0,
    raw_response: json,
    notes,
    structured_data: sireneData,
  }
}
