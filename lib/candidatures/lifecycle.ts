// lib/candidatures/lifecycle.ts
//
// ÉTAT DE VIE D'UNE CANDIDATURE — DÉRIVÉ À LA LECTURE, CÔTÉ SERVEUR.
//
// Aucune écriture, aucune migration, aucun job : même contrainte que le lot
// expiration des publications (lib/publications/expiry.ts), dont ce module
// RÉUTILISE la règle 30 j (`isActivePublished`) au lieu de la redéfinir.
//
// POURQUOI CE MODULE
//   `candidatures.status` ne dit PAS si une candidature est encore vivante.
//   Une candidature 'unlocked' dont la fenêtre d'échange de 15 j est écoulée
//   affichait toujours « Échange ouvert » : un libellé menteur. Une candidature
//   'received' sur une annonce expirée depuis 30 j affichait toujours
//   « Reçue », comme si l'entreprise allait répondre. Le statut est la
//   MÉCANIQUE ; l'état de vie est le FAIT. On dérive le second du premier.
//
// DEUX BUCKETS, PAS TROIS (décision produit)
//   - active   : la candidature peut encore bouger, ou vient d'aboutir.
//   - archived : plus rien n'en sortira. Reste LISIBLE (aucun historique
//                effacé), simplement rangée.
//   'selected' est ACTIVE : c'est l'issue positive du parcours, elle doit
//   rester sous les yeux.
//
// LE POINT DE VUE DIFFÈRE, PAS L'ÉTAT
//   L'expert voit ses candidatures déposées, l'org voit ses candidats reçus.
//   Ils regardent le MÊME fait objectif : ce module sert les deux côtés à
//   l'identique. Corriger le libellé d'un seul côté créerait une asymétrie où
//   l'entreprise lit « Échange ouvert » sur ce que l'expert voit archivé.
//
// DÉRIVATION SERVEUR UNIQUEMENT (point 20)
//   Le client ne calcule aucun état : il reçoit `{ bucket, reason, until }` et
//   se contente de rendre la raison. Il ne peut pas afficher active ce que le
//   serveur dit archivé.
//
// STATUTS VESTIGIAUX
//   'shortlisted' / 'withdrawn' / 'archived' ne sont jamais ÉCRITS par le
//   produit et ne sont pas retirés du CHECK. Ils sont ici couverts en lecture,
//   pour que d'éventuelles lignes historiques tombent dans un bucket honnête.

import { isActivePublished, effectiveExpiry } from '@/lib/publications/expiry'
import { effectiveConversationExpiry, isConversationExpired } from '@/lib/conversations/expiry'

export type CandidatureBucket = 'active' | 'archived'

/**
 * Raison DÉRIVÉE de l'état. Le libellé affiché en découle intégralement —
 * aucun site de rendu ne doit fabriquer sa propre phrase.
 * Exigence produit : on dit TOUJOURS pourquoi, jamais un « Archivée » nu.
 */
export type CandidatureLifecycleReason =
  // ── bucket 'active' ───────────────────────────────────────────────────
  /** Candidat retenu par l'entreprise. Issue positive, on la garde en vue. */
  | 'selected'
  /** Échange en cours, fenêtre 15 j encore ouverte (`until` = sa fin). */
  | 'exchange_open'
  /** Pas encore débloquée, mais l'annonce est encore ouverte (`until` = sa fin). */
  | 'awaiting_review'
  // ── bucket 'archived' ─────────────────────────────────────────────────
  /** Échange ouvert puis refermé sans sélection : la fenêtre 15 j est passée. */
  | 'exchange_expired'
  /** Jamais débloquée, et l'annonce a atteint ses 30 j. */
  | 'publication_expired'
  /** Jamais débloquée, et l'annonce a été retirée / clôturée par l'org. */
  | 'publication_closed'
  /** Refusée explicitement par l'entreprise. */
  | 'rejected'
  /** Retirée par le candidat (vestigial). */
  | 'withdrawn'
  /** Archivée explicitement (vestigial). */
  | 'archived'

export type CandidatureLifecycle = {
  bucket: CandidatureBucket
  reason: CandidatureLifecycleReason
  /**
   * Fin de la fenêtre encore ouverte (ISO), ou `null` si l'état n'en a pas.
   * C'est le SEUL endroit où l'utilisateur apprend qu'il a 15 j (échange) ou
   * 30 j (annonce) : la date rend la fenêtre visible AVANT qu'elle se ferme.
   */
  until: string | null
}

