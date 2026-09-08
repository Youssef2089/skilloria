import type { SupabaseClient } from '@supabase/supabase-js'
import { enTranches, TAILLE_TRANCHE_IDS } from '@/lib/matching/tranches'

/**
 * lib/matching/reprise.ts — CE QUI A ÉTÉ NOTÉ NE SE RENOTE PAS.
 *
 * ═══ LE MUR, ET CE QUI LE SUPPRIME ════════════════════════════════════════
 *   La fonction qui lance le matching est tuée à soixante secondes. À l'échelle
 *   promise — aucun plafond de vivier — un run peut ne pas finir. Il reste
 *   alors marqué inachevé, donc rejouable : c'était le bon choix, sauf qu'il
 *   REPARTAIT DE ZÉRO. Les lots déjà payés étaient repayés à chaque tentative,
 *   jusqu'à l'abandon au bout de cinq.
 *
 *   Paralléliser repousse le mur. Seule la reprise le supprime : un run
 *   interrompu recommence là où il s'est arrêté, et ne paie chaque profil
 *   qu'une fois.
 *
 * ═══ CE QUE CE MODULE N'EST PAS ═══════════════════════════════════════════
 *   Ni une file d'attente, ni un cache de scores. Le brouillon est éphémère :
 *   soldé dès que le run s'achève, purgé au bout de 24 h s'il ne s'achève
 *   jamais. `matches` reste la seule source de vérité, et la réconciliation le
 *   seul endroit qui décide ce qui existe et ce qui est notifié.
 *
 * ═══ BEST-EFFORT, ET C'EST DÉLIBÉRÉ ═══════════════════════════════════════
 *   Échouer à MÉMORISER une note ne doit jamais faire perdre la note elle-même.
 *   Au pire, ce lot sera repayé une fois — exactement le comportement d'avant,
 *   donc jamais une régression.
 */

const TABLE = 'matching_notes_partielles'

/**
 * Les notes déjà acquises pour ce run, à ne pas repayer.
 *
 * Un modèle DIFFÉRENT invalide la reprise : deux modèles ne produisent pas des
 * notes comparables, et mélanger leurs échelles ferait un classement qui
 * n'existe nulle part. On repart alors de zéro, ce qui est le comportement sûr.
 */
export async function notesDejaAcquises(
  supabaseAdmin: SupabaseClient,
  publicationId: string,
  model: string,
): Promise<Map<string, number>> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('profile_id, score, model')
    .eq('publication_id', publicationId)
    .eq('model', model)
  if (error) {
    // Sans reprise, on renote tout : plus lent et plus cher, jamais faux.
    console.warn('[reprise] brouillon illisible — le run repart de zéro', {
      publicationId,
      message: error.message,
    })
    return new Map()
  }
  const acquises = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ profile_id: string; score: number }>) {
    acquises.set(r.profile_id, r.score)
  }
  if (acquises.size > 0) {
    console.log('[reprise] run repris', { publicationId, deja_notes: acquises.size, model })
  }
  return acquises
}

/** Mémorise les notes d'UN lot, juste après qu'il a été payé. */
export async function memoriserNotes(
  supabaseAdmin: SupabaseClient,
  publicationId: string,
  model: string,
  notes: ReadonlyArray<{ id: string; score: number }>,
): Promise<void> {
  if (notes.length === 0) return
  const lignes = notes.map((n) => ({
    publication_id: publicationId,
    profile_id: n.id,
    score: n.score,
    model,
  }))
  const { error } = await supabaseAdmin.from(TABLE).upsert(lignes, {
    onConflict: 'publication_id,profile_id',
  })
  if (error) {
    console.warn('[reprise] notes NON mémorisées — ce lot sera repayé si le run est interrompu', {
      publicationId,
      taille: notes.length,
      message: error.message,
    })
  }
}

/**
 * Solde le brouillon d'un run achevé.
 *
 * Appelé APRÈS la réconciliation : tant qu'elle n'a pas eu lieu, le brouillon
 * est la seule mémoire de ce qui a été payé, et l'effacer avant rouvrirait très
 * exactement le défaut qu'on ferme.
 */
export async function solderBrouillon(
  supabaseAdmin: SupabaseClient,
  publicationId: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from(TABLE).delete().eq('publication_id', publicationId)
  if (error) {
    // Sans conséquence immédiate : la purge quotidienne le rattrape.
    console.warn('[reprise] brouillon non soldé — la purge le reprendra', {
      publicationId,
      message: error.message,
    })
  }
}

/**
 * Mémorise les notes d'un lot dans le sens EXPERT → ANNONCES.
 *
 * L'identifiant noté est celui de l'ANNONCE, et le profil est fixe : c'est
 * l'inverse de l'autre sens, pour la même clé de brouillon. Écrire deux
 * fonctions plutôt qu'une avec un drapeau évite qu'on inverse un jour les deux
 * colonnes sans que rien ne le dise — les deux sont des `uuid`.
 */
export async function memoriserNotesParAnnonce(
  supabaseAdmin: SupabaseClient,
  profileId: string,
  model: string,
  notes: ReadonlyArray<{ id: string; score: number }>,
): Promise<void> {
  if (notes.length === 0) return
  const lignes = notes.map((n) => ({
    publication_id: n.id,
    profile_id: profileId,
    score: n.score,
    model,
  }))
  const { error } = await supabaseAdmin.from(TABLE).upsert(lignes, {
    onConflict: 'publication_id,profile_id',
  })
  if (error) {
    console.warn('[reprise] notes NON mémorisées — ce lot sera repayé si le run est interrompu', {
      profileId,
      taille: notes.length,
      message: error.message,
    })
  }
}

/**
 * Les notes acquises pour un LOT d'annonces (parcours expert→annonces).
 *
 * Les identifiants sont découpés en tranches : injectés d'un bloc, ils
 * dépassent la longueur d'URL admise bien avant l'échelle promise.
 */
export async function notesDejaAcquisesPourAnnonces(
  supabaseAdmin: SupabaseClient,
  publicationIds: readonly string[],
  profileId: string,
  model: string,
): Promise<Map<string, number>> {
  const acquises = new Map<string, number>()
  for (const tranche of enTranches(publicationIds, TAILLE_TRANCHE_IDS)) {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select('publication_id, score')
      .in('publication_id', tranche)
      .eq('profile_id', profileId)
      .eq('model', model)
    if (error) {
      console.warn('[reprise] brouillon illisible — le run repart de zéro', { message: error.message })
      return new Map()
    }
    for (const r of (data ?? []) as Array<{ publication_id: string; score: number }>) {
      acquises.set(r.publication_id, r.score)
    }
  }
  return acquises
}
