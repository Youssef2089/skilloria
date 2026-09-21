'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { dashboardUrlForUserType } from '@/lib/auth-routing'
import { useSecureFetch, useSecureLogout } from '@/lib/secure-fetch'

const fontJakarta = 'var(--font-jakarta), system-ui, sans-serif'

// `indisponible` : le statut du compte n’a pas pu être LU. Ce n’est ni « actif »
// ni « purgé » — les deux seraient des affirmations sur une panne (§E.42).
type View = 'loading' | 'grace' | 'purged' | 'active' | 'need_login' | 'indisponible'

/**
 * Écran de réactivation (mission S3, section 7).
 *
 * Vit HORS du dashboard (pas de DashboardShell ni de DeletionGate → pas de
 * boucle de redirection). Pendant la grâce : propose de réactiver le compte.
 * Après purge : message « compte supprimé ». Si le compte est actif (cas d'un
 * accès direct à l'URL), on renvoie vers l'app.
 */
export default function ReactivationPage() {
  const t = useTranslations('settings.reactivation')
  // Les libellés de champs existent déjà dans les quatre langues et servent
  // l'écran de validation de profil. On les RÉUTILISE plutôt que d'en écrire
  // une seconde série, qui finirait par dire autre chose.
  const tChamps = useTranslations('profile_validation.field_errors')
  const locale = useLocale()
  const router = useRouter()
  const secureFetch = useSecureFetch()
  const logout = useSecureLogout()
  const [view, setView] = useState<View>('loading')
  const [date, setDate] = useState<string | null>(null)
  const [userType, setUserType] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** `manquants` non nul = le profil ne remplit plus les conditions ; on les NOMME. */
  /** `indisponible` = la relecture du compte a échoué : ni refus, ni succès. */
  const [erreur, setErreur] = useState<{ manquants: string[] | null; indisponible?: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      // user_type (pour rediriger vers le bon dashboard après réactivation)
      const { data: { session } } = await supabase.auth.getSession()
      // C1 : après suppression la session est révoquée. Sans session, on ne
      // peut PAS lire le statut (requireAuth exige un Bearer) → on invite à se
      // reconnecter pour réactiver (le compte n'est PAS banni pendant la grâce).
      if (!session?.user) {
        if (!cancelled) setView('need_login')
        return
      }
      // C4 : le SELECT direct sur `users` est verrouillé par RLS en état de
      // grâce → on lit le type via la fonction SECURITY DEFINER my_account_routing()
      // (accessible en grâce, n'expose que le routage). Sert au redirect
      // post-réactivation vers le bon dashboard.
      const { data: routingRows, error: routingErr } = await supabase.rpc('my_account_routing')
      if (routingErr) {
        // Le routage post-réactivation est INCONNU, pas « freelance par
        // défaut » (§E.22). On laisse `userType` à null et l'effet de
        // redirection ne tranche pas : mieux vaut rester sur cet écran que
        // déposer quelqu'un sur un tableau de bord qui n'est pas le sien.
        console.error('[reactivation] routage du compte en panne', routingErr.message)
      }
      const u = Array.isArray(routingRows) ? routingRows[0] : routingRows
      if (!cancelled) setUserType((u as { user_type?: string } | null)?.user_type ?? null)
      try {
        const res = await secureFetch('/api/me/account/status', { method: 'GET' })
        if (cancelled) return
        if (!res.ok) {
          const d = (await res.json().catch(() => null)) as { code?: string } | null
          // Une panne de lecture n'est PAS « compte actif » : on le dit, et on
          // laisse réessayer. Afficher « actif » enverrait la personne au tableau
          // de bord pendant que sa fenêtre de grâce court.
          if (d?.code === 'compte_verification_indisponible') { setView('indisponible'); return }
          setView(d?.code === 'account_anonymized' ? 'purged' : 'active')
          return
        }
        const d = (await res.json()) as { deletion_scheduled_at?: string | null; anonymized_at?: string | null }
        if (cancelled) return
        if (d.anonymized_at) setView('purged')
        else if (d.deletion_scheduled_at) { setDate(d.deletion_scheduled_at); setView('grace') }
        else setView('active')
      } catch {
        if (!cancelled) setView('active')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [secureFetch])

  useEffect(() => {
    if (view === 'active') {
      // ⚠️ CETTE COMPARAISON N'ÉTAIT JAMAIS VRAIE, PANNE OU PAS.
      //    `my_account_routing()` rend `users.user_type` tel quel, donc
      //    'expert_cdi' — jamais 'cdi'. TOUS les experts en CDI réactivés
      //    atterrissaient sur le tableau de bord freelance. Le compilateur ne
      //    dit rien d'une comparaison qui reste POSSIBLE (§E.22 règle 2), et
      //    c'est exactement le piège de `gate === 'not_approved'` au lot 1.3.
      //
      //    On délègue à la source unique du routage plutôt que de réécrire le
      //    mapping ici : une table recopiée diverge, celle-ci a divergé.
      //    `userType` nul = routage inconnu (lecture en panne) ⇒ ON NE
      //    REDIRIGE PAS. Rester est un état ; se tromper de dashboard n'en est
      //    pas un.
      if (userType) router.replace(dashboardUrlForUserType(userType))
    }
  }, [view, userType, router])

  const fmt = (iso: string) => {
    try { return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(iso)) } catch { return iso }
  }

  const reactivate = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await secureFetch('/api/me/account/reactivate', { method: 'POST' })
      if (!res.ok) {
        // ── UN REFUS QUI DIT QUOI FAIRE ────────────────────────────────────
        //  L'écran avalait l'échec en silence : le bouton se réarmait, et
        //  rien n'expliquait pourquoi. Un expert pouvait rester enfermé dans
        //  sa période de grâce sans jamais comprendre ce qui bloquait.
        const charge = (await res.json().catch(() => ({}))) as {
          code?: string
          missing?: string[]
        }
        setErreur(
          charge.code === 'visibility_blocked'
            ? { manquants: charge.missing ?? [] }
            : charge.code === 'compte_verification_indisponible'
              ? { manquants: null, indisponible: true }
              : { manquants: null },
        )
        return
      }
      const dest = userType === 'cdi' ? '/dashboard/cdi' : '/dashboard/freelance'
      router.replace(dest)
    } catch {
      // Une exception n’est pas un refus nommé : le message générique, et le
      // bouton se réarme par le finally.
      setErreur({ manquants: null })
    } finally {
      setBusy(false)
    }
  }

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: '#f8fafc', fontFamily: fontJakarta }}>
      <div style={{ width: '100%', maxWidth: 460, background: '#fff', borderRadius: 20, padding: 32, boxShadow: '0 20px 50px rgba(15,23,42,0.12)', textAlign: 'center' }}>
        {children}
      </div>
    </div>
  )

  if (view === 'loading') {
    return shell(<p style={{ color: '#64748b', fontSize: 14 }}>…</p>)
  }

  if (view === 'purged') {
    return shell(
      <>
        <div style={{ fontSize: 36, marginBottom: 8 }} aria-hidden>🗑️</div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{t('purged_title')}</h1>
        <p style={{ margin: '10px 0 24px', fontSize: 14.5, color: '#64748b', lineHeight: 1.6 }}>{t('purged_body')}</p>
        <button
          type="button"
          onClick={() => void logout({ redirectTo: '/' })}
          style={{ padding: '12px 20px', borderRadius: 12, border: '1.5px solid #e2e8f0', background: '#fff', color: '#0f172a', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: fontJakarta }}
        >
          {t('logout')}
        </button>
      </>,
    )
  }

  if (view === 'indisponible') {
    return shell(
      <>
        <div style={{ fontSize: 36, marginBottom: 8 }} aria-hidden>⏳</div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{t('indisponible_title')}</h1>
        <p style={{ margin: '10px 0 24px', fontSize: 14.5, color: '#64748b', lineHeight: 1.6 }}>{t('indisponible_body')}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ width: '100%', padding: '13px 20px', borderRadius: 12, border: 'none', background: 'var(--sk-accent, #0ea5e9)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
        >
          {t('indisponible_retry')}
        </button>
      </>,
    )
  }
  if (view === 'need_login') {
    return shell(
      <>
        <div style={{ fontSize: 36, marginBottom: 8 }} aria-hidden>🔒</div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{t('need_login_title')}</h1>
        <p style={{ margin: '10px 0 24px', fontSize: 14.5, color: '#64748b', lineHeight: 1.6 }}>{t('need_login_body')}</p>
        <button
          type="button"
          onClick={() => router.replace('/connexion')}
          style={{ width: '100%', padding: '13px 20px', borderRadius: 12, border: 'none', background: 'var(--sk-accent, #0ea5e9)', color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: fontJakarta }}
        >
          {t('need_login_button')}
        </button>
      </>,
    )
  }

  if (view === 'grace') {
    return shell(
      <>
        <div style={{ fontSize: 36, marginBottom: 8 }} aria-hidden>⏳</div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{t('title')}</h1>
        <p style={{ margin: '10px 0 6px', fontSize: 14.5, color: '#64748b', lineHeight: 1.6 }}>
          {t('body', { date: date ? fmt(date) : '' })}
        </p>
        <p style={{ margin: '0 0 24px', fontSize: 13, fontWeight: 700, color: '#b91c1c' }}>
          {t('scheduled_for', { date: date ? fmt(date) : '' })}
        </p>
        {/* ── UN REFUS QUI DIT QUOI FAIRE ────────────────────────────────
            L'échec était avalé en silence : le bouton se réarmait, et rien
            n'expliquait pourquoi. Un expert pouvait rester enfermé dans sa
            période de grâce sans jamais comprendre ce qui bloquait. */}
        {erreur && (
          <div
            role="alert"
            style={{
              margin: '0 0 14px',
              padding: '12px 14px',
              borderRadius: 12,
              background: '#fffbeb',
              border: '1px solid #fde68a',
              color: '#92400e',
              fontSize: 13.5,
              lineHeight: 1.55,
              textAlign: 'left',
            }}
          >
            {erreur.manquants && erreur.manquants.length > 0 ? (
              <>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{t('blocked_title')}</div>
                <div style={{ marginBottom: 8 }}>{t('blocked_body')}</div>
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {erreur.manquants.map((c) => (
                    <li key={c}>{tChamps(c as 'title')}</li>
                  ))}
                </ul>
              </>
            ) : erreur.indisponible ? (
              t('reactivate_indisponible')
            ) : (
              t('reactivate_failed')
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => void reactivate()}
          disabled={busy}
          style={{ width: '100%', padding: '13px 20px', borderRadius: 12, border: 'none', background: 'var(--sk-accent, #0ea5e9)', color: '#fff', fontSize: 15, fontWeight: 800, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1, fontFamily: fontJakarta }}
        >
          {t('reactivate_button')}
        </button>
        <button
          type="button"
          onClick={() => void logout({ redirectTo: '/' })}
          style={{ marginTop: 12, padding: '10px 16px', borderRadius: 10, border: 'none', background: 'transparent', color: '#64748b', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: fontJakarta }}
        >
          {t('logout')}
        </button>
      </>,
    )
  }

  return shell(<p style={{ color: '#64748b', fontSize: 14 }}>…</p>)
}
