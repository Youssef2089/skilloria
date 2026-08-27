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
  /** D3 : nom de marque = domain.name du destinataire (jamais figé). */
  brandName: string
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
    brandName: params.brandName,
    title: m.title,
    bodyHtml,
    ctaLabel: m.cta_label,
    ctaUrl: params.loginUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })
  const text = renderEmailText({
    brandName: params.brandName,
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
  /** D3 : nom de marque = domain.name du destinataire (jamais figé). */
  brandName: string
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
    brandName: params.brandName,
    title: m.title,
    bodyHtml,
    ctaLabel: m.cta_label,
    ctaUrl: params.contactUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })
  const text = renderEmailText({
    brandName: params.brandName,
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
  /** D3 : nom de marque = domain.name du destinataire (jamais figé). */
  brandName: string
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
    brandName: params.brandName,
    title: m.title,
    bodyHtml,
    ctaLabel: m.cta_label,
    ctaUrl: params.loginUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })
  const text = renderEmailText({
    brandName: params.brandName,
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
  /** D3 : nom de marque = domain.name du destinataire (jamais figé). */
  brandName: string
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
    brandName: params.brandName,
    title: m.title,
    bodyHtml,
    ctaLabel: m.cta_label,
    ctaUrl: params.contactUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })
  const text = renderEmailText({
    brandName: params.brandName,
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
  /** D3 : nom de marque = domain.name du destinataire (jamais figé). */
  brandName: string
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
    brandName: params.brandName,
    title: m.title,
    bodyHtml,
    ctaLabel: m.cta_label,
    ctaUrl: params.inviteUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })
  const text = renderEmailText({
    brandName: params.brandName,
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
  /** D3 : nom de marque = domain.name du destinataire (jamais figé). */
  brandName: string
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
    brandName: params.brandName,
    title: m.title,
    bodyHtml,
    ctaLabel: m.cta_label,
    ctaUrl: params.loginUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })
  const text = renderEmailText({
    brandName: params.brandName,
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

/* ─────────────────────────────────────────────────────────────────────────
 * Template DIGEST DE MATCHES (notifications email/SMS sur nouvelle opportunité).
 *
 * Envoyé en IMMÉDIAT à la création des notifications de match, groupé par expert
 * (lib/notifications/dispatch.ts, appelé depuis le reconcile du matching),
 * dans la langue de l'expert. Contenu agrégé : nombre de
 * missions, liste courte (titre + score), lien vers les opportunités, lien de
 * désabonnement (D6). Le nom de la plateforme (`platform`) vient de la config de
 * domaine — jamais figé (checklist #1). Escaping via `interpolate`.
 * ───────────────────────────────────────────────────────────────────────── */

export type MatchDigestItem = { title: string; score: number }

export type MatchDigestEmailParams = {
  locale: string | null | undefined
  /** D3 : nom de marque = domain.name du destinataire (jamais figé). */
  brandName: string
  firstName: string
  /** Nom de la plateforme issu de la config de domaine (jamais figé). */
  platform: string
  items: MatchDigestItem[]
  /** URL absolue vers la liste des opportunités. */
  missionsUrl: string
  /** URL absolue de désabonnement (one-click, tokenisée). */
  unsubscribeUrl: string
}

export function renderMatchDigestEmail(params: MatchDigestEmailParams): RenderedEmail {
  const locale: Locale = resolveLocale(params.locale)
  const m = getEmailMessages(locale).match_digest
  const common = getEmailMessages(locale)
  const count = params.items.length
  const vars = {
    firstName: params.firstName,
    platform: params.platform,
    count: String(count),
  }

  const subject = interpolate(count <= 1 ? m.subject_one : m.subject_other, vars)
  const helloLine = interpolate(m.hello, vars)
  const introHtml = interpolate(count <= 1 ? m.intro_one : m.intro_other, vars)

  // Liste des missions : titre (échappé) + score /10. `interpolate` échappe le
  // titre (provenant d'une publication, donc non fiable).
  const itemsHtml = params.items
    .map((it) =>
      interpolate('<li style="margin:0 0 6px;">{title} · {score}/10</li>', {
        title: it.title,
        score: String(Math.round(it.score * 10) / 10),
      }),
    )
    .join('')

  const unsubscribeHtml = interpolate(
    '<p style="margin:18px 0 0;font-size:12px;color:#94a3b8;"><a href="{url}" style="color:#94a3b8;text-decoration:underline;">{label}</a></p>',
    { url: params.unsubscribeUrl, label: m.unsubscribe },
  )

  const bodyHtml = `<p style="margin:0 0 12px;">${helloLine}</p>
<p style="margin:0 0 12px;">${introHtml}</p>
<ul style="margin:0 0 12px;padding-left:20px;color:#334155;">${itemsHtml}</ul>
${unsubscribeHtml}`

  const itemsText = params.items
    .map((it) => `- ${it.title} · ${Math.round(it.score * 10) / 10}/10`)
    .join('\n')
  const bodyText = [
    stripHtml(helloLine),
    '',
    stripHtml(introHtml),
    '',
    itemsText,
    '',
    `${m.unsubscribe}: ${params.unsubscribeUrl}`,
  ].join('\n')

  const html = renderEmailHtml({
    brandName: params.brandName,
    title: m.title,
    bodyHtml,
    ctaLabel: m.cta_label,
    ctaUrl: params.missionsUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })
  const text = renderEmailText({
    brandName: params.brandName,
    title: m.title,
    bodyText,
    ctaLabel: m.cta_label,
    ctaUrl: params.missionsUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  })

  return {
    subject,
    html,
    text,
    preheader: m.preheader,
    tag: 'match_digest',
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * NOUVEAU MESSAGE — e-mail au destinataire d'un message.
 *
 * ⚠️ LE CONTENU DU MESSAGE N'EST JAMAIS RECOPIÉ. L'e-mail annonce et renvoie
 * vers la plateforme ; le message y reste. Un e-mail transite par des serveurs
 * tiers et s'archive hors de notre périmètre — il ne doit pas devenir le canal
 * qui contourne la messagerie.
 * ────────────────────────────────────────────────────────────────────────── */

export type NewMessageEmailParams = {
  locale: string | null | undefined
  brandName: string
  firstName: string
  /** Nom d'affichage de l'expéditeur, DÉJÀ masqué par l'appelant si besoin. */
  senderName: string
  /** URL absolue vers la conversation. */
  conversationUrl: string
  unsubscribeUrl: string
}

export function renderNewMessageEmail(params: NewMessageEmailParams): RenderedEmail {
  const locale: Locale = resolveLocale(params.locale)
  const m = getEmailMessages(locale).new_message
  const common = getEmailMessages(locale)
  const vars = { firstName: params.firstName, senderName: params.senderName }

  const subject = interpolate(m.subject, vars)
  const helloLine = interpolate(m.hello, vars)
  // `interpolate` échappe chaque valeur (lib/emails/escape.ts, fix E1) : le nom
  // d'expéditeur vient d'un profil utilisateur, donc non fiable.
  const introHtml = interpolate(m.intro, vars)
  const noticeHtml = interpolate('<p style="margin:0 0 12px;color:#64748b;">{notice}</p>', {
    notice: m.notice,
  })
  const unsubscribeHtml = interpolate(
    '<p style="margin:18px 0 0;font-size:12px;color:#94a3b8;"><a href="{url}" style="color:#94a3b8;text-decoration:underline;">{label}</a></p>',
    { url: params.unsubscribeUrl, label: m.unsubscribe },
  )

  const bodyHtml = `<p style="margin:0 0 12px;">${helloLine}</p>
<p style="margin:0 0 12px;">${introHtml}</p>
${noticeHtml}
${unsubscribeHtml}`

  const bodyText = [
    stripHtml(helloLine),
    '',
    stripHtml(introHtml),
    '',
    m.notice,
    '',
    `${m.unsubscribe}: ${params.unsubscribeUrl}`,
  ].join('\n')

  const layout = {
    brandName: params.brandName,
    title: m.title,
    ctaLabel: m.cta_label,
    ctaUrl: params.conversationUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  }
  return {
    subject,
    html: renderEmailHtml({ ...layout, bodyHtml }),
    text: renderEmailText({ ...layout, bodyText }),
    preheader: m.preheader,
    tag: 'new_message',
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * NOUVELLE CANDIDATURE REÇUE — e-mail aux membres agissants de l'organisation.
 *
 * ⚠️ AUCUNE DONNÉE IDENTIFIANTE DU CANDIDAT. Ni nom, ni score, ni extrait de
 * profil. Le masquage vaut aussi pour les notifications : l'identité de
 * l'expert ne se dévoile qu'après déblocage, sur la plateforme. Seul le titre
 * de l'annonce — écrit par l'organisation elle-même — figure dans l'e-mail.
 * ────────────────────────────────────────────────────────────────────────── */

export type NewCandidatureEmailParams = {
  locale: string | null | undefined
  brandName: string
  firstName: string
  /** Titre de l'annonce concernée. Aucune donnée du candidat. */
  publicationTitle: string
  /** URL absolue vers les candidatures de l'annonce. */
  candidaturesUrl: string
  unsubscribeUrl: string
}

export function renderNewCandidatureEmail(params: NewCandidatureEmailParams): RenderedEmail {
  const locale: Locale = resolveLocale(params.locale)
  const m = getEmailMessages(locale).new_candidature
  const common = getEmailMessages(locale)
  const vars = { firstName: params.firstName, title: params.publicationTitle }

  const subject = interpolate(m.subject, vars)
  const helloLine = interpolate(m.hello, vars)
  // Titre d'annonce = saisie libre d'une organisation → échappé par interpolate.
  const introHtml = interpolate(m.intro, vars)
  const unsubscribeHtml = interpolate(
    '<p style="margin:18px 0 0;font-size:12px;color:#94a3b8;"><a href="{url}" style="color:#94a3b8;text-decoration:underline;">{label}</a></p>',
    { url: params.unsubscribeUrl, label: m.unsubscribe },
  )

  const bodyHtml = `<p style="margin:0 0 12px;">${helloLine}</p>
<p style="margin:0 0 12px;">${introHtml}</p>
${unsubscribeHtml}`

  const bodyText = [
    stripHtml(helloLine),
    '',
    stripHtml(introHtml),
    '',
    `${m.unsubscribe}: ${params.unsubscribeUrl}`,
  ].join('\n')

  const layout = {
    brandName: params.brandName,
    title: m.title,
    ctaLabel: m.cta_label,
    ctaUrl: params.candidaturesUrl,
    signature: common.common_signature,
    footer: common.common_footer,
  }
  return {
    subject,
    html: renderEmailHtml({ ...layout, bodyHtml }),
    text: renderEmailText({ ...layout, bodyText }),
    preheader: m.preheader,
    tag: 'new_candidature',
  }
}
