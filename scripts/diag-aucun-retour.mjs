/**
 * diag-aucun-retour.mjs — PLUS AUCUN BOUTON « RETOUR », ET L'EN-TÊTE DE CHAQUE PAGE PORTE SON NOM
 * (lot finitions et pays, 02/10/2026 — décisions de Youssef).
 *
 * LA RÈGLE 1 — ON NAVIGUE PAR LES MENUS. Il n'existe plus aucun bouton ou lien « Retour », ni flèche « ← », nulle
 * part dans l'espace connecté, pages de détail comprises, pour tous les profils, admin compris. Elle REMPLACE la règle
 * de juin (« un bouton Retour global unique, sur les pages de détail seulement »). Le bouton global
 * (`GlobalBackButton`), sa pile d'historique (`NavHistoryProvider`) et la liste des pages de menu (`isMenuRoute`) sont
 * retirés ; chaque retour propre à une page aussi (« ← Retour » de « Valider votre profil », les boutons des écrans
 * d'erreur, les « ← » nus des écrans 403 du CDI).
 *
 * LA RÈGLE 2 — L'EN-TÊTE DE CHAQUE PAGE PORTE SON NOM : le nom de l'entrée de menu qui la couvre, le même mot que la
 * barre latérale (`lib/nav-config.ts`, `titreDeTableauDeBord` et `titreAdmin`). Le cas qui l'a fait écrire : sur
 * « Besoin / Sous-traitance », l'en-tête disait « Tableau de bord » — la coquille tenait sa propre table
 * « section → titre » et la section oubliée tombait sur le titre par défaut.
 *
 * CE QU'IL VÉRIFIE (bloquant : la série `diag.mjs` rougit) :
 *   A. le mécanisme global est parti — fichiers absents, aucun de ses noms dans le code (commentaires retirés, §E.7),
 *      aucun espace de messages `back_nav` ;
 *   B. aucun retour par l'historique du navigateur (`router.back()`, `history.back()`, `history.go(-…)`) ;
 *   C. aucune flèche « ← » (ni `&larr;`, ni `←`) dans le code, aucune icône de flèche gauche importée ;
 *   D. LES MESSAGES : chaque clé dont le NOM dit « retour » (`back`, `retour`) ou dont la VALEUR commence par « ← » ou
 *      par « Retour » est DÉCLARÉE ci-dessous avec sa raison (§G.8) — sinon c'est un retour nouveau ; une déclaration
 *      dont la clé a disparu est morte et rougit ;
 *   E. LE CODE : chaque appel de traduction dont la clé désigne l'une de ces clés est déclaré, DANS CE FICHIER-LÀ ; et
 *      un fichier de l'espace connecté n'en appelle aucune, sauf une action vers l'AVANT (« Tableau de bord → ») ;
 *   F. LE NOM DE CHAQUE PAGE, EXÉCUTÉ : chaque `page.tsx` des trois tableaux de bord et de l'admin a un nom dérivé du
 *      menu, traduit dans les quatre langues ; la racine seule s'appelle « Tableau de bord » ; « Besoin /
 *      Sous-traitance » porte le sien ; la coquille et le layout admin lisent cette dérivation, sans table à eux.
 *
 * CE QU'IL NE VOIT PAS, ET LE DIT : un navigateur ; un retour écrit avec un mot qu'aucune règle ne reconnaît
 * (« Revenir à la liste » dans une clé nommée autrement) ; un lien vers une page parente sans mot ni flèche ; une page
 * qui passe son propre `pageTitle` à la coquille (aucune aujourd'hui — vérifié en F).
 *
 * LES PAGES PUBLIQUES (404, mot de passe oublié, confirmations d'inscription, invitation…) n'ont AUCUN MENU : leur lien
 * est la seule issue de la page. Elles sont déclarées une à une, avec cette raison, et signalées à Youssef
 * (docs/reprise-s1.md) — le retrait est d'une ligne chacune s'il le décide.
 *
 * Sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
// §E.7 : un commentaire ne prouve rien — ni présence, ni absence.
const sansCommentaires = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/(^|[^:'"`])\/\/ .*$/, '$1'))).join('\n')

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (t) => console.log(`\n── ${t}`)

const LANGUES = ['fr', 'en', 'es', 'de']
const MSG = Object.fromEntries(LANGUES.map((l) => [l, JSON.parse(lire(`messages/${l}.json`))]))
const valeur = (o, chemin) => chemin.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o)

/** Les fichiers de code, récursivement. */
function fichiers(racines, extensions = /\.(ts|tsx)$/) {
  const out = []
  const parcourir = (d) => {
    if (!existsSync(join(ROOT, d))) return
    for (const e of readdirSync(join(ROOT, d))) {
      const p = `${d}/${e}`
      if (statSync(join(ROOT, p)).isDirectory()) { if (e !== 'node_modules' && e !== '.next') parcourir(p) }
      else if (extensions.test(e)) out.push(p)
    }
  }
  racines.forEach(parcourir)
  return out.sort()
}
const CODE = fichiers(['app', 'components', 'lib', 'hooks', 'context'])
const SOURCES = new Map(CODE.map((f) => [f, sansCommentaires(lire(f))]))

