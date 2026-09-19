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
}

export type SourcesSupervision = {
  inacheves: Array<{ etat: string; publications: number; plus_ancien: string | null }> | null
  couverture: Array<{ experts_non_notes: number; lots_rerank_en_echec: number }> | null
  pannes: Array<{ cause: string; surface: string; pannes: number; derniere: string | null }> | null
  relances: Array<{ origine: string; depassements: number; experts: number }> | null
  depense: Array<{ provider: string; part_consommee: number | null; au_plafond: boolean }> | null
  distribution: Array<{ runs_observes: number }> | null
  /** Horodatage du tarif le plus anciennement modifié. */
  tarifPlusAncien: string | null
}

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
