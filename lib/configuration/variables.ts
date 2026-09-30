/**
 * lib/configuration/variables.ts — LES VARIABLES D'ENVIRONNEMENT QUE LE CODE LIT, TOUTES, ET CE QU'ELLES FONT.
 *
 * ═══ POURQUOI CE FICHIER (§E.86, 29/09/2026) ══════════════════════════════
 *   L'inscription expert s'arrêtait à l'envoi du SMS sur staging : « Service SMS
 *   temporairement indisponible ». Parmi les causes possibles, la plus simple — une
 *   clé Vonage absente de l'environnement Preview — ne se disait NULLE PART : ni au
 *   démarrage, ni en supervision, ni à l'écran (qui la disait « temporaire »). Le
 *   parcours dépendait d'une variable que rien ne vérifiait, et la liste des
 *   variables vivait dans la documentation, que rien ne confrontait au code.
 *
 * ═══ CE QU'IL EST ═════════════════════════════════════════════════════════
 *   L'inventaire UNIQUE : chaque variable lue par le code (app/, lib/, components/,
 *   proxy.ts, instrumentation.ts), son rôle, ce qui casse sans elle. JAMAIS une
 *   valeur. `diag-variables-environnement` rougit si le code lit une variable absente
 *   d'ici, ou si une variable d'ici n'est plus lue ; et si une variable exigée
 *   manque à la procédure de mise en production.
 *   Au démarrage d'un environnement déployé, `instrumentation.ts` NOMME chaque
 *   variable exigée qui manque (code `variable_manquante`) ; la supervision aussi.
 *
 * ═══ LES QUATRE EXIGENCES ═════════════════════════════════════════════════
 *   `deploye`     — exigée sur TOUT environnement déployé (Production ET Preview).
 *                   Absente, une fonction du produit est cassée : le démarrage le dit.
 *   `optionnelle` — son absence éteint une capacité, DÉLIBÉRÉMENT (interrupteurs
 *                   fermés par défaut, paiement coupé au lancement). Le démarrage le
 *                   signale, sans alarme.
 *   `poste_local` — le poste de développement seulement ; posée sur Vercel, elle n'y
 *                   est pas lue — le démarrage le signale.
 *   `plateforme`  — posée par Vercel ou Next, jamais par nous.
 *
 * ⚠️ HORS DE CETTE LISTE, ET DIT : les réglages qui ne sont PAS des variables — le
 *    SMTP de Supabase (e-mails de confirmation d'inscription et de mot de passe
 *    oublié), les adresses de redirection de Supabase, les pays autorisés et le
 *    crédit du compte Vonage, les secrets du Vault. Aucun démarrage ne peut les voir :
 *    docs/mise-en-production.md les nomme, et la panne les dit quand elle les rencontre.
 *
 * Module PUR, sans import : le contrôle l'exécute tel quel.
 */

export type Exigence = 'deploye' | 'optionnelle' | 'poste_local' | 'plateforme'

export type VariableEnvironnement = {
  nom: string
  exigence: Exigence
  /** Ce qu'elle fait, en une phrase. Jamais sa valeur. */
  role: string
  /** Ce qui casse — ou s'éteint — sans elle. */
  siAbsente: string
  /** Une autre variable qui en tient lieu (le code lit `A ?? B`). */
  ouBien?: string
  /** Longueur minimale exigée par le code qui la lit. */
  longueurMin?: number
  /** Valeur exacte exigée (un interrupteur : `'true'`, rien d'autre — §E.9). */
  valeurAttendue?: string
  /**
   * L'HÔTE de cette adresse doit être EXACTEMENT la valeur d'une autre variable (recette staging, 30/09/2026) :
   * l'origine du site est la RACINE de l'environnement, jamais l'adresse d'un écosystème.
   */
  hoteEgalA?: string
}

