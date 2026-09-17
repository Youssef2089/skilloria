'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * Sidebar du dashboard organisation (B3.5 + B3.5.fix).
 *
 * UNIFICATION B3.5.fix : il n'existe qu'un seul dashboard organisation
 * (`/dashboard/entreprise`). La prop `basePath` est typée en conséquence
 * pour interdire toute régression vers une seconde URL.
 *
 * Tous les hrefs construits via `<Link>` next-intl (préfixe de locale géré
 * automatiquement — fonctionne FR/EN/ES/DE). Aucun href en dur.
 *
 * Couleurs primaires depuis `useDomain()` (multi-tenant).
 *
 * TODO B4+ : les routes /messages, /organisation, /membres, /factures,
 * /parametres ne sont pas encore implémentées. Liens 404 pour l'instant.
 */

/**
 * ⚠️ `logo_url` EST UN DRAPEAU DE PRÉSENCE, PAS UNE ADRESSE.
 *
 * Cette page lit l'organisation en CLIENT-DIRECT, et la colonne contient
 * désormais un CHEMIN de stockage (`<uuid>/logo`) — jamais une URL
 * (migration 20260916300000). La poser telle quelle dans un `<img src>`
 * produirait une adresse relative, donc une image cassée.
 *
 * L'URL affichable est SIGNÉE, et seul le serveur peut la signer : elle est
 * donc demandée à GET /api/me/organisation/logo. Le client ne fabrique aucune
 * adresse, il affiche celle que la route lui donne (même discipline que §E.15).
 */
export type OrganisationLite = {
  id: string
  company_name: string | null
  logo_url: string | null
}

export type OrgSidebarNavItem =
  | 'dashboard'
  | 'messages'
  | 'organisation'
  | 'members'
  | 'invoices'
  | 'settings'

type Props = {
  organization: OrganisationLite
  unreadMessagesCount?: number
  activeItem: OrgSidebarNavItem
  basePath: '/dashboard/entreprise'
}

function initialsOf(name: string | null | undefined): string {
  const cleaned = (name ?? '').trim()
  if (!cleaned) return '??'
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase()
}

// ── Icônes Tabler en SVG inline ──────────────────────────────────────────
// Cohérence avec dashboard freelance (zéro dépendance). Mapping de noms Tabler.

