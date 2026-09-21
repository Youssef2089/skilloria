'use client'

import { useEffect, useState } from 'react'
import type { ListeDeProfil } from '@/lib/lecture/liste'
import { useTranslations, useLocale } from 'next-intl'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { Link, useRouter } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'
import EmptyState from '@/components/ui/EmptyState'
import { deriveVerificationUiState } from '@/lib/verification-state'
import VerificationStatusPill from '@/components/dashboard/VerificationStatusPill'
import AvatarUploadModal from '@/components/AvatarUploadModal'
import { useAvatarUrl } from '@/hooks/useAvatarUrl'
import AvatarEditOverlay from '@/components/dashboard/AvatarEditOverlay'
import {
  useCdiProfile,
  type CdiProfile,
  type CdiStatus,
  type CdiUser,
  type ExperienceItem,
  type EducationItem,
  type LanguageItem,
  type Branch,
  type Speciality,
  type Certification,
  type Seniority,
  type CefrLevel,
  type NoticePeriod,
} from '@/lib/hooks/useCdiProfile'
import CdiSalaryDisplay from '@/components/cdi/CdiSalaryDisplay'
import CdiPreferencesDisplay from '@/components/cdi/CdiPreferencesDisplay'
import ImageOuRepli from '@/components/ui/ImageOuRepli'
import SectionHeader from '@/components/dashboard/SectionHeader'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
})

const fontJakarta = 'var(--font-jakarta), system-ui, sans-serif'

// Lot disponibilité : 2 statuts uniquement (cf. components/cdi/CdiStatusToggle).
const STATUS_BADGE_COLORS: Record<CdiStatus, string> = {
  employed: 'var(--sk-red)',
  open_to_work: 'var(--sk-success)',
}


const LOCALE_DATE_MAP: Record<string, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
  es: 'es-ES',
  de: 'de-DE',
}

function displayName(user: CdiUser | null, fallback: string): string {
  if (!user) return fallback
  const full = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
  return full || fallback
}

function initialsOf(user: CdiUser | null): string {
  if (!user) return '?'
  const fn = (user.first_name ?? '').trim().charAt(0)
  const ln = (user.last_name ?? '').trim().charAt(0)
  const initials = (fn + ln).toUpperCase()
  return initials || '?'
}

function formatDate(dateStr: string | null, locale: string): string | null {
  if (!dateStr) return null
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return null
    return new Intl.DateTimeFormat(LOCALE_DATE_MAP[locale] ?? locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(d)
  } catch {
    return null
  }
}

function formatMonth(dateStr: string, locale: string): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return new Intl.DateTimeFormat(LOCALE_DATE_MAP[locale] ?? locale, {
      year: 'numeric',
      month: 'short',
    }).format(d)
  } catch {
    return dateStr
  }
}


function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--sk-surface)',
        border: '1px solid var(--sk-border)',
        borderRadius: 16,
        padding: '22px 24px',
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: 14,
        color: 'var(--sk-faint)',
        fontStyle: 'italic',
        padding: '4px 0',
      }}
    >
      {text}
    </div>
  )
}

function Pill({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
        color,
        padding: '5px 12px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        marginRight: 6,
        marginBottom: 4,
      }}
    >
      {children}
    </span>
  )
}

/** Les trois listes de profil, et le titre de section qui les désigne à l'écran. */
const NOM_DE_SECTION: Record<ListeDeProfil, string> = {
  experiences: 'career',
  educations: 'education',
  languages_structured: 'languages',
}

