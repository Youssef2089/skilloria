// scripts/lib/chargeur-ts.mjs — CHARGER LE VRAI CODE DU PRODUIT DANS NODE, SANS NEXT ET SANS OUTIL DE PLUS.
//
// Les tests de base qui exécutent le moteur (tests/moteur/, lot DevOps CI) importent les modules de `lib/`
// TELS QU'ILS SONT LIVRÉS : Node retire les types (type stripping, Node ≥ 22.18 et 24), ce crochet résout ce
// que Next résout d'habitude — l'alias `@/` du dépôt (tsconfig.json) et les imports relatifs sans extension
// (`./pool` → `./pool.ts`, `./x` → `./x/index.ts`). Rien d'autre : aucune transformation du code, aucun module
// remplacé. C'est le même procédé que `diag-garde-adresse`, étendu aux imports relatifs.
//
// ⚠️ CE QU'IL NE SAIT PAS FAIRE, ET LE DIT EN ÉCHOUANT : la syntaxe TypeScript qui n'est pas qu'un type
//    (enum, paramètre de constructeur `private x`, namespace) — Node lève ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX,
//    nommé. Le lanceur range alors le test en « n'a pas tourné », jamais en vert.

import { registerHooks } from 'node:module'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs']

/** Le fichier réel derrière un chemin sans extension, ou null. */
function fichierReel(base) {
  if (existsSync(base) && statSync(base).isFile()) return base
  for (const e of EXTENSIONS) if (existsSync(base + e)) return base + e
  for (const e of EXTENSIONS) {
    const index = join(base, `index${e}`)
    if (existsSync(index)) return index
  }
  return null
}

let pose = false
export function poserChargeurTs() {
  if (pose) return
  pose = true
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@/')) {
        const p = fichierReel(join(RACINE, specifier.slice(2)))
        if (p) return nextResolve(pathToFileURL(p).href, context)
      }
      const relatif = specifier.startsWith('./') || specifier.startsWith('../')
      // Les paquets de node_modules se résolvent eux-mêmes (le crochet s'applique aussi à `require`).
      if (relatif && context.parentURL?.startsWith('file:') && !context.parentURL.includes('/node_modules/')) {
        const base = join(dirname(fileURLToPath(context.parentURL)), specifier)
        if (!/\.[cm]?[jt]sx?$|\.json$/.test(specifier) || !existsSync(base)) {
          const p = fichierReel(base)
          if (p) return nextResolve(pathToFileURL(p).href, context)
        }
      }
      // `resend` (ESM) importe `{ Webhook }` de `svix`, paquet CommonJS dont Node ne détecte pas les exports
      // nommés — le bundler de Next, lui, s'en accommode. Sa version CommonJS charge `svix` par `require` :
      // même paquet, même version, autre point d'entrée déclaré par son package.json.
      if (specifier === 'resend') {
        return nextResolve(pathToFileURL(join(RACINE, 'node_modules/resend/dist/index.cjs')).href, context)
      }
      if (isAbsolute(specifier) && !specifier.startsWith('file:')) {
        const p = fichierReel(specifier)
        if (p) return nextResolve(pathToFileURL(p).href, context)
      }
      return nextResolve(specifier, context)
    },
    // Les messages (`messages/fr.json`) sont importés sans attribut `type: 'json'`, comme Next le permet :
    // on les sert en module dont l'export par défaut est l'objet — le contenu, intact.
    load(url, context, nextLoad) {
      if (url.startsWith('file:') && url.endsWith('.json')) {
        const source = readFileSync(fileURLToPath(url), 'utf8')
        return { format: 'module', source: `export default ${source};`, shortCircuit: true }
      }
      return nextLoad(url, context)
    },
  })
}

/** Importe un module du dépôt par son chemin depuis la racine (`lib/matching/index.ts`). */
export async function importerDuDepot(chemin) {
  poserChargeurTs()
  return import(pathToFileURL(join(RACINE, chemin)).href)
}
