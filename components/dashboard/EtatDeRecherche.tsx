'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { ExpertSide } from '@/lib/availability-actions'
import type { EtatDeRecherche as Etat } from '@/hooks/useRechercheDeMissions'

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ CE QUE L'EXPERT LIT PENDANT ET APRÈS UNE RECHERCHE DE MISSIONS.          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * UN SEUL COMPOSANT POUR LES DEUX ESPACES, et c'est la parité elle-même.
 * Les tableaux de bord freelance et CDI portaient deux blocs jumeaux, dans deux
 * espaces de traduction différents (`cards.recommended_missions.*` d'un côté,
 * `suggestions_section.*` de l'autre). Deux jumeaux dérivent (§E.20) : une
 * phrase corrigée d'un côté reste fausse de l'autre, et le second se lit comme
 * corrigé. Il n'y en a plus qu'un, et il lit un seul espace de traduction.
 *
 * ┌─ LA RÈGLE QUE CE COMPOSANT APPLIQUE ────────────────────────────────────┐
 * │ CHAQUE ISSUE A SA PHRASE, ET AUCUNE PHRASE N'AFFIRME CE QU'ON NE SAIT   │
 * │ PAS. « Aucune mission ne correspond » ne s'écrit que sur `aucune` —     │
 * │ c'est-à-dire seulement quand le moteur est allé au bout et n'a rien     │
 * │ trouvé. Un empêchement, un refus, une panne : chacun dit ce qu'il est.  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ AUCUN `default:` PERMISSIF. Une issue ajoutée demain ne doit pas hériter
 *    de la phrase d'une autre : `assertJamais()` force la compilation à la
 *    réclamer (§E.22).
 */

type Props = {
  etat: Etat
  side: ExpertSide
  /** Le nom de l'écosystème, pour les phrases qui le citent. */
  ecosystem: string
  /** Relancer la recherche — proposé sur les échecs qui se réessaient. */
  onReessayer?: () => void
}

/** Le chemin du profil de l'expert, par voie. Une seule expression des deux. */
function cheminDuProfil(side: ExpertSide): string {
  return side === 'freelance' ? '/dashboard/freelance/mon-profil' : '/dashboard/cdi/mon-profil'
}

function assertJamais(x: never): never {
  throw new Error(`Issue de recherche non traitée : ${JSON.stringify(x)}`)
}

const CADRE: React.CSSProperties = {
  background: 'var(--sk-surface-2)',
  border: '1px solid var(--sk-border)',
  borderRadius: 10,
  padding: 22,
  textAlign: 'center',
  fontSize: 14,
  color: 'var(--sk-muted)',
  lineHeight: 1.8,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
}

export default function EtatDeRecherche({ etat, side, ecosystem, onReessayer }: Props) {
  const t = useTranslations('recherche_de_missions')

  if (etat.phase === 'repos') return null

  // ── LA ROUE NE TOURNE QUE PENDANT UN TRAVAIL RÉEL ─────────────────────────
  //  Elle est montée à l'envoi de la requête et démontée à sa réponse. Il n'y
  //  a plus de minuterie derrière : elle ne peut donc plus survivre au travail
  //  ni s'arrêter avant lui.
  if (etat.phase === 'en_cours') {
    return (
      <div role="status" aria-live="polite" style={CADRE}>
        <Roue />
        <span>{t('en_cours', { ecosystem })}</span>
      </div>
    )
  }

  const issue = etat.issue

  if (issue.etat === 'trouvees') {
    // La liste s'affiche juste en dessous : répéter le compte ici serait du
    // bruit. Le bandeau disparaît, c'est la bonne nouvelle.
    return null
  }

  if (issue.etat === 'aucune') {
    return (
      <div role="status" style={CADRE}>
        <span>{t('aucune', { ecosystem })}</span>
      </div>
    )
  }

  if (issue.etat === 'ineligible') {
    const r = issue.raison
    // Ces quatre-là se corrigent depuis le profil, et la phrase le dit : un
    // message qui nomme un blocage sans donner la porte laisse l'expert
    // chercher tout seul.
    const versLeProfil =
      r === 'profil_non_visible' ||
      r === 'cv_non_analyse' ||
      r === 'consentement_absent'
    return (
      <div role="status" style={{ ...CADRE, color: 'var(--sk-text)' }}>
        <span>{t(`ineligible.${r}`, { ecosystem })}</span>
        {versLeProfil && (
          <Link
            href={cheminDuProfil(side)}
            style={{
              background: 'var(--sk-accent)',
              color: 'var(--sk-sur-accent)',
              fontSize: 13,
              fontWeight: 600,
              padding: '9px 18px',
              borderRadius: 8,
              textDecoration: 'none',
            }}
          >
            {t('action.completer_profil')}
          </Link>
        )}
      </div>
    )
  }

  if (issue.etat === 'echec') {
    // `trop_long` n'est pas une panne : le run CONTINUE côté serveur. La phrase
    // le dit, et c'est pour cela qu'elle ne propose pas de réessayer — relancer
    // ferait payer une seconde fois un travail en cours.
    const reessayable = issue.raison !== 'trop_long'
    return (
      <div role="status" style={{ ...CADRE, color: 'var(--sk-text)' }}>
        <span>{t(`echec.${issue.raison}`)}</span>
        {reessayable && onReessayer && (
          <button
            type="button"
            onClick={onReessayer}
            style={{
              background: 'transparent',
              color: 'var(--sk-accent)',
              border: '1px solid var(--sk-accent)',
              fontSize: 13,
              fontWeight: 600,
              padding: '8px 18px',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            {t('action.reessayer')}
          </button>
        )}
      </div>
    )
  }

  return assertJamais(issue)
}

/** La roue, une seule fois — les deux espaces la dessinaient séparément. */
function Roue() {
  return (
    <>
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          border: '2px solid color-mix(in srgb, var(--sk-accent) 27%, transparent)',
          borderTopColor: 'var(--sk-accent)',
          borderRadius: '50%',
          animation: 'sk-spin 0.8s linear infinite',
        }}
      />
      <style>{`@keyframes sk-spin { to { transform: rotate(360deg) } }`}</style>
    </>
  )
}
