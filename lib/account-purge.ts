import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'
import { parametresJournal, type ContexteJournal } from '@/lib/journal/contexte'

/**
 * ANONYMISATION RGPD d'un compte — logique PARTAGÉE.
 *
 * Extraite telle quelle de app/api/cron/purge-deletions/route.ts (fonction
 * `purgeOne`, mission S3 §7) SANS changer son comportement, pour être réutilisée
 * par la purge des comptes INACTIFS (règle CNIL : 2 ans max après le dernier
 * contact) sans dupliquer la mécanique d'anonymisation.
 *
 * Pour chaque compte échu (idempotent, échec partiel toléré, JAMAIS de
 * fire-and-forget — tout est awaité) :
 *   1. BLOCAGE LOGIN + LIBÉRATION email : admin.updateUserById → email
 *      placeholder unique (libère l'email d'origine) + ban permanent + mot de
 *      passe aléatoire. (JAMAIS auth.admin.deleteUser : messages.sender_id est
 *      ON DELETE CASCADE → l'historique d'interactions DOIT être préservé.)
 *   2. SUPPRESSION fichiers perso : CV (bucket 'cv') + avatar (bucket 'avatars').
 *   3. ANONYMISATION profil : PII vidées, visible=false.
 *   4. ANONYMISATION user : nom vidé, téléphone libéré, email miroir = placeholder,
 *      status='archived', anonymized_at=now() (posé EN DERNIER → un échec amont
 *      laisse le compte non marqué et il sera repris au prochain run).
 *
 * ⚠️ `status` DOIT être une valeur admise par `users_status_check`
 *    (draft | active | in_review | suspended | rejected | archived).
 *    Cette étape écrivait 'archived'… non : elle écrivait 'deleted', valeur
 *    ABSENTE du CHECK. L'UPDATE violait donc la contrainte et levait à CHAQUE
 *    passage : `anonymized_at` n'était jamais posé, aucune purge n'aboutissait,
 *    et les comptes restaient à MI-CHEMIN — `profiles` anonymisé (étape 3),
 *    mais nom, prénom, e-mail et téléphone conservés dans `users`. Un
 *    manquement RGPD actif, pas un risque théorique.
 *    'archived' porte exactement le sens voulu et figure déjà au CHECK : aucune
 *    migration nécessaire. La valeur 'deleted' n'était lue nulle part.
 *   Les enregistrements d'interaction (candidatures/conversations/messages)
 *   sont PRÉSERVÉS sous forme désormais anonymisée.
 *
 * En cas d'échec BLOQUANT (auth, profil, user), la fonction LÈVE → l'appelant
 * n'incrémente pas le compteur et le compte sera repris au prochain passage
 * (anonymized_at non posé). Les suppressions de fichiers sont best-effort.
 */

const PERMANENT_BAN = '876000h' // ~100 ans

export type PurgeableUser = {
  id: string
  domain_id: string
  email: string | null
}

/**
 * D'OÙ VIENT LA PURGE — OBLIGATOIRE, ET FERMÉ.
 * `account_purged` était identique pour les trois appelants (deux tâches
 * planifiées, un administrateur) : impossible de dire, six mois plus tard, si un
 * compte a été effacé pour inactivité, sur sa demande, ou par un administrateur.
 * Le paramètre est requis SANS défaut : c'est le compilateur qui nomme chaque
 * appelant qui ne le dit pas (§E.68 — une consigne se lit, un type se compile).
 */
export type ContextePurge =
  | { origine: 'tache_planifiee'; job: 'purge_inactive' | 'purge_deletions'; journal: ContexteJournal }
  | { origine: 'administrateur'; journal: ContexteJournal }

/**
 * LE MOTIF DE LA PURGE, DÉRIVÉ DE SON ORIGINE — trois purges SÉPARÉES au grand
 * livre (§D.26) : la suppression DEMANDÉE (art. 17), l'INACTIVITÉ (règle CNIL),
 * le geste d'un ADMINISTRATEUR. La base en dérive le code ; ici, le type fermé
 * rend l'oubli d'un cas impossible à compiler.
 */
function motifDePurge(c: ContextePurge): 'inactivite' | 'demande' | 'admin' {
  if (c.origine === 'administrateur') return 'admin'
  return c.job === 'purge_inactive' ? 'inactivite' : 'demande'
}

