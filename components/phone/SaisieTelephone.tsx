'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CountrySelect from '@/components/CountrySelect'
import {
  chiffresEnLatin,
  composerE164,
  decomposerE164,
  exempleNational,
  reconnaitreNumeroColle,
} from '@/lib/phone'

/**
 * SaisieTelephone — LA SEULE saisie de numéro de téléphone du dépôt.
 *
 * ═══ POURQUOI CE COMPOSANT EXISTE ══════════════════════════════════════════
 *   Il y avait TROIS saisies de téléphone — inscription expert, inscription
 *   organisation, paramètres du compte — avec TROIS validations différentes et
 *   TROIS tables d'erreurs différentes. Ce n'était pas trois défauts : c'était
 *   UN défaut recopié trois fois, et la preuve est dans le dépôt.
 *
 *   `PhoneOtpField` avait corrigé une regex laxiste (`/^\+[1-9]\d{6,14}$/`)
 *   qui laissait passer un numéro structurellement E.164 mais non attribuable,
 *   pour que le serveur le refuse ensuite sous un « Service SMS indisponible »
 *   mensonger. Le correctif n'a JAMAIS été rétroporté à l'inscription
 *   organisation, qui portait encore la même regex six mois plus tard. Un
 *   défaut documenté comme corrigé, et vivant sur son jumeau.
 *
 *   Et les paramètres du compte faisaient pire : un `toE164` local qui
 *   TRANSFORMAIT tout numéro commençant par zéro en numéro français
 *   (`'+33' + s.slice(1)`). Un Marocain qui tapait `0612345678` enregistrait un
 *   numéro français en croyant enregistrer le sien — une invention silencieuse,
 *   exactement ce que [lib/phone.ts](lib/phone.ts) refuse de faire, en-tête à
 *   l'appui.
 *
 * ═══ LE MOTIF : ON CHOISIT UN PAYS, ON TAPE SON NUMÉRO ════════════════════
 *   L'utilisateur ne compose JAMAIS l'indicatif. Le E.164 est assemblé par le
 *   code, à partir du pays choisi et du numéro national. C'est le motif de
 *   toutes les implémentations de référence, et il ferme d'un coup la classe
 *   d'erreurs « l'écran exige un + que rien n'annonce ».
 *
 * ═══ CE QUI EST DÉLIBÉRÉ, ET POURQUOI ═════════════════════════════════════
 *   ① LE RÉFÉRENTIEL VIENT DE LA BASE. `CountrySelect` lit `/api/countries` —
 *      64 pays, indicatif, drapeau, nom en 4 langues. Aucune liste en dur, et
 *      aucune liste de pays AUTORISÉS : un filtrage géographique éventuel sera
 *      un réglage, pas une constante de composant.
 *
 *   ② LE PAYS PAR DÉFAUT VIENT DU `sort_order` DU RÉFÉRENTIEL, pas d'un « FR »
 *      écrit ici. Le back-office décide de l'ordre, donc du défaut. C'est la
 *      seule façon d'avoir un défaut commode sans le coder en dur.
 *
 *   ③ ON STOCKE LE CODE ISO, JAMAIS L'INDICATIF SEUL. `+1` est partagé par les
 *      États-Unis et le Canada : un état qui ne retiendrait que l'indicatif ne
 *      saurait pas lequel est sélectionné, et rouvrirait un piège connu.
 *
 *   ④ CHANGER DE PAYS NE VIDE JAMAIS LE NUMÉRO. Quelqu'un qui revient corriger
 *      son indicatif a déjà tapé son numéro ; le perdre est une frustration
 *      gratuite. On recompose, on n'efface pas.
 *
 *   ⑤ LE PLACEHOLDER VIENT DU PAYS CHOISI, PAS DE LA LANGUE. Les messages du
 *      dépôt prescrivaient `+33…` en français, `+34…` en espagnol, `+49…` en
 *      allemand : un Marocain lisant l'espagnol se voyait prescrire le format
 *      espagnol. L'exemple vient maintenant de la bibliothèque, par pays —
 *      pas d'une table écrite à la main, qui vieillirait à chaque
 *      renumérotation nationale.
 *
 *   ⑥ UN NUMÉRO COLLÉ AVEC SON INDICATIF BASCULE LE SÉLECTEUR. Coller
 *      `+21620123456` sélectionne la Tunisie et remplit le national. Sans ça,
 *      l'indicatif serait traité comme le début du numéro, et le refus serait
 *      incompréhensible. La forme `00216…` est reconnue aussi : c'est la
 *      composition internationale usuelle au Maghreb et en Europe.
 *
 *   ⑦ LES CHIFFRES ARABES-INDIENS ET PERSANS SONT ACCEPTÉS. On ouvre au
 *      Maghreb ; un clavier arabophone produit `٠١٢٣…` naturellement. Les
 *      refuser serait un mur invisible — la saisie a l'air correcte et le
 *      bouton reste gris, sans un mot d'explication.
 *
 * ═══ AUTOCOMPLÉTION DU NAVIGATEUR — CE QUI EST FAIT, ET CE QUI N'EST PAS
 *     VÉRIFIÉ ══════════════════════════════════════════════════════════════
 *   Le champ national porte `autoComplete="tel-national"` : c'est le jeton qui
 *   décrit exactement ce qu'il contient, et il demande au navigateur de ne
 *   remplir que la partie nationale.
 *
 *   ⚠️ LE SÉLECTEUR DE PAYS N'EN PORTE AUCUN, et ce n'est pas un oubli : c'est
 *      un `<button>`, pas un contrôle de formulaire. Les jetons
 *      d'autocomplétion ne s'y appliquent pas — TypeScript le refuse, et il a
 *      raison. Le navigateur n'a donc aucun moyen de renseigner l'indicatif.
 *
 *   ⚠️ COMPORTEMENT RÉEL NON VÉRIFIÉ EN NAVIGATEUR dans cet environnement. Le
 *      remède ne repose donc PAS sur le jeton : si le navigateur remplit le
 *      champ national avec un numéro international complet — le piège
 *      documenté sur ce type de champ — `reconnaitreNumeroColle` s'en aperçoit
 *      et bascule le pays, exactement comme pour un collage. Le comportement
 *      est correct que le jeton soit honoré ou non.
 */

