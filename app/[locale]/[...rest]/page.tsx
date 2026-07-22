import { notFound } from 'next/navigation'

/**
 * Catch-all des URL non résolues SOUS une locale valide (`/fr/...`, `/en/...`).
 *
 * Sans lui, une URL inexistante remonte jusqu'au root layout NU
 * (`app/layout.tsx`, qui ne rend PAS `<html>`/`<body>` — pattern next-intl où
 * le document vit dans `app/[locale]/layout.tsx`). Next lève alors :
 *   « Missing <html> and <body> tags in the root layout ».
 *
 * En routant toute URL non matchée vers `notFound()`, le rendu 404 est pris en
 * charge par `app/[locale]/not-found.tsx`, monté DANS le layout `[locale]`
 * (donc AVEC `<html>`/`<body>` + providers i18n/domain). 404 propre, plus de
 * crash. Les routes réelles (plus spécifiques) ont toujours la priorité.
 */
export default function CatchAllNotFound() {
  notFound()
}
