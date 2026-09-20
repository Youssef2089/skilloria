/**
 * scripts/balayage-promesse.mjs — LE SOCLE DES QUATRE CONTRÔLES « UN ÉCRAN NE
 * PROMET QUE CE QUE LE SERVEUR TIENT ».
 *
 * ┌─ POURQUOI UN MODULE ────────────────────────────────────────────────────┐
 * │ `refus-actionnables`, `murs-fermes`, `plafonds-listes` et                │
 * │ `score-de-pertinence` défendent UNE propriété : ce qu'un écran affirme   │
 * │ (un refus expliqué, un mur fermé, une liste complète, une pertinence     │
 * │ sans nombre) est exactement ce que le serveur rend. Ils l'épinglaient    │
 * │ chacun sur des NOMS de fichiers — cinq, six, deux plus quatre. Un écran  │
 * │ de plus qui appelait la même route n'était pas regardé (§E.34 : le       │
 * │ contrôle VERDIT au déplacement), et l'un d'eux a raté un quatrième       │
 * │ écran qui jette le refus qu'il est né pour faire afficher.               │
 * │                                                                          │
 * │ Ici vivent les primitives partagées : le balayage, la résolution         │
 * │ route → écrans par le CHEMIN D'APPEL, les traductions. Rien d'autre —    │
 * │ chaque contrôle garde ses motifs, ses preuves et sa campagne.            │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * PUR : aucune sortie, aucun `process.exit`, aucune base, aucun réseau. Les
 * scripts l'importent en relatif avec extension (§E.3). Il n'écrit jamais.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Où vivent les écrans, où vivent les routes. Un périmètre, jamais un nom. */
export const RACINES_CLIENT = ['components', 'app/[locale]']
export const RACINES_SERVEUR = ['app/api', 'lib']
export const LOCALES = ['fr', 'en', 'es', 'de']

/** §E.3 — CRLF normalisé en entrée. */
export const lire = (rel) => readFileSync(join(ROOT, rel), 'utf8').split('\r\n').join('\n')

/** §E.7 — commentaires retirés SANS PERDRE DE LIGNES (les numéros restent justes). */
export const sansCommentaires = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l))
    .join('\n')

/** Tous les fichiers `.ts`/`.tsx` sous des racines, en chemins relatifs POSIX. */
export function fichiers(racines, motif = /\.tsx?$/) {
  const out = []
  const marche = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) marche(p)
      else if (motif.test(p)) out.push(relative(ROOT, p).replace(/\\/g, '/'))
    }
  }
  for (const r of racines) marche(join(ROOT, r))
  return out.sort()
}

/** Les routes API, avec le chemin d'URL que le client compose pour les appeler. */
export function routesApi() {
  return fichiers(['app/api'], /route\.ts$/).map((rel) => ({
    rel,
    // `app/api/x/[id]/y/route.ts` → `/api/x/[id]/y`. La première version gardait
    // `app/` : aucun écran n'appelle `/app/api/…`, le résolveur rendait ZÉRO
    // appelant partout, et un contrôle « pour chaque appelant » passait à vide.
    chemin: rel.replace(/^app/, '').replace(/\/route\.ts$/, ''),
  }))
}

/**
 * Le motif qui reconnaît un APPEL à une route dans du code client.
 *
 *   `/api/candidatures/[id]/unlock`  →  /api/candidatures/${…}/unlock
 *
 * Un segment dynamique accepte tout sauf `/` et une fin de chaîne ; le chemin
 * doit se TERMINER là (suivi d'un guillemet, d'un `?` ou d'une fin de
 * gabarit) : `/api/publications/${id}` ne matche pas `/api/publications/${id}/publish`.
 */
export function motifDeRoute(chemin) {
  const corps = chemin
    .split('/')
    .map((seg) => (/^\[.*\]$/.test(seg) ? "[^/`'\"?]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/')
  return new RegExp(corps + "(?=[`'\"?])")
}

/** Les fichiers client qui appellent cette route — résolus par le chemin, jamais nommés. */
export function consommateurs(chemin, candidats) {
  const motif = motifDeRoute(chemin)
  return candidats.filter((rel) => motif.test(sansCommentaires(lire(rel))))
}

/**
 * Les APPELS à une route dans un source, avec leur verbe. `ecrit` vaut vrai si
 * un `method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'` suit l'appel dans les 200
 * caractères. Un écran qui n'appelle une route qu'en écriture ne LIT pas sa
 * réponse de liste : lui reprocher de ne pas afficher une troncature serait un
 * faux positif — et un contrôle qui crie à tort est désactivé le jour même.
 */
export function appelsDeRoute(src, chemin) {
  const motif = new RegExp(motifDeRoute(chemin).source, 'g')
  // `method: isCreating ? 'POST' : 'PATCH'` et `const method = … ; { method, }`
  // sont des écritures aussi : on lit le verbe sur la ligne qui DÉFINIT
  // `method` (`:` ou `=`), dans les 300 caractères qui suivent le chemin.
  return [...src.matchAll(motif)].map((m) => {
    const suite = src.slice(m.index, m.index + 300)
    const verbe = /\bmethod\b\s*[:=]([^\n]{0,80})/.exec(suite)?.[1] ?? ''
    return { index: m.index, ecrit: /['"](?:POST|PATCH|PUT|DELETE)['"]/.test(verbe) && !/['"]GET['"]/.test(verbe) }
  })
}
/** Les fichiers client qui LISENT cette route (au moins un appel qui n'est pas une écriture). */
export function lecteurs(chemin, candidats) {
  return candidats.filter((rel) => appelsDeRoute(sansCommentaires(lire(rel)), chemin).some((a) => !a.ecrit))
}

/** Les quatre dictionnaires, et deux lecteurs. */
export const messages = () => Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(lire(`messages/${l}.json`))]))
export const lireCle = (obj, chemin) => chemin.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
export function clesPlates(obj, prefixe = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? clesPlates(v, `${prefixe}${k}.`) : [`${prefixe}${k}`],
  )
}
/** Les clés (chemin complet) dont le dernier segment se termine par `suffixe`. */
export function clesFinissantPar(dico, suffixe) {
  return clesPlates(dico).filter((k) => k.split('.').pop().endsWith(suffixe))
}
/** Les locales où cette clé manque. */
export const localesManquantes = (dicos, chemin) => LOCALES.filter((l) => typeof lireCle(dicos[l], chemin) !== 'string')

/** Le compteur d'assertions, commun aux quatre : `ok`, `section`, `fin`. */
export function bilan() {
  let echecs = 0
  return {
    ok(cond, label, indice) {
      if (cond) console.log(`  ok   ${label}`)
      else {
        echecs++
        console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`)
      }
    },
    info: (l) => console.log(`  ··   ${l}`),
    section: (t) => console.log(`\n═══ ${t} ═══\n`),
    fin(vert, rouge) {
      console.log('')
      if (echecs) {
        console.log(`✘ ${echecs} CONTROLE(S) EN ECHEC${rouge ? ` — ${rouge}` : ''}`)
        process.exit(1)
      }
      console.log(`✅ ${vert}`)
    },
    get echecs() {
      return echecs
    },
  }
}
