'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/durees — LES TROIS DURÉES DU CONTRAT DE LA PLACE.
 *
 * ═══ POURQUOI CET ÉCRAN EXISTE ═════════════════════════════════════════════
 *   La vie d'une annonce (30 j), la fenêtre d'échange (15 j) et la validité
 *   d'une invitation (7 j) vivaient en CONSTANTES. Les changer demandait un
 *   déploiement — et la troisième était écrite DEUX FOIS, dans deux routes,
 *   ce qui la condamnait à diverger.
 *
 * ═══ CE QUE CET ÉCRAN DOIT DIRE AVANT TOUT ═════════════════════════════════
 *   QUE LES TROIS RÉGLAGES NE SE COMPORTENT PAS PAREIL — et qu'UN SEUL fait
 *   exception.
 *
 *     · baisser la vie d'une annonce RETIRE des annonces déjà en ligne, tout
 *       de suite, parce que l'activité se recalcule à chaque lecture ;
 *     · baisser la fenêtre d'échange ne raccourcit AUCUNE conversation en
 *       cours, parce que leur date de fin est écrite au déblocage ;
 *     · baisser la validité d'une invitation ne raccourcit AUCUNE invitation
 *       déjà partie, pour exactement la même raison.
 *
 *   Trois champs voisins qui se ressemblent et dont un seul rétroagit, c'est un
 *   piège. L'écran l'écrit donc en toutes lettres, à côté de CHAQUE champ, et
 *   pas dans une aide qu'on déplie. Les deux non-rétroactifs se suivent ; c'est
 *   la vie d'une annonce qui est l'exception, et elle est en tête.
 *
 * ═══ ET UN QUATRIÈME CHAMP, QUI N'EST PAS DU CONTRAT ═══════════════════════
 *   La CONSERVATION DES ADRESSES IP (mois, 1–60). Une durée LÉGALE, en bas
 *   et à part : elle AGIT SUR L'EXISTANT — la tâche `ip_retention_purge`
 *   efface chaque nuit ce qui dépasse — et un effacement ne se défait pas.
 *   L'écran le dit à côté du champ, comme pour les trois autres.
 *
 * ═══ ON COMPTE AVANT D'ÉCRIRE, ET ON NE BLOQUE PAS ═════════════════════════
 *   À chaque baisse saisie, l'écran demande au serveur combien d'annonces
 *   VISIBLES aujourd'hui deviendraient expirées — et combien portent une
 *   candidature DÉVOILÉE, c'est-à-dire payée. Le nombre s'affiche AVANT
 *   d'enregistrer. Puis on confirme, et ça passe : c'est une confirmation, pas
 *   un plafond.
 */

type Charge = {
  vie_annonce_jours: number
  fenetre_echange_jours: number
  invitation_jours: number
  conservation_ip_mois: number
  updated_at: string | null
  simulation: { jours: number; basculent: number; dont_devoilees: number } | null
}

type Impact = { de_jours: number; a_jours: number; basculent: number; dont_devoilees: number }

const carte: React.CSSProperties = {
  background: 'var(--sk-surface)',
  border: '1px solid var(--sk-border)',
  borderRadius: 14,
  padding: '18px 20px',
  marginBottom: 16,
}
const titreBloc: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  color: 'var(--sk-muted)',
  marginBottom: 12,
}
const champ: React.CSSProperties = {
  width: 110,
  padding: '8px 10px',
  border: '1px solid var(--sk-border)',
  borderRadius: 8,
  fontSize: 14,
  background: 'var(--sk-surface)',
  color: 'var(--sk-text)',
}
const aide: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--sk-muted)',
  lineHeight: 1.55,
  marginTop: 8,
}

