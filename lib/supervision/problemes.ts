/**
 * CE QUI NE VA PAS SE VOIT — ET C'EST UNE RÈGLE MÉTIER, PAS UNE COULEUR.
 *
 * ┌─ LE DÉFAUT QU'ON FERME ─────────────────────────────────────────────────┐
 * │ L'écran de supervision peignait en ROUGE des paragraphes qui EXPLIQUENT  │
 * │ un fonctionnement normal. Le rouge y était si banal qu'on apprenait à     │
 * │ l'ignorer — et le jour du vrai dépassement, personne ne le verrait.       │
 * │                                                                          │
 * │ À l'inverse, SIX mises en relation JAMAIS TENTÉES depuis le 04/06        │
 * │ s'affichaient dans le même gris que quatre « tout va bien ». Le           │
 * │ propriétaire du produit est passé devant sans les voir.                  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ POURQUOI CETTE DÉCISION VIT AU SERVEUR ══════════════════════════════
 *   « Est-ce grave ? » est une question métier. Écrite dans le JSX, elle se
 *   réécrit à chaque refonte d'écran, elle diverge entre deux surfaces, et
 *   surtout elle ne s'éprouve qu'en ouvrant un navigateur. Ici, elle est une
 *   fonction PURE : on lui donne des lectures, elle rend des problèmes classés.
 *
 * ═══ TROIS NIVEAUX, ET LE TROISIÈME EST LE PLUS IMPORTANT ════════════════
 *   `bloquant`  — quelque chose NE SE FAIT PAS. Une annonce sans candidats,
 *                 une dépense arrêtée net. Il faut agir.
 *   `attention` — quelque chose s'est mal passé et a été rattrapé, ou approche
 *                 d'une limite. Il faut regarder.
 *   RIEN        — le cas normal ne produit AUCUNE ligne. Un écran qui signale
 *                 le fonctionnement normal enseigne à ignorer ses signaux.
 *
 * ═══ « INDISPONIBLE » N'EST PAS « RIEN À SIGNALER » (§E.22) ══════════════
 *   Une lecture en panne rend `null`. On ne la traite PAS comme « aucun
 *   problème » : on pose un problème de niveau `attention` qui dit qu'on n'a
 *   pas pu regarder. Confondre les deux, c'est exactement le défaut que le
 *   lot 1.3 a passé son temps à fermer.
 */

export type Gravite = 'bloquant' | 'attention'

export type Probleme = {
  /** Clé i18n, sans texte : aucune phrase n'est écrite ici (règle projet). */
  cle: string
  gravite: Gravite
  /** Ce qu'il faut compter dans la phrase. `null` quand il n'y a rien à compter. */
  compte: number | null
  /** Depuis quand, si la lecture le sait. */
  depuis: string | null
  /** Le sujet à ouvrir pour voir le détail. `null` = rien à ouvrir. */
  sujet: string | null
  /**
   * Un écran du back-office à ouvrir, quand le détail ne vit PAS sous
   * `/admin/supervision/[sujet]`.
   *
   * Ajouté pour le raccordement Stripe, dont le détail est un écran à part
   * entière (`/admin/facturation`). L'alternative aurait été de créer un sujet
   * de supervision qui ne fait que rediriger — un écran fantôme de plus, et
   * §M1 ⑩ en recense déjà un.
   *
   * ⚠️ `sujet` et `lien` ne se cumulent pas : un problème ouvre UN endroit.
   *    Deux liens sur la même ligne obligeraient à choisir sans savoir.
   */
  lien?: string | null
}

/**
 * LE MOTEUR DE MISE EN RELATION EST-IL SEULEMENT ALLUMÉ ?
 *
 * ┌─ LE DÉFAUT QU'ON FERME, ET IL EST LE PLUS GRAVE DE CET ÉCRAN ───────────┐
 * │ Mesuré le 21/09/2026 : `ENABLE_RERANKING` et `COHERE_API_KEY` étaient   │
 * │ absents. Le moteur s'arrêtait proprement, en quelques millisecondes, et │
 * │ écrivait sa raison dans une note de journal que PERSONNE ne lit.        │
 * │                                                                         │
 * │ Conséquence exacte : AUCUN expert, AUCUNE organisation, dans AUCUN      │
 * │ écosystème, ne recevait quoi que ce soit — et chaque écran l'annonçait  │
 * │ comme un résultat : « aucune mission ne correspond à votre profil ».    │
 * │                                                                         │
 * │ Tous les autres signaux de cet écran restaient VERTS : zéro panne, zéro │
 * │ lot en échec, zéro dépassement — parce que rien n'était tenté. Un       │
 * │ moteur éteint ne produit aucune erreur ; c'est ce qui le rend invisible.│
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ AUCUNE VALEUR NEUTRE. Ce type n'a pas de troisième état « on ne sait
 *    pas » : la lecture est celle de deux variables d'environnement au
 *    serveur, elle ne peut pas échouer. Lui donner un repli inventerait un
 *    doute là où il n'y en a aucun (§E.27).
 */