export const VARIABLES: readonly VariableEnvironnement[] = [
  // ── Supabase ──────────────────────────────────────────────────────────────
  { nom: 'NEXT_PUBLIC_SUPABASE_URL', exigence: 'deploye',
    role: 'adresse du projet Supabase (base, authentification, stockage)',
    siAbsente: 'aucune page ne charge ses données ; aucune inscription, aucune connexion' },
  { nom: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', exigence: 'deploye',
    role: 'clé publique Supabase : session du navigateur, création de compte (signUp, qui déclenche l’e-mail de confirmation)',
    siAbsente: 'aucune connexion, aucune inscription' },
  { nom: 'SUPABASE_SERVICE_ROLE_KEY', exigence: 'deploye',
    role: 'clé de service Supabase : lectures et écritures du serveur, limiteur des SMS, règle d’inscription',
    siAbsente: 'les routes serveur échouent ; la vérification du code SMS est refusée (limiteur_indisponible)' },
  { nom: 'SUPABASE_JWT_SECRET', exigence: 'optionnelle',
    role: 'repli des secrets de jetons (téléphone vérifié, ré-authentification, désabonnement) quand les leurs manquent',
    siAbsente: 'aucun effet si PHONE_OTP_HMAC_SECRET et REAUTH_HMAC_SECRET sont posées' },

  // ── Adresses ──────────────────────────────────────────────────────────────
  { nom: 'NEXT_PUBLIC_DOMAINE_RACINE', exigence: 'deploye',
    role: 'racine des adresses de CET environnement (skilloria.io, staging.skilloria.io) — jamais un nom d’écosystème',
    siAbsente: 'aucune page ne s’affiche : le serveur s’arrête en la nommant (§E.83)' },
  // LA SEULE ADRESSE DU SITE (recette staging, 30/09/2026) : NEXT_PUBLIC_APP_URL, posée sur Vercel avec le même
  // rôle, n'est lue par AUCUNE ligne du code — elle se retire de Vercel. Celle-ci vaut la RACINE en https
  // (https://staging.skilloria.io, https://skilloria.io), jamais l'adresse d'un écosystème : les liens vers un
  // écosystème se construisent depuis son sous-domaine (`expertSiteOrigin`), pas depuis elle.
  { nom: 'NEXT_PUBLIC_SITE_URL', exigence: 'deploye', hoteEgalA: 'NEXT_PUBLIC_DOMAINE_RACINE',
    role: 'origine du site, sur la RACINE : garde des liens d’e-mail en production, retours de paiement, point de réception Stripe',
    siAbsente: 'en production, les e-mails à lien ne partent plus (origine du site inconnaissable)' },
  { nom: 'DEV_DOMAIN_SLUG', exigence: 'poste_local',
    role: 'sous-domaine réglé dans l’admin, désignant l’écosystème servi sur localhost',
    siAbsente: 'sur le poste local, le serveur s’arrête en la nommant ; sur Vercel, elle n’est pas lue' },

  // ── Secrets de l'application ─────────────────────────────────────────────
  { nom: 'CRON_SECRET', exigence: 'deploye',
    role: 'secret des tâches planifiées (égal au secret cron_secret du Vault)',
    siAbsente: 'aucune tâche planifiée n’est acceptée : purges légales, relances, vérifications nocturnes' },
  { nom: 'INSCRIPTION_HMAC_SECRET', exigence: 'deploye', longueurMin: 32,
    role: 'signature de la preuve d’inscription (égal au secret inscription_hmac_secret du Vault, §D.27)',
    siAbsente: 'toute inscription répond « momentanément indisponible » (inscription_indisponible)' },
  { nom: 'PHONE_OTP_HMAC_SECRET', exigence: 'deploye', ouBien: 'SUPABASE_JWT_SECRET', longueurMin: 16,
    role: 'signature du jeton « téléphone vérifié » remis après le code SMS',
    siAbsente: 'le code SMS juste est refusé (jeton_telephone_non_signable) : aucune inscription' },
  { nom: 'REAUTH_HMAC_SECRET', exigence: 'deploye', ouBien: 'SUPABASE_JWT_SECRET', longueurMin: 16,
    role: 'signature de la ré-authentification (paramètres sensibles) et des liens de désabonnement',
    siAbsente: 'changer de téléphone ou d’e-mail et se désabonner échouent' },

  // ── Vonage (SMS de vérification) ─────────────────────────────────────────
  { nom: 'VONAGE_API_KEY', exigence: 'deploye',
    role: 'identifiant du compte Vonage (Verify v2) : le code SMS de l’inscription et du changement de téléphone',
    siAbsente: 'aucun SMS de vérification : aucune inscription (vonage_identifiants_absents)' },
  { nom: 'VONAGE_API_SECRET', exigence: 'deploye',
    role: 'secret du compte Vonage (Verify v2)',
    siAbsente: 'aucun SMS de vérification : aucune inscription (vonage_identifiants_absents)' },
  { nom: 'VONAGE_SMS_FROM', exigence: 'optionnelle',
    role: 'expéditeur du canal SMS de NOTIFICATION — fermé au dispatcher (§D.2)',
    siAbsente: 'aucun effet tant que le canal SMS de notification est fermé' },

  // ── Resend (e-mails transactionnels du produit) ──────────────────────────
  { nom: 'RESEND_API_KEY', exigence: 'deploye',
    role: 'envoi des e-mails du produit : approbations, refus, invitations, notifications, avertissement d’inactivité',
    siAbsente: 'ces e-mails ne partent pas (missing_env dans les journaux) — la confirmation d’inscription, elle, part par Supabase' },
  { nom: 'RESEND_FROM_EMAIL', exigence: 'deploye',
    role: 'adresse d’expédition des e-mails du produit (domaine vérifié chez Resend)',
    siAbsente: 'ces e-mails ne partent pas (missing_env dans les journaux)' },

  // ── IA et mise en relation ───────────────────────────────────────────────
  { nom: 'ANTHROPIC_API_KEY', exigence: 'deploye',
    role: 'modèle d’IA : vérification des experts et des organisations, jugement des candidatures, analyse des CV',
    siAbsente: 'ces fonctions répondent « indisponible » ; les vérifications passent en revue manuelle' },
  { nom: 'COHERE_API_KEY', exigence: 'deploye',
    role: 'moteur de mise en relation (reranking)',
    siAbsente: 'aucune mise en relation, dans aucun écosystème (BLOQUANT en supervision)' },
  { nom: 'ENABLE_RERANKING', exigence: 'deploye', valeurAttendue: 'true',
    role: 'interrupteur du moteur de mise en relation',
    siAbsente: 'aucune mise en relation, dans aucun écosystème (BLOQUANT en supervision)' },
  { nom: 'ENABLE_AI_CV_PARSING', exigence: 'optionnelle', valeurAttendue: 'true',
    role: 'interrupteur de l’analyse des CV',
    siAbsente: 'l’analyse des CV est éteinte (ai_disabled)' },
  { nom: 'ENABLE_AI_CANDIDATURE_ASSESSMENT', exigence: 'optionnelle', valeurAttendue: 'true',
    role: 'interrupteur du jugement d’une candidature au dépôt (§D.19)',
    siAbsente: 'le jugement des candidatures est éteint' },
  { nom: 'SIRENE_API_TOKEN', exigence: 'optionnelle',
    role: 'registre Sirene : vérification des entreprises françaises',
    siAbsente: 'la vérification des entreprises françaises passe en revue manuelle' },

  // ── Paiement (le lancement est gratuit, §D.1) ────────────────────────────
  { nom: 'ENABLE_BILLING', exigence: 'optionnelle', valeurAttendue: 'true',
    role: 'second verrou de l’encaissement (§D.1)',
    siAbsente: 'rien n’encaisse — c’est l’état voulu tant que le lancement est gratuit' },
  { nom: 'STRIPE_SECRET_KEY', exigence: 'optionnelle',
    role: 'clé Stripe, scopée par environnement (test hors production, live en production)',
    siAbsente: 'catalogue et paiement indisponibles — l’état voulu au lancement' },
  { nom: 'STRIPE_WEBHOOK_SECRET', exigence: 'optionnelle',
    role: 'secret du point de réception Stripe (un par environnement)',
    siAbsente: 'les événements Stripe sont refusés' },

  // ── Plateforme ───────────────────────────────────────────────────────────
  { nom: 'VERCEL_ENV', exigence: 'plateforme',
    role: 'environnement Vercel (production, preview, development) — posé par Vercel',
    siAbsente: 'le poste local : aucun environnement déployé' },
  { nom: 'NEXT_RUNTIME', exigence: 'plateforme',
    role: 'moteur d’exécution de Next (nodejs, edge) — posé par Next',
    siAbsente: 'hors d’un serveur Next' },
  { nom: 'VERCEL_GIT_COMMIT_SHA', exigence: 'plateforme',
    role: 'le commit déployé — posé par Vercel ; la supervision dit la version qu’elle a contrôlée',
    siAbsente: 'la version ne se dit pas (poste local, ou variables système de Vercel non exposées)' },
]