function IconLayoutDashboard({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="6" height="8" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="12" width="6" height="8" rx="1" />
    </svg>
  )
}
function IconMail({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  )
}
function IconBuilding({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01" />
      <path d="M10 21v-4h4v4" />
    </svg>
  )
}
function IconUserPlus({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="4" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <path d="M19 8v6M16 11h6" />
    </svg>
  )
}
function IconFileInvoice({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  )
}
function IconSettings({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}

const NAV_ICONS: Record<OrgSidebarNavItem, (p: { size?: number }) => React.ReactElement> = {
  dashboard: IconLayoutDashboard,
  messages: IconMail,
  organisation: IconBuilding,
  members: IconUserPlus,
  invoices: IconFileInvoice,
  settings: IconSettings,
}

export default function OrganisationSidebar({
  organization,
  unreadMessagesCount = 0,
  activeItem,
  basePath,
}: Props) {
  const t = useTranslations('dashboard_entreprise')
  const domain = useDomain()
  const secureFetch = useSecureFetch()

  // ── L'URL SIGNÉE du logo, demandée à la route ───────────────────────────
  //
  // `organization.logo_url` est un drapeau (cf. le type ci-dessus) : il dit
  // qu'un logo EXISTE, il ne dit pas où. On ne tente la requête que dans ce
  // cas — inutile d'appeler le serveur pour les organisations sans logo, qui
  // sont la majorité.
  //
  // `null` couvre les trois cas d'un seul coup : pas de logo, signature
  // impossible, réseau tombé. Tous trois donnent l'ÉTAT VIDE délibéré (les
  // initiales), jamais une image cassée.
  const [logoSigne, setLogoSigne] = useState<string | null>(null)
  const aUnLogo = !!(organization.logo_url ?? '').trim()

  // ⚠️ L'EFFET NE FAIT QUE CHERCHER. Il ne remet rien à zéro de façon
  //    synchrone : une première version écrivait `if (!aUnLogo) setLogoSigne(null)`
  //    dans le corps de l'effet, ce que React déconseille (cascade de rendus)
  //    et que `react-hooks/set-state-in-effect` refuse. Le cas « pas de logo »
  //    se DÉRIVE au rendu (`urlAffichee` plus bas) : il n'a besoin d'aucun état.
  useEffect(() => {
    if (!aUnLogo) return
    let abandonne = false
    ;(async () => {
      try {
        const res = await secureFetch('/api/me/organisation/logo')
        if (!res.ok) return
        const body = (await res.json()) as { logo_url?: string | null }
        if (!abandonne) setLogoSigne(body.logo_url ?? null)
      } catch {
        // Silencieux À DESSEIN : l'absence de logo n'est pas un incident à
        // signaler à l'utilisateur, et la barre latérale n'est pas l'endroit
        // où l'on apprend qu'une requête a échoué. L'état vide suffit.
      }
    })()
    return () => {
      abandonne = true
    }
  }, [aUnLogo, organization.id, secureFetch])

  // DÉRIVÉE, pas stockée : sans logo il n'y a rien à afficher, quel que soit ce
  // qu'une requête précédente avait rapporté.
  const urlAffichee = aUnLogo ? logoSigne : null

  const items: Array<{ key: OrgSidebarNavItem; label: string; href: string }> = [
    { key: 'dashboard', label: t('nav.dashboard'), href: basePath },
    { key: 'messages', label: t('nav.messages'), href: `${basePath}/messages` },
    { key: 'organisation', label: t('nav.organisation'), href: `${basePath}/organisation` },
    { key: 'members', label: t('nav.members'), href: `${basePath}/membres` },
    { key: 'invoices', label: t('nav.invoices'), href: `${basePath}/factures` },
    { key: 'settings', label: t('nav.settings'), href: `${basePath}/parametres` },
  ]

  const companyName = (organization.company_name ?? '').trim() || '—'
  const initials = initialsOf(organization.company_name)

  return (
    <aside
      className="org-sidebar"
      style={{
        width: 200,
        flexShrink: 0,
        background: 'var(--color-background-secondary, #f8fafc)',
        borderRight: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
        padding: '24px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {/* Header avatar + nom */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '4px 4px 18px', borderBottom: '0.5px solid var(--color-border-tertiary, #e5e7eb)', marginBottom: 10 }}>
        {urlAffichee ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={urlAffichee}
            alt={companyName}
            width={60}
            height={60}
            // Une URL signée vit 300 s : un onglet resté ouvert au-delà rouvre
            // une image expirée. C'est NORMAL, et ça ne doit pas se voir comme
            // une panne — on retombe sur les initiales.
            onError={() => setLogoSigne(null)}
            style={{ width: 60, height: 60, borderRadius: '50%', objectFit: 'cover', marginBottom: 10 }}
          />
        ) : (
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: '50%',
              background: '#DBEAFE',
              color: '#00B9FF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              fontWeight: 500,
              marginBottom: 10,
            }}
          >
            {initials}
          </div>
        )}
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)', lineHeight: 1.3, wordBreak: 'break-word' }}>
          {companyName}
        </div>
        {/*
          ÉCRAN MORT FERMÉ. Ce bouton portait un `onClick` vide et un
          « TODO B4+ » : il était cliquable et ne faisait RIEN — un refus muet,
          ce que la checklist du projet interdit. Le téléversement existe
          désormais, sur l'écran « organisation » : le lien y conduit.

          Le lien mène à l'écran, pas à une action : c'est là que vit la garde
          par rôle, et qu'un membre non-admin lit POURQUOI il ne peut pas.
        */}
        {!aUnLogo && (
          <Link
            href={`${basePath}/organisation`}
            style={{
              marginTop: 8,
              fontSize: 11,
              color: '#00B9FF',
              textDecoration: 'none',
              fontFamily: 'inherit',
            }}
          >
            {t('add_logo')}
          </Link>
        )}
      </div>

      {/* Items navigation */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((item) => {
          const active = item.key === activeItem
          const Icon = NAV_ICONS[item.key]
          return (
            <Link
              key={item.key}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '9px 12px',
                fontSize: 13,
                fontWeight: active ? 500 : 400,
                color: active
                  ? 'var(--color-text-primary, #0f172a)'
                  : 'var(--color-text-secondary, #64748b)',
                background: active
                  ? 'var(--color-background-primary, #fff)'
                  : 'transparent',
                borderRadius: 8,
                textDecoration: 'none',
                transition: 'background .15s, color .15s',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <Icon size={16} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.label}
                </span>
              </span>
              {item.key === 'messages' && unreadMessagesCount > 0 && (
                <span
                  aria-label={`${unreadMessagesCount} unread`}
                  style={{
                    minWidth: 18,
                    height: 18,
                    padding: '0 5px',
                    background: '#DC2626',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 500,
                    borderRadius: 9,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {unreadMessagesCount > 99 ? '99+' : unreadMessagesCount}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Hint domaine (cohérence multi-tenant useDomain) */}
      <div style={{ marginTop: 'auto', paddingTop: 16, fontSize: 10, color: 'var(--color-text-tertiary, #94a3b8)', textAlign: 'center' }}>
        {domain.name}
      </div>
    </aside>
  )
}