export type EtatDuMoteur = {
  /** `ENABLE_RERANKING` vaut exactement `'true'` (cf. lib/interrupteurs.ts). */
  interrupteurOuvert: boolean
  /** `COHERE_API_KEY` est présente et non vide. */
  clePresente: boolean
}

export type SourcesSupervision = {
  /** L'interrupteur et la clé du moteur — lus au serveur, jamais devinés. */
  moteur: EtatDuMoteur
  inacheves: Array<{ etat: string; publications: number; plus_ancien: string | null }> | null
  couverture: Array<{ experts_non_notes: number; lots_rerank_en_echec: number }> | null
  pannes: Array<{ cause: string; surface: string; pannes: number; derniere: string | null }> | null
  relances: Array<{ origine: string; depassements: number; experts: number }> | null
  depense: Array<{ provider: string; part_consommee: number | null; au_plafond: boolean }> | null
  /**
   * LES ACTEURS À LEUR PROPRE PLAFOND.
   *
   * ┌─ POURQUOI ÇA REMONTE, ET POURQUOI EN ATTENTION ──────────────────────┐
   * │ Une organisation au plafond PUBLIE QUAND MÊME — elle a payé — mais    │
   * │ son annonce n'est plus classée. Rien ne casse, rien n'échoue, aucune  │
   * │ erreur n'est écrite : l'annonce sort et reste sans candidats.         │
   * │ Personne ne se plaindra, parce que personne ne sait qu'il manque      │
   * │ quelque chose.                                                        │
   * │                                                                        │
   * │ ATTENTION ET NON BLOQUANT, et c'est un arbitrage : un acteur au       │
   * │ plafond est le fonctionnement NORMAL d'une règle qu'on a posée. En    │
   * │ faire un bloquant le ferait sonner chaque fin de mois, et un signal   │
   * │ bloquant qu'on voit tous les mois apprend à être ignoré (§E.52) —     │
   * │ y compris les fois où il compte.                                      │
   * │                                                                        │
   * │ ET IL S'ÉTEINT PAR UNE ACTION : relever le plafond de cet acteur, ou  │
   * │ regarder ce qu'il consomme. Le lien mène à l'écran qui fait les deux. │
   * └────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠️ `null` = lecture en panne. PAS zéro : « aucun acteur au plafond » et
   *    « je ne sais pas » ne sont pas le même fait (§E.22).
   */
  acteursAuPlafond: { organisations: number; experts: number } | null
  distribution: Array<{ runs_observes: number }> | null
  /** Horodatage du tarif le plus anciennement modifié. */
  tarifPlusAncien: string | null
  /** Le verdict de la dernière vérification nocturne du raccordement Stripe. */
  verificationStripe: VerificationStripe
  /**
   * Événements Stripe réclamés et jamais clôturés. `null` = lecture en panne —
   * et surtout PAS `0`, qui dirait « aucun événement perdu » au moment précis
   * où l'on ne sait plus rien (§E.22).
   */
  evenementsStripeCoinces: number | null
  /**
   * LE CATALOGUE EST-IL RELIÉ, DANS LE MODE DE LA CLÉ EN USAGE.
   *
   * ┌─ POURQUOI ÇA REMONTE EN SUPERVISION, ET EN BLOQUANT ─────────────────┐
   * │ Un lien manquant ne se découvre PAS au premier paiement : à cet       │
   * │ instant l'argent est encaissé chez Stripe et l'application ne sait     │
   * │ pas à quelle offre le rattacher. C'est le seul défaut de ce socle qui │
   * │ se paie en argent réel ET qui est invisible jusque-là.                │
   * │                                                                        │
   * │ Le passage en production est exactement le moment où on l'oublie :    │
   * │ le catalogue est relié depuis des mois... en TEST.                    │
   * └──────────────────────────────────────────────────────────────────────┘
   *
   * `null` = on n'a pas pu savoir (clé absente ou lecture en panne), et c'est
   * un problème d'ATTENTION, jamais un « tout va bien » : zéro offre à relier
   * et « je ne sais pas » ne sont pas le même fait (§E.22).
   */
  offresPayantesNonReliees: number | null

  /**
   * LES DÉPÔTS DE CANDIDATURE QUI N'ONT PAS ABOUTI.
   *
   * ┌─ POURQUOI CELUI-CI EST BLOQUANT, ET POURQUOI IL EST LE PLUS SILENCIEUX ┐
   * │ Depuis le 23/09/2026, un jugement qui échoue n'écrit AUCUNE            │
   * │ candidature (§D.19). L'expert lit « votre candidature a été envoyée » — │
   * │ par décision : il ne paie pas une panne qui ne le concerne pas.         │
   * │ L'organisation, elle, ne sait même pas qu'elle devait recevoir          │
   * │ quelque chose.                                                          │
   * │                                                                         │
   * │ PERSONNE NE SE PLAINDRA. C'est exactement ce qui rend ce signal         │
   * │ obligatoire : il est la seule contrepartie du silence consenti côté     │
   * │ expert. Sans lui, la décision deviendrait une perte muette.             │
   * └─────────────────────────────────────────────────────────────────────────┘
   *
   * `null` = la lecture a échoué. Jamais `0` : « aucun dépôt perdu » est
   * rassurant, « je n'ai pas pu compter » ne l'est pas (§E.22).
   */
  depotsEnSouffrance: number | null
}

