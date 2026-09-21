'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'
import ReauthModal from '@/components/settings/ReauthModal'
import { BandeauTroncature, type Troncature } from '@/components/ui/BandeauTroncature'

/**
 * /admin/utilisateurs/[id] — fiche d'un compte.
 *
 * Page de DÉTAIL : UN SEUL bouton Retour, global, en haut (règle projet).
 *
 * CE QU'ELLE N'AFFICHE PAS, ET C'EST VOULU
 *   Le NUMÉRO de téléphone n'est jamais servi par l'API (seulement
 *   `phone_verified`). Un administrateur n'a besoin d'aucun numéro pour
 *   suspendre ou révoquer. Idem pour le CV, le contenu du profil et les
 *   messages : la fiche expert existe déjà et a ses propres gardes.
 *
 * QUATRE ACTIONS, TOUTES RÉ-AUTHENTIFIÉES
 *   Suspendre/réactiver, forcer la déconnexion, changer le rôle en
 *   organisation, et SUPPRIMER DÉFINITIVEMENT. Chacune passe par
 *   <ReauthModal> — le mécanisme EXISTANT
 *   (grant HMAC de 5 min, header `x-reauth-token`), le même que le changement
 *   d'e-mail et la suppression de compte. Les gardes réelles sont SERVEUR ;
 *   ce que l'écran fait ici n'est que de la courtoisie.
 *
 * ACTIONS IMPOSSIBLES : MASQUÉES, ET LA RAISON EST DITE
 *   « Suspendre » et « Forcer la déconnexion » s'affichaient même sur sa
 *   PROPRE fiche et sur celle d'un AUTRE ADMINISTRATEUR — deux cas que le
 *   serveur refuse par construction. L'admin ne l'apprenait qu'après avoir
 *   cliqué ET saisi son mot de passe. Ils sont désormais masqués, remplacés
 *   par le motif en clair.
 *
 *   Le verdict vient du SERVEUR (bloc `actions` de /api/admin/get-user/[id],
 *   produit par la garde partagée `refuseAdminActionOnTarget`). Rien n'est
 *   comparé ici : cet écran ne connaît pas l'id de l'admin connecté, et
 *   `user_type` est un libellé d'affichage, pas une autorisation. Le masquage
 *   S'AJOUTE à la garde, il ne la remplace pas — un appel forgé se heurte
 *   toujours au même refus 403.
 *
 * LA ZONE IRRÉVERSIBLE EST SÉPARÉE, PAS SEULEMENT DÉCORÉE
 *   « Supprimer définitivement » vit en BAS de page, dans son propre encadré,
 *   hors de la barre d'actions de l'en-tête. Un geste sans retour ne doit pas
 *   voisiner un geste annulable : le clic de proximité est une cause d'accident
 *   réelle, pas une hypothèse. La modale exige en plus de retaper l'adresse de
 *   la cible — le SEUL des trois verrous qui adresse l'erreur de CIBLE, les
 *   deux autres n'adressant que l'identité de l'auteur et la règle métier.
 *   Ces exigences sont TOUTES revalidées par /api/admin/user-purge : ce que
 *   l'écran en fait n'est, là encore, que de la courtoisie.
 */

type ApiUser = {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  job_title: string | null
  user_type: string | null
  status: string | null
  email_verified: boolean
  phone_verified: boolean
  is_verified: boolean
  locale: string | null
  last_login_at: string | null
  has_ever_logged_in: boolean
  created_at: string
  deletion_scheduled_at: string | null
  anonymized_at: string | null
  ecosystem: { id: string; name: string | null; slug: string | null } | null
}
type ApiOrg = {
  membership_id: string
  id: string
  company_name: string | null
  org_type: string | null
  verification_status: string | null
  role_in_org: string
}
type ApiProfile = { id: string; verification_status: string | null; expert_type: string | null; title: string | null }
/**
 * Verdict d'administrabilité SERVI PAR LE SERVEUR (cf. /api/admin/get-user/[id]),
 * calculé par la garde partagée `refuseAdminActionOnTarget`.
 *
 * On ne compare RIEN côté client : ni « cette cible est-elle moi ? » (l'écran
 * ne connaît pas l'id de l'admin connecté), ni « cette cible est-elle admin ? »
 * (`user_type` est de l'affichage, pas une autorisation). Deviner ici, c'est
 * signer une seconde règle métier qui dérivera de la vraie.
 */
