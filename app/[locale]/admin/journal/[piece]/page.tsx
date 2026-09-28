'use client'

import { use, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import MasterDetail from '@/components/ui/MasterDetail'
import { estUuid, type PieceJournal } from '@/lib/journal/lecture'
import { Acteur, Montant, PastilleStatut, Quand, lienObjet, type Ligne } from '@/components/admin/journal/presentation'

/**
 * /admin/journal/[piece] — LA PIÈCE COMPLÈTE depuis une de ses lignes (§D.26,
 * phase B 2.6). Page de DÉTAIL : le bouton Retour est celui de la coquille
 * (GlobalBackButton), aucun autre.
 *
 * Toutes les écritures du geste, la pièce qu'il reprend (rejeu, contrepassation)
 * et celles qui le reprennent, et ce que les cinq journaux détaillés portent sous
 * la même pièce. Lecture EN BASE (`lire_piece`, bornée, AD002) ; une troncature
 * se dit, une panne aussi.
 */

type Props = { params: Promise<{ piece: string }> }

const carte: React.CSSProperties = {
  background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 12, padding: 16,
}
const etiquette: React.CSSProperties = { fontSize: 12, color: 'var(--sk-muted)', margin: 0 }
const valeur: React.CSSProperties = { fontSize: 13, color: 'var(--sk-text)', margin: '2px 0 0', overflowWrap: 'anywhere' }
const mono: React.CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }

