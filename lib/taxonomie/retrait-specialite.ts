// lib/taxonomie/retrait-specialite.ts
//
// UNE SPÉCIALITÉ DÉSACTIVÉE SE DIT À L'EXPERT QUI L'AVAIT CHOISIE (lot zones de travail, 02/10/2026 —
// relecteur, décision de Youssef).
//
// LE DÉFAUT : l'administrateur désactivait une spécialité ; les écrans de validation ne reçoivent que
// les spécialités ACTIVES (/api/taxonomy) : elle disparaissait du profil de l'expert, sans un mot, au
// prochain affichage — et au prochain enregistrement, `/api/profile` la sortait aussi. L'expert ne
// savait ni qu'elle était partie, ni qu'il devait en choisir une autre ; si c'était la seule, son profil
// ne pouvait plus être publié, et rien ne le lui disait.
//
// LA RÈGLE : au moment où l'administrateur la DÉSACTIVE (et seulement à ce passage d'actif à inactif),
// chaque expert qui l'a dans ses spécialités reçoit une notification dans l'application, DANS SA
// LANGUE (`users.locale`), le nom de la spécialité dans cette langue, et un lien vers la validation de
// son profil. Si c'était sa seule spécialité — aucune autre ACTIVE, aucune précision « Autre » — le
// message dit que le profil ne peut plus être publié tant qu'il n'en a pas choisi une autre.
//
// Les textes vivent dans les messages (`specialite_retiree`, quatre langues) — lecture directe des JSON,
// comme lib/notifications/inapp-labels.ts. Canal : l'application seulement (`inapp`) ; le dispatcher
// d'e-mails ne lit que les types qu'il connaît, celui-ci n'en fait pas partie.

import type { SupabaseClient } from '@supabase/supabase-js'
import fr from '@/messages/fr.json'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import de from '@/messages/de.json'
import { dashboardUrlForUserType } from '@/lib/auth-routing'
import { lectureIncomplete, lireToutesLesLignes } from '@/lib/matching/lecture-paginee'
import { resolveNotificationLocale } from '@/lib/notifications/inapp-labels'
import { loadTranslations, tBDD } from '@/lib/translations'
import { etaitLaSeule } from '@/lib/taxonomie/specialite-seule'

type Textes = { titre: string; corps: string; corps_seule: string }
const TEXTES: Record<'fr' | 'en' | 'es' | 'de', Textes> = {
  fr: fr.specialite_retiree,
  en: en.specialite_retiree,
  es: es.specialite_retiree,
  de: de.specialite_retiree,
}

/** Le titre et le corps de la notification, dans une langue. `seule` : c'était la seule spécialité. */
export function texteRetraitSpecialite(
  localeBrute: string | null | undefined,
  nomSpecialite: string,
  seule: boolean,
): { titre: string; corps: string } {
  const t = TEXTES[resolveNotificationLocale(localeBrute)]
  return {
    titre: t.titre.replace('{specialite}', () => nomSpecialite),
    corps: seule ? t.corps_seule : t.corps,
  }
}

type LigneProfil = {
  id: string
  user_id: string
  domain_id: string
  speciality_ids: string[] | null
  speciality_other: string | null
  users: { locale: string | null; user_type: string | null } | Array<{ locale: string | null; user_type: string | null }> | null
}

/** Combien de notifications partent par insertion (une instruction, tout ou rien pour ce lot). */
const LOT_INSERTION = 500

/**
 * Prévient chaque expert qui avait choisi la spécialité désactivée. À appeler APRÈS la désactivation
 * écrite. Rend le nombre d'experts prévenus, ou l'échec NOMMÉ (lecture ou écriture) — jamais un
 * silence : l'administrateur le lit.
 */
export async function notifierRetraitSpecialite(
  admin: SupabaseClient,
  args: { specialiteId: string; nomFr: string; piece: string },
): Promise<{ ok: true; prevenus: number } | { ok: false; message: string }> {
  // Tous les profils qui la portent — lus EN ENTIER, par pages, dans un ordre total (la limite de lignes de
  // l'API couperait en silence au-delà de 1 000).
  const lecture = await lireToutesLesLignes<LigneProfil>({
    construire: (o) =>
      admin
        .from('profiles')
        .select('id, user_id, domain_id, speciality_ids, speciality_other, users!profiles_user_id_fkey(locale, user_type)', o)
        .contains('speciality_ids', [args.specialiteId]),
    departageUnique: 'id',
    identite: (r) => r.id,
    contexte: `retrait de spécialité (${args.specialiteId})`,
  })
  if (lecture.erreur) return { ok: false, message: lecture.erreur }
  if (lectureIncomplete(lecture)) return { ok: false, message: `profils lus en partie (${lecture.distincts} sur ${lecture.attendu})` }
  if (lecture.lignes.length === 0) return { ok: true, prevenus: 0 }

  // Les AUTRES spécialités de ces profils : lesquelles sont encore actives ?
  const autres = [...new Set(lecture.lignes.flatMap((p) => p.speciality_ids ?? []).filter((id) => id !== args.specialiteId))]
  const actives = new Set<string>()
  for (let i = 0; i < autres.length; i += LOT_INSERTION) {
    const { data, error } = await admin.from('specialities').select('id').in('id', autres.slice(i, i + LOT_INSERTION)).eq('active', true)
    if (error) return { ok: false, message: `spécialités illisibles : ${error.message}` }
    for (const r of (data ?? []) as Array<{ id: string }>) actives.add(r.id)
  }

  // Le nom de la spécialité dans la langue de chaque expert (le français en repli).
  const noms = new Map<string, string>()
  const nomDans = async (locale: 'fr' | 'en' | 'es' | 'de') => {
    if (!noms.has(locale)) noms.set(locale, tBDD(await loadTranslations(locale), 'specialities', args.specialiteId, 'name', args.nomFr))
    return noms.get(locale) as string
  }

  const lignes: Array<Record<string, unknown>> = []
  for (const p of lecture.lignes) {
    const compte = Array.isArray(p.users) ? p.users[0] ?? null : p.users
    const locale = resolveNotificationLocale(compte?.locale ?? null)
    const seule = etaitLaSeule(args.specialiteId, p.speciality_ids, p.speciality_other, actives)
    const { titre, corps } = texteRetraitSpecialite(locale, await nomDans(locale), seule)
    lignes.push({
      user_id: p.user_id,
      domain_id: p.domain_id,
      piece: args.piece,
      type: 'specialite_retiree',
      channel: 'inapp',
      title: titre,
      body: corps,
      link_url: `${dashboardUrlForUserType(compte?.user_type ?? null)}/profil/valider`,
      status: 'pending',
      entity_id: args.specialiteId,
    })
  }
  for (let i = 0; i < lignes.length; i += LOT_INSERTION) {
    const { error } = await admin.from('notifications').insert(lignes.slice(i, i + LOT_INSERTION))
    if (error) return { ok: false, message: `notifications non posées (${i} sur ${lignes.length} posées) : ${error.message}` }
  }
  return { ok: true, prevenus: lignes.length }
}