/**
 * TROIS ÉTATS, ET LE DEUXIÈME EST CELUI QU'ON OUBLIE.
 *
 * Même vocabulaire que `etatRepartition` — et pour la même raison exactement :
 * « la vérification n'a jamais tourné » et « je n'ai pas pu lire son historique »
 * ont la même forme en base (aucune ligne) et appellent des actions opposées.
 * Accuser une panne quand il n'y a rien à lire envoie chercher un défaut qui
 * n'existe pas, et use le signal pour le jour où il dira vrai.
 */
export type VerificationStripe =
  /** La lecture de l'historique a échoué. On ne sait pas. C'est un PROBLÈME. */
  | { etat: 'indisponible' }
  /** La lecture a réussi : la vérification n'a jamais tourné. C'est un ÉTAT. */
  | { etat: 'jamais_tentee' }
  /** On a un verdict. `manquants` n'existe que si la nuit a pu comparer. */
  | {
      etat: 'disponible'
      nuit: 'compare' | 'impossible'
      manquants: number | null
      ranAt: string
    }

/**
 * AU-DELÀ, LA FENÊTRE DE RATTRAPAGE DE STRIPE EST FERMÉE.
 *
 * Ce n'est pas un choix : l'API Events conserve 30 jours. Une vérification qui
 * ne tourne plus depuis un mois ne peut plus rien retrouver — le trou, s'il y
 * en a un, est devenu définitif. On prévient bien avant : trois jours, la durée
 * pendant laquelle Stripe réessaie encore de livrer.
 */
const JOURS_VERIFICATION_MUETTE = 3

/** Au-delà, une grille tarifaire n'a plus de valeur probante — cf. /admin/tarifs-ia. */
const JOURS_TARIF_PERIME = 90
/** Part du plafond à partir de laquelle on prévient avant qu'il ne bloque. */
const PART_PROCHE_DU_PLAFOND = 0.8