/** L'espace connecté : tout ce qui se rend sous la coquille des tableaux de bord ou sous le layout admin. */
const CONNECTE = (f) => /^app\/\[locale\]\/(dashboard|admin)\//.test(f)
  || /^components\/(shell|dashboard|admin|collaboration|freelance|cdi|profile|settings)\//.test(f)

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// LES RETOURS DÉCLARÉS — une raison chacun (§G.8). Clé : le chemin du message. `fichiers` : ceux qui le lisent, et
// `appel` : l'appel exact qu'ils font. `versLAvant` : une action vers l'avant que son nom de clé fait passer pour un
// retour — la seule forme admise dans l'espace connecté.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const PUBLIQUE = 'LÉGITIME — page publique SANS MENU : ce lien est la seule issue de la page (le retirer en ferait une impasse) ; signalé à Youssef, à retirer sur sa décision.'
const DECLARES = {
  'not_found.back_home': { raison: PUBLIQUE, fichiers: ['app/[locale]/not-found.tsx'], appel: "t('back_home')" },
  'ecosystem_unavailable.back_home': { raison: PUBLIQUE, fichiers: ['app/[locale]/ecosysteme-indisponible/page.tsx'], appel: "t('back_home')" },
  'forgot_password.back_to_login': { raison: PUBLIQUE, fichiers: ['app/[locale]/mot-de-passe-oublie/page.tsx'], appel: "t('back_to_login')" },
  'inscription_org.callback.back_to_signup': { raison: PUBLIQUE, fichiers: ['app/[locale]/auth/callback/page.tsx'], appel: "t('back_to_signup')" },
  'inscription_org.callback.back_to_signin': {
    raison: 'LÉGITIME — « Se connecter » : une action vers l’avant, sur une page publique sans menu ; seul son nom de clé dit « back ».',
    fichiers: ['app/[locale]/auth/callback/page.tsx'], appel: "t('back_to_signin')",
  },
  'signup_confirmation.back_to_home': {
    raison: PUBLIQUE,
    fichiers: ['app/[locale]/inscription/confirmation/page.tsx', 'app/[locale]/inscription/organisation/confirmation/page.tsx'],
    appel: "t('back_to_home')",
  },
  'signup_form.change_profile': {
    raison: 'LÉGITIME — page publique SANS MENU (inscription) : « ← Changer de profil » revient au choix du type de compte, la seule autre étape du parcours ; signalé à Youssef.',
    fichiers: ['app/[locale]/inscription/[role]/page.tsx'], appel: "t('change_profile')",
  },
  'invitation_public.go_home': { raison: PUBLIQUE, fichiers: ['app/[locale]/invitation/[token]/page.tsx'], appel: "t('go_home')" },
  'profile_validation.success.back_to_dashboard': {
    raison: 'LÉGITIME — « Tableau de bord → » : l’action qui SUIT l’enregistrement du brouillon, vers l’avant ; seul son nom de clé dit « back ».',
    fichiers: ['app/[locale]/dashboard/freelance/profil/valider/page.tsx'], appel: "tProfile('success.back_to_dashboard')", versLAvant: true,
  },
  'cdi_profile_validation.success.back_to_dashboard': {
    raison: 'LÉGITIME — parité CDI de la ligne précédente : « Tableau de bord → », vers l’avant.',
    fichiers: ['app/[locale]/dashboard/cdi/profil/valider/page.tsx'], appel: "tProfile('success.back_to_dashboard')", versLAvant: true,
  },
  'journal.phrases.invitation_acceptee.retour': {
    raison: 'LÉGITIME — une PHRASE du journal (« … après l’avoir quittée ») : le retour d’un membre dans une organisation, pas une navigation.',
    fichiers: [], appel: null,
  },
}

