import { contexteDeTache } from '@/lib/journal/contexte'
import { NextRequest } from 'next/server'
import { sousVerdictDeRun } from '@/lib/cron/verdict-de-run'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { prendreBailRun, rendreBailRun } from '@/lib/cron/bail-de-run'
import { chargerDurees, DUREES_ILLISIBLES_CODE } from '@/lib/durees'
// LA SOURCE UNIQUE de l'état de vie d'une candidature : c'est ELLE qui dit
// « échange refermé » (§D.5). Aucun jumeau SQL de cette règle n'existe.
import { deriveCandidatureLifecycle } from '@/lib/candidatures/lifecycle'
import { effectiveConversationExpiry } from '@/lib/conversations/expiry'

/** Nom du bail. MÊME valeur pour GET et POST : c'est la TÂCHE qu'on garde. */
const JOB = 'constats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET/POST /api/cron/constats — CONSTATE ce qui est arrivé sans geste, et
 * l'écrit au grand livre (§D.26).
 *
 * ═══ POURQUOI UNE TÂCHE ════════════════════════════════════════════════════
 *   Une annonce expire parce que sa durée de vie est écoulée ; un échange se
 *   referme parce que sa fenêtre est passée. Personne n'agit, aucune route ne
 *   s'exécute, aucune colonne ne bascule : ce sont des règles appliquées À LA
 *   LECTURE (lib/publications/expiry.ts, lib/conversations/expiry.ts). Le
 *   grand livre, lui, ne s'écrit que par un geste — ou par un CONSTAT : cette
 *   tâche passe, trouve ce qui n'est plus actif et n'a pas encore été
 *   constaté, et l'écrit UNE fois, tenue par une colonne-marqueur posée dans la
 *   même transaction que la ligne.
 *
 * ═══ CE QU'ELLE N'EST PAS ══════════════════════════════════════════════════
 *   Pas une bascule de statut, pas une purge, pas un rejeu de l'histoire : la
 *   date du constat n'est pas la date de l'expiration, et la ligne porte les
 *   deux. Un long passé s'égrène par passages BORNÉS.
 *
 * ═══ UNE PIÈCE PAR PASSAGE ═════════════════════════════════════════════════
 *   Le passage est le geste : toutes ses lignes portent sa pièce. Elle naît ici
 *   (`contexteDeTache`) — le pilote SQL la transmettra dans le corps HTTP à
 *   l'étape 3 — et voyage en PARAMÈTRE jusqu'à la fonction SQL.
 */

/**
 * Bornes d'un passage — TECHNIQUE (une requête que rien ne borne finit par
 * dépasser le budget d'exécution), pas une règle métier : rien n'est perdu,
 * le passage suivant reprend où celui-ci s'est arrêté.
 */
