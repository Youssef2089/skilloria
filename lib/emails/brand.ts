import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * lib/emails/brand.ts — résout le NOM DE MARQUE d'un email à partir du domaine
 * du destinataire (D3). L'email d'un utilisateur SAP doit porter le nom SAP,
 * celui d'un utilisateur Microsoft le nom Microsoft — jamais un nom figé.
 *
 * Source : `domains.name` (nom commercial du domaine). Repli sur la marque
 * OMBRELLE « Skilloria » UNIQUEMENT si le domaine est introuvable (anomalie de
 * données) — ce repli n'est pas un nom d'écosystème figé, c'est la marque
 * plateforme neutre, pour ne pas envoyer un email sans en-tête.
 */
export const UMBRELLA_BRAND = 'Skilloria'

export async function resolveEmailBrandName(
  supabaseAdmin: SupabaseClient,
  domainId: string | null | undefined,
): Promise<string> {
  if (domainId) {
    const { data } = await supabaseAdmin
      .from('domains')
      .select('name')
      .eq('id', domainId)
      .maybeSingle()
    const name = ((data as { name?: string | null } | null)?.name ?? '').trim()
    if (name) return name
  }
  return UMBRELLA_BRAND
}