export type Manque = {
  nom: string
  exigence: Exigence
  /** Pourquoi elle est signalée. */
  motif: 'absente' | 'trop_courte' | 'valeur_inattendue' | 'posee_hors_du_poste_local' | 'hote_hors_racine'
  role: string
  siAbsente: string
}

/**
 * Ce qui manque à un environnement DÉPLOYÉ. Lit les NOMS et les longueurs, jamais une valeur au-delà de la
 * comparaison. `env` est injectable : le contrôle l'exécute sur un environnement fabriqué.
 */
export function variablesManquantes(env: Record<string, string | undefined>): Manque[] {
  const lue = (nom: string) => (env[nom] ?? '').trim()
  const out: Manque[] = []
  for (const v of VARIABLES) {
    const base = { nom: v.nom, exigence: v.exigence, role: v.role, siAbsente: v.siAbsente }
    if (v.exigence === 'plateforme') continue
    if (v.exigence === 'poste_local') {
      if (lue(v.nom)) out.push({ ...base, motif: 'posee_hors_du_poste_local' })
      continue
    }
    const valeur = lue(v.nom) || (v.ouBien ? lue(v.ouBien) : '')
    if (!valeur) { out.push({ ...base, motif: 'absente' }); continue }
    if (v.longueurMin && valeur.length < v.longueurMin) { out.push({ ...base, motif: 'trop_courte' }); continue }
    if (v.valeurAttendue && valeur !== v.valeurAttendue) { out.push({ ...base, motif: 'valeur_inattendue' }); continue }
    if (v.hoteEgalA) {
      const attendu = lue(v.hoteEgalA).toLowerCase()
      let hote = ''
      try { hote = new URL(valeur).hostname.toLowerCase() } catch { /* malformée : l'hôte vide ne vaut pas la racine */ }
      // Racine absente : c'est ELLE qui manque, et elle est déjà signalée — on ne juge pas contre un vide.
      if (attendu && hote !== attendu) out.push({ ...base, motif: 'hote_hors_racine' })
    }
  }
  return out
}

