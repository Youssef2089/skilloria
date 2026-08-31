'use client'

import { useCandidatureFacetLabels } from '@/lib/candidatures/use-facet-label'
import type { LifecycleViewpoint } from '@/lib/candidatures/use-lifecycle-label'
import type { CandidatureBucket } from '@/lib/candidatures/lifecycle'
import {
  FACETS_BY_BUCKET,
  isVestigialFacet,
  type CandidatureFacet,
  type CandidatureFacetCounts,
} from '@/lib/candidatures/facets'
import { useTranslations } from 'next-intl'

/**
 * CandidatureFilterChips — filtres des DEUX listes de candidatures.
 *
 * UN SEUL MÉCANISME, DEUX ÉCRANS. Les chips Actives/Archivées existaient déjà,
 * dupliquées à l'identique dans CandidaturesTrackingView (expert) et dans la
 * page candidatures de l'organisation. Ajouter les facettes des deux côtés
 * aurait fait deux copies de plus. Elles vivent ici, et les deux écrans
 * gardent leur vocabulaire via `viewpoint`.
 *
 * DEUX NIVEAUX, PAS DEUX MÉCANISMES
 *   Ligne 1 : le bucket (Actives / Archivées) — ce qui peut encore bouger vs
 *   ce dont plus rien ne sortira.
 *   Ligne 2 : la facette DANS ce bucket — « Toutes » puis les états réels.
 *   Changer de bucket remet la facette à « Toutes » : une facette archivée
 *   n'a aucun sens sous l'onglet Actives, et l'inverse non plus.
 *
 * TOUT EST SERVI, RIEN N'EST CALCULÉ ICI. Les nombres viennent du serveur, sur
 * le même tableau que la liste. Pendant un chargement on affiche le libellé
 * SANS nombre plutôt qu'un « (0) » qui serait faux.
 *
 * ACCESSIBILITÉ : de vrais `<button>` avec `aria-pressed`. Une chip à zéro
 * reste ACTIVABLE — c'est le seul moyen pour l'utilisateur de vérifier qu'il
 * n'a effectivement rien dans cet état.
 */

export type CandidatureFilterValue = {
  bucket: CandidatureBucket
  facet: CandidatureFacet | null
}

type Props = {
  viewpoint: LifecycleViewpoint
  value: CandidatureFilterValue
  /** Compteurs de buckets servis par le serveur. `null` = pas encore connus. */
  counts: { active: number; archived: number } | null
  /** Compteurs de facettes servis par le serveur. `null` = pas encore connus. */
  facets: CandidatureFacetCounts | null
  onChange: (next: CandidatureFilterValue) => void
}

const chipStyle = (on: boolean): React.CSSProperties => ({
  fontSize: 12.5,
  fontWeight: 600,
  padding: '6px 13px',
  borderRadius: 999,
  color: on ? 'var(--sk-accent-ink)' : 'var(--sk-muted)',
  background: on ? 'var(--sk-accent-soft)' : 'var(--sk-surface)',
  border: on ? '1px solid transparent' : '1px solid var(--sk-border)',
  cursor: 'pointer',
  fontFamily: 'inherit',
})

export default function CandidatureFilterChips({ viewpoint, value, counts, facets, onChange }: Props) {
  const tLifecycle = useTranslations('candidature_lifecycle')
  const { label, allLabel } = useCandidatureFacetLabels(viewpoint)

  const buckets: Array<{ key: CandidatureBucket; label: string }> = [
    {
      key: 'active',
      label: counts
        ? tLifecycle('filters.active_count', { count: counts.active })
        : tLifecycle('filters.active'),
    },
    {
      key: 'archived',
      label: counts
        ? tLifecycle('filters.archived_count', { count: counts.archived })
        : tLifecycle('filters.archived'),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      <div role="group" aria-label={tLifecycle('filters.bucket_group')} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {buckets.map((b) => {
          const on = value.bucket === b.key
          return (
            <button
              key={b.key}
              type="button"
              aria-pressed={on}
              // Changer de bucket réinitialise la facette (cf. en-tête).
              onClick={() => onChange({ bucket: b.key, facet: null })}
              style={chipStyle(on)}
            >
              {b.label}
            </button>
          )
        })}
      </div>

      <div role="group" aria-label={tLifecycle('filters.facet_group')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          aria-pressed={value.facet === null}
          onClick={() => onChange({ bucket: value.bucket, facet: null })}
          style={{ ...chipStyle(value.facet === null), fontSize: 12, padding: '5px 11px' }}
        >
          {allLabel}
        </button>
        {FACETS_BY_BUCKET[value.bucket].map((f) => {
          const on = value.facet === f
          // Facette vestigiale : chip affichée seulement si elle compte
          // quelque chose, ou si c'est le filtre courant (sinon on ne pourrait
          // plus en sortir). Une chip permanente à zéro est un compteur mort.
          if (isVestigialFacet(f) && !on && (facets?.[f] ?? 0) === 0) return null
          return (
            <button
              key={f}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ bucket: value.bucket, facet: f })}
              style={{ ...chipStyle(on), fontSize: 12, padding: '5px 11px' }}
            >
              {facets ? `${label(f)} (${facets[f]})` : label(f)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
