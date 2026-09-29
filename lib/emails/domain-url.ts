import { adresseEcosysteme, domaineRacine } from '@/lib/subdomain'

/* ─────────────────────────────────────────────────────────────────────────
 * L'ORIGINE DES LIENS D'UN E-MAIL — l'adresse de l'écosystème du DESTINATAIRE,
 * dans l'environnement courant (§E.83, décision de Youssef, 29/09/2026).
 *
 * Problème résolu : un e-mail part vers quelqu'un qui appartient à un écosystème
 * précis. L'origine de la requête (l'administrateur qui clique, un cron qui n'en a
 * pas) n'est PAS cet écosystème. Le bon signal est `users.domain_id → domains.slug`,
 * connu côté serveur, et la règle d'adresse est celle du résolveur :
 * `https://<slug>.<racine>` (lib/subdomain.ts, `adresseEcosysteme`).
 *
 *   · production : https://microsoft.skilloria.io
 *   · staging    : https://microsoft.staging.skilloria.io — JAMAIS la production, jamais une
 *                  adresse aléatoire `…vercel.app` : staging se comporte comme la production,
 *                  seule la racine diffère.
 *   · poste local (aucune racine posée) : l'origine reçue, telle quelle (localhost).
 *
 * ⚠️ L'ANCIENNE RÈGLE ne greffait le slug qu'en PRODUCTION (`isProdSkilloria`) et rendait
 *    ailleurs l'origine de la requête : depuis staging, le lien d'un expert pointait vers
 *    l'écosystème de l'ADMINISTRATEUR, ou vers l'adresse de la variable — pas vers le sien.
 *
 * `null` — et l'appelant N'ENVOIE PAS — quand l'adresse ne se construit pas dans un
 * environnement déployé : racine absente, ou écosystème du destinataire illisible. Un
 * e-mail qui ne part pas se lit dans les journaux ; un lien mort, chez un destinataire
 * (lib/site-url.ts, même règle).
 * ───────────────────────────────────────────────────────────────────────── */

export type ExpertSiteOriginParams = {
  /** Origin déjà résolu côté route (body.site_url → origin → NEXT_PUBLIC_SITE_URL) — le poste local seulement. */
  origin: string
  /** Slug de l'écosystème du destinataire (domains.slug via users.domain_id). */
  slug: string | null | undefined
}

/**
 * L'origine (sans slash final) des liens d'un e-mail, ou `null` : l'appelant n'envoie pas.
 */
export function expertSiteOrigin(params: ExpertSiteOriginParams): string | null {
  if (domaineRacine()) {
    const adresse = adresseEcosysteme(params.slug)
    if (!adresse) {
      console.error('[liens-email] écosystème du destinataire illisible — e-mail ANNULÉ', {
        code: 'lien_sans_ecosysteme',
        slug: params.slug ?? null,
      })
    }
    return adresse
  }
  // Aucune racine : seul le poste local n'en a pas. Déployé, c'est une configuration absente.
  if (process.env.VERCEL_ENV) {
    console.error('[liens-email] NEXT_PUBLIC_DOMAINE_RACINE absente sur un environnement déployé — e-mail ANNULÉ', {
      code: 'domaine_racine_absent',
      environnement: process.env.VERCEL_ENV,
    })
    return null
  }
  const origine = (params.origin ?? '').replace(/\/+$/, '')
  return origine || null
}
