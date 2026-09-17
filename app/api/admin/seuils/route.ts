import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET / PATCH /api/admin/seuils — LES SEUILS DE JUGEMENT.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ POURQUOI CET ÉCRAN EXISTE                                                ║
 * ║                                                                          ║
 * ║ Ces seuils décident qui est approuvé sans intervention humaine. Ils      ║
 * ║ vivaient EN BASE SANS ÉCRAN — le pire des deux mondes : ni pratique      ║
 * ║ (il fallait un accès direct à la base), ni tracé.                        ║
 * ║                                                                          ║
 * ║ Et ce n'est pas une crainte de principe. Le seuil d'auto-approbation     ║
 * ║ des experts est passé de 9 à 8 le 16 juin 2026. Le commit du jour ne     ║
 * ║ touche que deux fichiers TypeScript ; la valeur n'existait NULLE PART    ║
 * ║ dans le dépôt. Il a fallu croiser un message de commit et la colonne     ║
 * ║ `updated_at` de la ligne pour reconstituer ce qui s'était passé.         ║
 * ║                                                                          ║
 * ║ D'où la troisième exigence de cette route, à côté de « lire » et         ║
 * ║ « écrire » : TRACER. Chaque modification écrit dans `audit_logs` qui a   ║
 * ║ changé quoi, quand, et depuis quelle adresse.                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ═══ CE QUI DÉCIDE N'EST PAS OÙ L'ON CROIT ══════════════════════════════════
 *   `verification_providers` porte une colonne `confidence_threshold`. Pour
 *   DEUX des trois chemins, c'est bien elle qui décide.
 *
 *   Pour le TROISIÈME — la vérification d'expert — elle est `select`ée puis
 *   **JAMAIS UTILISÉE** : la décision se prend sur `config->>'auto_approve_threshold'`,
 *   dans le jsonb (cf. lib/verification/expert-verification.ts).
 *
 *   Cette route règle donc CE QUI DÉCIDE, et rend explicitement la colonne
 *   inerte comme telle. Afficher deux champs dont un ne sert à rien serait
 *   exactement le défaut qu'on passe notre temps à corriger : un réglage règle
 *   quelque chose, ou il le dit.
 *
 * ═══ AUCUNE CONTRAINTE ENTRE DEUX VALEURS — VÉRIFIÉ ═════════════════════════
 *   Contrairement à `/admin/matching` (où `notify_threshold >= feed_threshold`
 *   est imposé en base ET ici), il n'existe AUCUNE contrainte reliant deux
 *   seuils de vérification : ni en base (seul `0 <= confidence_threshold <= 10`
 *   existe), ni dans le code. Sur la ligne expert, les deux valent 7 et 8 sans
 *   que rien ne l'exige — et c'est cohérent, puisque la colonne n'y est pas lue.
 *
 *   On n'en INVENTE donc pas une. Relier deux valeurs dont l'une est inerte
 *   produirait un refus incompréhensible, et ce serait une décision produit
 *   déguisée en garde technique.
 *
 * ═══ LE PAYS SANS LIGNE ═════════════════════════════════════════════════════
 *   Un pays sans fournisseur de décision actif ne tombe plus sur un seuil
 *   deviné : la vérification refuse explicitement et part en revue manuelle,
 *   sans aucun appel au modèle. Le GET rend donc la liste de ces pays, pour que
 *   l'écran le DISE plutôt que de laisser le découvrir.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Les quatre drapeaux que le code sait interpréter (ai-expert-verification.ts). */
const DRAPEAUX_CONNUS = [
  'DOMAIN_MISMATCH',
  'CV_PROFILE_INCOHERENT',
  'LINKEDIN_UNVERIFIABLE',
  'SUSPICIOUS_CONTENT',
] as const

/**
 * Ce que chaque type de fournisseur GOUVERNE, et par quelle valeur.
 *
 * `cle_decisive` nomme la valeur qui TRANCHE. `colonne_inerte` dit si la
 * colonne `confidence_threshold` est lue par ce chemin. L'écran affiche ces
 * deux informations : un nombre nu invite à le bouger sans savoir ce qu'il
 * déclenche.
 */
