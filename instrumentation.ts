// instrumentation.ts — AU DÉMARRAGE D'UN ENVIRONNEMENT DÉPLOYÉ, CE QUI MANQUE SE DIT, NOMMÉ (§E.86, 29/09/2026).
//
// Next appelle `register()` UNE fois par instance serveur, avant la première requête (documentation Next 16,
// « instrumentation.js », lue le 29/09/2026). Sur Vercel, c'est à chaque démarrage d'une fonction : la ligne
// arrive dans les journaux d'exécution (Runtime Logs), en tête de la première requête servie.
//
// POURQUOI : l'inscription expert s'arrêtait à l'envoi du SMS, et la cause la plus simple — une clé Vonage
// absente de Preview — ne se disait nulle part. Désormais chaque variable EXIGÉE qui manque part en erreur
// (`variable_manquante`), avec son nom et ce qui casse sans elle ; une variable OPTIONNELLE absente part en
// avertissement ; une variable du POSTE LOCAL posée sur Vercel aussi. JAMAIS une valeur.
//
// ⚠️ ON N'ARRÊTE PAS LE SERVEUR : une clé Stripe absente (voulue au lancement) ne doit pas couper le site, et
//    une clé Vonage absente ne doit pas couper les pages qui n'envoient pas de SMS. La panne de chaque
//    fonction dit sa cause quand elle la rencontre ; ce démarrage dit TOUT, une fois, d'un coup d'œil.
//    La racine des adresses, elle, arrête déjà chaque page en se nommant (lib/subdomain.ts).
//
// La liste vit dans lib/configuration/variables.ts ; `diag-variables-environnement` la confronte au code.

export async function register(): Promise<void> {
  // Le poste local n'est pas un environnement déployé : `.env.local` y répond, et DEV_DOMAIN_SLUG y est voulue.
  if (!process.env.VERCEL_ENV) return
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { variablesManquantes } = await import('./lib/configuration/variables')
  const manques = variablesManquantes(process.env)
  for (const m of manques) {
    const ligne = {
      code: 'variable_manquante',
      nom: m.nom,
      motif: m.motif,
      exigence: m.exigence,
      environnement: process.env.VERCEL_ENV,
      role: m.role,
      si_absente: m.siAbsente,
    }
    if (m.exigence === 'deploye') console.error(`[configuration] ${m.nom} — ${m.motif}`, ligne)
    else console.warn(`[configuration] ${m.nom} — ${m.motif}`, ligne)
  }
  if (manques.every((m) => m.exigence !== 'deploye')) {
    console.info('[configuration] toutes les variables exigées sont posées', { environnement: process.env.VERCEL_ENV })
  }
}
