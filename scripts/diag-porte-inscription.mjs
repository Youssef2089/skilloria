#!/usr/bin/env node
// scripts/diag-porte-inscription.mjs — LA PORTE D'INSCRIPTION RESTE FERMÉE : chaque compte naît avec une
// preuve signée par le serveur, la base la vérifie, et chaque règle d'inscription est écrite UNE fois.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI IL EXISTE (§D.27, 28/09/2026)
//   Un compte créé en appelant directement le service d'authentification, avec la clé PUBLIQUE, échappait
//   à tout ce que vérifiaient les routes. `handle_new_user` exige désormais une preuve HMAC que seul le
//   serveur sait signer. Ce qui peut rouvrir la porte en silence, et que ce contrôle garde :
//   A. LE CONTRAT : la chaîne signée par lib/inscription/preuve.mjs et celle que la base recalcule ont le
//      MÊME ordre de champs — et le vecteur du test pgTAP (inscription/porte.test.sql) se rejoue ici, en
//      Node : même chaîne, même HMAC. Deux constructions qui divergent refuseraient TOUTE inscription.
//   B. CHAQUE CRÉATION DE COMPTE SIGNE : aucun `auth.signUp` dans le navigateur ; tout fichier qui crée un
//      compte (signUpWithConfirmation, admin.createUser) appelle le signataire ET transmet les champs signés.
//   C. LE TRIGGER VÉRIFIE AVANT D'ÉCRIRE : la preuve, puis les règles, puis le miroir.
//   D. UNE RÈGLE, UNE DÉFINITION : aucune route ne relit les listes de domaines, la taxonomie ni le
//      référentiel du numéro pour JUGER une inscription — elle pose la question à la base.
//   E. LES CODES SONT STABLES : chaque code que la base peut rendre est dans CODES_REFUS, et inversement ;
//      chacun a son message (quatre langues : la parité est gardée par diag-parite-i18n).
//   F. L'ÉCHÉANCE EST COURTE : l'exception nommée de §D.27 ne dérive pas (≤ 15 minutes).
// CE QU'IL NE VOIT PAS, ET LE DIT : que le secret est POSÉ, ni qu'il est ÉGAL des deux côtés (Vault, Vercel)
//   — la requête de staging compte le secret par son nom ; l'égalité ne se voit qu'à la première inscription.
//
//   node scripts/diag-porte-inscription.mjs   → statique, aucun accès base.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHmac } from 'node:crypto'
import { rejouerMigrations } from './lib/schema-migrations.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const sansComTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')
let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const fichiers = (d, o = []) => {
  for (const e of readdirSync(join(ROOT, d))) {
    if (e === 'node_modules' || e.startsWith('.')) continue
    const p = `${d}/${e}`
    if (statSync(join(ROOT, p)).isDirectory()) fichiers(p, o); else if (/\.(tsx?|mjs)$/.test(e)) o.push(p)
  }
  return o
}

const preuve = await import(pathToFileURL(join(ROOT, 'lib/inscription/preuve.mjs')).href)
const fonctions = rejouerMigrations().fonctions
const corpsDe = (n) => fonctions.get(n)?.corps ?? ''

console.log('\n═══ La porte d’inscription : une preuve signée, vérifiée en base, une règle une fois ═══\n')

