import type { SireneData, VerificationInput, VerificationOutput } from './types'

/**
 * Provider INSEE Sirene v3.11 — fournisseur de données (11G + fix retry).
 *
 * ⚠️ 11G — RÔLE : Sirene est un FOURNISSEUR DE DONNÉES, pas un décideur.
 * Il extrait les champs INSEE structurés et les transmet à l'IA via
 * `VerificationOutput.structured_data`. `result` est TOUJOURS
 * `'inconclusive'` ou `'error'` selon que l'appel a réussi ou non.
 *
 * Fix Sirene (D1/D2) — robustesse :
 *   - Timeout passé à 25s (l'API INSEE est lente, runVerification est
 *     asynchrone → pas de pression sur l'user)
 *   - 1 retry automatique sur cas TRANSIENT (timeout/abort, réseau,
 *     HTTP 5xx, 429) avec pause adaptée (800ms pour le réseau, 2000ms
 *     pour 429 pour respecter le rate limit)
 *   - PAS de retry sur 401/403 (auth KO) ni 404 (cas légitime)
 *   - `raw_response.attempts[]` trace chaque tentative pour audit
 *
 * Le dispatcher (lib/verification/index.ts) ne logue qu'UN seul row
 * dans `verification_attempts` par appel à `verifyWithSirene` — le détail
 * des sous-tentatives est dans `raw_response.attempts`.
 */

const SIRENE_BASE_URL = 'https://api.insee.fr/api-sirene/3.11'
const PROVIDER_NAME = 'sirene_insee'
const REQUEST_TIMEOUT_MS = 25_000
const MAX_ATTEMPTS = 2 // 1 + 1 retry
const RETRY_PAUSE_NETWORK_MS = 800
const RETRY_PAUSE_RATE_LIMIT_MS = 2_000

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

/** Trace d'une tentative HTTP — versée dans raw_response.attempts[]. */
type AttemptTrace = {
  attempt: number
  outcome: 'ok' | 'not_found' | 'aborted' | 'network_error' | 'http_error'
  http_status?: number
  error_message?: string
  duration_ms: number
}

/** Décision finale du provider après toutes les tentatives. */
type SireneFetchResult =
  | { kind: 'ok'; json: SireneResponse | null; attempts: AttemptTrace[] }
  | { kind: 'not_found'; body: string; attempts: AttemptTrace[] }
  | { kind: 'error'; reason: string; attempts: AttemptTrace[] }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

/**
 * Effectue les tentatives HTTP avec retry sur transient errors.
 * Retry sur : AbortError (timeout), erreurs réseau, HTTP 5xx, 429.
 * PAS de retry sur : 401/403 (auth KO), 404 (légitime), 200 OK.
 */
