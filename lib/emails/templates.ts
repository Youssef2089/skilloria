import { getEmailMessages, interpolate, resolveLocale, type Locale } from './locales'
import { renderEmailHtml, renderEmailText, stripHtml } from './layout'

/**
 * Templates des 2 emails admin (B5) — bienvenue (org approuvée) et refus.
 *
 * Toutes les chaînes proviennent du namespace `emails` des fichiers messages
 * (4 langues à parité — cf. messages/{fr,en,es,de}.json). La locale est
 * résolue depuis users.locale du destinataire avec fallback 'fr'.
 *
 * Sortie : { subject, html, text, preheader, tag } prêt pour sendEmail().
 */

export type RenderedEmail = {
  subject: string
  html: string
  text: string
  preheader: string
  tag: string
}

export type WelcomeEmailParams = {
  locale: string | null | undefined
  firstName: string
  companyName: string
  /** URL absolue vers la page de connexion (ex: https://skilloria.io/fr/connexion). */
  loginUrl: string
}

export function renderWelcomeEmail(params: WelcomeEmailParams): RenderedEmail {
  const locale: Locale = resolveLocale(params.locale)
  const m = getEmailMessages(locale).welcome
  const common = getEmailMessages(locale)
  const variables = {
    firstName: params.firstName,
    companyName: params.companyName,
  }

  const helloLine = interpolate(m.hello, variables)
  // body_p1 contient déjà <strong>{companyName}</strong> → interpolation directe.
  const bodyP1Html = interpolate(m.body_p1, variables)
  const bodyP2Html = m.body_p2

  const bodyHtml = `<p style="margin:0 0 12px;">${helloLine}</p>
<p style="margin:0 0 12px;">${bodyP1Html}</p>
<p style="margin:0;">${bodyP2Html}</p>`

  const bodyText = [
    stripHtml(helloLine),
    '',
    stripHtml(bodyP1Html),
    '',
    bodyP2Html,
  ].join('\n')

  const html = renderEmailHtml({
    title: m.title,
    bodyHtml,
    ctaLabel: m.cta_label,
    ctaUrl: params.loginUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })
  const text = renderEmailText({
    title: m.title,
    bodyText,
    ctaLabel: m.cta_label,
    ctaUrl: params.loginUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })

  return {
    subject: m.subject,
    html,
    text,
    preheader: m.preheader,
    tag: 'org_approved',
  }
}

export type RejectEmailParams = {
  locale: string | null | undefined
  firstName: string
  companyName: string
  /** Motif de refus (optionnel). Si fourni, ajoute un paragraphe explicatif. */
  reason: string | null
  /** URL absolue de contact (mailto: ou page). */
  contactUrl: string
}

