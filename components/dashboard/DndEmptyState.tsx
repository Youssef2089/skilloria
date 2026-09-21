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
  /**
   * LA RECHERCHE DE LA PAGE PARENTE, quand elle en porte une.
   *
   * ⚠️ CE COMPOSANT EST DÉMONTÉ À LA SECONDE OÙ L'EXPERT REPASSE « À
   *    L'ÉCOUTE » : la page parente remplace ce bloc rouge par sa section de
   *    missions. Une recherche lancée DEPUIS ICI n'aurait donc personne pour
   *    afficher son issue — l'expert verrait « aucune mission ne correspond »
   *    pendant que le moteur tourne, c'est-à-dire l'exact défaut que ce lot
   *    ferme.
   *
   *    Les deux tableaux de bord passent donc leur propre déclencheur : c'est
   *    leur hook qui attend et qui affiche. Les deux pages « Missions », qui
   *    n'en ont pas, gardent l'envoi sans attente — elles n'ont pas de section
   *    où l'afficher, et le dire serait mentir sur ce qu'elles savent.
   */
  onReprise?: () => void
}

export default function DndEmptyState({ side, userId, onReprise }: Props) {
  const t = useTranslations('expert_dnd_empty')
  const secureFetch = useSecureFetch()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleResume = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    // Aucun catch ici auparavant : une exception de getSession ou de
    // setExpertListening laissait le bouton en « … » pour toujours. Le
    // finally relâche ; le parent revalide et démonte ce composant au
    // prochain tick, et la garde `busy` couvre l’instant entre les deux.
    try {
    let effectiveUserId = userId
    if (!effectiveUserId) {
      // Fallback : récupère la session si la page parente ne nous l'a pas
      // passée (cas /dashboard/{freelance|cdi}/missions qui n'a pas
      // d'état user local).
      const { data: { session } } = await supabase.auth.getSession()
      effectiveUserId = session?.user?.id
      if (!effectiveUserId) {
        setError(t('error_generic'))
        return
      }
    }
    const res = await setExpertListening(supabase, side, effectiveUserId, true)
    if (!res.ok) {
      setError(t('error_generic'))
      return
    }
    // ── SORTIE DU « NE PAS DÉRANGER » : LA RECHERCHE PART POUR DE VRAI ─────
    //
    //  Ce bloc posait un jalon dans `sessionStorage` pour que la page d'accueil
    //  affiche « analyse en cours » pendant cent vingt secondes, puis lançait
    //  la requête sans jamais lire sa réponse. Or la route ne lançait rien :
    //  elle posait une échéance à SOIXANTE MINUTES. Le message d'analyse était
    //  donc faux du début à la fin, et l'écran concluait ensuite « aucune
    //  mission ne correspond » — un résultat affirmé sans recherche.
    //
    //  Quand la page parente porte une recherche, C'EST ELLE QUI LANCE : elle
    //  survit au démontage de ce bloc et affichera l'issue. Sinon, l'envoi part
    //  d'ici sans attente — la page n'a aucune section où dire l'issue, et en
    //  inventer une serait mentir sur ce qu'elle sait.
    if (onReprise) {
      onReprise()
    } else {
      void secureFetch('/api/me/sync-matching', { method: 'POST' }).catch((err) => {
        console.warn('[DndEmptyState] recherche de missions non lancée', err)
      })
    }
    } catch (err) {
      console.error('[DndEmptyState] resume threw', err)
      setError(t('error_generic'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="status"
      style={{
        background: 'var(--sk-red-soft)',
        border: '1.5px solid var(--sk-red-soft)',
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
              color: 'var(--sk-red)',
              marginBottom: 6,
              letterSpacing: '-0.1px',
              lineHeight: 1.4,
            }}
          >
            {t('title')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--sk-red)', opacity: 0.9, lineHeight: 1.55 }}>
            {t('body')}
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--sk-red)', background: 'var(--sk-red-soft)', padding: '8px 12px', borderRadius: 8 }}>
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
            background: 'var(--sk-red)',
            color: 'var(--sk-sur-accent)',
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
