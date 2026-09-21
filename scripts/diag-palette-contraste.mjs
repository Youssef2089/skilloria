#!/usr/bin/env node
// scripts/diag-palette-contraste.mjs
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ LA GARDE DE CONTRASTE REFUSE, ET ELLE REFUSE AU SERVEUR.                 ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Trois propriétés, et chacune a coûté quelque chose à quelqu'un :
//
// ① LA GARDE EST POSÉE AVANT L'ÉCRITURE. Une garde qui s'exécute après le
//    premier `.update(` a déjà laissé passer ce qu'elle refuse. C'est la règle
//    de §E.27 : *la garde se pose avant, jamais après.*
//
// ② ELLE VÉRIFIE LA PALETTE FUSIONNÉE, pas les valeurs reçues. Le rôle
//    « boutons » est DÉRIVÉ par défaut — donc personne ne le choisit, donc
//    personne ne le regarde. Vérifier les seules valeurs envoyées le laisserait
//    hors de la garde, précisément lui.
//
// ③ LE REFUS NOMME LA PAIRE FAUTIVE. Un refus qui ne nomme rien envoie
//    chercher au hasard (règle des refus actionnables du dépôt).
//
// ET UNE QUATRIÈME, QUI EST UN CLIQUET : les valeurs de référence de
// `lib/palette.ts` sont celles MESURÉES sur l'accueil le 21/09/2026. Elles ne
// changent pas par accident. Si Youssef les change, ce contrôle rougit et il
// faut venir écrire ici pourquoi — c'est le but.
//
// Ce contrôle est ANCRÉ SUR LES PROPRIÉTÉS, pas sur des noms de fichiers : il
// balaie `app/api/admin` pour trouver la route qui écrit la palette, plutôt que
// d'en ouvrir une par son chemin (§E.34).
//
// Trois codes de sortie : 0 vert · 1 rouge · 2 n'a pas tourné.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n')

function sansCommentaires(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(Math.max(0, m.length - p1.length)))
}

function fichiers(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) fichiers(p, acc)
    else if (/\.(ts|tsx)$/.test(e)) acc.push(p)
  }
  return acc
}

/** LA RÉFÉRENCE, MESURÉE SUR L'ACCUEIL LE 21/09/2026 (docs/audit-couleurs.html). */
const REFERENCE_ATTENDUE = {
  fond_page: '#FDFBF7',
  bandeau: '#F6F2EA',
  cartes: '#FFFFFF',
  bordures: '#E7E2D8',
  texte_principal: '#1A1815',
  texte_secondaire: '#6B655C',
  marque: '#0EA5E9',
}

/** Les sept paires que la garde DOIT couvrir. Les bordures n'en sont pas. */
const PAIRES_ATTENDUES = [
  'principal_sur_fond',
  'principal_sur_cartes',
  'principal_sur_bandeau',
  'secondaire_sur_fond',
  'secondaire_sur_cartes',
  'secondaire_sur_bandeau',
  'libelle_sur_boutons',
]

const echecs = []
const ok = []
const dire = (cond, phrase, detail = '') => {
  if (cond) ok.push(phrase)
  else echecs.push(phrase + (detail ? `\n       ${detail}` : ''))
}