// ── A. LE CONTRAT TypeScript ↔ SQL ──
{
  const canon = corpsDe('preuve_inscription_canonique')
  const ordreSql = [...canon.matchAll(/coalesce\(p_meta ->> '(\w+)', ''\)/g)].map((m) => m[1])
  ok(canon !== '' && /'v1',\s*lower\(btrim\(coalesce\(p_email, ''\)\)\),/.test(canon)
     && JSON.stringify(ordreSql) === JSON.stringify([...preuve.CHAMPS_SIGNES]),
    `A. le même ordre des champs signés des deux côtés (${ordreSql.length} champs après l’adresse)`,
    `SQL : ${ordreSql.join(', ')} · TS : ${preuve.CHAMPS_SIGNES.join(', ')}`)
  const test = read('supabase/tests/database/inscription/porte.test.sql')
  const lit = (nom) => new RegExp(`${nom}\\s+\\w+\\s*:=\\s*E?'((?:[^']|'')*)'`).exec(test)?.[1]?.replace(/''/g, "'")
  const email = lit('v_vecteur_email')
  const meta = lit('v_vecteur_meta')
  const attendu = lit('v_vecteur_attendu')?.replace(/\\n/g, '\n')
  const hmac = lit('v_vecteur_hmac')
  ok(email && meta && attendu && hmac, 'A. le vecteur du test pgTAP est lisible (quatre littéraux)')
  if (email && meta && attendu && hmac) {
    ok(preuve.canoniquePreuve(email, JSON.parse(meta)) === attendu,
      'A. Node construit EXACTEMENT la chaîne que le test attend de la base')
    ok(createHmac('sha256', 'cle-de-vecteur').update(attendu, 'utf8').digest('hex') === hmac,
      'A. Node calcule EXACTEMENT le HMAC que le test attend de pgcrypto')
  }
  const signees = preuve.signerPreuveInscription('Sonde@Exemple.invalid', { role: 'expert' }, { secret: 'x'.repeat(40), maintenant: 0 })
  ok(signees.preuve_expire_a === String(preuve.ECHEANCE_PREUVE_SECONDES) && /^[0-9a-f]{64}$/.test(signees.preuve)
     && preuve.CHAMPS_SIGNES.every((k) => k in signees),
    'A. le signataire rend TOUS les champs signés, l’échéance et une preuve hexadécimale')
}

