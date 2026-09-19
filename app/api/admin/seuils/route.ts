import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { SUJETS, type Sujet, DRAPEAUX_CONNUS } from '@/lib/jugement/sujets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET / PATCH /api/admin/seuils — LES TROIS NOTES QUI DÉCIDENT.
 *
 * ┌─ CE QUE CETTE ROUTE NE SERT PLUS, ET POURQUOI ──────────────────────────┐
 * │ Elle rendait TOUTES les lignes de `verification_providers`, actives ou   │
 * │ non, et l'écran les affichait toutes — y compris DEUX qui ne gouvernent  │
 * │ rien : `sirene_insee` (un fournisseur de DONNÉES, dont la colonne de     │
 * │ note n'est lue par aucun chemin) et `claude_profile_matching` (le moteur │
 * │ d'avant le reranking, désactivé mais jamais supprimé).                   │
 * │                                                                          │
 * │ §D.11 : UN ÉCRAN DE RÉGLAGE NE MONTRE QUE CE QUI SE DÉCIDE. Un champ     │
 * │ qui ne règle rien finit par être rempli. Ces deux valeurs sont désormais │
 * │ DOCUMENTÉES (docs/architecture.md §B.2 ⑨) et gardées par un contrôle —   │
 * │ elles ne s'évaporent pas, elles changent de place.                        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ ET C'EST CE QUI FERMAIT LE BUG DE CLÉ i18n ══════════════════════════
 *   L'écran rendait `t(\`types.${provider_type}.name\`)`. La ligne vestige
 *   porte `provider_type = 'profile_matching'`, pour laquelle AUCUNE clé
 *   n'existe dans les quatre langues — next-intl rendait alors le chemin de la
 *   clé, que le style mettait en capitales :
 *   « ADMIN_SEUILS.TYPES.PROFILE_MATCHING.NAME ».
 *   La route ne servant plus que TROIS sujets NOMMÉS, la clé dynamique
 *   disparaît avec eux.
 *
 * ═══ CE QUE CHAQUE SUJET PORTE ═══════════════════════════════════════════
 *   La note qui décide, et le NOMBRE DE DOSSIERS ARRIVÉS CE MOIS-CI. Régler
 *   une note sans savoir combien de dossiers elle vous envoie, c'est choisir
 *   un nombre au hasard — le même reproche que pour les filtres du moteur.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Un ENTIER dans [0,10] : l'échelle unique du produit (§D.10). */
function noteValide(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 10) return null
  return n
}

/** Le premier instant du mois civil en UTC — la même fenêtre que partout ailleurs. */
function debutDuMois(): string {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString()
}

