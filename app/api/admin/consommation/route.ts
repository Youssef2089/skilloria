import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/consommation — CE QUE CHAQUE COMPTE A COÛTÉ CE MOIS-CI.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ POURQUOI CET ÉCRAN EXISTE                                                ║
 * ║                                                                          ║
 * ║   Depuis ce lot, un acteur peut être ARRÊTÉ par son propre plafond. Un   ║
 * ║   plafond qui bloque sans qu'aucun écran ne dise QUI il bloque, et à     ║
 * ║   combien, est un plafond qu'on ne peut ni régler ni défendre — on le    ║
 * ║   relèverait au jugé, ou on le retirerait.                               ║
 * ║                                                                          ║
 * ║   La supervision dit COMBIEN de comptes sont au plafond. Elle ne dit pas ║
 * ║   LESQUELS. C'est ici, et c'est le seul endroit.                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ═══ LA SOMME BOUCLE, ET C'EST LA PROPRIÉTÉ QU'ON DÉFEND ═══════════════════
 *   Σ(lignes rendues) = dépense du mois, à l'exact. Trois familles disjointes
 *   et exhaustives, rendues par `ai_spend_par_acteur` : un acteur nommé, le
 *   reste agrégé ET COMPTÉ, et le non-imputable. Un écran de dépense qui ne
 *   boucle pas cesse d'être cru, donc d'être lu.
 *
 * ═══ ET LE DÉTAIL PAR ACTION, PARCE QUE LE TOTAL NE DÉCIDE DE RIEN ═════════
 *   Un compte à 24 $ sur un plafond de 25 $ est une décision à prendre, et on
 *   ne peut pas la prendre sans savoir si ces 24 $ sont cent classements
 *   légitimes ou une boucle d'analyses de CV. La ventilation vient de
 *   `ai_spend_par_acteur_et_action`, qui retient **les mêmes comptes** que la
 *   liste — même classement, même fenêtre mensuelle. Deux classements
 *   différents afficheraient un compte sans détail, ou un détail sans compte.
 *
 * ═══ CE QUI N'EST PAS RENDU, ET POURQUOI ═══════════════════════════════════
 *   Aucune donnée personnelle d'expert au-delà de ce que la fonction de base
 *   rend déjà. §D.4 interdit de projeter e-mail et téléphone ; un écran de
 *   dépense n'en a aucun besoin.
 *
 * ⚠️ UNE LECTURE EN PANNE REND `null`, JAMAIS UN TABLEAU VIDE. « Aucune
 *    dépense ce mois-ci » et « je n'ai pas pu regarder » ne sont pas le même
 *    fait, et le second se lirait comme une bonne nouvelle (§E.22).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Combien d'acteurs sont DÉTAILLÉS avant regroupement.
 *
 * Assez pour qu'un écran serve à quelque chose, pas au point de devenir une
 * liste qu'on ne lit plus (§E.26). Le reste n'est pas caché : il est agrégé
 * ET compté, et l'écran le dit.
 */
const ACTEURS_DETAILLES = 50

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const admin = auth.supabaseAdmin

  const [acteursRes, detailRes, reglagesRes, globalRes] = await Promise.all([
    admin.rpc('ai_spend_par_acteur', { p_limite: ACTEURS_DETAILLES }),
    // LA MÊME BORNE que la liste : c'est ce qui garantit que les deux parlent
    // des mêmes comptes. La passer différemment ici serait le plus discret des
    // désaccords — un détail manquant sur les derniers comptes de la liste.
    admin.rpc('ai_spend_par_acteur_et_action', { p_limite: ACTEURS_DETAILLES }),
    admin.from('ai_spend_seuils_acteur').select('acteur, seuil_mensuel_usd, plafond_mensuel_usd'),
    admin.rpc('ai_spend_status'),
  ])

  if (acteursRes.error) {
    console.error('[admin:consommation] lecture par acteur en échec', acteursRes.error.message)
  }
  if (detailRes.error) {
    console.error('[admin:consommation] lecture du détail par action en échec', detailRes.error.message)
  }
  if (reglagesRes.error) {
    console.error('[admin:consommation] lecture des réglages en échec', reglagesRes.error.message)
  }
  if (globalRes.error) {
    console.error('[admin:consommation] lecture du plafond global en échec', globalRes.error.message)
  }

  return json(
    {
      /**
       * Les acteurs, avec leur plafond et leur alerte — les deux états viennent
       * de la BASE, qui les calcule sur la même fenêtre que tout le reste. Les
       * recalculer ici ferait une seconde règle, et c'est ainsi que deux
       * écrans finissent par ne plus dire la même chose (§E.20).
       */
      acteurs: acteursRes.error ? null : (acteursRes.data ?? []),
      /**
       * La ventilation par action, pour les MÊMES comptes.
       * `null` = lecture en panne : l'écran dit qu'il ne sait pas, il
       * n'affiche pas un détail vide qui se lirait « ce compte n'a rien fait ».
       */
      detail: detailRes.error ? null : (detailRes.data ?? []),
      reglages: reglagesRes.error ? null : (reglagesRes.data ?? []),
      /** Le dernier garde-fou, rappelé ici : il arrête TOUT, lui. */
      global: globalRes.error ? null : (globalRes.data ?? []),
      bornes: { acteurs_detailles: ACTEURS_DETAILLES },
    },
    200,
  )
}