// ══════════════════════════════════════════════════════════════════════════
section('A. Le bouton Retour global et sa pile sont partis')
// ══════════════════════════════════════════════════════════════════════════
for (const f of ['components/shell/GlobalBackButton.tsx', 'components/shell/NavHistoryProvider.tsx', 'lib/menu-routes.ts']) {
  ok(!existsSync(join(ROOT, f)), `${f} n’existe plus`)
}
const NOMS = /\b(GlobalBackButton|NavHistoryProvider|useNavHistory|isMenuRoute|isMessagingRoute|deriveBackLabel|resolveBackNav|allMenuRoutes|sk_nav_stack|backTarget)\b/
const nomsTrouves = CODE.filter((f) => NOMS.test(SOURCES.get(f))).map((f) => `${f} : ${NOMS.exec(SOURCES.get(f))[1]}`)
ok(nomsTrouves.length === 0, `aucun des ${CODE.length} fichiers de code ne nomme le mécanisme retiré`, nomsTrouves.join(' · '))
ok(LANGUES.every((l) => MSG[l].back_nav === undefined), 'aucun espace de messages `back_nav`, dans aucune langue')

// ══════════════════════════════════════════════════════════════════════════
section('B. Aucun retour par l’historique du navigateur')
// ══════════════════════════════════════════════════════════════════════════
const HISTORIQUE = /\b(?:router|history)\s*\.\s*back\s*\(|\bhistory\s*\.\s*go\s*\(\s*-/
const parHistorique = CODE.filter((f) => HISTORIQUE.test(SOURCES.get(f)))
ok(parHistorique.length === 0, '`router.back()`, `history.back()`, `history.go(-n)` : aucun', parHistorique.join(' · '))

// ══════════════════════════════════════════════════════════════════════════
section('C. Aucune flèche de retour dans le code')
// ══════════════════════════════════════════════════════════════════════════
const FLECHE = /←|&larr;|\\u2190|\bIcon(?:ArrowLeft|ChevronLeft|ArrowBack(?:Up)?)\b/
const fleches = CODE.filter((f) => FLECHE.test(SOURCES.get(f))).map((f) => `${f} : « ${FLECHE.exec(SOURCES.get(f))[0]} »`)
ok(fleches.length === 0, 'ni « ← », ni `&larr;`, ni `\\u2190`, ni icône de flèche gauche — hors commentaires', fleches.join(' · '))

// ══════════════════════════════════════════════════════════════════════════
section('D. Les messages : chaque libellé de retour est déclaré')
// ══════════════════════════════════════════════════════════════════════════
const retours = []
const parcourir = (o, p) => {
  for (const [k, v] of Object.entries(o)) {
    const q = p ? `${p}.${k}` : k
    if (v && typeof v === 'object') parcourir(v, q)
    else if (/(^|_)(back|retour)(_|$)/i.test(k) || /^\s*←/.test(v) || /^\s*Retour\b/.test(v)) retours.push(q)
  }
}
parcourir(MSG.fr, '')
const nonDeclares = retours.filter((c) => !DECLARES[c])
ok(nonDeclares.length === 0, `les ${retours.length} libellés « retour » de messages/fr.json sont tous déclarés, avec leur raison`,
  nonDeclares.map((c) => `${c} = « ${valeur(MSG.fr, c)} »`).join(' · '))
const morts = Object.keys(DECLARES).filter((c) => !retours.includes(c))
ok(morts.length === 0, 'aucune déclaration morte (une clé déclarée a disparu ou ne dit plus « retour »)', morts.join(' · '))
const sansRaison = Object.entries(DECLARES).filter(([, d]) => !/^LÉGITIME — .{30,}/.test(d.raison))
ok(sansRaison.length === 0, 'chaque déclaration commence par LÉGITIME et dit pourquoi (§G.8)', sansRaison.map(([c]) => c).join(' · '))
const avantFleche = Object.entries(DECLARES).filter(([c, d]) => d.versLAvant && LANGUES.some((l) => /←|^\s*(Retour|Back|Volver|Zurück)\b/i.test(valeur(MSG[l], c) ?? '')))
ok(avantFleche.length === 0, 'une action « vers l’avant » ne porte ni flèche gauche ni « Retour », dans aucune langue', avantFleche.map(([c]) => c).join(' · '))

// ══════════════════════════════════════════════════════════════════════════
section('E. Le code : qui lit un libellé de retour, et où')
// ══════════════════════════════════════════════════════════════════════════
// Un appel de traduction (t, tProfile, tShell…) dont la clé littérale DÉSIGNE un libellé de retour : la clé complète,
// ou sa fin après un espace de noms (`t('back_home')` sous `useTranslations('not_found')`).
const APPEL = /\b(t[A-Z]?\w*)\(\s*'([a-zA-Z0-9_.]+)'/g
const lectures = []
for (const f of CODE) {
  for (const m of SOURCES.get(f).matchAll(APPEL)) {
    const cibles = retours.filter((c) => c === m[2] || c.endsWith(`.${m[2]}`))
    if (cibles.length) lectures.push({ f, appel: `${m[1]}('${m[2]}')`, cibles })
  }
}
const lecturesNonDeclarees = lectures.filter((l) => !l.cibles.some((c) => DECLARES[c]?.fichiers.includes(l.f) && DECLARES[c].appel === l.appel))
ok(lecturesNonDeclarees.length === 0, `les ${lectures.length} lectures d’un libellé de retour sont toutes déclarées, fichier par fichier`,
  lecturesNonDeclarees.map((l) => `${l.f} : ${l.appel}`).join(' · '))
const dansLEspace = lectures.filter((l) => CONNECTE(l.f) && !l.cibles.some((c) => DECLARES[c]?.versLAvant && DECLARES[c].fichiers.includes(l.f)))
ok(dansLEspace.length === 0, 'l’espace connecté (tableaux de bord, admin) n’en lit aucun, hors action vers l’avant', dansLEspace.map((l) => `${l.f} : ${l.appel}`).join(' · '))
const publiquesConnectees = Object.entries(DECLARES).filter(([, d]) => !d.versLAvant && d.fichiers.some(CONNECTE))
ok(publiquesConnectees.length === 0, 'une exception « page publique » ne désigne aucun fichier de l’espace connecté', publiquesConnectees.map(([c]) => c).join(' · '))
const appelsAbsents = Object.entries(DECLARES).flatMap(([c, d]) => d.fichiers
  .filter((f) => !existsSync(join(ROOT, f)) || !SOURCES.get(f)?.includes(d.appel)).map((f) => `${c} → ${f}`))
ok(appelsAbsents.length === 0, 'chaque fichier déclaré fait bien l’appel déclaré (sinon la déclaration est périmée)', appelsAbsents.join(' · '))

// ══════════════════════════════════════════════════════════════════════════
section('F. Le nom de chaque page, dérivé du menu — EXÉCUTÉ sur chaque page du dépôt')
// ══════════════════════════════════════════════════════════════════════════
let N
try {
  N = await import(pathToFileURL(join(ROOT, 'lib/nav-config.ts')).href)
} catch (err) {
  console.error('✘ lib/nav-config.ts ne se charge pas — le contrôle ne tourne pas', err)
  process.exit(2)
}
const shell = sansCommentaires(lire('components/shell/DashboardShell.tsx'))
const admin = sansCommentaires(lire('app/[locale]/admin/layout.tsx'))
const barre = sansCommentaires(lire('components/shell/DashboardSidebar.tsx'))
ok(/titreDeTableauDeBord\(side, pathname\)/.test(shell) && !/section ===|page_titles\.\$\{key\}/.test(shell),
  'la coquille des tableaux de bord lit `titreDeTableauDeBord` — aucune table « section → titre » à elle')
ok(/titreAdmin\(pathname\)/.test(admin) && !/\.sort\(\(a, b\) => b\.href\.length/.test(admin), 'le layout admin lit `titreAdmin` — la même règle, au même endroit')
ok(/t\(`nav\.\$\{cleDuLibelle\(side, item\)\}`/.test(barre), 'la barre latérale nomme ses entrées par `cleDuLibelle` — le même mot que l’en-tête')
const surcharges = CODE.filter((f) => /<DashboardShell\b[^>]*\bpageTitle=/.test(SOURCES.get(f)))
ok(surcharges.length === 0, 'aucune page ne passe son propre `pageTitle` (le nom vient du menu)', surcharges.join(' · '))

const PAGES = fichiers(['app/[locale]/dashboard', 'app/[locale]/admin'], /^page\.tsx$/)
  .map((f) => ({ f, chemin: f.replace(/^app\/\[locale\]/, '').replace(/\/page\.tsx$/, '').replace(/\[\.\.\.\w+\]|\[\w+\]/g, 'x') || '/' }))
// LES REDIRECTIONS : elles ne rendent rien (redirection serveur), il n'y a pas d'en-tête à nommer.
const REDIRECTIONS = { '/dashboard/cabinet': 'LÉGITIME — redirection serveur vers /dashboard/entreprise (signets anciens) : rien n’est rendu.' }
const sansNom = []
let nommees = 0
for (const { f, chemin } of PAGES) {
  if (REDIRECTIONS[chemin]) continue
  const tb = /^\/dashboard\/(freelance|cdi|entreprise)(\/|$)/.exec(chemin)
  if (tb) {
    const titre = N.titreDeTableauDeBord(tb[1], chemin)
    const manque = !titre ? 'aucun nom' : LANGUES.filter((l) => typeof valeur(MSG[l], `shell.${titre.espace}.${titre.cle}`) !== 'string').join(', ')
    if (manque) sansNom.push(`${f} : ${!titre ? manque : `shell.${titre.espace}.${titre.cle} manque en ${manque}`}`)
    else if (titre.cle === 'dashboard' && chemin !== `/dashboard/${tb[1]}`) sansNom.push(`${f} : « Tableau de bord » hors de la racine`)
    else nommees++
  } else if (/^\/admin(\/|$)/.test(chemin)) {
    const cle = N.titreAdmin(chemin)
    const manque = !cle ? 'aucun nom' : LANGUES.filter((l) => typeof valeur(MSG[l], `admin_back_office.sidebar.${cle}`) !== 'string').join(', ')
    if (manque) sansNom.push(`${f} : ${!cle ? manque : `admin_back_office.sidebar.${cle} manque en ${manque}`}`)
    else nommees++
  } else sansNom.push(`${f} : ni un tableau de bord connu, ni l’admin, ni une redirection déclarée`)
}
ok(PAGES.length >= 60 && sansNom.length === 0, `les ${nommees} pages des tableaux de bord et de l’admin portent un nom, traduit dans les 4 langues (${PAGES.length} pages, ${Object.keys(REDIRECTIONS).length} redirection)`,
  sansNom.join(' · '))
const redirMortes = Object.keys(REDIRECTIONS).filter((c) => !PAGES.some((p) => p.chemin === c))
ok(redirMortes.length === 0, 'chaque redirection déclarée existe encore', redirMortes.join(' · '))

// Le cas qui a fait écrire la règle, et ses voisins, par leur nom.
const cas = [
  [N.titreDeTableauDeBord('freelance', '/dashboard/freelance/sous-traitance')?.cle, 'subcontract', 'freelance : « Besoin / Sous-traitance » porte son nom (il disait « Tableau de bord »)'],
  [N.titreDeTableauDeBord('cdi', '/dashboard/cdi/sous-traitance/abc')?.cle, 'subcontract', 'CDI : le détail d’un besoin porte le nom de son menu'],
  [N.titreDeTableauDeBord('cdi', '/dashboard/cdi/sous-traitance/nouveau')?.cle, 'subcontract', 'CDI : la création d’un besoin aussi'],
  [N.titreDeTableauDeBord('freelance', '/dashboard/freelance')?.cle, 'dashboard', 'la racine s’appelle « Tableau de bord »'],
  [N.titreDeTableauDeBord('freelance', '/dashboard/freelance/inconnue'), null, 'une page que rien ne couvre n’a AUCUN nom — jamais « Tableau de bord » par défaut'],
  [N.titreDeTableauDeBord('cdi', '/dashboard/cdi/missions/abc')?.cle, 'offres', 'CDI : « Offres », comme sa barre latérale (SC5)'],
  [N.titreDeTableauDeBord('cdi', '/dashboard/cdi/profil/valider')?.cle, 'profil_valider', '« Valider mon profil » garde son nom (page hors menu)'],
  [N.titreDeTableauDeBord('entreprise', '/dashboard/entreprise/annonces/abc/candidatures')?.cle, 'annonces', 'entreprise : les candidatures d’une annonce sont sous « Mes annonces »'],
  [N.titreAdmin('/admin/packages/new'), 'nav_packages', 'admin : une offre nouvelle est sous « Offres », pas sous la racine'],
  [N.titreAdmin('/admin/journal/conservation'), 'nav_journal_conservation', 'admin : l’entrée la plus longue gagne'],
  [N.titreAdmin('/admin'), 'nav_organisations', 'admin : la racine est servie par Organisations'],
]
for (const [obtenu, attendu, libelle] of cas) ok(obtenu === attendu, libelle, `obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`)
ok(MSG.fr.shell.nav.subcontract === 'Besoin / Sous-traitance', '« Besoin / Sous-traitance » est bien le libellé de la barre latérale')

console.log(echecs === 0 ? '\n✓ Aucun retour, et chaque page porte son nom.' : `\n✘ ${echecs} CONTRÔLE(S) EN ÉCHEC`)
process.exit(echecs === 0 ? 0 : 1)
