import type { SupabaseClient } from '@supabase/supabase-js'
import type { Locale } from '@/i18n/routing'
import fr from '@/messages/fr.json'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import de from '@/messages/de.json'
import { dashboardUrlForUserType } from '@/lib/auth-routing'
import { resolveEmailBrandName } from '@/lib/emails/brand'
import { renderEmailHtml, renderEmailText, stripHtml } from '@/lib/emails/layout'
import { getEmailMessages, interpolate } from '@/lib/emails/locales'
import { COULEURS_EMAIL } from '@/lib/emails/couleurs'
import { sendEmail } from '@/lib/emails/resend'

/**
 * L'AUTEUR D'UNE ANNONCE EST PRÉVENU DE LA DÉCISION — DANS SA LANGUE, DANS LA CLOCHE ET PAR E-MAIL (lot S3).
 *
 * Validée ou refusée, motif compris. Une décision d'administrateur n'est pas une notification qu'on règle (elle n'est
 * pas dans le catalogue des préférences, lib/notifications/catalog.ts) : comme l'arbitrage d'un profil d'expert
 * (/api/admin/approve-expert), elle se dit toujours — une ligne dans la cloche, un e-mail transactionnel.
 *
 * QUI EST L'AUTEUR : le compte qui a créé l'annonce (`publications.created_by`) ; s'il n'existe plus (clé mise à
 * null), le propriétaire de l'organisation personnelle d'un expert (`organizations.owner_user_id`). Personne : on ne
 * devine pas — l'appelant le DIT à l'administrateur (`auteur_introuvable`).
 *
 * LE LIEN mène là où l'auteur peut aller : l'annonce d'une organisation dans l'espace entreprise, le besoin d'un
 * expert dans SA section Sous-traitance (un expert ne peut pas ouvrir /dashboard/entreprise — même raison que
 * lib/collaboration-links.ts).
 *
 * TEXTES : `validation_annonces.avis` dans messages/*.json, lus hors de l'arbre React (comme lib/emails/locales.ts).
 * La cloche reçoit du TEXTE BRUT (rendu par React, qui échappe) ; l'e-mail échappe chaque valeur (`interpolate`).
 */

export type Decision = 'validee' | 'refusee'

type TextesAvis = {
  cloche: Record<Decision, { titre: string; corps: string }>
  email: Record<Decision, { sujet: string; preambule: string; titre: string; bonjour: string; corps: string; motif?: string; suite: string; bouton: string }>
}

const TEXTES: Record<Locale, TextesAvis> = {
  fr: (fr as unknown as { validation_annonces: { avis: TextesAvis } }).validation_annonces.avis,
  en: (en as unknown as { validation_annonces: { avis: TextesAvis } }).validation_annonces.avis,
  es: (es as unknown as { validation_annonces: { avis: TextesAvis } }).validation_annonces.avis,
  de: (de as unknown as { validation_annonces: { avis: TextesAvis } }).validation_annonces.avis,
}

function langue(brute: string | null | undefined): Locale {
  return brute === 'en' || brute === 'es' || brute === 'de' ? brute : 'fr'
}
const remplir = (gabarit: string, v: Record<string, string>): string => gabarit.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '')

export type Destinataire = {
  userId: string
  email: string | null
  prenom: string
  locale: Locale
  domainId: string
  /**
   * Le sous-domaine de l'écosystème de l'ANNONCE (`domains.slug`, un réglage — §D.28) : la route en tire l'adresse des
   * liens d'e-mail par `expertSiteOrigin` (§E.83), jamais l'origine brute de l'administrateur.
   */
  slug: string | null
  /** Le lien de l'annonce dans l'espace de son auteur, SANS langue (la cloche l'ajoute ; l'e-mail aussi). */
  lien: string
  titre: string
  /** Un compte anonymisé garde une adresse de substitution : on ne lui écrit pas. */
  anonymise: boolean
}

/** L'auteur de l'annonce et où le mener. `null` : aucun compte à prévenir (créateur supprimé, aucun propriétaire). */
export async function chargerDestinataire(
  admin: SupabaseClient,
  publication: { id: string; title: string; domain_id: string; created_by: string | null; organization_id: string },
): Promise<{ ok: true; destinataire: Destinataire | null } | { ok: false; raison: string }> {
  const { data: org, error: orgErr } = await admin
    .from('organizations')
    .select('org_type, owner_user_id')
    .eq('id', publication.organization_id)
    .maybeSingle()
  if (orgErr) return { ok: false, raison: `organisation illisible : ${orgErr.message}` }
  const orgType = (org?.org_type as string | null) ?? null
  const userId = publication.created_by ?? (orgType === 'freelance' ? ((org?.owner_user_id as string | null) ?? null) : null)
  if (!userId) return { ok: true, destinataire: null }

  const { data: u, error: uErr } = await admin
    .from('users')
    .select('id, email, first_name, locale, user_type, anonymized_at')
    .eq('id', userId)
    .maybeSingle()
  if (uErr) return { ok: false, raison: `compte de l'auteur illisible : ${uErr.message}` }
  if (!u) return { ok: true, destinataire: null }

  const { data: dom, error: domErr } = await admin.from('domains').select('slug').eq('id', publication.domain_id).maybeSingle()
  if (domErr) return { ok: false, raison: `écosystème de l'annonce illisible : ${domErr.message}` }

  const lien = orgType === 'freelance'
    ? `${dashboardUrlForUserType(u.user_type as string | null)}/sous-traitance/${publication.id}`
    : `/dashboard/entreprise/annonces/${publication.id}`
  return {
    ok: true,
    destinataire: {
      userId: u.id as string,
      email: (u.email as string | null) ?? null,
      prenom: ((u.first_name as string | null) ?? '').trim(),
      locale: langue(u.locale as string | null),
      domainId: publication.domain_id,
      slug: (dom?.slug as string | null) ?? null,
      lien,
      titre: publication.title,
      anonymise: !!u.anonymized_at,
    },
  }
}

