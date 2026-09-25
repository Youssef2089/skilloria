import type { SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'
import { dashboardUrlForUserType } from '@/lib/auth-routing'
import { conversationExpiryIso } from '@/lib/conversations/expiry'
import { parametresJournal, type ContexteJournal } from '@/lib/journal/contexte'

/**
 * lib/unlock.ts — cœur mécanique du dévoilement d'une candidature, PARTAGÉ.
 *
 * Extrait tel quel de app/api/candidatures/[id]/unlock/route.ts (Lot 3,
 * déplacement pur — zéro changement de comportement). Réutilisé par :
 *  - l'unlock MANUEL (route unlock, avec gate quota manual_unlocks) ;
 *  - l'AUTO-dévoilement top-1 (route de création de candidature, sans quota).
 *
 * performUnlock ne gère NI l'auth NI l'ownership NI le quota : c'est la
 * responsabilité de l'appelant. Idempotent et sûr en cas d'échec partiel.
 */

export const ALLOWED_PREVIOUS_STATUSES: readonly string[] = ['received', 'in_review', 'shortlisted']

// Convention notifications (cf. Lot 2a/2b) :
//   channel : 'inapp' (CHECK : email | inapp | both)
//   status  : 'pending' (CHECK : pending | sent | failed | read)
const NOTIF_TYPE = 'candidature_unlocked'
const NOTIF_CHANNEL = 'inapp'
const NOTIF_STATUS = 'pending'

// Titres/bodies par locale expert.
const NOTIF_LOCALES = ['fr', 'en', 'es', 'de'] as const
type NotifLocale = (typeof NOTIF_LOCALES)[number]
function normalizeNotifLocale(raw: string | null | undefined): NotifLocale {
  if (raw && (NOTIF_LOCALES as readonly string[]).includes(raw)) return raw as NotifLocale
  return 'fr'
}
const NOTIF_TITLE: Record<NotifLocale, string> = {
  fr: 'Votre candidature a été acceptée',
  en: 'Your application has been accepted',
  es: 'Tu candidatura ha sido aceptada',
  de: 'Ihre Bewerbung wurde angenommen',
}
const NOTIF_BODY: Record<NotifLocale, (args: { title: string }) => string> = {
  fr: ({ title }) => `L'entreprise souhaite échanger avec vous concernant l'opportunité « ${title} ».`,
  en: ({ title }) => `The company would like to discuss the opportunity "${title}" with you.`,
  es: ({ title }) => `La empresa quiere conversar contigo sobre la oportunidad «${title}».`,
  de: ({ title }) => `Das Unternehmen möchte mit Ihnen über die Möglichkeit „${title}" sprechen.`,
}

type UnlockJoined = {
  id: string
  publication_id: string
  profile_id: string
  domain_id: string
  status: string
  unlocked_at: string | null
  publications:
    | { id: string; organization_id: string; title: string }
    | { id: string; organization_id: string; title: string }[]
}

export type PerformUnlockResult =
  | {
      ok: true
      alreadyUnlocked: boolean
      didFlip: boolean
      conversationId: string | null
      unlockedAt: string | null
    }
  | { ok: false; code: 'not_found' | 'invalid_transition' | 'db_error'; current?: string }

/**
 * ORDRE : (1) INSERT conversation (idempotent par sa clé) + (2) UPDATE status
 * 'unlocked' + la ligne du grand livre, EN UN SEUL APPEL SQL sous verrou de
 * ligne (§D.26) → (3) notif expert (best-effort) → (4) audit (detail.auto
 * reflète l'origine). Étapes 3-4 seulement au flip réel.
 */
export async function performUnlock(
  admin: SupabaseClient,
  candidatureId: string,
  opts: {
    auto: boolean
    actorUserId: string
    /**
     * Fenêtre d'échange, en jours — EXIGÉE, aucun défaut (cf. lib/durees.ts).
     * C'est ici, et nulle part ailleurs, que la date est POSÉE : d'où le fait
     * qu'un changement de réglage n'affecte jamais un échange déjà ouvert.
     */
    fenetreEchangeJours: number
    /** Le contexte du geste (§D.26) : la RPC écrit `devoilement_ouvert` sous sa pièce. */
    journal: ContexteJournal
  },
): Promise<PerformUnlockResult> {
  // Charge candidature + publication (self-contained pour la réutilisation).
  const { data: cand, error: candErr } = await admin
    .from('candidatures')
    .select(
      'id, publication_id, profile_id, domain_id, status, unlocked_at, ' +
        'publications!inner(id, organization_id, title)',
    )
    .eq('id', candidatureId)
    .maybeSingle()
  if (candErr) {
    console.error('[performUnlock] candidature lookup failed', candErr.message)
    return { ok: false, code: 'db_error' }
  }
  if (!cand) return { ok: false, code: 'not_found' }
  const candRow = cand as unknown as UnlockJoined
  const pub = Array.isArray(candRow.publications) ? candRow.publications[0] : candRow.publications
  if (!pub) return { ok: false, code: 'not_found' }

  // Garde de transition.
  const isAlreadyUnlocked = candRow.status === 'unlocked'
  if (!isAlreadyUnlocked && !ALLOWED_PREVIOUS_STATUSES.includes(candRow.status)) {
    return { ok: false, code: 'invalid_transition', current: candRow.status }
  }

  // (1)+(2) LA CONVERSATION, LA BASCULE ET LA LIGNE DU GRAND LIVRE, EN UN SEUL
  //  APPEL (§D.26). `devoiler_candidature` verrouille la candidature, pose la
  //  conversation (idempotente par sa clé unique), bascule `unlocked` et écrit
  //  `devoilement_ouvert` dans la même transaction. Déjà dévoilée : la
  //  conversation est réconciliée, rien n'est journalisé (`deja`). La garde de
  //  transition est REJOUÉE sous verrou : deux dévoilements simultanés se
  //  sérialisent, le second lit « déjà ».
  //  Fenêtre de validité RÉGLABLE : expires_at posé à la création, à partir de
  //  la valeur lue par la route. La règle vit dans lib/conversations/expiry.ts —
  //  SOURCE UNIQUE partagée avec la dérivation d'état de vie des candidatures
  //  (lib/candidatures/lifecycle.ts), qui doit lire EXACTEMENT la même règle.
  const expiresAtIso = conversationExpiryIso({ fenetreEchangeJours: opts.fenetreEchangeJours })
  const { data: verdictBrut, error: rpcErr } = await admin.rpc('devoiler_candidature', {
    ...parametresJournal(opts.journal),
    p_candidature_id: candidatureId,
    p_statuts_admis: [...ALLOWED_PREVIOUS_STATUSES],
    p_expires_at: expiresAtIso,
    p_auto: opts.auto,
  })
  if (rpcErr) {
    console.error('[performUnlock] dévoilement en échec', rpcErr.message)
    return { ok: false, code: 'db_error' }
  }
  const verdict = verdictBrut as {
    issue: 'devoilee' | 'deja' | 'transition' | 'introuvable'
    conversation_id?: string | null
    unlocked_at?: string | null
    current?: string
  } | null
  if (!verdict || verdict.issue === 'introuvable') return { ok: false, code: 'not_found' }
  if (verdict.issue === 'transition') return { ok: false, code: 'invalid_transition', current: verdict.current }
  const conversationId: string | null = verdict.conversation_id ?? null
  if (conversationId === null) {
    // Dévoilée sans fil : rendre `ok` ferait aboutir un déverrouillage PAYÉ
    // sans le fil qu'il achète — « déverrouillé, et rien à ouvrir ». On
    // refuse plutôt que de livrer une moitié (§E.22).
    console.error('[performUnlock] dévoilement sans conversation', { candidatureId, issue: verdict.issue })
    return { ok: false, code: 'db_error' }
  }
  const unlockedAtIso: string | null = verdict.unlocked_at ?? candRow.unlocked_at
  const didFlip = verdict.issue === 'devoilee'

  // (3) Notif expert (best-effort) — uniquement au flip réel.
  if (didFlip) {
    // Best-effort ASSUMÉ : l'expert peut ne pas être notifié, le
    // déverrouillage lui reste acquis. Mais un silence total ferait chercher un
    // bug de notification là où il y a une panne de lecture.
    const { data: profileWithUser, error: pwuErr } = await admin
      .from('profiles')
      .select('id, user_id, users!profiles_user_id_fkey!inner(id, locale, user_type)')
      .eq('id', candRow.profile_id)
      .maybeSingle()
    type ProfUser = {
      id: string
      user_id: string
      users:
        | { id: string; locale: string | null; user_type: string | null }
        | { id: string; locale: string | null; user_type: string | null }[]
    }
    if (pwuErr) {
      console.error('[performUnlock] profil pour notification en panne — expert NON prévenu', {
        candidatureId,
        message: pwuErr.message,
      })
    }
    const pwu = profileWithUser as unknown as ProfUser | null
    if (pwu) {
      const u = Array.isArray(pwu.users) ? pwu.users[0] : pwu.users
      const loc = normalizeNotifLocale(u?.locale ?? null)
      const linkUrl = `${dashboardUrlForUserType(u?.user_type ?? null)}/missions/${candRow.publication_id}`
      const { error: notifErr } = await admin.from('notifications').insert({
        user_id: pwu.user_id,
        domain_id: candRow.domain_id,
        type: NOTIF_TYPE,
        channel: NOTIF_CHANNEL,
        title: NOTIF_TITLE[loc],
        body: NOTIF_BODY[loc]({ title: pub.title }),
        link_url: linkUrl,
        status: NOTIF_STATUS,
        entity_id: candidatureId,
      })
      if (notifErr) {
        console.error('[performUnlock] notif insert failed', notifErr.message)
      }
    }
  }

  // (4) Audit best-effort — detail.auto distingue l'auto-dévoilement de l'unlock manuel.
  if (didFlip) {
    await logAudit({
      supabaseAdmin: admin,
      user_id: opts.actorUserId,
      domain_id: candRow.domain_id,
      action: 'candidature_unlocked',
      entity_type: 'candidature',
      entity_id: candidatureId,
      detail: {
        publication_id: candRow.publication_id,
        profile_id: candRow.profile_id,
        conversation_id: conversationId,
        auto: opts.auto,
      },
    })
  }

  // « Déjà dévoilée » est le verdict de la BASE, sous verrou — pas celui de la
  // lecture d'avant, qu'un dévoilement concurrent a pu rendre fausse.
  return { ok: true, alreadyUnlocked: verdict.issue === 'deja', didFlip, conversationId, unlockedAt: unlockedAtIso }
}