export default function PiecePage({ params }: Props) {
  const { piece } = use(params)
  const t = useTranslations('admin_back_office.journal')
  const tA = useTranslations('journal.actions')
  const tO = useTranslations('journal.origines')
  const secureFetch = useSecureFetch()

  const [data, setData] = useState<PieceJournal | null>(null)
  const [etat, setEtat] = useState<'chargement' | 'pret' | 'erreur' | 'inconnue' | 'invalide'>(estUuid(piece) ? 'chargement' : 'invalide')
  const [choisie, setChoisie] = useState(0)

  useEffect(() => {
    if (!estUuid(piece)) return
    void (async () => {
      try {
        const res = await secureFetch(`/api/admin/journal/piece/${piece}`)
        if (res.status === 404) { setEtat('inconnue'); return }
        if (!res.ok) { setEtat('erreur'); return }
        setData((await res.json()) as PieceJournal)
        setEtat('pret')
      } catch {
        setEtat('erreur')
      }
    })()
  }, [piece, secureFetch])

  const titre = (
    <PageHeader
      flush
      title={t('piece_titre')}
      subtitle={<>{t('piece_intro')} <span style={mono}>{piece}</span></>}
    />
  )

  if (etat !== 'pret' || !data) {
    return (
      <div style={{ width: '100%', textAlign: 'left' }}>
        {titre}
        <div style={{ marginTop: 16 }}>
          {etat === 'chargement' && <p style={{ fontSize: 13, color: 'var(--sk-muted)' }}>{t('chargement')}</p>}
          {etat === 'erreur' && <p role="alert" style={{ fontSize: 13, color: 'var(--sk-red)' }}>{t('erreur')}</p>}
          {etat === 'inconnue' && <EmptyState title={t('piece_inconnue')} />}
          {etat === 'invalide' && <EmptyState title={t('piece_invalide')} />}
        </div>
      </div>
    )
  }

  const lignes = data.lignes as Ligne[]
  const l = lignes[Math.min(choisie, lignes.length - 1)]
  const objet = l ? lienObjet(l) : null
  const sj = data.sous_journaux
  const sousJournaux: Array<{ cle: string; titre: string; rangs: string[] }> = [
    { cle: 'audit', titre: t('sj_audit'), rangs: sj.audit_logs.map((x) => `${x.action} · ${x.entity_type}`) },
    { cle: 'ia', titre: t('sj_ia'), rangs: sj.ai_spend_events.map((x) => `${x.provider} · ${x.action ?? '—'} · ${Number(x.cost_usd).toFixed(4)} $`) },
    { cle: 'stripe', titre: t('sj_stripe'), rangs: sj.stripe_events.map((x) => `${x.type} · ${x.status}`) },
    { cle: 'taches', titre: t('sj_taches'), rangs: sj.cron_run_log.map((x) => `${x.job_name} · ${x.trigger_source}${x.http_status ? ` · ${x.http_status}` : ''}`) },
    { cle: 'notifications', titre: t('sj_notifications'), rangs: sj.notifications.map((x) => `${x.type} · ${x.channel} · ${x.status}`) },
  ]

  return (
    <div style={{ width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {titre}
      {data.tronquee && <p role="status" style={{ fontSize: 13, color: 'var(--sk-amber)', margin: 0 }}>{t('piece_tronquee')}</p>}

      <MasterDetail
        noPadding
        listWidth={340}
        detailVisible
        list={
          <div style={{ ...carte, padding: 8 }}>
            <p style={{ ...etiquette, padding: '6px 8px' }}>{t('piece_lignes')}</p>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {lignes.map((x, i) => (
                <li key={`${x.type_action}:${x.sujet_id ?? ''}:${i}`}>
                  <button
                    type="button"
                    onClick={() => setChoisie(i)}
                    aria-current={i === choisie}
                    style={{
                      width: '100%', textAlign: 'left', font: 'inherit', cursor: 'pointer', borderRadius: 8, padding: '8px 10px',
                      border: '1px solid transparent', display: 'grid', gap: 4,
                      background: i === choisie ? 'var(--sk-accent-soft)' : 'transparent', color: 'var(--sk-text)',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{tA(x.type_action)}</span>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--sk-muted)' }}>
                      <PastilleStatut statut={x.statut} /> <Quand iso={x.horodatage} />
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        }
        detail={
          l ? (
            <div style={{ ...carte, display: 'grid', gap: 12 }}>
              {/* Sur mobile, la liste est masquée : on choisit l'écriture ici. */}
              <style>{'@media (min-width: 768px) { .journal-choix { display: none; } }'}</style>
              <label className="journal-choix" style={{ ...etiquette, display: 'grid', gap: 4 }}>
                {t('piece_lignes')}
                <select
                  value={choisie}
                  onChange={(e) => setChoisie(Number(e.target.value))}
                  style={{ font: 'inherit', fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--sk-border)', background: 'var(--sk-surface)', color: 'var(--sk-text)' }}
                >
                  {lignes.map((x, i) => <option key={i} value={i}>{tA(x.type_action)}</option>)}
                </select>
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 15, color: 'var(--sk-text)' }}>{tA(l.type_action)}</strong>
                <PastilleStatut statut={l.statut} />
              </div>
              <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: 0 }}>
                <div><dt style={etiquette}>{t('ligne_quand')}</dt><dd style={valeur}><Quand iso={l.horodatage} /></dd></div>
                <div><dt style={etiquette}>{t('ligne_acteur')}</dt><dd style={valeur}><Acteur ligne={l} /></dd></div>
                <div><dt style={etiquette}>{t('ligne_origine')}</dt><dd style={valeur}>{tO(l.origine)}</dd></div>
                <div><dt style={etiquette}>{t('ligne_ecosysteme')}</dt><dd style={valeur}>{l.ecosysteme_nom ?? t('ecosysteme_aucun')}</dd></div>
                <div>
                  <dt style={etiquette}>{t('ligne_objet')}</dt>
                  <dd style={valeur}>
                    {l.sujet_type ? (
                      <>
                        <span style={mono}>{l.sujet_type}</span>
                        {objet && <> · <Link href={objet} style={{ color: 'var(--sk-accent)' }}>{t('ouvrir_objet')}</Link></>}
                      </>
                    ) : '—'}
                  </dd>
                </div>
                {(l.cout_usd != null || l.type_action === 'paiement_recu') && (
                  <div>
                    <dt style={etiquette}>{l.cout_usd != null ? t('ligne_cout') : t('ligne_montant')}</dt>
                    <dd style={valeur}><Montant ligne={l} /></dd>
                  </div>
                )}
              </dl>
              {(l.piece_origine || data.referencee_par.length > 0) && (
                <div style={{ display: 'grid', gap: 4 }}>
                  {l.piece_origine && (
                    <p style={{ ...valeur, margin: 0 }}>
                      {t('piece_origine')}{' '}
                      <Link href={`/admin/journal/${l.piece_origine}`} style={{ ...mono, color: 'var(--sk-accent)' }}>{l.piece_origine}</Link>
                    </p>
                  )}
                  {data.referencee_par.map((p) => (
                    <p key={p} style={{ ...valeur, margin: 0 }}>
                      {t('piece_referencee')}{' '}
                      <Link href={`/admin/journal/${p}`} style={{ ...mono, color: 'var(--sk-accent)' }}>{p}</Link>
                    </p>
                  ))}
                </div>
              )}
              <div>
                <p style={etiquette}>{t('detail_titre')}</p>
                {Object.keys(l.detail ?? {}).length === 0 ? (
                  <p style={{ ...valeur, color: 'var(--sk-muted)' }}>{t('detail_vide')}</p>
                ) : (
                  <pre style={{ ...mono, margin: '4px 0 0', padding: 10, borderRadius: 8, background: 'var(--sk-surface-2)', color: 'var(--sk-text)', overflowX: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {JSON.stringify(l.detail, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          ) : (
            <EmptyState title={t('choisir_ligne')} />
          )
        }
      />

      {/* ─── CE QUE LES JOURNAUX DÉTAILLÉS PORTENT SOUS LA MÊME PIÈCE ────── */}
      <section style={{ ...carte, display: 'grid', gap: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--sk-text)' }}>{t('sous_journaux')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {sousJournaux.map((s) => (
            <div key={s.cle}>
              <p style={{ ...etiquette, fontWeight: 600 }}>{s.titre}</p>
              {s.rangs.length === 0 ? (
                <p style={{ ...valeur, color: 'var(--sk-muted)' }}>{t('sj_aucun')}</p>
              ) : (
                <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                  {s.rangs.map((r, i) => <li key={i} style={{ ...valeur, ...mono }}>{r}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
        <p style={{ ...etiquette, margin: 0 }}>{t('sj_note')}</p>
      </section>
    </div>
  )
}