// ── B. CHAQUE CRÉATION DE COMPTE SIGNE ──
{
  const tous = [...fichiers('app'), ...fichiers('lib'), ...fichiers('components'), ...fichiers('scripts')]
    .filter((f) => !/^scripts\/diag-/.test(f))
  const navigateur = [...fichiers('app'), ...fichiers('components')].filter((f) => /\bauth\.signUp\(/.test(sansComTs(read(f))))
  ok(navigateur.length === 0, 'B. aucun `auth.signUp` dans le navigateur (app/, components/)', navigateur.join(', ') || undefined)
  const createurs = tous.filter((f) => f !== 'lib/auth-signup.ts'
    && /\bsignUpWithConfirmation\(|\badmin\.createUser\(|\bauth\.signUp\(/.test(sansComTs(read(f))))
  const sansPreuve = createurs.filter((f) => {
    const s = sansComTs(read(f))
    return !/\bsignerPreuveInscription\(/.test(s) || !/\.\.\.(signees|signerPreuveInscription\()/.test(s)
  })
  ok(createurs.length >= 5 && sansPreuve.length === 0,
    `B. chaque fichier qui crée un compte signe la preuve et la transmet (${createurs.length} : ${createurs.join(', ')})`,
    sansPreuve.length ? `sans preuve : ${sansPreuve.join(', ')}` : 'moins de cinq créateurs : le balayage a perdu un appelant')
  const signup = sansComTs(read('lib/auth-signup.ts'))
  ok((signup.match(/\bauth\.signUp\(/g) ?? []).length === 1, 'B. un seul `auth.signUp`, dans lib/auth-signup.ts (le seul qui envoie l’e-mail de confirmation)')
}

// ── C. LE TRIGGER VÉRIFIE AVANT D'ÉCRIRE ──
{
  const t = corpsDe('handle_new_user')
  const iPreuve = t.indexOf('public.preuve_inscription_refus(new.email, v_meta)')
  const iRegles = t.indexOf('public.inscription_refus(new.email, v_meta)')
  const iEcrit = t.search(/insert into public\.users/)
  ok(iPreuve > 0 && iRegles > iPreuve && iEcrit > iRegles,
    'C. handle_new_user : la preuve, PUIS les règles, PUIS la première écriture')
  ok(/when 'preuve_absente' then 'IN007'/.test(t) && /when 'preuve_expiree' then 'IN009'/.test(t)
     && /when 'secret_absent'\s+then 'IN011'/.test(t) && /else 'IN008' end;/.test(t),
    'C. un code par défaut de la preuve : absente IN007, altérée IN008, expirée IN009, secret absent IN011')
  const v = corpsDe('preuve_inscription_refus')
  ok(/v_attendue := public\.preuve_inscription_signature\(v_canonique, false\)/.test(v)
     && /public\.preuve_inscription_signature\(v_canonique, true\)/.test(v)
     && v.indexOf("return 'preuve_invalide'") < v.indexOf("return 'preuve_expiree'"),
    'C. la signature est vérifiée (secret courant, puis précédent) AVANT l’échéance, qui est signée')
}

// ── D. UNE RÈGLE, UNE DÉFINITION ──
{
  const inscriptions = ['app/api/auth/public/register-expert/route.ts', 'app/api/auth/register-org/route.ts',
    'app/api/invitations/inscription/route.ts', 'app/api/admin/create-admin/route.ts']
  const jugent = inscriptions.filter((f) => /blocked_email_domains|public_email_domains|taxonomie_inscription_refus|numeroIdentificationAccepte|\.from\('countries'\)/
    .test(sansComTs(read(f))))
  ok(jugent.length === 0, 'D. aucune route de création de compte ne juge elle-même (domaines, taxonomie, numéro, pays)',
    jugent.join(', ') || undefined)
  const posent = inscriptions.filter((f) => /refusInscription\(/.test(sansComTs(read(f))))
  ok(posent.length === inscriptions.length, 'D. chacune pose la question à la base (inscription_refus) AVANT de créer',
    inscriptions.filter((f) => !posent.includes(f)).join(', ') || undefined)
  const regles = corpsDe('inscription_refus')
  ok(/public\.taxonomie_inscription_refus\(/.test(regles) && /public\.numero_identification_refus\(/.test(regles)
     && /from public\.blocked_email_domains/.test(regles) && /from public\.public_email_domains/.test(regles),
    'D. la règle en base porte la taxonomie, le numéro selon le pays, les domaines bloqués et publics')
}

// ── E. LES CODES SONT STABLES ──
{
  const ts = read('lib/inscription/refus.ts')
  const bloc = /export const CODES_REFUS = \[([\s\S]*?)\] as const/.exec(ts)?.[1] ?? ''
  const codesTs = new Set([...bloc.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
  const codesSql = new Set()
  for (const n of ['inscription_refus', 'preuve_inscription_refus', 'taxonomie_inscription_refus']) {
    for (const m of corpsDe(n).matchAll(/(?:return|then)\s+'([a-z_]+)'/g)) codesSql.add(m[1])
  }
  const t = corpsDe('handle_new_user')
  for (const m of t.matchAll(/inscription refusee : ([a-z_]+)'/g)) codesSql.add(m[1])
  for (const m of t.matchAll(/(?:then|else)\s+'([a-z_]+)'/g)) if (!/^IN\d|^AD\d/.test(m[1])) codesSql.add(m[1])
  // Les issues d'accepter_invitation que le trigger TRADUIT ne sont pas des codes d'inscription.
  for (const interne of ['expired', 'email_mismatch', 'systeme', 'administrateur', 'utilisateur', 'admin', 'active', 'draft',
    'expert_freelance', 'expert_cdi', 'freelance', 'cdi', 'client', 'cabinet']) codesSql.delete(interne)
  const horsTs = [...codesSql].filter((c) => !codesTs.has(c)).sort()
  const morts = [...codesTs].filter((c) => !codesSql.has(c)).sort()
  ok(codesSql.size >= 30 && horsTs.length === 0, `E. chaque code rendu par la base est dans CODES_REFUS (${codesSql.size})`,
    horsTs.length ? `inconnus du TypeScript : ${horsTs.join(', ')}` : 'moins de trente codes lus : le balayage a perdu des fonctions')
  ok(morts.length === 0, `E. aucun code de CODES_REFUS que la base ne rende pas (${codesTs.size})`, morts.join(', ') || undefined)
  const fr = JSON.parse(read('messages/fr.json')).inscription_refus ?? {}
  const sansMessage = [...codesTs, 'inscription_indisponible'].filter((c) => typeof fr[c] !== 'string' || fr[c].trim() === '')
  ok(sansMessage.length === 0, 'E. chaque code a son message (inscription_refus.*, quatre langues par la parité)', sansMessage.join(', ') || undefined)
}

// ── F. L'ÉCHÉANCE EST COURTE ──
ok(Number.isInteger(preuve.ECHEANCE_PREUVE_SECONDES) && preuve.ECHEANCE_PREUVE_SECONDES > 0 && preuve.ECHEANCE_PREUVE_SECONDES <= 900,
  `F. l’échéance de la preuve est courte (${preuve.ECHEANCE_PREUVE_SECONDES} s ≤ 15 min) — exception nommée de §D.27`)

console.log(failures === 0
  ? '\n✅ La porte est fermée en base : preuve signée, vérifiée avant toute écriture, une règle une fois, des codes stables.'
  : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC — la porte d’inscription peut se rouvrir, ou refuser tout le monde`)
process.exit(failures === 0 ? 0 : 1)
