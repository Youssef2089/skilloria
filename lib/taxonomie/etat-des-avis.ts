// lib/taxonomie/etat-des-avis.ts
//
// L'ÉTAT DES AVIS D'UNE SPÉCIALITÉ DÉSACTIVÉE — CE QUI A ÉTÉ FAIT, ET CE QUI RESTE (lot alertes et recommandations).
//
// LE CAS (recette staging) : l'administrateur désactive une spécialité que l'expert d'essai a sur son profil ; aucun
// avis dans sa cloche, même après rechargement — et l'écran de l'administrateur n'affichait ni message ni bouton
// « Prévenir les experts ». Établi dans le code :
//   ① sur un SUCCÈS, l'écran se taisait : la réponse portait le nombre d'avis posés, personne ne le lisait ;
//   ② le bouton « Prévenir les experts » n'apparaissait qu'APRÈS un code d'échec, dans l'état local de la page : une
//      spécialité DÉJÀ inactive — désactivée avant que l'avis existe, ou sur une page rechargée — n'avait AUCUN chemin
//      pour prévenir ses experts. La route, elle, savait le faire (`prevenir: true`).
//
// LA RÈGLE : l'état se RELIT à chaque affichage, depuis la base — jamais de la mémoire d'un clic. Pour chaque
// spécialité inactive : les experts qui l'ont ENCORE sur leur profil (concernés), ceux qui ont reçu l'avis de CETTE
// désactivation (sa pièce, `specialities.desactivation_piece`), et la différence (à prévenir). L'écran le dit, et offre
// « Prévenir les experts » tant qu'il en reste — la base saute ceux déjà prévenus : chacun reçoit son avis UNE fois.
//
// LECTURES COMPLÈTES OU PANNE : par pages, dans un ordre total (lib/matching/lecture-paginee.ts) ; une lecture
// incomplète n'est pas un « zéro » (§E.22) — elle rend `illisible`, et l'écran le dit.
//
// CE QU'IL NE VOIT PAS, ET LE DIT : un avis posé sous une AUTRE pièce que celle de la désactivation en cours n'est pas
// compté comme reçu. C'est voulu (une nouvelle désactivation, après une réactivation, se redit) ; le seul cas où ce
// serait un doublon est un avis posé avant que la pièce de désactivation existe (migration
// `specialite_ecriture_et_avis_une_fois`) — NON VÉRIFIÉ en base, la requête de contrôle est dans docs/reprise-s2.md.

import type { SupabaseClient } from '@supabase/supabase-js'
// Import RELATIF avec extension : `diag-alertes-recommandations` exécute ce module tel quel, sur une base simulée (§E.3).
import { lectureIncomplete, lireToutesLesLignes } from '../matching/lecture-paginee.ts'

export type EtatDesAvis = {
  /** Experts qui ont ENCORE la spécialité sur leur profil. */
  concernes: number
  /** Parmi eux, ceux qui ont reçu l'avis de la désactivation EN COURS. */
  prevenus: number
  /** Ceux qui restent à prévenir. */
  a_prevenir: number
}

export type LectureEtatDesAvis =
  | { ok: true; etats: Map<string, EtatDesAvis> }
  | { ok: false; message: string }

type LigneProfil = { id: string; user_id: string; speciality_ids: string[] | null }
type LigneAvis = { id: string; user_id: string; entity_id: string | null; piece: string | null }

/** L'état des avis de chaque spécialité INACTIVE demandée (la pièce de sa désactivation, ou `null` si elle n'en a pas). */
export async function etatDesAvisDeRetrait(
  admin: SupabaseClient,
  inactives: ReadonlyArray<{ id: string; desactivation_piece: string | null }>,
): Promise<LectureEtatDesAvis> {
  const etats = new Map<string, EtatDesAvis>()
  if (inactives.length === 0) return { ok: true, etats }
  const ids = inactives.map((s) => s.id)

  const profils = await lireToutesLesLignes<LigneProfil>({
    construire: (o) => admin.from('profiles').select('id, user_id, speciality_ids', o).overlaps('speciality_ids', ids),
    departageUnique: 'id',
    identite: (r) => r.id,
    contexte: 'état des avis : profils',
  })
  if (profils.erreur) return { ok: false, message: profils.erreur }
  if (lectureIncomplete(profils)) return { ok: false, message: `profils lus en partie (${profils.distincts} sur ${profils.attendu})` }

  const avis = await lireToutesLesLignes<LigneAvis>({
    construire: (o) =>
      admin.from('notifications').select('id, user_id, entity_id, piece', o).eq('type', 'specialite_retiree').in('entity_id', ids),
    departageUnique: 'id',
    identite: (r) => r.id,
    contexte: 'état des avis : notifications',
  })
  if (avis.erreur) return { ok: false, message: avis.erreur }
  if (lectureIncomplete(avis)) return { ok: false, message: `avis lus en partie (${avis.distincts} sur ${avis.attendu})` }

  for (const s of inactives) {
    const concernes = new Set(profils.lignes.filter((p) => (p.speciality_ids ?? []).includes(s.id)).map((p) => p.user_id))
    const recus = new Set(
      s.desactivation_piece
        ? avis.lignes.filter((a) => a.entity_id === s.id && a.piece === s.desactivation_piece).map((a) => a.user_id)
        : [],
    )
    let prevenus = 0
    for (const u of concernes) if (recus.has(u)) prevenus++
    etats.set(s.id, { concernes: concernes.size, prevenus, a_prevenir: concernes.size - prevenus })
  }
  return { ok: true, etats }
}
