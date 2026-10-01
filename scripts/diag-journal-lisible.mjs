/**
 * diag-journal-lisible.mjs — CHAQUE ÉCRITURE DU GRAND LIVRE SE LIT COMME UNE PHRASE, ET LA LISTE VALIDÉE TIENT.
 *
 * La décision de Youssef (01/10/2026, ARRÊT 22, §D.33) : « Chaque écriture se lit comme une phrase, comprise par une
 * personne non technique qui ne connaît pas la plateforme : qui, quoi, sur quoi (nommé), et le résultat. Aucun code
 * technique ni nom de champ à l'écran, aucun mot propre à la plateforme sans explication ; quatre langues. » Et :
 * « Un contrôle mord si une écriture affiche un code brut, un nom de champ technique ou un mot propre à la plateforme
 * non expliqué, ou si une action retirée écrit encore. Balaie tous les fichiers de test qui lisent une action
 * retirée, fusionnée ou modifiée. »
 *
 * CE QU'IL FAIT — EXÉCUTÉ, PAS LU (§E.33) :
 *   1. Pour CHAQUE action de la liste fermée, des lignes FABRIQUÉES (chaque statut, chaque origine, chaque type de
 *      sujet, chaque valeur connue de chaque clé de détail, le détail vide, les noms présents, effacés, illisibles)
 *      sont rendues par `lib/journal/phrase.ts` avec le traducteur de next-intl (`use-intl`), DANS LES QUATRE LANGUES.
 *      Chaque phrase est refusée si elle porte : une accolade, « undefined », un identifiant, un mot en_snake_case,
 *      le CODE qu'on lui a passé (sauf s'il est aussi le mot de la langue), un mot du jargon de la plateforme non
 *      expliqué par le glossaire de l'écran. Une action qui retombe sur la phrase générique rougit : chaque action a
 *      la sienne. Un gabarit de phrase qu'aucun cas ne produit rougit aussi (texte mort).
 *   2. Chaque code de chaque dimension a son libellé dans les quatre langues ; plusieurs dimensions sont RECOUPÉES avec
 *      leur source dans le code (champs d'annonce, de profil, d'organisation, d'écosystème, de la liste des métiers ;
 *      tâches planifiées ; événements de notification ; types de compte ; actions d'IA ; familles).
 *   3. Les actions retirées : la même liste en TypeScript et en SQL, `journaliser()` refuse (GL006), le type
 *      `ActionActive` les exclut, aucun appel TypeScript ne les écrit.
 *   4. Les tests pgTAP : toute instruction qui cite une action retirée attend GL006 ou un compte nul.
 *   5. Les écrans : plus de détail « clé par clé », l'origine n'est plus montrée à côté de l'acteur (« Système
 *      Système »), la conservation a son écran, pleine largeur, aligné à gauche, jamais centré ni limité.
 *
 * CE QU'IL NE VOIT PAS, ET IL FAUT LE LIRE :
 *   · la JUSTESSE d'une traduction (un mot mal choisi passe) ; le contrôle garde la forme, pas le sens ;
 *   · une valeur que la base inventerait hors des dimensions : elle s'affiche « une autre information », jamais le code ;
 *   · qu'une action « mieux » n'écrive plus quand rien ne change : c'est le comportement, prouvé par pgTAP
 *     (`grand_livre/liste_validee.test.sql`, `grand_livre/reglages.test.sql`) — que Youssef lance.
 *
 * Sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const sansCommentaires = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/ .*$/, ''))).join('\n')
const importer = (p) => import(pathToFileURL(join(ROOT, p)).href)

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (t) => console.log(`\n═══ ${t} ═══\n`)

let P, A, createTranslator
try {
  P = await importer('lib/journal/phrase.ts')
  A = await importer('lib/journal/actions.ts')
  ;({ createTranslator } = await import('use-intl/core'))
} catch (err) {
  console.error('✘ un module ne se charge pas — le contrôle n’a pas tourné', err)
  process.exit(2)
}
const LANGUES = ['fr', 'en', 'es', 'de']
const MESSAGES = Object.fromEntries(LANGUES.map((l) => [l, JSON.parse(lire(`messages/${l}.json`))]))

/** Le traducteur de l'écran, sur l'espace `journal` — une clé absente LÈVE (next-intl rendrait son chemin). */
function traducteur(langue) {
  const t = createTranslator({
    locale: langue, messages: MESSAGES[langue], namespace: 'journal',
    onError: (e) => { throw new Error(`[${langue}] ${e.message}`) },
  })
  return { t: (cle, v) => t(cle, v), has: (cle) => t.has(cle) }
}
const TR = Object.fromEntries(LANGUES.map((l) => [l, traducteur(l)]))
const GABARITS = Object.fromEntries(LANGUES.map((l) => [l, JSON.stringify(MESSAGES[l].journal.phrases)]))

