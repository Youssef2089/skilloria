import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import {
  BUCKET_LOGOS_ORG,
  LOGO_TAILLE_MAX_OCTETS,
  LOGO_TYPES_ACCEPTES,
  orgLogoStoragePath,
  signOrgLogoUrl,
  verifierFichierLogo,
} from '@/lib/org-logo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * /api/me/organisation/logo — LE LOGO DE L'ORGANISATION.
 *
 *   GET    → l'URL SIGNEE du logo (300 s), ou null.
 *   POST   → televerse un logo (admin actif uniquement).
 *   DELETE → retire le logo (admin actif uniquement).
 *
 * ┌─ POURQUOI L'ECRITURE PASSE PAR LE SERVEUR ─────────────────────────────┐
 * │ Le bucket `avatars` ecrit en CLIENT-DIRECT sous policy RLS. Ce modele   │
 * │ etait le candidat naturel — il est REFUSE ici pour une raison precise : │
 * │ les octets ne passeraient jamais par nous, et la verification du        │
 * │ CONTENU du fichier (lib/org-logo.ts) serait alors impossible. Storage   │
 * │ ne sait filtrer que sur le `Content-Type` DECLARE, c'est-a-dire sur une │
 * │ affirmation du client.                                                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * GARDE : `role_in_org === 'admin'`, strictement le meme predicat que
 * PATCH /api/me/organisation. On ETEND la garde existante, on ne la refait pas.
 * `editor` est traite comme `viewer` : le logo est l'identite visuelle de
 * l'entreprise, pas un contenu editorial (decision figee, §D de CLAUDE.md).
 *
 * La garde vit AUSSI en base : les policies `org_logos_admin_*` de la migration
 * 20260916300000 exigent `is_active_admin_of_org`. Un client-direct est refuse
 * meme si cette route disparaissait.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type AuthResolu = Awaited<ReturnType<typeof requireAuth>>
type OrgResolue = NonNullable<AuthResolu['organization']>

/**
 * Resout l'organisation. Facteur commun aux trois verbes.
 *
 * Le type est ECRIT plutot qu'infere : une union inferee laisse `erreur`
 * optionnelle sur les deux branches, et l'appelant recupere alors
 * `Response | undefined` — ce que le compilateur refuse a juste titre.
 */
type GardeOrg =
  | { erreur: Response; auth?: undefined; org?: undefined }
  | { erreur?: undefined; auth: AuthResolu; org: OrgResolue }

async function gardeAdminOrg(request: NextRequest): Promise<GardeOrg> {
  const auth = await requireAuth(request)
  const org = auth.organization
  if (!org) {
    return { erreur: json({ error: 'No organization', code: 'no_organization' }, 403) }
  }
  return { auth, org }
}

