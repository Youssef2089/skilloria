// lib/profil/lien-cv.ts
//
// LE CV D'UN EXPERT, OUVERT PAR UN ADMINISTRATEUR — EN LECTURE SEULE, PAR UN LIEN QUI EXPIRE
// (recette staging du 01/10/2026, point 14 — décision de Youssef).
//
// LE DÉFAUT : la fiche admin lisait `profiles.cv_url`, une colonne qu'AUCUN chemin n'écrit
// (seule la purge la remet à `null`). Le CV déposé vit dans le bucket privé `cv`, au chemin
// `profiles.cv_file_path` : la case affichait « — » sur tout dossier, et l'administrateur
// décidait d'une approbation sans pouvoir lire le document vérifié.
//
// LA RÈGLE, ET CE QU'ELLE CHANGE : l'en-tête de la migration des buckets disait « cv = PRIVÉ,
// accès service-role uniquement, jamais d'URL ». Le bucket RESTE privé et aucune politique
// ne s'ouvre au navigateur ; la seule URL qui existe est signée PAR LE SERVEUR, pour un
// administrateur, AU CLIC, et elle expire en une minute. Une URL signée ne permet que la
// lecture de l'objet nommé : ni écriture, ni liste, ni autre fichier.
//
// TROIS ISSUES, JAMAIS DEUX (§E.22) : « aucun CV déposé » et « le lien n'a pas pu être créé »
// ne sont pas le même fait — le premier se dit, le second se réessaie.

import type { SupabaseClient } from '@supabase/supabase-js'
import { estObjetIntrouvable } from '../avatar.ts'

/** Durée de vie du lien, en secondes : le temps d'un clic, pas d'une session. */
export const DUREE_LIEN_CV_SECONDES = 60

export type LienCv =
  | { etat: 'disponible'; url: string }
  | { etat: 'absent' }
  | { etat: 'indisponible' }

export async function signerLienCv(admin: SupabaseClient, chemin: string | null): Promise<LienCv> {
  if (!chemin) return { etat: 'absent' }
  try {
    const { data, error } = await admin.storage.from('cv').createSignedUrl(chemin, DUREE_LIEN_CV_SECONDES)
    if (error) {
      // Le chemin est en base mais l'objet n'est plus là : c'est une ABSENCE, dite comme telle.
      if (estObjetIntrouvable(error)) return { etat: 'absent' }
      console.error('[lien-cv] signature impossible — stockage en défaut', { message: error.message })
      return { etat: 'indisponible' }
    }
    if (!data?.signedUrl) {
      console.error('[lien-cv] réponse sans URL signée')
      return { etat: 'indisponible' }
    }
    return { etat: 'disponible', url: data.signedUrl }
  } catch (err) {
    console.error('[lien-cv] signature impossible', { message: err instanceof Error ? err.message : String(err) })
    return { etat: 'indisponible' }
  }
}
