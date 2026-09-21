'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/seuils — LES NOTES DE JUGEMENT.
 *
 * ┌─ CE QUI A DISPARU DE CET ÉCRAN, ET OÙ C'EST PARTI ──────────────────────┐
 * │ Il affichait CINQ blocs, dont DEUX qui ne décident de rien : un champ    │
 * │ grisé avec trois lignes expliquant qu'il ne gouverne rien, et une ligne  │
 * │ « non réglable ». §D.11 : un écran de réglage ne montre que ce qui se    │
 * │ décide — un champ qui ne règle rien finit par être rempli.               │
 * │                                                                          │
 * │ L'INFORMATION N'EST PAS PERDUE, elle est rangée : `lib/jugement/sujets`  │
 * │ la déclare, `docs/architecture.md` §B.2 ⑨ l'explique, et                 │
 * │ `diag-reglages-inertes` garde le lien.                                   │
 * │                                                                          │
 * │ Sont partis avec : les identifiants de base en guise de titres           │
 * │ (`claude_expert_coherence_check`…), le bandeau de 60 pays en corps 8, et │
 * │ quatre des cinq boutons « Enregistrer ».                                 │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ L'URL NE CHANGE PAS ═════════════════════════════════════════════════
 *   `/admin/seuils` reste `/admin/seuils` : une adresse est citée ailleurs —
 *   liens, signets, inventaire d'écrans de la mémoire. C'est la même raison
 *   que pour les colonnes (§D.9), et c'est une décision, pas un oubli. Le
 *   TITRE, lui, dit « Notes de jugement ».
 */

type Drapeau = { cle: string; actif: boolean }
type SujetCharge = {
  sujet: 'experts' | 'entreprises' | 'annonces'
  provider_id: string | null
  note: number | null
  ambigu: boolean
  arrives_ce_mois: number | null
  drapeaux: Drapeau[] | null
}
type Reponse = { sujets: SujetCharge[]; pays_sans_verification: string[] | null }

const carte: React.CSSProperties = {
  background: 'var(--sk-surface)',
  border: '1px solid var(--sk-border)',
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
}
const champ: React.CSSProperties = {
  width: 100,
  padding: '9px 11px',
  fontSize: 15,
  border: '1px solid var(--sk-border)',
  borderRadius: 8,
  background: '#fff',
  color: 'inherit',
}
const encart: React.CSSProperties = {
  background: 'var(--sk-bg, #f8fafc)',
  border: '1px solid var(--sk-border)',
  borderRadius: 10,
  padding: '14px 16px',
  margin: '16px 0',
}
const bouton = (inactif: boolean): React.CSSProperties => ({
  padding: '9px 18px',
  fontSize: 14,
  fontWeight: 500,
  borderRadius: 8,
  border: 'none',
  background: 'var(--sk-accent)',
  color: '#fff',
  cursor: inactif ? 'not-allowed' : 'pointer',
  opacity: inactif ? 0.6 : 1,
})

/** Où atterrit un dossier qui n'a pas passé la note. */
const FILE: Record<string, string | null> = {
  experts: '/admin/experts',
  entreprises: '/admin/organisations',
  annonces: null,
}