/** Entrée de dérivation. Tout est optionnel sauf le statut : une donnée
 *  manquante ne doit jamais produire un état inventé (cf. `deriveCandidatureLifecycle`). */
export type CandidatureLifecycleInput = {
  status: string
  unlocked_at?: string | null
  /** Publication portant la candidature. `null` ⇒ introuvable / hors périmètre. */
  publication?: {
    status?: string | null
    published_at?: string | null
    expires_at?: string | null
  } | null
  /** Conversation liée si elle existe (n'existe qu'après unlock). */
  conversation?: { expires_at?: string | null } | null
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null
}

/**
 * Dérive l'état de vie. ORDRE SIGNIFIANT : un état terminal explicite
 * (refus, retrait) prime sur toute fenêtre temporelle ; la sélection prime
 * sur l'expiration de l'annonce ; la fenêtre d'échange prime sur la fenêtre
 * d'annonce une fois le déblocage fait.
 */
export function deriveCandidatureLifecycle(
  input: CandidatureLifecycleInput,
  now: Date = new Date(),
): CandidatureLifecycle {
  const { status } = input

  // (1) États terminaux explicites — décidés par un humain, pas par une horloge.
  if (status === 'rejected') return { bucket: 'archived', reason: 'rejected', until: null }
  if (status === 'withdrawn') return { bucket: 'archived', reason: 'withdrawn', until: null }
  if (status === 'archived') return { bucket: 'archived', reason: 'archived', until: null }

  // (2) Sélection : issue positive, ACTIVE sans limite de temps. L'expiration
  //     de l'annonce n'y change rien — le candidat a été retenu, le fait est
  //     acquis.
  if (status === 'selected') return { bucket: 'active', reason: 'selected', until: null }

  // (3) Déblocage fait : c'est la fenêtre d'ÉCHANGE (15 j) qui gouverne, plus
  //     celle de l'annonce. Une conversation vivante survit à l'expiration de
  //     l'annonce : les deux parties se parlent déjà, l'annonce n'a plus de rôle.
  if (status === 'unlocked') {
    const end = effectiveConversationExpiry({
      conversationExpiresAt: input.conversation?.expires_at ?? null,
      unlockedAt: input.unlocked_at ?? null,
    })
    // Repli défensif : pas de conversation ET pas d'unlocked_at ⇒ fenêtre
    // inconnue. On ne ferme JAMAIS sur une donnée manquante (on n'archive pas
    // par ignorance) : actif, sans date affichée.
    if (!end) return { bucket: 'active', reason: 'exchange_open', until: null }
    if (isConversationExpired(end.toISOString(), now)) {
      return { bucket: 'archived', reason: 'exchange_expired', until: null }
    }
    return { bucket: 'active', reason: 'exchange_open', until: end.toISOString() }
  }

  // (4) Jamais débloquée ('received' | 'in_review' | 'shortlisted' vestigial).
  //     C'EST LE TROU HISTORIQUE : sans fenêtre propre, ces candidatures
  //     vivaient indéfiniment. Depuis le lot expiration, l'annonce porte la
  //     fenêtre — la candidature bascule archivée avec elle.
  const pub = input.publication ?? null
  if (!pub) {
    // Publication introuvable (supprimée / hors scope de lecture) : plus rien
    // ne peut en sortir. Archivée, avec la raison la plus proche du fait.
    return { bucket: 'archived', reason: 'publication_closed', until: null }
  }
  if (isActivePublished(pub, now)) {
    return { bucket: 'active', reason: 'awaiting_review', until: iso(effectiveExpiry(pub)) }
  }
  // Non active : soit l'org l'a retirée (status ≠ 'published'), soit les 30 j
  // sont passés. On distingue — « retirée » et « expirée » ne se valent pas.
  if (pub.status !== 'published') {
    return { bucket: 'archived', reason: 'publication_closed', until: null }
  }
  return { bucket: 'archived', reason: 'publication_expired', until: null }
}

/**
 * Normalise `?filter=` en bucket. ACTIVES PAR DÉFAUT sur les deux menus :
 * une valeur absente ou inconnue retombe sur 'active'. `?filter=all` reste
 * possible pour les appels internes qui doivent tout voir (compteurs de
 * l'onglet Archivées) et renvoie `null` = pas de filtrage.
 */
export function parseBucketFilter(raw: string | null | undefined): CandidatureBucket | null {
  if (raw === 'archived') return 'archived'
  if (raw === 'all') return null
  return 'active'
}
