// lib/bail.ts
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ AU PLUS UN TRAVAIL À LA FOIS, PAR PORTÉE ET PAR CLÉ.                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ CE QUE CE MODULE REMPLACE, ET POURQUOI IL A GRANDI ────────────────────┐
// │ Le bail existait, et il était juste : il ferme un chevauchement          │
// │ STRUCTUREL qui faisait repayer le même travail d'IA. Mais il était clé   │
// │ sur un NOM DE TÂCHE, et le point 4 demande de verrouiller un EXPERT.     │
// │                                                                          │
// │ Une seconde table et une seconde fonction d'upsert auraient été un       │
// │ JUMEAU (§E.20) — et un jumeau de VERROU est le pire de tous : il ne sert │
// │ que sous concurrence, c'est-à-dire précisément quand personne ne         │
// │ regarde. Le jour où l'un des deux corrige sa fenêtre de grâce, l'autre   │
// │ reste ouvert, et rien ne le dit.                                         │
// └──────────────────────────────────────────────────────────────────────────┘
//
// ⚠️ LA GARANTIE EST **UNE SEULE INSTRUCTION SQL**, et elle est en base.
//    Aucune fenêtre entre une lecture et une écriture, donc rien à gagner à
//    arriver en premier : deux appels simultanés ne peuvent pas obtenir le
//    bail tous les deux (§F). Une vérification côté code aurait exactement le
//    défaut qu'elle prétend corriger.
//
// ⚠️ ET SI LE BAIL NE PEUT PAS ÊTRE PRIS — panne de lecture, RPC absente — ON
//    NE TRAVAILLE PAS. Un travail lancé sans bail rouvre exactement le
//    chevauchement qu'on ferme, et une panne d'observation ne doit jamais
//    valoir autorisation.

import type { SupabaseClient } from '@supabase/supabase-js'

/** Ce qu'on verrouille. Une portée par nature de travail, jamais par appelant. */
export type PorteeBail =
  /** Une tâche planifiée. La clé est son `job_name`. */
  | 'cron'
  /** Une recherche de missions. La clé est le `profile_id` de l'expert. */
  | 'matching_expert'

/** Résultat de la prise de bail. `occupe` n'est PAS une erreur. */
export type PriseDeBail = 'pris' | 'occupe' | 'erreur'

/**
 * Le délai de grâce, DÉDUIT de la durée maximale du travail.
 *
 * Le double, avec un plancher d'une minute : une clé redevient disponible dès
 * que le travail précédent ne peut plus être vivant. Plus court laisserait le
 * chevauchement, plus long retarderait le rattrapage sans rien gagner.
 */
export function graceSecondes(maxDurationSec: number): number {
  return Math.max(60, Math.ceil(maxDurationSec) * 2)
}

/** Prend le bail. À appeler AVANT le moindre travail, et avant toute dépense. */
export async function prendreBail(
  admin: SupabaseClient,
  params: { portee: PorteeBail; cle: string; maxDurationSec: number },
): Promise<PriseDeBail> {
  const { data, error } = await admin.rpc('prendre_bail', {
    p_portee: params.portee,
    p_cle: params.cle,
    p_grace: `${graceSecondes(params.maxDurationSec)} seconds`,
  })
  if (error) {
    console.error(
      `[bail:${params.portee}] prise impossible — on ne travaille pas`,
      { cle: params.cle, message: error.message },
    )
    return 'erreur'
  }
  return data === true ? 'pris' : 'occupe'
}

/**
 * Rend le bail plus tôt que son délai de grâce.
 *
 * PUREMENT FACULTATIF, et c'est le point : le bail expire tout seul. Un échec
 * ici retarde le prochain travail, il ne bloque RIEN — un processus tué ne peut
 * pas coincer sa clé. C'est l'inverse exact d'un drapeau qu'il faudrait
 * baisser.
 *
 * N'échoue jamais vers l'appelant : sa réponse ne doit pas dépendre de ceci.
 */
export async function rendreBail(
  admin: SupabaseClient,
  portee: PorteeBail,
  cle: string,
): Promise<void> {
  const { error } = await admin.rpc('rendre_bail', { p_portee: portee, p_cle: cle })
  if (error) {
    console.warn(`[bail:${portee}] restitution en echec — il expirera seul`, {
      cle,
      message: error.message,
    })
  }
}

/**
 * LE BAIL EST-IL TENU ? — SANS LE PRENDRE.
 *
 * ⚠️ **CONSULTATIF, ET C'EST ÉCRIT ICI POUR QUE PERSONNE NE S'EN SERVE COMME
 *    D'UNE GARDE.** Entre cette lecture et l'action qui suit, un autre
 *    détenteur peut prendre le bail. Elle ne remplace PAS `prendreBail` : elle
 *    permet d'ATTENDRE avant de dépenser, et rien d'autre.
 *
 * Une lecture en panne rend `true` — « je ne sais pas » ne vaut jamais « la
 * voie est libre » quand la suite est une dépense (§E.22).
 */
export async function bailTenu(
  admin: SupabaseClient,
  params: { portee: PorteeBail; cle: string; maxDurationSec: number },
): Promise<boolean> {
  const { data, error } = await admin.rpc('bail_tenu', {
    p_portee: params.portee,
    p_cle: params.cle,
    p_grace: `${graceSecondes(params.maxDurationSec)} seconds`,
  })
  if (error) {
    console.error(`[bail:${params.portee}] lecture impossible — on suppose OCCUPÉ`, {
      cle: params.cle,
      message: error.message,
    })
    return true
  }
  return data === true
}

/**
 * ATTEND QU'UN BAIL SE LIBÈRE, BORNÉ.
 *
 * ┌─ POURQUOI ATTENDRE PLUTÔT QUE REFUSER ──────────────────────────────────┐
 * │ « Le second attend » (Youssef, point 4). Un expert qui clique deux fois  │
 * │ n'a rien fait de mal, et lui répondre « trop de recherches lancées coup  │
 * │ sur coup » est un message d'ÉCHEC pour quelque chose qui n'a pas         │
 * │ échoué — c'est le faux message que ce point fait disparaître.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Rend `true` si le bail s'est libéré dans le délai, `false` s'il tient
 * toujours. L'appelant décide quoi en faire ; ici, on n'affirme rien.
 *
 * ⚠️ IL N'Y A PAS DE TROISIÈME ÉTAT, et c'est voulu : une attente qui rendrait
 *    « je ne sais pas » ferait porter à l'appelant une décision qu'il ne peut
 *    pas prendre. Une lecture en panne compte comme « tenu » (cf. `bailTenu`),
 *    donc l'attente expire — la bonne direction d'échec.
 */
export async function attendreBailLibre(
  admin: SupabaseClient,
  params: {
    portee: PorteeBail
    cle: string
    maxDurationSec: number
    /** Combien de temps on accepte d'attendre, en millisecondes. */
    attenteMaxMs: number
    /** Intervalle entre deux lectures. */
    pasMs?: number
  },
): Promise<boolean> {
  const pas = params.pasMs ?? 750
  const limite = Date.now() + params.attenteMaxMs
  // Une première lecture AVANT toute attente : le cas normal est que le bail
  // soit libre, et il ne doit rien coûter.
  for (;;) {
    if (!(await bailTenu(admin, params))) return true
    if (Date.now() + pas > limite) return false
    await new Promise((r) => setTimeout(r, pas))
  }
}
