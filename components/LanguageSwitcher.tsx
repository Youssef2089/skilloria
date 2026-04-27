'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/navigation'
import { routing, type Locale } from '@/i18n/routing'

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  es: 'Español',
  de: 'Deutsch',
}

const LOCALE_SHORT: Record<Locale, string> = {
  fr: 'FR',
  en: 'EN',
  es: 'ES',
  de: 'DE',
}

export default function LanguageSwitcher() {
  const t = useTranslations('common')
  const router = useRouter()
  const pathname = usePathname()
  const currentLocale = useLocale() as Locale

  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const locales = routing.locales as readonly Locale[]

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  useEffect(() => {
    if (open) {
      const idx = locales.indexOf(currentLocale)
      setActiveIndex(idx >= 0 ? idx : 0)
    }
  }, [open, currentLocale, locales])

  const switchTo = (target: Locale) => {
    setOpen(false)
    if (target === currentLocale) return
    router.replace(pathname, { locale: target })
  }

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setOpen(true)
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
      setActiveIndex((i) => (i + 1) % locales.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + locales.length) % locales.length)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      switchTo(locales[activeIndex])
      triggerRef.current?.focus()
      return
    }
  }

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', fontFamily: 'var(--font-jakarta), system-ui, sans-serif' }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('language_switcher_aria')}
        title={t('language_switcher_current', {
          locale: LOCALE_LABELS[currentLocale],
        })}
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
          color: '#0f172a',
          cursor: 'pointer',
          minHeight: 36,
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <span aria-hidden style={{ fontSize: 14 }}>🌐</span>
        <span>{LOCALE_SHORT[currentLocale]}</span>
        <svg
          aria-hidden
          width="10"
          height="10"
          viewBox="0 0 12 12"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.18s ease' }}
        >
          <path d="M2 4l4 4 4-4" stroke="#64748b" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          aria-label={t('language_switcher_aria')}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 180,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            boxShadow: '0 10px 28px rgba(15, 23, 42, 0.12)',
            padding: 6,
            margin: 0,
            listStyle: 'none',
            zIndex: 200,
            animation: 'sk-lang-pop 0.16s ease-out',
          }}
          autoFocus
        >
          <style>{`@keyframes sk-lang-pop { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
          {locales.map((loc, i) => {
            const active = loc === currentLocale
            const focused = i === activeIndex
            return (
              <li
                key={loc}
                role="option"
                aria-selected={active}
                onClick={() => switchTo(loc)}
                onMouseEnter={() => setActiveIndex(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  color: active ? '#0ea5e9' : '#0f172a',
                  background: active
                    ? '#f0f9ff'
                    : focused
                      ? '#f8fafc'
                      : 'transparent',
                  cursor: 'pointer',
                  minHeight: 40,
                  transition: 'background 0.12s ease',
                }}
              >
                <span>{LOCALE_LABELS[loc]}</span>
                {active && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M5 13l4 4L19 7" stroke="#0ea5e9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
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
