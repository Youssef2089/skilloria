import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { alerteCoherente } from '@/lib/ai-plafonds'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/plafonds-ia — LES TROIS RÉGLAGES D'ARGENT DE L'IA.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ POURQUOI CETTE ROUTE EXISTE                                              ║
 * ║                                                                          ║
 * ║   `/admin/matching` AFFICHAIT ces deux valeurs sans permettre de les     ║
 * ║   changer. C'est exactement ce que §D.7 condamne : un réglage qui ne se  ║
 * ║   règle pas. Et ce sont des réglages d'ARGENT — le pire endroit où       ║
 * ║   laisser quelqu'un devoir ouvrir l'éditeur SQL.                         ║
 * ║                                                                          ║
 * ║   Le rappel de §E.10 est net : une valeur posée à la main en base ne     ║
 * ║   survit pas à une reconstruction, et ne laisse AUCUNE trace             ║
 * ║   exploitable. Le seuil expert est passé de 9 à 8 sans que le dépôt en   ║
 * ║   garde mémoire.                                                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ═══ LES DEUX NE FONT PAS LA MÊME CHOSE, ET LA ROUTE LE PORTE ══════════════
 *
 *   `ai_spend_caps.monthly_cap_usd` — LE PLAFOND. Il **BLOQUE** : atteint, la
 *     fonctionnalité se dégrade et le dit (lib/ai-budget.ts, fail-closed
 *     assumé). Le baisser sous la dépense déjà engagée du mois **arrête le
 *     moteur immédiatement**.
 *
 *   `ai_spend_seuils_acteur.seuil_mensuel_usd` — LE SEUIL D'ALERTE. Il
 *     **N'ARRÊTE RIEN** : il pose un drapeau sur une ligne de tableau,
 *     recalculé à chaque affichage. Une mauvaise valeur y produit du **bruit**,
 *     jamais un incident.
 *
 *   `ai_spend_seuils_acteur.plafond_mensuel_usd` — LE PLAFOND PAR ACTEUR.
 *     Il **BLOQUE**, mais seulement ce que la plateforme dépense d'elle-même
 *     pour cet acteur : une organisation au plafond publie quand même, son
 *     annonce n'est plus classée ; un expert au plafond garde son compte
 *     utilisable (`lib/ai-plafonds.ts`).
 *
 *   Les traiter pareil serait la faute. D'où trois corps distincts, trois
 *   actions d'audit distinctes, et un écran qui écrit lequel arrête.
 *
 * ═══ L'ALERTE RESTE SOUS LE PLAFOND, ET C'EST VÉRIFIÉ SUR L'ÉTAT FINAL ═════
 *   La base tient la règle (`ai_spend_alerte_sous_plafond`) — elle rendrait un
 *   500 « db_error », qui n'apprend rien. La route rend donc un **400 nommé**.
 *
 *   ⚠️ ET ELLE LE VÉRIFIE SUR L'ÉTAT FINAL, PAS SUR LE CORPS REÇU. Un corps
 *      qui ne change QUE l'alerte est valide en lui-même et peut contredire le
 *      plafond DÉJÀ en base. On compose donc l'existant écrasé par le corps, et
 *      c'est lui qu'on juge — même forme que la cohérence de gratuité (§D.18).
 *
 * ═══ LA GARDE EST AU SERVEUR ═══════════════════════════════════════════════
 *   Bornes, refus des valeurs inconnues, et refus d'un provider ou d'un acteur
 *   hors catalogue. Griser un champ ne garde rien — un appel forgé passe.
 *
 * ═══ ET CHAQUE CHANGEMENT LAISSE UNE TRACE ═════════════════════════════════
 *   `audit_logs`, avec la valeur AVANT et la valeur APRÈS. Même discipline que
 *   `/admin/seuils` et `/admin/durees`.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Les fournisseurs et les acteurs connus. Une valeur hors liste est refusée. */
const PROVIDERS = ['claude', 'rerank'] as const
const ACTEURS = ['organization', 'profile'] as const

/**
 * Un montant en dollars, borné.
 *
 * Le plafond GLOBAL admet 0 : c'est la façon de couper toute dépense chez un
 * fournisseur sans toucher au code, et c'est un usage légitime. La borne haute
 * (100 000 $) n'est pas une politique commerciale — c'est un garde-fou contre
 * la faute de frappe, au même titre que les 365 jours des durées.
 */
function montantValide(v: unknown): v is number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 && n <= 100_000
}

