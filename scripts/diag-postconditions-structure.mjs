#!/usr/bin/env node
// scripts/diag-postconditions-structure.mjs — UNE POSTCONDITION VÉRIFIE LA STRUCTURE ; AUCUNE SONDE NE
// TOUCHE UNE DONNÉE RÉELLE ; CHAQUE LIGNE DE FIN RENVOIE À SA PREUVE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI IL EXISTE (lot S, 28/09/2026, §E.77)
//   Le `db push` de staging s'est ARRÊTÉ à mi-chemin : la postcondition de
//   journal_annonce_publiee a pris un VRAI brouillon, sans zone de travail, et
//   tenté de le publier (23514). La base avait raison ; la sonde, tort. Et en
//   production, ces sondes auraient touché les lignes de vraies personnes.
//   Décision de Youssef : les sondes sur données réelles sortent des migrations ;
//   le comportement se prouve par les tests pgTAP sur données fabriquées.
//
// LA PROPRIÉTÉ, pour toute migration POSTÉRIEURE à l'héritage (les migrations déjà
// appliquées sur staging au 28/09/2026 sont GELÉES — on ne les touche plus) :
//   A. une postcondition (`do $post$`) ne LIT aucune table MÉTIER — une table
//      qu'aucune migration ne sème (dérivé, pas une liste) — sauf exception écrite ;
//   B. elle n'ÉCRIT directement aucune table publique ;
//   C. chacune de ses lignes de fin (« postcondition tenue » / « PARTIELLE ») renvoie
//      à sa PREUVE — un fichier du dépôt qui existe (un test, un module, un contrôle).
// CE QU'IL NE VOIT PAS, ET LE DIT : une RPC appelée sur un identifiant LU dans une table
//   référentielle (le contrôle voit la lecture, pas l'usage) ; le SQL dynamique.
//
//   node scripts/diag-postconditions-structure.mjs   → statique, aucun accès base.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rejouerMigrations } from './lib/schema-migrations.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOSSIER = join(ROOT, 'supabase', 'migrations')
let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const lire = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const sansCommentaires = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

// L'HÉRITAGE, résolu par SUFFIXE (§G.3) : la dernière migration appliquée sur staging au 28/09/2026,
// lue dans `supabase migration list`. Tout ce qui la suit obéit à la règle.
const SUFFIXE_HERITAGE = '_journal_recherche_abandonnee.sql'

/** Lectures de table métier DÉCLARÉES légitimes (§G.8) : « migration:table » → raison. */
const EXCEPTIONS = {
  'inscription_specialites:users': 'LÉGITIME — relit le miroir du compte que la sonde vient de FABRIQUER (id = v_id, gen_random_uuid()), dans un bloc annulé',
  'inscription_specialites:profiles': 'LÉGITIME — relit le profil du compte que la sonde vient de FABRIQUER, dans un bloc annulé',
}

const toutes = readdirSync(DOSSIER).filter((f) => f.endsWith('.sql')).sort()
const heritage = toutes.filter((f) => f.endsWith(SUFFIXE_HERITAGE))
if (heritage.length !== 1) { console.error(`✘ migration d'héritage introuvable ou ambiguë (${heritage.length})`); process.exit(2) }
const soumises = toutes.filter((f) => f > heritage[0])

