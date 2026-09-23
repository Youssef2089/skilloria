// lib/organisations/porte-parole.ts
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ QUI PARLE POUR UNE ORGANISATION — et donc dans quelle langue on l'écrit. ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ LE BESOIN, ET IL VIENT DU POINT 7 ─────────────────────────────────────┐
// │ « Chaque texte dans la langue de celui qui le lit. » L'explication est   │
// │ lue par l'EXPERT — sa locale est sur son compte, elle ne pose aucune     │
// │ question. Le résumé est lu par l'ORGANISATION, et une organisation n'a   │
// │ PAS de langue : elle a des membres, qui en ont chacun une.               │
// └──────────────────────────────────────────────────────────────────────────┘
//
// ═══ LA RÈGLE EXISTAIT DÉJÀ, ET ELLE N'ÉTAIT ÉCRITE NULLE PART ═══════════
//   `app/api/admin/approve-org` choisit depuis toujours **le membre ADMIN le
//   plus ancien** pour adresser l'e-mail d'approbation. C'est la bonne règle —
//   elle est stable, elle désigne quelqu'un qui existe, et elle ne dépend
//   d'aucun réglage. Mais elle vivait dans une requête, au milieu d'une route,
//   sous un commentaire. La recopier ici en aurait fait un jumeau (§E.20) : le
//   jour où l'une des deux passe au propriétaire plutôt qu'au doyen, l'e-mail
//   et le résumé de candidature s'adressent à deux personnes différentes.
//
// ⚠️ CE MODULE NE PROJETTE RIEN. Il donne le CRITÈRE — le filtre et l'ordre —
//    parce que les deux appelants ne lisent pas les mêmes colonnes : l'un veut
//    une langue, l'autre veut aussi un e-mail et un prénom. Partager la
//    projection les aurait forcés à charger ce dont ils n'ont pas besoin, et
//    un e-mail chargé pour rien est une donnée personnelle chargée pour rien.

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * LE CRITÈRE, en données — à appliquer sur `organization_members`.
 *
 * `role_in_org = 'admin'` et `status = 'active'`, le plus ANCIEN d'abord.
 * Les trois ensemble : un admin inactif ne parle plus, et sans l'ordre on
 * prendrait n'importe lequel — donc un autre à chaque lecture.
 */
export const PORTE_PAROLE = {
  colonneRole: 'role_in_org',
  valeurRole: 'admin',
  colonneStatut: 'status',
  valeurStatut: 'active',
  colonneAnciennete: 'joined_at',
} as const

/** Les quatre langues du produit. Repris de `lib/candidatures/ai-assessment.ts`. */
export type Langue = 'fr' | 'en' | 'es' | 'de'
const LANGUES: readonly Langue[] = ['fr', 'en', 'es', 'de']

/**
 * LA LANGUE PAR DÉFAUT — le français, et c'est une DÉCISION, pas un repli.
 *
 * Le produit est francophone d'abord (locale par défaut `fr`, cf.
 * `i18n/routing.ts`). Une organisation dont aucun admin actif n'a de locale
 * lisible reçoit donc du français, ce qui est vrai de la très grande majorité
 * des cas — et non « rien », qui laisserait le modèle choisir.
 */
export const LANGUE_PAR_DEFAUT: Langue = 'fr'

/** Rend une langue du produit, ou le défaut. Jamais `null` : un texte s'écrit. */
export function normaliserLangue(v: unknown): Langue {
  const s = typeof v === 'string' ? v.trim().slice(0, 2).toLowerCase() : ''
  return (LANGUES as readonly string[]).includes(s) ? (s as Langue) : LANGUE_PAR_DEFAUT
}

/**
 * La langue dans laquelle on s'adresse à une organisation.
 *
 * Ne lève JAMAIS : un texte doit s'écrire, et une lecture en panne ne doit pas
 * faire échouer un dépôt de candidature. Elle rend alors la langue par défaut
 * — et elle le DIT, parce qu'une organisation anglophone qui reçoit du
 * français n'est pas une panne visible (§E.22).
 */
export async function langueDeLOrganisation(
  admin: SupabaseClient,
  organizationId: string,
): Promise<Langue> {
  const { data, error } = await admin
    .from('organization_members')
    .select('users!organization_members_user_id_fkey(locale)')
    .eq('organization_id', organizationId)
    .eq(PORTE_PAROLE.colonneRole, PORTE_PAROLE.valeurRole)
    .eq(PORTE_PAROLE.colonneStatut, PORTE_PAROLE.valeurStatut)
    .order(PORTE_PAROLE.colonneAnciennete, { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error(
      '[porte-parole] langue de l organisation ILLISIBLE — le texte partira en',
      LANGUE_PAR_DEFAUT,
      { organizationId, message: error.message },
    )
    return LANGUE_PAR_DEFAUT
  }
  if (!data) {
    // AUCUN ADMIN ACTIF. Ce n'est pas une panne : une organisation peut en être
    // temporairement dépourvue. On le dit quand même — c'est aussi le signe
    // d'une organisation que plus personne ne pilote.
    console.log('[porte-parole] aucun admin actif — le texte partira en', LANGUE_PAR_DEFAUT, {
      organizationId,
    })
    return LANGUE_PAR_DEFAUT
  }
  const u = Array.isArray(data.users) ? data.users[0] : data.users
  return normaliserLangue((u as { locale?: string | null } | null)?.locale ?? null)
}
