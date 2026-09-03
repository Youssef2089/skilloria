'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'
import { isValidEcosystemSlug } from '@/lib/ecosystem-url'

/**
 * /admin/ecosystemes — LE PARC D'ÉCOSYSTÈMES.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ CET ÉCRAN DIT CE QU'IL NE PEUT PAS FAIRE.                                ║
 * ║                                                                          ║
 * ║ Créer un écosystème ici ne le rend pas atteignable : le sous-domaine se  ║
 * ║ déclare chez l'hébergeur, et sans branche personne ne peut s'y inscrire. ║
 * ║ Ces deux étapes sont AFFICHÉES, avec leur état — un écran qui masque le  ║
 * ║ travail restant fait croire que c'est fini, et on découvre le trou le    ║
 * ║ jour du lancement.                                                       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Page de MENU (dérivée de ADMIN_NAV_SECTIONS) → aucun bouton Retour.
 */

const LOCALES = ['en', 'es', 'de'] as const

type Counts = { branches: number; specialities: number; users: number; publications: number }
type Eco = {
  id: string
  slug: string
  name: string
  tagline: string | null
  active: boolean
  launch_date: string | null
  has_config: boolean
  primary_color: string | null
  secondary_color: string | null
  logo_url: string | null
  counts: Counts
  ready: boolean
}

type Detail = {
  ecosystem: {
    id: string
    slug: string
    name: string
    tagline: string | null
    description: string | null
    active: boolean
    launch_date: string | null
  }
  config: Record<string, unknown> | null
  translations: Record<string, Record<string, string>>
  translatable: { domains: string[]; domain_configs: string[] }
  branches_count: number
  ready: boolean
}

type Impact = {
  ecosystem: { id: string; slug: string; name: string; active: boolean }
  keeps_access: { experts: number | null }
  loses_access: { organisation_accounts: number | null }
  preserved: {
    publications: number | null
    published: number | null
    candidatures: number | null
    conversations: number | null
  }
  taxonomy: { branches: number | null; specialities: number | null }
}

const card: React.CSSProperties = {
  background: 'var(--color-background-primary, #fff)',
  border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
  borderRadius: 12,
  padding: '18px 22px',
  marginBottom: 18,
}
const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  color: 'var(--color-text-secondary, #64748b)',
  marginBottom: 12,
}
const input: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  fontSize: 13.5,
  fontFamily: 'inherit',
  background: '#fff',
  color: '#0f172a',
}
const label: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#475569',
  marginBottom: 5,
}
const btn = (kind: 'primary' | 'ghost' | 'danger'): React.CSSProperties => ({
  padding: '9px 15px',
  borderRadius: 9,
  fontSize: 13.5,
  fontWeight: 600,
  cursor: 'pointer',
  border: kind === 'ghost' ? '1px solid #e2e8f0' : 'none',
  background: kind === 'primary' ? '#0ea5e9' : kind === 'danger' ? '#dc2626' : '#fff',
  color: kind === 'ghost' ? '#0f172a' : '#fff',
})

/** Un compteur en panne vaut `null` : on affiche « — », jamais un zéro trompeur. */
function Num({ v }: { v: number | null }) {
  return <>{v === null ? '—' : v.toLocaleString('fr-FR')}</>
}

