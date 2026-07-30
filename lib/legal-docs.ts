import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Chargeur des textes juridiques (SERVEUR uniquement — utilise node:fs).
 *
 * SOURCE UNIQUE : les textes vivent dans docs/legal/*.md (versionnés git,
 * décision D4). Les pages les rendent tels quels — aucune duplication : une
 * modification du .md se reflète directement sur la page. Ne JAMAIS recopier le
 * contenu ailleurs.
 *
 * Lecture mémoïsée (une fois par instance serveur). Les pages étant rendues
 * dynamiquement (le layout racine lit les headers pour le multi-tenant), le
 * fichier est lu au chaud du process ; `next.config.ts` (outputFileTracingIncludes)
 * garantit que docs/legal/*.md est embarqué dans le bundle serverless Vercel.
 */

export type LegalDocKey = 'mentions-legales' | 'politique-de-confidentialite' | 'cgu'

const FILES: Record<LegalDocKey, string> = {
  'mentions-legales': '01-mentions-legales.md',
  'politique-de-confidentialite': '02-politique-de-confidentialite.md',
  cgu: '03-cgu-experts.md',
}

const cache = new Map<LegalDocKey, string>()

export function loadLegalDoc(key: LegalDocKey): string {
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const content = readFileSync(join(process.cwd(), 'docs', 'legal', FILES[key]), 'utf8')
  cache.set(key, content)
  return content
}
