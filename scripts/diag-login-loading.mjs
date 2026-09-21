// scripts/diag-login-loading.mjs — UN DRAPEAU DE CHARGEMENT POSÉ AVANT UN `await`
// SE RELÂCHE DANS UN `finally`, JAMAIS PAR ÉNUMÉRATION — SUR TOUS LES ÉCRANS.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   `/connexion` relâchait son drapeau en listant ses chemins de sortie. Sur
//   NEUF sorties, DEUX avaient été oubliées — les deux refus pour compte
//   suspendu. Ces deux-là redirigent vers `/connexion` alors qu'on y est DÉJÀ :
//   pas de démontage, et le bouton restait figé sur « Connexion en cours… »
//   indéfiniment. Il fallait recharger la page à la main.
//
//   Le défaut n'était PAS propre à la suspension : toute exception levée dans
//   le handler produisait le même gel, en silence. L'énumération marche jusqu'au
//   jour où quelqu'un ajoute un chemin — ou jusqu'à la première exception, qui
//   n'est énumérable par personne.
//
// ┌─ CONVERTI EN BALAYAGE (lot C4b, 20/09/2026) ────────────────────────────┐
// │ Il ne regardait que DEUX écrans de connexion. La propriété vaut pour     │
// │ tous : il balaie `components/` + `app/[locale]/`, trouve chaque          │
// │ gestionnaire qui pose un drapeau de chargement (`setLoading(true)`,      │
// │ `setSaving(true)`, `setBusy(true)`, …) puis ATTEND, et classe :          │
// │   · FINALLY                — relâché dans un `finally`, et là seulement ; │
// │   · FINALLY + ÉNUMÉRATION  — un `finally` ET des relâchements épars :    │
// │                              l'énumération est repartie ;                 │
// │   · ÉNUMÉRATION            — aucun `finally` : chaque sortie doit y       │
// │                              penser, et l'exception n'y pense jamais.     │
// │ Mesuré : 61 gestionnaires — 40 FINALLY, 5 FINALLY + ÉNUMÉRATION,          │
// │ 16 ÉNUMÉRATION. Les 21 sont LUS un par un et gelés avec leur raison ;     │
// │ 4 d'entre eux FIGENT réellement aujourd'hui (aucun `catch` : une          │
// │ exception laisse le bouton en « … en cours » pour toujours).              │
// └─────────────────────────────────────────────────────────────────────────┘
//
//   node scripts/diag-login-loading.mjs   → contrôles statiques. AUCUN accès base.
//
// LECTURE PURE : ce script n'écrit JAMAIS.

import { RACINES_CLIENT, lire, sansCommentaires, fichiers, bilan } from './balayage-promesse.mjs'

const { ok, section, info, fin } = bilan()

// ══════════════════════════════════════════════════════════════════════════
// LE MOTIF
// ══════════════════════════════════════════════════════════════════════════

/** Les setters qui nomment un CHARGEMENT — pas `setOpen`, pas `setConfirmReject`. */
const NOMS = /^set(Loading|Submitting|Busy|Saving|Sending|Pending|Uploading|Deleting|Working|InFlight|Processing|Refreshing|Checking|Verifying|Resending|Creating|Publishing|Closing|Reactivating|Unlocking|Rejecting|Selecting|Fetching|Syncing|Running|Removing|Updating|Purging|Suspending|Revoking|Toggling|Scheduling|Exporting|Importing|Signing|Registering|Confirming|Connecting|Requesting|Redirecting)$/

/**
 * Le GESTIONNAIRE qui contient une position : on remonte accolade par accolade
 * jusqu'au `{` d'une tête de fonction (`=> {`, `function f(…) {`), en sautant
 * les blocs (`if`, `try`, `for`…). Puis on ferme au `}` correspondant.
 */
