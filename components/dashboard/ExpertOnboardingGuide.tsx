'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import type { VerificationUiState } from '@/lib/verification-state'

/**
 * ExpertOnboardingGuide — bloc de démarrage guidé (C1), en TÊTE du tableau de
 * bord expert, VISIBLE tant que le profil n'est pas vérifié (le caller ne le
 * rend pas quand verifState === 'approved').
 *
 * 4 étapes : CV → profil → publication (vérif IA) → missions & opportunités.
 * Chaque étape porte un état (fait / en cours / à venir) ; l'étape courante
 * expose une action directe vers la page de complétion/validation. Une phrase
 * explicite dit ce que la validation débloque.
 *
 * Parité freelance/CDI stricte : composant unique, seul `basePath` diffère
 * ('/dashboard/freelance' | '/dashboard/cdi'). Pleine largeur alignée gauche.
 */

type StepState = 'done' | 'current' | 'todo'

export default function ExpertOnboardingGuide({
  basePath,
  cvDone,
  profileComplete,
  verifState,
}: {
  basePath: string
  cvDone: boolean
  profileComplete: boolean
  verifState: VerificationUiState
}) {
  const t = useTranslations('expert_onboarding')
  const domain = useDomain()

  // Publication : 'in_progress' pendant la vérif (pending/admin_review),
  // 'done' si approuvé (cas non rendu ici), sinon à faire.
  const publishInProgress = verifState === 'pending' || verifState === 'admin_review'

  // Index de l'étape COURANTE (1..3) = première non-faite.
  const currentIndex = !cvDone ? 1 : !profileComplete ? 2 : 3

  const steps: Array<{ key: 'cv' | 'profile' | 'publish' | 'receive'; state: StepState; inProgress?: boolean }> = [
    { key: 'cv',      state: cvDone ? 'done' : currentIndex === 1 ? 'current' : 'todo' },
    { key: 'profile', state: profileComplete ? 'done' : currentIndex === 2 ? 'current' : 'todo' },
    {
      key: 'publish',
      state: publishInProgress ? 'current' : currentIndex === 3 ? 'current' : 'todo',
      inProgress: publishInProgress,
    },
    { key: 'receive', state: 'todo' },
  ]

  return (
    <div
      style={{
        width: '100%',
        background: '#fff',
        border: `1px solid ${domain.primaryColor}33`,
        borderRadius: 16,
        padding: '22px 24px',
        marginBottom: 22,
        animation: 'fadeInUp 0.4s ease',
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 4px', letterSpacing: '-0.2px' }}>
          {t('title')}
        </h2>
        <p style={{ fontSize: 13.5, color: '#64748b', margin: 0, lineHeight: 1.55 }}>{t('subtitle')}</p>
      </div>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {steps.map((step, i) => {
          const isCurrent = step.state === 'current'
          const isDone = step.state === 'done'
          const dotBg = isDone ? '#22c55e' : isCurrent ? domain.primaryColor : '#e2e8f0'
          const dotFg = isDone || isCurrent ? '#fff' : '#94a3b8'
          return (
            <li
              key={step.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '12px 14px',
                borderRadius: 12,
                background: isCurrent ? `${domain.primaryColor}0A` : 'transparent',
                border: isCurrent ? `1px solid ${domain.primaryColor}33` : '1px solid #eef2f6',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  background: dotBg, color: dotFg,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700,
                }}
              >
                {isDone ? '✓' : i + 1}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: isCurrent ? 700 : 600, color: isDone ? '#64748b' : '#0f172a' }}>
                  {t(`steps.${step.key}.title`)}
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  {isDone
                    ? t('status.done')
                    : step.inProgress
                      ? t('status.in_progress')
                      : isCurrent
                        ? t('status.current')
                        : t('status.todo')}
                </div>
              </div>
              {/* Action directe UNIQUEMENT sur l'étape courante actionnable
                  (pas quand la vérif est déjà en cours, ni sur « recevoir »). */}
              {isCurrent && !step.inProgress && step.key !== 'receive' && (
                <Link
                  href={`${basePath}/profil/valider`}
                  style={{
                    flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '8px 14px', borderRadius: 9,
                    background: domain.primaryColor, color: '#fff',
                    fontSize: 13, fontWeight: 700, textDecoration: 'none',
                  }}
                >
                  {t('cta')}
                </Link>
              )}
            </li>
          )
        })}
      </ol>

      <p style={{ fontSize: 12.5, color: '#64748b', margin: '16px 0 0', lineHeight: 1.55 }}>
        💡 {t('unlock')}
      </p>
    </div>
  )
}