type LigneProvider = {
  id: string
  country_code: string
  provider_type: string
  is_active: boolean
  confidence_threshold: number
  config: Record<string, unknown> | null
  updated_at: string
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const admin = auth.supabaseAdmin
  const depuis = debutDuMois()

  const [fournisseursRes, expertsRes, orgsRes, annoncesRes, paysRes] = await Promise.all([
    admin
      .from('verification_providers')
      .select('id, country_code, provider_type, is_active, confidence_threshold, config, updated_at')
      .eq('is_active', true)
      .order('country_code', { ascending: true }),
    // LES DOSSIERS ARRIVÉS CE MOIS-CI. `head: true` : on veut le COMPTE, pas
    // les lignes — un écran de réglage n'a pas à charger les dossiers.
    admin
      .from('profiles')
      .select('user_id', { count: 'exact', head: true })
      .eq('verification_status', 'pending_admin_review')
      .gte('updated_at', depuis),
    admin
      .from('organizations')
      .select('id', { count: 'exact', head: true })
      .eq('verification_status', 'pending_admin_review')
      .gte('updated_at', depuis),
    admin
      .from('publications')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_review')
      .gte('created_at', depuis),
    admin.from('countries').select('code, name_fr').eq('active', true).order('sort_order'),
  ])

  if (fournisseursRes.error) {
    console.error('[admin:seuils] lecture en échec', fournisseursRes.error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const lignes = (fournisseursRes.data ?? []) as unknown as LigneProvider[]

  /**
   * ⚠️ UN COMPTEUR EN PANNE NE REND PAS ZÉRO (§E.22).
   *    « 0 dossier ce mois-ci » se lit « rien à traiter » et rassure au moment
   *    exact où l'on décide de relever une note. `null` se lit « on ne sait
   *    pas », et l'écran le dit.
   */
  const compte = (res: { error: unknown; count: number | null }): number | null =>
    res.error ? null : (res.count ?? 0)

  const sujets = SUJETS.map((s) => {
    // La ligne qui DÉCIDE pour ce sujet. Une seule est attendue ; plusieurs
    // actives pour le même pays seraient une configuration ambiguë, et on ne
    // choisit pas au hasard.
    const candidates = lignes.filter((l) => l.provider_type === s.provider_type)
    const ligne = candidates.length === 1 ? candidates[0] : null
    const cfg = (ligne?.config ?? {}) as Record<string, unknown>
    const note =
      s.cle_decisive === 'auto_approve_threshold'
        ? typeof cfg.auto_approve_threshold === 'number'
          ? cfg.auto_approve_threshold
          : null
        : (ligne?.confidence_threshold ?? null)

    return {
      sujet: s.sujet,
      provider_id: ligne?.id ?? null,
      note,
      /** `null` = configuration absente ou ambiguë. L'écran le dit, il ne devine pas. */
      ambigu: candidates.length > 1,
      arrives_ce_mois:
        s.sujet === 'experts'
          ? compte(expertsRes)
          : s.sujet === 'entreprises'
            ? compte(orgsRes)
            : compte(annoncesRes),
      drapeaux: s.porte_drapeaux
        ? DRAPEAUX_CONNUS.map((d) => ({
            cle: d,
            actif: Array.isArray(cfg.blocking_flags) && (cfg.blocking_flags as unknown[]).includes(d),
          }))
        : null,
      updated_at: ligne?.updated_at ?? null,
    }
  })

  // ── LES PAYS SANS FOURNISSEUR DE DÉCISION ────────────────────────────────
  //  Sans ligne `ai_web_search` active, toute vérification d'entreprise de ce
  //  pays part en revue manuelle, sans appel au modèle et sans dépense. Ce
  //  n'est PAS une panne — mais il faut pouvoir le lire, et en UNE phrase.
  const avecDecision = new Set(
    lignes.filter((l) => l.provider_type === 'ai_web_search').map((l) => l.country_code),
  )
  const pays = paysRes.error
    ? null
    : ((paysRes.data ?? []) as Array<{ code: string; name_fr: string }>)
        .filter((p) => !avecDecision.has(p.code))
        .map((p) => p.name_fr)

  return json({ sujets, pays_sans_verification: pays }, 200)
}

export async function PATCH(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const admin = auth.supabaseAdmin

  let body: { sujet?: unknown; note?: unknown; drapeaux?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const nom = typeof body.sujet === 'string' ? body.sujet : ''
  const meta = SUJETS.find((s) => s.sujet === nom) as Sujet | undefined
  if (!meta) return json({ error: 'Unknown subject', code: 'unknown_subject' }, 400)

  const note = noteValide(body.note)
  if (note === null) return json({ error: 'Note hors [0,10]', code: 'invalid_note' }, 400)

  const { data: lignes, error: lectureErr } = await admin
    .from('verification_providers')
    .select('id, confidence_threshold, config')
    .eq('provider_type', meta.provider_type)
    .eq('is_active', true)
  if (lectureErr) {
    console.error('[admin:seuils] lecture avant écriture en échec', lectureErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  // ZÉRO ligne ⇒ rien à régler ; PLUSIEURS ⇒ on n'en élit pas une au hasard.
  // Les deux se disent, aucune ne se devine (§E.11).
  if (!lignes || lignes.length !== 1) {
    return json(
      { error: 'No single active provider for this subject', code: 'config_ambigue', trouves: lignes?.length ?? 0 },
      409,
    )
  }
  const ligne = lignes[0] as { id: string; confidence_threshold: number; config: Record<string, unknown> | null }
  const cfg = (ligne.config ?? {}) as Record<string, unknown>

  const patch: Record<string, unknown> = {}
  const avant: Record<string, unknown> = {}

  if (meta.cle_decisive === 'auto_approve_threshold') {
    avant.note = typeof cfg.auto_approve_threshold === 'number' ? cfg.auto_approve_threshold : null
    patch.config = { ...cfg, auto_approve_threshold: note }
  } else {
    avant.note = ligne.confidence_threshold
    patch.confidence_threshold = note
  }

  // ── LES CAS QUI FORCENT LE PASSAGE PAR L'HUMAIN ─────────────────────────
  if (meta.porte_drapeaux && Array.isArray(body.drapeaux)) {
    const demandes = (body.drapeaux as unknown[]).filter(
      (d): d is string => typeof d === 'string' && (DRAPEAUX_CONNUS as readonly string[]).includes(d),
    )
    // AU MOINS UN CAS DOIT RESTER COCHÉ. Tous décochés, un profil incohérent
    // s'auto-approuverait sur la seule note — et la note ne regarde pas ces
    // cas-là. Le refus dit CE QUI BLOQUE, il ne se contente pas de refuser.
    if (demandes.length === 0) {
      return json({ error: 'At least one case must stay checked', code: 'aucun_drapeau' }, 400)
    }
    avant.drapeaux = Array.isArray(cfg.blocking_flags) ? cfg.blocking_flags : null
    patch.config = { ...((patch.config as Record<string, unknown>) ?? cfg), blocking_flags: demandes }
  }

  const { error } = await admin
    .from('verification_providers')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', ligne.id)
  if (error) {
    console.error('[admin:seuils] update failed', error.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: admin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'note_jugement_updated',
    entity_type: 'verification_provider',
    entity_id: ligne.id,
    detail: { sujet: meta.sujet, avant, apres: { note, drapeaux: body.drapeaux ?? null } },
    request,
  })

  return json({ ok: true, sujet: meta.sujet, note }, 200)
}