export async function purgeAccount(
  admin: SupabaseClient,
  u: PurgeableUser,
  contexte: ContextePurge,
): Promise<void> {
  const uid = u.id
  const placeholderEmail = `deleted+${uid}@deleted.invalid`

  // 1. Bloque le login + libère l'email d'origine (auth = source de vérité).
  //    Si ça échoue, on lève → le compte n'est PAS marqué et sera repris.
  const { error: authErr } = await admin.auth.admin.updateUserById(uid, {
    email: placeholderEmail,
    password: randomUUID() + randomUUID(),
    ban_duration: PERMANENT_BAN,
  })
  if (authErr) {
    throw new Error(`auth_update_failed: ${authErr.message}`)
  }

  // 2. Suppression des fichiers perso (best-effort, ne bloque pas la purge).
  //
  // ⚠️ MAIS LA LECTURE, ELLE, N'EST PAS BEST-EFFORT — ET LE COMMENTAIRE
  //    CI-DESSUS L'A LONGTEMPS LAISSÉ CROIRE (§E.27 forme B).
  //
  //    « best-effort » est vrai de la SUPPRESSION DE FICHIER. Le même `prof`
  //    commande aussi l'étape 3, l'ANONYMISATION DU PROFIL, qui n'a rien de
  //    best-effort : c'est l'obligation légale elle-même. L'erreur n'était pas
  //    récupérée ; `prof` valait `null` ; `if (prof?.id)` était faux ; et
  //    TOUT le bloc d'anonymisation était sauté — résumé, titre, photo, CV,
  //    adresse, code postal, année de naissance, LinkedIn, téléphone, ville,
  //    compétences, langues, certifications RESTAIENT EN BASE. Le fichier de
  //    CV restait dans le Storage.
  //
  //    L'étape 4 s'exécutait quand même, posait `anonymized_at`, et
  //    `logAudit` écrivait `anonymized: true`. LE REGISTRE DÉCLARAIT TENUE UNE
  //    OBLIGATION QUI NE L'ÉTAIT PAS.
  //
  //    ET LE JALON FERMAIT LA PORTE : `anonymized_at` posé, le compte est
  //    « déjà purgé ». Aucun rejeu ne serait jamais revenu. C'est ce qui
  //    distingue cette forme des neuf cas de §E.22 — « réessayer » ne répare
  //    rien quand le jalon d'idempotence est déjà tombé.
  //
  //    On LÈVE, comme l'en-tête de ce fichier le promettait déjà pour les
  //    échecs « auth, profil, user ». `anonymized_at` n'est alors PAS posé, et
  //    le prochain passage reprend le compte — l'idempotence joue enfin dans
  //    le bon sens.
  const { data: prof, error: profLookupErr } = await admin
    .from('profiles')
    .select('id, cv_file_path')
    .eq('user_id', uid)
    .maybeSingle()
  if (profLookupErr) {
    throw new Error(`profile_lookup_failed: ${profLookupErr.message}`)
  }
  // `prof === null` SANS erreur est un fait, pas une panne : tout compte n'a
  // pas de profil (une organisation n'en a aucun). On n'anonymise alors rien,
  // et c'est correct — la distinction est exactement celle que ce lot ferme.
  // CE QUI SUIT EST VRAIMENT BEST-EFFORT — et le registre dira lequel des deux
  // a abouti, plutôt que d'affirmer en bloc. Un fichier resté dans le Storage
  // est un manquement qu'il faut pouvoir CHERCHER, donc TRACER.
  let cvSupprime: boolean | null = null
  if (prof?.cv_file_path) {
    const { error: cvErr } = await admin.storage.from('cv').remove([prof.cv_file_path])
    if (cvErr) console.error('[purge] cv remove failed', { uid, msg: cvErr.message })
    cvSupprime = !cvErr
  }
  const { error: avErr } = await admin.storage.from('avatars').remove([`${uid}/avatar.jpg`])
  if (avErr) console.error('[purge] avatar remove failed', { uid, msg: avErr.message })

  // 3. Anonymisation du profil (PII vidées, invisible).
  if (prof?.id) {
    const { error: profErr } = await admin
      .from('profiles')
      .update({
        visible: false,
        pre_deletion_visible: null,
        summary: null,
        title: null,
        photo_url: null,
        cv_file_path: null,
        cv_url: null,
        cv_hash: null,
        address_line: null,
        postal_code: null,
        birth_year: null,
        linkedin_url: null,
        phone: null,
        city: null,
        location: null,
        skills: [],
        languages: [],
        certifications: [],
      })
      .eq('id', prof.id)
    if (profErr) throw new Error(`profile_anonymize_failed: ${profErr.message}`)
  }

  // 3 bis. LE JOURNAL D'AUDIT SE NETTOIE DU COMPTE — AVANT LE JALON.
  //   `audit_logs.detail` a porté des adresses, un numéro, des noms (mesuré le
  //   24/09/2026 : 4 lignes, 5 comptes). La purge anonymisait `users` et
  //   `profiles` et laissait le journal intact : l'adresse survivait au compte.
  //   La fonction SQL retire les clés personnelles (liste UNIQUE, en base) sur
  //   toute ligne dont ce compte est l'acteur, le sujet, ou dont l'adresse
  //   apparaît dans le détail — d'où `p_email`, connu ici parce que l'étape 4
  //   n'a pas encore eu lieu. On LÈVE si ça échoue : le jalon ne se pose pas
  //   sur un journal encore sale, et le passage suivant reprend le compte.
  const { data: auditNettoyees, error: auditErr } = await admin.rpc('audit_logs_nettoyer_compte', {
    p_user_id: uid,
    p_email: u.email,
  })
  if (auditErr) throw new Error(`audit_scrub_failed: ${auditErr.message}`)

  // 4. Anonymisation du user (anonymized_at posé EN DERNIER → idempotence),
  //    ET LA LIGNE DU GRAND LIVRE, DANS LA MÊME TRANSACTION (§D.26).
  //    `anonymiser_compte()` écrit les mêmes colonnes qu'avant (statut
  //    `archived`, cf. avertissement en tête), pose le jalon, et journalise la
  //    purge sous le code de son MOTIF. Une purge sans trace, ou une trace sans
  //    purge, seraient deux moitiés du même défaut. Le jalon est sa propre
  //    garde : `false` = compte déjà purgé (ou disparu) — rien n'est écrit, et
  //    on LÈVE, comme toute étape bloquante : l'appelant ne compte pas ce compte.
  const { data: anonymise, error: userErr } = await admin.rpc('anonymiser_compte', {
    ...parametresJournal(contexte.journal),
    p_user_id: uid,
    p_email_substitut: placeholderEmail,
    p_motif: motifDePurge(contexte),
    p_profil_anonymise: prof?.id != null,
    p_cv_supprime: cvSupprime,
    p_avatar_supprime: !avErr,
    p_audit_lignes: typeof auditNettoyees === 'number' ? auditNettoyees : null,
  })
  if (userErr) throw new Error(`user_anonymize_failed: ${userErr.message}`)
  if (anonymise !== true) throw new Error('user_anonymize_failed: compte déjà purgé ou introuvable')

  await logAudit({
    supabaseAdmin: admin,
    user_id: uid,
    domain_id: u.domain_id,
    action: 'account_purged',
    entity_type: 'user',
    entity_id: uid,
    // ── LE REGISTRE DIT CE QUI A EU LIEU, PAS CE QU'ON ESPÉRAIT ──────────
    //  `anonymized: true` était écrit inconditionnellement — y compris quand
    //  le profil entier avait été sauté par une lecture en panne. Un registre
    //  qui affirme une obligation tenue est PIRE qu'un registre muet : il
    //  arrête la recherche.
    //  `profil_anonymise: false` est un FAIT légitime (une organisation n'a pas
    //  de profil) ; il ne se confond plus avec une panne, puisque la panne lève.
    detail: {
      // D'OÙ VIENT LA PURGE — la même ligne servait aux trois appelants, et rien
      // ne les distinguait. `job` est nul pour un administrateur, qui écrit sa
      // propre ligne `admin_account_purged` (l'auteur) en plus de celle-ci (le fait).
      origine: contexte.origine,
      job: contexte.origine === 'tache_planifiee' ? contexte.job : null,
      anonymized: true,
      audit_lignes_nettoyees: typeof auditNettoyees === 'number' ? auditNettoyees : null,
      profil_anonymise: prof?.id != null,
      cv_supprime: cvSupprime,
      avatar_supprime: !avErr,
    },
  })
}
