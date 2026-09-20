// scripts/recette-3-3.mjs — LA RECETTE : LE SERVEUR RÉPOND CE QU'IL DOIT À QUI LE DEMANDE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QU'ELLE PROUVE — et rien d'autre
//   Contre une VRAIE base et un VRAI serveur, pour chaque route du cloisonnement
//   (dérivées de scripts/inventaire-cloisonnement.mjs, jamais recopiées ici) et
//   pour chaque POPULATION (anonyme, expert freelance, expert CDI, client,
//   cabinet, administrateur), le statut HTTP rendu est celui attendu — LES REFUS
//   AUTANT QUE LES SUCCÈS. Un contrôle qui ne vérifie que les 200 laisse passer
//   un fail-open (§E.22 ⑥ en est la preuve vécue).
//   Puis le PARCOURS MÉTIER, une fois : publier → mise en relation → candidature
//   → dévoilement → conversation. C'est le seul endroit où l'on voit un embed
//   cassé (§E.18), une policy récursive (§E.6) ou un trigger muet (§E.23).
//
// CE QU'ELLE NE PROUVE PAS — et il faut le dire
//   Rien du RENDU, rien de l'i18n, rien de l'UX. Rien des Redirect URLs (gardées
//   par diag-parametrage-manuel). Rien de Vonage ni du SMTP : l'OTP est SIGNÉ ici
//   avec le même secret que verify-phone-otp, et l'e-mail est confirmé par
//   l'API admin (`email_confirm: true` — arbitrage de l'architecte, 20/09/2026).
//   Une recette dont on croit qu'elle couvre tout est pire qu'aucune.
//
// CE QU'ELLE N'A PAS ENCORE PROUVÉ — ÉTAT AU 20/09/2026
//   ⚠️ ELLE N'A JAMAIS TOURNÉ CONTRE UNE BASE. Livrée NON VERTE, volontairement :
//   c'est l'état exact de la migration de §E.12, et la seule façon honnête de
//   la livrer est de le dire. Elle prouvera quelque chose le jour où elle tourne
//   pour de vrai — voir « CE QU'IL FAUT COMME ENVIRONNEMENT » ci-dessous.
//
// ┌─ CE QU'IL FAUT COMME ENVIRONNEMENT ─────────────────────────────────────┐
// │ 1. Un projet Supabase JETABLE, migrations appliquées (`supabase db push`),│
// │    seed de production joué (écosystème DEV_DOMAIN_SLUG actif, rôle       │
// │    « Gratuit », pays FR, au moins une branche et une spécialité).         │
// │ 2. Un serveur Next qui pointe sur ce projet : `npm run dev` avec un       │
// │    .env.local dont NEXT_PUBLIC_SUPABASE_URL est CE projet.                │
// │ 3. Dans l'environnement du script (`node --env-file=.env.local`) :        │
// │    NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,                │
// │    SUPABASE_SERVICE_ROLE_KEY, PHONE_OTP_HMAC_SECRET (ou SUPABASE_JWT_SECRET),│
// │    DEV_DOMAIN_SLUG ; et RECETTE_BASE_URL si le serveur n'est pas           │
// │    http://localhost:3000.                                                  │
// │ 4. Pour le PARCOURS (pas la matrice) : ENABLE_RERANKING=true et            │
// │    COHERE_API_KEY, sinon aucun match ne naît et la candidature répond 403  │
// │    not_matched — la recette le dit et marque ces pas « non joués ».        │
// │ 5. L'inscription passe par le VRAI signUp anon (lib/auth-signup) : le      │
// │    projet jetable doit accepter le signUp (SMTP configuré OU confirmation   │
// │    désactivée dans Auth) — sinon register-* échoue avant tout.            │
// └─────────────────────────────────────────────────────────────────────────┘
//
// GARDE-FOUS
//   · sous garde-ecriture : sans --db, refus en code 2, et la liste de ce qu'elle
//     écrirait ;
//   · --base-jetable=<ref> OBLIGATOIRE et ÉGAL au ref du projet visé
//     (https://<ref>.supabase.co) : on ne pointe pas une recette qui crée des
//     comptes sur une base par accident ;
//   · tout ce qu'elle crée porte un identifiant de passage unique et est
//     NETTOYÉ à la fin (sauf --garder), en disant ce qui reste.
//
// SORTIE : 0 vert · 1 rouge · 2 n'a pas tourné (préconditions).
//
//   node --env-file=.env.local scripts/recette-3-3.mjs --db --base-jetable=<ref> [--garder]
//
// ⚠️ CE SCRIPT ÉCRIT EN BASE — c'est le CINQUIÈME hors du périmètre de
//    diag-scripts-destructeurs (qui ne balaie que diag-*.mjs), après
//    cleanup-test-data, verify-test-profile-once, backfill-matching-experts et
//    creer-premier-administrateur. Dit ici et dans le commit qui le livre (§E.4).

