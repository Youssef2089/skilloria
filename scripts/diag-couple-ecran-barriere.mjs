#!/usr/bin/env node
/**
 * DEUX GARDES QUI TOMBENT SUR LA MÊME PANNE N'EN FONT QU'UNE.
 *
 * ┌─ LE CAS SOURCE, ET IL EST LA PIRE PRISE DU SPRINT ──────────────────────┐
 * │ `/admin/get-branch` comptait les usages d'une branche pour les MONTRER,  │
 * │ `/admin/delete-branch` les recomptait pour AUTORISER, et l'écran de      │
 * │ taxonomie les resommait pour ACTIVER LE BOUTON. Six lectures, aucune     │
 * │ erreur récupérée, toutes en `count ?? 0`.                                │
 * │                                                                          │
 * │ UNE SEULE PANNE RENDAIT LES TROIS AVEUGLES DU MÊME ZÉRO. L'écran disait  │
 * │ « 0 usage », l'administrateur supprimait en croyant décider en           │
 * │ connaissance de cause, le bouton était actif, et la barrière ne se       │
 * │ levait pas parce qu'elle lisait ce zéro.                                 │
 * │ **L'humain croyait décider ; la machine croyait qu'il avait décidé.**     │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ CE QUE LE SCHÉMA RATTRAPE, ET CE QU'IL NE RATTRAPE PAS ═════════════
 *   · `profiles.branch_id`       RESTRICT  ✅
 *   · `profile_alerts.branch_id` RESTRICT  ✅
 *   · `publications.branch_id`   SET NULL  ❌ les annonces perdent leur branche
 *   · `specialities.branch_id`   CASCADE   ❌ elles sont supprimées avec elle
 *   Un tiers de protection n'est pas une protection : une branche sans profil
 *   était effaçable par une panne de lecture, sur le référentiel du produit.
 *
 * ═══ LA RÈGLE GÉNÉRALE, À CHERCHER PARTOUT ══════════════════════════════
 *   Partout où un ÉCRAN précède une ACTION DESTRUCTRICE, les deux doivent lire
 *   la MÊME chose, par le MÊME code. Deux lectures séparées du même fait ne
 *   font pas deux gardes : elles font une garde et une illusion.
 *
 * ⚠️ §E.7 — commentaires retirés avant détection : ce lot cite `count ?? 0`
 *    partout pour expliquer ce qu'il ferme.
 *
 * SANS BASE, SANS RÉSEAU. 0 = vert · 1 = rouge.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** §E.3 — le dépôt sort en CRLF. */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const exists = (p) => existsSync(join(ROOT, p))
const sansCommentaires = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l))
    .join('\n')

let echecs = 0
const ok = (cond, libelle, pourquoi) => {
  if (cond) console.log(`  ok   ${libelle}`)
  else {
    echecs++
    console.log(`  KO   ${libelle}`)
    if (pourquoi) console.log(`       → ${pourquoi}`)
  }
}
const section = (t) => console.log(`\n═══ ${t} ═══\n`)

const MODULE = 'lib/admin/usage-branche.ts'
const BARRIERE = 'app/api/admin/delete-branch/route.ts'
const ECRAN_ROUTE = 'app/api/admin/get-branch/[id]/route.ts'
const ECRAN = 'app/[locale]/admin/taxonomie/[id]/page.tsx'

// ═════════════════════════════════════════════════════════════════════════════
section('A. UNE SEULE LECTURE, PARTAGÉE — c’est ça qui empêche la divergence')
// ═════════════════════════════════════════════════════════════════════════════
{
  ok(exists(MODULE), `${MODULE} existe`)
  const m = exists(MODULE) ? sansCommentaires(read(MODULE)) : ''

  ok(
    /\|\s*\{\s*etat:\s*'indisponible'\s*\}/.test(m),
    'le type porte l’état « indisponible »',
    'sans état nommé, une panne redevient indistinguable de « rien à perdre »',
  )
  // Les trois comptes n'existent QUE dans la branche « disponible » : il n'y a
  // aucun moyen d'écrire `count ?? 0` chez un appelant.
  ok(
    /etat:\s*'disponible'[\s\S]{0,200}?profils:\s*number[\s\S]{0,120}?publications:\s*number[\s\S]{0,120}?specialites:\s*number/.test(m),
    'les trois comptes n’existent QUE dans la branche « disponible »',
    'hors de l’union, on pourrait les lire sans avoir traité la panne',
  )
  // UNE SEULE erreur suffit : rendre deux comptes sur trois donnerait une somme
  // qui a l'air d'un fait et n'en est pas un.
  ok(
    /if\s*\(\s*profilsRes\.error\s*\|\|\s*publicationsRes\.error\s*\|\|\s*specialitesRes\.error\s*\)/.test(m),
    'une SEULE des trois erreurs suffit à rendre « indisponible »',
    'deux comptes sur trois ne font pas un fait — et c’est sur ce total qu’on supprime',
  )
  ok(
    /export function brancheReferencee[\s\S]{0,300}?return null/.test(m),
    'le prédicat « est-elle référencée ? » vit UNE fois, et sait rendre `null`',
    'le prédicat qui MONTRE et celui qui AUTORISE doivent être le même — ils avaient divergé',
  )
}

