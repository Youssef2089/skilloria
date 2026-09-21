'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'
import {
  COLONNE_PAR_ROLE,
  PALETTE_REFERENCE,
  ROLES_PALETTE,
  MINIMUM_LISIBILITE,
  hexOuNull,
  resolvePalette,
  verifierContraste,
  type RolePalette,
} from '@/lib/palette'

/**
 * LES COULEURS D'UN ÉCOSYSTÈME — l'écran où Youssef les choisit.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ §D.11 : UN ÉCRAN DE RÉGLAGE NE MONTRE QUE CE QUI SE DÉCIDE.              ║
 * ║                                                                          ║
 * ║ Ce qui n'y est PAS, et ce n'est pas un oubli :                            ║
 * ║  · le NOM TECHNIQUE des rôles. `couleur_texte_secondaire` est une clé de  ║
 * ║    base, pas un nom — c'est exactement ce qui avait rendu /admin/seuils   ║
 * ║    illisible (§E.26). L'écran dit CE QUE LA COULEUR COLORE.               ║
 * ║  · `secondary_color`. Elle ne gouverne plus rien depuis le lot palette    ║
 * ║    (architecture §B.2 ⑪). Un champ qui ne règle rien finit par être       ║
 * ║    rempli : elle est documentée, pas affichée.                            ║
 * ║  · les couleurs d'ÉTAT — vert, ambre, rouge. Elles disent « vérifié »,    ║
 * ║    « attention », « en échec », sur tous les écosystèmes. Les rendre      ║
 * ║    réglables inviterait à peindre une erreur en vert.                     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ LA GARDE DE CONTRASTE EST AU SERVEUR. Celle-ci est un APERÇU : elle dit
 *    tout de suite ce qui ne va pas, pendant qu'on choisit, plutôt qu'après un
 *    aller-retour. Mais c'est la route qui refuse (§E.15) — un composant client
 *    qui appliquerait seul une règle serveur la figerait dans le bundle.
 */

type Props = {
  ecosystemeId: string
  /** La ligne `domain_configs` telle que le GET l'a servie. */
  config: Record<string, unknown> | null
  onSaved: () => void
}

/** Le rôle « boutons » se dérive par défaut : son absence est un état, pas un vide. */
const DERIVE = '' as const