/**
 * LA CLOCHE — une ligne `notifications`, sous la pièce du geste. Rend `{ ecrite }` (et la raison d'un refus) : l'appelant DIT à
 * l'administrateur quand l'auteur n'a pas pu être prévenu (un échec se dit, §D.36).
 */
export async function prevenirDansLaCloche(
  admin: SupabaseClient,
  d: Destinataire,
  args: { piece: string; publicationId: string; decision: Decision; motif: string | null },
): Promise<{ ecrite: true } | { ecrite: false; raison: string }> {
  const t = TEXTES[d.locale].cloche[args.decision]
  const { error } = await admin.from('notifications').insert({
    piece: args.piece,
    user_id: d.userId,
    domain_id: d.domainId,
    type: args.decision === 'validee' ? 'annonce_validee' : 'annonce_refusee',
    channel: 'inapp',
    // La colonne fait 200 caractères : un titre d'annonce très long est coupé dans le TITRE de la notification,
    // jamais dans son corps.
    title: remplir(t.titre, { titre: d.titre }).slice(0, 200),
    body: remplir(t.corps, { titre: d.titre, motif: args.motif ?? '' }),
    link_url: d.lien,
    status: 'pending',
    entity_id: args.publicationId,
  })
  // Une écriture refusée n'est pas « personne à prévenir » : la forme le dit, et l'appelant le dit à l'administrateur.
  if (error) {
    console.error('[validation-annonces] cloche : notification non écrite', { publicationId: args.publicationId, message: error.message })
    return { ecrite: false, raison: error.message }
  }
  return { ecrite: true }
}

/**
 * L'E-MAIL — best-effort, appelé dans un `after()` par la route. Il NE PART PAS plutôt que de partir faux : adresse
 * de l'écosystème inconnaissable ou inconstructible (`base` nulle, §E.83 — la route la calcule par `expertSiteOrigin`),
 * compte anonymisé ou sans adresse.
 */
export async function envoyerEmailDecision(
  admin: SupabaseClient,
  d: Destinataire,
  args: { decision: Decision; motif: string | null; base: string | null; publicationId: string },
): Promise<void> {
  if (!d.email || d.anonymise) {
    console.warn('[validation-annonces] e-mail non envoyé — compte sans adresse ou anonymisé', { publicationId: args.publicationId })
    return
  }
  if (!args.base) {
    console.error('[validation-annonces] e-mail ANNULÉ — adresse de l écosystème inconnaissable ou inconstructible', { publicationId: args.publicationId })
    return
  }
  const url = `${args.base}/${d.locale}${d.lien}`
  const brandName = await resolveEmailBrandName(admin, d.domainId)
  const m = TEXTES[d.locale].email[args.decision]
  const commun = getEmailMessages(d.locale)
  const v = { prenom: d.prenom || (d.email.split('@')[0] ?? ''), titre: d.titre, motif: args.motif ?? '' }

  const bonjour = interpolate(m.bonjour, v)
  const corps = interpolate(m.corps, v)
  // Le motif, tel que l'administrateur l'a écrit — échappé, ses retours à la ligne gardés.
  const motifHtml = args.decision === 'refusee' && args.motif && m.motif
    ? `<p style="margin:0 0 12px;padding:10px 14px;border-left:3px solid ${COULEURS_EMAIL.bordure};color:${COULEURS_EMAIL.texteSecondaire};white-space:pre-wrap;">${interpolate(m.motif, v)}</p>`
    : ''
  const suite = interpolate(m.suite, v)
  const bodyHtml = `<p style="margin:0 0 12px;">${bonjour}</p>
<p style="margin:0 0 12px;">${corps}</p>
${motifHtml}
<p style="margin:0;">${suite}</p>`
  const morceaux = [stripHtml(bonjour), '', stripHtml(corps)]
  if (motifHtml && m.motif) morceaux.push('', stripHtml(interpolate(m.motif, v)))
  morceaux.push('', stripHtml(suite))

  const cadre = { brandName, title: m.titre, ctaLabel: m.bouton, ctaUrl: url, signature: commun.common_signature, footer: commun.common_footer }
  const res = await sendEmail({
    to: d.email,
    subject: interpolateTexte(m.sujet, v),
    html: renderEmailHtml({ ...cadre, bodyHtml }),
    text: renderEmailText({ ...cadre, bodyText: morceaux.join('\n') }),
    preheader: interpolateTexte(m.preambule, v),
    tag: args.decision === 'validee' ? 'annonce_validee' : 'annonce_refusee',
  })
  console.log('[validation-annonces] e-mail', { publicationId: args.publicationId, ok: res.ok, code: res.ok ? null : res.code })
}

/** Un sujet et un préambule sont du TEXTE (en-têtes de l'e-mail) : remplis sans échappement HTML. */
const interpolateTexte = remplir