const TYPES = {
  profile_verification: {
    cle_decisive: 'auto_approve_threshold',
    colonne_inerte: true,
    drapeaux: true,
  },
  ai_web_search: {
    cle_decisive: 'confidence_threshold',
    colonne_inerte: false,
    drapeaux: false,
  },
  opportunity_quality_check: {
    cle_decisive: 'confidence_threshold',
    colonne_inerte: false,
    drapeaux: false,
  },
  /**
   * Sirene (INSEE) — FOURNISSEUR DE DONNÉES, PAS DÉCIDEUR.
   *
   * ═══ SON `confidence_threshold` NE GOUVERNE RIEN, et c'est vérifiable ═════
   *   La ligne `official_api` porte un seuil de 9 en base. AUCUN chemin ne le
   *   lit : `runVerification` prend le seuil du fournisseur de DÉCISION
   *   (`ai_web_search`, seuil 7), Sirene n'apporte que des données que l'IA
   *   compare ensuite. Un admin qui passerait ce 9 à 3 ne changerait
   *   strictement rien, et il n'avait aucun moyen de le savoir.
   *
   * ═══ POURQUOI ÊTRE DÉCLARÉ PLUTÔT QU'ABSENT ══════════════════════════════
   *   Un type absent de cette table retombait sur `colonne_inerte: false` —
   *   le défaut disait donc « cette colonne est lue », soit exactement
   *   l'inverse de la vérité. Ne pas connaître un type produisait la plus
   *   rassurante des deux réponses.
   *
   *   §D.7 : un réglage règle quelque chose, OU IL LE DIT. Ici il ne règle
   *   rien, et maintenant il le dit. `cle_decisive: null` parce qu'il n'y en a
   *   pas : ce fournisseur ne tranche pas, il renseigne.
   */
  official_api: {
    cle_decisive: null,
    colonne_inerte: true,
    drapeaux: false,
  },
} as const

type TypeGere = keyof typeof TYPES

