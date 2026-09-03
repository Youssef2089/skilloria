/**
 * lib/ecosystem-guard.ts — LA RÉSOLUTION D'ACCÈS, ÉCRITE UNE SEULE FOIS.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ DEUX GARDES, UNE SEULE RÈGLE.                                            ║
 * ║                                                                          ║
 * ║ L'accès à un écosystème se décide à DEUX endroits qui n'ont rien en      ║
 * ║ commun :                                                                 ║
 * ║   • `requireAuth` (lib/auth-guard.ts) — sur chaque appel /api, avec un   ║
 * ║     NextRequest, et qui REFUSE en levant une AuthError 403.              ║
 * ║   • `assertDashboardRoleGuard` — dans un server component, sans          ║
 * ║     NextRequest, et qui REDIRIGE vers un écran.                          ║
 * ║                                                                          ║
 * ║ Ce qu'ils font du verdict diffère ; le verdict, lui, doit être le même.  ║
 * ║ Écrire la règle deux fois, c'est accepter qu'elles divergent — et le     ║
 * ║ jour où elles divergent, l'écran s'affiche pendant que les données sont  ║
 * ║ refusées, ou l'inverse. La règle vit donc ICI, et nulle part ailleurs.   ║
 * ║                                                                          ║
 * ║ (Le même raisonnement a déjà servi ce sprint, sur le nom du cookie de    ║
 * ║  session : deux copies, dont une aveugle aux sous-domaines de staging.)  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * QUI DÉCIDE QUOI :
 *   - la RÈGLE PAR POPULATION vit dans lib/ecosystem-scope.ts (fichier pur) ;
 *   - la RÉSOLUTION (lecture de l'écosystème visé + application de la règle)
 *     vit ici, parce qu'elle a besoin de la base ;
 *   - la SANCTION (403 ou redirection) appartient à chaque appelant.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ecosystemAccessScope } from '@/lib/ecosystem-scope'

/** Écosystème tel que la garde le manipule. */
export type EcosystemRow = { id: string; slug: string; active: boolean }

/**
 * Motifs de refus. Chacun a son écran (app/[locale]/ecosysteme-indisponible).
 *
 * `domain_mismatch` porte `ownSlug` : c'est ce qui permet de dire à un expert
 * égaré NON PAS « accès refusé », mais « votre écosystème est celui-ci, voici
 * l'adresse pour y aller ». Un refus sans issue n'est qu'une impasse polie.
 */
export type EcosystemDenialCode =
  | 'domain_mismatch'
  | 'unknown_domain'
  | 'domain_inactive'
  | 'unknown_user_type'
  | 'domain_lookup_failed'

export type EcosystemDenial = {
  code: EcosystemDenialCode
  /** Slug de l'écosystème DU COMPTE — renseigné pour `domain_mismatch`. */
  ownSlug: string | null
}

export type EcosystemResolution =
  | { ok: true; domain: EcosystemRow }
  | { ok: false; denial: EcosystemDenial }

/**
 * L'écosystème visé est-il accessible à ce compte ?
 *
 * `ownDomain` est la ligne `domains` DU COMPTE, quand l'appelant l'a déjà
 * jointe. Elle évite une lecture quand le slug demandé est celui du compte —
 * le cas de tout expert, et le plus fréquent. La passer à `null` reste correct :
 * la fonction relit, simplement.
 */
export async function resolveEcosystemAccess(args: {
  admin: SupabaseClient
  headerSubdomain: string | null | undefined
  userType: string | null
  userDomainId: string
  ownDomain: EcosystemRow | null
  /** Préfixe des journaux, pour distinguer les deux appelants. */
  logTag: string
}): Promise<EcosystemResolution> {
  const { admin, headerSubdomain, userType, userDomainId, ownDomain, logTag } = args

  const deny = (code: EcosystemDenialCode): EcosystemResolution => ({
    ok: false,
    denial: { code, ownSlug: ownDomain?.slug ?? null },
  })

  // Règle d'or : AUCUN slug d'écosystème par défaut. `x-subdomain` est injecté
  // par useSecureFetch sur toute requête authentifiée ; absent = anomalie →
  // échec, jamais un rattachement implicite à un écosystème figé.
  if (!headerSubdomain) return deny('domain_mismatch')

  // LE SLUG EST RÉSOLU EN BASE, jamais comparé de chaîne à chaîne. Tant que la
  // garde se résumait à « le slug reçu vaut-il celui de mon compte ? », un
  // écosystème inexistant ou désactivé était impossible à distinguer : le test
  // passait ou échouait pour la seule raison que le compte était ailleurs.
  let target: EcosystemRow | null =
    ownDomain && ownDomain.slug === headerSubdomain ? ownDomain : null
  if (!target) {
    const { data: domRow, error: domErr } = await admin
      .from('domains')
      .select('id, slug, active')
      .eq('slug', headerSubdomain)
      .maybeSingle()
    if (domErr) {
      console.error(`[${logTag}] domain lookup error`, {
        slug: headerSubdomain,
        msg: domErr.message,
      })
      // Une base muette ne vaut PAS une autorisation.
      return deny('domain_lookup_failed')
    }
    target = (domRow ?? null) as EcosystemRow | null
  }
  // Le slug d'un écosystème est un sous-domaine public, lisible dans le DNS :
  // le nommer inexistant ne révèle rien, et rend l'incident diagnosticable.
  if (!target) return deny('unknown_domain')

  // `null` = user_type inconnu = REFUS : un type non prévu ne doit jamais
  // hériter du régime le plus permissif.
  const scope = ecosystemAccessScope(userType)
  if (scope === null) {
    console.error(`[${logTag}] unknown user_type`, { userType })
    return deny('unknown_user_type')
  }

  // EXPERT : son écosystème, à vie.
  if (scope === 'own' && target.id !== userDomainId) return deny('domain_mismatch')

  // Un écosystème DÉSACTIVÉ n'accueille plus personne — pas même l'expert qui y
  // est né. C'est la conséquence assumée de la désactivation, et la raison pour
  // laquelle elle s'annonce avec ses volumes réels. Seul l'ADMIN passe : c'est
  // de là qu'on réactive.
  if (scope !== 'platform' && !target.active) return deny('domain_inactive')

  return { ok: true, domain: target }
}