export default function NotesDeJugementPage() {
  const t = useTranslations('admin_seuils')
  const secureFetch = useSecureFetch()

  const [data, setData] = useState<Reponse | null>(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [drapeaux, setDrapeaux] = useState<Record<string, string[]>>({})

  const charger = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    try {
      const res = await secureFetch('/api/admin/seuils')
      const body = (await res.json()) as Reponse
      if (!res.ok) {
        setErreur(t('err_load'))
        return
      }
      setData(body)
      setNotes(Object.fromEntries(body.sujets.map((s) => [s.sujet, s.note === null ? '' : String(s.note)])))
      setDrapeaux(
        Object.fromEntries(
          body.sujets
            .filter((s) => s.drapeaux !== null)
            .map((s) => [s.sujet, (s.drapeaux ?? []).filter((d) => d.actif).map((d) => d.cle)]),
        ),
      )
    } catch {
      setErreur(t('err_load'))
    } finally {
      setChargement(false)
    }
  }, [secureFetch, t])

  useEffect(() => {
    void charger()
  }, [charger])

  /** UN BOUTON GRISÉ DIT POURQUOI. Jamais un booléen nu. */
  function motifDeBlocage(s: SujetCharge): string | null {
    if (s.ambigu) return t('blocked_ambiguous')
    if (s.note === null) return t('blocked_missing')
    const saisie = notes[s.sujet] ?? ''
    if (saisie.trim() === '') return t('blocked_empty')
    const n = Number(saisie)
    if (!Number.isInteger(n) || n < 0 || n > 10) return t('blocked_range')
    const cases = drapeaux[s.sujet]
    if (s.drapeaux !== null && (cases ?? []).length === 0) return t('blocked_no_flag')
    const memesDrapeaux =
      s.drapeaux === null ||
      ((cases ?? []).length === s.drapeaux.filter((d) => d.actif).length &&
        (cases ?? []).every((c) => s.drapeaux?.some((d) => d.cle === c && d.actif)))
    if (n === s.note && memesDrapeaux) return t('blocked_unchanged')
    return null
  }

  async function enregistrer(s: SujetCharge) {
    setEnCours(s.sujet)
    setMsg(null)
    try {
      const res = await secureFetch('/api/admin/seuils', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sujet: s.sujet,
          note: Number(notes[s.sujet]),
          ...(s.drapeaux !== null ? { drapeaux: drapeaux[s.sujet] ?? [] } : {}),
        }),
      })
      const body = (await res.json()) as { code?: string }
      if (!res.ok) {
        setMsg({
          kind: 'err',
          text:
            body.code === 'aucun_drapeau'
              ? t('blocked_no_flag')
              : body.code === 'config_ambigue'
                ? t('blocked_ambiguous')
                : body.code === 'invalid_note'
                  ? t('blocked_range')
                  : t('err_save'),
        })
        return
      }
      setMsg({ kind: 'ok', text: t('saved') })
      await charger()
    } catch {
      setMsg({ kind: 'err', text: t('err_save') })
    } finally {
      setEnCours(null)
    }
  }

  return (
    <div style={{ width: '100%', textAlign: 'left' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px', color: 'var(--sk-text)' }}>
        {t('title')}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: '0 0 20px', maxWidth: 760 }}>
        {t('intro')}
      </p>

      {msg && (
        <p
          role={msg.kind === 'err' ? 'alert' : undefined}
          style={{
            fontSize: 13,
            margin: '0 0 14px',
            color: msg.kind === 'err' ? 'var(--sk-red)' : 'var(--sk-success)',
          }}
        >
          {msg.text}
        </p>
      )}

      {chargement ? (
        <p style={{ fontSize: 13, color: 'var(--sk-muted)' }}>{t('loading')}</p>
      ) : erreur ? (
        <p role="alert" style={{ fontSize: 13, color: 'var(--sk-red)' }}>
          {erreur}
        </p>
      ) : (
        <>
          {data?.sujets.map((s) => {
            const blocage = motifDeBlocage(s)
            const file = FILE[s.sujet]
            return (
              <section key={s.sujet} style={carte}>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 20,
                  }}
                >
                  <div style={{ flex: '1 1 320px' }}>
                    {/* UN TITRE EN FRANÇAIS. Jamais un identifiant de base. */}
                    <h2 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 4px', color: 'var(--sk-text)' }}>
                      {t(`sujet.${s.sujet}.titre` as 'sujet.experts.titre')}
                    </h2>
                    <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: 0, maxWidth: 560 }}>
                      {t(`sujet.${s.sujet}.effet` as 'sujet.experts.effet')}{' '}
                      {file && (
                        <Link href={file} style={{ color: 'var(--sk-accent)' }}>
                          {t(`sujet.${s.sujet}.file` as 'sujet.experts.file')}
                        </Link>
                      )}
                    </p>
                  </div>

                  <div style={{ flex: '0 0 auto' }}>
                    <label
                      htmlFor={`n_${s.sujet}`}
                      style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--sk-text)' }}
                    >
                      {t(`sujet.${s.sujet}.champ` as 'sujet.experts.champ')}
                    </label>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <input
                        id={`n_${s.sujet}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={10}
                        step={1}
                        value={notes[s.sujet] ?? ''}
                        onChange={(e) => setNotes((p) => ({ ...p, [s.sujet]: e.target.value }))}
                        style={champ}
                      />
                      <span style={{ fontSize: 14, color: 'var(--sk-muted)' }}>{t('out_of_ten')}</span>
                    </span>
                  </div>
                </div>

                {/* LES CAS QUI FORCENT LE PASSAGE PAR L'HUMAIN — experts seuls. */}
                {s.drapeaux !== null && (
                  <div style={encart}>
                    <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--sk-text)' }}>
                      {t('flags_title')}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 28px' }}>
                      {s.drapeaux.map((d) => (
                        <label key={d.cle} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={(drapeaux[s.sujet] ?? []).includes(d.cle)}
                            onChange={(e) =>
                              setDrapeaux((p) => {
                                const actuels = p[s.sujet] ?? []
                                return {
                                  ...p,
                                  [s.sujet]: e.target.checked
                                    ? [...actuels, d.cle]
                                    : actuels.filter((x) => x !== d.cle),
                                }
                              })
                            }
                            style={{ width: 16, height: 16 }}
                          />
                          {t(`flag.${d.cle}` as 'flag.DOMAIN_MISMATCH')}
                        </label>
                      ))}
                    </div>
                    <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--sk-muted)' }}>
                      {t('flags_one_must_stay')}
                    </p>
                  </div>
                )}

                {/* LES PAYS SANS VÉRIFICATION AUTOMATIQUE — une phrase, et la
                    liste se déplie. Elle tenait en corps 8 sur toute la largeur. */}
                {s.sujet === 'entreprises' && (
                  <div style={encart}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--sk-text)' }}>
                      {t('countries_title')}
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--sk-muted)' }}>
                      {t('countries_one_line')}
                    </p>
                    {data?.pays_sans_verification === null ? (
                      /* Une lecture en panne ne se lit pas « aucun pays » (§E.22). */
                      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--sk-red)' }}>
                        {t('countries_unavailable')}
                      </p>
                    ) : (data?.pays_sans_verification?.length ?? 0) > 0 ? (
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ fontSize: 12, cursor: 'pointer', color: 'var(--sk-accent)' }}>
                          {t('countries_open', { count: data?.pays_sans_verification?.length ?? 0 })}
                        </summary>
                        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--sk-muted)', lineHeight: 1.6 }}>
                          {(data?.pays_sans_verification ?? []).join(' · ')}
                        </p>
                      </details>
                    ) : null}
                  </div>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 16 }}>
                  <button
                    type="button"
                    onClick={() => void enregistrer(s)}
                    disabled={enCours === s.sujet || blocage !== null}
                    style={bouton(enCours === s.sujet || blocage !== null)}
                  >
                    {enCours === s.sujet ? t('saving') : t('save')}
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--sk-faint)' }}>
                    {blocage ??
                      (s.arrives_ce_mois === null
                        ? /* Un compteur en panne ne rend pas zéro (§E.22). */
                          t('arrived_unknown')
                        : t(`arrived.${s.sujet}` as 'arrived.experts', { count: s.arrives_ce_mois }))}
                  </span>
                </div>
              </section>
            )
          })}

          {/* CE QUI N'EST PLUS AFFICHÉ, DIT UNE FOIS — sinon son absence se lit
              comme un oubli, et quelqu'un le remettra. */}
          <p style={{ fontSize: 12, color: 'var(--sk-faint)', margin: '4px 0 0', maxWidth: 760 }}>
            {t('inert_note')}
          </p>
        </>
      )}
    </div>
  )
}
