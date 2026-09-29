import { resolveSubdomainFromHost, adresseEcosysteme } from '@/lib/subdomain'

/**
 * LE LIEN DE L'E-MAIL DE CONFIRMATION — construit au SERVEUR, sur l'adresse de l'écosystème résolu,
 * dans l'environnement courant (§E.83) : depuis staging il ramène sur staging, jamais en production ni
 * vers une adresse aléatoire. Du navigateur, on ne garde que la LANGUE (le segment `/<xx>/auth/callback`
 * de l'adresse qu'il propose). Sans racine posée — le poste local seulement — l'adresse proposée, si elle
 * a la forme attendue, est reprise telle quelle (anti-redirection ouverte, P7).
 */
export function redirectionConfirmation(proposee: string, slug: string): string | null {
  const forme = /^https?:\/\/[^\s/]{1,200}\/([a-z]{2})\/auth\/callback$/.exec(proposee)
  const adresse = adresseEcosysteme(slug)
  if (adresse) return `${adresse}/${forme?.[1] ?? 'fr'}/auth/callback`
  return forme ? proposee : null
}

/**
 * L'ÉCOSYSTÈME D'UNE INSCRIPTION PUBLIQUE, RÉELLEMENT RÉSOLU (checklist 2, §D.27).
 *
 * Il vient de l'HÔTE de la requête — `microsoft.skilloria.io` → `microsoft` — par le
 * même résolveur que le proxy. Jamais du corps de la requête, ni de `x-subdomain` :
 * les deux sont écrits par l'appelant, et la preuve signée porterait alors
 * l'écosystème qu'il a CHOISI, pas celui où il s'inscrit. L'écosystème résolu est
 * ensuite vérifié ACTIF par la base (`inscription_refus`, `invalid_domain`).
 *
 * DEUX ÉCHECS, DEUX NOMS (§E.22) : un hôte qui ne se résout pas (la racine seule, une
 * adresse `…vercel.app`) est un refus de l'utilisateur (`hote_non_resolu` → 400
 * invalid_domain) ; un résolveur qui LÈVE — `NEXT_PUBLIC_DOMAINE_RACINE` absente sur un
 * environnement déployé, `DEV_DOMAIN_SLUG` en local — est une panne de configuration
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
