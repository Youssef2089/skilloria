'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { chargerPays, paysEnCache } from '@/lib/pays/referentiel-client'

export type Country = {
  code: string
  name_fr: string
  name_en: string
  name_es: string
  name_de: string
  flag_emoji: string
  /**
   * Indicatif téléphonique (`+216`). Vient du référentiel en base — la colonne
   * existe pour les 64 pays, mais `/api/countries` ne la renvoyait pas, si bien
   * qu'aucun sélecteur ne pouvait servir à saisir un téléphone. C'est ce manque
   * qui a laissé un « 🇫🇷 » figé sur les écrans d'inscription.
   *
   * Optionnel dans le type : un client déployé avant la correction de la route
   * ne le reçoit pas, et l'écran doit dégrader, pas planter.
   */
  phone_code?: string | null
  sort_order: number
}

type Props = {
  value: string
  onChange: (code: string) => void
  primaryColor: string
  hasError?: boolean
  /**
   * `complet` (défaut) : drapeau + nom du pays — le sélecteur d'adresse.
   * `compact` : drapeau + indicatif — celui qui précède un champ téléphone, où
   * la place est comptée et où l'indicatif est l'information utile.
   *
   * UNE SEULE implémentation de sélecteur, deux rendus. En écrire un second
   * pour le téléphone aurait recréé exactement la divergence que ce lot ferme.
   */
  variant?: 'complet' | 'compact'
  /** Désactive le sélecteur (numéro déjà vérifié, formulaire en cours d'envoi). */
  disabled?: boolean
  /** Rattachement ARIA au libellé du champ qu'il précède. */
  ariaLabel?: string
}

/**
 * LE CHARGEMENT A DÉMÉNAGÉ dans [lib/pays/referentiel-client](../lib/pays/referentiel-client.ts).
 *
 * Il vivait ici, avec son cache privé. TROIS écrans en ont désormais besoin —
 * ce sélecteur, la saisie du numéro d'identification à l'inscription, et la
 * même saisie dans la modale post-connexion. Chacun aurait refait son `fetch`,
 * et le dépôt a déjà payé ce prix trois fois sur la saisie de téléphone
 * (§E.14). On sort le chargement AVANT qu'il ne se duplique, pas après.
 */

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
  variant = 'complet',
  disabled = false,
  ariaLabel,
}: Props) {
  const compact = variant === 'compact'
  const t = useTranslations('profile_validation.sections.contact')
  const locale = useLocale()

  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [countries, setCountries] = useState<Country[] | null>(paysEnCache())
  const [loading, setLoading] = useState(paysEnCache() === null)

  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    const dejaLa = paysEnCache()
    if (dejaLa) {
      setCountries(dejaLa)
      setLoading(false)
      return
    }
    setLoading(true)
    chargerPays().then((arr) => {
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
    // La recherche porte AUSSI sur l'indicatif et sur le code ISO : sur 64 pays
    // et un clavier de téléphone, taper « 216 » ou « TN » est plus rapide que
    // « Tunisie » — et quelqu'un qui connaît son indicatif ne connaît pas
    // forcément l'orthographe de son pays dans la langue de l'interface.
    return list.filter(
      (c) =>
        nameFor(c, locale).toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        (c.phone_code ?? '').replace('+', '').includes(q.replace('+', '')),
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
    gap: compact ? 6 : 10,
    padding: compact ? '10px 10px' : '10px 14px',
    border: `1.5px solid ${hasError ? '#dc2626' : '#e2e8f0'}`,
    borderRadius: 10,
    fontSize: 14,
    color: disabled ? '#64748b' : '#0f172a',
    outline: 'none',
    background: disabled ? '#f1f5f9' : '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    // 44 px : cible tactile minimale recommandée. Un sélecteur de pays est un
    // point de friction classique sur téléphone, et c'est le premier geste de
    // la saisie — le rater fait abandonner l'inscription.
    minHeight: 44,
    fontFamily: 'inherit',
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { if (!disabled) setOpen((o) => !o) }}
        onKeyDown={onTriggerKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        style={triggerStyle}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: compact ? 6 : 10, minWidth: 0 }}>
          {selected ? (
            <>
              <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{selected.flag_emoji}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {compact ? (selected.phone_code ?? selected.code) : nameFor(selected, locale)}
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
            // En compact, le déclencheur ne fait qu'une centaine de pixels :
            // caler le panneau sur `right: 0` le rendrait illisible. On le
            // laisse déborder, sans jamais dépasser la largeur de l'écran —
            // sinon il sort du viewport sur un téléphone de 320 px.
            ...(compact
              ? { minWidth: 260, maxWidth: 'min(320px, calc(100vw - 32px))' }
              : { right: 0 }),
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
                      {/* L'indicatif reste visible DANS LA LISTE même en
                          compact : c'est ce qui permet de reconnaître son pays
                          quand on ne se souvient que de son indicatif. */}
                      {compact && c.phone_code && (
                        <span style={{ color: '#64748b', fontWeight: 500, flexShrink: 0 }}>{c.phone_code}</span>
                      )}
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