export default function PalettePanel({ ecosystemeId, config, onSaved }: Props) {
  const t = useTranslations('admin_palette')
  const secureFetch = useSecureFetch()

  const initial = useMemo(() => {
    const out: Record<RolePalette, string> = {} as Record<RolePalette, string>
    for (const role of ROLES_PALETTE) {
      const brut = hexOuNull(config?.[COLONNE_PAR_ROLE[role]])
      out[role] = brut ?? (role === 'boutons' ? DERIVE : PALETTE_REFERENCE[role])
    }
    return out
  }, [config])

  const [choix, setChoix] = useState<Record<RolePalette, string>>(initial)
  const [enregistrement, setEnregistrement] = useState(false)
  const [refus, setRefus] = useState<string | null>(null)
  const [enregistre, setEnregistre] = useState(false)

  // La palette telle qu'elle SERA — dérivations comprises. C'est elle qu'on
  // montre et c'est elle qu'on vérifie : contrôler les valeurs saisies aurait
  // laissé le bouton dérivé hors de la garde, précisément celui qu'on ne
  // choisit pas.
  const palette = useMemo(() => {
    const ligne: Record<string, string> = {}
    for (const role of ROLES_PALETTE) {
      if (choix[role]) ligne[COLONNE_PAR_ROLE[role]] = choix[role]
    }
    return resolvePalette(ligne)
  }, [choix])

  const verdict = useMemo(() => verifierContraste(palette), [palette])

  const poser = (role: RolePalette, valeur: string) => {
    setChoix((c) => ({ ...c, [role]: valeur }))
    setRefus(null)
    setEnregistre(false)
  }

  async function enregistrer() {
    // Le refus est NOMMÉ ici aussi : l'écran ne se contente pas de ne rien
    // faire. Un bouton qui ne réagit pas est un écran mort.
    if (!verdict.valide) {
      setRefus('contraste_insuffisant')
      return
    }
    setEnregistrement(true)
    setRefus(null)
    try {
      const corps: Record<string, string | null> = {}
      for (const role of ROLES_PALETTE) {
        corps[COLONNE_PAR_ROLE[role]] = choix[role] ? choix[role] : null
      }
      const res = await secureFetch(`/api/admin/ecosystemes/${ecosystemeId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corps),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { code?: string }
        setRefus(b.code ?? 'db_error')
        return
      }
      setEnregistre(true)
      onSaved()
    } catch {
      setRefus('reseau')
    } finally {
      // Le drapeau posé avant un `await` se relâche TOUJOURS dans un `finally`.
      setEnregistrement(false)
    }
  }

  /* ── Styles. Ils lisent la palette du produit, pas des littéraux. ──────── */
  const carte: React.CSSProperties = {
    background: 'var(--sk-surface)',
    border: '1px solid var(--sk-border)',
    borderRadius: 'var(--sk-r-lg)',
    padding: 16,
  }
  const etiquette: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--sk-text)',
    marginBottom: 2,
  }
  const aide: React.CSSProperties = {
    fontSize: 12,
    color: 'var(--sk-muted)',
    margin: '0 0 8px',
    lineHeight: 1.45,
  }

  return (
    <section style={{ marginBottom: 18 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--sk-text)', margin: '0 0 4px' }}>
        {t('title')}
      </h3>
      <p style={{ ...aide, maxWidth: '68ch' }}>{t('intro')}</p>

      {/* ── Les huit choix ────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 12,
          marginBottom: 14,
        }}
      >
        {ROLES_PALETTE.map((role) => {
          const derive = role === 'boutons' && !choix.boutons
          const valeur = choix[role] || (role === 'boutons' ? palette.boutons : PALETTE_REFERENCE[role])
          return (
            <div key={role} style={carte}>
              <label style={etiquette} htmlFor={`pal-${role}-${ecosystemeId}`}>
                {t(`roles.${role}.nom` as 'roles.fond_page.nom')}
              </label>
              <p style={aide}>{t(`roles.${role}.quoi` as 'roles.fond_page.quoi')}</p>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input
                  id={`pal-${role}-${ecosystemeId}`}
                  type="color"
                  value={valeur}
                  onChange={(e) => poser(role, e.target.value.toUpperCase())}
                  style={{
                    width: 46,
                    height: 34,
                    padding: 2,
                    border: '1px solid var(--sk-border)',
                    borderRadius: 8,
                    background: 'var(--sk-surface)',
                    cursor: 'pointer',
                  }}
                />
                <code
                  style={{
                    fontSize: 12,
                    color: 'var(--sk-muted)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {valeur}
                </code>
                {derive && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--sk-muted)',
                      background: 'var(--sk-surface-2)',
                      border: '1px solid var(--sk-border)',
                      borderRadius: 999,
                      padding: '2px 8px',
                    }}
                  >
                    {t('derive')}
                  </span>
                )}
                {role === 'boutons' && choix.boutons && (
                  <button
                    type="button"
                    onClick={() => poser('boutons', DERIVE)}
                    style={{
                      appearance: 'none',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      font: 'inherit',
                      fontSize: 12,
                      color: 'var(--sk-accent)',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    {t('rendre_derive')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── L'aperçu : la page telle qu'elle sera ─────────────────────────── */}
      <div style={{ ...carte, padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        <div
          style={{
            background: palette.bandeau,
            borderBottom: `1px solid ${palette.bordures}`,
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 9,
          }}
        >
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              background: palette.marque,
              flexShrink: 0,
            }}
            aria-hidden
          />
          <strong style={{ fontSize: 14, color: palette.textePrincipal }}>{t('apercu.titre')}</strong>
        </div>
        <div style={{ background: palette.fondPage, padding: 14 }}>
          <div
            style={{
              background: palette.cartes,
              border: `1px solid ${palette.bordures}`,
              borderRadius: 12,
              padding: 14,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: palette.textePrincipal, marginBottom: 4 }}>
              {t('apercu.carte_titre')}
            </div>
            <p style={{ fontSize: 13, color: palette.texteSecondaire, margin: '0 0 12px', lineHeight: 1.55 }}>
              {t('apercu.carte_texte')}
            </p>
            <span
              style={{
                display: 'inline-block',
                background: palette.boutons,
                color: palette.texteSurBoutons,
                borderRadius: 999,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {t('apercu.bouton')}
            </span>
          </div>
        </div>
      </div>

      {/* ── LA GARDE. Elle dit CE QUI échoue, DE COMBIEN, et CONTRE QUOI. ─── */}
      <div style={{ ...carte, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sk-text)', marginBottom: 2 }}>
          {t('controle.titre')}
        </div>
        <p style={aide}>{t('controle.minimum', { minimum: MINIMUM_LISIBILITE.toFixed(1) })}</p>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {verdict.paires.map((p) => (
            <li
              key={p.cle}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                flexWrap: 'wrap',
                fontSize: 13,
                padding: '7px 10px',
                borderRadius: 8,
                background: p.passe ? 'var(--sk-success-soft)' : 'var(--sk-red-soft)',
                color: p.passe ? 'var(--sk-success)' : 'var(--sk-red)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span
                  aria-hidden
                  style={{
                    width: 26,
                    height: 16,
                    borderRadius: 4,
                    flexShrink: 0,
                    background: p.fond,
                    border: `1px solid ${palette.bordures}`,
                    color: p.texte,
                    fontSize: 11,
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  Aa
                </span>
                <span style={{ fontWeight: 600 }}>
                  {t(`controle.paires.${p.cle}` as 'controle.paires.principal_sur_fond')}
                </span>
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, whiteSpace: 'nowrap' }}>
                {p.ratio.toFixed(2)} {p.passe ? '' : t('controle.sous_minimum', { minimum: MINIMUM_LISIBILITE.toFixed(1) })}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Enregistrer ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => void enregistrer()}
          disabled={enregistrement}
          style={{
            appearance: 'none',
            font: 'inherit',
            cursor: enregistrement ? 'default' : 'pointer',
            background: 'var(--sk-accent)',
            color: 'var(--sk-sur-accent)',
            border: 'none',
            borderRadius: 10,
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 700,
            opacity: enregistrement ? 0.6 : 1,
          }}
        >
          {enregistrement ? t('enregistrement') : t('enregistrer')}
        </button>

        {enregistre && (
          <span style={{ fontSize: 13, color: 'var(--sk-success)', fontWeight: 600 }}>{t('enregistre')}</span>
        )}

        {refus && (
          <span style={{ fontSize: 13, color: 'var(--sk-red)', fontWeight: 600 }}>
            {t(`refus.${refus}` as 'refus.contraste_insuffisant')}
          </span>
        )}
      </div>
    </section>
  )
}
