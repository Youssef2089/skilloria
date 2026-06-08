'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'
import { setExpertListening, type ExpertSide } from '@/lib/availability-actions'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * DndEmptyState — bloc rouge affiché quand l'expert est en "Ne pas déranger"
 * et qu'aucune mission/offre ne peut donc lui être proposée (Lot A).
 *
 * Réutilisé par les 4 surfaces de feed expert :
 *   - Home Suggestions freelance + CDI
 *   - Page Offres freelance + CDI
 *
 * Le bouton "Repasser À l'écoute" rebascule directement
 * `profiles.availability_status` (freelance) ou `profiles.cdi_status` (CDI)
 * via le helper partagé [setExpertListening](../../lib/availability-actions.ts).
 * Ce helper dispatche aussi `skilloria:notif-bump` → les `useLiveResource`
 * actifs (dont /api/me/missions sur la même page) revalident immédiatement
 * et l'empty-state rouge cède la place à la liste de missions, SANS reload.
 *
 * i18n : namespace `expert_dnd_empty` (FR/EN/ES/DE).
 *
 * Garde-fou : ne s'affiche QUE si l'utilisateur est connecté + verified
 * (responsabilité de la page appelante — ce composant ne fetche rien).
 */

type Props = {
  side: ExpertSide
  /**
   * users.id de l'expert connecté. Optionnel : si absent, le composant le
   * récupère lui-même via `supabase.auth.getSession()` au moment du clic.
   * Pratique pour les pages qui ne fetchent pas déjà la session (page Offres).
   */
  userId?: string
}

export default function DndEmptyState({ side, userId }: Props) {
  const t = useTranslations('expert_dnd_empty')
  const secureFetch = useSecureFetch()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleResume = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    let effectiveUserId = userId
    if (!effectiveUserId) {
      // Fallback : récupère la session si la page parente ne nous l'a pas
      // passée (cas /dashboard/{freelance|cdi}/missions qui n'a pas
      // d'état user local).
      const { data: { session } } = await supabase.auth.getSession()
      effectiveUserId = session?.user?.id
      if (!effectiveUserId) {
        setError(t('error_generic'))
        setBusy(false)
        return
      }
    }
    const res = await setExpertListening(supabase, side, effectiveUserId, true)
    if (!res.ok) {
      setError(t('error_generic'))
      setBusy(false)
      return
    }
    // Sortie du DND → ré-entrée pool : ping /api/me/sync-matching pour
    // réconcilier les matches côté serveur. Fire-and-forget : le serveur
    // accuse réception et le matching IA tourne en BG ; useLiveResource
    // revalide /api/me/missions au prochain tick et la liste apparaît.
    void secureFetch('/api/me/sync-matching', { method: 'POST' }).catch((err) => {
      console.warn('[DndEmptyState] sync-matching ping failed (non-blocking)', err)
    })
    // Pas de setBusy(false) : useLiveResource va revalider et le composant
    // va se démonter (missions non vides → autre branche du parent). Si
    // l'utilisateur tombe sur un vrai "0 match", le parent affichera
    // l'empty-state gris (busy était local au composant rouge).
  }

  return (
    <div
      role="status"
      style={{
        background: '#FEF2F2',
        border: '1.5px solid #FCA5A5',
        borderRadius: 12,
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }} aria-hidden>🔕</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#991B1B',
              marginBottom: 6,
              letterSpacing: '-0.1px',
              lineHeight: 1.4,
            }}
          >
            {t('title')}
          </div>
          <div style={{ fontSize: 13, color: '#991B1B', opacity: 0.9, lineHeight: 1.55 }}>
            {t('body')}
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ fontSize: 12, color: '#7F1D1D', background: '#FECACA', padding: '8px 12px', borderRadius: 8 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={handleResume}
          disabled={busy}
          style={{
            padding: '9px 16px',
            background: '#DC2626',
            color: '#fff',
            border: 'none',
            borderRadius: 9,
            fontSize: 13,
            fontWeight: 700,
            cursor: busy ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            opacity: busy ? 0.7 : 1,
            transition: 'opacity .15s, background .15s',
          }}
        >
          {busy ? t('cta_resuming') : t('cta_resume')}
        </button>
      </div>
    </div>
  )
}