const nombre = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function classerProblemes(s: SourcesSupervision): Probleme[] {
  const out: Probleme[] = []

  // ── 0. LE MOTEUR EST-IL ALLUMÉ ? ────────────────────────────────────────
  //
  //  EN PREMIER, PARCE QUE ÇA REND TOUT LE RESTE FAUX. Moteur éteint, les
  //  compteurs de pannes, de lots en échec et de dépassements tombent tous à
  //  zéro — non pas parce que tout va bien, mais parce que RIEN N'EST TENTÉ.
  //  Un écran qui afficherait ces zéros sans dire ça se lit « tout va bien »
  //  au moment précis où la fonction centrale du produit est arrêtée.
  //
  //  Les deux causes sont SÉPARÉES, et c'est délibéré : les confondre enverrait
  //  chercher une clé absente alors que c'est l'interrupteur qui est fermé, et
  //  inversement. Deux actions différentes méritent deux phrases (§E.29).
  if (!s.moteur.interrupteurOuvert) {
    out.push({ cle: 'moteur_interrupteur_ferme', gravite: 'bloquant', compte: null, depuis: null, sujet: null })
  }
  if (!s.moteur.clePresente) {
    out.push({ cle: 'moteur_cle_absente', gravite: 'bloquant', compte: null, depuis: null, sujet: null })
  }

  // ── 0 bis. LE CATALOGUE NON RELIÉ — ça se paie en argent réel ──────────
  //  Une offre payante sans prix Stripe dans le mode courant : le premier
  //  abonnement sortira « hors catalogue ». BLOQUANT, et le détail vit dans
  //  /admin/facturation — d'où `lien` plutôt qu'un sujet de supervision qui
  //  ne ferait que rediriger.
  if (s.offresPayantesNonReliees === null) {
    out.push({
      cle: 'catalogue_etat_inconnu',
      gravite: 'attention',
      compte: null,
      depuis: null,
      sujet: null,
      lien: '/admin/facturation',
    })
  } else if (s.offresPayantesNonReliees > 0) {
    out.push({
      cle: 'catalogue_non_relie',
      gravite: 'bloquant',
      compte: s.offresPayantesNonReliees,
      depuis: null,
      sujet: null,
      lien: '/admin/facturation',
    })
  }

  // ── 0 ter. LES DÉPÔTS DE CANDIDATURE PERDUS ────────────────────────────
  //  BLOQUANT tant que l'écran n'est pas vide : chaque ligne est un dossier
  //  qu'un expert croit avoir envoyé et qu'une organisation n'a jamais reçu.
  //  Et il est EXTINGUIBLE — le bouton RELANCER de l'écran le fait descendre
  //  (§E.52 : un signal bloquant qu'aucune action ne peut éteindre apprend à
  //  être ignoré).
  if (s.depotsEnSouffrance === null) {
    out.push({
      cle: 'lecture_indisponible_depots',
      gravite: 'attention',
      compte: null,
      depuis: null,
      sujet: null,
      lien: '/admin/depots-en-echec',
    })
  } else if (s.depotsEnSouffrance > 0) {
    out.push({
      cle: 'depots_candidature_perdus',
      gravite: 'bloquant',
      compte: s.depotsEnSouffrance,
      depuis: null,
      sujet: null,
      lien: '/admin/depots-en-echec',
    })
  }

  // ── 1. LES MISES EN RELATION QUI NE SE FERONT PAS ──────────────────────
  //  `en_cours` n'est PAS un problème : le rattrapage les reprendra. Les
  //  additionner aux deux autres ferait un total qui n'appelle aucune action
  //  — précisément ce que la fonction en base refuse déjà de faire.
  if (s.inacheves === null) {
    out.push({ cle: 'lecture_indisponible_inacheves', gravite: 'attention', compte: null, depuis: null, sujet: null })
  } else {
    for (const l of s.inacheves) {
      if (l.etat === 'jamais_tente' && nombre(l.publications) > 0) {
        // Publiée et jamais tentée : ce n'est pas un retard, c'est un pilote
        // en panne. Côté expert comme côté organisation, l'écran est vide et
        // rien ne l'explique.
        out.push({
          cle: 'annonces_jamais_tentees',
          gravite: 'bloquant',
          compte: nombre(l.publications),
          depuis: l.plus_ancien,
          sujet: 'inacheves',
        })
      }
      if (l.etat === 'abandonne' && nombre(l.publications) > 0) {
        out.push({
          cle: 'annonces_abandonnees',
          gravite: 'bloquant',
          compte: nombre(l.publications),
          depuis: l.plus_ancien,
          sujet: 'inacheves',
        })
      }
    }
  }

  // ── 2 bis. LES ACTEURS À LEUR PROPRE PLAFOND ───────────────────────────
  if (s.acteursAuPlafond === null) {
    out.push({
      cle: 'lecture_indisponible_acteurs_plafond',
      gravite: 'attention',
      compte: null,
      depuis: null,
      sujet: null,
      lien: '/admin/consommation',
    })
  } else {
    if (s.acteursAuPlafond.organisations > 0) {
      out.push({
        cle: 'organisations_au_plafond_ia',
        gravite: 'attention',
        compte: s.acteursAuPlafond.organisations,
        depuis: null,
        sujet: null,
        lien: '/admin/consommation',
      })
    }
    if (s.acteursAuPlafond.experts > 0) {
      out.push({
        cle: 'experts_au_plafond_ia',
        gravite: 'attention',
        compte: s.acteursAuPlafond.experts,
        depuis: null,
        sujet: null,
        lien: '/admin/consommation',
      })
    }
  }

  // ── 2. LA DÉPENSE ──────────────────────────────────────────────────────
  if (s.depense === null) {
    out.push({ cle: 'lecture_indisponible_depense', gravite: 'attention', compte: null, depuis: null, sujet: null })
  } else {
    for (const d of s.depense) {
      if (d.au_plafond === true) {
        // Au plafond, l'IA ne part plus. Ce n'est pas un avertissement : une
        // fonctionnalité du produit est arrêtée.
        out.push({ cle: `plafond_atteint_${d.provider}`, gravite: 'bloquant', compte: null, depuis: null, sujet: 'depense' })
      } else if (d.part_consommee !== null && nombre(d.part_consommee) >= PART_PROCHE_DU_PLAFOND) {
        out.push({
          cle: `plafond_proche_${d.provider}`,
          gravite: 'attention',
          compte: Math.round(nombre(d.part_consommee) * 100),
          depuis: null,
          sujet: 'depense',
        })
      }
    }
  }

  // ── 3. CE QUI A ÉCHOUÉ MAIS N'ARRÊTE RIEN ──────────────────────────────
  const totalPannes = s.pannes === null ? null : s.pannes.reduce((n, p) => n + nombre(p.pannes), 0)
  if (totalPannes === null) {
    out.push({ cle: 'lecture_indisponible_pannes', gravite: 'attention', compte: null, depuis: null, sujet: null })
  } else if (totalPannes > 0) {
    const derniere = s.pannes!.reduce<string | null>(
      (a, p) => (p.derniere && (a === null || p.derniere > a) ? p.derniere : a),
      null,
    )
    out.push({ cle: 'resumes_non_produits', gravite: 'attention', compte: totalPannes, depuis: derniere, sujet: 'resumes' })
  }

  const totalRelances =
    s.relances === null ? null : s.relances.reduce((n, r) => n + nombre(r.depassements), 0)
  if (totalRelances !== null && totalRelances > 0) {
    out.push({ cle: 'plafond_relance_depasse', gravite: 'attention', compte: totalRelances, depuis: null, sujet: 'relances' })
  }

  // ── 4. LA COUVERTURE — des experts écartés sans avoir été notés ────────
  if (s.couverture !== null) {
    const nonNotes = s.couverture.reduce((n, c) => n + nombre(c.experts_non_notes), 0)
    const lotsRates = s.couverture.reduce((n, c) => n + nombre(c.lots_rerank_en_echec), 0)
    if (nonNotes > 0) {
      out.push({ cle: 'experts_non_notes', gravite: 'attention', compte: nonNotes, depuis: null, sujet: 'couverture' })
    }
    if (lotsRates > 0) {
      out.push({ cle: 'lots_en_echec', gravite: 'attention', compte: lotsRates, depuis: null, sujet: 'couverture' })
    }
  }

  // ── 5. LA GRILLE TARIFAIRE ─────────────────────────────────────────────
  //  Le compteur de dépense est reconstitué depuis ces prix. Une grille qu'on
  //  n'a pas revue depuis des mois rend TOUS les chiffres de cet écran
  //  douteux — c'est donc un problème de l'écran, pas seulement du sien.
  if (s.tarifPlusAncien !== null) {
    const jours = Math.floor((Date.now() - Date.parse(s.tarifPlusAncien)) / 86_400_000)
    if (Number.isFinite(jours) && jours >= JOURS_TARIF_PERIME) {
      out.push({ cle: 'tarifs_non_verifies', gravite: 'attention', compte: jours, depuis: s.tarifPlusAncien, sujet: 'tarifs' })
    }
  }

  // ── 6. LE RACCORDEMENT STRIPE ──────────────────────────────────────────
  //  Ce bloc ne lit PAS Stripe : il lit le VERDICT de la nuit. Interroger
  //  Stripe ici ferait de cet écran un second consommateur de la même lecture
  //  que `/admin/facturation` — deux surfaces qui tomberaient ensemble sur la
  //  même panne, et l'une dirait « rien à signaler » pendant que l'autre dirait
  //  « je ne sais pas » (§E.36). La comparaison vivante vit là-bas, une fois.
  const LIEN_FACTURATION = '/admin/facturation'

  if (s.evenementsStripeCoinces === null) {
    out.push({
      cle: 'lecture_indisponible_facturation',
      gravite: 'attention',
      compte: null,
      depuis: null,
      sujet: null,
      lien: LIEN_FACTURATION,
    })
  } else if (s.evenementsStripeCoinces > 0) {
    // Réclamé et jamais clôturé : la garde d'idempotence refuse tous les
    // réessais de Stripe, DÉFINITIVEMENT. Ce n'est pas un retard, c'est un
    // paiement dont l'effet ne sera jamais appliqué sans intervention.
    out.push({
      cle: 'evenements_stripe_coinces',
      gravite: 'bloquant',
      compte: s.evenementsStripeCoinces,
      depuis: null,
      sujet: null,
      lien: LIEN_FACTURATION,
    })
  }

  if (s.verificationStripe.etat === 'indisponible') {
    out.push({
      cle: 'verification_stripe_indisponible',
      gravite: 'attention',
      compte: null,
      depuis: null,
      sujet: null,
      lien: LIEN_FACTURATION,
    })
  } else if (s.verificationStripe.etat === 'jamais_tentee') {
    out.push({
      cle: 'verification_stripe_jamais',
      gravite: 'attention',
      compte: null,
      depuis: null,
      sujet: null,
      lien: LIEN_FACTURATION,
    })
  } else {
    const v = s.verificationStripe
    if (v.nuit === 'impossible') {
      out.push({
        cle: 'verification_stripe_impossible',
        gravite: 'attention',
        compte: null,
        depuis: v.ranAt,
        sujet: null,
        lien: LIEN_FACTURATION,
      })
    } else if ((v.manquants ?? 0) > 0) {
      // LE SIGNAL QUE CETTE TÂCHE EXISTE POUR PRODUIRE. Un événement produit
      // par Stripe et jamais reçu, c'est soit une livraison perdue, soit un
      // défaut de traitement : dans les deux cas quelque chose NE SE FAIT PAS.
      out.push({
        cle: 'evenements_stripe_manques',
        gravite: 'bloquant',
        compte: v.manquants ?? 0,
        depuis: v.ranAt,
        sujet: null,
        lien: LIEN_FACTURATION,
      })
    }
    const jours = Math.floor((Date.now() - Date.parse(v.ranAt)) / 86_400_000)
    if (Number.isFinite(jours) && jours > JOURS_VERIFICATION_MUETTE) {
      out.push({
        cle: 'verification_stripe_muette',
        gravite: 'attention',
        compte: jours,
        depuis: v.ranAt,
        sujet: null,
        lien: LIEN_FACTURATION,
      })
    }
  }

  // ── L'ORDRE EST LE SIEN, PAS CELUI DE L'ÉCRAN ──────────────────────────
  //  Bloquant d'abord, puis le plus gros compte. Laisser l'écran trier, c'est
  //  accepter que deux surfaces trient différemment.
  const rang = (p: Probleme) => (p.gravite === 'bloquant' ? 0 : 1)
  return out.sort((a, b) => rang(a) - rang(b) || (b.compte ?? 0) - (a.compte ?? 0))
}

/**
 * LE CAS NORMAL N'EST PAS « AUCUNE DONNÉE ».
 *
 * Tant qu'aucun run n'a tourné depuis la bascule d'échelle, la répartition est
 * VIDE — et ce n'est ni une panne ni un reproche à celui qui règle. L'écran doit
 * dire « aucune exécution pour l'instant », pas afficher un graphique plat.
 */
export function repartitionDisponible(distribution: SourcesSupervision['distribution']): boolean {
  if (distribution === null || distribution.length === 0) return false
  return nombre(distribution[0]?.runs_observes) > 0
}