// ─── LE JARGON : des mots propres à la plateforme ou techniques. Seul « écosystème » est permis, parce que le
//     glossaire de l'écran l'explique (vérifié plus bas). ───────────────────────────────────────────────────────
const JARGON = {
  fr: ['vivier', 'pièce', 'dévoilement', 'dévoilé', 'taxonomie', 'palier', 'matching', 'reranker', 'rerank', 'prompt', 'webhook', 'cron', 'payload', 'jeton', 'token', 'slug', 'sous-domaine', 'grand livre', 'seuil', 'pool', 'backend', 'uuid'],
  en: ['pool', 'ledger', 'taxonomy', 'tier', 'matching', 'reranker', 'rerank', 'prompt', 'webhook', 'cron', 'payload', 'token', 'slug', 'subdomain', 'threshold', 'backend', 'uuid'],
  es: ['vivero', 'pieza', 'taxonomía', 'matching', 'reranker', 'rerank', 'prompt', 'webhook', 'cron', 'payload', 'token', 'slug', 'subdominio', 'umbral', 'backend', 'uuid'],
  de: ['pool', 'beleg', 'taxonomie', 'matching', 'reranker', 'rerank', 'prompt', 'webhook', 'cron', 'payload', 'token', 'slug', 'subdomain', 'schwellenwert', 'backend', 'uuid'],
}
const EXPLIQUES = { fr: ['écosystème'], en: ['ecosystem'], es: ['ecosistema'], de: ['ökosystem'] }
const REGEX_MOT = new Map()
const motEntier = (mot) => REGEX_MOT.get(mot) ?? REGEX_MOT.set(mot, motEntierNeuf(mot)).get(mot)
const motEntierNeuf = (mot) => new RegExp(`(^|[^\\p{L}\\p{N}_-])${mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}_-])`, 'iu')