type AdminRefusalCode =
  | 'self_forbidden'
  | 'target_is_admin'
  | 'last_platform_admin'
  | 'target_not_found'
  | 'target_lookup_unavailable'
type ApiActions = {
  can_suspend: boolean
  can_revoke_session: boolean
  refusal_code: AdminRefusalCode | null
  /** Suppression DÉFINITIVE — même garde, plus le cas « déjà anonymisé ». */
  can_purge: boolean
  purge_refusal_code: AdminRefusalCode | 'already_anonymized' | null
  /** Organisations que la purge laisserait sans administrateur joignable. */
  purge_org_lockout: { id: string; company_name: string | null }[]
  /** `true` = le serveur n'a PAS pu établir la liste ci-dessus. Voir l'écran. */
  purge_org_lockout_unknown?: boolean
  /**
   * Renvoi d'invitation — administrateur JAMAIS connecté. Verdict serveur :
   * l'écran ne recalcule ni le type de compte ni l'absence de connexion.
   */
  can_resend_invite: boolean
}
type Detail = { user: ApiUser; organization: ApiOrg | null; profile: ApiProfile | null; actions: ApiActions }

type TimelineEntry = {
  kind: 'login' | 'revocation'
  at: string
  ip_address: string | null
  user_agent: string | null
  action?: string
  by_self?: boolean
}

const ROLES = ['viewer', 'editor', 'admin'] as const

/** Action en attente de ré-authentification. */
type PendingAction =
  | { kind: 'suspend' | 'reactivate' | 'revoke' }
  | { kind: 'role'; role: string; force: boolean }
  /**
   * `purge` transporte l'adresse retapée et l'acquittement : les deux partent
   * au serveur, qui les REVALIDE. Rien de ce que porte cet objet n'est une
   * garde — ce sont les entrées d'une décision prise ailleurs.
   */
  | { kind: 'purge'; confirmEmail: string; acknowledgeOrgLockout: boolean }
  | { kind: 'resend_invite' }

