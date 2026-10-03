// tests/integration/outils.mjs — CE QUE PARTAGENT LES BANCS D'ESSAI DE L'INTÉGRATION CONTINUE (lot DevOps CI).
//
// Ces bancs tournent sur GitHub Actions, contre une base Supabase DÉMARRÉE DANS LE RUNNER (`supabase start`) :
// jamais contre staging, jamais contre la production. Ils refusent de tourner si l'adresse de la base n'est pas
// locale (`exigerBaseLocale`) — une erreur de variable ne doit pas les envoyer écrire ailleurs (§E.4, §G.6).
//
// TROIS ÉTATS, comme scripts/diag.mjs : 0 vert · 1 rouge (un contrôle a conclu « c'est faux ») · 2 n'a pas
// tourné (la base, l'application ou un outil manquait : rien n'a été vérifié). Jamais `process.exit()` pendant
// une écriture (§E.108) : `process.exitCode`.
//
// RIEN EN DUR : l'écosystème, les branches, les zones sont LUS dans la base ; les comptes naissent par les
// fabriques des tests de base (supabase/tests/database/grand_livre/_fabriques.psql), c'est-à-dire par
// `auth.users` → `handle_new_user`, avec leur preuve signée — le chemin d'une vraie inscription (§D.27).

import { spawnSync } from 'node:child_process'
import { readFileSync, appendFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

export const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// ── Les verdicts ─────────────────────────────────────────────────────────────
export class Banc {
  constructor(titre) {
    this.titre = titre
    this.echecs = []
    this.reussis = 0
    this.lignes = []
  }
  section(t) {
    console.log(`\n═══ ${t} ═══\n`)
    this.lignes.push(`\n**${t}**\n`)
  }
  ok(cond, libelle, indice) {
    if (cond) {
      this.reussis++
      console.log(`  ok   ${libelle}`)
      this.lignes.push(`- ✅ ${libelle}`)
    } else {
      this.echecs.push(libelle)
      console.log(`  KO   ${libelle}${indice ? `\n       → ${indice}` : ''}`)
      this.lignes.push(`- ❌ ${libelle}${indice ? ` — \`${String(indice).slice(0, 300)}\`` : ''}`)
    }
  }
  /** Le résumé lisible dans la demande de fusion (GITHUB_STEP_SUMMARY), et le code de sortie. */
  conclure() {
    const total = this.reussis + this.echecs.length
    const entete = this.echecs.length === 0
      ? `### ✅ ${this.titre} — ${total} contrôle(s), tous verts`
      : `### ❌ ${this.titre} — ${this.echecs.length} en échec sur ${total}`
    console.log(`\n${entete.replace(/^### /, '')}`)
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, [entete, ...this.lignes, ''].join('\n') + '\n')
    }
    process.exitCode = this.echecs.length === 0 ? 0 : 1
  }
}

/** Le troisième état : rien n'a été vérifié. */
export function nAPasTourne(titre, raison) {
  console.log(`\n≡ ${titre} — N'A PAS TOURNÉ\n  ${raison}\n  Code 2 : rien n'a été vérifié. Ce n'est pas un contrôle en échec — c'est pire : aucun n'a conclu.`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ≡ ${titre} — n'a pas tourné\n\n${raison}\n\n`)
  }
  process.exitCode = 2
}

// ── La base locale ───────────────────────────────────────────────────────────
/** L'environnement de la base locale du runner, ou une raison de ne pas tourner. */
export function environnementLocal() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const db = process.env.SUPABASE_DB_URL ?? ''
  const manque = [['NEXT_PUBLIC_SUPABASE_URL', url], ['NEXT_PUBLIC_SUPABASE_ANON_KEY', anon],
    ['SUPABASE_SERVICE_ROLE_KEY', service], ['SUPABASE_DB_URL', db]].filter(([, v]) => !v).map(([n]) => n)
  if (manque.length) return { erreur: `variables absentes : ${manque.join(', ')} (lancer tests/integration/env-supabase-local.mjs après supabase start)` }
  const local = (u) => { try { return ['127.0.0.1', 'localhost', '::1'].includes(new URL(u).hostname) } catch { return false } }
  if (!local(url) || !local(db)) return { erreur: 'la base visée n’est PAS locale au runner — refus de tourner (aucun essai contre staging ni la production)' }
  return { url, anon, service, db }
}

/**
 * Exécute un script SQL sur la base locale, en `postgres`. Les `\ir` sont DÉPLIÉS ici (le texte est envoyé par
 * l'entrée standard : psql ne saurait pas d'où les résoudre). psql du runner s'il existe, sinon celui du
 * conteneur de la base (`docker exec`). Rend la sortie ; lève en nommant l'erreur.
 */