export default function AdminDureesPage() {
  const t = useTranslations('admin_durees')
  const secureFetch = useSecureFetch()

  const [charge, setCharge] = useState<Charge | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [vie, setVie] = useState('')
  const [fenetre, setFenetre] = useState('')
  const [invitation, setInvitation] = useState('')
  const [conservationIp, setConservationIp] = useState('')
  const [impact, setImpact] = useState<Impact | null>(null)
  const [apercu, setApercu] = useState<{ basculent: number; dont_devoilees: number } | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [succes, setSucces] = useState<string | null>(null)

  const lire = useCallback(async () => {
    try {
      const res = await secureFetch('/api/admin/durees', { cache: 'no-store' })
      if (!res.ok) throw new Error(`durees ${res.status}`)
      const data = (await res.json()) as Charge
      setCharge(data)
      setVie(String(data.vie_annonce_jours))
      setFenetre(String(data.fenetre_echange_jours))
      setInvitation(String(data.invitation_jours))
      setConservationIp(String(data.conservation_ip_mois))
      setErreur(null)
    } catch {
      // « Indisponible » n'est pas « 30 et 15 ». Sans lecture, aucun champ
      // n'est pré-rempli : un formulaire pré-rempli d'une valeur inventée
      // ferait écrire cette valeur au premier enregistrement.
      setErreur(t('unavailable'))
    }
  }, [secureFetch, t])

  useEffect(() => {
    void lire()
  }, [lire])

  // ── L'APERÇU, À CHAQUE SAISIE ────────────────────────────────────────────
  //  Le nombre affiché vient du SERVEUR, jamais d'un calcul refait ici : une
  //  seconde implémentation dériverait, et l'écran annoncerait un chiffre que
  //  l'enregistrement ne retrouverait pas.
  useEffect(() => {
    const n = Number(vie)
    if (!charge || !Number.isInteger(n) || n < 1 || n > 365 || n >= charge.vie_annonce_jours) {
      setApercu(null)
      return
    }
    let annule = false
    const minuteur = setTimeout(async () => {
      try {
        const res = await secureFetch(`/api/admin/durees?simuler_vie_annonce=${n}`, {
          cache: 'no-store',
        })
        if (!res.ok) throw new Error('simulation')
        const data = (await res.json()) as Charge
        if (annule) return
        setApercu(
          data.simulation
            ? { basculent: data.simulation.basculent, dont_devoilees: data.simulation.dont_devoilees }
            : null,
        )
      } catch {
        if (!annule) setApercu(null)
      }
    }, 350)
    return () => {
      annule = true
      clearTimeout(minuteur)
    }
  }, [vie, charge, secureFetch])

  const enregistrer = async (confirme: boolean) => {
    setEnCours(true)
    setSucces(null)
    try {
      const res = await secureFetch('/api/admin/durees', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          vie_annonce_jours: Number(vie),
          fenetre_echange_jours: Number(fenetre),
          invitation_jours: Number(invitation),
          conservation_ip_mois: Number(conservationIp),
          confirme_retroactivite: confirme,
        }),
      })
      const data = (await res.json()) as { code?: string; impact?: Impact }
      if (res.status === 409 && data.code === 'retroactivite_non_confirmee' && data.impact) {
        // ⚠️ CE N'EST PAS UN REFUS. Le serveur rend le nombre, l'écran le
        //    montre, l'administrateur tranche. La seconde demande passe.
        setImpact(data.impact)
        return
      }
      if (!res.ok) {
        setErreur(
          data.code === 'invalid_duration'
            ? t('invalid')
            : data.code === 'invalid_ip_retention'
              ? t('invalid_ip')
              : t('save_failed'),
        )
        return
      }
      setImpact(null)
      setErreur(null)
      setSucces(t('saved'))
      await lire()
    } catch {
      setErreur(t('save_failed'))
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, color: 'var(--sk-text)' }}>
        {t('title')}
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--sk-muted)', lineHeight: 1.6, marginBottom: 20 }}>
        {t('intro')}
      </p>

      {erreur && (
        <div role="alert" style={{ ...carte, background: 'var(--sk-red-soft)', borderColor: 'var(--sk-red-soft)', color: 'var(--sk-red)', fontSize: 13 }}>
          {erreur}
        </div>
      )}
      {succes && (
        <div role="status" style={{ ...carte, background: 'var(--sk-success-soft)', borderColor: 'var(--sk-success-soft)', color: 'var(--sk-success)', fontSize: 13 }}>
          {succes}
        </div>
      )}

      {/* ── VIE D'UNE ANNONCE — LE RÉGLAGE RÉTROACTIF ───────────────────── */}
      <section style={carte}>
        <div style={titreBloc}>{t('life.title')}</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, color: 'var(--sk-text)' }}>
          <input
            type="number"
            min={1}
            max={365}
            value={vie}
            onChange={(e) => setVie(e.target.value)}
            style={champ}
            disabled={!charge}
          />
          <span>{t('days')}</span>
        </label>

        {/* L'AVERTISSEMENT EST ÉCRIT EN ENTIER, à côté du champ — pas replié,
            pas abrégé. C'est le seul des deux réglages qui retire quelque chose
            à des gens qui ne s'y attendent pas. */}
        <p
          style={{
            fontSize: 13,
            color: 'var(--sk-amber)',
            background: 'var(--sk-amber-soft)',
            border: '1px solid var(--sk-amber-soft)',
            borderRadius: 8,
            padding: '10px 12px',
            lineHeight: 1.55,
            marginTop: 12,
          }}
        >
          <strong>{t('life.retroactive_label')}</strong> {t('life.retroactive_body')}
        </p>

        {apercu && (
          <p style={{ fontSize: 13.5, color: 'var(--sk-amber)', marginTop: 10, fontWeight: 600 }}>
            {t('preview', { count: apercu.basculent, unlocked: apercu.dont_devoilees })}
          </p>
        )}
        <div style={aide}>{t('life.help')}</div>
      </section>

      {/* ── FENÊTRE D'ÉCHANGE — LE RÉGLAGE QUI NE RÉTROAGIT PAS ─────────── */}
      <section style={carte}>
        <div style={titreBloc}>{t('exchange.title')}</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, color: 'var(--sk-text)' }}>
          <input
            type="number"
            min={1}
            max={365}
            value={fenetre}
            onChange={(e) => setFenetre(e.target.value)}
            style={champ}
            disabled={!charge}
          />
          <span>{t('days')}</span>
        </label>
        <p
          style={{
            fontSize: 13,
            color: 'var(--sk-accent)',
            background: 'var(--sk-accent-soft)',
            border: '1px solid var(--sk-accent-soft)',
            borderRadius: 8,
            padding: '10px 12px',
            lineHeight: 1.55,
            marginTop: 12,
          }}
        >
          <strong>{t('exchange.not_retroactive_label')}</strong> {t('exchange.not_retroactive_body')}
        </p>
        <div style={aide}>{t('exchange.help')}</div>
      </section>

      {/* ── VALIDITÉ D'UNE INVITATION — l'autre réglage qui ne rétroagit pas ─
          Rangée ici, sous la fenêtre d'échange, et non ailleurs : les deux se
          comportent pareil, et c'est la vie d'une annonce qui fait exception.
          Les séparer ferait croire que l'exception est la règle. */}
      <section style={carte}>
        <div style={titreBloc}>{t('invitation.title')}</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, color: 'var(--sk-text)' }}>
          <input
            type="number"
            min={1}
            max={365}
            value={invitation}
            onChange={(e) => setInvitation(e.target.value)}
            style={champ}
            disabled={!charge}
          />
          <span>{t('days')}</span>
        </label>
        <p
          style={{
            fontSize: 13,
            color: 'var(--sk-accent)',
            background: 'var(--sk-accent-soft)',
            border: '1px solid var(--sk-accent-soft)',
            borderRadius: 8,
            padding: '10px 12px',
            lineHeight: 1.55,
            marginTop: 12,
          }}
        >
          <strong>{t('invitation.not_retroactive_label')}</strong> {t('invitation.not_retroactive_body')}
        </p>
        <div style={aide}>{t('invitation.help')}</div>
      </section>

      {/* ── CONSERVATION DES ADRESSES IP — une durée LÉGALE, en bas et à part ─
          Elle n'est pas du contrat de la place, et elle AGIT SUR L'EXISTANT :
          la tâche ip_retention_purge efface chaque nuit ce qui dépasse. C'est
          un troisième comportement, et l'écran le dit comme les deux autres. */}
      <section style={carte}>
        <div style={titreBloc}>{t('ip.title')}</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, color: 'var(--sk-text)' }}>
          <input
            type="number"
            min={1}
            max={60}
            value={conservationIp}
            onChange={(e) => setConservationIp(e.target.value)}
            style={champ}
            disabled={!charge}
          />
          <span>{t('months')}</span>
        </label>
        <p
          style={{
            fontSize: 13,
            color: 'var(--sk-amber)',
            background: 'var(--sk-amber-soft)',
            border: '1px solid var(--sk-amber-soft)',
            borderRadius: 8,
            padding: '10px 12px',
            lineHeight: 1.55,
            marginTop: 12,
          }}
        >
          <strong>{t('ip.acts_on_existing_label')}</strong> {t('ip.acts_on_existing_body')}
        </p>
        <div style={aide}>{t('ip.help')}</div>
      </section>

      {/* ── LA CONFIRMATION — une question, jamais un mur ──────────────── */}
      {impact && (
        <section
          role="alertdialog"
          aria-label={t('confirm.title')}
          style={{ ...carte, background: 'var(--sk-amber-soft)', borderColor: 'var(--sk-amber-soft)' }}
        >
          <div style={{ ...titreBloc, color: 'var(--sk-amber)' }}>{t('confirm.title')}</div>
          <p style={{ fontSize: 14, color: 'var(--sk-amber)', lineHeight: 1.6, marginBottom: 6 }}>
            {t('confirm.body', {
              from: impact.de_jours,
              to: impact.a_jours,
              count: impact.basculent,
              unlocked: impact.dont_devoilees,
            })}
          </p>
          <p style={{ fontSize: 13, color: 'var(--sk-amber)', lineHeight: 1.55, marginBottom: 14 }}>
            {t('confirm.note')}
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={() => void enregistrer(true)}
              disabled={enCours}
              style={{
                padding: '10px 18px',
                background: 'var(--sk-amber)',
                color: 'var(--sk-surface)',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: enCours ? 'default' : 'pointer',
              }}
            >
              {t('confirm.accept')}
            </button>
            <button
              type="button"
              onClick={() => setImpact(null)}
              disabled={enCours}
              style={{
                padding: '10px 18px',
                background: 'transparent',
                color: 'var(--sk-muted)',
                border: '1px solid var(--sk-border)',
                borderRadius: 8,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              {t('confirm.cancel')}
            </button>
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => void enregistrer(false)}
        disabled={!charge || enCours}
        style={{
          padding: '11px 22px',
          background: charge && !enCours ? 'var(--sk-text)' : 'var(--sk-border)',
          color: charge && !enCours ? 'var(--sk-surface)' : 'var(--sk-muted)',
          border: 'none',
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 600,
          cursor: charge && !enCours ? 'pointer' : 'default',
        }}
      >
        {enCours ? t('saving') : t('save')}
      </button>

      {charge?.updated_at && (
        <div style={{ ...aide, marginTop: 14 }}>
          {t('last_change', { date: new Date(charge.updated_at).toLocaleString() })}
        </div>
      )}
    </div>
  )
}