export default function AdminUserDetailPage() {
  const t = useTranslations('admin_back_office.users')
  const tErr = useTranslations('admin_back_office.errors')
  const tPlafond = useTranslations('plafonds')
  const locale = useLocale()
  const secureFetch = useSecureFetch()
  const params = useParams<{ id: string }>()
  const userId = params?.id ?? ''

  const [detail, setDetail] = useState<Detail | null>(null)
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [loginCount, setLoginCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [sessionsTroncature, setSessionsTroncature] = useState<Troncature | null>(null)

  // Confirmation → ré-auth → exécution. Trois états distincts pour que l'admin
  // sache toujours ce qu'il s'apprête à faire AVANT de saisir son mot de passe.
  const [confirming, setConfirming] = useState<PendingAction | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [reauthOpen, setReauthOpen] = useState(false)

  // Suppression définitive : sa propre modale, parce qu'elle demande DEUX
  // choses que les autres actions ne demandent pas — l'adresse retapée et,
  // le cas échéant, l'acquittement du verrouillage d'organisation.
  const [purgeOpen, setPurgeOpen] = useState(false)
  const [purgeEmail, setPurgeEmail] = useState('')
  const [purgeAck, setPurgeAck] = useState(false)

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    try {
      const [dRes, sRes] = await Promise.all([
        secureFetch(`/api/admin/get-user/${userId}`, { method: 'GET' }),
        secureFetch(`/api/admin/get-user/${userId}/sessions`, { method: 'GET' }),
      ])
      if (dRes.status === 403) { setError(tErr('forbidden')); return }
      if (dRes.status === 404) { setError(t('empty_title')); return }
      if (!dRes.ok) { setError(tErr('generic')); return }
      setDetail((await dRes.json()) as Detail)
      if (sRes.ok) {
        const s = (await sRes.json()) as { entries: TimelineEntry[]; login_count: number; has_more?: boolean; limit?: number }
        setTimeline(s.entries ?? [])
        // La route DIT que le journal est coupé (`has_more`) et à combien (`limit`) ; on le montre.
        setSessionsTroncature(s.has_more === true ? { plafond: s.limit ?? (s.entries ?? []).length, atteint: true } : null)
        setLoginCount(s.login_count ?? 0)
      }
    } catch {
      setError(tErr('generic'))
    } finally {
      setLoading(false)
    }
  }, [secureFetch, userId, t, tErr])

  useEffect(() => { void load() }, [load])

  const dateTimeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    [locale],
  )
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }),
    [locale],
  )

  const u = detail?.user ?? null
  const org = detail?.organization ?? null
  const actions = detail?.actions ?? null

  /**
   * Les deux actions sont proposées UNIQUEMENT si le serveur les autorise.
   * Repli PRUDENT sur `false` : une réponse d'une version antérieure de l'API
   * (sans bloc `actions`) masque les boutons plutôt que d'en proposer un qui
   * échouerait après saisie du mot de passe. Le serveur, lui, refuse de toute
   * façon — ce repli ne fait que choisir le moins mauvais des affichages.
   */
  const canSuspend = actions?.can_suspend === true
  const canRevoke = actions?.can_revoke_session === true
  const canPurge = actions?.can_purge === true
  const purgeOrgLockout = actions?.purge_org_lockout ?? []
  /**
   * `?? true` ET NON `?? false` — c'est tout le correctif côté écran.
   *
   * Le drapeau absent (réponse tronquée, ancienne version du serveur) veut dire
   * « je ne sais pas », jamais « tout va bien » : un défaut optimiste reproduit
   * exactement le silence qu'on ferme. On l'ignore seulement quand la liste est
   * déjà non vide — l'avertissement nommé est alors plus précis que le doute.
   */
  const purgeOrgLockoutUnknown =
    purgeOrgLockout.length === 0 && actions !== null && actions.purge_org_lockout_unknown !== false
  const canResendInvite = actions?.can_resend_invite === true

  /**
   * Raison affichée à la place des boutons. Deux cas atteignables :
   *   - `self_forbidden`  → sa propre fiche ;
   *   - `target_is_admin` → fiche d'un autre administrateur.
   * `last_platform_admin` n'est renvoyé QUE pour une cible administratrice —
   * que l'interdit 2 court-circuite avant : la phrase « comptes
   * administrateurs » reste donc exacte s'il survenait. `target_not_found` est
   * impossible ici (la fiche a été chargée).
   */
  const blockedReason = canSuspend || canRevoke || !actions
    ? null
    : actions.refusal_code === 'self_forbidden'
      ? t('actions_blocked_self')
      : t('actions_blocked_admin')

  /**
   * Raison du masquage de la suppression définitive. Trois cas atteignables —
   * les deux mêmes que ci-dessus, plus « déjà anonymisé », propre à cette
   * action : il n'y a plus rien à effacer.
   */
  const purgeBlockedReason = canPurge || !actions
    ? null
    : actions.purge_refusal_code === 'self_forbidden'
      ? t('purge_blocked_self')
      : actions.purge_refusal_code === 'already_anonymized'
        ? t('purge_blocked_already_anonymized')
        : t('purge_blocked_admin')
  const fullName = u ? [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || (u.email ?? '—') : '—'

  /** Traduit le code d'erreur serveur en message. Jamais de code brut à l'écran. */
  const messageForCode = useCallback(
    (code: string | undefined): string => {
      switch (code) {
        case 'self_forbidden': return t('err_self_forbidden')
        case 'target_is_admin': return t('err_target_is_admin')
        case 'last_platform_admin': return t('err_last_platform_admin')
        case 'no_membership': return t('err_no_membership')
        case 'nothing_to_update': return t('err_nothing_to_update')
        case 'confirm_email_mismatch': return t('err_confirm_email_mismatch')
        case 'already_anonymized': return t('err_already_anonymized')
        case 'purge_failed': return t('err_purge_failed')
        // Deux refus TEMPORAIRES, et ils ne disent rien du compte visé : les
        // confondre avec « introuvable » ou « interdit » enverrait
        // l'administrateur chercher un compte disparu ou un droit manquant.
        case 'org_lockout_check_unavailable': return t('err_org_lockout_check_unavailable')
        case 'target_lookup_unavailable': return t('err_target_lookup_unavailable')
        case 'invitation_failed': return t('err_invitation_failed')
        case 'already_signed_in': return t('err_already_signed_in')
        case 'rate_limited': return t('err_rate_limited')
        default: return t('err_generic')
      }
    },
    [t],
  )

  /** Exécute l'action une fois le grant de ré-auth obtenu. */
  const run = useCallback(
    async (action: PendingAction, reauthToken: string) => {
      setBusy(true)
      try {
        const headers = { 'content-type': 'application/json', 'x-reauth-token': reauthToken }
        let res: Response
        if (action.kind === 'role') {
          res = await secureFetch('/api/admin/user-org-role', {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ user_id: userId, role_in_org: action.role, force: action.force }),
          })
        } else if (action.kind === 'revoke') {
          res = await secureFetch('/api/admin/user-revoke-session', {
            method: 'POST', headers, body: JSON.stringify({ user_id: userId }),
          })
        } else if (action.kind === 'resend_invite') {
          res = await secureFetch('/api/admin/user-resend-invite', {
            method: 'POST', headers, body: JSON.stringify({ user_id: userId }),
          })
        } else if (action.kind === 'purge') {
          res = await secureFetch('/api/admin/user-purge', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              user_id: userId,
              confirm_email: action.confirmEmail,
              acknowledge_org_lockout: action.acknowledgeOrgLockout,
            }),
          })
        } else {
          res = await secureFetch('/api/admin/user-status', {
            method: 'POST', headers, body: JSON.stringify({ user_id: userId, action: action.kind }),
          })
        }

        const payload = (await res.json().catch(() => ({}))) as { code?: string }
        if (!res.ok) {
          // 409 `last_admin` sans `force` : le serveur refuse et FOURNIT le
          // contexte. On re-pose la question en nommant l'organisation, puis on
          // renvoie l'action avec force — jamais en silence.
          if (res.status === 409 && payload.code === 'last_admin' && action.kind === 'role') {
            setConfirming({ kind: 'role', role: action.role, force: true })
            return
          }
          setToast({ msg: messageForCode(payload.code), kind: 'error' })
          return
        }
        setToast({
          msg:
            action.kind === 'role' ? t('toast_role_changed')
              : action.kind === 'revoke' ? t('toast_revoked')
                : action.kind === 'purge' ? t('toast_purged')
                  : action.kind === 'resend_invite' ? t('toast_invite_resent')
                    : action.kind === 'suspend' ? t('toast_suspended')
                      : t('toast_reactivated'),
          kind: 'success',
        })
        await load()
      } catch {
        setToast({ msg: t('err_generic'), kind: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [secureFetch, userId, messageForCode, t, load],
  )

  const card: React.CSSProperties = {
    background: 'var(--sk-surface)',
    border: '0.5px solid var(--sk-border)',
    borderRadius: 12,
    padding: '18px 20px',
  }
  const btn = (danger?: boolean): React.CSSProperties => ({
    padding: '9px 15px',
    borderRadius: 9,
    border: danger ? '1px solid var(--sk-red-soft)' : '1px solid var(--sk-border)',
    background: danger ? 'var(--sk-red-soft)' : 'var(--sk-surface)',
    color: danger ? 'var(--sk-red)' : 'var(--sk-text)',
    fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer',
    opacity: busy ? 0.6 : 1, fontFamily: 'inherit',
  })
  const rowStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', gap: 14,
    padding: '8px 0', fontSize: 13, borderBottom: '1px solid var(--sk-surface-2)',
  }

  return (
    <div style={{ padding: '24px 26px 40px', fontFamily: 'inherit' }}>
      {/* AUCUN bouton Retour local : le <GlobalBackButton> du layout admin
          (app/[locale]/admin/layout.tsx) en rend déjà UN, et un seul. En
          poser un second ici donnait deux « ← Retour » empilés sur la même
          page — exactement ce que la règle projet interdit. */}

      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--sk-muted)' }}>{t('loading')}</div>
      ) : error || !u ? (
        <div role="alert" style={{ padding: '28px 20px', textAlign: 'center', background: 'var(--sk-red-soft)', color: 'var(--sk-red)', borderRadius: 12, fontSize: 14 }}>
          {error ?? tErr('generic')}
        </div>
      ) : (
        <>
          {toast && (
            <div
              role="status"
              style={{
                marginBottom: 14, padding: '12px 16px', borderRadius: 10, fontSize: 13,
                background: toast.kind === 'error' ? 'var(--sk-red-soft)' : 'var(--sk-success-soft)',
                color: toast.kind === 'error' ? 'var(--sk-red)' : 'var(--sk-success)',
              }}
            >
              {toast.msg}
            </div>
          )}

          {/* Cycle de vie suppression : l'admin doit le savoir AVANT d'agir. */}
          {u.anonymized_at && (
            <div role="note" style={{ marginBottom: 14, padding: '12px 16px', borderRadius: 10, background: 'var(--sk-surface-2)', color: 'var(--sk-muted)', fontSize: 13 }}>
              {t('anonymized_notice')}
            </div>
          )}
          {!u.anonymized_at && u.deletion_scheduled_at && (
            <div role="note" style={{ marginBottom: 14, padding: '12px 16px', borderRadius: 10, background: 'var(--sk-amber-soft)', color: 'var(--sk-amber)', fontSize: 13 }}>
              {t('deletion_scheduled_notice', { date: dateFmt.format(new Date(u.deletion_scheduled_at)) })}
            </div>
          )}

          {/* INVITATION EN ATTENTE — un administrateur créé qui ne s'est jamais
              connecté n'a peut-être jamais reçu son lien (panne SMTP). Sans ce
              bandeau, le compte resterait sans accès et sans signal : on
              recréerait un problème du jour zéro à chaque hoquet du serveur de
              mail. Le verdict `can_resend_invite` vient du SERVEUR — l'écran ne
              devine ni le type de compte, ni l'absence de connexion. */}
          {canResendInvite && (
            <div
              role="note"
              style={{
                marginBottom: 14, padding: '12px 16px', borderRadius: 10,
                background: 'var(--sk-accent-soft)', border: '1px solid var(--sk-accent-soft)', color: 'var(--sk-accent)',
                fontSize: 13, lineHeight: 1.6,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 14, flexWrap: 'wrap',
              }}
            >
              <span>{t('invite_pending_notice')}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => { setPending({ kind: 'resend_invite' }); setReauthOpen(true) }}
                style={btn()}
              >
                {t('action_resend_invite')}
              </button>
            </div>
          )}

          {/* En-tête : identité + actions */}
          <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sk-text)', margin: 0, letterSpacing: '-0.2px' }}>
                {fullName}
              </h1>
              <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: '4px 0 0' }}>
                {u.email ?? '—'} · {u.user_type ? t(`type_${u.user_type}` as 'type_admin') : '—'}
                {u.ecosystem?.name ? ` · ${u.ecosystem.name}` : ''}
              </p>
            </div>
            {/* Actions impossibles → on ne les propose pas, et on DIT pourquoi.
                Un bouton grisé sans motif fait deviner ; un bouton actif qui
                échoue après ré-authentification fait perdre du temps. */}
            {blockedReason ? (
              <p
                role="note"
                style={{
                  margin: 0, maxWidth: 380, padding: '11px 14px', borderRadius: 10,
                  background: 'var(--sk-surface-2)', color: 'var(--sk-muted)', fontSize: 13, lineHeight: 1.55,
                }}
              >
                {blockedReason}
              </p>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {canSuspend && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirming({ kind: u.status === 'suspended' ? 'reactivate' : 'suspend' })}
                    style={btn(u.status !== 'suspended')}
                  >
                    {u.status === 'suspended' ? t('action_reactivate') : t('action_suspend')}
                  </button>
                )}
                {canRevoke && (
                  <button type="button" disabled={busy} onClick={() => setConfirming({ kind: 'revoke' })} style={btn()}>
                    {t('action_revoke')}
                  </button>
                )}
              </div>
            )}
          </header>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 14 }}>
            <section style={card} aria-label={t('section_identity')}>
              <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--sk-muted)', margin: '0 0 10px' }}>
                {t('section_identity')}
              </h2>
              <div style={rowStyle}><span>{t('field_type')}</span><strong>{u.user_type ? t(`type_${u.user_type}` as 'type_admin') : '—'}</strong></div>
              <div style={rowStyle}><span>{t('field_status')}</span><strong>{u.status ? t(`status_${u.status}` as 'status_active') : '—'}</strong></div>
              <div style={rowStyle}><span>{t('field_ecosystem')}</span><strong>{u.ecosystem?.name ?? u.ecosystem?.slug ?? '—'}</strong></div>
              <div style={rowStyle}><span>{t('field_locale')}</span><strong>{u.locale ?? '—'}</strong></div>
              <div style={{ ...rowStyle, borderBottom: 'none' }}><span>{t('field_created')}</span><strong>{dateFmt.format(new Date(u.created_at))}</strong></div>
              {detail?.profile && (
                <Link href={`/admin/experts/${detail.profile.id}`} style={{ display: 'inline-block', marginTop: 10, fontSize: 12.5, fontWeight: 600, color: 'var(--sk-accent, var(--sk-accent))', textDecoration: 'none' }}>
                  {t('link_expert_profile')}
                </Link>
              )}
            </section>

            <section style={card} aria-label={t('section_access')}>
              <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--sk-muted)', margin: '0 0 10px' }}>
                {t('section_access')}
              </h2>
              {/* « Jamais connecté » vient de session_logs, pas de last_login_at :
                  la migration d'inactivité a rétro-rempli cette colonne avec
                  created_at, elle ne prouve donc aucune connexion réelle. */}
              <div style={rowStyle}>
                <span>{t('field_last_login')}</span>
                <strong>{u.has_ever_logged_in && u.last_login_at ? dateTimeFmt.format(new Date(u.last_login_at)) : t('never_logged_in')}</strong>
              </div>
              <div style={rowStyle}><span>{t('field_email_verified')}</span><strong>{u.email_verified ? t('yes') : t('no')}</strong></div>
              {/* Le NUMÉRO n'est jamais affiché — seulement le fait vérifié. */}
              <div style={{ ...rowStyle, borderBottom: 'none' }}><span>{t('field_phone_verified')}</span><strong>{u.phone_verified ? t('yes') : t('no')}</strong></div>
            </section>
          </div>

          {org && (
            <section style={{ ...card, marginBottom: 14 }} aria-label={t('section_organization')}>
              <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--sk-muted)', margin: '0 0 10px' }}>
                {t('section_organization')}
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{org.company_name ?? '—'}</div>
                  <Link href={`/admin/organisations/${org.id}`} style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sk-accent, var(--sk-accent))', textDecoration: 'none' }}>
                    {t('link_organization')}
                  </Link>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ color: 'var(--sk-muted)' }}>{t('field_role')}</span>
                  <select
                    value={org.role_in_org}
                    disabled={busy}
                    onChange={(e) => setConfirming({ kind: 'role', role: e.target.value, force: false })}
                    style={{ padding: '7px 10px', borderRadius: 9, border: '1px solid var(--sk-border)', fontSize: 13, fontFamily: 'inherit', background: 'var(--sk-surface)', color: 'var(--sk-text)' }}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{t(`role_${r}` as 'role_admin')}</option>
                    ))}
                  </select>
                </label>
              </div>
            </section>
          )}

          {/* Frise UNIFIÉE connexions + invalidations (fusionnée serveur). */}
          <section style={card} aria-label={t('section_sessions')}>
            <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--sk-muted)', margin: '0 0 10px' }}>
              {t('section_sessions')} · {t('sessions_count', { count: loginCount })}
            </h2>
            {sessionsTroncature?.atteint && <BandeauTroncature texte={tPlafond('sessions_tronquees', { plafond: sessionsTroncature.plafond })} />}
            {timeline.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--sk-muted)', padding: '10px 0' }}>{t('sessions_empty')}</div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {timeline.map((e, i) => (
                  <li key={`${e.at}-${i}`} style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: i === timeline.length - 1 ? 'none' : '1px solid var(--sk-surface-2)', fontSize: 12.5, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--sk-muted)', minWidth: 150 }}>{dateTimeFmt.format(new Date(e.at))}</span>
                    <span style={{ fontWeight: 600, flex: '1 1 220px' }}>
                      {e.kind === 'login'
                        ? t('session_login')
                        : e.action === 'user_suspended'
                          ? t('session_suspended')
                          : e.by_self
                            ? t('session_revoked_by_self')
                            : t('session_revoked_by_admin')}
                    </span>
                    <span style={{ color: 'var(--sk-muted)' }}>{e.ip_address ?? '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ─── ZONE IRRÉVERSIBLE ───────────────────────────────────────────
              SÉPARÉE, et pas seulement décorée : elle est en bas de page, hors
              de la barre d'actions de l'en-tête, avec son propre encadré. Un
              geste sans retour ne doit pas voisiner un geste annulable — le
              clic de proximité est une vraie cause d'accident. */}
          <section
            style={{
              ...card,
              marginTop: 14,
              borderColor: 'var(--sk-red-soft)',
              background: 'var(--sk-red-soft)',
            }}
            aria-label={t('section_danger')}
          >
            <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--sk-red)', margin: '0 0 8px' }}>
              {t('section_danger')}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--sk-red)', lineHeight: 1.6, margin: '0 0 12px' }}>
              {t('purge_section_body')}
            </p>
            {purgeBlockedReason ? (
              <p
                role="note"
                style={{
                  margin: 0, padding: '11px 14px', borderRadius: 10,
                  background: 'var(--sk-surface)', border: '1px solid var(--sk-red-soft)',
                  color: 'var(--sk-red)', fontSize: 13, lineHeight: 1.55,
                }}
              >
                {purgeBlockedReason}
              </p>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => { setPurgeEmail(''); setPurgeAck(false); setPurgeOpen(true) }}
                style={btn(true)}
              >
                {t('action_purge')}
              </button>
            )}
          </section>

          {/* ── Suppression définitive : trois exigences, à l'écran ────────
              L'écran ne garde rien — il rend LISIBLE ce que le serveur va
              exiger de toute façon (adresse identique, acquittement). Le bouton
              désactivé est de la courtoisie ; le refus fait autorité côté
              serveur (confirm_email_mismatch / org_lockout_ack_required). */}
          {purgeOpen && u && (
            <div
              role="dialog"
              aria-modal="true"
              style={{ position: 'fixed', inset: 0, background: 'color-mix(in srgb, var(--sk-encre) 45%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }}
            >
              <div style={{ background: 'var(--sk-surface)', borderRadius: 14, padding: '22px 24px', maxWidth: 560, width: '100%' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px', color: 'var(--sk-red)' }}>
                  {t('confirm_purge_title')}
                </h3>
                <p style={{ fontSize: 13.5, color: 'var(--sk-muted)', lineHeight: 1.6, margin: '0 0 12px' }}>
                  {t('confirm_purge_body', { name: fullName })}
                </p>
                <p style={{ fontSize: 13, color: 'var(--sk-red)', background: 'var(--sk-red-soft)', borderRadius: 10, padding: '11px 14px', lineHeight: 1.6, margin: '0 0 14px' }}>
                  {t('confirm_purge_irreversible')}
                </p>

                {/* Avertissement organisation — servi par le SERVEUR avant le
                    clic, pas découvert après. On ne bloque pas : on exige un
                    acquittement, revalidé côté serveur. */}
                {/* « Je n'ai pas pu vérifier » — dit AVANT le clic. L'absence
                    d'avertissement ne doit jamais être lue comme une absence de
                    risque : la purge sera refusée (503) tant que la
                    vérification n'aura pas abouti. */}
                {purgeOrgLockoutUnknown && (
                  <div role="alert" style={{ margin: '0 0 14px', padding: '12px 14px', borderRadius: 10, background: 'var(--sk-amber-soft)', border: '1px solid var(--sk-amber-soft)' }}>
                    <p style={{ fontSize: 13, color: 'var(--sk-amber)', lineHeight: 1.6, margin: 0 }}>
                      {t('confirm_purge_org_lockout_unknown')}
                    </p>
                  </div>
                )}

                {purgeOrgLockout.length > 0 && (
                  <div role="alert" style={{ margin: '0 0 14px', padding: '12px 14px', borderRadius: 10, background: 'var(--sk-amber-soft)', border: '1px solid var(--sk-amber-soft)' }}>
                    <p style={{ fontSize: 13, color: 'var(--sk-amber)', lineHeight: 1.6, margin: '0 0 8px' }}>
                      {t('confirm_purge_org_lockout', {
                        orgs: purgeOrgLockout
                          .map((o) => o.company_name ?? t('purge_org_unnamed'))
                          .join(', '),
                      })}
                    </p>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--sk-amber)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={purgeAck}
                        onChange={(e) => setPurgeAck(e.target.checked)}
                        style={{ marginTop: 2 }}
                      />
                      <span>{t('confirm_purge_org_lockout_ack')}</span>
                    </label>
                  </div>
                )}

                <label style={{ display: 'block', fontSize: 13, color: 'var(--sk-muted)', marginBottom: 6 }}>
                  {t('confirm_purge_email_label', { email: u.email ?? '—' })}
                </label>
                <input
                  type="email"
                  autoComplete="off"
                  value={purgeEmail}
                  onChange={(e) => setPurgeEmail(e.target.value)}
                  placeholder={u.email ?? ''}
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 9,
                    border: '1px solid var(--sk-border)', fontSize: 13,
                    fontFamily: 'inherit', marginBottom: 16,
                  }}
                />

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setPurgeOpen(false)} style={btn()}>
                    {t('confirm_cancel')}
                  </button>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      purgeEmail.trim().toLowerCase() !== (u.email ?? '').trim().toLowerCase() ||
                      (purgeOrgLockout.length > 0 && !purgeAck)
                    }
                    onClick={() => {
                      setPending({
                        kind: 'purge',
                        confirmEmail: purgeEmail.trim(),
                        acknowledgeOrgLockout: purgeAck,
                      })
                      setPurgeOpen(false)
                      setReauthOpen(true)
                    }}
                    style={{
                      ...btn(true),
                      opacity:
                        purgeEmail.trim().toLowerCase() !== (u.email ?? '').trim().toLowerCase() ||
                        (purgeOrgLockout.length > 0 && !purgeAck)
                          ? 0.5
                          : 1,
                    }}
                  >
                    {t('confirm_purge_yes')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Confirmation : NOMME ce qui va se passer ─────────────────── */}
          {confirming && (
            <div
              role="dialog"
              aria-modal="true"
              style={{ position: 'fixed', inset: 0, background: 'color-mix(in srgb, var(--sk-encre) 45%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }}
            >
              <div style={{ background: 'var(--sk-surface)', borderRadius: 14, padding: '22px 24px', maxWidth: 520, width: '100%' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px', color: 'var(--sk-text)' }}>
                  {confirming.kind === 'role' ? t('confirm_role_title')
                    : confirming.kind === 'revoke' ? t('confirm_revoke_title')
                      : confirming.kind === 'suspend' ? t('confirm_suspend_title')
                        : t('confirm_reactivate_title')}
                </h3>
                <p style={{ fontSize: 13.5, color: 'var(--sk-muted)', lineHeight: 1.6, margin: '0 0 12px' }}>
                  {confirming.kind === 'role'
                    ? t('confirm_role_body', {
                        name: fullName,
                        from: t(`role_${org?.role_in_org ?? 'viewer'}` as 'role_admin'),
                        to: t(`role_${confirming.role}` as 'role_admin'),
                        org: org?.company_name ?? '—',
                      })
                    : confirming.kind === 'revoke' ? t('confirm_revoke_body', { name: fullName })
                      : confirming.kind === 'suspend' ? t('confirm_suspend_body', { name: fullName })
                        : t('confirm_reactivate_body', { name: fullName })}
                </p>
                {/* Anti-lock-out : on DIT ce qui arrive à l'organisation. */}
                {confirming.kind === 'role' && confirming.force && (
                  <p role="alert" style={{ fontSize: 13, color: 'var(--sk-red)', background: 'var(--sk-red-soft)', borderRadius: 10, padding: '11px 14px', lineHeight: 1.6, margin: '0 0 12px' }}>
                    {t('confirm_role_last_admin_warning', { org: org?.company_name ?? '—' })}
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setConfirming(null)} style={btn()}>{t('confirm_cancel')}</button>
                  <button
                    type="button"
                    onClick={() => { setPending(confirming); setConfirming(null); setReauthOpen(true) }}
                    style={btn(confirming.kind === 'suspend' || (confirming.kind === 'role' && confirming.force))}
                  >
                    {t('confirm_yes')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Ré-authentification — mécanisme EXISTANT, réutilisé tel quel. */}
          <ReauthModal
            open={reauthOpen}
            onConfirm={(token) => {
              setReauthOpen(false)
              const action = pending
              setPending(null)
              if (action) void run(action, token)
            }}
            onCancel={() => { setReauthOpen(false); setPending(null) }}
          />
        </>
      )}
    </div>
  )
}