export type LibellesSaisieTelephone = {
  /** Libellé du champ (« Téléphone »). */
  label: string
  /** Libellé accessible du sélecteur de pays. */
  pays_label: string
}

export type SaisieTelephoneProps = {
  /** Valeur E.164 (`+21620123456`) ou chaîne vide. */
  value: string
  /**
   * Rend le E.164 composé — ou `''` tant que le numéro n'est pas valide et
   * complet — ET le code ISO du pays choisi.
   *
   * Le pays remonte parce que l'appelant en a besoin AILLEURS : la sortie
   * « je ne reçois pas le code » préremplit le formulaire de contact avec le
   * pays, sans quoi le support devrait le deviner depuis l'indicatif — et `+1`
   * ne suffit pas à trancher entre les États-Unis et le Canada.
   */
  onChange: (e164: string, paysIso: string) => void
  primaryColor: string
  libelles: LibellesSaisieTelephone
  /** Numéro vérifié : champ verrouillé, coche verte. */
  verrouille?: boolean
  /** Saisie fautive : bordures rouges (le message est rendu par l'appelant). */
  hasError?: boolean
  id?: string
}

/** Pays retenu quand rien n'est encore choisi et que le référentiel n'a pas répondu. */
const PAYS_INDETERMINE = ''

export default function SaisieTelephone(props: SaisieTelephoneProps) {
  const { value, onChange, primaryColor, libelles, verrouille = false, hasError = false, id = 'phone' } = props

  // ─── État : (pays ISO, numéro national) ─────────────────────────────────
  // C'est l'état RÉEL de la saisie. Le E.164 en est une DÉRIVÉE, jamais une
  // source : le reconstruire à chaque frappe garantit qu'il ne peut pas
  // diverger de ce que l'utilisateur voit.
  const depuisValeur = useMemo(() => decomposerE164(value), [value])
  const [paysIso, setPaysIso] = useState<string>(depuisValeur?.iso ?? PAYS_INDETERMINE)
  const [national, setNational] = useState<string>(depuisValeur?.national ?? '')

  // Le pays par défaut arrive avec le référentiel (premier `sort_order`), pas
  // d'une constante. Posé UNE FOIS, et jamais par-dessus un choix existant.
  const defautPose = useRef(false)
  useEffect(() => {
    if (defautPose.current || paysIso) return
    let annule = false
    fetch('/api/countries')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (annule || defautPose.current) return
        const liste = Array.isArray(data) ? (data as { code?: string }[]) : []
        const premier = liste[0]?.code
        if (premier) {
          defautPose.current = true
          setPaysIso(premier)
        }
      })
      .catch(() => {})
    return () => {
      annule = true
    }
  }, [paysIso])

  // Une valeur imposée de l'extérieur (ré-affichage d'un numéro enregistré)
  // réaligne la saisie.
  //
  // AJUSTEMENT EN PHASE DE RENDU, PAS DANS UN EFFET. Un `useEffect` qui appelle
  // `setState` synchroniquement provoque un second rendu et un affichage
  // intermédiaire — sur un champ de saisie, cela se voit. C'est le motif que
  // React documente pour « ajuster un état quand une prop change », et la règle
  // `react-hooks/set-state-in-effect` le signale précisément parce que l'effet
  // est le mauvais outil ici.
  const [valeurVue, setValeurVue] = useState(value)
  if (value !== valeurVue) {
    setValeurVue(value)
    const d = value ? decomposerE164(value) : null
    if (d) {
      if (d.iso !== paysIso) setPaysIso(d.iso)
      if (d.national !== national) setNational(d.national)
    }
  }

  const emettre = useCallback(
    (iso: string, nat: string) => {
      onChange(composerE164(iso, nat) ?? '', iso)
    },
    [onChange],
  )

  // ─── Changement de pays : on RECOMPOSE, on n'efface JAMAIS ──────────────
  const changerPays = useCallback(
    (iso: string) => {
      setPaysIso(iso)
      emettre(iso, national)
    },
    [emettre, national],
  )

  // ─── Saisie du numéro national ──────────────────────────────────────────
  const changerNational = useCallback(
    (brut: string) => {
      // ⑥ + ⑦ : un numéro collé avec son indicatif (ou composé en `00`, ou en
      // chiffres non latins) bascule le sélecteur au lieu d'être refusé.
      const colle = reconnaitreNumeroColle(brut)
      if (colle) {
        setPaysIso(colle.iso)
        setNational(colle.national)
        emettre(colle.iso, colle.national)
        return
      }
      // Sinon : chiffres et séparateurs de lisibilité seulement. On garde les
      // espaces et tirets que l'utilisateur tape — les retirer sous ses doigts
      // fait sauter le curseur, défaut classique des champs « intelligents ».
      const nettoye = chiffresEnLatin(brut).replace(/[^\d\s.()-]/g, '').slice(0, 25)
      setNational(nettoye)
      emettre(paysIso, nettoye)
    },
    [emettre, paysIso],
  )

  const placeholder = exempleNational(paysIso) ?? ''

  const champStyle: React.CSSProperties = {
    width: '100%',
    padding: '11px 14px',
    fontSize: 16, // 16 px : en dessous, iOS zoome sur le champ au focus.
    border: `1.5px solid ${hasError ? '#dc2626' : verrouille ? '#22c55e' : '#e2e8f0'}`,
    borderRadius: 10,
    outline: 'none',
    fontFamily: 'inherit',
    background: verrouille ? '#f1f5f9' : '#fff',
    color: '#0f172a',
    boxSizing: 'border-box',
    minHeight: 44,
  }

  return (
    <div>
      <label
        htmlFor={id}
        style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}
      >
        {libelles.label} *
      </label>
      {/*
        MOBILE-FIRST. Le sélecteur garde une largeur fixe et le champ prend le
        reste : à 320 px, 116 + 8 + le reste tient sans rupture, et le couple ne
        passe jamais à la ligne — un indicatif séparé de son numéro se lit comme
        deux champs sans rapport.
      */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ width: 116, flexShrink: 0 }}>
          <CountrySelect
            value={paysIso}
            onChange={changerPays}
            primaryColor={primaryColor}
            variant="compact"
            disabled={verrouille}
            hasError={hasError}
            ariaLabel={libelles.pays_label}
          />
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <input
            id={id}
            type="tel"
            inputMode="tel"
            // Le jeton qui décrit VRAIMENT ce champ : la partie nationale, sans
            // indicatif. Cf. l'en-tête sur l'autocomplétion.
            autoComplete="tel-national"
            value={national}
            onChange={(e) => changerNational(e.target.value)}
            placeholder={placeholder}
            readOnly={verrouille}
            required
            style={champStyle}
          />
          {verrouille && (
            <span
              aria-hidden
              style={{ position: 'absolute', right: 12, top: 12, color: '#22c55e', fontSize: 18, fontWeight: 700 }}
            >
              ✓
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
