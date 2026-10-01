'use client'

import { use, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import MasterDetail from '@/components/ui/MasterDetail'
import { estUuid, type PieceJournal } from '@/lib/journal/lecture'
import { Acteur, Montant, PastilleStatut, PhraseEcriture, Quand, lienObjet, type Ligne } from '@/components/admin/journal/presentation'

/**
 * /admin/journal/[piece] — LES ÉCRITURES D'UN MÊME GESTE (§D.26, phase B 2.6). Page de DÉTAIL : le bouton Retour est
 * celui de la coquille (GlobalBackButton), aucun autre.
 *
 * Toutes les écritures du geste, le geste qu'il reprend (rejeu, contrepassation) et ceux qui le reprennent, et ce que
 * les journaux détaillés gardent pour lui. Lecture EN BASE (`lire_piece`, bornée, AD002) ; une troncature se dit, une
 * panne aussi.
 *
 * CHAQUE ÉCRITURE SE LIT COMME UNE PHRASE (ARRÊT 22, §D.33) : plus de détail « clé par clé », plus d'identifiant de
 * pièce ni de code dans les journaux détaillés — des phrases, des nombres et des noms.
 */

type Props = { params: Promise<{ piece: string }> }

const carte: React.CSSProperties = {
  background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 12, padding: 16,
}
const etiquette: React.CSSProperties = { fontSize: 12, color: 'var(--sk-muted)', margin: 0 }
const valeur: React.CSSProperties = { fontSize: 13, color: 'var(--sk-text)', margin: '2px 0 0', overflowWrap: 'anywhere' }

export default function PiecePage({ params }: Props) {
  const { piece } = use(params)
  const t = useTranslations('admin_back_office.journal')
  const tA = useTranslations('journal.actions')
  const tJ = useTranslations('journal')
  const locale = useLocale()
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

  const titre = <PageHeader flush title={t('piece_titre')} subtitle={t('piece_intro')} />

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
  const nomsDisponibles = !data.noms_indisponibles
  const sj = data.sous_journaux
  // Un code des journaux détaillés se traduit par sa dimension ; inconnu : « une autre information » — jamais le code.
  const libelle = (dim: string, v: string | null) =>
    v && tJ.has(`valeurs.${dim}.${v}` as 'valeurs.inconnu') ? tJ(`valeurs.${dim}.${v}` as 'valeurs.inconnu') : tJ('valeurs.inconnu')
  const argent = (v: number | string) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(Number(v))
  const sousJournaux: Array<{ cle: string; titre: string; rangs: string[] }> = [
    { cle: 'audit', titre: t('sj_audit'), rangs: sj.audit_logs.length ? [t('sj_audit_n', { count: sj.audit_logs.length })] : [] },
    { cle: 'ia', titre: t('sj_ia'), rangs: sj.ai_spend_events.map((x) => t('sj_ia_ligne', { action: libelle('action_ia', x.action), montant: argent(x.cost_usd) })) },
    { cle: 'stripe', titre: t('sj_stripe'), rangs: sj.stripe_events.length ? [t('sj_stripe_n', { count: sj.stripe_events.length })] : [] },
    { cle: 'taches', titre: t('sj_taches'), rangs: sj.cron_run_log.map((x) => t('sj_tache_ligne', { tache: libelle('tache', x.job_name) })) },
    { cle: 'notifications', titre: t('sj_notifications'), rangs: sj.notifications.map((x) => t('sj_notification_ligne', {
      evenement: libelle('evenement', x.type), canal: libelle('canal_notification', x.channel), statut: libelle('statut_notification', x.status),
    })) },
  ]

  return (
    <div style={{ width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {titre}
      {data.tronquee && <p role="status" style={{ fontSize: 13, color: 'var(--sk-amber)', margin: 0 }}>{t('piece_tronquee')}</p>}
      {!nomsDisponibles && <p role="status" style={{ fontSize: 13, color: 'var(--sk-amber)', margin: 0 }}>{t('noms_indisponibles')}</p>}

      <MasterDetail
        noPadding
        listWidth={360}
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
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sk-muted)' }}>{tA(x.type_action)}</span>
                    {/* Deux écritures d'un même geste se distinguent ICI, par leur phrase, sans être ouvertes. */}
                    <span style={{ fontSize: 13 }}><PhraseEcriture ligne={x} noms={data.noms} nomsDisponibles={nomsDisponibles} /></span>
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
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sk-muted)' }}>{tA(l.type_action)}</span>
                <PastilleStatut statut={l.statut} />
              </div>
              <p style={{ fontSize: 15, color: 'var(--sk-text)', margin: 0, lineHeight: 1.55 }}>
                <PhraseEcriture ligne={l} noms={data.noms} nomsDisponibles={nomsDisponibles} />
              </p>
              <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: 0 }}>
                <div><dt style={etiquette}>{t('ligne_quand')}</dt><dd style={valeur}><Quand iso={l.horodatage} /></dd></div>
                <div><dt style={etiquette}>{t('ligne_acteur')}</dt><dd style={valeur}><Acteur ligne={l} /></dd></div>
                <div><dt style={etiquette}>{t('ligne_ecosysteme')}</dt><dd style={valeur}>{l.ecosysteme_nom ?? t('ecosysteme_aucun')}</dd></div>
                {(l.cout_usd != null || l.type_action === 'paiement_recu') && (
                  <div>
                    <dt style={etiquette}>{l.cout_usd != null ? t('ligne_cout') : t('ligne_montant')}</dt>
                    <dd style={valeur}><Montant ligne={l} /></dd>
                  </div>
                )}
                {objet && (
                  <div><dt style={etiquette}>{t('ligne_fiche')}</dt><dd style={valeur}><Link href={objet} style={{ color: 'var(--sk-accent)' }}>{t('ouvrir_objet')}</Link></dd></div>
                )}
              </dl>
              {(l.piece_origine || data.referencee_par.length > 0) && (
                <div style={{ display: 'grid', gap: 4 }}>
                  {l.piece_origine && (
                    <p style={{ ...valeur, margin: 0 }}>
                      {t('piece_origine')}{' '}
                      <Link href={`/admin/journal/${l.piece_origine}`} style={{ color: 'var(--sk-accent)' }}>{t('piece_voir')}</Link>
                    </p>
                  )}
                  {data.referencee_par.map((p) => (
                    <p key={p} style={{ ...valeur, margin: 0 }}>
                      {t('piece_referencee')}{' '}
                      <Link href={`/admin/journal/${p}`} style={{ color: 'var(--sk-accent)' }}>{t('piece_voir')}</Link>
                    </p>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <EmptyState title={t('choisir_ligne')} />
          )
        }
      />

      {/* ─── CE QUE LES JOURNAUX DÉTAILLÉS GARDENT POUR CE GESTE ────────────── */}
      <section style={{ ...carte, display: 'grid', gap: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--sk-text)' }}>{t('sous_journaux')}</h2>
        <p style={{ ...etiquette, margin: 0 }}>{t('sous_journaux_intro')}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {sousJournaux.map((s) => (
            <div key={s.cle}>
              <p style={{ ...etiquette, fontWeight: 600 }}>{s.titre}</p>
              {s.rangs.length === 0 ? (
                <p style={{ ...valeur, color: 'var(--sk-muted)' }}>{t('sj_aucun')}</p>
              ) : (
                <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                  {s.rangs.map((r, i) => <li key={i} style={valeur}>{r}</li>)}
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
