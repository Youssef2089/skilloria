import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth-guard'
import { avatarStoragePath } from '@/lib/avatar'
import { verifierFichierLogo, LOGO_TAILLE_MAX_OCTETS, LOGO_TYPES_ACCEPTES, type RefusLogo } from '@/lib/org-logo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/profile/photo — DÉPOSE la photo de profil, par le serveur
 * (recette staging du 01/10/2026, point 8).
 *
 * ┌─ LA CAUSE DE « ERREUR LORS DE L'ENREGISTREMENT » ───────────────────────┐
 * │ La fenêtre de la photo écrivait le fichier DEPUIS LE NAVIGATEUR, dans le │
 * │ bucket `avatars`, en `upsert`. Ce bucket est devenu privé (migration     │
 * │ avatars_private) et sa politique de LECTURE a été retirée ; or un        │
 * │ `upsert` de Storage exige la lecture en plus de l'écriture. Le premier   │
 * │ dépôt passait (une insertion), chaque REMPLACEMENT échouait — et l'écran │
 * │ disait « Erreur lors de l'enregistrement » pour toute cause, sans la     │
 * │ nommer. Ce n'était PAS le profil : `photo_url` passait déjà par le       │
 * │ serveur (PATCH /api/profile). C'était le STOCKAGE.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * LA RÈGLE, comme pour « Repasser à l'écoute » (POST /api/profile/disponibilite)
 * et le logo d'organisation : le navigateur n'écrit plus rien lui-même. Les
 * octets passent par ici, leur CONTENU est vérifié (type réel reniflé, taille —
 * lib/org-logo.ts, le seul vérificateur d'image du dépôt), puis la clé de service
 * les dépose au chemin dérivé du compte. Les politiques d'écriture du navigateur
 * sur `avatars` sont retirées par la migration `photo_par_le_serveur`.
 *
 * AUCUNE ÉCRITURE EN BASE ICI : le drapeau `profiles.photo_url` est posé ensuite
 * par PATCH /api/profile, qui porte déjà sa ligne du grand livre (`profil_modifie`).
 * Un second écrivain de la même action serait refusé par le contrôle du grand livre.
 *
 * Codes : `photo_absente`, `photo_trop_volumineuse`, `photo_format_refuse`,
 * `photo_contenu_non_conforme`, `photo_type_incoherent` (400) ; `pas_expert` (403) ;
 * `photo_stockage_indisponible` (503). Chacun a son message, dans les quatre langues.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Le vérificateur parle de logo ; la photo a ses propres codes, stables (checklist 12). */
const CODE_PHOTO: Record<RefusLogo, string> = {
  logo_absent: 'photo_absente',
  logo_trop_volumineux: 'photo_trop_volumineuse',
  logo_format_refuse: 'photo_format_refuse',
  logo_contenu_non_conforme: 'photo_contenu_non_conforme',
  logo_type_incoherent: 'photo_type_incoherent',
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // La photo de profil est celle d'un EXPERT : la fenêtre n'existe que sur « Mon profil ».
  const { data: compte, error: compteErr } = await auth.supabaseAdmin
    .from('users')
    .select('user_type')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (compteErr) {
    console.error('[profile/photo] type de compte illisible', { userId: auth.user.id, message: compteErr.message })
    return json({ error: 'Account unavailable', code: 'photo_stockage_indisponible' }, 503)
  }
  const type = (compte as { user_type?: string | null } | null)?.user_type ?? null
  if (type !== 'expert_freelance' && type !== 'expert_cdi') {
    return json({ error: 'Experts only', code: 'pas_expert' }, 403)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    console.error('[profile/photo] corps illisible', err)
    return json({ error: 'Invalid form body', code: 'photo_absente' }, 400)
  }
  const file = formData.get('photo')
  if (!file || typeof file === 'string') {
    return json({ error: 'Photo required', code: 'photo_absente' }, 400)
  }

  const verdict = verifierFichierLogo(new Uint8Array(await file.arrayBuffer()), file.type)
  if (!verdict.ok) {
    return json(
      {
        error: CODE_PHOTO[verdict.code],
        code: CODE_PHOTO[verdict.code],
        limites: { taille_max_octets: LOGO_TAILLE_MAX_OCTETS, types: LOGO_TYPES_ACCEPTES },
      },
      400,
    )
  }

  // Le chemin est DÉRIVÉ du compte (lib/avatar.ts) : rien de ce que le client envoie ne le choisit.
  const chemin = avatarStoragePath(auth.user.id)
  const { error: storageErr } = await auth.supabaseAdmin.storage
    .from('avatars')
    .upload(chemin, verdict.octets, { contentType: verdict.type, upsert: true })
  if (storageErr) {
    console.error('[profile/photo] dépôt impossible', { userId: auth.user.id, message: storageErr.message })
    return json({ error: 'Storage unavailable', code: 'photo_stockage_indisponible' }, 503)
  }

  return json({ chemin }, 200)
}