const LIMITE_PAR_PASSAGE = 200

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function getAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Missing Supabase env (URL or SERVICE_ROLE_KEY)')
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function handle(request: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[constats] CRON_SECRET absent')
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }
  const authHeader = request.headers.get('authorization') ?? ''
  const querySecret = request.nextUrl.searchParams.get('secret') ?? ''
  if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
    return json({ error: 'Unauthorized', code: 'unauthorized' }, 401)
  }

  const admin = getAdmin()

  // ── BAIL DE RUN — un constat ne se double pas ────────────────────────────
  //  `for update skip locked` côté SQL ferme déjà la fenêtre des appels
  //  simultanés ; le bail évite le TRAVAIL en double (double-clic sur
  //  « exécuter maintenant »). FAIL-CLOSED : bail indisponible ⇒ on ne tourne pas.
  const bail = await prendreBailRun(admin, { job: JOB, maxDurationSec: maxDuration })
  if (bail === 'occupe') {
    return json({ ok: true, constats: null, note: 'Un passage est déjà en cours.' }, 200)
  }
  if (bail === 'erreur') {
    return json({ error: 'Run lease unavailable', code: 'bail_indisponible' }, 503)
  }

  try {
    // LA PIÈCE DU PASSAGE (§D.26) — toutes les lignes de ce passage la portent.
    const journal = contexteDeTache(JOB)

    // LA DURÉE DE VIE EN VIGUEUR, lue par la route, jamais devinée : la règle
    // d'expiration est celle du schéma (annonce_active), et sa durée vient de
    // duree_reglages. Illisible ⇒ on refuse, en le nommant (lib/durees.ts).
    const lectureDurees = await chargerDurees(admin)
    if (!lectureDurees.ok) {
      console.error('[constats] durées de la place illisibles', lectureDurees.raison)
      return json({ error: 'Durations unavailable', code: DUREES_ILLISIBLES_CODE }, 503)
    }
    const durees = lectureDurees.durees

    // ── LES ANNONCES EXPIRÉES — marqueur et ligne, dans la même transaction ─
    const { data: expirees, error: expErr } = await admin.rpc('constater_annonces_expirees', {
      p_piece: journal.piece,
      p_vie_annonce_jours: durees.vieAnnonceJours,
      p_limite: LIMITE_PAR_PASSAGE,
    })
    if (expErr) {
      console.error('[constats] annonces expirées : constat en échec', expErr.message)
      return json({ error: 'Query failed', code: 'db_error', etape: 'annonces_expirees' }, 500)
    }
    const annoncesExpirees = typeof expirees === 'number' ? expirees : Number(expirees ?? 0)

    // ── LES DÉVOILEMENTS REFERMÉS — la règle est LUE en TypeScript, le marqueur
    //    et la ligne sont posés par la base. Les candidatures encore dévoilées
    //    et jamais constatées, avec leur fil ; `deriveCandidatureLifecycle`
    //    décide, et seule l'issue « échange refermé » se constate — `selected`
    //    reste active sans limite (§D.5), et la source le sait.
    const { data: devoilees, error: devErr } = await admin
      .from('candidatures')
      .select('id, status, unlocked_at, conversations(expires_at)')
      .eq('status', 'unlocked')
      .is('fermeture_constatee_at', null)
      .order('unlocked_at', { ascending: true })
      .limit(LIMITE_PAR_PASSAGE)
    if (devErr) {
      console.error('[constats] dévoilements : lecture en échec', devErr.message)
      return json({ error: 'Query failed', code: 'db_error', etape: 'devoilements_fermes', annonces_expirees: annoncesExpirees }, 500)
    }
    type Devoilee = {
      id: string
      status: string
      unlocked_at: string | null
      conversations: { expires_at: string | null } | { expires_at: string | null }[] | null
    }
    let devoilementsFermes = 0
    let devoilementsPassif = 0
    for (const c of (devoilees ?? []) as unknown as Devoilee[]) {
      const fil = Array.isArray(c.conversations) ? (c.conversations[0] ?? null) : c.conversations
      const vie = deriveCandidatureLifecycle(
        { status: c.status, unlocked_at: c.unlocked_at, conversation: fil ? { expires_at: fil.expires_at } : null },
        { vieAnnonceJours: durees.vieAnnonceJours, fenetreEchangeJours: durees.fenetreEchangeJours },
      )
      if (vie.reason !== 'exchange_expired') continue
      const fin = effectiveConversationExpiry(
        { conversationExpiresAt: fil?.expires_at ?? null, unlockedAt: c.unlocked_at },
        { fenetreEchangeJours: durees.fenetreEchangeJours },
      )
      if (!fin) continue
      const { data: constate, error: cErr } = await admin.rpc('constater_devoilement_ferme', {
        p_piece: journal.piece,
        p_candidature_id: c.id,
        p_fin_echange: fin.toISOString(),
      })
      if (cErr) {
        console.error('[constats] dévoilement : constat en échec', { candidatureId: c.id, message: cErr.message })
        return json({ error: 'Query failed', code: 'db_error', etape: 'devoilements_fermes', annonces_expirees: annoncesExpirees, devoilements_fermes: devoilementsFermes }, 500)
      }
      // Trois issues fermées. `passif` : l'échange s'est refermé AVANT la mise en
      // service du constat — marqueur posé, AUCUNE ligne (pas de reprise de
      // l'historique, décision du 26/09/2026). Une issue inconnue n'est pas un succès.
      if (constate === 'constate') devoilementsFermes++
      else if (constate === 'passif') devoilementsPassif++
      else if (constate !== 'deja') {
        console.error('[constats] dévoilement : issue inconnue', { candidatureId: c.id, issue: constate })
        return json({ error: 'Unknown outcome', code: 'db_error', etape: 'devoilements_fermes', annonces_expirees: annoncesExpirees, devoilements_fermes: devoilementsFermes }, 500)
      }
    }

    // Le verdict est rendu TEL QUEL : le compte de ce passage, et sa borne —
    // un passage plein dit qu'il en reste.
    return json(
      {
        ok: true,
        piece: journal.piece,
        annonces_expirees: annoncesExpirees,
        devoilements_fermes: devoilementsFermes,
        /** Fermetures ANTÉRIEURES à la mise en service : marquées, sans ligne au grand livre. */
        devoilements_passif: devoilementsPassif,
        limite: LIMITE_PAR_PASSAGE,
      },
      200,
    )
  } finally {
    // ON REND LE BAIL SUR TOUS LES CHEMINS ; la garantie ne dépend pas de cet
    // appel — le bail expire seul.
    await rendreBailRun(admin, JOB)
  }
}

/**
 * ⚠️ LE PASSAGE SE CLÔT ICI, ET SUR TOUS LES CHEMINS DE SORTIE — le guichet est
 *    PARTAGÉ par toutes les tâches (lib/cron/verdict-de-run.ts) : la tâche
 *    écrit son verdict elle-même, au lieu de le poser chez pg_net où il expire.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return sousVerdictDeRun(request, JOB, getAdmin, () => handle(request))
}

export async function POST(request: NextRequest): Promise<Response> {
  return sousVerdictDeRun(request, JOB, getAdmin, () => handle(request))
}