export function renderRejectEmail(params: RejectEmailParams): RenderedEmail {
  const locale: Locale = resolveLocale(params.locale)
  const m = getEmailMessages(locale).reject
  const common = getEmailMessages(locale)
  const variables = {
    firstName: params.firstName,
    companyName: params.companyName,
    reason: params.reason ?? '',
  }

  const helloLine = interpolate(m.hello, variables)
  const bodyP1Html = interpolate(m.body_p1, variables)
  const reasonP2Html = params.reason
    ? `<p style="margin:0 0 12px;color:#475569;">${interpolate(m.body_with_reason_p2, variables)}</p>`
    : ''
  const bodyP3Html = m.body_p3

  const bodyHtml = `<p style="margin:0 0 12px;">${helloLine}</p>
<p style="margin:0 0 12px;">${bodyP1Html}</p>
${reasonP2Html}
<p style="margin:0;">${bodyP3Html}</p>`

  const bodyTextParts = [stripHtml(helloLine), '', stripHtml(bodyP1Html)]
  if (params.reason) {
    bodyTextParts.push('', stripHtml(interpolate(m.body_with_reason_p2, variables)))
  }
  bodyTextParts.push('', bodyP3Html)
  const bodyText = bodyTextParts.join('\n')

  const html = renderEmailHtml({
    title: m.title,
    bodyHtml,
    ctaLabel: m.cta_label,
    ctaUrl: params.contactUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })
  const text = renderEmailText({
    title: m.title,
    bodyText,
    ctaLabel: m.cta_label,
    ctaUrl: params.contactUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })

  return {
    subject: m.subject,
    html,
    text,
    preheader: m.preheader,
    tag: 'org_rejected',
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Templates EXPERT (lot vérif expert) — miroir des templates org ci-dessus,
 * mais SANS `companyName` (un expert est un seul utilisateur). Locale résolue
 * depuis users.locale du destinataire avec fallback 'fr'. Namespace i18n
 * dédié : emails.expert_welcome / emails.expert_reject.
 * ───────────────────────────────────────────────────────────────────────── */

export type ExpertWelcomeEmailParams = {
  locale: string | null | undefined
  firstName: string
  /** URL absolue vers le tableau de bord / la page de connexion. */
  loginUrl: string
}

export function renderExpertWelcomeEmail(params: ExpertWelcomeEmailParams): RenderedEmail {
  const locale: Locale = resolveLocale(params.locale)
  const m = getEmailMessages(locale).expert_welcome
  const common = getEmailMessages(locale)
  const variables = { firstName: params.firstName }

  const helloLine = interpolate(m.hello, variables)
  const bodyP1Html = m.body_p1
  const bodyP2Html = m.body_p2

  const bodyHtml = `<p style="margin:0 0 12px;">${helloLine}</p>
<p style="margin:0 0 12px;">${bodyP1Html}</p>
<p style="margin:0;">${bodyP2Html}</p>`

  const bodyText = [stripHtml(helloLine), '', stripHtml(bodyP1Html), '', bodyP2Html].join('\n')

  const html = renderEmailHtml({
    title: m.title,
    bodyHtml,
    ctaLabel: m.cta_label,
    ctaUrl: params.loginUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })
  const text = renderEmailText({
    title: m.title,
    bodyText,
    ctaLabel: m.cta_label,
    ctaUrl: params.loginUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })

  return {
    subject: m.subject,
    html,
    text,
    preheader: m.preheader,
    tag: 'expert_approved',
  }
}

export type ExpertRejectEmailParams = {
  locale: string | null | undefined
  firstName: string
  /** Motif de refus (obligatoire côté route expert, mais robuste si null). */
  reason: string | null
  /** URL absolue de contact (mailto: ou page). */
  contactUrl: string
}

export function renderExpertRejectEmail(params: ExpertRejectEmailParams): RenderedEmail {
  const locale: Locale = resolveLocale(params.locale)
  const m = getEmailMessages(locale).expert_reject
  const common = getEmailMessages(locale)
  const variables = {
    firstName: params.firstName,
    reason: params.reason ?? '',
  }

  const helloLine = interpolate(m.hello, variables)
  const bodyP1Html = m.body_p1
  const reasonP2Html = params.reason
    ? `<p style="margin:0 0 12px;color:#475569;">${interpolate(m.body_with_reason_p2, variables)}</p>`
    : ''
  const bodyP3Html = m.body_p3

  const bodyHtml = `<p style="margin:0 0 12px;">${helloLine}</p>
<p style="margin:0 0 12px;">${bodyP1Html}</p>
${reasonP2Html}
<p style="margin:0;">${bodyP3Html}</p>`

  const bodyTextParts = [stripHtml(helloLine), '', stripHtml(bodyP1Html)]
  if (params.reason) {
    bodyTextParts.push('', stripHtml(interpolate(m.body_with_reason_p2, variables)))
  }
  bodyTextParts.push('', bodyP3Html)
  const bodyText = bodyTextParts.join('\n')

  const html = renderEmailHtml({
    title: m.title,
    bodyHtml,
    ctaLabel: m.cta_label,
    ctaUrl: params.contactUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })
  const text = renderEmailText({
    title: m.title,
    bodyText,
    ctaLabel: m.cta_label,
    ctaUrl: params.contactUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })

  return {
    subject: m.subject,
    html,
    text,
    preheader: m.preheader,
    tag: 'expert_rejected',
  }
}

export type InvitationEmailParams = {
  locale: string | null | undefined
  /** Nom de l'organisation qui invite. */
  companyName: string
  /** Libellé HUMAIN du rôle proposé (déjà localisé par le caller). */
  roleLabel: string
  /** URL absolue de la page d'acceptation (contient le token EN CLAIR). */
  inviteUrl: string
  /** Date d'expiration déjà formatée (localisée) par le caller. */
  expiresLabel: string
  /**
   * `true` si l'email invité N'appartient PAS au domaine de l'org (D4) : on
   * ajoute un paragraphe d'avertissement. L'invitation reste valide.
   */
  domainMismatch: boolean
}

/**
 * Email d'invitation à rejoindre une organisation (Lot B, B2).
 *
 * Le lien `inviteUrl` porte le token EN CLAIR (haché en base) — c'est le canal
 * du cas 1 (compte existant qui clique). L'escaping des variables est assuré
 * par `interpolate` (E1) ; `inviteUrl` passe par `renderEmailHtml` qui l'insère
 * dans un href déjà sécurisé côté layout.
 */
export function renderInvitationEmail(params: InvitationEmailParams): RenderedEmail {
  const locale: Locale = resolveLocale(params.locale)
  const m = getEmailMessages(locale).invitation
  const common = getEmailMessages(locale)
  const variables = {
    companyName: params.companyName,
    roleLabel: params.roleLabel,
    expiresLabel: params.expiresLabel,
  }

  const bodyP1Html = interpolate(m.body_p1, variables)
  const bodyRoleHtml = interpolate(m.body_role, variables)
  const bodyExpiresHtml = interpolate(m.body_expires, variables)
  const domainWarnHtml = params.domainMismatch
    ? `<p style="margin:0 0 12px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;">${m.body_domain_warning}</p>`
    : ''

  const bodyHtml = `<p style="margin:0 0 12px;">${m.hello}</p>
<p style="margin:0 0 12px;">${bodyP1Html}</p>
<p style="margin:0 0 12px;">${bodyRoleHtml}</p>
${domainWarnHtml}
<p style="margin:0;color:#475569;">${bodyExpiresHtml}</p>`

  const bodyTextParts = [
    stripHtml(m.hello),
    '',
    stripHtml(bodyP1Html),
    '',
    stripHtml(bodyRoleHtml),
  ]
  if (params.domainMismatch) bodyTextParts.push('', stripHtml(m.body_domain_warning))
  bodyTextParts.push('', stripHtml(bodyExpiresHtml))
  const bodyText = bodyTextParts.join('\n')

  const html = renderEmailHtml({
    title: m.title,
    bodyHtml,
    ctaLabel: m.cta_label,
    ctaUrl: params.inviteUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })
  const text = renderEmailText({
    title: m.title,
    bodyText,
    ctaLabel: m.cta_label,
    ctaUrl: params.inviteUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })

  return {
    // Sujet/preheader STATIQUES (comme welcome/reject) : `interpolate` ferait
    // de l'escaping HTML, inadapté à un en-tête de mail en texte brut.
    subject: m.subject,
    html,
    text,
    preheader: m.preheader,
    tag: 'org_invitation',
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Template AVERTISSEMENT D'INACTIVITÉ (point E — purge CNIL 2 ans).
 *
 * Envoyé ~23 mois après le dernier contact, AVANT toute anonymisation :
 * l'information préalable est impérative (une purge silencieuse serait
 * illégale). Une simple reconnexion (init-session) remet le compteur à zéro.
 * ───────────────────────────────────────────────────────────────────────── */

export type InactivityWarningEmailParams = {
  locale: string | null | undefined
  firstName: string
  /** Date limite déjà formatée (localisée) par le caller. */
  deadlineLabel: string
  /** URL absolue vers la page de connexion (sur le domaine de l'utilisateur). */
  loginUrl: string
}

export function renderInactivityWarningEmail(params: InactivityWarningEmailParams): RenderedEmail {
  const locale: Locale = resolveLocale(params.locale)
  const m = getEmailMessages(locale).inactivity_warning
  const common = getEmailMessages(locale)
  const variables = {
    firstName: params.firstName,
    deadlineLabel: params.deadlineLabel,
  }

  const helloLine = interpolate(m.hello, variables)
  const bodyP1Html = m.body_p1
  const bodyP2Html = interpolate(m.body_p2, variables)

  const bodyHtml = `<p style="margin:0 0 12px;">${helloLine}</p>
<p style="margin:0 0 12px;">${bodyP1Html}</p>
<p style="margin:0;">${bodyP2Html}</p>`

  const bodyText = [stripHtml(helloLine), '', stripHtml(bodyP1Html), '', stripHtml(bodyP2Html)].join('\n')

  const html = renderEmailHtml({
    title: m.title,
    bodyHtml,
    ctaLabel: m.cta_label,
    ctaUrl: params.loginUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })
  const text = renderEmailText({
    title: m.title,
    bodyText,
    ctaLabel: m.cta_label,
    ctaUrl: params.loginUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })

  return {
    subject: m.subject,
    html,
    text,
    preheader: m.preheader,
    tag: 'inactivity_warning',
  }
}