function estTypeGere(v: unknown): v is TypeGere {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(TYPES, v)
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

  const [fournisseursRes, paysRes] = await Promise.all([
    admin
      .from('verification_providers')
      .select('id, country_code, provider_type, provider_name, is_active, priority, confidence_threshold, config, updated_at')
      .order('country_code', { ascending: true })
      .order('priority', { ascending: true }),
    admin.from('countries').select('code, name_fr').eq('active', true).order('sort_order'),
  ])

  if (fournisseursRes.error) {
    console.error('[admin:seuils] lecture en échec', fournisseursRes.error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  type Ligne = {
    id: string
    country_code: string
    provider_type: string
    provider_name: string
    is_active: boolean
    priority: number
    confidence_threshold: number
    config: Record<string, unknown> | null
    updated_at: string
  }
  const lignes = (fournisseursRes.data ?? []) as unknown as Ligne[]

  const fournisseurs = lignes.map((l) => {
    const cfg = (l.config ?? {}) as Record<string, unknown>
    const meta = estTypeGere(l.provider_type) ? TYPES[l.provider_type] : null
    const aa = cfg.auto_approve_threshold
    return {
      id: l.id,
      country_code: l.country_code,
      provider_type: l.provider_type,
      provider_name: l.provider_name,
      is_active: l.is_active,
      priority: l.priority,
      confidence_threshold: l.confidence_threshold,
      auto_approve_threshold: typeof aa === 'number' ? aa : null,
      blocking_flags: Array.isArray(cfg.blocking_flags)
        ? (cfg.blocking_flags as unknown[]).filter((f): f is string => typeof f === 'string')
        : null,
      updated_at: l.updated_at,
      /** Réglable par cet écran ? Un type inconnu n'est pas géré, et le dit. */
      gere: meta !== null,
      /** La valeur qui TRANCHE pour ce chemin. */
      cle_decisive: meta?.cle_decisive ?? null,
      /** `confidence_threshold` est-elle lue par ce chemin ? */
      colonne_inerte: meta?.colonne_inerte ?? false,
      porte_drapeaux: meta?.drapeaux ?? false,
    }
  })

  // ── LES PAYS SANS FOURNISSEUR DE DÉCISION ────────────────────────────────
  //  Sans ligne `ai_web_search` active, toute vérification d'entreprise de ce
  //  pays part en revue manuelle, sans appel au modèle. Ce n'est pas une panne,
  //  c'est le comportement voulu — mais il doit se VOIR.
  const avecDecideur = new Set(
    lignes.filter((l) => l.provider_type === 'ai_web_search' && l.is_active).map((l) => l.country_code),
  )
  const pays = (paysRes.data ?? []) as unknown as { code: string; name_fr: string }[]
  const paysSansDecideur = pays.filter((p) => !avecDecideur.has(p.code)).map((p) => ({ code: p.code, nom: p.name_fr }))

  return json(
    {
      fournisseurs,
      pays_sans_decideur: paysSansDecideur,
      drapeaux_connus: DRAPEAUX_CONNUS,
    },
    200,
  )
}

type CorpsPatch = {
  provider_id?: unknown
  confidence_threshold?: unknown
  auto_approve_threshold?: unknown
  blocking_flags?: unknown
  is_active?: unknown
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/**
 * Un ENTIER dans [0,10]. Les seuils de vérification sont sur une échelle
 * entière : accepter 7,5 laisserait croire à une finesse que le modèle ne rend
 * pas (il produit un entier).
 */
function seuilValide(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 10) return null
  return n
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

  let body: CorpsPatch
  try {
    body = (await request.json()) as CorpsPatch
  } catch {
    return json({ error: 'Invalid JSON', code: 'invalid_json' }, 400)
  }

  const providerId =
    typeof body.provider_id === 'string' && UUID.test(body.provider_id) ? body.provider_id : null
  if (!providerId) return json({ error: 'Invalid provider', code: 'bad_provider' }, 400)

  // ── L'ÉTAT AVANT, LU AVANT D'ÉCRIRE ──────────────────────────────────────
  //  Il sert à deux choses : refuser un réglage qui ne règle rien sur ce
  //  type-là, et écrire dans `audit_logs` ce qui a VRAIMENT changé — « seuil
  //  modifié » sans l'ancienne valeur ne répond pas à « pourquoi vaut-il ça ».
  const { data: avant, error: lectureErr } = await admin
    .from('verification_providers')
    .select('id, country_code, provider_type, provider_name, is_active, confidence_threshold, config')
    .eq('id', providerId)
    .maybeSingle()
  if (lectureErr) {
    console.error('[admin:seuils] lecture en échec', lectureErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!avant) return json({ error: 'Unknown provider', code: 'bad_provider' }, 404)

  const ligne = avant as unknown as {
    id: string
    country_code: string
    provider_type: string
    provider_name: string
    is_active: boolean
    confidence_threshold: number
    config: Record<string, unknown> | null
  }
  if (!estTypeGere(ligne.provider_type)) {
    return json(
      { error: 'Provider type not editable here', code: 'type_non_gere', provider_type: ligne.provider_type },
      400,
    )
  }
  const meta = TYPES[ligne.provider_type]

  const patch: Record<string, unknown> = {}
  const cfgAvant = (ligne.config ?? {}) as Record<string, unknown>
  const cfgApres: Record<string, unknown> = { ...cfgAvant }
  let cfgTouchee = false

  // ── confidence_threshold ─────────────────────────────────────────────────
  if ('confidence_threshold' in body) {
    // UN RÉGLAGE RÈGLE QUELQUE CHOSE, OU IL LE DIT. Sur le chemin expert cette
    // colonne n'est pas lue : l'accepter en écriture laisserait croire qu'on
    // vient de changer une décision. On refuse, en nommant la bonne clé.
    if (meta.colonne_inerte) {
      return json(
        {
          error: 'confidence_threshold is not read by this path',
          code: 'colonne_inerte',
          cle_decisive: meta.cle_decisive,
        },
        400,
      )
    }
    const v = seuilValide(body.confidence_threshold)
    if (v == null) {
      return json({ error: 'confidence_threshold hors [0,10] ou non entier', code: 'seuil_invalide' }, 400)
    }
    patch.confidence_threshold = v
  }

  // ── auto_approve_threshold (dans le jsonb) ───────────────────────────────
  if ('auto_approve_threshold' in body) {
    if (meta.cle_decisive !== 'auto_approve_threshold') {
      return json(
        {
          error: 'auto_approve_threshold is not read by this path',
          code: 'cle_non_lue',
          cle_decisive: meta.cle_decisive,
        },
        400,
      )
    }
    const v = seuilValide(body.auto_approve_threshold)
    if (v == null) {
      return json({ error: 'auto_approve_threshold hors [0,10] ou non entier', code: 'seuil_invalide' }, 400)
    }
    cfgApres.auto_approve_threshold = v
    cfgTouchee = true
  }

  // ── blocking_flags (dans le jsonb) ───────────────────────────────────────
  if ('blocking_flags' in body) {
    if (!meta.drapeaux) {
      return json({ error: 'This path has no blocking flags', code: 'drapeaux_non_lus' }, 400)
    }
    if (!Array.isArray(body.blocking_flags)) {
      return json({ error: 'blocking_flags must be an array', code: 'drapeaux_invalides' }, 400)
    }
    const inconnus = (body.blocking_flags as unknown[]).filter(
      (f) => typeof f !== 'string' || !(DRAPEAUX_CONNUS as readonly string[]).includes(f),
    )
    if (inconnus.length > 0) {
      return json(
        { error: 'Unknown blocking flag', code: 'drapeaux_invalides', inconnus, connus: DRAPEAUX_CONNUS },
        400,
      )
    }
    // ⚠️ LISTE VIDE REFUSÉE. `parseBlockingFlags` retombe sur le défaut quand la
    //    liste est vide — un admin qui « décoche tout » croirait avoir désarmé
    //    les drapeaux alors qu'ils reviendraient tous. Un écran qui ment sur ce
    //    qu'il vient de faire est pire qu'un écran qui refuse.
    const flags = Array.from(new Set(body.blocking_flags as string[]))
    if (flags.length === 0) {
      return json({ error: 'At least one blocking flag required', code: 'drapeaux_vides' }, 400)
    }
    cfgApres.blocking_flags = flags
    cfgTouchee = true
  }

  if ('is_active' in body) {
    patch.is_active = body.is_active === true
  }

  if (cfgTouchee) patch.config = cfgApres

  if (Object.keys(patch).length === 0) {
    return json({ error: 'No editable field', code: 'invalid_json' }, 400)
  }

  const { error: majErr } = await admin
    .from('verification_providers')
    .update(patch)
    .eq('id', providerId)
  if (majErr) {
    console.error('[admin:seuils] écriture en échec', majErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  // ── LA TRACE — c'est le vrai défaut d'aujourd'hui ────────────────────────
  //  `updated_at` dit QUAND. Il ne dit ni QUI, ni DEPUIS QUELLE VALEUR, ni
  //  DEPUIS OÙ. C'est précisément ce qui a manqué pour comprendre le passage de
  //  9 à 8. On écrit donc l'avant ET l'après.
  await logAudit({
    supabaseAdmin: admin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'verification_threshold_updated',
    entity_type: 'verification_provider',
    entity_id: providerId,
    request,
    detail: {
      provider_name: ligne.provider_name,
      provider_type: ligne.provider_type,
      country_code: ligne.country_code,
      avant: {
        confidence_threshold: ligne.confidence_threshold,
        auto_approve_threshold: cfgAvant.auto_approve_threshold ?? null,
        blocking_flags: cfgAvant.blocking_flags ?? null,
        is_active: ligne.is_active,
      },
      apres: {
        confidence_threshold: patch.confidence_threshold ?? ligne.confidence_threshold,
        auto_approve_threshold: cfgApres.auto_approve_threshold ?? null,
        blocking_flags: cfgApres.blocking_flags ?? null,
        is_active: patch.is_active ?? ligne.is_active,
      },
    },
  })

  return json({ ok: true, provider_id: providerId }, 200)
}