async function fetchSireneWithRetry(
  url: string,
  token: string,
): Promise<SireneFetchResult> {
  const attempts: AttemptTrace[] = []

  for (let attemptNum = 1; attemptNum <= MAX_ATTEMPTS; attemptNum++) {
    const start = Date.now()
    let res: Response | null = null
    let networkErrMsg: string | null = null

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
      networkErrMsg = err instanceof Error ? err.message : String(err)
    }

    const duration_ms = Date.now() - start

    // ── Cas 1 : abort/network error ───────────────────────────────────────
    if (networkErrMsg !== null) {
      const isAbort = /abort|aborted/i.test(networkErrMsg)
      attempts.push({
        attempt: attemptNum,
        outcome: isAbort ? 'aborted' : 'network_error',
        error_message: networkErrMsg.slice(0, 500),
        duration_ms,
      })
      if (attemptNum < MAX_ATTEMPTS) {
        await sleep(RETRY_PAUSE_NETWORK_MS)
        continue
      }
      return {
        kind: 'error',
        reason: isAbort
          ? `Timeout après ${MAX_ATTEMPTS} tentative(s) (${REQUEST_TIMEOUT_MS / 1000}s chacune)`
          : `Erreur réseau Sirene après ${MAX_ATTEMPTS} tentative(s) — ${networkErrMsg.slice(0, 200)}`,
        attempts,
      }
    }

    // ── Cas 2 : 404 légitime (jamais de retry) ────────────────────────────
    if (res!.status === 404) {
      const body = await res!.text().catch(() => '')
      attempts.push({
        attempt: attemptNum,
        outcome: 'not_found',
        http_status: 404,
        duration_ms,
      })
      return { kind: 'not_found', body: body.slice(0, 1000), attempts }
    }

    // ── Cas 3 : 401 / 403 (auth — jamais de retry) ────────────────────────
    if (res!.status === 401 || res!.status === 403) {
      const body = await res!.text().catch(() => '')
      attempts.push({
        attempt: attemptNum,
        outcome: 'http_error',
        http_status: res!.status,
        error_message: body.slice(0, 200),
        duration_ms,
      })
      return {
        kind: 'error',
        reason: `Auth Sirene refusée (HTTP ${res!.status}) — vérifier SIRENE_API_TOKEN`,
        attempts,
      }
    }

    // ── Cas 4 : 429 (rate limit — retry avec pause longue) ────────────────
    if (res!.status === 429) {
      const body = await res!.text().catch(() => '')
      attempts.push({
        attempt: attemptNum,
        outcome: 'http_error',
        http_status: 429,
        error_message: body.slice(0, 200),
        duration_ms,
      })
      if (attemptNum < MAX_ATTEMPTS) {
        await sleep(RETRY_PAUSE_RATE_LIMIT_MS)
        continue
      }
      return {
        kind: 'error',
        reason: `Rate limit Sirene (HTTP 429) après ${MAX_ATTEMPTS} tentative(s)`,
        attempts,
      }
    }

    // ── Cas 5 : 5xx (indispo INSEE — retry avec pause courte) ─────────────
    if (res!.status >= 500 && res!.status < 600) {
      const body = await res!.text().catch(() => '')
      attempts.push({
        attempt: attemptNum,
        outcome: 'http_error',
        http_status: res!.status,
        error_message: body.slice(0, 200),
        duration_ms,
      })
      if (attemptNum < MAX_ATTEMPTS) {
        await sleep(RETRY_PAUSE_NETWORK_MS)
        continue
      }
      return {
        kind: 'error',
        reason: `Indisponibilité Sirene (HTTP ${res!.status}) après ${MAX_ATTEMPTS} tentative(s)`,
        attempts,
      }
    }

    // ── Cas 6 : autres HTTP non-OK (jamais de retry) ──────────────────────
    if (!res!.ok) {
      const body = await res!.text().catch(() => '')
      attempts.push({
        attempt: attemptNum,
        outcome: 'http_error',
        http_status: res!.status,
        error_message: body.slice(0, 200),
        duration_ms,
      })
      return {
        kind: 'error',
        reason: `Erreur INSEE HTTP ${res!.status}`,
        attempts,
      }
    }

    // ── Cas 7 : 200 OK ────────────────────────────────────────────────────
    const json = (await res!.json().catch(() => null)) as SireneResponse | null
    attempts.push({
      attempt: attemptNum,
      outcome: 'ok',
      http_status: 200,
      duration_ms,
    })
    return { kind: 'ok', json, attempts }
  }

  // Boucle terminée sans return — ne devrait pas arriver, fallback safe
  return {
    kind: 'error',
    reason: 'Boucle de retry terminée sans verdict (incohérent)',
    attempts,
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
  const fetchResult = await fetchSireneWithRetry(url, token)

  if (fetchResult.kind === 'not_found') {
    console.warn('[verification:sirene] 404 (SIREN unknown)', {
      siren,
      attempts: fetchResult.attempts,
    })
    return {
      provider_name: PROVIDER_NAME,
      result: 'inconclusive',
      confidence_score: 0,
      raw_response: { http_status: 404, body: fetchResult.body, attempts: fetchResult.attempts },
      notes: 'SIREN non trouvé via l’endpoint INSEE consulté — non confirmé',
      structured_data: null,
    }
  }

  if (fetchResult.kind === 'error') {
    console.warn('[verification:sirene] fetch failed', {
      siren,
      reason: fetchResult.reason,
      attempts: fetchResult.attempts,
    })
    return {
      provider_name: PROVIDER_NAME,
      result: 'error',
      confidence_score: 0,
      raw_response: { error: fetchResult.reason, attempts: fetchResult.attempts },
      notes: fetchResult.reason,
      structured_data: null,
    }
  }

  // ── fetchResult.kind === 'ok' ───────────────────────────────────────────
  const sireneData = extractSireneData(fetchResult.json)
  if (!sireneData) {
    return {
      provider_name: PROVIDER_NAME,
      result: 'inconclusive',
      confidence_score: 0,
      raw_response: { json: fetchResult.json ?? {}, attempts: fetchResult.attempts },
      notes: 'Réponse Sirene vide ou inattendue',
      structured_data: null,
    }
  }

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
    raw_response: { json: fetchResult.json, attempts: fetchResult.attempts },
    notes,
    structured_data: sireneData,
  }
}
