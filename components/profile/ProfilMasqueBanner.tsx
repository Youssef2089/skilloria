'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'
import { RESUME_MAX, RESUME_MIN } from '@/lib/profile-visibility'

/**
 * Bannière « votre profil n'est pas visible — voici exactement ce qui manque ».
 *
 * POURQUOI ELLE EXISTE
 *   La migration a masqué des profils déjà publiés : de nouveaux champs sont
 *   devenus nécessaires. Personne n'a été prévenu. Un expert se connecte, ne
 *   reçoit plus rien, et n'a aucun moyen de savoir pourquoi.
 *
 *   C'est la règle gelée appliquée à l'expert lui-même : aucun profil écarté
 *   sans une raison NOMMABLE et CONTESTABLE. Nommable, donc on liste les champs
 *   un par un. Contestable, donc on mène directement au formulaire qui les
 *   contient — une raison qu'on ne peut pas aller corriger n'est pas contestable.
 *
 * CE QU'ELLE NE FAIT PAS
 *   Elle ne recalcule RIEN. Le verdict vient de /api/profile/visibility, qui
 *   applique le prédicat exact du refus. Une bannière qui compterait de son côté
 *   finirait par lister des champs que le serveur n'exige pas.
 *
 * DEUX FORMULATIONS, ET LA DIFFÉRENCE EST UN FAIT
 *   « Votre profil a été masqué » n'est vrai que pour quelqu'un qui était en
 *   ligne. Rien en base n'enregistre l'avoir été ; ce qui est enregistré, c'est
 *   d'être passé par la vérification. On réserve donc cette formulation aux
 *   profils approuvés, et on en emploie une neutre pour les autres. Écrire
 *   « masqué » à quelqu'un qui n'a jamais publié serait un mensonge de plus.
 *
 * SILENCE PAR DÉFAUT
 *   Aucune bannière si le profil est visible, si le verdict est indisponible, ou
 *   si l'expert vient d'arriver et n'a pas encore de profil. On ne remplit pas
 *   un accueil d'un avertissement qu'on n'a pas su vérifier.
 */

type Verdict = {
  applicable: boolean
  visible?: boolean
  missing?: string[]
  verification_approved?: boolean
}

type Props = {
  /**
   * Espace de noms i18n de la voie : les deux formulaires n'utilisent pas le
   * même, et une clé cherchée dans le mauvais s'affiche en clair à l'écran.
   */
  namespace: 'profile_validation' | 'cdi_profile_validation'
  /** Où mène « Compléter mon profil ». */
  href: string
  accentColor: string
}

export default function ProfilMasqueBanner({ namespace, href, accentColor }: Props) {
  const t = useTranslations(namespace)
  const secureFetch = useSecureFetch()
  const [verdict, setVerdict] = useState<Verdict | null>(null)

  useEffect(() => {
    let annule = false
    const lire = async () => {
      try {
        const res = await secureFetch('/api/profile/visibility', { method: 'GET' })
        if (!res.ok) {
          // Verdict indisponible : on se TAIT. Afficher « il vous manque des
          // champs » sur une panne de lecture serait accuser à tort.
          console.warn('[ProfilMasqueBanner] verdict indisponible', res.status)
          return
        }
        const data = (await res.json()) as Verdict
        if (!annule) setVerdict(data)
      } catch (err) {
        console.warn('[ProfilMasqueBanner] verdict illisible', err)
      }
    }
    void lire()
    return () => {
      annule = true
    }
  }, [secureFetch])

  if (!verdict?.applicable) return null
  if (verdict.visible) return null
  const manquants = verdict.missing ?? []
  if (manquants.length === 0) return null

  const etaitApprouve = verdict.verification_approved === true

  return (
    <section
      role="status"
      style={{
        border: '1px solid #fed7aa',
        background: '#fff7ed',
        borderRadius: 14,
        padding: '16px 18px',
        marginBottom: 18,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, color: '#9a3412', marginBottom: 6 }}>
        {etaitApprouve
          ? t('sections.summary_matching.hidden_title')
          : t('sections.summary_matching.incomplete_title')}
      </div>
      <p style={{ fontSize: 13, color: '#7c2d12', lineHeight: 1.55, margin: '0 0 10px' }}>
        {etaitApprouve
          ? t('sections.summary_matching.hidden_intro')
          : t('sections.summary_matching.incomplete_intro')}
      </p>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#7c2d12', marginBottom: 6 }}>
        {t('sections.summary_matching.hidden_list_intro')}
      </div>
      <ul style={{ margin: '0 0 14px', paddingLeft: 18, fontSize: 13, color: '#7c2d12', lineHeight: 1.7 }}>
        {manquants.map((champ) => (
          <li key={champ}>
            {/* Les bornes du résumé sont passées en paramètres : écrites en dur
                dans la traduction, elles annonçaient encore « 20 caractères »
                bien après que le serveur en eut exigé 200. */}
            {t(
              `field_labels_short.${champ}` as 'field_labels_short.title',
              { min: RESUME_MIN, max: RESUME_MAX },
            )}
          </li>
        ))}
      </ul>
      <Link
        href={href}
        style={{
          display: 'inline-block',
          padding: '9px 16px',
          background: accentColor,
          color: '#fff',
          borderRadius: 9,
          fontSize: 13,
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        {t('sections.summary_matching.hidden_cta')}
      </Link>
    </section>
  )
}
