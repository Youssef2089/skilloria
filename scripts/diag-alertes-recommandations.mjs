// scripts/diag-alertes-recommandations.mjs — LE LOT ALERTES, RECOMMANDATIONS ET CANDIDATURES (02/10/2026).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE YOUSSEF A VU SUR STAGING (compte d'essai freelance), ET CE QUE CE CONTRÔLE GARDE
//
//   1. Une mission affichée « Correspondance forte », pastille rouge sur « Missions » — rien dans la cloche, aucun
//      e-mail. Cause : le moteur ne prévenait que si `notify_enabled` (faux par défaut, jamais ouvert) ET le palier
//      « fort » (filtre de notification, 8/10). RÈGLE : une annonce qui s'affiche prévient ; aucun réglage ne
//      contredit — (1) aucune ligne du code ne lit plus `notify_enabled`, (2) l'envoi n'est gardé que par
//      l'insertion FRAÎCHE, ni par le palier ni par un réglage.
//   2. Une spécialité désactivée : aucun avis, aucun message, aucun bouton. Cause : l'écran se taisait sur un succès,
//      et « Prévenir les experts » n'existait qu'après un code d'échec. RÈGLE : l'état des avis se RELIT (concernés,
//      prévenus, à prévenir) — exécuté ici sur une base simulée — et le bouton est là tant qu'il en reste.
//   3. Une mission postulée restait recommandée. RÈGLE : le flux ET son compteur l'excluent (champ calculé
//      `mission_postulee`, une seule fonction pour les deux lectures).
//   4. « Correspondance forte » deux fois sur la carte, et une info-bulle interne. RÈGLE : le palier se rend UNE fois
//      par carte, et la phrase interne n'est rendue nulle part.
//   5. « Échange ouvert jusqu'au 17 octob… » coupé ; « Candidaté » ; « par l'entreprise » pour le dévoilement inclus.
//      RÈGLE : la pastille d'état de vie passe à la ligne ; « Envoyée » ; l'origine est LUE au grand livre — exécutée
//      ici — et l'inconnu ne nomme personne.
//   6. Le message brut de Postgres montré à l'administrateur. RÈGLE : un MOTIF nommé, une phrase par motif, quatre
//      langues — la correspondance est exécutée ici.
//
// CE QU'IL NE VOIT PAS, ET LE DIT
//   · que les avis et les alertes PARTENT vraiment : il n'y a pas de base ici. `poser_notifications_match` et
//     `prevenir_retrait_specialite` sont prouvées par leurs tests pgTAP ; `mission_postulee` par
//     tests/database/matching/mission_postulee.test.sql — seul `npx supabase test db --local` les exécute ;
//   · l'affichage : la coupure de la pastille et le libellé unique se constatent à l'écran (étapes de Youssef).
//
//   node scripts/diag-alertes-recommandations.mjs
//   Aucune base, aucun réseau. 0 = vert · 1 = rouge · 2 = n'a pas tourné.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const importer = (p) => import(pathToFileURL(join(ROOT, p)).href)
const sansCommentaires = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/ .*$/, '')))
    .join('\n')
