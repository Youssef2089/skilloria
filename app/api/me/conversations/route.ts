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
import { chargerDurees, DUREES_ILLISIBLES_CODE } from '@/lib/durees'
import { signOrgLogoUrls } from '@/lib/org-logo'
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

  // ── LES DURÉES SONT LUES ICI, PAR LA ROUTE ───────────────────────────────
  //  Aucun défaut dans le code (cf. lib/durees.ts) : illisibles, on REFUSE en
  //  le nommant plutôt que de servir une durée inventée. Même parti pris que
  //  `matching_settings` — un repli codé en dur devient une seconde source de
  //  vérité, et elle prend la main le jour où l'on comprend le moins.
  const lectureDurees = await chargerDurees(auth.supabaseAdmin)
  if (!lectureDurees.ok) {
    console.error('[me/conversations:GET] durées de la place illisibles', lectureDurees.raison)
    return json({ error: 'Durations unavailable', code: DUREES_ILLISIBLES_CODE }, 503)
  }
  const durees = lectureDurees.durees

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

  // ⚠️ QUATRE LECTURES, UN SEUL FAIT : la liste des conversations visibles.
  //    Aucune ne recuperait son erreur, et chacune retombait sur `[]`. Une
  //    seule panne — cote expert OU cote organisation — produisait donc
  //    « vous n'avez aucune conversation », dit a quelqu'un qui en a.
  //    Une liste INCOMPLETE qui se presente comme COMPLETE est une
  //    affirmation, pas une absence. On ne sert pas la moitie d’une reponse.
  let listeComplete = true

  // (1) Expert
  const candIdsExpert: string[] = []
  const { data: myProfile, error: myProfileErr } = await auth.supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (myProfileErr) listeComplete = false
  if (myProfile) {
    const { data: rows, error: rowsErr } = await auth.supabaseAdmin
      .from('candidatures')
      .select('id')
      .eq('profile_id', (myProfile as { id: string }).id)
      .in('status', CONVERSATION_STATUSES as unknown as string[])
    if (rowsErr) listeComplete = false
    for (const r of (rows ?? []) as { id: string }[]) candIdsExpert.push(r.id)
  }

  // (2) Org membre actif
  const candIdsOrg: string[] = []
  if (auth.organization?.id) {
    const { data: pubs, error: pubsErr } = await auth.supabaseAdmin
      .from('publications')
      .select('id')
      // CLOISONNEMENT — côté organisation uniquement : les conversations suivent
      // l'annonce, donc son écosystème.
      .eq('organization_id', auth.organization.id)
      .eq('domain_id', activeEcosystemId(auth))
    if (pubsErr) listeComplete = false
    const pubIds = ((pubs ?? []) as { id: string }[]).map((p) => p.id)
    if (pubIds.length > 0) {
      const { data: rows, error: rowsErr } = await auth.supabaseAdmin
        .from('candidatures')
        .select('id')
        .in('publication_id', pubIds)
        .in('status', CONVERSATION_STATUSES as unknown as string[])
      if (rowsErr) listeComplete = false
      for (const r of (rows ?? []) as { id: string }[]) candIdsOrg.push(r.id)
    }
  }

  // ⚠️ LE REFUS EST UNIQUE, ET IL EST ICI : les quatre lectures repondent a
  //    la meme question, donc elles echouent ensemble ou pas du tout.
  //    503, motif nomme, refus TEMPORAIRE — « aucune conversation » serait
  //    un verdict.
  if (!listeComplete) {
    console.error('[me/conversations] liste INCOMPLETE — aucune reponse servie', { userId })
    return json(
      { error: 'Could not list conversations', code: 'conversations_indisponibles' },
      503,
    )
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
    // ── APERÇU + NON-LUS : UNE LIGNE PAR CONVERSATION, GARANTIE ────────────
    //
    //  CE QUI CLOCHAIT, ET CE N'ÉTAIT PAS UNE TRONCATURE.
    //    On lisait les 500 derniers messages TOUTES CONVERSATIONS CONFONDUES,
    //    puis on gardait le premier vu par conversation. Au-delà de 500
    //    messages cumulés, les fils les moins récents n'apparaissaient dans
    //    AUCUNE ligne lue : ils n'avaient aucun aperçu. Or une conversation
    //    sans aperçu se lit « personne n'a rien écrit » — l'inverse de la
    //    vérité. Le compteur de non-lus, dérivé de la MÊME lecture,
    //    sous-comptait pour la même raison : un fil pouvait afficher zéro
    //    non-lu tout en en ayant.
    //
    //  POURQUOI UNE FONCTION SQL.
    //    « Une ligne par groupe » ne s'exprime pas en PostgREST. Les seules
    //    issues sans fonction étaient une requête par conversation — jusqu'à
    //    200 allers-retours sur une liste qu'on ouvre souvent — ou un plafond
    //    plus haut, c'est-à-dire le même défaut plus tard et toujours muet.
    //    `distinct on` le fait en une passe indexée : le coût devient
    //    proportionnel au nombre de CONVERSATIONS, plus au nombre de messages.
    //    C'est strictement moins de travail qu'avant, où 500 lignes étaient
    //    lues puis jetées à chaque ouverture.
    //
    //  L'ERREUR EST MAINTENANT TRAITÉE. Elle ne l'était pas : le `error` de
    //  cette lecture n'était même pas déstructuré. Une panne rendait zéro
    //  aperçu partout, silencieusement — exactement le symptôme du défaut
    //  qu'on corrige, donc impossible à distinguer de lui.
    const { data: apercus, error: apErr } = await auth.supabaseAdmin.rpc('conversation_apercus', {
      p_conversation_ids: convIds,
      p_user_id: userId,
    })
    if (apErr) {
      console.error('[me/conversations:GET] aperçus failed', apErr.message)
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }
    for (const a of ((apercus ?? []) as {
      conversation_id: string
      content: string
      created_at: string
      sender_id: string
      non_lus: number
    }[])) {
      lastMsgByConv.set(a.conversation_id, {
        content: a.content,
        created_at: a.created_at,
        sender_id: a.sender_id,
      })
      // Une conversation sans message ne renvoie aucune ligne : elle reste à
      // zéro non-lu, et sans aperçu — le seul cas où « pas d'aperçu » est vrai.
      if (a.non_lus > 0) unreadByConv.set(a.conversation_id, Number(a.non_lus))
    }
  }

  // ── Logos d'organisation : URL SIGNÉES, en UN SEUL aller-retour ─────────
  //
  // `organizations.logo_url` n'est plus une adresse mais un DRAPEAU de présence
  // (migration 20260916300000). Servie brute dans `avatar_url`, elle partait
  // dans un `<img src>` de l'inbox côté expert — une adresse choisie par
  // l'organisation, donc un mouchard. On signe un chemin DÉRIVÉ.
  //
  // EN LOT, et pas une signature par ligne : une inbox est une LISTE, et la
  // latence grandirait avec le nombre de fils — c'est-à-dire exactement quand
  // l'utilisateur en a le plus.
  const orgIdsInbox: string[] = []
  for (const conv of convRows) {
    const c = pickRel(conv.candidatures as never) as { publications?: unknown } | null
    const p = pickRel(c?.publications as never) as { organizations?: unknown } | null
    const o = pickRel(p?.organizations as never) as { id?: string } | null
    if (o?.id) orgIdsInbox.push(o.id)
  }
  const logosSignes = await signOrgLogoUrls(auth.supabaseAdmin, orgIdsInbox)

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
      { ...durees, now },
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
          // L'URL SIGNÉE, jamais la valeur de la colonne.
          avatar_url: (org?.id ? logosSignes.get(org.id) : null) ?? null,
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