export default function CdiMonProfilPage() {
  const t = useTranslations('cdi_profile_view')
  const tRejected = useTranslations('expert_verification.rejected_details')
  const locale = useLocale()
  const router = useRouter()
  const state = useCdiProfile()
  const {
    loading,
    authenticated,
    forbidden,
    error,
    user,
    profile,
    experiences,
    educations,
    languages,
    sectionsIndisponibles,
    branches,
    specialities,
  } = state
  // Parité freelance : état de vérif dérivé (pour le bloc « refusé » ci-dessous).
  const verifState = deriveVerificationUiState({
    visible: profile?.visible ?? null,
    verificationStatus: profile?.verification_status ?? null,
  })
  // « Vérifié » et « visible » ne sont pas la même chose : un profil approuvé
  // peut avoir été MASQUÉ depuis, parce que de nouveaux champs sont devenus
  // nécessaires. Le bandeau l'explique en tête d'écran ; sans ce drapeau, la
  // pastille affichait « Profil vérifié » en VERT juste en dessous, et les
  // deux se lisaient comme une contradiction.
  //
  // ⚠️ `=== false`, jamais `!visible` : une lecture en panne rend `null`, et
  //    `!null` vaut `true` — on annoncerait « masqué » à quelqu'un dont on n'a
  //    pas pu lire l'état (§E.22).
  const profilMasque = verifState === 'approved' && profile?.visible === false
  // Lot global C3 : modal upload photo (entry-point unique côté CDI).
  // useCdiProfile ne renvoie pas de setter — au succès on patch un mirror
  // local et on l'utilise pour rendre l'avatar tant que le hook ne refetch
  // pas (un focus/reload re-synchronisera depuis la DB).
  const [avatarModalOpen, setAvatarModalOpen] = useState(false)
  // M3 : photo propre via URL signée serveur (le hook re-signe après upload).
  const { url: ownAvatarUrl } = useAvatarUrl()
  // Lot CV obligatoire — bouton "Publier mon profil" depuis Mon Profil.
  // L'API (PATCH /api/profile {visible:true}) reste la barrière de validation :
  // on relaie son message d'erreur (profil incomplet ou CV manquant) tel quel.
  const secureFetch = useSecureFetch()
  const [publishing, setPublishing] = useState(false)
  const [publishMsg, setPublishMsg] = useState<
    { kind: 'success' | 'error'; text: string } | null
  >(null)

  const handlePublish = async () => {
    if (publishing) return
    setPublishMsg(null)
    setPublishing(true)
    try {
      const res = await secureFetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible: true }),
      })
      const payload = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok) {
        const code = (payload as { code?: string }).code
        // ⚠️ UN 503 N’EST PAS UN REFUS DU PROFIL. Les trois codes ci-dessous
        //    disent qu’une LECTURE n’a pas abouti — la complétude n’a pas pu
        //    être comptée, un référentiel n’a pas répondu, le type de compte
        //    n’a pas pu être lu. Les laisser tomber sur « la publication a
        //    échoué » enverrait corriger un profil qui n’a rien à corriger.
        const text =
          code === 'cv_not_ready'
            ? t('publish.error_cv')
            : code === 'incomplete'
              ? t('publish.error_incomplete')
              : code === 'completude_indisponible' ||
                  code === 'referentiel_indisponible' ||
                  code === 'profil_verification_indisponible'
                ? t('publish.error_verification_indisponible')
                : t('publish.error_generic') /* jamais payload.error brut */
        setPublishMsg({ kind: 'error', text })
        return
      }
      setPublishMsg({ kind: 'success', text: t('publish.success') })
    } catch {
      setPublishMsg({ kind: 'error', text: t('publish.error_generic') })
    } finally {
      setPublishing(false)
    }
  }

  // Redirection pas authentifié → /connexion (RLS-friendly)
  useEffect(() => {
    if (!loading && !authenticated) {
      router.push('/connexion')
    }
  }, [loading, authenticated, router])

  // Lot CV obligatoire : on ne redirige plus en silence vers l'upload quand
  // il n'y a pas de profil / pas de CV. À la place, le rendu affiche un écran
  // de blocage PLEINE LARGEUR avec lien vers l'upload (cf. verrou ci-dessous).

  // ----- LOADING ------------------------------------------------------------
  if (loading || (!authenticated && !error && !forbidden)) {
    return (
      <div
        className={jakarta.variable}
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <style>{`@keyframes sk-spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              border: `3px solid color-mix(in srgb, var(--sk-accent) 13%, transparent)`,
              borderTopColor: 'var(--sk-accent)',
              margin: '0 auto 12px',
              animation: 'sk-spin 0.9s linear infinite',
            }}
          />
          <div style={{ fontSize: 14, color: 'var(--sk-muted)' }}>{t('loading')}</div>
        </div>
      </div>
    )
  }

  // ----- FORBIDDEN ----------------------------------------------------------
  if (forbidden) {
    return (
      <div
        className={jakarta.variable}
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <div
          style={{
            background: 'var(--sk-surface)',
            border: '1px solid var(--sk-border)',
            borderRadius: 16,
            padding: 32,
            maxWidth: 440,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden>
            🔒
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sk-text)', marginBottom: 8 }}>
            403
          </div>
          <div style={{ fontSize: 14, color: 'var(--sk-muted)', lineHeight: 1.6, marginBottom: 20 }}>
            {t('error_loading')}
          </div>
          <button
            type="button"
            onClick={() => router.push('/')}
            style={{
              background: 'var(--sk-accent)',
              color: 'var(--sk-sur-accent)',
              border: 'none',
              borderRadius: 10,
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            ←
          </button>
        </div>
      </div>
    )
  }

  // ----- ERROR --------------------------------------------------------------
  if (error) {
    return (
      <div
        className={jakarta.variable}
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: '32px auto',
            background: 'var(--sk-red-soft)',
            border: '1px solid var(--sk-red-soft)',
            borderRadius: 12,
            padding: 20,
            color: 'var(--sk-red)',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{t('error_loading')}</div>
          <div style={{ opacity: 0.8 }}>{error}</div>
        </div>
      </div>
    )
  }

  // ----- VERROU CV (Lot CV obligatoire) -------------------------------------
  // Pas de profil OU pas de CV déposé (cv_file_path nul) → écran de blocage
  // PLEINE LARGEUR (primitive EmptyState partagée), avec lien vers l'upload.
  // Plus de redirection silencieuse ni de profil vide affiché.
  // (Le `|| !profile` narrow `profile` à non-null pour le rendu chargé.)
  if (!profile || !profile.cv_file_path) {
    return (
      <div
        className={jakarta.variable}
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div style={{ padding: 24 }}>
          <EmptyState
            icon="📄"
            title={t('cv_required.title')}
            body={t('cv_required.body')}
            action={
              <Link
                href="/dashboard/cdi/profil"
                style={{
                  background: 'var(--sk-accent)',
                  color: 'var(--sk-sur-accent)',
                  border: 'none',
                  borderRadius: 10,
                  padding: '10px 18px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textDecoration: 'none',
                  display: 'inline-block',
                }}
              >
                {t('cv_required.cta')}
              </Link>
            }
          />
        </div>
      </div>
    )
  }

  // ----- LOADED -------------------------------------------------------------
  return (
    <div
      className={jakarta.variable}
      style={{
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <style>{`
        @keyframes sk-fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .sk-card { animation: sk-fadeUp 0.4s ease both; }
        @media (max-width: 767px) {
          .sk-page-main { padding: 16px !important; }
          .sk-header-row { padding: 0 16px !important; }
          .sk-hero-grid { grid-template-columns: 1fr !important; }
          .sk-action-bar { flex-direction: column !important; align-items: stretch !important; gap: 10px !important; }
        }
      `}</style>


      <main className="sk-page-main" style={{ width: '100%', padding: '24px 24px 56px' }}>
        {/* En-tête : titre à gauche, actions à droite sur la même rangée */}
        <div
          className="sk-action-bar"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: 20,
            gap: 16,
          }}
        >
          {/* LA PASTILLE DE VÉRIFICATION SUIT LE TITRE, ELLE NE DISPARAÎT PAS.
              Elle vivait dans l'en-tête maison que cette page rendait
              elle-même. Cet en-tête part — la coquille partagée en fournit un —
              mais la coquille ne porte pas cette pastille : la retirer sans
              rien dire aurait fait perdre au passage l'information que l'expert
              vient justement chercher ici, l'état de son profil. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--sk-text)', margin: 0, letterSpacing: '-0.4px' }}>
              {t('page_title')}
            </h1>
            <VerificationStatusPill state={verifState} masque={profilMasque} />
            {/* LE STATUT DE MARCHÉ SUIT, LUI AUSSI. « En poste » / « en
                recherche » vivait dans l'en-tête maison. C'est un ÉTAT — ses
                couleurs vert et rouge sont donc légitimes ici, au contraire des
                numéros de section (§D.12). */}
            {profile?.cdi_status && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: `color-mix(in srgb, ${STATUS_BADGE_COLORS[profile.cdi_status as CdiStatus]} 8%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${STATUS_BADGE_COLORS[profile.cdi_status as CdiStatus]} 33%, transparent)`,
                  padding: '5px 12px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 600,
                  color: STATUS_BADGE_COLORS[profile.cdi_status as CdiStatus],
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: STATUS_BADGE_COLORS[profile.cdi_status as CdiStatus],
                  }}
                  aria-hidden
                />
                <span>{t(`status_badges.${profile.cdi_status}`)}</span>
              </div>
            )}
          </div>
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Édition — secondaire (outline) ; garde le lien existant. */}
            <Link
              href="/dashboard/cdi/profil/valider"
              style={{
                background: 'var(--sk-surface)',
                color: 'var(--sk-accent)',
                border: `1.5px solid var(--sk-accent)`,
                borderRadius: 10,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {t('edit_button')}
            </Link>
            {/* Publier mon profil — primaire. Validation (8 critères + CV prêt)
                faite par l'API ; on relaie son verdict. */}
            <button
              type="button"
              onClick={handlePublish}
              disabled={publishing}
              style={{
                background: 'var(--sk-accent)',
                color: 'var(--sk-sur-accent)',
                border: 'none',
                borderRadius: 10,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: publishing ? 'not-allowed' : 'pointer',
                opacity: publishing ? 0.6 : 1,
                fontFamily: 'inherit',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {publishing ? t('publish.publishing') : t('publish.button')}
            </button>
          </div>
        </div>
        {publishMsg && (
          <div
            role="status"
            style={{
              marginBottom: 20,
              padding: '12px 16px',
              borderRadius: 10,
              fontSize: 13.5,
              lineHeight: 1.5,
              background: publishMsg.kind === 'success' ? 'var(--sk-success-soft)' : 'var(--sk-red-soft)',
              border: `1px solid ${publishMsg.kind === 'success' ? 'var(--sk-success-soft)' : 'var(--sk-red-soft)'}`,
              color: publishMsg.kind === 'success' ? 'var(--sk-success)' : 'var(--sk-red)',
            }}
          >
            {publishMsg.text}
          </div>
        )}

        {/* HEADER PROFIL (hero, sans numéro) */}
        <ProfileHero
          user={user}
          profile={profile}
          localPhotoUrl={ownAvatarUrl}
          locale={locale}
          domainColor={'var(--sk-accent)'}
          t={t}
          onEditPhoto={() => setAvatarModalOpen(true)}
        />

        {/* Bloc « refusé » : motif de refus (review_reason) + CTA re-soumission.
            Seul endroit où l'expert voit le motif (bandeaux redondants retirés).
            Parité stricte avec freelance/mon-profil. */}
        {verifState === 'rejected' && profile?.review_reason && (
          <div
            role="alert"
            style={{
              background: 'var(--sk-red-soft)',
              border: '1px solid var(--sk-red-soft)',
              color: 'var(--sk-red)',
              borderRadius: 10,
              padding: '10px 14px',
              marginBottom: 20,
              fontSize: 13,
              lineHeight: 1.55,
              maxWidth: 560,
            }}
          >
            <span style={{ fontWeight: 700 }}>{tRejected('reason_label')} </span>
            <span style={{ whiteSpace: 'pre-wrap' }}>{profile.review_reason}</span>
            <div style={{ marginTop: 8 }}>
              <Link
                href="/dashboard/cdi/profil/valider"
                style={{ fontSize: 13, fontWeight: 600, color: 'var(--sk-red)', textDecoration: 'underline' }}
              >
                {tRejected('cta')}
              </Link>
            </div>
          </div>
        )}

        {/* ── CE QU'ON N'A PAS SU LIRE SE DIT, ET NE SE DÉGUISE PAS EN VIDE ──
            §E.22 : une section absente et une section illisible produisaient le
            même écran — « aucune expérience » — sur la page où l'expert vient
            vérifier son profil. Jumeau exact de l'écran freelance (§E.20). */}
        {sectionsIndisponibles.length > 0 && (
          <div
            role="status"
            aria-live="polite"
            style={{
              background: 'var(--sk-amber-soft)',
              border: '1px solid var(--sk-amber-soft)',
              borderRadius: 12,
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: 'var(--sk-amber)', fontSize: 14, marginBottom: 4 }}>
                {t('errors.list_read_failed_title')}
              </div>
              <div style={{ color: 'var(--sk-amber)', fontSize: 13, lineHeight: 1.5 }}>
                {t('errors.list_read_failed_body', {
                  sections: sectionsIndisponibles
                    .map(c => t(`sections.${NOM_DE_SECTION[c]}`))
                    .join(', '),
                })}
              </div>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                background: 'var(--sk-amber)',
                color: 'var(--sk-sur-accent)',
                border: 'none',
                borderRadius: 8,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t('errors.list_read_failed_retry')}
            </button>
          </div>
        )}

        {/* 1. RÉSUMÉ */}
        <div className="sk-card">
          <Card>
            <SectionHeader n={1} title={t('sections.summary')} />
            {profile.summary ? (
              <p style={{ fontSize: 14, color: 'var(--sk-muted)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                {profile.summary}
              </p>
            ) : (
              <Empty text={t('empty_states.no_summary')} />
            )}
          </Card>
        </div>

        {/* 2. EXPERTISE */}
        <div className="sk-card">
          <Card>
            <SectionHeader n={2} title={t('sections.expertise')} />
            <ExpertiseSection
              profile={profile}
              branches={branches}
              specialities={specialities}
              domainColor={'var(--sk-accent)'}
              t={t}
            />
          </Card>
        </div>

        {/* 3. RECHERCHE */}
        <div className="sk-card">
          <Card>
            <SectionHeader n={3} title={t('sections.search_preferences')} />
            <CdiPreferencesDisplay
              contractTypes={profile.cdi_contract_types}
              workModes={profile.work_modes}
              geoMobility={profile.cdi_geo_mobility}
              companySize={profile.cdi_company_size}
              sectors={profile.cdi_sectors}
              benefits={profile.cdi_benefits}
            />
          </Card>
        </div>

        {/* 4. RÉMUNÉRATION */}
        <div className="sk-card">
          <Card>
            <SectionHeader n={4} title={t('sections.compensation')} />
            <CdiSalaryDisplay
              min={profile.cdi_salary_min}
              max={profile.cdi_salary_max}
              variablePct={profile.cdi_variable_pct}
            />
          </Card>
        </div>

        {/* 5. CERTIFICATIONS */}
        <div className="sk-card">
          <Card>
            <SectionHeader n={5} title={t('sections.certifications')} />
            <CertificationsSection certifications={profile.certifications ?? []} t={t} />
          </Card>
        </div>

        {/* 6. PARCOURS PROFESSIONNEL */}
        <div className="sk-card">
          <Card>
            <SectionHeader n={6} title={t('sections.career')} />
            <ExperiencesSection
              experiences={experiences.filter(e => e.experience_type === 'career')}
              locale={locale}
              t={t}
              emptyKey="no_career"
            />
          </Card>
        </div>

        {/* 7. MISSIONS / PROJETS */}
        <div className="sk-card">
          <Card>
            <SectionHeader n={7} title={t('sections.missions')} />
            <ExperiencesSection
              experiences={experiences.filter(e => e.experience_type === 'project')}
              locale={locale}
              t={t}
              emptyKey="no_career"
              compact
            />
          </Card>
        </div>

        {/* 8. FORMATION */}
        <div className="sk-card">
          <Card>
            <SectionHeader n={8} title={t('sections.education')} />
            <EducationSection educations={educations} t={t} />
          </Card>
        </div>

        {/* 9. LANGUES */}
        <div className="sk-card">
          <Card>
            <SectionHeader n={9} title={t('sections.languages')} />
            <LanguagesSection
              languages={languages}
              fallbackLanguages={profile.languages}
              domainColor={'var(--sk-accent)'}
              t={t}
            />
          </Card>
        </div>

        {/* 10. CAREER GOALS */}
        <div className="sk-card">
          <Card>
            <SectionHeader n={10} title={t('sections.career_goals')} />
            {profile.cdi_career_goals ? (
              <p style={{ fontSize: 14, color: 'var(--sk-muted)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                {profile.cdi_career_goals}
              </p>
            ) : (
              <Empty text={t('empty_states.no_career_goals')} />
            )}
          </Card>
        </div>

        {/* 11. CONFIDENTIALITÉ */}
        <div className="sk-card">
          <Card>
            <SectionHeader n={11} title={t('sections.confidentiality')} />
            {profile.cdi_confidential_mode ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: 'var(--sk-amber-soft)',
                  border: '1px solid var(--sk-amber-soft)',
                  borderRadius: 10,
                  padding: '12px 14px',
                }}
              >
                <div style={{ fontSize: 18 }} aria-hidden>🔒</div>
                <div style={{ fontSize: 13, color: 'var(--sk-amber)', fontWeight: 600 }}>
                  {t('labels.confidential_mode_active')}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 14, color: 'var(--sk-faint)', fontStyle: 'italic' }}>
                {t('labels.confidential_mode_active')} — Off
              </div>
            )}
          </Card>
        </div>

        {/* 12. LIENS */}
        <div className="sk-card">
          <Card>
            <SectionHeader n={12} title={t('sections.links')} />
            <LinksSection profile={profile} domainColor={'var(--sk-accent)'} t={t} />
          </Card>
        </div>
      </main>

      {/* Lot global C3 : modal upload photo (entry-point unique côté CDI).
          AvatarUploadModal écrit Supabase Storage + PATCH /api/profile, on
          patch localPhotoUrl côté client au succès.
          Lot global C3 (micro-ajout) : émet `sk:profile-changed` →
          DashboardShell refetch le profil → avatar sidebar INSTANTANÉ. */}
      <AvatarUploadModal
        open={avatarModalOpen}
        onClose={() => setAvatarModalOpen(false)}
      />
    </div>
  )
}

// =========================================================================

// =========================================================================
// HERO PROFIL (avatar + nom + headline + métadonnées CDI)
// =========================================================================
function ProfileHero({
  user,
  profile,
  localPhotoUrl,
  locale,
  domainColor,
  t,
  onEditPhoto,
}: {
  user: CdiUser | null
  profile: CdiProfile
  /** Lot global C3 : mirror local de profile.photo_url pour update optimiste
   *  post-upload (le hook useCdiProfile n'expose pas de setter). */
  localPhotoUrl: string | null
  locale: string
  domainColor: string
  t: ReturnType<typeof useTranslations<'cdi_profile_view'>>
  onEditPhoto: () => void
}) {
  const name = displayName(user, t('fallback_user_name'))
  const initials = initialsOf(user)
  const noticeKey = profile.cdi_notice_period
  const noticeLabel = noticeKey ? t(`notice_period_options.${noticeKey}`) : null
  const availabilityFormatted = formatDate(profile.cdi_availability_date, locale)
  // M3 : URL signée fournie par le parent (hook useAvatarUrl). Plus de fallback
  // sur profile.photo_url (qui n'est plus qu'un chemin storage, non affichable).
  const effectivePhotoUrl = localPhotoUrl

  return (
    <div className="sk-card">
      <Card>
        <div
          className="sk-hero-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '88px 1fr',
            gap: 18,
            alignItems: 'center',
          }}
        >
          {/* Avatar wrappé pour overlay "Modifier la photo" (Lot global C3). */}
          <div style={{ position: 'relative', display: 'inline-block' }}>
            {/* Repli sur ABSENCE *et* ÉCHEC : la photo est servie par URL
                signée (300 s). Expirée, on retombe sur les initiales. */}
            <ImageOuRepli
              src={effectivePhotoUrl}
              alt={name || 'avatar'}
              style={{
                width: 88,
                height: 88,
                borderRadius: '50%',
                objectFit: 'cover',
                border: `3px solid color-mix(in srgb, var(--sk-accent) 20%, transparent)`,
              }}
              repli={
                <div
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: '50%',
                    background: `linear-gradient(135deg, color-mix(in srgb, var(--sk-accent) 20%, transparent), color-mix(in srgb, var(--sk-accent) 40%, transparent))`,
                    color: domainColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 30,
                    fontWeight: 700,
                    fontFamily: fontJakarta,
                  }}
                >
                  {initials}
                </div>
              }
            />
            <AvatarEditOverlay onClick={onEditPhoto} />
          </div>

          {/* Identité */}
          <div>
            {name && (
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: 'var(--sk-text)',
                  letterSpacing: '-0.4px',
                  fontFamily: fontJakarta,
                  marginBottom: 4,
                }}
              >
                {name}
              </div>
            )}
            {profile.title && (
              <div style={{ fontSize: 15, color: 'var(--sk-muted)', marginBottom: 6 }}>
                {profile.title}
              </div>
            )}
            {(profile.location || profile.city || profile.country) && (
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--sk-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span aria-hidden>📍</span>
                <span>
                  {profile.location ||
                    [profile.city, profile.country].filter(Boolean).join(', ')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Métadonnées CDI : préavis + dispo */}
        {(noticeLabel || availabilityFormatted) && (
          <div
            style={{
              marginTop: 18,
              paddingTop: 16,
              borderTop: '1px solid var(--sk-surface-2)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 18,
              fontSize: 13,
              color: 'var(--sk-muted)',
            }}
          >
            {noticeLabel && (
              <div>
                <span style={{ fontWeight: 600, color: 'var(--sk-muted)' }}>
                  {t('labels.notice_period')} ·{' '}
                </span>
                <span>{noticeLabel}</span>
              </div>
            )}
            {availabilityFormatted && (
              <div>
                <span style={{ fontWeight: 600, color: 'var(--sk-muted)' }}>
                  {t('labels.available_from', { date: availabilityFormatted })}
                </span>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

// =========================================================================
// SECTION : EXPERTISE
// =========================================================================
function ExpertiseSection({
  profile,
  branches,
  specialities,
  domainColor,
  t,
}: {
  profile: CdiProfile
  branches: Branch[]
  specialities: Speciality[]
  domainColor: string
  t: ReturnType<typeof useTranslations<'cdi_profile_view'>>
}) {
  const branch = branches.find(b => b.id === profile.branch_id) ?? null
  const specialtyNames = (profile.speciality_ids ?? [])
    .map(id => specialities.find(s => s.id === id)?.name)
    .filter((x): x is string => !!x)
  const skills = profile.skills ?? []
  const seniorityKeys = profile.seniorities ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        <MetaItem
          label={t('labels.branch')}
          value={branch?.name ?? null}
        />
        <MetaItem
          label={t('labels.specialty')}
          value={specialtyNames.join(', ') || null}
        />
        {seniorityKeys.length > 0 && (
          <MetaItem
            label={t('labels.seniority')}
            value={seniorityKeys.join(', ')}
          />
        )}
        {profile.years_experience != null && (
          <MetaItem
            label={t('labels.years_experience')}
            value={String(profile.years_experience)}
          />
        )}
      </div>

      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--sk-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginTop: 6,
            marginBottom: 8,
          }}
        >
          {t('labels.skills')}
        </div>
        {skills.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {skills.map(s => (
              <Pill key={s} color={domainColor}>
                {s}
              </Pill>
            ))}
          </div>
        ) : (
          <Empty text={t('empty_states.no_skills')} />
        )}
      </div>
    </div>
  )
}

function MetaItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--sk-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, color: value ? 'var(--sk-text)' : 'var(--sk-faint)', fontStyle: value ? 'normal' : 'italic' }}>
        {value ?? '—'}
      </div>
    </div>
  )
}

// =========================================================================
// SECTION : CERTIFICATIONS
// =========================================================================
function CertificationsSection({
  certifications,
  t,
}: {
  certifications: Certification[]
  t: ReturnType<typeof useTranslations<'cdi_profile_view'>>
}) {
  if (!certifications || certifications.length === 0) {
    return <Empty text={t('empty_states.no_certifications')} />
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {certifications.map((c, i) => (
        <li
          key={`${c.name}-${i}`}
          style={{
            border: '1px solid var(--sk-surface-2)',
            borderRadius: 10,
            padding: '10px 14px',
            background: 'var(--sk-surface-2)',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sk-text)' }}>{c.name}</div>
          <div style={{ fontSize: 12, color: 'var(--sk-muted)', marginTop: 2 }}>
            {[c.issuer, c.year != null ? String(c.year) : null].filter(Boolean).join(' · ')}
          </div>
        </li>
      ))}
    </ul>
  )
}

// =========================================================================
// SECTION : EXPÉRIENCES (career ou project)
// =========================================================================
function ExperiencesSection({
  experiences,
  locale,
  t,
  emptyKey,
  compact = false,
}: {
  experiences: ExperienceItem[]
  locale: string
  t: ReturnType<typeof useTranslations<'cdi_profile_view'>>
  emptyKey: 'no_career'
  compact?: boolean
}) {
  if (!experiences || experiences.length === 0) {
    return <Empty text={t(`empty_states.${emptyKey}`)} />
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {experiences.map((e, i) => {
        const start = e.start_date ? formatMonth(e.start_date, locale) : ''
        const end = e.is_current ? '—' : e.end_date ? formatMonth(e.end_date, locale) : ''
        const range = [start, end].filter(Boolean).join(' → ')
        const heading = compact
          ? [e.role, e.client_name].filter(Boolean).join(' · ')
          : [e.role, e.employer].filter(Boolean).join(' @ ')
        return (
          <li
            key={`${e.role}-${i}`}
            style={{
              border: '1px solid var(--sk-surface-2)',
              borderRadius: 10,
              padding: '12px 14px',
              background: 'var(--sk-surface)',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sk-text)' }}>{heading || '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--sk-muted)', marginTop: 4 }}>
              {[range, e.sector].filter(Boolean).join(' · ')}
            </div>
            {e.description && (
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--sk-muted)',
                  lineHeight: 1.6,
                  marginTop: 8,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {e.description}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// =========================================================================
// SECTION : FORMATION
// =========================================================================
function EducationSection({
  educations,
  t,
}: {
  educations: EducationItem[]
  t: ReturnType<typeof useTranslations<'cdi_profile_view'>>
}) {
  if (!educations || educations.length === 0) {
    return <Empty text={t('empty_states.no_education')} />
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {educations.map((e, i) => {
        const heading = [e.degree, e.field].filter(Boolean).join(' · ')
        const range = [e.start_year, e.end_year].filter(v => v != null).join(' → ')
        return (
          <li
            key={`${e.school}-${i}`}
            style={{
              border: '1px solid var(--sk-surface-2)',
              borderRadius: 10,
              padding: '10px 14px',
              background: 'var(--sk-surface-2)',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sk-text)' }}>
              {heading || e.school || '—'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--sk-muted)', marginTop: 2 }}>
              {[e.school, e.location, range].filter(Boolean).join(' · ')}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// =========================================================================
// SECTION : LANGUES
// =========================================================================
function LanguagesSection({
  languages,
  fallbackLanguages,
  domainColor,
  t,
}: {
  languages: LanguageItem[]
  fallbackLanguages: string[] | null
  domainColor: string
  t: ReturnType<typeof useTranslations<'cdi_profile_view'>>
}) {
  if (languages && languages.length > 0) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {languages.map((l, i) => (
          <Pill key={`${l.language}-${i}`} color={domainColor}>
            {l.language} · {l.level}
            {l.is_primary ? ' ★' : ''}
          </Pill>
        ))}
      </div>
    )
  }
  // fallback : champ profiles.languages legacy (string[])
  if (fallbackLanguages && fallbackLanguages.length > 0) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {fallbackLanguages.map((l, i) => (
          <Pill key={`${l}-${i}`} color={domainColor}>
            {l}
          </Pill>
        ))}
      </div>
    )
  }
  return <Empty text={t('empty_states.no_languages')} />
}

// =========================================================================
// SECTION : LIENS
// =========================================================================
function LinksSection({
  profile,
  domainColor,
  t,
}: {
  profile: CdiProfile
  domainColor: string
  t: ReturnType<typeof useTranslations<'cdi_profile_view'>>
}) {
  const items: Array<{ label: string; href: string }> = []
  if (profile.linkedin_url) {
    items.push({ label: 'LinkedIn', href: profile.linkedin_url })
  }
  if (items.length === 0) {
    return <Empty text={t('empty_states.no_links')} />
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(item => (
        <li key={item.href}>
          <a
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: domainColor,
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
              wordBreak: 'break-all',
            }}
          >
            {item.label} ↗ <span style={{ color: 'var(--sk-muted)', fontWeight: 400 }}>{item.href}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