/**
 * L'ÉTAT DE LA CONFIGURATION, DIT EN PERMANENCE (recette staging, 30/09/2026). La supervision ne disait les
 * variables que lorsqu'il en manquait une : un écran muet ne dit pas « tout est posé », il ne dit rien.
 * Même contrôle que le démarrage (`variablesManquantes`), rejoué à chaque lecture, avec la version et
 * l'environnement contrôlés — jamais une valeur.
 */
export type EtatConfiguration = {
  /** Le nombre de variables EXIGÉES (`deploye`) de la liste. */
  exigees: number
  /** Celles qui manquent (ou sont trop courtes, ou n'ont pas la valeur exigée), par leur NOM. */
  manquantes: string[]
  /** Le commit déployé, raccourci ; `null` hors de Vercel. */
  version: string | null
  environnement: string | null
}
export function etatConfiguration(env: Record<string, string | undefined>, commit: string | undefined): EtatConfiguration {
  const sha = (commit ?? '').trim()
  return {
    exigees: VARIABLES.filter((v) => v.exigence === 'deploye').length,
    manquantes: variablesExigeesManquantes(env).map((m) => m.nom),
    version: sha ? sha.slice(0, 7) : null,
    environnement: (env.VERCEL_ENV ?? '').trim() || null,
  }
}

/** Les manques qui CASSENT une fonction (exigence `deploye`) — ceux que la supervision dit BLOQUANTS. */
export function variablesExigeesManquantes(env: Record<string, string | undefined>): Manque[] {
  return variablesManquantes(env).filter((m) => m.exigence === 'deploye')
}