function gestionnaireAutour(src, pos) {
  let prof = 0
  for (let i = pos; i >= 0; i--) {
    const c = src[i]
    if (c === '}') prof++
    else if (c === '{') {
      if (prof > 0) { prof--; continue }
      const avant = src.slice(Math.max(0, i - 200), i)
      const teteDeFonction = /(=>|\)|function\s*\w*\s*\([^)]*\))\s*$/.test(avant)
      const bloc = /\b(if|for|while|switch|try|catch|finally|else|do)\s*(\([^)]*\))?\s*$/.test(avant)
      if (teteDeFonction && !bloc) {
        let p = 0
        for (let j = i; j < src.length; j++) {
          if (src[j] === '{') p++
          else if (src[j] === '}') { p--; if (p === 0) return { debut: i, corps: src.slice(i, j + 1) } }
        }
        return null
      }
    }
  }
  return null
}

/** Le premier appel qui identifie le gestionnaire : une route `/api/…` ou un appel `supabase.x.y`. */
const discriminant = (corps) =>
  corps.match(/['"`](\/api\/[^'"`?$]+)/)?.[1].replace(/\/$/, '') ??
  corps.match(/supabase\.\w+\.\w+/)?.[0] ??
  corps.match(/\bawait\s+([A-Za-z_]\w*)\(/)?.[1] ??
  '?'

export function gestionnaires(src) {
  const out = []
  for (const m of src.matchAll(/\b(set[A-Z]\w*)\(true\)/g)) {
    const setter = m[1]
    if (!NOMS.test(setter)) continue
    const g = gestionnaireAutour(src, m.index)
    const ligne = src.slice(0, m.index).split('\n').length
    if (!g) { out.push({ setter, ligne, classe: 'NON RÉSOLU', cle: `? | ${setter}` }); continue }
    if (!/\bawait\b/.test(g.corps.slice(m.index - g.debut))) continue // aucune attente : pas un chargement
    const relache = new RegExp(`\\b${setter}\\(false\\)`, 'g')
    // `} finally {` sur une ligne, ou `}` puis `finally {` à la ligne suivante : la même chose.
    const mFinally = [...g.corps.matchAll(/\}\s*finally\s*\{/g)].at(-1)
    const iFinally = mFinally ? mFinally.index : -1
    const dansFinally = iFinally >= 0 && relache.test(g.corps.slice(iFinally))
    const epars = (g.corps.slice(0, iFinally < 0 ? undefined : iFinally).match(relache) ?? []).length
    const classe = dansFinally && epars === 0 ? 'FINALLY' : dansFinally ? 'FINALLY + ÉNUMÉRATION' : epars > 0 ? 'ÉNUMÉRATION' : 'JAMAIS RELÂCHÉ'
    // Un `try … catch` du gestionnaire — pas un `.catch(` de promesse, qui ne protège que son appel.
    const aCatch = /\}\s*catch\s*(\(|\{)/.test(g.corps)
    out.push({ setter, ligne, classe, epars, aCatch, cle: `${discriminant(g.corps)} | ${setter}` })
  }
  return out
}

section('ÉPREUVE DU MOTIF — avant de lui faire confiance')
{
  const finallyPur = 'const go = async () => {\n  if (loading) return\n  setLoading(true)\n  try {\n    const r = await fetch("/api/x")\n    if (!r.ok) return\n  } finally {\n    setLoading(false)\n  }\n}'
  const enumeration = 'const go = async () => {\n  setSaving(true)\n  const r = await fetch("/api/y")\n  if (!r.ok) { setSaving(false); return }\n  setSaving(false)\n}'
  const mixte = 'const go = async () => {\n  setBusy(true)\n  try {\n    const r = await fetch("/api/z")\n    if (!r.ok) { setBusy(false); return }\n  } finally {\n    setBusy(false)\n  }\n}'
  const pasUnChargement = 'const toggle = () => { setOpen(true) }'
  const sansAttente = 'const f = async () => { setLoading(true); setLoading(false) }'
  const imbrique = 'const go = async () => {\n  setLoading(true)\n  try {\n    if (x) {\n      const r = await fetch("/api/w")\n      if (!r.ok) return\n    }\n  } finally {\n    setLoading(false)\n  }\n}'
  const c = (s) => gestionnaires(s).map((g) => g.classe).join(',')
  ok(c(finallyPur) === 'FINALLY', 'classe FINALLY : relâché dans le finally et là seulement')
  ok(c(enumeration) === 'ÉNUMÉRATION', 'classe ÉNUMÉRATION : aucun finally')
  ok(c(mixte) === 'FINALLY + ÉNUMÉRATION', 'classe FINALLY + ÉNUMÉRATION : le finally ET un relâchement épars')
  ok(c(pasUnChargement) === '', 'ignore : un setter qui ne nomme pas un chargement (`setOpen`)')
  ok(c(sansAttente) === '', 'ignore : un drapeau posé sans aucun `await`')
  ok(c(imbrique) === 'FINALLY', 'le `setTrue` dans un bloc imbriqué remonte bien au GESTIONNAIRE, pas au bloc')
  ok(gestionnaires(enumeration)[0].cle === '/api/y | setSaving', 'la clé de gel est « appel discriminant | setter », pas un numéro de ligne')
}

// ══════════════════════════════════════════════════════════════════════════
/**
 * GEL — les 21 gestionnaires hors FINALLY, LUS UN PAR UN le 20/09/2026 (§G.8).
 * Clé : « appel discriminant | setter » dans le fichier — les numéros de ligne
 * bougent. Chaque raison commence par LÉGITIME ou DÉFAUT NOMMÉ. Deux gravités :
 *   FIGE     — aucun `catch` : une exception laisse le drapeau posé pour toujours ;
 *   FRAGILE  — toutes les sorties relâchent AUJOURD'HUI (ou un finally existe déjà
 *              et des relâchements épars le doublent) : le prochain chemin ajouté
 *              sera oublié. C'est exactement le défaut fondateur de /connexion.
 */
// ┌─ LE GEL EST VIDE DEPUIS LE 21/09/2026 ──────────────────────────────────┐
// │ Le jour de la conversion (20/09) il portait 21 DÉFAUTS NOMMÉS, lus un    │
// │ par un — dont 4 qui FIGEAIENT (aucun catch). Tous corrigés le 21/09 sur  │
// │ arbitrage : chaque gestionnaire relâche dans un `finally`, et là          │
// │ seulement, avec une garde de ré-entrance là où une navigation de succès  │
// │ suit. La convention reste écrite pour le prochain : clé « appel          │
// │ discriminant | setter », raison LÉGITIME ou DÉFAUT NOMMÉ, gravité FIGE / │
// │ FRAGILE. Une entrée neuve rougit ; on lit, puis on corrige ou on gèle.   │
// └─────────────────────────────────────────────────────────────────────────┘
const GEL = {
  // Exemple de forme (aucune entrée aujourd'hui) :
  // 'components/x/Y.tsx | /api/x | setSaving':
  //   'DÉFAUT NOMMÉ — FIGE : aucun try/catch ; une exception réseau laisse « … » pour toujours',
}
const GEL_ANCIEN_20_09 = {
  // ── FIGE : un chemin laisse le bouton en « … en cours » ───────────────────
  'app/[locale]/mot-de-passe-oublie/page.tsx | supabase.auth.resetPasswordForEmail | setLoading':
    'DÉFAUT NOMMÉ — FIGE : aucun try/catch ; une exception réseau de resetPasswordForEmail laisse « envoi en cours » pour toujours. Écran SŒUR de /connexion, même défaut fondateur',
  'app/[locale]/dashboard/freelance/mon-profil/page.tsx | /api/taxonomy | setLoading':
    'DÉFAUT NOMMÉ — FIGE : le chargeur de la page (effet) n’a aucun catch ; une exception de getSession ou d’une lecture fige le squelette. Les branches d’erreur relâchent, l’exception non',
  'components/dashboard/PublicationForm.tsx | saveDraft | setSaving':
    'DÉFAUT NOMMÉ — FIGE : `setSaving(true); await saveDraft(form); setSaving(false)` sans try ; saveDraft appelle secureFetch sans catch, une exception réseau fige « enregistrement… »',
  'components/dashboard/DndEmptyState.tsx | /api/me/sync-matching | setBusy':
    'DÉFAUT NOMMÉ — FIGE : aucun catch autour de getSession/setExpertListening. L’absence de relâchement en SUCCÈS est voulue et écrite sur place (le composant est revalidé et disparaît) ; c’est l’exception qui fige',
  // ── FRAGILE : complet aujourd’hui, énuméré ────────────────────────────────
  'app/[locale]/dashboard/cdi/profil/valider/page.tsx | /api/profile | setSaving':
    'DÉFAUT NOMMÉ — FRAGILE : quatre sorties relâchent, le succès navigue (router.push) et le catch couvre l’exception ; complet aujourd’hui, énuméré. Le motif de /connexion (garde de ré-entrance + finally) s’applique',
  'app/[locale]/dashboard/freelance/profil/valider/page.tsx | /api/profile | setSaving':
    'DÉFAUT NOMMÉ — FRAGILE : jumeau du précédent, mêmes sorties',
  'app/[locale]/reactivation/page.tsx | /api/me/account/reactivate | setBusy':
    'DÉFAUT NOMMÉ — FRAGILE : erreur relâche, succès navigue, catch relâche — complet, énuméré',
  'components/AvatarUploadModal.tsx | /api/profile | setSaving':
    'DÉFAUT NOMMÉ — FRAGILE : trois erreurs relâchent, le succès ferme la modale, le catch relâche — complet, énuméré',
  'components/TJMQuickEditModal.tsx | /api/profile | setSaving':
    'DÉFAUT NOMMÉ — FRAGILE : erreur relâche, catch relâche, succès ferme la modale — complet, énuméré',
  'components/settings/ReauthModal.tsx | /api/me/reauth | setLoading':
    'DÉFAUT NOMMÉ — FRAGILE : trois sorties relâchent, le catch relâche — complet, énuméré',
  'components/settings/SettingsView.tsx | /api/me/identity | setBusy':
    'DÉFAUT NOMMÉ — FRAGILE : erreur relâche, catch puis relâchement final — complet, énuméré',
  'components/settings/SettingsView.tsx | /api/me/email | setBusy':
    'DÉFAUT NOMMÉ — FRAGILE : idem',
  'components/settings/SettingsView.tsx | /api/me/password | setBusy':
    'DÉFAUT NOMMÉ — FRAGILE : idem',
  'components/settings/SettingsView.tsx | /api/me/locale | setBusy':
    'DÉFAUT NOMMÉ — FRAGILE : erreur relâche, succès navigue (changement de locale), catch relâche — complet, énuméré',
  'components/settings/SettingsView.tsx | /api/me/sessions/revoke-others | setBusy':
    'DÉFAUT NOMMÉ — FRAGILE : complet, énuméré',
  'components/settings/SettingsView.tsx | /api/me/account/delete | setBusy':
    'DÉFAUT NOMMÉ — FRAGILE : erreur relâche, succès déconnecte et navigue, catch relâche — complet, énuméré',
  // ── FRAGILE : un finally existe, des relâchements épars le DOUBLENT ───────
  'app/[locale]/admin/organisations/[id]/page.tsx | /api/admin/get-org | setLoading':
    'DÉFAUT NOMMÉ — FRAGILE : finally présent, trois relâchements épars dans le try — l’énumération est repartie à côté du finally',
  'app/[locale]/admin/organisations/page.tsx | /api/admin/list-orgs | setLoading':
    'DÉFAUT NOMMÉ — FRAGILE : finally présent, deux relâchements épars',
  'app/[locale]/dashboard/cdi/mon-profil/page.tsx | /api/profile | setPublishing':
    'DÉFAUT NOMMÉ — FRAGILE : finally présent, un relâchement épars',
  'app/[locale]/dashboard/freelance/mon-profil/page.tsx | /api/profile | setPublishing':
    'DÉFAUT NOMMÉ — FRAGILE : finally présent, un relâchement épars (jumeau du précédent)',
  'components/dashboard/PublicationForm.tsx | /api/publications | setPublishing':
    'DÉFAUT NOMMÉ — FRAGILE : finally présent, deux relâchements épars',
}
// L'ancien gel n'est plus un gel : c'est la liste de ce qui a été corrigé, gardée
// pour que la prochaine entrée neuve se compare à une forme déjà jugée. Il n'exempte rien.
void GEL_ANCIEN_20_09
const defautsNommes = Object.values(GEL).filter((r) => r.startsWith('DÉFAUT NOMMÉ')).length
const figent = Object.values(GEL).filter((r) => /DÉFAUT NOMMÉ — FIGE/.test(r)).length

// ══════════════════════════════════════════════════════════════════════════
section('A. TOUS LES GESTIONNAIRES QUI ATTENDENT — balayage de components/ + app/[locale]/')
const ECRANS = fichiers(RACINES_CLIENT)
const tous = []
for (const f of ECRANS) for (const g of gestionnaires(sansCommentaires(lire(f)))) tous.push({ f, ...g })
const par = {}
for (const g of tous) par[g.classe] = (par[g.classe] ?? 0) + 1
info(`${ECRANS.length} fichiers · ${tous.length} gestionnaires : ${Object.entries(par).map(([k, v]) => `${v} ${k}`).join(' · ')}`)
ok(tous.length >= 30, 'le balayage voit les gestionnaires (au moins trente)', 'un inventaire minuscule : le motif ne lit plus le code')
ok(!tous.some((g) => g.classe === 'NON RÉSOLU'), 'chaque drapeau posé a un gestionnaire résolu', tous.filter((g) => g.classe === 'NON RÉSOLU').map((g) => `${g.f}:${g.ligne}`).join(', ') || undefined)

const horsFinally = tous.filter((g) => g.classe !== 'FINALLY')
const cle = (g) => `${g.f} | ${g.cle}`
const neufs = horsFinally.filter((g) => !(cle(g) in GEL))
for (const g of horsFinally.filter((g) => cle(g) in GEL)) info(`${g.classe.padEnd(22)} ${g.f}:${g.ligne} ${g.setter} — GELÉ, ${GEL[cle(g)].slice(0, 22)}…`)
ok(neufs.length === 0, `aucun gestionnaire NEUF hors FINALLY (${horsFinally.length} gelés, tous lus)`,
  neufs.map((g) => `${g.f}:${g.ligne} ${g.setter} [${g.classe}] — le LIRE : finally, ou gel avec raison (clé « ${cle(g)} »)`).join('\n       '))
const sorties = Object.keys(GEL).filter((k) => !horsFinally.some((g) => cle(g) === k))
ok(sorties.length === 0, 'aucune entrée du gel n’a disparu ni cessé d’être vraie sans qu’on le dise',
  sorties.length ? `sortie(s) : ${sorties.join(' ; ')} — retirer la ligne` : undefined)
ok(Object.values(GEL).every((r) => /^(LÉGITIME|DÉFAUT NOMMÉ)( |$)/.test(r)), 'chaque raison du gel commence par LÉGITIME ou DÉFAUT NOMMÉ (§G.8)')
// La gravité FIGE se relit : un gestionnaire gelé « FIGE » qui a acquis un catch doit changer de raison.
for (const g of horsFinally) {
  const r = GEL[cle(g)]
  if (r && /— FIGE/.test(r)) ok(!g.aCatch, `${g.f.split('/').pop()} ${g.setter} : gelé FIGE, et il n’a toujours aucun catch`, 'il a un catch désormais : re-juger, FRAGILE ou sortie du gel')
}

// ══════════════════════════════════════════════════════════════════════════
section('B. LE CAS FONDATEUR — /connexion et /nouveau-mot-de-passe, garde de ré-entrance et sorties oubliées')
// Ces deux écrans sont ceux du lot d'origine. Leur adresse est un contrat
// (c'est là qu'on se connecte) ; on les garde nommés pour ce qui n'est vrai que
// d'eux : la garde de ré-entrance et les deux sorties « compte suspendu ».
for (const s of [
  { label: '/connexion', file: 'app/[locale]/connexion/page.tsx', flag: 'loading' },
  { label: '/nouveau-mot-de-passe', file: 'app/[locale]/nouveau-mot-de-passe/page.tsx', flag: 'submitting' },
]) {
  const src = sansCommentaires(lire(s.file))
  const gs = gestionnaires(src).filter((g) => g.setter.toLowerCase() === `set${s.flag}`)
  ok(gs.length >= 1 && gs.every((g) => g.classe === 'FINALLY'), `${s.label} : le drapeau se relâche dans un finally, et là seulement`)
  ok(new RegExp(`if \\(${s.flag}\\) return`).test(src), `${s.label} : garde de ré-entrance \`if (${s.flag}) return\``,
    'le finally relâche le drapeau pendant que la navigation de succès est en vol')
}
const connexion = sansCommentaires(lire('app/[locale]/connexion/page.tsx'))
const suspendues = (connexion.match(/router\.replace\('\/connexion\?reason=account_suspended'\)/g) ?? []).length
ok(suspendues === 2, `/connexion : les 2 sorties « compte suspendu » sont toujours là (trouvées : ${suspendues})`,
  'ce sont elles qui figeaient le bouton — si elles disparaissent, relire ce diag')

// ══════════════════════════════════════════════════════════════════════════
section('C. /auth/callback : immunité par état terminal')
const callbackRaw = lire('app/[locale]/auth/callback/page.tsx')
const callback = sansCommentaires(callbackRaw)
// Le CORPS du catch, isolé — pas un `setHasError(true)` quelconque (il y en a un
// autre plus haut, sur le chemin « session absente »). Constaté par mutation.
const catchStart = callback.indexOf('catch (err) {')
const catchBody = catchStart === -1 ? '' : callback.slice(catchStart, callback.indexOf('\n      }', catchStart))
ok(catchStart !== -1 && /setHasError\(true\)/.test(catchBody), 'le catch de run() pose hasError — tout chemin aboutit à un état terminal',
  'c’est CE catch qui rend l’écran incapable de rester bloqué sur son spinner')
ok(/POURQUOI CET ÉCRAN NE PEUT PAS SE FIGER/.test(callbackRaw), 'la propriété est DOCUMENTÉE sur place')
ok(gestionnaires(callback).every((g) => g.classe === 'FINALLY'), 'aucun drapeau de chargement sans finally sur cet écran')

// ══════════════════════════════════════════════════════════════════════════
section('D. secure-fetch et init-session intacts')
const secureFetch = sansCommentaires(lire('lib/secure-fetch.ts'))
ok(/export async function initSession/.test(secureFetch) && /return \{ ok: false, code: payload\?\.code \}/.test(secureFetch),
  'initSession remonte toujours le code de refus au call-site')
ok(/onSuspended/.test(secureFetch), 'secure-fetch conserve son interception `account_suspended` (hors écrans de login)')

section('GEL — compté à voix haute')
info(`${defautsNommes} DÉFAUT(S) NOMMÉ(S) au gel — dont ${figent} qui FIGENT (aucun catch) — rendus à l’arbitrage`)
fin(`Aucun drapeau de chargement ne se relâche par énumération sans avoir été lu. ${defautsNommes} défaut(s) nommé(s), ${figent} qui figent.`)