const sansCommentairesSql = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else {
    echecs++
    console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`)
  }
}
const section = (t) => console.log(`\n── ${t}`)

const LANGUES = ['fr', 'en', 'es', 'de']
const MSG = Object.fromEntries(LANGUES.map((l) => [l, JSON.parse(lire(`messages/${l}.json`))]))
const cle = (m, chemin) => chemin.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), m)
const dans4 = (chemin) => LANGUES.every((l) => typeof cle(MSG[l], chemin) === 'string' && cle(MSG[l], chemin).trim() !== '')

/** Tous les fichiers .ts/.tsx d'un dossier (récursif). */
function fichiers(dossier) {
  const out = []
  const parcourir = (d) => {
    if (!existsSync(join(ROOT, d))) return
    for (const e of readdirSync(join(ROOT, d))) {
      const p = `${d}/${e}`
      if (statSync(join(ROOT, p)).isDirectory()) {
        if (e !== 'node_modules' && e !== '.next') parcourir(p)
      } else if (/\.(ts|tsx)$/.test(e)) out.push(p)
    }
  }
  parcourir(dossier)
  return out
}
const CODE = [...fichiers('app'), ...fichiers('lib'), ...fichiers('components')]

/** Le texte entre deux repères d'un fichier (le premier APRÈS le début). Vide si un repère manque. */
function entre(src, debut, fin) {
  const i = src.indexOf(debut)
  if (i < 0) return ''
  const j = src.indexOf(fin, i + debut.length)
  return j < 0 ? '' : src.slice(i, j)
}

/**
 * UNE BASE SIMULÉE — juste ce que lisent les modules exécutés : `from(table).select(cols, opts)`, les filtres
 * `eq` / `in` / `overlaps`, puis soit l'attente directe (un compte `head`, ou une lecture), soit `order().range()`.
 * Aucune écriture : ces modules n'en font pas, et le simulateur n'en sait pas faire.
 */
function baseSimulee(tables, { pannes = {}, compteFaux = {} } = {}) {
  const appels = []
  return {
    appels,
    from(table) {
      const filtres = []
      let options = {}
      const lignes = () =>
        (tables[table] ?? []).filter((r) =>
          filtres.every(([op, col, v]) =>
            op === 'eq' ? r[col] === v
              : op === 'in' ? v.includes(r[col])
                : op === 'overlaps' ? (r[col] ?? []).some((x) => v.includes(x))
                  : true,
          ),
        )
      const reponse = () => {
        appels.push({ table, filtres: filtres.map((f) => f.slice(0, 2).join(':')), head: !!options.head })
        if (pannes[table]) return { data: null, error: { message: `panne simulée sur ${table}` }, count: null }
        const l = lignes()
        if (options.head) return { data: null, error: null, count: compteFaux[table] ?? l.length }
        return { data: l, error: null, count: null }
      }
      const b = {
        select(_cols, opts) { options = opts ?? {}; return b },
        eq(col, v) { filtres.push(['eq', col, v]); return b },
        in(col, v) { filtres.push(['in', col, v]); return b },
        overlaps(col, v) { filtres.push(['overlaps', col, v]); return b },
        order() { return b },
        range(a, z) {
          const r = reponse()
          return Promise.resolve(r.error ? r : { ...r, data: r.data.slice(a, z + 1) })
        },
        then(res, rej) { return Promise.resolve(reponse()).then(res, rej) },
      }
      return b
    },
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('1. Une annonce qui s’affiche prévient — aucun réglage ne contredit la règle')
// ══════════════════════════════════════════════════════════════════════════
{
  // (1) LA CLASSE : aucune ligne de code (commentaires exclus) ne lit plus `notify_enabled`. Un lecteur, où qu'il soit,
  //     redonnerait à un réglage le pouvoir d'éteindre l'alerte d'une annonce affichée.
  const lecteurs = CODE.filter((p) => /\bnotify_enabled\b/.test(sansCommentaires(lire(p))))
    // La liste blanche du grand livre et le traducteur du journal NOMMENT la clé pour les lignes PASSÉES : ils ne la
    // lisent pas en base, ils la reconnaissent dans un détail déjà écrit.
    .filter((p) => !['lib/journal/actions.ts', 'lib/journal/phrase.ts'].includes(p))
  ok(lecteurs.length === 0, `aucun fichier de app/, lib/, components/ ne lit notify_enabled (${CODE.length} fichiers balayés)`, lecteurs.join(', '))

  // (2) L'ENVOI N'EST GARDÉ QUE PAR L'INSERTION FRAÎCHE — dans les DEUX sens. Ancré sur le BLOC de l'envoi, de son
  //     compteur à l'appel (§E.8) — la ligne des correspondances, juste avant, CITE légitimement le palier : elle le
  //     journalise, elle ne filtre rien. Dans le bloc, rien ne filtre sur le palier, ni sur un réglage.
  for (const [fichier, sens] of [['lib/matching/index.ts', 'annonce → experts'], ['lib/matching/run-for-expert.ts', 'expert → annonces']]) {
    const src = sansCommentaires(lire(fichier))
    const bloc = entre(src, 'let notifies = 0', 'notifyAndFlip(')
    ok(bloc.length > 0 && /if \(stats\.inserted\.length > 0\) \{/.test(bloc) && /for \(const \w+ of stats\.inserted\)/.test(bloc),
      `${sens} : chaque insertion FRAÎCHE part à l'envoi`)
    ok(bloc.length > 0 && !/relevance_tier|'strong'|notify_threshold|notify_enabled|\bforts?\b/.test(bloc),
      `${sens} : ni le palier « fort », ni un réglage ne filtrent l'envoi`, bloc.match(/relevance_tier|'strong'|notify_threshold|notify_enabled|\bforts?\b/)?.[0])
  }
  // Le palier, lui, reste FIGÉ à la notation, et c'est le même réglage dans les deux sens.
  for (const fichier of ['lib/matching/index.ts', 'lib/matching/run-for-expert.ts']) {
    ok(/relevance_tier: s\.notify_threshold > 0 && score >= s\.notify_threshold \? 'strong' : 'normal'/.test(lire(fichier)),
      `${fichier} : le palier « Correspondance forte » est figé à la notation, contre notify_threshold`)
  }

  // (3) L'ÉCRAN DIT LA RÈGLE, ET NE PROPOSE PLUS RIEN QUI LA CONTREDISE : plus aucune case à cocher dans /admin/matching.
  const ecran = sansCommentaires(lire('app/[locale]/admin/matching/page.tsx'))
  ok(!/type="checkbox"/.test(ecran) && /t\('alerte_regle'\)/.test(ecran),
    '/admin/matching : aucune case à cocher, et la règle de l’alerte est DITE')
  const textes = ['palier_title', 'palier_one_line', 'field_palier', 'alerte_regle'].map((k) => `admin_matching.${k}`)
  ok(textes.every(dans4), 'les textes du palier et de la règle existent dans les quatre langues', textes.filter((c) => !dans4(c)).join(', '))
  const seuil = LANGUES.filter((l) => /seuil|threshold|umbral|schwelle/i.test(textes.map((c) => cle(MSG[l], c)).join(' ')))
  ok(seuil.length === 0, 'le mot « seuil » n’y apparaît dans aucune langue (§D.9)', seuil.join(', '))
  // (4) LA RÈGLE DIT LA VÉRITÉ SUR L'E-MAIL (relecture de l'ARRÊT 28, point 4) : il part à tout expert qui ne l'a pas
  //     COUPÉ (lib/notifications/preferences.ts : aucune ligne = tout reçu) — jamais « s'il l'a activé ».
  const COUPE = { fr: /sauf s’il a coupé/, en: /unless they turned these emails off/, es: /salvo que haya desactivado/, de: /außer er hat diese E-Mails/ }
  const ACTIVE = /s’il l’a activé|if they turned it on|si lo activó|wenn er dies .* aktiviert/
  const fausses = LANGUES.filter((l) => !COUPE[l].test(cle(MSG[l], 'admin_matching.alerte_regle') ?? '') || ACTIVE.test(cle(MSG[l], 'admin_matching.alerte_regle') ?? ''))
  ok(fausses.length === 0, 'la règle dit que l’e-mail part sauf si l’expert l’a coupé (le défaut), dans les quatre langues', fausses.join(', '))
  ok(/aucune alerte|no alert|ningún aviso|keine Benachrichtigung/.test(LANGUES.map((l) => cle(MSG[l], 'journal.valeurs.cle_reglage.notify_threshold')).join(' '))
     && LANGUES.every((l) => !/prévenir par notification|send a notification|avisar con una notificación|für eine Benachrichtigung/.test(cle(MSG[l], 'journal.valeurs.cle_reglage.notify_threshold') ?? '')),
    'le libellé du réglage au journal dit « l’étiquette seulement », plus « prévenir par notification » (point 5)')
  ok(/aucune ligne et reçoit tout/.test(lire('lib/notifications/preferences.ts')),
    'la règle de l’e-mail par défaut (aucune ligne = tout reçu) est toujours celle des préférences')
  // Et « vous serez notifié » est vrai sans condition : la variante qui dépendait du réglage n'est plus rendue.
  for (const voie of ['freelance', 'cdi']) {
    const m = sansCommentaires(lire(`app/[locale]/dashboard/${voie}/missions/page.tsx`))
    ok(!/empty_subtitle_sans_notification/.test(m), `missions ${voie} : plus de promesse conditionnée à un réglage`)
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('2. Une spécialité désactivée : l’état des avis se relit, et le bouton reste tant qu’il en reste')
// ══════════════════════════════════════════════════════════════════════════
{
  let E
  try {
    E = await importer('lib/taxonomie/etat-des-avis.ts')
  } catch (e) {
    console.error(`✘ lib/taxonomie/etat-des-avis.ts ne s’importe pas : ${e.message}`)
    process.exit(2)
  }
  const PIECE = 'p-desactivation', AUTRE_PIECE = 'p-ancienne'
  const tables = {
    profiles: [
      { id: 'pr1', user_id: 'u1', speciality_ids: ['A', 'X'] },
      { id: 'pr2', user_id: 'u2', speciality_ids: ['A'] },
      { id: 'pr3', user_id: 'u3', speciality_ids: ['A', 'B'] },
      { id: 'pr4', user_id: 'u4', speciality_ids: ['X'] },
    ],
    notifications: [
      { id: 'n1', user_id: 'u1', entity_id: 'A', piece: PIECE, type: 'specialite_retiree' },
      // Un avis d'une AUTRE désactivation de la même spécialité : il ne vaut pas pour celle-ci.
      { id: 'n2', user_id: 'u2', entity_id: 'A', piece: AUTRE_PIECE, type: 'specialite_retiree' },
      // Un avis d'un autre type sur la même entité : il ne compte pas.
      { id: 'n3', user_id: 'u3', entity_id: 'A', piece: PIECE, type: 'new_match_opportunity' },
    ],
  }
  const inactives = [{ id: 'A', desactivation_piece: PIECE }, { id: 'B', desactivation_piece: null }, { id: 'C', desactivation_piece: PIECE }]
  const r = await E.etatDesAvisDeRetrait(baseSimulee(tables), inactives)
  ok(r.ok && JSON.stringify(r.etats.get('A')) === JSON.stringify({ concernes: 3, prevenus: 1, a_prevenir: 2 }),
    'exécuté : 3 experts l’ont, 1 a reçu l’avis de CETTE désactivation — l’avis d’une autre ne compte pas, ni un autre type', JSON.stringify(r.ok ? r.etats.get('A') : r))
  ok(r.ok && JSON.stringify(r.etats.get('B')) === JSON.stringify({ concernes: 1, prevenus: 0, a_prevenir: 1 }),
    'exécuté : une spécialité sans pièce de désactivation (désactivée avant l’avis) a tous ses experts à prévenir')
  ok(r.ok && JSON.stringify(r.etats.get('C')) === JSON.stringify({ concernes: 0, prevenus: 0, a_prevenir: 0 }),
    'exécuté : une spécialité que personne n’a : aucun concerné')
  const panne = await E.etatDesAvisDeRetrait(baseSimulee(tables, { pannes: { notifications: true } }), inactives)
  ok(!panne.ok, 'exécuté : une lecture des avis EN PANNE n’est pas « tous prévenus » — elle rend un échec nommé')
  const partielle = await E.etatDesAvisDeRetrait(baseSimulee(tables, { compteFaux: { profiles: 9 } }), inactives)
  ok(!partielle.ok, 'exécuté : une lecture des profils INCOMPLÈTE (compte annoncé ≠ lu) est une panne, pas un zéro')

  const route = sansCommentaires(lire('app/api/admin/get-branch/[id]/route.ts'))
  ok(/etatDesAvisDeRetrait\(/.test(route) && /avis_illisible: !s\.active && !avis\.ok/.test(route),
    'get-branch sert l’état des avis de chaque spécialité inactive, et dit quand il n’a pas pu le lire')
  const page = sansCommentaires(lire('app/[locale]/admin/taxonomie/[id]/page.tsx'))
  const appels = page.match(/prevenirExperts\([^)]*\)/g) ?? []
  ok(appels.includes('prevenirExperts(s.id)') && /s\.avis\?\.a_prevenir \?\? 0\) > 0/.test(page),
    'l’écran offre « Prévenir les experts » SUR LA LIGNE de la spécialité tant qu’il en reste — plus seulement après un échec')
  ok(/setSpecInfo\(phraseDesAvis\(payload, false\)\)/.test(entre(page, 'async function toggleSpecActive(', 'async function prevenirExperts('))
     && /setSpecInfo\(phraseDesAvis\(payload, true\)\)/.test(entre(page, 'async function prevenirExperts(', 'async function deleteSpec(')),
    'un SUCCÈS se dit aussi : combien d’experts ont été prévenus, à la désactivation comme au rejeu')
  const avis = ['avis_desactivee_aucun', 'avis_desactivee_prevenus', 'avis_rejeu', 'avis_illisible', 'avis_aucun_concerne', 'avis_tous_prevenus', 'avis_partiel'].map((k) => `admin_taxonomie.${k}`)
  ok(avis.every(dans4) && LANGUES.every((l) => ['{prevenus}', '{concernes}', '{a_prevenir}'].every((v) => cle(MSG[l], 'admin_taxonomie.avis_partiel').includes(v))),
    'les phrases de l’état des avis existent dans les quatre langues, avec leurs variables', avis.filter((c) => !dans4(c)).join(', '))
  const reponse = sansCommentaires(lire('app/api/admin/update-speciality/route.ts'))
  ok(/experts_prevenus: prevenus, experts_concernes: concernes/.test(reponse), 'la route rend, sur un succès, les experts concernés et les avis posés')
}