type CorpsPatch = {
  /** `{ provider: montant }` — le plafond GLOBAL, dernier garde-fou. */
  plafonds?: unknown
  /** `{ acteur: montant }` — le seuil d'alerte, qui ne bloque JAMAIS. */
  seuils_acteur?: unknown
  /** `{ acteur: montant }` — le plafond PAR ACTEUR, qui bloque le classement. */
  plafonds_acteur?: unknown
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

  let corps: CorpsPatch
  try {
    corps = (await request.json()) as CorpsPatch
  } catch {
    return json({ error: 'Invalid body', code: 'invalid_body' }, 400)
  }

  const plafonds = (corps.plafonds ?? {}) as Record<string, unknown>
  const seuils = (corps.seuils_acteur ?? {}) as Record<string, unknown>
  const plafondsActeur = (corps.plafonds_acteur ?? {}) as Record<string, unknown>

  // ── VALIDATION COMPLÈTE AVANT LA MOINDRE ÉCRITURE ────────────────────────
  //  On refuse le corps ENTIER si une seule valeur est mauvaise. Écrire les
  //  bonnes et refuser les autres laisserait un état à moitié appliqué, que
  //  l'écran afficherait sans savoir lequel des champs a pris.
  for (const [cle, valeur] of Object.entries(plafonds)) {
    if (!(PROVIDERS as readonly string[]).includes(cle)) {
      return json({ error: 'Unknown provider', code: 'unknown_provider', provider: cle }, 400)
    }
    if (!montantValide(valeur)) {
      return json(
        { error: 'Invalid amount', code: 'invalid_amount', champ: cle, bornes: { min: 0, max: 100000 } },
        400,
      )
    }
  }
  for (const [cle, valeur] of Object.entries(seuils)) {
    if (!(ACTEURS as readonly string[]).includes(cle)) {
      return json({ error: 'Unknown actor', code: 'unknown_actor', acteur: cle }, 400)
    }
    if (!montantValide(valeur)) {
      return json(
        { error: 'Invalid amount', code: 'invalid_amount', champ: cle, bornes: { min: 0, max: 100000 } },
        400,
      )
    }
  }
  for (const [cle, valeur] of Object.entries(plafondsActeur)) {
    if (!(ACTEURS as readonly string[]).includes(cle)) {
      return json({ error: 'Unknown actor', code: 'unknown_actor', acteur: cle }, 400)
    }
    if (!montantValide(valeur)) {
      return json(
        { error: 'Invalid amount', code: 'invalid_amount', champ: cle, bornes: { min: 0, max: 100000 } },
        400,
      )
    }
  }
  if (
    Object.keys(plafonds).length === 0 &&
    Object.keys(seuils).length === 0 &&
    Object.keys(plafondsActeur).length === 0
  ) {
    return json({ error: 'Nothing to update', code: 'empty_patch' }, 400)
  }

  // ── L'ÉTAT AVANT, pour la trace ──────────────────────────────────────────
  const { data: capsAvant, error: capsErr } = await admin
    .from('ai_spend_caps')
    .select('provider, monthly_cap_usd')
  const { data: seuilsAvant, error: seuilsErr } = await admin
    .from('ai_spend_seuils_acteur')
    .select('acteur, seuil_mensuel_usd, plafond_mensuel_usd')
  if (capsErr || seuilsErr) {
    console.error('[admin:plafonds-ia] lecture de l’état avant en échec', capsErr?.message ?? seuilsErr?.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const avantCaps = Object.fromEntries(
    ((capsAvant ?? []) as Array<{ provider: string; monthly_cap_usd: number | string }>).map((r) => [
      r.provider,
      Number(r.monthly_cap_usd),
    ]),
  )
  const lignesSeuils = (seuilsAvant ?? []) as Array<{
    acteur: string
    seuil_mensuel_usd: number | string
    plafond_mensuel_usd: number | string
  }>
  const avantSeuils = Object.fromEntries(
    lignesSeuils.map((r) => [r.acteur, Number(r.seuil_mensuel_usd)]),
  )
  const avantPlafondsActeur = Object.fromEntries(
    lignesSeuils.map((r) => [r.acteur, Number(r.plafond_mensuel_usd)]),
  )

  // ── L'ALERTE RESTE SOUS LE PLAFOND — jugé sur l'ÉTAT FINAL ──────────────
  //  Le corps est PARTIEL : ne changer que l'alerte est un corps valide ET
  //  potentiellement contradictoire avec le plafond déjà en base. On compose
  //  donc l'existant écrasé par le corps, et c'est lui qu'on juge.
  for (const acteur of ACTEURS) {
    const alerteFinale = acteur in seuils ? Number(seuils[acteur]) : avantSeuils[acteur]
    const plafondFinal =
      acteur in plafondsActeur ? Number(plafondsActeur[acteur]) : avantPlafondsActeur[acteur]
    if (alerteFinale === undefined || plafondFinal === undefined) continue
    if (!alerteCoherente(alerteFinale, plafondFinal)) {
      return json(
        {
          error:
            'L’alerte doit rester SOUS le plafond : au-dessus, elle ne se déclencherait jamais — le plafond arrête la dépense avant',
          code: 'alerte_au_dessus_du_plafond',
          acteur,
          alerte: alerteFinale,
          plafond: plafondFinal,
        },
        400,
      )
    }
  }

  // ── LES ÉCRITURES ────────────────────────────────────────────────────────
  for (const [provider, valeur] of Object.entries(plafonds)) {
    const { error } = await admin
      .from('ai_spend_caps')
      .update({ monthly_cap_usd: Number(valeur), updated_at: new Date().toISOString() })
      .eq('provider', provider)
    if (error) {
      console.error('[admin:plafonds-ia] écriture du plafond en échec', { provider, message: error.message })
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }
  }
  for (const [acteur, valeur] of Object.entries(seuils)) {
    const { error } = await admin
      .from('ai_spend_seuils_acteur')
      .update({ seuil_mensuel_usd: Number(valeur), updated_at: new Date().toISOString() })
      .eq('acteur', acteur)
    if (error) {
      console.error('[admin:plafonds-ia] écriture du seuil en échec', { acteur, message: error.message })
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }
  }

  for (const [acteur, valeur] of Object.entries(plafondsActeur)) {
    const { error } = await admin
      .from('ai_spend_seuils_acteur')
      .update({ plafond_mensuel_usd: Number(valeur), updated_at: new Date().toISOString() })
      .eq('acteur', acteur)
    if (error) {
      console.error('[admin:plafonds-ia] écriture du plafond d acteur en échec', {
        acteur,
        message: error.message,
      })
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }
  }

  // ── LA TRACE ─────────────────────────────────────────────────────────────
  //  DEUX actions distinctes : un plafond qui bloque et un seuil qui alerte ne
  //  se relisent pas de la même façon dans un journal. Les confondre ferait
  //  chercher une coupure de service dans un changement de bruit.
  if (Object.keys(plafonds).length > 0) {
    await logAudit({
      supabaseAdmin: admin,
      user_id: auth.user.id,
      domain_id: auth.domain.id,
      action: 'ai_spend_cap_updated',
      entity_type: 'ai_spend_caps',
      entity_id: null,
      request,
      detail: {
        bloque: true,
        avant: Object.fromEntries(Object.keys(plafonds).map((k) => [k, avantCaps[k] ?? null])),
        apres: Object.fromEntries(Object.entries(plafonds).map(([k, v]) => [k, Number(v)])),
      },
    })
  }
  if (Object.keys(seuils).length > 0) {
    await logAudit({
      supabaseAdmin: admin,
      user_id: auth.user.id,
      domain_id: auth.domain.id,
      action: 'ai_spend_alert_threshold_updated',
      entity_type: 'ai_spend_seuils_acteur',
      entity_id: null,
      request,
      detail: {
        bloque: false,
        avant: Object.fromEntries(Object.keys(seuils).map((k) => [k, avantSeuils[k] ?? null])),
        apres: Object.fromEntries(Object.entries(seuils).map(([k, v]) => [k, Number(v)])),
      },
    })
  }

  if (Object.keys(plafondsActeur).length > 0) {
    await logAudit({
      supabaseAdmin: admin,
      user_id: auth.user.id,
      domain_id: auth.domain.id,
      // UNE TROISIÈME ACTION, et non la première : un plafond global qui coupe
      // tout et un plafond d'acteur qui coupe le classement d'un seul compte ne
      // se relisent pas de la même façon dans un journal.
      action: 'ai_spend_actor_cap_updated',
      entity_type: 'ai_spend_seuils_acteur',
      entity_id: null,
      request,
      detail: {
        bloque: true,
        portee: 'acteur',
        avant: Object.fromEntries(
          Object.keys(plafondsActeur).map((k) => [k, avantPlafondsActeur[k] ?? null]),
        ),
        apres: Object.fromEntries(Object.entries(plafondsActeur).map(([k, v]) => [k, Number(v)])),
      },
    })
  }

  return json({
    plafonds_acteur: Object.fromEntries(
      Object.entries(plafondsActeur).map(([k, v]) => [k, Number(v)]),
    ),
    plafonds: Object.fromEntries(Object.entries(plafonds).map(([k, v]) => [k, Number(v)])),
    seuils_acteur: Object.fromEntries(Object.entries(seuils).map(([k, v]) => [k, Number(v)])),
  })
}
