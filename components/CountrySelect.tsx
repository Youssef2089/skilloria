'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

export type Country = {
  code: string
  name_fr: string
  name_en: string
  name_es: string
  name_de: string
  flag_emoji: string
  sort_order: number
}

type Props = {
  value: string
  onChange: (code: string) => void
  primaryColor: string
  hasError?: boolean
}

let countriesCache: Country[] | null = null
let countriesPromise: Promise<Country[]> | null = null

async function loadCountries(): Promise<Country[]> {
  if (countriesCache) return countriesCache
  if (countriesPromise) return countriesPromise
  countriesPromise = fetch('/api/countries')
    .then((r) => (r.ok ? r.json() : []))
    .then((data: unknown) => {
      const arr = Array.isArray(data) ? (data as Country[]) : []
      countriesCache = arr
      return arr
    })
    .catch(() => {
      countriesPromise = null
      return []
    })
  return countriesPromise
}

function nameFor(c: Country, locale: string): string {
  switch (locale) {
    case 'en':
      return c.name_en
    case 'es':
      return c.name_es
    case 'de':
      return c.name_de
    case 'fr':
    default:
      return c.name_fr
  }
}

export default function CountrySelect({
  value,
  onChange,
  primaryColor,
  hasError,
}: Props) {
  const t = useTranslations('profile_validation')
  const locale = useLocale()

  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [countries, setCountries] = useState<Country[] | null>(countriesCache)
  const [loading, setLoading] = useState(countriesCache === null)

  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    if (countriesCache) {
      setCountries(countriesCache)
      setLoading(false)
      return
    }
    setLoading(true)
    loadCountries().then((arr) => {
      if (cancelled) return
      setCountries(arr)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

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
      // focus search after pop-in
      const id = window.setTimeout(() => searchRef.current?.focus(), 30)
      return () => window.clearTimeout(id)
    }
  }, [open])

  const selected = useMemo(
    () => (countries ?? []).find((c) => c.code === value) ?? null,
    [countries, value],
  )

  const filtered = useMemo(() => {
    const list = countries ?? []
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((c) =>
      nameFor(c, locale).toLowerCase().includes(q),
    )
  }, [countries, search, locale])

  useEffect(() => {
    setActiveIndex(0)
  }, [search])

  const select = (code: string) => {
    onChange(code)
    setOpen(false)
    setSearch('')
    triggerRef.current?.focus()
  }

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(0, i - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const c = filtered[activeIndex]
      if (c) select(c.code)
      return
    }
  }

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setOpen(true)
    }
  }

  const triggerStyle: React.CSSProperties = {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: '10px 14px',
    border: `1.5px solid ${hasError ? '#dc2626' : '#e2e8f0'}`,
    borderRadius: 10,
    fontSize: 14,
    color: '#0f172a',
    outline: 'none',
    background: '#fff',
    cursor: 'pointer',
    minHeight: 42,
    fontFamily: 'inherit',
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={triggerStyle}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {selected ? (
            <>
              <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{selected.flag_emoji}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {nameFor(selected, locale)}
              </span>
            </>
          ) : (
            <span style={{ color: '#94a3b8' }}>{t('country_placeholder')}</span>
          )}
        </span>
        <svg
          aria-hidden
          width="12"
          height="12"
          viewBox="0 0 12 12"
          style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.18s ease' }}
        >
          <path d="M2 4l4 4 4-4" stroke="#64748b" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            boxShadow: '0 10px 28px rgba(15, 23, 42, 0.12)',
            zIndex: 200,
            overflow: 'hidden',
            animation: 'sk-country-pop 0.16s ease-out',
          }}
        >
          <style>{`@keyframes sk-country-pop { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
          <div style={{ padding: 8, borderBottom: '1px solid #f1f5f9' }}>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder={t('country_search_placeholder')}
              aria-label={t('country_search_placeholder')}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                fontSize: 13,
                color: '#0f172a',
                outline: 'none',
                background: '#f8fafc',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <ul
            role="listbox"
            aria-label={t('country_label')}
            style={{
              maxHeight: 280,
              overflowY: 'auto',
              margin: 0,
              padding: 4,
              listStyle: 'none',
            }}
          >
            {loading && (
              <li
                style={{
                  padding: '12px 14px',
                  fontSize: 13,
                  color: '#94a3b8',
                  textAlign: 'center',
                  fontFamily: 'var(--font-jakarta), system-ui, sans-serif',
                }}
              >
                {t('country_loading')}
              </li>
            )}

            {!loading && filtered.length === 0 && (
              <li
                style={{
                  padding: '12px 14px',
                  fontSize: 13,
                  color: '#94a3b8',
                  textAlign: 'center',
                  fontFamily: 'var(--font-jakarta), system-ui, sans-serif',
                }}
              >
                {t('country_empty')}
              </li>
            )}

            {!loading &&
              filtered.map((c, i) => {
                const isSelected = c.code === value
                const isActive = i === activeIndex
                return (
                  <li
                    key={c.code}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => select(c.code)}
                    onMouseEnter={() => setActiveIndex(i)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '10px 14px',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: isSelected ? 700 : 500,
                      color: isSelected ? primaryColor : '#0f172a',
                      background: isSelected
                        ? `${primaryColor}10`
                        : isActive
                          ? '#f8fafc'
                          : 'transparent',
                      cursor: 'pointer',
                      minHeight: 40,
                      transition: 'background 0.12s ease',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{c.flag_emoji}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {nameFor(c, locale)}
                      </span>
                    </span>
                    {isSelected && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M5 13l4 4L19 7" stroke={primaryColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </li>
                )
              })}
          </ul>
        </div>
      )}
    </div>
  )
}
