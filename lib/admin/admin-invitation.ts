import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expertSiteOrigin } from '@/lib/emails/domain-url'

/**
 * lib/admin/admin-invitation.ts — l'E-MAIL D'INVITATION d'un administrateur.
 *
 * POURQUOI UN MODULE, ET PAS DEUX COPIES
 *   Deux routes envoient ce message : la CRÉATION (/api/admin/create-admin) et
 *   le RENVOI (/api/admin/user-resend-invite). Recopié, il aurait divergé — le
 *   lien de retour, la locale, ou le client utilisé. Une seule fonction, deux
 *   appelants.
 *
 * ═══ UN SEUL E-MAIL, CELUI QUI COMPTE ══════════════════════════════════════
 *   Les deux routes d'inscription publiques passent par `auth.signUp` sur un
 *   client ANON, parce qu'elles ont besoin de l'e-mail de CONFIRMATION
 *   D'ADRESSE (piège P1, lib/auth-signup.ts). Un administrateur invité par un
 *   autre administrateur n'en a pas besoin : son adresse est confirmée
 *   d'office (`email_confirm: true`), et ce dont il a besoin, c'est de
 *   DÉFINIR SON MOT DE PASSE.
 *
 *   Enchaîner les deux enverrait DEUX messages pour une seule invitation, dont
 *   le premier ne sert à rien. On envoie donc uniquement le lien de définition
 *   de mot de passe — c'est une déviation ASSUMÉE des deux routes publiques,
 *   pas un oubli.
 *
 * ═══ LE CRÉATEUR NE CONNAÎT JAMAIS LE SECRET ═══════════════════════════════
 *   Le compte est créé avec un mot de passe aléatoire qui n'est ni affiché, ni
 *   journalisé, ni renvoyé. Le seul chemin d'accès passe par la boîte mail de
 *   l'invité. Un administrateur ne doit pas connaître le mot de passe initial
 *   d'un autre administrateur.
 *
 * ═══ CLIENT ANON, PAS SERVICE-ROLE ═════════════════════════════════════════
 *   `resetPasswordForEmail` est une méthode d'auth publique. On l'appelle sur
 *   un client ANON serveur — le même choix que lib/auth-signup.ts, pour la même
 *   raison : c'est le chemin dont on sait qu'il déclenche réellement le SMTP.
 */

/** Client ANON serveur — cf. § CLIENT ANON ci-dessus. */
function getSupabaseAnon(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export type AdminInvitationParams = {
  /** Adresse de l'invité. */
  email: string
  /** Origin de la requête administrateur (repli : NEXT_PUBLIC_SITE_URL). */
  origin: string
  /** Slug de l'ÉCOSYSTÈME de l'invité — pas celui du créateur. */
  domainSlug: string | null
  /** Locale de l'invité, lue en base. Jamais codée en dur ici. */
  locale: string
}

/**
 * Envoie (ou renvoie) le lien de définition de mot de passe.
 *
 * Retourne `false` sur échec — et ne LÈVE JAMAIS. L'appelant décide : la
 * création n'annule PAS un compte valide parce que le SMTP a hoqueté, elle
 * signale simplement que l'invitation n'est pas partie, et l'écran propose de
 * la renvoyer. Sans ce choix, chaque panne SMTP recréerait un problème du
 * jour zéro.
 */
export async function sendAdminInvitation(params: AdminInvitationParams): Promise<boolean> {
  const anon = getSupabaseAnon()
  if (!anon) {
    console.error('[admin-invitation] missing anon env — invitation not sent')
    return false
  }

  // Le lien doit ramener l'invité sur SON écosystème (prod), pas sur celui de
  // l'administrateur qui l'a créé. `expertSiteOrigin` porte déjà cette règle et
  // ses replis (staging, localhost, previews Vercel) : on la réutilise.
  const base = expertSiteOrigin({ origin: params.origin, slug: params.domainSlug })
  const redirectTo = `${base}/${params.locale}/nouveau-mot-de-passe`

  try {
    const { error } = await anon.auth.resetPasswordForEmail(params.email, { redirectTo })
    if (error) {
      console.error('[admin-invitation] resetPasswordForEmail failed', error.message)
      return false
    }
    return true
  } catch (err) {
    console.error(
      '[admin-invitation] resetPasswordForEmail threw',
      err instanceof Error ? err.message : String(err),
    )
    return false
  }
}
