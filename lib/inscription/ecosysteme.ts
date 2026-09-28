import { resolveSubdomainFromHost } from '@/lib/subdomain'

/**
 * L'ÉCOSYSTÈME D'UNE INSCRIPTION PUBLIQUE, RÉELLEMENT RÉSOLU (checklist 2, §D.27).
 *
 * Il vient de l'HÔTE de la requête — `microsoft.skilloria.io` → `microsoft` — par le
 * même résolveur que le proxy. Jamais du corps de la requête, ni de `x-subdomain` :
 * les deux sont écrits par l'appelant, et la preuve signée porterait alors
 * l'écosystème qu'il a CHOISI, pas celui où il s'inscrit. L'écosystème résolu est
 * ensuite vérifié ACTIF par la base (`inscription_refus`, `invalid_domain`).
 *
 * DEUX ÉCHECS, DEUX NOMS (§E.22) : un hôte qui ne se résout pas (apex, IP) est un refus
 * de l'utilisateur (`hote_non_resolu` → 400 invalid_domain) ; un résolveur qui LÈVE —
 * en développement, `DEV_DOMAIN_SLUG` absente — est une panne de configuration
 * (`configuration` → 500 missing_env). Les confondre dirait « écosystème inconnu » à
 * quelqu'un dont l'écosystème existe.
 */
export type EcosystemeResolu =
  | { ok: true; slug: string }
  | { ok: false; raison: 'hote_non_resolu' | 'configuration' }

export function ecosystemeDeLaRequete(request: Request): EcosystemeResolu {
  let slug: string | null
  try {
    slug = resolveSubdomainFromHost(request.headers.get('host') ?? request.headers.get('x-forwarded-host'))
  } catch (err) {
    console.error('[inscription] résolution de l’écosystème en panne', err instanceof Error ? err.message : String(err))
    return { ok: false, raison: 'configuration' }
  }
  return slug ? { ok: true, slug } : { ok: false, raison: 'hote_non_resolu' }
}