export function executerSql(cheminOuTexte, { db, variables = {} } = {}) {
  const deplier = (texte, dossier) => texte.split(/\r?\n/).map((l) => {
    const m = /^\s*\\ir\s+(\S+)\s*$/.exec(l)
    if (!m) return l
    const cible = resolve(dossier, m[1])
    return deplier(readFileSync(cible, 'utf8'), dirname(cible))
  }).join('\n')
  const estChemin = !cheminOuTexte.includes('\n') && /\.(sql|psql)$/.test(cheminOuTexte)
  const texte = estChemin
    ? deplier(readFileSync(resolve(RACINE, cheminOuTexte), 'utf8'), dirname(resolve(RACINE, cheminOuTexte)))
    : deplier(cheminOuTexte, RACINE)
  const vars = Object.entries(variables).flatMap(([k, v]) => ['-v', `${k}=${v}`])
  const options = ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...vars]
  let r = spawnSync('psql', [db, ...options], { input: texte, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.error?.code === 'ENOENT') {
    const noms = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout ?? ''
    const conteneur = noms.split('\n').find((n) => n.startsWith('supabase_db_'))
    if (!conteneur) throw new Error('ni psql sur le runner, ni conteneur supabase_db_* en marche')
    r = spawnSync('docker', ['exec', '-i', conteneur, 'psql', '-U', 'postgres', '-d', 'postgres', ...options],
      { input: texte, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  }
  if (r.status !== 0) throw new Error(`SQL en échec (code ${r.status}) : ${(r.stderr || r.stdout || '').trim().slice(-1500)}`)
  return r.stdout
}

/** La ligne `PREFIXE:{json}` qu'un script de semences imprime en dernier. */
export function lireJson(sortie, prefixe) {
  const ligne = sortie.split(/\r?\n/).reverse().find((l) => l.startsWith(`${prefixe}:`))
  if (!ligne) throw new Error(`le script n'a pas rendu la ligne « ${prefixe}: » — sortie : ${sortie.slice(-500)}`)
  return JSON.parse(ligne.slice(prefixe.length + 1))
}

// ── L'authentification, par GoTrue, comme le navigateur ─────────────────────
/** Un jeton d'accès pour un compte fabriqué, par le mot de passe — la vraie connexion de Supabase. */
export async function seConnecter({ url, anon }, email, motDePasse) {
  const rep = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: motDePasse }),
  })
  const corps = await rep.json().catch(() => ({}))
  if (!rep.ok || !corps.access_token) throw new Error(`connexion refusée pour ${email} : HTTP ${rep.status} ${JSON.stringify(corps).slice(0, 300)}`)
  return corps.access_token
}

// ── Les requêtes à l'application ─────────────────────────────────────────────
/**
 * Une requête à l'application démarrée, AVEC L'HÔTE d'un écosystème (`<slug>.<racine>`) : l'écosystème se lit
 * dans l'adresse (§E.85) — `fetch` ne laisse pas poser `Host`, `node:http` si.
 */
export function requete({ methode = 'GET', chemin, hote, jeton, compte, corps }) {
  return new Promise((resoudre) => {
    const donnees = corps === undefined ? null : Buffer.from(JSON.stringify(corps))
    const entetes = { host: hote, accept: 'application/json' }
    if (jeton) entetes.authorization = `Bearer ${jeton}`
    if (compte) entetes['x-compte-affiche'] = compte
    if (donnees) { entetes['content-type'] = 'application/json'; entetes['content-length'] = String(donnees.length) }
    const req = http.request({ host: '127.0.0.1', port: Number(process.env.PORT_APPLICATION ?? 3000), method: methode, path: chemin, headers: entetes, timeout: 30_000 }, (rep) => {
      const morceaux = []
      rep.on('data', (m) => morceaux.push(m))
      rep.on('end', () => {
        const texte = Buffer.concat(morceaux).toString('utf8')
        let json = null
        try { json = JSON.parse(texte) } catch { /* pas du JSON : on garde le texte */ }
        resoudre({ statut: rep.statusCode ?? 0, json, texte: texte.slice(0, 400), entetes: rep.headers })
      })
    })
    req.on('timeout', () => req.destroy(new Error('délai dépassé')))
    req.on('error', (e) => resoudre({ statut: 0, json: null, texte: `erreur réseau : ${e.message}`, entetes: {} }))
    if (donnees) req.write(donnees)
    req.end()
  })
}

export const lireFichier = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').split('\r\n').join('\n')
