import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { activeEcosystemId } from '@/lib/ecosystem-scope'
import { loadTranslations } from '@/lib/translations'
import { routing, type Locale } from '@/i18n/routing'
import { buildPublicationSynthesis } from '@/lib/publication-synthesis'
import { maskExpertNameForOrg, type ExpertAccountState } from '@/lib/expert-name-masking'
import { disclosurePolicyForCandidatureLifecycle } from '@/lib/expert-disclosure'
import { signAvatarUrl } from '@/lib/avatar'
import { isConversationExpired } from '@/lib/conversations/expiry'
import {
  deriveCandidatureLifecycle,
  parseBucketFilter,
  type CandidatureLifecycle,
} from '@/lib/candidatures/lifecycle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function normalizeLocale(raw: string | null): Locale {
  return (routing.locales as readonly string[]).includes(raw ?? '')
    ? (raw as Locale)
    : routing.defaultLocale
}

/**
 * GET /api/me/conversations — inbox du user courant (expert OU membre org).
 *
 * Garde (service_role) :
 *  - requireAuth
 *  - L'user est participant d'une conversation s'il est :
 *      • l'expert : profiles.user_id == auth.uid() ET candidature.profile_id == profiles.id
 *      • OU un membre actif de l'org propriétaire de candidature.publication.
 *
 * Retour : conversations où candidature.status ∈ ('unlocked','selected'),
 *   triées par last_message_at DESC NULLS LAST, puis created_at DESC.
 *
 * Pourquoi 'selected' est INCLUS (correction de cohérence, lot état de vie) :
 *   une candidature retenue conserve sa conversation (caler date / contrat) —
 *   /api/me/candidatures et lib/candidature-org-dto exposent d'ailleurs déjà
 *   son `conversation_id`. Elle était pourtant ABSENTE de l'inbox : le lien
 *   « Ouvrir la conversation » d'une mission remportée pointait vers un fil
 *   introuvable dans la liste. Avec « Actives par défaut », l'issue positive
 *   du parcours doit être dans le bucket Actives, pas nulle part.
 *
 * ?filter=active|archived|all — ACTIVES PAR DÉFAUT. Le bucket vient de la
 *   dérivation serveur partagée (lib/candidatures/lifecycle.ts), la MÊME que
 *   celle qui range les candidatures : un échange archivé côté Messages est
 *   exactement celui qui est archivé côté Candidatures. Une conversation
 *   archivée reste LISIBLE en lecture seule — on n'efface aucun historique.
 *
 * Pour chaque conversation :
 *   - conversation : id, status, last_message_at, expires_at, is_expired
 *   - publication  : id, title, type
 *   - correspondant: { kind:'expert'|'org', name, avatar_url } — projeté
 *     SERVEUR via service_role (D3, identité MUTUELLE post-unlock cf. D6).
 *   - last_message : { content (clip 140), created_at, sender_is_me }
 *   - unread_count : messages WHERE sender_id != auth.uid() AND read_at IS NULL.
 *
 * Note expiry (D5) :
 *   expires_at NULL ⇒ NON expiré (compat conv legacy Lot 2c) ;
 *   expires_at > now() ⇒ NON expiré ;
 *   sinon ⇒ is_expired = true (lecture seule côté UI, écriture bloquée route).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type ConversationRow = {
  id: string
  candidature_id: string
  status: string
  last_message_at: string | null
  expires_at: string | null
  created_at: string
  candidatures: {
    id: string
    status: string
    profile_id: string
    publication_id: string
    profiles: {
      id: string
      user_id: string
      photo_url: string | null
      users: { id: string; first_name: string | null; last_name: string | null } | { id: string; first_name: string | null; last_name: string | null }[]
    } | { id: string; user_id: string; photo_url: string | null; users: { id: string; first_name: string | null; last_name: string | null } | { id: string; first_name: string | null; last_name: string | null }[] }[]
    publications: unknown
  } | { id: string; status: string; profile_id: string; publication_id: string; profiles: unknown; publications: unknown }[]
}

function pickRel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

/** Statuts de candidature dont la conversation est servie dans l'inbox. */
const CONVERSATION_STATUSES = ['unlocked', 'selected'] as const