import { createClient } from '@supabase/supabase-js'
import { INVENTORY, ATTENDUS, POPULATIONS } from './inventaire-cloisonnement.mjs'
import { exigerAutorisationEcriture } from './garde-ecriture.mjs'
import { signPhoneOtpToken } from '../lib/phone-otp-token.ts'

// ═══════════════════════════════════════════════════════════════════════════
// 0. PRÉCONDITIONS — on ne tourne pas à moitié
// ═══════════════════════════════════════════════════════════════════════════
const arg = (nom) => process.argv.find((a) => a.startsWith(`--${nom}=`))?.split('=').slice(1).join('=') ?? null
const GARDER = process.argv.includes('--garder')
const BASE = (process.env.RECETTE_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ECO = process.env.DEV_DOMAIN_SLUG ?? ''
const REF = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(SUPABASE_URL)?.[1] ?? null

const manquants = []
if (!SUPABASE_URL || !REF) manquants.push('NEXT_PUBLIC_SUPABASE_URL (https://<ref>.supabase.co)')
if (!ANON) manquants.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
if (!SRK) manquants.push('SUPABASE_SERVICE_ROLE_KEY')
if (!process.env.PHONE_OTP_HMAC_SECRET && !process.env.SUPABASE_JWT_SECRET) manquants.push('PHONE_OTP_HMAC_SECRET (ou SUPABASE_JWT_SECRET)')
if (!ECO) manquants.push('DEV_DOMAIN_SLUG (le slug d un écosystème ACTIF de la base visée)')
const refJetable = arg('base-jetable')
if (!refJetable) manquants.push('--base-jetable=<ref> (le ref du projet JETABLE, égal à celui de NEXT_PUBLIC_SUPABASE_URL)')
if (manquants.length) {
  console.error('\n✘ La recette n’a pas tourné — il manque :\n' + manquants.map((m) => `    · ${m}`).join('\n'))
  console.error('\n  Lisez « CE QU’IL FAUT COMME ENVIRONNEMENT » en tête du script.\n')
  process.exit(2)
}
if (refJetable !== REF) {
  console.error(`\n✘ --base-jetable=${refJetable} ≠ ref du projet visé (${REF}). On ne crée pas des comptes sur une base par accident.\n`)
  process.exit(2)
}

exigerAutorisationEcriture({
  script: 'recette-3-3.mjs',
  ecrit: [
    'auth.users + public.users — un compte par population (6), avec un identifiant de passage unique',
    'public.organizations, organization_members — deux organisations (client, cabinet)',
    'public.profiles, profile_* — deux profils experts',
    'public.domains, domain_configs — un écosystème de passage (puis désactivé)',
    'public.publications, matches, candidatures, conversations, messages — le parcours métier, une fois',
    'public.audit_logs — les traces des actions ci-dessus (supprimées au nettoyage)',
  ],
  perte: 'aucune sur les données préexistantes — la recette ne touche que ce qu’elle a créé ; le nettoyage final le supprime',
  drapeaux: `--db --base-jetable=${REF}`,
})

const admin = createClient(SUPABASE_URL, SRK, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = () => createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

// Le serveur répond-il, et sur CE projet ?
{
  let r
  try { r = await fetch(`${BASE}/api/countries`, { headers: { 'x-subdomain': ECO } }) } catch { r = null }
  if (!r || !r.ok) {
    console.error(`\n✘ Le serveur ${BASE} ne répond pas (GET /api/countries → ${r ? r.status : 'injoignable'}). Lancez \`npm run dev\` sur le projet jetable.\n`)
    process.exit(2)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Le compteur : vert / rouge / OBSERVÉ (attendu non établi) / NON JOUÉ
// ═══════════════════════════════════════════════════════════════════════════
const bilan = { vert: 0, rouge: 0, observe: 0, nonJoue: 0 }
const rouges = []
const observes = []
const ok = (cond, label, detail) => {
  if (cond) { bilan.vert++; console.log(`  ok   ${label}`) }
  else { bilan.rouge++; rouges.push(label); console.log(`  KO   ${label}${detail ? `\n       → ${detail}` : ''}`) }
}
const observer = (label, valeur) => { bilan.observe++; observes.push(`${label} → ${valeur}`); console.log(`  ··   OBSERVÉ (non compté) ${label} → ${valeur}`) }
const nonJoue = (label, pourquoi) => { bilan.nonJoue++; console.log(`  --   NON JOUÉ ${label} — ${pourquoi}`) }
const section = (t) => console.log(`\n═══ ${t} ═══\n`)

// ═══════════════════════════════════════════════════════════════════════════
// 1. LES FIXTURES — un identifiant de passage, et tout ce qu'on crée le porte
// ═══════════════════════════════════════════════════════════════════════════
const PASSAGE = `r${Date.now().toString(36)}`
const email = (pop) => `recette-${PASSAGE}-${pop}@example.com`
const MDP = `Recette-${PASSAGE}-Mdp!`
// Numéros E.164 uniques par passage (index unique partiel sur phone vérifié).
const telephone = (n) => `+3361${String(Date.now() % 1_000_000).padStart(6, '0').slice(0, 5)}${n}`
const cree = { auth: [], organisations: [], domaines: [], publications: [] }

/** Appel HTTP au serveur, comme le ferait useSecureFetch : bearer, x-subdomain, cookie de session. */
async function appel(pop, method, chemin, { body, eco } = {}) {
  const headers = { 'x-subdomain': eco ?? pop?.eco ?? ECO, 'content-type': 'application/json' }
  if (pop?.token) headers.authorization = `Bearer ${pop.token}`
  if (pop?.cookie) headers.cookie = pop.cookie
  const r = await fetch(`${BASE}${chemin}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  let json = null
  try { json = await r.json() } catch { json = null }
  return { status: r.status, json, headers: r.headers }
}

/** Ouvre la session comme le client : signInWithPassword → bearer, puis init-session → cookie. */
async function ouvrirSession(pop) {
  const { data, error } = await anon().auth.signInWithPassword({ email: pop.email, password: MDP })
  if (error || !data.session) throw new Error(`connexion ${pop.nom} : ${error?.message ?? 'aucune session'}`)
  pop.token = data.session.access_token
  pop.userId = data.user.id
  const init = await appel(pop, 'POST', '/api/auth/init-session')
  const setCookie = init.headers.get('set-cookie') ?? ''
  const m = /(ss_token[^=;]*)=([^;]+)/.exec(setCookie)
  if (m) pop.cookie = `${m[1]}=${m[2]}`
  ok(init.status === 200 && !!m, `${pop.nom} : init-session ouvre la session unique (200 + cookie)`, `status ${init.status}, set-cookie ${setCookie ? 'présent' : 'absent'}`)
}

/** Confirme l'e-mail par l'API admin — l'arbitrage `email_confirm: true`. */
async function confirmerEmail(adresse) {
  const { data: rows } = await admin.from('users').select('id').eq('email', adresse).maybeSingle()
  const id = rows?.id
  if (!id) throw new Error(`compte ${adresse} : aucun miroir public.users (§E.23 — le trigger n’a rien créé ?)`)
  cree.auth.push(id)
  const { error } = await admin.auth.admin.updateUserById(id, { email_confirm: true })
  if (error) throw new Error(`email_confirm ${adresse} : ${error.message}`)
  await admin.from('users').update({ email_verified: true, status: 'active' }).eq('id', id)
  return id
}

section('1. Les fixtures — comptes créés par les VRAIES routes')

// Taxonomie : la première branche et sa première spécialité de l'écosystème.
const taxo = await appel(null, 'GET', `/api/taxonomy?locale=fr`)
ok(taxo.status === 200, 'GET /api/taxonomy répond 200 (public)', `status ${taxo.status}`)
const branche = taxo.json?.branches?.[0] ?? null
const specialite = (taxo.json?.specialities ?? []).find((s) => s.branch_id === branche?.id) ?? taxo.json?.specialities?.[0] ?? null
if (!branche) { console.error('\n✘ Aucune branche dans l’écosystème : la recette ne peut pas inscrire d’expert. Seed manquant.\n'); process.exit(2) }

// ── L'administrateur : le contournement §E.23, assumé et documenté ──────────
// Aucune route ne crée le premier administrateur : createUser avec le seul rôle
// que le trigger sait traiter sans créer ni profil ni organisation, puis bascule.
const POP = {}
{
  const adresse = email('admin')
  const { data, error } = await admin.auth.admin.createUser({
    email: adresse, password: MDP, email_confirm: true,
    user_metadata: { role: 'entreprise', domain_slug: ECO, firstname: 'Recette', lastname: 'Admin' },
  })
  ok(!error && !!data?.user, 'admin : createUser (rôle-pont « entreprise », §E.23)', error?.message)
  if (data?.user) {
    cree.auth.push(data.user.id)
    const { data: miroir } = await admin.from('users').select('id').eq('id', data.user.id).maybeSingle()
    ok(!!miroir, 'admin : le miroir public.users existe (sinon compte fantôme, §E.23)')
    await admin.from('users').update({ user_type: 'admin', status: 'active', email_verified: true }).eq('id', data.user.id)
    POP.admin = { nom: 'admin', email: adresse, eco: ECO }
  }
}

// ── Les experts : POST /api/auth/public/register-expert, OTP signé ici ──────
async function inscrireExpert(role, n) {
  const adresse = email(role)
  const phone = telephone(n)
  const body = {
    email: adresse, password: MDP, firstname: 'Recette', lastname: role === 'expert' ? 'Freelance' : 'Cdi',
    role, domain_slug: ECO, specialty: specialite?.name ?? 'Autre',
    branch_id: branche.id, ...(specialite ? { speciality_id: specialite.id } : { speciality_other: 'Recette' }),
    phone, phone_otp_token: signPhoneOtpToken({ phone, request_id: `recette-${PASSAGE}` }),
  }
  const r = await appel(null, 'POST', '/api/auth/public/register-expert', { body })
  ok(r.status >= 200 && r.status < 300, `register-expert (${role}) accepte l’inscription`, `status ${r.status} ${JSON.stringify(r.json)?.slice(0, 160)}`)
  if (r.status < 200 || r.status >= 300) return null
  const id = await confirmerEmail(adresse)
  return { nom: role === 'expert' ? 'expert_freelance' : 'expert_cdi', email: adresse, eco: ECO, userId: id }
}
// ── Les organisations : POST /api/auth/register-org ────────────────────────
async function inscrireOrg(orgType, n) {
  const adresse = email(orgType)
  const phone = telephone(n)
  const body = {
    email: adresse, password: MDP, first_name: 'Recette', last_name: orgType,
    company_name: `Recette ${PASSAGE} ${orgType}`, country_code: 'FR', org_type: orgType, domain_slug: ECO,
    siren: `${String(Date.now()).slice(-9)}`, cgu_accepted: true,
    phone, phone_otp_token: signPhoneOtpToken({ phone, request_id: `recette-${PASSAGE}` }),
  }
  const r = await appel(null, 'POST', '/api/auth/register-org', { body })
  ok(r.status >= 200 && r.status < 300, `register-org (${orgType}) accepte l’inscription`, `status ${r.status} ${JSON.stringify(r.json)?.slice(0, 160)}`)
  if (r.status < 200 || r.status >= 300) return null
  const id = await confirmerEmail(adresse)
  const { data: org } = await admin.from('organizations').select('id').eq('company_name', body.company_name).maybeSingle()
  if (org?.id) cree.organisations.push(org.id)
  return { nom: orgType, email: adresse, eco: ECO, userId: id, orgId: org?.id ?? null }
}

POP.expert_freelance = await inscrireExpert('expert', 1)
POP.expert_cdi = await inscrireExpert('cdi', 2)
POP.client = await inscrireOrg('client', 3)
POP.cabinet = await inscrireOrg('cabinet', 4)
POP.anonyme = { nom: 'anonyme', eco: ECO }

for (const p of Object.values(POP)) if (p.email) await ouvrirSession(p)

// ── L'écosystème de passage : créé par la VRAIE route admin, activé, puis un inactif ─
let ECO_AUTRE = null
let ECO_INACTIF = null
if (POP.admin?.token) {
  const slugA = `rec-${PASSAGE}-a`
  const slugI = `rec-${PASSAGE}-i`
  for (const [slug, actif] of [[slugA, true], [slugI, false]]) {
    const c = await appel(POP.admin, 'POST', '/api/admin/ecosystemes', { body: { name: `Recette ${slug}`, slug } })
    ok(c.status >= 200 && c.status < 300, `admin crée l’écosystème ${slug}`, `status ${c.status} ${JSON.stringify(c.json)?.slice(0, 120)}`)
    const id = c.json?.id ?? c.json?.domain?.id ?? null
    if (id) {
      cree.domaines.push(id)
      if (actif) {
        const a = await appel(POP.admin, 'PATCH', `/api/admin/ecosystemes/${id}`, { body: { active: true } })
        ok(a.status >= 200 && a.status < 300, `admin active ${slug} (un écosystème naît INACTIF — R1 de diag-admin-ecosystemes)`, `status ${a.status}`)
        ECO_AUTRE = slug
      } else ECO_INACTIF = slug
    }
  }
}

// ── Approbations par les VRAIES routes admin ───────────────────────────────
if (POP.admin?.token) {
  for (const p of [POP.client, POP.cabinet]) {
    if (!p?.orgId) continue
    const r = await appel(POP.admin, 'POST', '/api/admin/approve-org', { body: { organization_id: p.orgId } })
    ok([200, 409].includes(r.status), `approve-org (${p.nom}) : 200, ou 409 already_processed si la vérification l’a déjà tranchée`, `status ${r.status} ${r.json?.code ?? ''}`)
  }
  for (const p of [POP.expert_freelance, POP.expert_cdi]) {
    if (!p?.userId) continue
    const { data: prof } = await admin.from('profiles').select('id, verification_status').eq('user_id', p.userId).maybeSingle()
    p.profileId = prof?.id ?? null
    if (!prof) { ok(false, `${p.nom} : un profil existe (créé par le trigger)`); continue }
    if (prof.verification_status === 'pending_admin_review') {
      const r = await appel(POP.admin, 'POST', '/api/admin/approve-expert', { body: { profile_id: prof.id } })
      ok(r.status === 200, `approve-expert (${p.nom})`, `status ${r.status} ${r.json?.code ?? ''}`)
    } else observer(`${p.nom} : verification_status à l’inscription`, prof.verification_status ?? 'null')
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. LE PARCOURS MÉTIER, UNE FOIS — il fournit aussi les identifiants de la matrice
// ═══════════════════════════════════════════════════════════════════════════
section('2. Le parcours métier — publier → mise en relation → candidature → dévoilement → conversation')
const ids = { publication: null, candidature: null, mission: null, conversation: null }
if (POP.client?.token) {
  const brouillon = await appel(POP.client, 'POST', '/api/publications', {
    body: {
      type: 'freelance', title: `Recette ${PASSAGE} — mission`, description: 'Mission de recette, créée par le script recette-3-3. Elle sera supprimée.',
      budget_min: 400, budget_max: 800, skills_required: ['recette'], seniorities: ['senior'], work_mode: 'remote',
      branch_id: branche.id, speciality_ids: specialite ? [specialite.id] : [], speciality_other: specialite ? null : 'Recette',
    },
  })
  ok(brouillon.status >= 200 && brouillon.status < 300, 'client : POST /api/publications crée un brouillon', `status ${brouillon.status} ${JSON.stringify(brouillon.json)?.slice(0, 160)}`)
  ids.publication = brouillon.json?.id ?? brouillon.json?.publication?.id ?? null
  if (ids.publication) {
    cree.publications.push(ids.publication)
    const pub = await appel(POP.client, 'POST', `/api/publications/${ids.publication}/publish`)
    ok(pub.status >= 200 && pub.status < 300, 'client : POST /publish publie l’annonce', `status ${pub.status} ${JSON.stringify(pub.json)?.slice(0, 200)}`)
  }
}
if (ids.publication && POP.expert_freelance?.token) {
  // La mise en relation : déclenchée par l'expert (le moteur tourne aussi en after() côté publish).
  const sync = await appel(POP.expert_freelance, 'POST', '/api/me/sync-matching')
  observer('expert : POST /api/me/sync-matching', `${sync.status} ${sync.json?.code ?? ''}`)
  const flux = await appel(POP.expert_freelance, 'GET', '/api/me/missions?locale=fr')
  ok(flux.status === 200, 'expert : GET /api/me/missions répond 200', `status ${flux.status}`)
  const mission = (flux.json?.missions ?? []).find((m) => m.publication_id === ids.publication || m.id === ids.publication) ?? flux.json?.missions?.[0] ?? null
  ids.mission = mission?.id ?? null
  if (!mission) {
    nonJoue('candidature → dévoilement → conversation', 'aucun match : moteur éteint (ENABLE_RERANKING / COHERE_API_KEY) ou pas encore tourné — voir environnement, point 4')
  } else {
    const cand = await appel(POP.expert_freelance, 'POST', '/api/candidatures', { body: { publication_id: ids.publication, cover_message: 'Candidature de recette.' } })
    ok(cand.status >= 200 && cand.status < 300, 'expert : POST /api/candidatures dépose une candidature', `status ${cand.status} ${cand.json?.code ?? ''}`)
    ids.candidature = cand.json?.id ?? cand.json?.candidature?.id ?? null
    if (ids.candidature && POP.client?.token) {
      const liste = await appel(POP.client, 'GET', `/api/publications/${ids.publication}/candidatures?locale=fr&filter=all`)
      ok(liste.status === 200, 'client : GET candidatures de l’annonce → 200', `status ${liste.status}`)
      const texte = JSON.stringify(liste.json ?? {})
      ok(!/recette-r[a-z0-9]+-expert@example\.com/.test(texte) && !new RegExp(telephone(1).replace('+', '\\+')).test(texte),
        'client : ni l’e-mail ni le téléphone de l’expert ne sortent (§D.4)')
      ok(!/Recette Freelance/.test(texte), 'client : le nom complet ne sort pas avant dévoilement — un CODE (§D.4)')
      const unlock = await appel(POP.client, 'POST', `/api/candidatures/${ids.candidature}/unlock`)
      ok(unlock.status >= 200 && unlock.status < 300, 'client : POST /unlock dévoile (première place incluse ou 402 quota → observé)', `status ${unlock.status} ${unlock.json?.code ?? ''}`)
      const convs = await appel(POP.client, 'GET', '/api/me/conversations?locale=fr')
      ok(convs.status === 200, 'client : GET /api/me/conversations → 200', `status ${convs.status}`)
      ids.conversation = (convs.json?.conversations ?? [])[0]?.id ?? null
      if (ids.conversation) {
        const msg = await appel(POP.client, 'POST', `/api/conversations/${ids.conversation}/messages`, { body: { content: 'Bonjour — message de recette.' } })
        ok(msg.status >= 200 && msg.status < 300, 'client : POST message dans la conversation', `status ${msg.status} ${msg.json?.code ?? ''}`)
        const lu = await appel(POP.expert_freelance, 'GET', `/api/conversations/${ids.conversation}/messages`)
        ok(lu.status === 200 && JSON.stringify(lu.json).includes('message de recette'), 'expert : lit le message de l’organisation', `status ${lu.status}`)
      } else nonJoue('conversation → message', 'aucune conversation ouverte après le dévoilement')
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. LA MATRICE — dérivée de l'inventaire, jamais écrite ici
// ═══════════════════════════════════════════════════════════════════════════
section('3. La matrice — chaque route du cloisonnement × chaque population × chaque écosystème')

function cheminDe(route, spec) {
  let c = '/api/' + route.replace(/\/route\.ts$/, '')
  if (c.includes('[id]')) {
    const id = ids[spec.cible]
    if (!id) return null
    c = c.replace('[id]', id)
  }
  return c + (spec.query ?? '')
}
/** Le corps d'une cellule : celui de la spec, ou l'identifiant du parcours quand la cible est « dans le corps ». */
const corpsDe = (spec) => {
  if (spec.verbe === 'GET') return undefined
  if (spec.cible === 'publication_corps') return ids.publication ? { publication_id: ids.publication, cover_message: 'recette' } : {}
  return spec.corps ?? {}
}
const estRefus = (s) => [401, 403, 404].includes(s)
const est2xx = (s) => s >= 200 && s < 300
function juger(label, attendu, observe) {
  if (attendu === null || attendu === undefined) return observer(label, observe)
  if (attendu === 'parcours') return nonJoue(label, 'action à effet — prouvée une fois dans le parcours, jamais rejouée dans la matrice')
  if (attendu === '2xx') return ok(est2xx(observe), `${label} → 2xx`, `observé ${observe}`)
  if (attendu === 'metier') return ok(!estRefus(observe) && observe < 500, `${label} → pas un refus de droit (2xx ou 4xx métier)`, `observé ${observe}`)
  if (attendu === 'refus') return ok(estRefus(observe), `${label} → refus (401/403/404)`, `observé ${observe}`)
  return ok(observe === attendu, `${label} → ${attendu}`, `observé ${observe}`)
}

for (const [route, mode] of Object.entries(INVENTORY)) {
  const spec = ATTENDUS[route]
  if (!spec) { nonJoue(route, 'aucun attendu déclaré dans inventaire-cloisonnement.ATTENDUS — à établir en séance'); continue }
  const chemin = spec.cible === 'publication_corps' ? cheminDe(route, { ...spec, cible: null }) : cheminDe(route, spec)
  if (!chemin || (spec.cible === 'publication_corps' && !ids.publication)) { nonJoue(route, `identifiant « ${spec.cible} » indisponible (parcours non joué en amont)`); continue }
  for (const pop of POPULATIONS) {
    const p = POP[pop]
    if (!p) { nonJoue(`${route} × ${pop}`, 'population non créée'); continue }
    const r = await appel(p, spec.verbe, chemin, { body: corpsDe(spec) })
    juger(`${spec.verbe} ${route} × ${pop} (${mode})`, spec.attendus[pop], r.status)
  }
  // Les écosystèmes : autre actif, inactif, inconnu — pour l'organisation cliente et l'expert.
  for (const [nomEco, eco, attendu] of [
    ['autre actif', ECO_AUTRE, spec.eco_autre],
    ['inactif', ECO_INACTIF, spec.eco_inactif ?? 403],
    ['inconnu', `inconnu-${PASSAGE}`, 403],
  ]) {
    if (!eco) { nonJoue(`${route} × écosystème ${nomEco}`, 'écosystème non créé'); continue }
    for (const pop of ['client', 'expert_freelance']) {
      const p = POP[pop]
      if (!p) continue
      // Une action à effet ne se rejoue pas non plus sous un autre écosystème pour son propriétaire :
      // le refus attendu (404) ne mute rien, mais si l'attendu est faux, la cellule aurait muté.
      if (spec.attendus[pop] === 'parcours' && pop !== 'expert_freelance' && attendu !== 404) { nonJoue(`${route} × ${pop} × ${nomEco}`, 'action à effet'); continue }
      const r = await appel(p, spec.verbe, chemin, { eco, body: corpsDe(spec) })
      // Un expert est mono-écosystème à vie : hors du sien, toujours 403 (§D.3).
      juger(`${spec.verbe} ${route} × ${pop} × x-subdomain ${nomEco}`, pop === 'expert_freelance' ? 403 : attendu, r.status)
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. LE NETTOYAGE — on ne laisse rien, et on dit ce qui reste
// ═══════════════════════════════════════════════════════════════════════════
section('4. Nettoyage')
if (GARDER) console.log('  --   --garder : les fixtures restent en base (préfixe ' + PASSAGE + ')')
else {
  const restes = []
  // Les traces d'audit portent une clé RESTRICT vers users : elles partent d'abord.
  if (cree.auth.length) {
    const { error } = await admin.from('audit_logs').delete().in('user_id', cree.auth)
    if (error) restes.push(`audit_logs : ${error.message}`)
  }
  for (const id of cree.publications) {
    const { error } = await admin.from('publications').delete().eq('id', id)
    if (error) restes.push(`publication ${id} : ${error.message}`)
  }
  for (const id of cree.organisations) {
    const { error } = await admin.from('organizations').delete().eq('id', id)
    if (error) restes.push(`organisation ${id} : ${error.message}`)
  }
  for (const id of cree.auth) {
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) restes.push(`compte ${id} : ${error.message}`)
  }
  for (const id of cree.domaines) {
    const { error } = await admin.from('domains').delete().eq('id', id)
    if (error) restes.push(`écosystème ${id} : ${error.message}`)
  }
  ok(restes.length === 0, `tout ce que la recette a créé est supprimé (${cree.auth.length} comptes, ${cree.organisations.length} organisations, ${cree.publications.length} annonces, ${cree.domaines.length} écosystèmes)`,
    restes.join(' ; '))
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n━━━ ${bilan.vert} vert · ${bilan.rouge} rouge · ${bilan.observe} observé (non compté) · ${bilan.nonJoue} non joué ━━━`)
if (observes.length) console.log('\n  À ÉTABLIR EN SÉANCE (observés, à promouvoir en attendus dans inventaire-cloisonnement.ATTENDUS) :\n' + observes.map((o) => `    · ${o}`).join('\n'))
if (rouges.length) console.log('\n  ROUGES :\n' + rouges.map((r) => `    · ${r}`).join('\n'))
process.exit(bilan.rouge ? 1 : 0)
