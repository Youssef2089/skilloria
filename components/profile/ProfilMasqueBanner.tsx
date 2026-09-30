'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

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
  /** Où mène « Compléter mon profil » : la page d'IMPORT de la voie (décision du 30/09/2026). */
  href: string
  accentColor: string
}

export default function ProfilMasqueBanner({ href, accentColor }: Props) {
  // `namespace` n'est plus lu : le bandeau a UN texte, le même pour les deux voies (§E.20).
  const tMasque = useTranslations('profil_masque')
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

  // ⚠️ PLUS DE LISTE DE CHAMPS (décision de Youssef, 30/09/2026) : le profil se remplit par le CV ou
  //    l'export LinkedIn, pas champ par champ. Le bandeau dit que le profil n'est pas visible et mène à
  //    l'IMPORT ; la page d'import dit ensuite où en est l'analyse et reprend la validation, qui demande
  //    ce qu'un document ne peut pas donner (disponibilité, zones de travail).
  return (
    <section
      role="status"
      style={{
        border: '1px solid var(--sk-amber-soft)',
        background: 'var(--sk-amber-soft)',
        borderRadius: 14,
        padding: '16px 18px',
        marginBottom: 18,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sk-amber)', marginBottom: 6 }}>
        {etaitApprouve ? tMasque('titre_masque') : tMasque('titre_incomplet')}
      </div>
      <p style={{ fontSize: 13, color: 'var(--sk-amber)', lineHeight: 1.55, margin: '0 0 12px' }}>
        {tMasque('texte', { count: manquants.length })}
      </p>
      <Link
        href={href}
        style={{
          display: 'inline-block',
          padding: '9px 16px',
          background: accentColor,
          color: 'var(--sk-sur-accent)',
          borderRadius: 9,
          fontSize: 13,
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        {tMasque('cta')}
      </Link>
    </section>
  )
}