try {
  /* ── La source ────────────────────────────────────────────────────────── */
  const palette = sansCommentaires(lire(join(ROOT, 'lib/palette.ts')))

  for (const [role, valeur] of Object.entries(REFERENCE_ATTENDUE)) {
    const motif = new RegExp(`${role}:\\s*'${valeur}'`)
    dire(
      motif.test(palette),
      `la référence garde sa valeur mesurée pour « ${role} » (${valeur})`,
      `attendu \`${role}: '${valeur}'\` dans PALETTE_REFERENCE. Si c'est un changement VOULU, `
      + 'venez le dire ici : la référence est ce que l\'audit a mesuré sur l\'accueil.',
    )
  }

  for (const cle of PAIRES_ATTENDUES) {
    dire(
      palette.includes(`cle: '${cle}'`),
      `la garde couvre la paire « ${cle} »`,
      'PAIRES_VERIFIEES a perdu une paire : une surface cesse d\'être vérifiée sans que rien ne le dise.',
    )
  }

  dire(
    !/cle:\s*'[^']*bordur/.test(palette),
    'les BORDURES restent hors de la garde, à dessein',
    'La bordure de référence vaut 1,25 contre le fond de page : la garder ferait rougir la palette '
    + "de l'accueil elle-même dès le premier jour (§E.14).",
  )

  dire(
    /MINIMUM_LISIBILITE\s*=\s*4\.5/.test(palette),
    'le minimum de lisibilité est celui du texte courant (4,5)',
  )

  /* ── La route ─────────────────────────────────────────────────────────── */
  // On CHERCHE la route qui écrit la palette, on ne l'ouvre pas par son chemin.
  const routes = fichiers(join(ROOT, 'app/api/admin')).filter((p) => {
    const s = sansCommentaires(lire(p))
    return s.includes('COLONNE_PAR_ROLE') && s.includes("from('domain_configs')")
  })

  dire(
    routes.length === 1,
    `une seule route écrit la palette (${routes.length} trouvée(s))`,
    'Deux routes qui écrivent la même chose finissent par ne pas appliquer la même garde (§E.36). '
    + 'Zéro route : la palette ne se règle plus depuis nulle part.',
  )

  if (routes.length === 1) {
    const rel = relative(ROOT, routes[0]).split(sep).join('/')
    const src = sansCommentaires(lire(routes[0]))

    const iGarde = src.indexOf('verifierContraste(')
    const iEcriture = src.search(/\.update\(/)

    dire(iGarde !== -1, `${rel} appelle la garde de contraste`)
    dire(
      iGarde !== -1 && iEcriture !== -1 && iGarde < iEcriture,
      'la garde est posée AVANT la première écriture',
      "Une garde qui s'exécute après le premier `.update(` a déjà laissé passer ce qu'elle refuse (§E.27).",
    )

    // ② La garde porte sur la palette FUSIONNÉE : l'existant, étalé, puis les
    //    modifications. C'est la seule façon d'inclure le bouton dérivé.
    // ⚠️ La fenêtre traverse une ACCOLADE INTERNE : l'existant s'écrit
    //    `...(configActuelle ?? {})`. Un `[^}]*` s'y arrêtait et déclarait
    //    fautif un code juste — la première version de ce contrôle a rougi
    //    dessus. On borne en LONGUEUR, pas en caractères interdits (§E.8).
    dire(
      /resolvePalette\([\s\S]{0,90}\.\.\.configUpdates\s*\}\s*\)/.test(src),
      'la garde porte sur la palette FUSIONNÉE (existant + modifications)',
      'Vérifier les seules valeurs reçues laisse le rôle « boutons » hors de la garde quand il est '
      + "dérivé — précisément celui que personne ne choisit, donc que personne ne regarde.",
    )

    dire(
      /code:\s*'contraste_insuffisant'/.test(src),
      'le refus porte un code nommé',
    )
    dire(
      /echecs:\s*verdict\.echecs/.test(src),
      'le refus rend LA PAIRE FAUTIVE, pas seulement un non',
      'Un refus qui ne nomme rien envoie chercher au hasard.',
    )
    dire(
      /minimum:\s*MINIMUM_LISIBILITE/.test(src),
      'le refus rend le MINIMUM, pour qu\'on sache de combien on est loin',
    )

    // La lecture de la configuration ne doit pas se confondre avec son absence :
    // sinon la garde s'appliquerait à une palette vide, donc à la référence,
    // donc elle passerait. Une garde qui s'ouvre sur une panne est le pire cas.
    dire(
      /cfgErr[\s\S]{0,220}?503/.test(src),
      "une lecture en panne REFUSE en 503, elle ne se confond pas avec une absence",
      '§E.22 : `null` de panne et `null` d\'absence ont la même forme et jamais le même sens. '
      + 'Ici, les confondre ferait vérifier une palette vide — donc la référence — donc passer.',
    )
  }

  /* ── L'écran ──────────────────────────────────────────────────────────── */
  const ecrans = fichiers(join(ROOT, 'components')).filter((p) =>
    sansCommentaires(lire(p)).includes('verifierContraste('),
  )
  dire(
    ecrans.length >= 1,
    `l'écran calcule le même verdict pour le dire tout de suite (${ecrans.length} écran(s))`,
    "Sans aperçu, on découvre le refus après un aller-retour — mais c'est bien la ROUTE qui refuse.",
  )

  /* ── Verdict ──────────────────────────────────────────────────────────── */
  console.log('── LA GARDE DE CONTRASTE ───────────────────────────────────────')
  for (const p of ok) console.log(`   ✔ ${p}`)
  if (echecs.length) {
    console.log('')
    for (const p of echecs) console.log(`   ❌ ${p}`)
  }

  console.log('\n── CE QUE CE CONTRÔLE NE VÉRIFIE PAS (§E.38) ───────────────────')
  console.log('   · que les RATIOS calculés soient justes. Il lit la source, il')
  console.log("     n'exécute pas WCAG : `lib/palette.ts` importe `./couleur` sans")
  console.log('     extension, et un module TypeScript ne se charge pas tel quel en')
  console.log("     Node nu. Les ratios ont été mesurés à la main et sont dans")
  console.log('     docs/audit-couleurs.html, avec leur date.')
  console.log("   · ce qui se passe si un écosystème pose sa palette EN BASE, hors")
  console.log("     de l'écran. Le CHECK de forme tient, le contraste non : c'est")
  console.log('     une écriture manuelle, et §E.10 dit déjà ce qu\'elle vaut.')

  if (echecs.length) {
    console.log('\n🔴 ROUGE')
    process.exit(1)
  }
  console.log('\n🟢 VERT')
  process.exit(0)
} catch (err) {
  console.error("Le contrôle n'a pas tourné :", err?.message ?? err)
  process.exit(2)
}