export async function GET(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const userId = auth.user.id
  const url = new URL(request.url)
  const locale = normalizeLocale(url.searchParams.get('locale'))
  const bucketFilter = parseBucketFilter(url.searchParams.get('filter'))
  // `?focus=<conversationId>` — OPTIONNEL. Cf. le bloc de résolution en fin de
  // route. Absent (tous les appelants existants) ⇒ comportement identique.
  const focusConvId = url.searchParams.get('focus')
  const translations = await loadTranslations(locale)

  // ── Résoudre les conversations où l'user est participant ────────────────
  //  Plus simple en 2 queries jointes : on prend les candidatures dont le
  //  statut ouvre une conversation (unlocked | selected) où profile.user_id =
  //  me OU une publi appartenant à mon org active.
  //  Pour rester service_role et éviter une OR sur RLS, on fait deux SELECT :
  //   (1) candidatures conversables liées à mon profile (expert)
  //   (2) candidatures conversables sur des publis de mon org (membre)
  //  Puis on charge les conversations correspondantes en une 3e query.

  // (1) Expert
  const candIdsExpert: string[] = []
  const { data: myProfile } = await auth.supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (myProfile) {
    const { data: rows } = await auth.supabaseAdmin
      .from('candidatures')
      .select('id')
      .eq('profile_id', (myProfile as { id: string }).id)
      .in('status', CONVERSATION_STATUSES as unknown as string[])
    for (const r of (rows ?? []) as { id: string }[]) candIdsExpert.push(r.id)
  }

  // (2) Org membre actif
  const candIdsOrg: string[] = []
  if (auth.organization?.id) {
    const { data: pubs } = await auth.supabaseAdmin
      .from('publications')
      .select('id')
      // CLOISONNEMENT — côté organisation uniquement : les conversations suivent
      // l'annonce, donc son écosystème.
      .eq('organization_id', auth.organization.id)
      .eq('domain_id', activeEcosystemId(auth))
    const pubIds = ((pubs ?? []) as { id: string }[]).map((p) => p.id)
    if (pubIds.length > 0) {
      const { data: rows } = await auth.supabaseAdmin
        .from('candidatures')
        .select('id')
        .in('publication_id', pubIds)
        .in('status', CONVERSATION_STATUSES as unknown as string[])
      for (const r of (rows ?? []) as { id: string }[]) candIdsOrg.push(r.id)
    }
  }

  const candIds = Array.from(new Set([...candIdsExpert, ...candIdsOrg]))
  if (candIds.length === 0) {
    return json({ conversations: [], counts: { active: 0, archived: 0 }, filter: bucketFilter ?? 'all' }, 200)
  }

  // (3) Charger les conversations + chaîne d'identité
  //  Lot synthèse parlante SC4 : publication enrichie avec
  //  description/seniority/work_mode/expires_at + branches/specialities pour
  //  les labels traduits — alimenter MessageContextPanel inline complet.
  //  Aucun champ PII ajouté (juste des méta publication publiques).
  const { data: convs, error: convErr } = await auth.supabaseAdmin
    .from('conversations')
    .select(
      'id, candidature_id, status, last_message_at, expires_at, created_at, ' +
        // Lot grille photo-forward : `photo_url` RE-INTRODUIT au SELECT.
        // Servi côté ORG UNIQUEMENT post-unlock (une conversation existe
        // déjà = candidature unlocked → policy reveal_photo: true).
        // Servi côté EXPERT : avatar org logo_url comme avant (inchangé).
        // Contact (email/phone) jamais chargé / jamais servi.
        // `unlocked_at` (candidature) + `status`/`published_at` (publication) :
        // entrées de la dérivation d'état de vie (lib/candidatures/lifecycle).
        'candidatures!inner(id, status, profile_id, publication_id, unlocked_at, ' +
          'profiles!inner(id, user_id, photo_url, users!profiles_user_id_fkey(id, first_name, last_name, deletion_scheduled_at, anonymized_at)), ' +
          'publications!inner(id, type, title, description, budget_min, budget_max, ' +
            'location_note, work_zone_ids, work_mode, duration, start_date, seniorities, skills_required, ' +
            'confidential, branch_id, speciality_ids, status, published_at, expires_at, organization_id, ' +
            // Plus d'embed specialities(...) : clé étrangère morte au passage
            // au multiple. Libellés résolus par lot après le chargement.
            'branches(id, name), ' +
            'organizations(id, company_name, logo_url)))',
    )
    .in('candidature_id', candIds)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(200)
  if (convErr) {
    console.error('[me/conversations:GET] query failed', convErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const convRows = (convs ?? []) as unknown as ConversationRow[]

  // ── Pour chaque conv : last message + unread count ─────────────────────
  const convIds = convRows.map((c) => c.id)
  const lastMsgByConv = new Map<string, { content: string; created_at: string; sender_id: string }>()
  const unreadByConv = new Map<string, number>()
  if (convIds.length > 0) {
    // Last message par conv (1 par conv, on lit le plus récent global puis filtre)
    const { data: msgs } = await auth.supabaseAdmin
      .from('messages')
      .select('conversation_id, content, created_at, sender_id, read_at')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false })
      .limit(500)
    const seen = new Set<string>()
    for (const m of ((msgs ?? []) as { conversation_id: string; content: string; created_at: string; sender_id: string; read_at: string | null }[])) {
      if (!seen.has(m.conversation_id)) {
        seen.add(m.conversation_id)
        lastMsgByConv.set(m.conversation_id, { content: m.content, created_at: m.created_at, sender_id: m.sender_id })
      }
      if (m.sender_id !== userId && m.read_at === null) {
        unreadByConv.set(m.conversation_id, (unreadByConv.get(m.conversation_id) ?? 0) + 1)
      }
    }
  }

  // ── DTO : projection correspondant + last_message + unread ──────────────
  // Instant unique pour toute la réponse (cf. /api/me/candidatures).
  const now = new Date()
  const conversations = await Promise.all(convRows.map(async (conv) => {
    const c = pickRel(conv.candidatures) as ConversationRow['candidatures'] extends (infer X)[] | infer Y ? Y : never
    const cand = c as unknown as {
      id: string; status: string; profile_id: string; publication_id: string;
      unlocked_at: string | null;
      profiles: unknown; publications: unknown;
    } | null
    const profile = pickRel(cand?.profiles as { id: string; user_id: string; photo_url: string | null; users: unknown } | { id: string; user_id: string; photo_url: string | null; users: unknown }[] | null)
    const u = pickRel(profile?.users as { id: string; first_name: string | null; last_name: string | null } | { id: string; first_name: string | null; last_name: string | null }[] | null)
    const pub = pickRel(cand?.publications as Record<string, unknown> | Record<string, unknown>[] | null)
    const org = pickRel(pub?.organizations as { id: string; company_name: string | null; logo_url: string | null } | { id: string; company_name: string | null; logo_url: string | null }[] | null)

    // ÉTAT DE VIE dérivé SERVEUR — même helper, mêmes entrées que côté
    // candidatures : un fil rangé dans « Archivées » ici l'est aussi là-bas.
    // Calculé AVANT la projection du correspondant : c'est lui qui décide si
    // l'identité de l'expert est encore divulgable (cf. lot re-masquage).
    const lifecycle = deriveCandidatureLifecycle(
      {
        status: cand?.status ?? 'unlocked',
        unlocked_at: cand?.unlocked_at ?? null,
        publication: pub
          ? {
              status: (pub.status as string | null | undefined) ?? null,
              published_at: (pub.published_at as string | null | undefined) ?? null,
              expires_at: (pub.expires_at as string | null | undefined) ?? null,
            }
          : null,
        conversation: { expires_at: conv.expires_at },
      },
      now,
    )

    // L'user courant est-il l'expert ou l'org ?
    const isMeExpert = profile?.user_id === userId
    const correspondant = isMeExpert
      ? {
          kind: 'org' as const,
          name: org?.company_name ?? null,
          // Une organisation n'est jamais masquée : l'expert voit sa raison
          // sociale. Le champ est servi quand même pour que le client n'ait
          // qu'une seule forme à traiter.
          is_masked: false,
          avatar_url: org?.logo_url ?? null,
        }
      : await (async () => {
          // L'user courant est l'ORG → le correspondant est l'expert. La
          // divulgation passe par la MÊME fonction que les candidatures, sur
          // l'ÉTAT DE VIE : un fil archivé re-masque nom et photo. Le CORPS
          // des messages n'est pas réécrit — on ferme le chemin d'accès
          // permanent, on n'efface pas l'historique.
          // Email, phone, cv, linkedin : JAMAIS (reveal_contact: false en V1).
          const policy = disclosurePolicyForCandidatureLifecycle({
            candidatureStatus: cand?.status ?? 'unlocked',
            lifecycleBucket: lifecycle.bucket,
          })
          const fn = u?.first_name ?? null
          const ln = u?.last_name ?? null
          const fullName = [fn, ln].filter(Boolean).join(' ').trim()
          // Mission S3 : expert en grâce/purge → placeholder prioritaire.
          const accountState = (u ?? undefined) as ExpertAccountState | undefined
          const inDeletion = !!(accountState?.deletion_scheduled_at || accountState?.anonymized_at)
          // Le nom servi est-il un CODE masqué (« YCH ») ou une identité
          // lisible ? Le SERVEUR le dit ; le client ne le devine pas au motif
          // de la chaîne. Sans ce drapeau, la pastille d'avatar devrait
          // reconstruire une règle de sécurité dans le navigateur (point 20).
          const showsMaskedCode =
            !inDeletion && !(policy.reveal_full_name && fullName)
          return {
            kind: 'expert' as const,
            name: inDeletion
              ? maskExpertNameForOrg(fn, ln, accountState, locale)
              : policy.reveal_full_name && fullName
                ? fullName
                : maskExpertNameForOrg(fn, ln, null, locale),
            is_masked: showsMaskedCode,
            // M3 : URL signée (300s). CONDITION inchangée (reveal_photo + photo présente),
            // seule la VALEUR passe en signée (avant : profile.photo_url public).
            avatar_url:
              inDeletion || !policy.reveal_photo || !profile?.photo_url
                ? null
                : await signAvatarUrl(auth.supabaseAdmin, profile.user_id),
          }
        })()

    const lastMsg = lastMsgByConv.get(conv.id) ?? null
    const lastMsgPreview = lastMsg
      ? {
          content: lastMsg.content.length > 140 ? `${lastMsg.content.slice(0, 140)}…` : lastMsg.content,
          created_at: lastMsg.created_at,
          sender_is_me: lastMsg.sender_id === userId,
        }
      : null

    return {
      id: conv.id,
      candidature_id: conv.candidature_id,
      status: conv.status,
      last_message_at: conv.last_message_at,
      expires_at: conv.expires_at,
      is_expired: isConversationExpired(conv.expires_at, now),
      lifecycle,
      created_at: conv.created_at,
      publication: pub
        ? {
            ...buildPublicationSynthesis(pub as Parameters<typeof buildPublicationSynthesis>[0], translations),
            // Champs supplémentaires demandés par MessageContextPanel inline complet :
            description: (pub.description as string | null | undefined) ?? null,
            skills_required: Array.isArray(pub.skills_required) ? (pub.skills_required as string[]) : null,
            expires_at: (pub.expires_at as string | null | undefined) ?? null,
          }
        : null,
      correspondant,
      last_message: lastMsgPreview,
      unread_count: unreadByConv.get(conv.id) ?? 0,
    }
  }))

  // Filtrage APRÈS dérivation (serveur), comptage sur la totalité.
  const counts = { active: 0, archived: 0 }
  for (const c of conversations) counts[(c.lifecycle as CandidatureLifecycle).bucket]++

  // ─── `?focus=<conversationId>` : LE SERVEUR CHOISIT LE BUCKET ────────────
  //
  // POURQUOI
  //   Arriver sur /messages/[id] par un lien externe (détail d'une candidature,
  //   notification) n'apprend rien au client sur le bucket de la conversation
  //   visée. Il partait donc sur 'active' par défaut, et une conversation
  //   ARCHIVÉE se retrouvait exclue de sa propre liste : colonne gauche vide
  //   (« Aucun échange en cours »), panneau droit vide (« Mission non
  //   disponible »), fil ouvert au milieu. Trois zones incohérentes.
  //
  // LE CLIENT NE DEVINE RIEN (point 20)
  //   Il envoie l'id qu'on lui a demandé d'ouvrir ; le serveur — qui vient de
  //   dériver le bucket de TOUTES les conversations, juste au-dessus — décide,
  //   et l'ANNONCE dans le champ `filter` déjà renvoyé. Le client s'y aligne.
  //   Aucune règle dupliquée, un seul aller-retour.
  //
  // STRICTEMENT OPTIONNEL
  //   `focus` absent ⇒ `effectiveFilter === bucketFilter` ⇒ ce bloc est un
  //   non-événement. L'entrée par le MENU (/messages sans id) ne le fournit
  //   jamais : même filtrage, mêmes compteurs, même réponse qu'avant ce lot.
  //   Un id inconnu (conversation d'un autre user, id inventé) ne trouve rien
  //   et retombe sur `bucketFilter` — aucune fuite, aucune erreur.
  const focused = focusConvId
    ? conversations.find((c) => c.id === focusConvId) ?? null
    : null
  const effectiveFilter = focused
    ? (focused.lifecycle as CandidatureLifecycle).bucket
    : bucketFilter

  const visible = effectiveFilter
    ? conversations.filter((c) => (c.lifecycle as CandidatureLifecycle).bucket === effectiveFilter)
    : conversations

  return json({ conversations: visible, counts, filter: effectiveFilter ?? 'all' }, 200)
}