// ─── LES LIGNES FABRIQUÉES ───────────────────────────────────────────────────────────────────────────────────
const D = P.DIMENSIONS
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`.slice(-36)
const ACTEUR = 'aaaaaaaa-0000-4000-8000-000000000001'
const SUJET = 'bbbbbbbb-0000-4000-8000-000000000002'
const PUB = 'cccccccc-0000-4000-8000-000000000003'
const ORG = 'dddddddd-0000-4000-8000-000000000004'

/** Les valeurs que chaque clé de détail peut prendre — les codes connus, des nombres, des booléens, des dates. */
function valeursDe(action, cle) {
  const nombres = [0, 1, 7]
  const bool = [true, false]
  const champsPar = {
    annonce_modifiee: D.champ_annonce, profil_modifie: D.champ_profil, identite_modifiee: D.champ_identite,
    organisation_modifiee: D.champ_organisation, taxonomie_modifiee: D.champ_taxo, ecosysteme_modifie: D.champ_ecosysteme,
  }
  switch (cle) {
    case 'champs': return champsPar[action] ? [[...champsPar[action]], [champsPar[action][0]], []] : [[]]
    case 'blocs': return [['experiences', 'educations', 'languages_structured'], []]
    case 'traductions': return action === 'ecosysteme_modifie'
      ? [['domains.name.en', 'domain_configs.ecosystem_expert_label.de', 'domains.tagline.es'], []]
      : [['en', 'es', 'de', 'fr'], []]
    case 'type': return [...D.type_annonce]
    case 'motif': return [...D.motif_verification, 'code_que_personne_ne_connait']
    case 'issue': return ['ok', 'vivier_vide', 'annonce_expiree', 'ineligible', 'sans_matiere']
    case 'raison': return [...D.raison_ineligible]
    case 'etape': return action === 'email_change' ? ['demande', 'confirme'] : [...D.etape_recherche]
    case 'cause': return action === 'inactivite_avertie' ? [...D.cause_avertissement]
      : action === 'refus_depot_sans_jugement' ? [...D.cause_depot]
      : action.startsWith('recherche_') ? [...D.cause_recherche] : ['42501', 'texte libre d’une erreur']
    case 'arret': return [null, ...D.arret_notation]
    case 'nature': return [...D.nature_travail]
    case 'code': case 'code_origine': return [...D.code_travail]
    case 'champ': return action === 'disponibilite_basculee' ? [...D.champ_dispo] : [...D.champ_plafond_compte]
    case 'de': case 'vers': return action === 'disponibilite_basculee' ? ['available', 'do_not_disturb', 'employed', 'open_to_work', true, false, null] : ['pending', 'approved']
    case 'role_in_org': case 'role_de': case 'role_vers': return [...D.role_org]
    case 'type_de_compte': return [...D.type_compte]
    case 'voie_declaree': return [...D.voie]
    case 'org_type': return [...D.org_type]
    case 'operation': return action === 'organisation_modifiee' ? ['modification', 'logo_depose', 'logo_retire']
      : action === 'taxonomie_modifiee' ? ['creee', 'modifiee', 'supprimee']
      : ['modification', 'activation', 'desactivation', 'visuel_depose', 'visuel_retire', 'sous_domaine']
    case 'objet': return ['branche', 'specialite']
    case 'visuel': return [...D.visuel]
    case 'sous_domaine': return [{ avant: 'ancien-nom', apres: 'nouveau-nom' }, null]
    case 'slug': return ['nouvel-espace']
    case 'periode': return [...D.periode_paiement]
    case 'devise': return ['eur', 'usd']
    case 'montant': return [49, 0]
    case 'action': return [...D.action_ia]
    case 'portee': return ['acteur', 'global']
    case 'tache': return [...D.tache]
    case 'evenement': return [...D.evenement]
    case 'canal': return ['email']
    case 'famille': return [...D.famille]
    case 'familles': return [D.famille.map((f) => ({ famille: f, jusqu_au: '2025-01-01T00:00:00Z', lignes: 3 })), []]
    case 'note_de': return [...D.note_de]
    case 'mode': return [...D.mode_paiement]
    case 'liste': return [...D.liste_domaines]
    case 'model': return ['claude-haiku-4-5', 'rerank-v3.5']
    case 'target_role': return [...D.valeur_reglage]
    case 'origine_depot': return ['expert', 'relance_admin']
    case 'avant': case 'apres': return reglagesFabriques(cle)
    case 'echeance': case 'echeance_purge': case 'recu_le': case 'expires_at': case 'published_at': return ['2026-11-30T10:00:00Z']
    case 'publication_id': return [PUB]
    case 'organization_id': return [ORG]
    case 'profile_id': case 'membre_user_id': case 'package_id': case 'branch_id': case 'match_id': case 'transaction_id':
    case 'conversation_id': case 'candidature_id': case 'demande_email_id':
      return [U(9)]
    default: return [...nombres, ...bool]
  }
}
/** Un avant/après de réglage : chaque clé connue, une valeur par forme (nombre, booléen, code, texte, date, null). */
function reglagesFabriques(cote) {
  const v = {}
  for (const [i, k] of D.cle_reglage.entries()) {
    const formes = [i, true, 'expert_freelance', 'Offre Équipe', '2026-10-01T00:00:00Z', null, 0.5, false]
    v[k] = cote === 'avant' ? formes[i % formes.length] : formes[(i + 1) % formes.length]
  }
  v.drapeaux = ['a', 'b']
  v.default_ids = [U(5)]
  v.package_id = U(6)
  v.cle_inconnue_au_bataillon = 3
  return [v, {}]
}

const SUJETS = {
  annonce: ['publications'], profil: ['profiles'], recherche: ['publications', 'profiles'], candidature: ['candidatures', 'matches'],
  devoilement: ['candidatures'], messagerie: ['messages'], compte: ['users', 'profiles', 'organizations'],
  organisation: ['organization_invitations', 'organization_members', 'organizations'], commerce: ['organizations', 'profiles', 'ai_spend_caps', 'stripe_events'],
  administration: ['duree_reglages', 'ai_model_tarifs', 'ai_spend_caps', 'ai_spend_seuils_acteur', 'ai_quotas', 'matching_settings',
    'verification_providers', 'packages_default', 'grand_livre_conservation', 'blocked_email_domains', 'public_email_domains',
    'packages', 'organizations', 'packages_stripe', 'branches', 'specialities', 'domains', 'users', 'cron_job', 'profiles'],
  rgpd: ['users', 'cron_job'], journal: [null], refus: ['candidature_depots', 'profiles', 'publications', null],
}
const FAMILLE_DE = (() => {
  // La famille de chaque action, lue dans la migration du socle (la base fait foi).
  const m = {}
  const dossier = join(ROOT, 'supabase/migrations')
  for (const f of readdirSync(dossier).sort()) {
    const sql = readFileSync(join(dossier, f), 'utf8')
    for (const x of sql.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'(annonce|profil|recherche|candidature|devoilement|messagerie|compte|organisation|commerce|administration|rgpd|journal|refus)'\s*,/g)) m[x[1]] = x[2]
  }
  return m
})()

const NOMS_PRESENTS = (refs) => Object.fromEntries(refs.map((r) => [P.cleObjet(r.type, r.id), {
  nom: r.type === 'organizations' || r.type === 'organization_invitations' || r.type === 'organization_members' ? 'Acme Conseil'
    : r.type === 'publications' || r.type === 'candidatures' || r.type === 'matches' || r.type === 'candidature_depots' ? 'Développeur React'
    : r.type === 'packages' ? 'Offre Équipe' : r.type === 'domains' ? 'Nuage' : r.type === 'branches' ? 'Données' : r.type === 'specialities' ? 'Entrepôts' : 'Mehdi Ben ayed',
  contexte: 'Salma Haddad',
}]))
const NOMS_EFFACES = (refs) => Object.fromEntries(refs.map((r) => [P.cleObjet(r.type, r.id), { nom: null, contexte: null }]))

function* lignesPour(action) {
  const cles = (A.CLES_DETAIL[action] ?? []).filter((c) => !c.includes('.') && !c.includes('['))
  const sujets = SUJETS[FAMILLE_DE[action]] ?? [null]
  const origines = [
    { origine: 'utilisateur', acteur_id: ACTEUR, acteur_nom: 'Youssef Cherif', acteur_supprime: false },
    { origine: 'administrateur', acteur_id: ACTEUR, acteur_nom: 'Youssef Cherif', acteur_supprime: false },
    { origine: 'tache_planifiee', acteur_id: null, acteur_nom: null, acteur_supprime: false },
    { origine: 'systeme', acteur_id: null, acteur_nom: null, acteur_supprime: false },
    { origine: 'utilisateur', acteur_id: ACTEUR, acteur_nom: null, acteur_supprime: true },
    { origine: 'utilisateur', acteur_id: ACTEUR, acteur_nom: '   ', acteur_supprime: false },
  ]
  // Un détail « de base » : la première valeur de chaque clé.
  const base = Object.fromEntries(cles.map((c) => [c, valeursDe(action, c)[0]]))
  const details = [{}, base]
  // Chaque valeur, avec les autres clés à leur valeur de base — puis SEULE (les variantes « simples »).
  for (const c of cles) for (const v of valeursDe(action, c)) details.push({ ...base, [c]: v }, { [c]: v })
  // Deux balayages, pour rester linéaire : (a) chaque statut × origine × sujet, sur le détail vide et le détail de
  // base ; (b) chaque valeur de chaque clé, sous chaque sujet, pour deux origines (un humain, une tâche) et chaque statut.
  for (const statut of ['reussi', 'echoue', 'refuse']) {
    for (const o of origines) {
      for (const sujet_type of sujets) {
        for (const detail of details.slice(0, 2)) {
          yield { type_action: action, statut, ...o, sujet_type, sujet_id: sujet_type ? SUJET : null, detail, _noms: true }
        }
      }
    }
    if (statut === 'refuse') continue
    for (const sujet_type of sujets) {
      for (const detail of details.slice(2)) {
        yield { type_action: action, statut, ...origines[0], sujet_type, sujet_id: sujet_type ? SUJET : null, detail, _noms: false }
      }
    }
  }
}

/** Les codes qu'une phrase a reçus (pour vérifier qu'aucun n'atteint l'écran tel quel). */
function codesDe(phrase, sortie = []) {
  for (const a of Object.values(phrase.args ?? {})) {
    if (a.k === 'code' && typeof a.v === 'string') sortie.push({ dim: a.dim, v: a.v })
    if (a.k === 'codes' && Array.isArray(a.v)) for (const v of a.v) if (typeof v === 'string') sortie.push({ dim: a.dim, v })
    if (a.k === 'sous') codesDe(a.phrase, sortie)
    if (a.k === 'liste') for (const p of a.elements) codesDe(p, sortie)
  }
  return sortie
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('1. Chaque action, rendue dans les quatre langues : une phrase, sans code, sans nom de champ, sans jargon')
const clesProduites = new Set()
const fautes = []
let rendues = 0
let lignesFabriquees = 0
// Le rendu ne dépend que de la PHRASE (clé et arguments), de « qui » et des noms : une même combinaison n'est rendue
// qu'une fois — c'est ce qui tient le contrôle sous le délai du lanceur sans retirer un seul cas.
const dejaRendues = new Set()
const generiques = new Set()
for (const action of A.ACTIONS_JOURNAL) {
  for (const ligne of lignesPour(action)) {
    const phrase = P.phraseDe(ligne)
    clesProduites.add(phrase.cle)
    const sousCles = []
    const collecter = (p) => { for (const a of Object.values(p.args ?? {})) { if (a.k === 'sous') { sousCles.push(a.phrase.cle); collecter(a.phrase) } if (a.k === 'liste') for (const e of a.elements) { sousCles.push(e.cle); collecter(e) } } }
    collecter(phrase)
    for (const c of sousCles) clesProduites.add(c)
    if (phrase.cle === '_generique') generiques.add(action)
    lignesFabriquees++
    const empreinte = JSON.stringify([phrase, ligne.origine, ligne.acteur_id, ligne.acteur_nom, ligne.acteur_supprime, ligne._noms])
    if (dejaRendues.has(empreinte)) continue
    dejaRendues.add(empreinte)
    const codes = codesDe(phrase)
    const refs = P.referencesDe(ligne)
    const variantes = ligne._noms ? [[NOMS_PRESENTS(refs), true], [NOMS_EFFACES(refs), true], [{}, false]] : [[NOMS_PRESENTS(refs), true]]
    for (const [noms, dispo] of variantes) {
      for (const langue of LANGUES) {
        const tr = TR[langue]
        let texte
        try {
          texte = P.phraseLisible({ ligne, noms, nomsDisponibles: dispo, locale: langue, tr })
        } catch (err) {
          fautes.push(`${action} [${langue}] ne se rend pas : ${err.message}`)
          continue
        }
        rendues++
        const dire = (raison) => fautes.push(`${action} [${langue}] ${raison} : « ${texte} »`)
        if (!texte || !texte.trim()) dire('phrase vide')
        if (/[{}]/.test(texte)) dire('accolade')
        if (/\b(undefined|null|NaN)\b|\[object/.test(texte)) dire('valeur brute')
        if (/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(texte)) dire('identifiant')
        if (/\b[a-z]+_[a-z0-9_]+\b/i.test(texte)) dire('nom en snake_case')
        if (/\b(journal|phrases|valeurs|designe)\.[a-z]/i.test(texte)) dire('chemin de clé')
        for (const mot of JARGON[langue]) if (motEntier(mot).test(texte)) dire(`jargon « ${mot} »`)
        for (const { dim, v } of codes) {
          if (v.length < 3) continue
          const espace = dim === 'famille' ? 'familles' : `valeurs.${dim}`
          const libelle = tr.has(`${espace}.${v}`) ? tr.t(`${espace}.${v}`) : ''
          const gabarit = GABARITS[langue]
          if (motEntier(v).test(texte) && !motEntier(v).test(libelle) && !motEntier(v).test(gabarit)) dire(`code brut « ${v} »`)
          if ((D[dim] ?? []).includes(v) && texte.includes(tr.t('valeurs.inconnu'))) {
            // un code CONNU ne doit jamais devenir « une autre information » (le libellé manque)
            if (!tr.has(`${espace}.${v}`)) dire(`libellé absent pour ${dim}.${v}`)
          }
        }
      }
    }
  }
}
if (process.env.DIAG_TOUTES_FAUTES) { const vues = new Set(); for (const f of fautes) { const k = f.replace(/ : « .*$/, ''); if (!vues.has(k)) { vues.add(k); console.log('       · ' + f) } } }
ok(fautes.length === 0, `${lignesFabriquees} lignes fabriquées (${A.ACTIONS_JOURNAL.length} actions × statuts × origines × sujets × détails), ${rendues} phrases distinctes rendues (× noms × 4 langues) : aucune faute`,
  fautes.slice(0, 12).join('\n       → ') + (fautes.length > 12 ? `\n       → … et ${fautes.length - 12} autres` : ''))
ok(generiques.size === 0, 'chaque action a SA phrase — aucune ne retombe sur la phrase générique', [...generiques].join(', '))

// Les gabarits morts : une phrase écrite qu'aucun cas ne produit est un texte qu'on croit vu et qui ne l'est jamais.
const feuilles = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [p + k] : feuilles(v, `${p}${k}.`)))
const gabarits = feuilles(MESSAGES.fr.journal.phrases).filter((k) => k !== '_generique')
const morts = gabarits.filter((k) => !clesProduites.has(k))
ok(morts.length === 0, `les ${gabarits.length} gabarits de phrase sont tous produits par au moins un cas`, morts.join(', '))

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('1 bis. La grammaire des désignations (§E.90) : aucune ne suit une préposition qui la casse')
{
  // Une désignation porte son article (« le profil de X », « l’annonce « Y » ») ou son repli (« un profil (données
  // effacées) ») : derrière « de », le français dit « de le », « de une » ; l’espagnol « a el », « de el » ; l’allemand
  // met au datif ce qui est écrit à l’accusatif. Le contrôle d’en haut ne voit pas l’accord — celui-ci lit les GABARITS.
  const DESIGNATIONS = 'annonce|profil|compte|organisation|ecosysteme|objet|offre'
  const INTERDITS = {
    // « de » devant toute désignation ; « à » devant une masculine (« à le profil »).
    fr: new RegExp(`(^|[^\\p{L}])((de|du|des) \\{(${DESIGNATIONS})\\}|à \\{(profil|compte|ecosysteme|offre|objet)\\})`, 'u'),
    // « a » et « de » devant une désignation masculine (« el ») ; la cuenta et la organización sont féminines.
    es: new RegExp(`(^|[^\\p{L}])(a|de) \\{(annonce|profil|ecosysteme|offre|objet)\\}`, 'u'),
    de: new RegExp(`(^|[^\\p{L}])(von|vom|mit|aus|bei|zu|zum|zur|nach|seit) \\{(${DESIGNATIONS})\\}`, 'u'),
    en: null,
  }
  const PERSONNE = { fr: /(l’expert|membre) \{(expert|membre)\}/, es: /(experto|miembro) \{(expert|membre)\}/, de: /(Experten|Mitglied|Mitglieds) \{(expert|membre)\}/, en: /(expert|member) \{(expert|membre)\}/ }
  for (const langue of LANGUES) {
    const fautes = []
    for (const cle of feuilles(MESSAGES[langue].journal.phrases)) {
      const texte = cle.split('.').reduce((o, k) => o[k], MESSAGES[langue].journal.phrases)
      if (INTERDITS[langue] && INTERDITS[langue].test(texte)) fautes.push(`${cle} : « ${texte.match(INTERDITS[langue])[0].trim()} »`)
      for (const m of texte.matchAll(/\{(expert|membre)\}/g)) {
        const avant = texte.slice(Math.max(0, m.index - 12), m.index + m[0].length)
        if (!PERSONNE[langue].test(avant)) fautes.push(`${cle} : « ${avant} » — une personne se cite en apposition (son repli est « (compte effacé) »)`)
      }
    }
    ok(fautes.length === 0, `[${langue}] aucune désignation derrière une préposition qui la casse ; chaque personne citée en apposition`, fautes.slice(0, 6).join(' · '))
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('2. Les dimensions : chaque code a son libellé dans les quatre langues, et les listes suivent le code')
{
  const manques = []
  for (const langue of LANGUES) {
    for (const [dim, codes] of Object.entries(D)) {
      const espace = dim === 'famille' ? 'familles' : `valeurs.${dim}`
      for (const c of codes) if (!TR[langue].has(`${espace}.${c}`)) manques.push(`${langue}:${espace}.${c}`)
    }
    for (const t of P.OBJETS) for (const g of ['designe', 'designe_absent', 'designe_inconnu']) if (!TR[langue].has(`${g}.${t}`)) manques.push(`${langue}:${g}.${t}`)
    for (const o of ['utilisateur', 'tache_planifiee', 'administrateur', 'systeme', 'supprime', 'sans_nom']) {
      for (const g of ['qui', 'qui_milieu']) if (!TR[langue].has(`${g}.${o}`)) manques.push(`${langue}:${g}.${o}`)
    }
    for (const mot of ['ecriture', 'geste', 'famille', 'ecosysteme']) if (!TR[langue].has(`glossaire.${mot}.explication`)) manques.push(`${langue}:glossaire.${mot}`)
  }
  ok(manques.length === 0, 'chaque code, chaque désignation, chaque « qui » et chaque mot du glossaire existe dans les quatre langues', manques.slice(0, 10).join(', '))

  // Le mot permis parce qu'expliqué : le glossaire le porte, dans la langue.
  for (const langue of LANGUES) {
    const mot = TR[langue].t('glossaire.ecosysteme.mot').toLowerCase()
    ok(EXPLIQUES[langue].some((e) => mot.includes(e)), `[${langue}] le glossaire explique « ${EXPLIQUES[langue][0]} », le seul mot propre à la plateforme qu'une phrase emploie`)
  }

  const inclus = (dim, sources, label) => {
    const manquants = [...new Set(sources)].filter((s) => !D[dim].includes(s))
    ok(sources.length > 0 && manquants.length === 0, `${dim} couvre ${label} (${new Set(sources).size} codes)`, manquants.join(', ') || 'aucune source lue — le contrôle n’a rien vérifié')
  }
  const pub = lire('app/api/publications/[id]/route.ts')
  inclus('champ_annonce', [...pub.matchAll(/updates\.([a-z_]+) =/g)].map((m) => m[1]), 'chaque champ qu’écrit la modification d’une annonce')
  const prof = lire('app/api/profile/route.ts')
  const listesProf = [...prof.matchAll(/const (directFields|cdiFields): Array<keyof PatchBody> = \[([\s\S]*?)\]/g)].flatMap((m) => [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])).filter((c) => c !== 'visible')
  inclus('champ_profil', [...listesProf, ...[...prof.matchAll(/patch\.([a-z_]+) =/g)].map((m) => m[1])], 'chaque champ qu’écrit la modification d’un profil')
  const org = lire('app/api/me/organisation/route.ts')
  inclus('champ_organisation', [...(org.match(/const EDITABLE_FIELDS = \[([\s\S]*?)\] as const/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), 'chaque champ modifiable d’une organisation')
  const eco = lire('app/api/admin/ecosystemes/[id]/route.ts')
  const pal = lire('lib/palette.ts')
  inclus('champ_ecosysteme', [
    ...[...(eco.match(/export const TRANSLATABLE = \{([\s\S]*?)\} as const/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
    ...[...(pal.match(/export const COLONNE_PAR_ROLE[^{]*\{([\s\S]*?)\}/)?.[1] ?? '').matchAll(/: '([a-z_]+)'/g)].map((m) => m[1]),
    ...[...eco.matchAll(/domainUpdates\.([a-z_]+) =/g)].map((m) => m[1]),
    ...[...(eco.match(/for \(const k of \[([^\]]*)\] as const\)/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
  ], 'chaque champ et chaque couleur qu’écrit la modification d’un écosystème')
  const taxo = ['update-branch', 'update-speciality'].flatMap((f) => [...lire(`app/api/admin/${f}/route.ts`).matchAll(/updates\.([a-z_]+) =/g)].map((m) => m[1])).filter((c) => c !== 'updated_at')
  inclus('champ_taxo', taxo, 'chaque champ qu’écrit la modification d’une branche ou d’une spécialité')
  const taches = readdirSync(join(ROOT, 'supabase/migrations')).flatMap((f) => [...readFileSync(join(ROOT, 'supabase/migrations', f), 'utf8').matchAll(/cron\.schedule\(\s*'([a-z0-9_]+)'/g)].map((m) => m[1]))
  inclus('tache', taches, 'chaque tâche planifiée créée par une migration')
  inclus('evenement', [...(lire('lib/notifications/catalog.ts').match(/export type NotificationEventType =([\s\S]*?)\n\n/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), 'chaque événement de notification')
  inclus('type_compte', [...(lire('lib/journal/journaliser.ts').match(/export type TypeActeur = ([^\n]*)/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), 'chaque type d’acteur')
  inclus('action_ia', [...(lire('lib/ai-plafonds.ts').match(/export const CLASSE_DES_ACTIONS = \{([\s\S]*?)\n\}/)?.[1] ?? '').matchAll(/^\s+([a-z_]+): '/gm)].map((m) => m[1]), 'chaque action d’IA')
  inclus('famille', [...(lire('lib/journal/lecture.ts').match(/export const FAMILLES_JOURNAL = \[([\s\S]*?)\] as const/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), 'chaque famille du journal')
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('3. Les actions retirées n’écrivent plus')
{
  const dossier = join(ROOT, 'supabase/migrations')
  const mig = readdirSync(dossier).find((f) => f.endsWith('_grand_livre_liste_validee.sql'))
  ok(!!mig, 'la migration de la liste validée existe (résolue par son suffixe, §G.3)')
  const sql = mig ? readFileSync(join(dossier, mig), 'utf8').split('\r\n').join('\n') : ''
  const bloc = sql.match(/set retiree_le = [^\n]*\n\s*where code in \(([\s\S]*?)\)/)?.[1] ?? ''
  const sqlRetirees = [...bloc.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
  const tsRetirees = [...A.ACTIONS_RETIREES].sort()
  ok(sqlRetirees.length > 0 && JSON.stringify(sqlRetirees) === JSON.stringify(tsRetirees),
    `les ${tsRetirees.length} actions retirées sont les mêmes en SQL (retiree_le) et en TypeScript (ACTIONS_RETIREES)`,
    `SQL ${sqlRetirees.join(',')} · TS ${tsRetirees.join(',')}`)
  // journaliser() : sa DERNIÈRE définition refuse une action retirée, nommément.
  const defs = readdirSync(dossier).sort().map((f) => readFileSync(join(dossier, f), 'utf8').split('\r\n').join('\n'))
    .flatMap((s) => [...s.matchAll(/create or replace function public\.journaliser\(\s*p_piece[\s\S]*?\n\$fn\$;/g)].map((m) => m[0]))
  const derniere = defs.at(-1) ?? ''
  ok(/retiree_le/.test(derniere) && /errcode = 'GL006'/.test(derniere), 'la dernière définition de journaliser() refuse une action retirée (GL006)')
  const jtx = sansCommentaires(lire('lib/journal/journaliser.ts'))
  ok(/A extends ActionActive/.test(jtx) && !/A extends TypeAction\b/.test(jtx), 'en TypeScript, écrire une action retirée ne compile pas (EcritureJournal<A extends ActionActive>)')
  // Aucun appel TypeScript n'écrit une action retirée.
  const fichiers = []
  const parcourir = (d) => { for (const n of readdirSync(join(ROOT, d))) { const p = `${d}/${n}`; if (statSync(join(ROOT, p)).isDirectory()) { if (n !== 'node_modules') parcourir(p) } else if (/\.tsx?$/.test(n)) fichiers.push(p) } }
  for (const d of ['lib', 'app', 'components']) parcourir(d)
  const ecrivains = []
  for (const f of fichiers) {
    const s = sansCommentaires(lire(f))
    for (const r of A.ACTIONS_RETIREES) if (new RegExp(`type:\\s*'${r}'`).test(s)) ecrivains.push(`${f} → ${r}`)
  }
  ok(ecrivains.length === 0, 'aucun appel TypeScript n’écrit une action retirée', ecrivains.join(' · '))
  // Le désabonnement — l'ajout de Youssef — a son écrivain, et la route l'appelle.
  ok(/se_desabonner_email/.test(sansCommentaires(lire('app/api/notifications/unsubscribe/route.ts'))) && !/setPreference\(/.test(sansCommentaires(lire('app/api/notifications/unsubscribe/route.ts'))),
    'le lien de désabonnement passe par se_desabonner_email (la préférence ET sa ligne, une fois), plus par setPreference')
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('4. Les tests pgTAP : une action retirée n’y est attendue qu’en refus ou en absence')
{
  const racine = join(ROOT, 'supabase/tests/database')
  const tests = []
  const parcourir = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) parcourir(p); else if (n.endsWith('.sql')) tests.push(p) } }
  parcourir(racine)
  const fautives = []
  let citations = 0
  for (const f of tests) {
    const s = readFileSync(f, 'utf8').split('\r\n').join('\n').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
    for (const instr of s.split(/;\s*\n/)) {
      for (const r of A.ACTIONS_RETIREES) {
        if (!new RegExp(`'${r}'`).test(instr)) continue
        citations++
        const attendRefus = /GL006/.test(instr)
        const attendRien = /\b0\s*(::\w+)?\s*,\s*\n?\s*'/.test(instr) || /\bis_empty\(/.test(instr) || /not exists/.test(instr) || /retiree_le/.test(instr)
        if (!attendRefus && !attendRien) fautives.push(`${f.slice(ROOT.length + 1)} → ${r}`)
      }
    }
  }
  ok(fautives.length === 0, `${tests.length} fichiers de test balayés, ${citations} citations d’une action retirée : chacune attend GL006 ou un compte nul`, fautives.join(' · '))
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('5. Les écrans : une phrase, « qui » une seule fois, la conservation à part, pleine largeur')
{
  const pres = sansCommentaires(lire('components/admin/journal/presentation.tsx'))
  const liste = sansCommentaires(lire('app/[locale]/admin/journal/page.tsx'))
  const piece = sansCommentaires(lire('app/[locale]/admin/journal/[piece]/page.tsx'))
  ok(!/DetailEcriture|ResumeEcriture|JSON\.stringify\([a-z.]*detail/.test(pres + liste + piece), 'plus de détail « clé par clé » ni de JSON à l’écran')
  ok(/<PhraseEcriture /.test(liste) && /<PhraseEcriture /.test(piece), 'la liste et les écritures liées affichent la PHRASE de chaque écriture')
  ok(!/tO\(l\.origine\)/.test(liste) && !/tO\(l\.origine\)/.test(piece) && !/acteur_systeme/.test(pres),
    '« Système Système » ne peut plus s’afficher : l’origine n’est plus écrite à côté de l’acteur')
  ok(!/sujet_type\}|>\{l\.sujet_type/.test(liste + piece), 'le type technique d’un objet ne s’affiche plus')
  const cons = sansCommentaires(lire('components/admin/journal/ConservationJournal.tsx'))
  const consPage = sansCommentaires(lire('app/[locale]/admin/journal/conservation/page.tsx'))
  ok(/\/api\/admin\/journal\/conservation\/proposition/.test(cons) && /appliquer_proposition/.test(cons), 'l’écran de conservation applique une proposition par un bouton')
  ok(!/<ConservationJournal|NettoyageJournal/.test(liste), 'la conservation et le nettoyage ont quitté l’écran de lecture du journal')
  const mise = cons + consPage
  ok(/width: '100%'/.test(consPage) && /textAlign: 'left'/.test(consPage) && !/maxWidth|margin: '0 auto'|textAlign: 'center'|marginInline: 'auto'/.test(mise),
    'l’écran de conservation : pleine largeur, aligné à gauche, jamais centré ni limité en largeur')
  ok(!/\b(120|60|12)\b/.test(JSON.stringify(MESSAGES.fr.admin_back_office.conservation.reference)), 'les références légales ne portent aucune durée : les nombres vivent en base')
  const nav = lire('lib/nav-config.ts')
  ok(/href: '\/admin\/journal\/conservation'/.test(nav), 'la conservation du journal a son entrée de menu')
}

console.log(echecs === 0 ? '\n✅ Le grand livre se lit en phrases, et la liste validée tient.' : `\n❌ ${echecs} contrôle(s) rouge(s).`)
process.exit(echecs === 0 ? 0 : 1)