// ─── GET : l'URL signee ──────────────────────────────────────────────────────
//
// Pourquoi une route pour lire : trois ecrans lisent l'organisation en
// CLIENT-DIRECT (page organisation, barre laterale, annonces). Un client ne
// peut pas signer — il n'a pas le service-role. La lecture est donc faite par
// une route, et le client ne fait qu'afficher (meme discipline que §E.15).
//
// Ouvert a TOUT MEMBRE ACTIF, pas seulement aux admins : un viewer a le droit
// de VOIR le logo de son organisation, il n'a pas le droit de le changer.
export async function GET(request: NextRequest): Promise<Response> {
  let ctx
  try {
    ctx = await gardeAdminOrg(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  if (ctx.erreur) return ctx.erreur
  const { auth, org } = ctx

  const { data: row } = await auth.supabaseAdmin
    .from('organizations')
    .select('logo_url')
    .eq('id', org.id)
    .maybeSingle()

  const url = await signOrgLogoUrl(
    auth.supabaseAdmin,
    org.id,
    (row as { logo_url: string | null } | null)?.logo_url,
  )
  return json({ logo_url: url }, 200)
}

// ─── POST : televerser ───────────────────────────────────────────────────────
export async function POST(request: NextRequest): Promise<Response> {
  let ctx
  try {
    ctx = await gardeAdminOrg(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  if (ctx.erreur) return ctx.erreur
  const { auth, org } = ctx

  // Le refus de role vient AVANT toute lecture du corps : on ne consomme pas
  // 2 Mo de reseau pour repondre 403 ensuite.
  if (org.role_in_org !== 'admin') {
    return json({ error: 'Admin role required', code: 'not_org_admin' }, 403)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    console.error('[organisation/logo] formData illisible', err)
    return json({ error: 'Invalid form body', code: 'invalid_body' }, 400)
  }

  const file = formData.get('file')
  if (!file || typeof file === 'string') {
    return json({ error: 'File required', code: 'logo_absent' }, 400)
  }

  const octets = new Uint8Array(await file.arrayBuffer())
  const verdict = verifierFichierLogo(octets, file.type)
  if (!verdict.ok) {
    // Le code EST la raison : format, taille, contenu, incoherence. L'ecran en
    // fait une phrase actionnable. Jamais « une erreur est survenue ».
    return json(
      {
        error: verdict.code,
        code: verdict.code,
        // De quoi construire un message chiffre sans rien coder en dur a l'ecran.
        limites: {
          taille_max_octets: LOGO_TAILLE_MAX_OCTETS,
          types: LOGO_TYPES_ACCEPTES,
        },
      },
      400,
    )
  }

  const chemin = orgLogoStoragePath(org.id)
  const { error: storageErr } = await auth.supabaseAdmin.storage
    .from(BUCKET_LOGOS_ORG)
    .upload(chemin, octets, {
      // Le type REEL, reniflé dans les octets — pas celui que le client annonce.
      contentType: verdict.type,
      upsert: true,
    })
  if (storageErr) {
    console.error('[organisation/logo] dépôt impossible', {
      orgId: org.id,
      msg: storageErr.message,
    })
    return json({ error: 'Storage unavailable', code: 'logo_stockage_indisponible' }, 503)
  }

  // Le DRAPEAU de presence. Ce n'est pas une adresse : le CHECK
  // `organizations_logo_url_chemin_check` refuse tout ce qui n'est pas ce
  // chemin derive, et le serveur recalcule toujours le chemin de son cote.
  const { error: dbErr } = await auth.supabaseAdmin
    .from('organizations')
    .update({ logo_url: chemin, updated_at: new Date().toISOString() })
    .eq('id', org.id)

  if (dbErr) {
    console.error('[organisation/logo] drapeau non posé', { orgId: org.id, msg: dbErr.message })
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'organization_logo_updated',
    entity_type: 'organizations',
    entity_id: org.id,
    detail: { type: verdict.type, octets: octets.length },
  })

  const url = await signOrgLogoUrl(auth.supabaseAdmin, org.id, chemin)
  return json({ logo_url: url }, 200)
}

// ─── DELETE : retirer ────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest): Promise<Response> {
  let ctx
  try {
    ctx = await gardeAdminOrg(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  if (ctx.erreur) return ctx.erreur
  const { auth, org } = ctx

  if (org.role_in_org !== 'admin') {
    return json({ error: 'Admin role required', code: 'not_org_admin' }, 403)
  }

  // L'ORDRE COMPTE : le fichier d'abord, le drapeau ensuite.
  //
  // Si le drapeau tombait en premier et que la suppression du fichier echouait,
  // il resterait un objet que plus rien ne designe — invisible, et jamais
  // nettoye. Dans l'ordre inverse, le pire cas est un drapeau qui survit a son
  // fichier : la signature rend alors `null` et l'ecran montre l'etat vide.
  // Une incoherence qui s'affiche correctement vaut mieux qu'un orphelin muet.
  const { error: rmErr } = await auth.supabaseAdmin.storage
    .from(BUCKET_LOGOS_ORG)
    .remove([orgLogoStoragePath(org.id)])
  if (rmErr) {
    console.error('[organisation/logo] suppression impossible', {
      orgId: org.id,
      msg: rmErr.message,
    })
    return json({ error: 'Storage unavailable', code: 'logo_stockage_indisponible' }, 503)
  }

  const { error: dbErr } = await auth.supabaseAdmin
    .from('organizations')
    .update({ logo_url: null, updated_at: new Date().toISOString() })
    .eq('id', org.id)

  if (dbErr) {
    console.error('[organisation/logo] drapeau non retiré', { orgId: org.id, msg: dbErr.message })
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'organization_logo_removed',
    entity_type: 'organizations',
    entity_id: org.id,
    detail: {},
  })

  return json({ logo_url: null }, 200)
}