// ── Les tables RÉFÉRENTIELLES, dérivées : semées par des littéraux, ou recopiées d'un autre référentiel ──
const { schema } = rejouerMigrations()
const inserts = []
for (const f of toutes) {
  let s = sansCommentaires(lire(join(DOSSIER, f)))
  s = s.replace(/do\s+\$post\$[\s\S]*?\$post\$/g, '')
  s = s.replace(/create\s+(?:or\s+replace\s+)?function[\s\S]*?\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/gi, '')
  for (const m of s.matchAll(/insert\s+into\s+"?public"?\."?([a-z_0-9]+)"?[^;]*?;/gi)) {
    const table = m[1].toLowerCase()
    // Une insertion ne dépend pas de sa propre table : `where not exists (select 1 from public.packages …)`
    // est une garde d'idempotence, pas une source.
    const source = [...m[0].matchAll(/\b(?:from|join)\s+(?:only\s+)?"?public"?\."?([a-z_0-9]+)/gi)].map((x) => x[1].toLowerCase()).filter((t) => t !== table)
    inserts.push({ table, source })
  }
}
const referentiel = new Set()
for (let change = true; change; ) {
  change = false
  for (const i of inserts) {
    if (referentiel.has(i.table)) continue
    if (i.source.every((t) => referentiel.has(t))) { referentiel.add(i.table); change = true }
  }
}
const metier = new Set([...schema.keys()].filter((t) => !t.startsWith('_backup') && !referentiel.has(t)))

console.log(`\n═══ Postconditions : la structure ici, le comportement par les tests — ${soumises.length} migrations soumises ═══\n`)
ok(metier.has('users') && metier.has('publications') && metier.has('candidatures') && metier.has('notification_preferences')
   && referentiel.has('domains') && referentiel.has('grand_livre_actions') && referentiel.has('packages'),
   `le partage est dérivé : ${referentiel.size} tables référentielles, ${metier.size} tables métier (témoins placés)`,
   `référentiel : ${[...referentiel].sort().join(', ')}`)

const lectures = []
const ecritures = []
const sansRenvoi = []
const preuvesRetirees = []
const exceptionsVues = new Set()
for (const f of soumises) {
  const s = sansCommentaires(lire(join(DOSSIER, f)))
  const nom = f.replace(/^\d+_/, '').replace(/\.sql$/, '')
  for (const b of s.matchAll(/do\s+\$post\$([\s\S]*?)\$post\$/g)) {
    const c = b[1]
    for (const m of c.matchAll(/\b(?:from|join)\s+(?:only\s+)?"?public"?\."?([a-z_0-9]+)/gi)) {
      const t = m[1].toLowerCase()
      if (!metier.has(t)) continue
      const cle = `${nom}:${t}`
      if (cle in EXCEPTIONS) { exceptionsVues.add(cle); continue }
      lectures.push(`${f} lit ${t}`)
    }
    for (const m of c.matchAll(/\b(?:update|insert\s+into|delete\s+from)\s+(?:only\s+)?"?public"?\."?([a-z_0-9]+)/gi)) {
      ecritures.push(`${f} écrit ${m[1]}`)
    }
    for (const m of c.matchAll(/raise notice 'postcondition (?:tenue|PARTIELLE)[^']*'/g)) {
      const refs = [...m[0].matchAll(/((?:tests\/database\/|scripts\/|lib\/|app\/)[A-Za-z0-9_\-/.[\]]+\.(?:sql|mjs|ts|tsx))/g)].map((x) => x[1])
      const existe = refs.some((r) => existsSync(join(ROOT, r.startsWith('tests/') ? `supabase/${r}` : r)))
      // UNE PREUVE PART AVEC CE QU'ELLE PROUVAIT (recette staging, 30/09/2026) : une migration APPLIQUÉE ne se
      // réécrit pas, et sa ligne de fin nomme le test de sa fonction. Si CHAQUE fonction qu'elle a créée est
      // supprimée par une migration ultérieure (§E.72, étape 3), ce test n'a plus rien à prouver — dérivé, pas gelé.
      const creees = [...s.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(/gi)].map((x) => x[1].toLowerCase())
      const toutesRetirees = creees.length > 0 && creees.every((fn) =>
        toutes.some((g) => g > f && new RegExp(String.raw`drop\s+function\s+(?:if\s+exists\s+)?public\.` + fn + String.raw`\s*\(`, 'i').test(sansCommentaires(lire(join(DOSSIER, g))))))
      if (!existe && toutesRetirees) { preuvesRetirees.push(f); continue }
      if (!existe) sansRenvoi.push(`${f} : « ${m[0].slice(20, 90)}… »`)
    }
  }
}
ok(lectures.length === 0, 'A. aucune postcondition ne lit une table métier — aucune sonde ne touche une donnée réelle',
  lectures.length ? `${lectures.join(' · ')} — prouve le geste par un test sur données fabriquées (§E.77)` : undefined)
ok(ecritures.length === 0, 'B. aucune postcondition n’écrit directement une table publique',
  ecritures.length ? ecritures.join(' · ') : undefined)
ok(sansRenvoi.length === 0, 'C. chaque ligne de fin renvoie à sa preuve — un fichier du dépôt qui existe',
  sansRenvoi.length ? sansRenvoi.join('\n         ') : undefined)
if (preuvesRetirees.length) console.log(`  note preuve retirée avec sa fonction (supprimée depuis) : ${preuvesRetirees.join(', ')}`)
const perimees = Object.keys(EXCEPTIONS).filter((k) => !exceptionsVues.has(k))
ok(perimees.length === 0, 'chaque exception correspond encore à une lecture réelle (la liste ne peut que se vider)', perimees.join(' · ') || undefined)
ok(Object.values(EXCEPTIONS).every((r) => /^(LÉGITIME|DÉFAUT NOMMÉ) — /.test(r)), 'chaque exception dit LÉGITIME ou DÉFAUT NOMMÉ (§G.8)')

console.log(failures === 0
  ? `\n✅ ${soumises.length} migrations postérieures à l'héritage : la structure ici, le comportement par les tests, aucune donnée réelle touchée.`
  : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC — une postcondition touche une donnée réelle ou ne renvoie à aucune preuve`)
process.exit(failures === 0 ? 0 : 1)
