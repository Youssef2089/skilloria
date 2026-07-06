/**
 * Échappement HTML centralisé des emails (fix E1).
 *
 * Source unique de vérité : toute valeur dynamique injectée dans un email
 * (nœud texte OU attribut) doit passer par `escapeHtml` avant insertion.
 * Le point d'application est `interpolate()` (lib/emails/locales.ts), jamais
 * les templates eux-mêmes (qui contiennent du HTML légitime à préserver).
 *
 * Jeu d'entités volontairement symétrique avec `stripHtml` (lib/emails/layout.ts)
 * pour que la version texte des emails redécode proprement :
 *   &  -> &amp;   <  -> &lt;   >  -> &gt;   "  -> &quot;   '  -> &#39;
 * NB : on utilise `&#39;` (numérique) et NON `&apos;` — `stripHtml` décode
 * `&#39;` mais pas `&apos;`.
 */

/** Échappe & < > " ' — sûr pour un nœud texte comme pour un attribut HTML. */
export function escapeHtml(s: string): string {
  return s
    // `&` d'abord, sinon les `&` des entités générées seraient ré-échappés.
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
