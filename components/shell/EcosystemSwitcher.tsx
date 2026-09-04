'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'
import { ecosystemHref } from '@/lib/ecosystem-url'

/**
 * EcosystemSwitcher — changer d'écosystème, côté organisation.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ CHANGER D'ÉCOSYSTÈME = CHANGER DE SOUS-DOMAINE. RIEN D'AUTRE.            ║
 * ║                                                                          ║
 * ║ Aucun état local, aucun cookie de préférence, aucun paramètre d'URL :    ║
 * ║ l'adresse EST l'écosystème. C'est pourquoi la bascule est une            ║
 * ║ NAVIGATION COMPLÈTE (`location.assign`) et non un `router.push` : on     ║
 * ║ quitte l'origine, le serveur relit `x-subdomain`, et tout ce qui         ║
 * ║ dépendait de l'écosystème est reconstruit à partir de la seule vérité.   ║
 * ║                                                                          ║
 * ║ Un second état — « écosystème sélectionné » quelque part en mémoire —    ║
 * ║ finirait par diverger de l'URL. Le jour où il diverge, l'écran affiche   ║
 * ║ un écosystème pendant que le serveur en sert un autre, et les données    ║
 * ║ paraissent fausses sans que rien ne soit en erreur.                      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ ON NE RAPPELLE JAMAIS init-session À LA BASCULE.
 *
 *    Ce serait le réflexe : on change de contexte, donc on « réinitialise la
 *    session ». Ce serait un défaut grave. `init-session` fait TOURNER le
 *    `last_session_token`, et la session unique (11F) refuse ensuite tout
 *    porteur de l'ancien : chaque autre onglet ouvert serait éjecté en
 *    `session_superseded`, sur l'écosystème qu'il regardait paisiblement.
 *
 *    Rien ne l'exige, d'ailleurs : le cookie `ss_token` est posé sur
 *    `Domain=.skilloria.io`, donc partagé par TOUS les sous-domaines. La
 *    session traverse la bascule sans qu'on ait à y toucher.
 */
type Ecosystem = { id: string; slug: string; name: string; color: string | null }

export default function EcosystemSwitcher() {
  const t = useTranslations('ecosystem_switcher')
  const locale = useLocale()
  const pathname = usePathname()
  const secureFetch = useSecureFetch()

  const [items, setItems] = useState<Ecosystem[] | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await secureFetch(`/api/me/ecosystemes?locale=${encodeURIComponent(locale)}`)
        if (!res.ok) return
        const body = (await res.json()) as { ecosystems: Ecosystem[]; current: string }
        if (cancelled) return
        setItems(body.ecosystems ?? [])
        setCurrent(body.current ?? null)
      } catch {
        /* silencieux : un sélecteur absent vaut mieux qu'un sélecteur en erreur */
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [secureFetch, locale])

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const list = useMemo(() => items ?? [], [items])

  /**
   * Ouvrir POSITIONNE le curseur sur l'entrée courante.
   *
   * C'était un effet — « quand `open` passe à vrai, recalcule l'index ». Un
   * effet qui appelle setState dans son corps déclenche un rendu en cascade et
   * ne synchronise rien avec l'extérieur : l'index dépend de l'ouverture, il se
   * calcule donc AU MOMENT d'ouvrir, pas en réaction à l'ouverture.
   */
  const openMenu = useCallback(() => {
    const idx = list.findIndex((e) => e.slug === current)
    setActiveIndex(idx >= 0 ? idx : 0)
    setOpen(true)
  }, [list, current])

  const switchTo = useCallback(
    (target: Ecosystem) => {
      setOpen(false)
      if (target.slug === current) return
      const href = ecosystemHref({
        host: window.location.host,
        slug: target.slug,
        protocol: window.location.protocol,
        // LE CHEMIN EST CONSERVÉ : on bascule sans perdre le fil de sa
        // navigation. `usePathname` de next/navigation porte le préfixe de
        // locale, ce qui est exactement ce qu'il faut à une URL absolue.
        pathname,
        search: window.location.search,
      })
      if (!href) return
      // Navigation COMPLÈTE, pas un push client : on change d'origine.
      window.location.assign(href)
    },
    [current, pathname],
  )

  // Un seul écosystème atteignable (tout expert, et toute plateforme
  // mono-écosystème) : AUCUN rendu. Un menu déroulant à une entrée suggère un
  // choix qui n'existe pas.
  if (list.length < 2) return null

  // L'hôte ne permet pas la bascule — développement local, où l'écosystème
  // vient de DEV_DOMAIN_SLUG et non du sous-domaine. On le DIT, au lieu
  // d'offrir un menu dont chaque entrée serait sans effet.
  const swappable =
    typeof window !== 'undefined' &&
    ecosystemHref({ host: window.location.host, slug: list[0].slug }) !== null

  const currentItem = list.find((e) => e.slug === current) ?? null

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openMenu()
    }
  }

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % list.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + list.length) % list.length)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      switchTo(list[activeIndex])
      triggerRef.current?.focus()
    }
  }

  const dot = (color: string | null) => (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        flexShrink: 0,
        background: color ?? 'var(--sk-border, #cbd5e1)',
        boxShadow: color ? `0 0 0 2px ${color}22` : undefined,
      }}
    />
  )

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', fontFamily: 'var(--font-jakarta), system-ui, sans-serif' }}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={!swappable}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('aria')}
        title={swappable ? t('current', { name: currentItem?.name ?? '' }) : t('unavailable_here')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          background: '#fff',
          border: '1.5px solid #e2e8f0',
          borderRadius: 10,
          padding: '8px 12px',
          fontSize: 13,
          fontWeight: 600,
          color: swappable ? '#0f172a' : '#94a3b8',
          cursor: swappable ? 'pointer' : 'not-allowed',
          minHeight: 36,
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          maxWidth: 220,
        }}
      >
        {dot(currentItem?.color ?? null)}
        <span
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {currentItem?.name ?? t('label')}
        </span>
        <svg
          aria-hidden
          width="10"
          height="10"
          viewBox="0 0 12 12"
          style={{
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 0.18s ease',
          }}
        >
          <path
            d="M2 4l4 4 4-4"
            stroke="#64748b"
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && swappable && (
        <ul
          role="listbox"
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          aria-label={t('aria')}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 240,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            boxShadow: '0 10px 28px rgba(15, 23, 42, 0.12)',
            padding: 6,
            margin: 0,
            listStyle: 'none',
            zIndex: 200,
            animation: 'sk-eco-pop 0.16s ease-out',
          }}
          autoFocus
        >
          <style>{`@keyframes sk-eco-pop { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
          <li
            aria-hidden
            style={{
              padding: '6px 14px 8px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              color: '#94a3b8',
            }}
          >
            {t('label')}
          </li>
          {list.map((eco, i) => {
            const active = eco.slug === current
            const focused = i === activeIndex
            return (
              <li
                key={eco.id}
                role="option"
                aria-selected={active}
                onClick={() => switchTo(eco)}
                onMouseEnter={() => setActiveIndex(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  color: active ? '#0ea5e9' : '#0f172a',
                  background: active ? '#f0f9ff' : focused ? '#f8fafc' : 'transparent',
                  cursor: 'pointer',
                  minHeight: 40,
                  transition: 'background 0.12s ease',
                }}
              >
                {dot(eco.color)}
                <span style={{ flex: 1 }}>{eco.name}</span>
                {active && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M5 13l4 4L19 7"
                      stroke="#0ea5e9"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