// ══════════════════════════════════════════════════════════════════════════
section('3. Une mission postulée sort des recommandations — le flux ET son compteur')
// ══════════════════════════════════════════════════════════════════════════
{
  const feed = sansCommentaires(lire('lib/missions/feed.ts'))
  const requete = entre(feed, 'export function expertMissionsQuery(', '\n}\n')
  ok(/\.eq\('mission_postulee', false\)/.test(requete), 'la requête UNIQUE du flux exclut la mission postulée (champ calculé)')
  // Le flux (accueil + « Missions », freelance et CDI) et le badge passent par elle, et par elle seule.
  for (const route of ['app/api/me/missions/route.ts', 'app/api/me/badges/route.ts']) {
    const src = sansCommentaires(lire(route))
    ok(/expertMissionsQuery\(/.test(src) && !/\.from\('matches'\)/.test(src), `${route} lit les missions par la requête unique, et pas autrement`)
  }
  const pages = ['freelance', 'cdi'].flatMap((v) => [`app/[locale]/dashboard/${v}/page.tsx`, `app/[locale]/dashboard/${v}/missions/page.tsx`])
  ok(pages.every((p) => /\/api\/me\/missions\?locale=/.test(lire(p))), 'accueil et « Missions », freelance et CDI, lisent tous /api/me/missions')
  const migs = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((f) => f.endsWith('_mission_postulee.sql'))
  ok(migs.length === 1, 'une migration, résolue par son suffixe (§G.3)', migs.join(', ') || 'aucune')
  if (migs.length === 1) {
    const m = sansCommentairesSql(lire(`supabase/migrations/${migs[0]}`))
    ok(/create or replace function public\.mission_postulee\(m public\.matches\)\s+returns boolean\s+language sql\s+stable/.test(m)
       && /from public\.candidatures c\s+where c\.publication_id = m\.publication_id\s+and c\.profile_id = m\.profile_id/.test(m),
      'mission_postulee(matches) : stable, vraie dès qu’une candidature existe pour le couple (annonce, expert)')
    ok(/revoke all on function public\.mission_postulee\(public\.matches\) from public, anon, authenticated/.test(m),
      'fermée au navigateur')
    ok(/ORDRE DE PASSAGE : AVANT/.test(lire(`supabase/migrations/${migs[0]}`)), 'son en-tête dit son ordre de passage : AVANT le déploiement')
  }
  ok(/public\.mission_postulee\(m\)/.test(lire('supabase/tests/database/matching/mission_postulee.test.sql')), 'un test pgTAP l’exécute')
}

// ══════════════════════════════════════════════════════════════════════════
section('4. La carte recommandée : le palier une seule fois, et aucune phrase interne')
// ══════════════════════════════════════════════════════════════════════════
{
  // La phrase INTERNE (matching_badge.tooltip) n'est rendue NULLE PART — balayé sur tout le code.
  const rendus = CODE.filter((p) => /tBadge\('tooltip'\)|matching_badge\.tooltip/.test(sansCommentaires(lire(p))))
  ok(rendus.length === 0, 'la phrase interne sur le palier n’est rendue par aucun écran', rendus.join(', '))
  for (const carte of ['components/dashboard/MissionCastingCard.tsx', 'components/dashboard/MissionCard.tsx']) {
    const src = sansCommentaires(lire(carte))
    const paliers = (src.match(/tBadge\(/g) ?? []).length
    ok(paliers === 1, `${carte} : le palier est rendu UNE fois (${paliers})`)
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('5. La candidature : la pastille en entier, « Envoyée », et qui a ouvert l’échange')
// ══════════════════════════════════════════════════════════════════════════
{
  const pill = sansCommentaires(lire('components/ui/StatusPill.tsx'))
  ok(/whiteSpace: wrap \? 'normal' : 'nowrap'/.test(pill), 'StatusPill sait passer à la ligne')
  // Toute pastille qui rend un ÉTAT DE VIE côté expert (il porte une date) passe à la ligne.
  for (const p of ['components/dashboard/CandidaturesTrackingView.tsx', 'components/dashboard/CandidatureCastingCard.tsx']) {
    const src = sansCommentaires(lire(p))
    // L'élément entier, de `<StatusPill` à sa fermeture : la balise ouvrante contient elle-même des `>` (l'icône).
    const pastilles = src.match(/<StatusPill\b[\s\S]*?<\/StatusPill>/g) ?? []
    ok(pastilles.length > 0 && pastilles.every((b) => /\swrap[\s>]/.test(b)), `${p} : la pastille d’état de vie passe à la ligne au lieu d’être coupée`)
  }
  const attendu = { fr: /^Envoyée il y a \{time\}$/, en: /^Sent \{time\} ago$/, es: /^Enviada hace \{time\}$/, de: /^Gesendet vor \{time\}$/ }
  ok(LANGUES.every((l) => attendu[l].test(cle(MSG[l], 'candidatures_tracking.candidated_ago') ?? '')),
    '« Envoyée il y a … » dans les quatre langues', LANGUES.map((l) => cle(MSG[l], 'candidatures_tracking.candidated_ago')).join(' | '))

  let O
  try {
    O = await importer('lib/candidatures/origine-devoilement.ts')
  } catch (e) {
    console.error(`✘ lib/candidatures/origine-devoilement.ts ne s’importe pas : ${e.message}`)
    process.exit(2)
  }
  const ligne = (id, auto, extra = {}) => ({ sujet_id: id, detail: auto === undefined ? {} : { auto }, type_action: 'devoilement_ouvert', statut: 'reussi', sujet_type: 'candidatures', ...extra })
  const gl = [
    ligne('c-inclus', true),
    ligne('c-entreprise', false),
    ligne('c-sans-cle', undefined),
    ligne('c-refuse', true, { statut: 'refuse' }),
    ligne('c-ferme', true, { type_action: 'devoilement_ferme' }),
  ]
  const base = baseSimulee({ grand_livre: gl })
  const o = await O.originesDesDevoilements(base, ['c-inclus', 'c-entreprise', 'c-sans-cle', 'c-refuse', 'c-ferme', 'c-absente'])
  ok(o.get('c-inclus') === 'inclus' && o.get('c-entreprise') === 'entreprise',
    'exécuté : auto=true → dévoilement inclus ; auto=false → l’entreprise')
  ok(!o.has('c-sans-cle') && !o.has('c-refuse') && !o.has('c-ferme') && !o.has('c-absente'),
    'exécuté : sans la clé, sur une autre action, non réussie, ou absente → AUCUNE origine (l’écran ne nomme personne)')
  const panne = await O.originesDesDevoilements(baseSimulee({ grand_livre: gl }, { pannes: { grand_livre: true } }), ['c-inclus'])
  ok(panne.size === 0, 'exécuté : une lecture en panne ne lève pas et ne devine rien')
  const beaucoup = Array.from({ length: 450 }, (_, i) => `c${i}`)
  const b2 = baseSimulee({ grand_livre: [] })
  await O.originesDesDevoilements(b2, beaucoup)
  ok(b2.appels.length === 3, `exécuté : 450 candidatures se lisent en tranches (${b2.appels.length} lectures, aucune liste géante dans l’adresse)`)

  const panneau = sansCommentaires(lire('components/dashboard/CandidatureDetailPanel.tsx'))
  ok(/c\.devoilement === 'entreprise'\s*\?\s*t\('timeline\.unlocked'\)/.test(panneau) && /t\('timeline\.unlocked_inclus'\)/.test(panneau)
     && /t\('timeline\.unlocked_sans_origine'\)/.test(panneau) && (panneau.match(/t\('timeline\.unlocked'\)/g) ?? []).length === 1,
    'la frise ne dit « par l’entreprise » QUE si c’est elle ; l’inclus et l’inconnu ont leur phrase')
  ok(['candidatures_tracking.timeline.unlocked_inclus', 'candidatures_tracking.timeline.unlocked_sans_origine'].every(dans4),
    'les deux phrases existent dans les quatre langues')
  ok(/devoilement: r\.unlocked_at \? origineDevoilement\.get\(r\.id\) \?\? null : null/.test(sansCommentaires(lire('app/api/me/candidatures/route.ts'))),
    '/api/me/candidatures sert l’origine, lue au grand livre — inconnue, elle vaut null')
  ok(/opts\.auto \? NOTIF_TITLE_INCLUS\[loc\] : NOTIF_TITLE\[loc\]/.test(sansCommentaires(lire('lib/unlock.ts'))),
    'la cloche ne dit plus « l’entreprise souhaite échanger » pour le dévoilement inclus')
}

// ══════════════════════════════════════════════════════════════════════════
section('6. Un refus de la base se dit par son motif — jamais par le message de Postgres')
// ══════════════════════════════════════════════════════════════════════════
{
  let R
  try {
    R = await importer('lib/taxonomie/motif-refus-ecriture.ts')
  } catch (e) {
    console.error(`✘ lib/taxonomie/motif-refus-ecriture.ts ne s’importe pas : ${e.message}`)
    process.exit(2)
  }
  const cas = { '22001': 'texte_trop_long', '23502': 'valeur_obligatoire', '22P02': 'valeur_invalide', '22003': 'valeur_invalide', '23514': 'regle_du_referentiel', '23503': 'reference_absente', '23P01': 'refus_non_classe', '': 'refus_non_classe' }
  const faux = Object.entries(cas).filter(([c, m]) => R.motifDuRefus(c) !== m)
  ok(faux.length === 0 && R.motifDuRefus(null) === 'refus_non_classe', 'exécuté : chaque code SQLSTATE a son motif, l’inconnu le sien', faux.map(([c]) => c).join(', '))

  const route = sansCommentaires(lire('app/api/admin/update-speciality/route.ts'))
  ok(!/json\(\{[^}]*\.message/.test(route) && !/\bcause:/.test(route), 'la route ne rend AUCUN message d’erreur brut dans une réponse')
  const page = sansCommentaires(lire('app/[locale]/admin/taxonomie/[id]/page.tsx'))
  const motifs = R.MOTIFS_REFUS_ECRITURE.filter((m) => m !== 'refus_non_classe')
  const sansPhrase = motifs.filter((m) => !new RegExp(`motif === '${m}'\\) return t\\('err_refus_${m}'\\)`).test(page) || !dans4(`admin_taxonomie.err_refus_${m}`))
  ok(sansPhrase.length === 0, `chaque motif (${motifs.length}) a sa phrase à l’écran, dans les quatre langues`, sansPhrase.join(', '))
  ok(LANGUES.every((l) => !/\{cause\}/.test(cle(MSG[l], 'admin_taxonomie.err_ecriture_refusee') ?? '')),
    'la phrase du refus non classé ne réclame plus le message brut')
}

console.log(echecs === 0 ? '\n✅ Le lot alertes tient : alerte, avis, flux, carte, candidature, refus.' : `\n❌ ${echecs} contrôle(s) en échec.`)
process.exit(echecs === 0 ? 0 : 1)