export default function AdminEcosystemesPage() {
  const t = useTranslations('admin_ecosystemes')
  const secureFetch = useSecureFetch()

  const [list, setList] = useState<Eco[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', slug: '', tagline: '', primary_color: '#0078D4' })
  const [justCreated, setJustCreated] = useState<{ slug: string; name: string } | null>(null)

  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [tr, setTr] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState(false)

  const [impact, setImpact] = useState<Impact | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await secureFetch('/api/admin/ecosystemes')
      if (!res.ok) { setError(t('errors.load')); return }
      const b = (await res.json()) as { ecosystems: Eco[] }
      setList(b.ecosystems ?? [])
    } catch {
      setError(t('errors.load'))
    }
  }, [secureFetch, t])

  useEffect(() => { void load() }, [load])

  const openDetail = async (id: string) => {
    setOpenId(id); setDetail(null); setDraft({}); setImpact(null); setConfirmOff(false)
    try {
      const res = await secureFetch(`/api/admin/ecosystemes/${id}`)
      if (!res.ok) { setMsg({ kind: 'err', text: t('errors.load') }); return }
      const d = (await res.json()) as Detail
      setDetail(d)
      setTr(d.translations ?? {})
    } catch {
      setMsg({ kind: 'err', text: t('errors.load') })
    }
  }

  const create = async () => {
    setMsg(null)
    if (!form.name.trim()) { setMsg({ kind: 'err', text: t('errors.name_required') }); return }
    if (!isValidEcosystemSlug(form.slug.trim().toLowerCase())) {
      setMsg({ kind: 'err', text: t('errors.invalid_slug') }); return
    }
    setCreating(true)
    try {
      const res = await secureFetch('/api/admin/ecosystemes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, slug: form.slug.trim().toLowerCase() }),
      })
      const payload = (await res.json().catch(() => ({}))) as { code?: string }
      if (!res.ok) {
        setMsg({
          kind: 'err',
          text: payload.code === 'slug_taken' ? t('errors.slug_taken') : t('errors.generic'),
        })
        return
      }
      setJustCreated({ slug: form.slug.trim().toLowerCase(), name: form.name.trim() })
      setForm({ name: '', slug: '', tagline: '', primary_color: '#0078D4' })
      await load()
    } catch {
      setMsg({ kind: 'err', text: t('errors.generic') })
    } finally {
      setCreating(false)
    }
  }

  const save = async (extra?: Record<string, unknown>) => {
    if (!detail) return
    setSaving(true); setMsg(null)
    try {
      const res = await secureFetch(`/api/admin/ecosystemes/${detail.ecosystem.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, ...extra, translations: tr }),
      })
      if (!res.ok) { setMsg({ kind: 'err', text: t('errors.generic') }); return }
      setMsg({ kind: 'ok', text: t('saved') })
      setConfirmOff(false)
      await load()
      await openDetail(detail.ecosystem.id)
    } catch {
      setMsg({ kind: 'err', text: t('errors.generic') })
    } finally {
      setSaving(false)
    }
  }

  const askImpact = async (id: string) => {
    setImpact(null); setConfirmOff(true)
    try {
      const res = await secureFetch(`/api/admin/ecosystemes/${id}/impact`)
      if (res.ok) setImpact((await res.json()) as Impact)
    } catch { /* l'écran affiche « — » */ }
  }

  const field = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }))
  const trField = (key: string, loc: string, v: string) =>
    setTr((x) => ({ ...x, [key]: { ...(x[key] ?? {}), [loc]: v } }))

  const cur = <T,>(k: string, fallback: T): T =>
    (Object.prototype.hasOwnProperty.call(draft, k) ? (draft[k] as T) : fallback)

  // ── Rendu ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.4px', margin: '0 0 6px' }}>
        {t('page_title')}
      </h1>
      <p style={{ fontSize: 13.5, color: '#64748b', margin: '0 0 22px' }}>{t('subtitle')}</p>

      {msg && (
        <div
          role="status"
          style={{
            ...card,
            marginBottom: 14,
            background: msg.kind === 'ok' ? '#f0fdf4' : '#fef2f2',
            borderColor: msg.kind === 'ok' ? '#bbf7d0' : '#fecaca',
            color: msg.kind === 'ok' ? '#166534' : '#991b1b',
            fontSize: 13.5,
          }}
        >
          {msg.text}
        </div>
      )}

      {/* ── CE QU'IL RESTE À FAIRE, après création ─────────────────────────── */}
      {justCreated && (
        <div style={{ ...card, background: '#fffbeb', borderColor: '#fde68a' }}>
          <h2 style={{ ...sectionTitle, color: '#92400e' }}>{t('after_create.title')}</h2>
          <p style={{ fontSize: 13.5, color: '#78350f', margin: '0 0 12px' }}>
            {t('after_create.intro', { name: justCreated.name })}
          </p>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, color: '#78350f', lineHeight: 1.7 }}>
            <li>{t('after_create.step_host', { slug: justCreated.slug })}</li>
            <li>{t('after_create.step_dns', { slug: justCreated.slug })}</li>
            <li>{t('after_create.step_branch')}</li>
            <li>{t('after_create.step_activate')}</li>
          </ol>
          <button type="button" onClick={() => setJustCreated(null)} style={{ ...btn('ghost'), marginTop: 14 }}>
            {t('after_create.dismiss')}
          </button>
        </div>
      )}

      {/* ── CRÉATION ───────────────────────────────────────────────────────── */}
      <div style={card}>
        <h2 style={sectionTitle}>{t('create.title')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div>
            <label style={label} htmlFor="eco-name">{t('fields.name')}</label>
            <input id="eco-name" style={input} value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label style={label} htmlFor="eco-slug">{t('fields.slug')}</label>
            <input id="eco-slug" style={input} value={form.slug} placeholder="sap"
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} />
            {/* Validation INLINE : le slug est un sous-domaine, une faute ici
                produit un écosystème injoignable. On le dit à la saisie. */}
            {form.slug.trim() !== '' && !isValidEcosystemSlug(form.slug.trim().toLowerCase()) && (
              <p style={{ fontSize: 12, color: '#b91c1c', margin: '5px 0 0' }}>{t('errors.invalid_slug')}</p>
            )}
          </div>
          <div>
            <label style={label} htmlFor="eco-tagline">{t('fields.tagline')}</label>
            <input id="eco-tagline" style={input} value={form.tagline}
              onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))} />
          </div>
          <div>
            <label style={label} htmlFor="eco-color">{t('fields.primary_color')}</label>
            <input id="eco-color" type="color" style={{ ...input, padding: 4, height: 38 }}
              value={form.primary_color}
              onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))} />
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: '#64748b', margin: '12px 0 0' }}>{t('create.born_inactive')}</p>
        <button type="button" onClick={() => void create()} disabled={creating}
          style={{ ...btn('primary'), marginTop: 12, opacity: creating ? 0.6 : 1 }}>
          {creating ? t('create.pending') : t('create.submit')}
        </button>
      </div>

      {/* ── LISTE ──────────────────────────────────────────────────────────── */}
      {error && <div style={{ ...card, color: '#991b1b' }}>{error}</div>}
      {!error && list === null && <div style={{ ...card, color: '#64748b', fontSize: 13.5 }}>{t('loading')}</div>}
      {list?.length === 0 && <div style={{ ...card, color: '#64748b', fontSize: 13.5 }}>{t('empty')}</div>}

      {list?.map((e) => (
        <div key={e.id} style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span aria-hidden style={{
              width: 12, height: 12, borderRadius: 999, flexShrink: 0,
              background: e.primary_color ?? '#cbd5e1',
            }} />
            <strong style={{ fontSize: 15.5 }}>{e.name}</strong>
            <code style={{ fontSize: 12.5, color: '#64748b' }}>{e.slug}</code>

            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
              background: e.active ? '#dcfce7' : '#f1f5f9',
              color: e.active ? '#166534' : '#64748b',
            }}>
              {e.active ? t('state.active') : t('state.inactive')}
            </span>

            {/* « NON PRÊT » — sans branche, ni inscription ni annonce. */}
            {!e.ready && (
              <span title={t('state.not_ready_hint')} style={{
                fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                background: '#fef3c7', color: '#92400e',
              }}>
                {t('state.not_ready')}
              </span>
            )}

            <button type="button" onClick={() => void (openId === e.id ? setOpenId(null) : openDetail(e.id))}
              style={{ ...btn('ghost'), marginLeft: 'auto' }}>
              {openId === e.id ? t('close') : t('edit')}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 20, marginTop: 12, fontSize: 12.5, color: '#64748b', flexWrap: 'wrap' }}>
            <span>{t('counts.branches', { n: e.counts.branches })}</span>
            <span>{t('counts.specialities', { n: e.counts.specialities })}</span>
            <span>{t('counts.users', { n: e.counts.users })}</span>
            <span>{t('counts.publications', { n: e.counts.publications })}</span>
          </div>

          {/* ── PANNEAU D'ÉDITION ──────────────────────────────────────────── */}
          {openId === e.id && detail && (
            <div style={{ marginTop: 18, borderTop: '1px solid #e2e8f0', paddingTop: 18 }}>
              {!detail.ready && (
                <div style={{
                  padding: '12px 14px', borderRadius: 10, background: '#fffbeb',
                  border: '1px solid #fde68a', color: '#78350f', fontSize: 13, marginBottom: 16,
                }}>
                  {t('state.not_ready_detail')}
                </div>
              )}

              <h3 style={sectionTitle}>{t('sections.identity')}</h3>
              <div style={{ display: 'grid', gap: 12, marginBottom: 18 }}>
                <div>
                  <label style={label} htmlFor={`n-${e.id}`}>{t('fields.name')} (FR)</label>
                  <input id={`n-${e.id}`} style={input}
                    value={cur('name', detail.ecosystem.name)}
                    onChange={(ev) => field('name', ev.target.value)} />
                  <TrRow keyName="domains.name" tr={tr} onChange={trField} t={t} />
                </div>
                <div>
                  <label style={label} htmlFor={`tg-${e.id}`}>{t('fields.tagline')} (FR)</label>
                  <input id={`tg-${e.id}`} style={input}
                    value={cur('tagline', detail.ecosystem.tagline ?? '')}
                    onChange={(ev) => field('tagline', ev.target.value)} />
                  <TrRow keyName="domains.tagline" tr={tr} onChange={trField} t={t} />
                </div>
                <div>
                  {/* Traductions SEULES : ce champ n'a pas de colonne en base,
                      son français EST le nom ci-dessus. Il était déclaré
                      traduisible et lu par getDomainConfig, mais aucun écran ne
                      permettait de le renseigner — une traduction impossible à
                      saisir est une traduction qui n'existera jamais. */}
                  <label style={label}>{t('fields.ecosystem_name')}</label>
                  <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 5px' }}>
                    {t('fields.ecosystem_name_hint')}
                  </p>
                  <TrRow keyName="domains.ecosystem_name" tr={tr} onChange={trField} t={t} />
                </div>
                <div>
                  <label style={label} htmlFor={`ds-${e.id}`}>{t('fields.description')}</label>
                  <textarea id={`ds-${e.id}`} rows={3} style={{ ...input, resize: 'vertical' }}
                    value={cur('description', detail.ecosystem.description ?? '')}
                    onChange={(ev) => field('description', ev.target.value)} />
                </div>
                <div>
                  <label style={label} htmlFor={`ld-${e.id}`}>{t('fields.launch_date')}</label>
                  <input id={`ld-${e.id}`} type="date" style={input}
                    value={cur('launch_date', detail.ecosystem.launch_date ?? '')}
                    onChange={(ev) => field('launch_date', ev.target.value)} />
                </div>
                <div>
                  <label style={label} htmlFor={`tg2-${e.id}`}>{t('fields.tags')}</label>
                  <input id={`tg2-${e.id}`} style={input}
                    placeholder={t('fields.tags_hint')}
                    value={
                      Object.prototype.hasOwnProperty.call(draft, 'tags')
                        ? (draft.tags as string[]).join(', ')
                        : ((detail.config?.tags as string[] | undefined) ?? []).join(', ')
                    }
                    onChange={(ev) =>
                      // Saisie libre séparée par des virgules → tableau. Le
                      // serveur refiltre : ce découpage est un confort, pas
                      // une garantie.
                      field('tags', ev.target.value.split(',').map((x) => x.trim()).filter(Boolean))
                    } />
                </div>
                <div>
                  <label style={label} htmlFor={`sl-${e.id}`}>{t('fields.slug')}</label>
                  <input id={`sl-${e.id}`} style={{ ...input, background: '#f8fafc', color: '#64748b' }}
                    value={detail.ecosystem.slug} readOnly />
                  <p style={{ fontSize: 12, color: '#64748b', margin: '5px 0 0' }}>{t('fields.slug_locked')}</p>
                </div>
              </div>

              <h3 style={sectionTitle}>{t('sections.vocabulary')}</h3>
              <div style={{ display: 'grid', gap: 12, marginBottom: 18 }}>
                {detail.translatable.domain_configs.map((f) => (
                  <div key={f}>
                    <label style={label} htmlFor={`${f}-${e.id}`}>{t(`fields.${f}`)} (FR)</label>
                    <input id={`${f}-${e.id}`} style={input}
                      value={cur(f, (detail.config?.[f] as string) ?? '')}
                      onChange={(ev) => field(f, ev.target.value)} />
                    <TrRow keyName={`domain_configs.${f}`} tr={tr} onChange={trField} t={t} />
                  </div>
                ))}
              </div>

              <h3 style={sectionTitle}>{t('sections.branding')}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
                {(['primary_color', 'secondary_color'] as const).map((f) => (
                  <div key={f}>
                    <label style={label} htmlFor={`${f}-${e.id}`}>{t(`fields.${f}`)}</label>
                    <input id={`${f}-${e.id}`} type="color" style={{ ...input, padding: 4, height: 38 }}
                      value={cur(f, (detail.config?.[f] as string) ?? '#0078D4')}
                      onChange={(ev) => field(f, ev.target.value)} />
                  </div>
                ))}
                {(['logo_url', 'favicon_url'] as const).map((f) => (
                  <div key={f}>
                    <label style={label} htmlFor={`${f}-${e.id}`}>{t(`fields.${f}`)}</label>
                    <input id={`${f}-${e.id}`} style={input}
                      value={cur(f, (detail.config?.[f] as string) ?? '')}
                      onChange={(ev) => field(f, ev.target.value)} />
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => void save()} disabled={saving} style={{ ...btn('primary'), opacity: saving ? 0.6 : 1 }}>
                  {saving ? t('saving') : t('save')}
                </button>

                {/* ── ACTIVATION / DÉSACTIVATION ─────────────────────────── */}
                {detail.ecosystem.active ? (
                  <button type="button" onClick={() => void askImpact(e.id)} style={btn('ghost')}>
                    {t('deactivate.open')}
                  </button>
                ) : (
                  <button type="button" onClick={() => void save({ active: true })} style={btn('ghost')}>
                    {t('activate')}
                  </button>
                )}
              </div>

              {/* ── LES VOLUMES RÉELS, AVANT DE BASCULER ───────────────────── */}
              {confirmOff && (
                <div style={{
                  marginTop: 16, padding: '16px 18px', borderRadius: 12,
                  background: '#fef2f2', border: '1px solid #fecaca',
                }}>
                  <h3 style={{ ...sectionTitle, color: '#991b1b' }}>{t('deactivate.title')}</h3>
                  {!impact ? (
                    <p style={{ fontSize: 13, color: '#7f1d1d', margin: 0 }}>{t('loading')}</p>
                  ) : (
                    <>
                      <p style={{ fontSize: 13.5, color: '#7f1d1d', margin: '0 0 12px', lineHeight: 1.6 }}>
                        {t('deactivate.keeps', { n: impact.keeps_access.experts ?? 0 })}
                      </p>
                      <p style={{ fontSize: 13.5, color: '#7f1d1d', margin: '0 0 12px', lineHeight: 1.6 }}>
                        {t('deactivate.loses', { n: impact.loses_access.organisation_accounts ?? 0 })}
                      </p>
                      <ul style={{ margin: '0 0 12px', paddingLeft: 20, fontSize: 13, color: '#7f1d1d', lineHeight: 1.7 }}>
                        <li>{t('deactivate.published')} : <strong><Num v={impact.preserved.published} /></strong></li>
                        <li>{t('deactivate.publications')} : <strong><Num v={impact.preserved.publications} /></strong></li>
                        <li>{t('deactivate.candidatures')} : <strong><Num v={impact.preserved.candidatures} /></strong></li>
                        <li>{t('deactivate.conversations')} : <strong><Num v={impact.preserved.conversations} /></strong></li>
                      </ul>
                      <p style={{ fontSize: 13, color: '#7f1d1d', margin: '0 0 14px' }}>{t('deactivate.reversible')}</p>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button type="button" onClick={() => void save({ active: false })} disabled={saving} style={btn('danger')}>
                          {t('deactivate.confirm')}
                        </button>
                        <button type="button" onClick={() => setConfirmOff(false)} style={btn('ghost')}>
                          {t('deactivate.cancel')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** Les trois langues non françaises d'un champ. Vide = la traduction est SUPPRIMÉE. */
function TrRow({
  keyName,
  tr,
  onChange,
  t,
}: {
  keyName: string
  tr: Record<string, Record<string, string>>
  onChange: (key: string, loc: string, v: string) => void
  t: (k: string, v?: Record<string, string | number>) => string
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 7 }}>
      {LOCALES.map((loc) => (
        <div key={loc}>
          <label
            htmlFor={`${keyName}-${loc}`}
            style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 3 }}
          >
            {loc.toUpperCase()}
          </label>
          <input
            id={`${keyName}-${loc}`}
            style={{ ...input, fontSize: 12.5, padding: '7px 9px' }}
            placeholder={t('fields.fallback_fr')}
            value={tr[keyName]?.[loc] ?? ''}
            onChange={(e) => onChange(keyName, loc, e.target.value)}
          />
        </div>
      ))}
    </div>
  )
}
