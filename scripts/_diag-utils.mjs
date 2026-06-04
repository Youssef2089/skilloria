// scripts/_diag-utils.mjs — Helpers pour tests de diagnostic propres.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Pattern recommandé : jeu de données ÉPHÉMÈRE isolé
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// 1. Le diag crée ses propres données (publication / candidature / conv) AVEC
//    des IDs générés à la volée.
// 2. Son flow principal manipule ces IDs.
// 3. En FIN (try/finally), le diag DELETE la publication créée. Le CASCADE
//    SQL (FK ON DELETE CASCADE sur matches/candidatures/conversations/messages)
//    balaye tout le dérivé. + DELETE explicite des notifications d'entity_id.
//
// Si le diag plante avant le teardown : le RESET initial du PROCHAIN run
// supprime les résidus. Mais on évite tout résidu en wrapping correctement
// dans try/finally.
//
// Usage :
//   const { withEphemeralPublication } = await import('./_diag-utils.mjs')
//   await withEphemeralPublication({ supabaseAdmin, orgId, domainId }, async (pubId) => {
//     // tests …
//   })

export async function withEphemeralPublication(
  { supabaseAdmin, orgId, domainId, type = 'mission', title = '[DIAG-EPHEMERAL] ' },
  fn,
) {
  // Création — status 'published' pour tester matching/candidatures dans la foulée
  const { data: pub, error: createErr } = await supabaseAdmin
    .from('publications')
    .insert({
      organization_id: orgId,
      domain_id: domainId,
      type,
      title: title + new Date().toISOString().slice(0, 16),
      description: 'Diag éphémère — sera supprimée en fin de test.',
      status: 'published',
      published_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (createErr || !pub) throw new Error(`ephemeral publi creation failed: ${createErr?.message ?? 'no row'}`)
  const pubId = pub.id

  try {
    await fn(pubId)
  } finally {
    // TEARDOWN : DELETE publi → CASCADE matches/candidatures/conversations/messages
    await supabaseAdmin.from('notifications').delete().eq('entity_id', pubId)
    await supabaseAdmin.from('publications').delete().eq('id', pubId)
  }
}

/**
 * Wrapper try/finally pour les diag qui manipulent une publi/conv déjà
 * existante (legacy). Garantit le TEARDOWN même en cas de throw.
 */
export async function withTeardown(fn, teardownFn) {
  try {
    return await fn()
  } finally {
    try { await teardownFn() } catch (err) { console.error('[diag teardown] threw', err) }
  }
}