// ═════════════════════════════════════════════════════════════════════════════
section('B. LES TROIS SURFACES LISENT LE MÊME CODE')
// ═════════════════════════════════════════════════════════════════════════════
//
//   C'est LA propriété du lot. Deux lectures séparées du même fait ne font pas
//   deux gardes : elles font une garde et une illusion.
{
  for (const [nom, f] of [
    ['la barrière', BARRIERE],
    ['la route d’écran', ECRAN_ROUTE],
  ]) {
    const src = exists(f) ? sansCommentaires(read(f)) : ''
    ok(
      /usageDeLaBranche\(/.test(src),
      `${nom} passe par le module partagé`,
      'une lecture propre à chaque surface, c’est la divergence qu’on vient de fermer',
    )
    // ET AUCUNE NE RECOMPTE POUR SON COMPTE.
    ok(
      !/\bcount:\s*\w+\s*\}\s*=\s*await[\s\S]{0,200}?branch_id/.test(src),
      `${nom} ne recompte rien pour son compte`,
      'un second comptage local rouvre la divergence en silence',
    )
  }
}

// ═════════════════════════════════════════════════════════════════════════════
section('C. NE PAS SAVOIR NE VAUT JAMAIS AUTORISER')
// ═════════════════════════════════════════════════════════════════════════════
{
  const b = exists(BARRIERE) ? sansCommentaires(read(BARRIERE)) : ''
  // §E.8 : ancré sur le bloc visé, et la condition doit être ARMÉE — `false &&`
  // l'a déjà traversée une fois dans ce dépôt.
  ok(
    /if\s*\(referencee === null\)\s*\{[\s\S]{0,300}?503/.test(b),
    'usage indisponible ⇒ la barrière REFUSE (503), elle n’autorise pas',
    'la suppression emporte les spécialités EN CASCADE : on ne la prend pas sur un comptage inconnu',
  )
  ok(
    /if\s*\(referencee\)\s*\{[\s\S]{0,400}?'in_use'/.test(b),
    'branche référencée ⇒ 409 `in_use`, inchangé',
  )
  const iRefus = b.indexOf('referencee === null')
  const iSuppr = b.indexOf(".from('branches').delete()")
  ok(
    iRefus > 0 && iSuppr > 0 && iRefus < iSuppr,
    'le refus est prononcé AVANT la suppression',
    'une barrière posée après la destruction ne barre rien (§E.8)',
  )
}

// ═════════════════════════════════════════════════════════════════════════════
section('D. L’ÉCRAN LE DIT, ET SON BOUTON S’ÉTEINT')
// ═════════════════════════════════════════════════════════════════════════════
{
  const r = exists(ECRAN_ROUTE) ? sansCommentaires(read(ECRAN_ROUTE)) : ''
  ok(
    /profiles:\s*usage\.etat === 'disponible' \? usage\.profils : null/.test(r),
    'la route rend `null`, jamais 0, quand elle ne sait pas',
    'zéro se lit « rien à perdre » au moment précis où l’on décide de couper',
  )
  ok(/usage_indisponible:/.test(r), 'et elle le DIT explicitement')

  const e = exists(ECRAN) ? sansCommentaires(read(ECRAN)) : ''
  ok(
    /const usageInconnu = branch\?\.usage_indisponible === true/.test(e),
    'l’écran lit cet état',
  )
  // ⚠️ ANCRÉ SUR LA FORME EXACTE : `false &&` ou un `?? 0` réintroduit désarme
  //    la garde sans la faire disparaître du fichier (lot 4.1b, mutation M18).
  ok(
    /canDeleteBranch\s*=\s*\n?\s*!isNew && !usageInconnu &&/.test(e),
    'le bouton de suppression s’éteint quand l’usage est inconnu',
    'sans lui, la troisième garde retombe sur le même zéro que les deux autres',
  )
  ok(
    /usage_unavailable_warning/.test(e) && /err_usage_unavailable/.test(e),
    'et l’écran DIT pourquoi — à l’affichage comme au refus',
    'un bouton éteint sans phrase est un écran mort',
  )
}

// ═════════════════════════════════════════════════════════════════════════════
section('E. Ce que ce contrôle NE vérifie PAS')
// ═════════════════════════════════════════════════════════════════════════════
console.log(`  note il garde UN couple, celui de la branche. La règle est générale —
  note partout où un écran précède une action destructrice — mais rien ici ne
  note DÉCOUVRE les autres couples : ils se cherchent à la lecture.
  note
  note il lit du texte, pas un comportement : il ne prouve pas qu'une panne
  note réelle produit le bon écran. Seul un rejeu avec une base le prouverait.`)

console.log('')
if (echecs > 0) {
  console.log(`✘ ${echecs} CONTRÔLE(S) EN ÉCHEC`)
  process.exit(1)
}
console.log('✅ L’écran et la barrière ne peuvent plus tomber ensemble.')
