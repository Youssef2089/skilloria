// scripts/diag-logo-organisation.mjs — AUCUNE URL EXTERNE N'ATTEINT UN <img src>.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE CE CONTROLE DEFEND — ET CE N'EST PAS « LE LOGO PASSE PAR LE BUCKET »
//
//   Defendre le chemin du logo ne servirait a rien : le defaut n'etait pas le
//   logo, c'etait la CLASSE. Une adresse saisie par un utilisateur et servie
//   telle quelle a `<img src>` fait appeler un serveur tiers par le navigateur
//   de chaque personne qui voit l'ecran. Un mouchard, pose par une saisie de
//   formulaire, dans notre produit.
//
//   L'INVARIANT DEFENDU : aucune valeur de colonne portant une image
//   (`logo_url`, `favicon_url`, `photo_url`) n'atteint un `<img src>` sans
//   passer par un module qui la SIGNE ou la DERIVE. Un DIXIEME endroit ajoute
//   demain doit rougir.
//
//   ⚠️ CE QUI REND LE DEFAUT EXPLOITABLE, ET QUI EST TOUJOURS VRAI : il n'y a
//      AUCUNE CSP dans le depot. Le controle le verifie (§7) — non pour exiger
//      une CSP, qui est un autre lot, mais pour que la disparition de ce filet
//      ne soit jamais une surprise.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IL MORD DANS LES DEUX SENS
//   ECRITURE : une saisie d'URL reintroduite dans une whitelist → ROUGE.
//   LECTURE  : une colonne brute rebranchee sur un `<img src>` → ROUGE.
//   BUCKET   : `org-logos` qui rebascule en public → ROUGE.
//   GARDE    : le refus `not_org_admin` ou la policy admin qui saute → ROUGE.
//   CONTENU  : une signature binaire retiree → ROUGE.
//   ECRAN    : un `<img>` de ces surfaces sans repli sur echec → ROUGE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IL LIT LE CODE, PAS LA PROSE (§E.7)
//   Le SQL passe par `sqlCodeSeul` (retire les `--` ET les `comment on … is`),
//   le TypeScript par `sansCommentaires`. Ce fichier DECRIT l'anti-pattern
//   qu'il interdit : sans ce filtrage, il se declencherait sur lui-meme.
//
//   Balayage sur app/ ET lib/ ET components/ (§E.15) — les neuf surfaces du
//   logo vivent justement dans components/.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-logo-organisation.mjs
//
// AUCUN acces base, AUCUN reseau. Lecture seule du depot.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// Import RELATIF avec extension explicite (§E.3) : le script doit tourner
// depuis n'importe quel worktree, sans chargeur d'alias.
import { sqlCodeSeul } from './_sql-lecture.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Fins de ligne NORMALISEES (§E.3) : le depot sort en CRLF, et plusieurs
// motifs ci-dessous traversent un saut de ligne.
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

/** Retire commentaires de ligne, de bloc, et JSX `{/* … *\/}`. */
function sansCommentaires(src) {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const echecs = []
const oks = []
const ko = (quoi, detail) => echecs.push({ quoi, detail })
const ok = (quoi) => oks.push(quoi)

/** Tous les fichiers .ts/.tsx sous les dossiers donnes. */
function fichiersSources(dossiers) {
  const out = []
  const parcours = (rel) => {
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) return
    for (const e of readdirSync(abs)) {
      if (e === 'node_modules' || e === '.next') continue
      const relEnfant = rel + '/' + e
      const st = statSync(join(ROOT, relEnfant))
      if (st.isDirectory()) parcours(relEnfant)
      else if (/\.tsx?$/.test(e)) out.push(relEnfant)
    }
  }
  for (const d of dossiers) parcours(d)
  return out
}

const SOURCES = fichiersSources(['app', 'lib', 'components'])
if (SOURCES.length === 0) {
  console.error('Aucun fichier source trouve — le balayage ne verifie rien. Arret.')
  process.exit(2)
}

const MIGRATION = 'supabase/migrations/20260916300000_logo_organisation_bucket.sql'
const MODULE = 'lib/org-logo.ts'
const ROUTE_ORG = 'app/api/me/organisation/logo/route.ts'
const ROUTE_ORG_PATCH = 'app/api/me/organisation/route.ts'
const ROUTE_ECO = 'app/api/admin/ecosystemes/[id]/visuel/route.ts'
const ROUTE_ECO_PATCH = 'app/api/admin/ecosystemes/[id]/route.ts'

for (const f of [MIGRATION, MODULE, ROUTE_ORG, ROUTE_ECO]) {
  if (!existsSync(join(ROOT, f))) {
    console.error(`Fichier attendu absent : ${f}. Le controle ne peut rien verifier. Arret.`)
    process.exit(2)
  }
}

const sqlMigration = sqlCodeSeul(lire(MIGRATION))
const srcModule = sansCommentaires(lire(MODULE))

// ═══ 1. LA CLASSE : aucune colonne d'image brute ne sort vers un navigateur ══
//
// ⚠️ LE PREMIER JET DE CE CONTROLE ETAIT FAUX, ET LA LECON VAUT D'ETRE ECRITE.
//    Il refusait tout `<img src={X.photo_url}>`. Or `/admin/experts` recoit un
//    DTO dont le CHAMP s'appelle `photo_url` et dont la VALEUR est deja une URL
//    signee (la route appelle `signAvatarUrl`). Le controle rougissait sur un
//    NOM, pas sur un danger : trouve par execution, pas par relecture.
//
//    Ce qui compte n'est pas le nom du champ, c'est la PROVENANCE. D'ou deux
//    regles, chacune posee la ou la provenance est connue.

const COLONNES_IMAGE = ['logo_url', 'favicon_url', 'photo_url']

// ─── 1a. COTE SERVEUR : une route ne projette jamais la colonne brute ───────
//
// C'est ici que la valeur nait. Une projection `logo_url: quelquechose.logo_url`
// envoie au navigateur ce qui est ecrit en base — hier une adresse saisie,
// aujourd'hui un chemin. Les seules valeurs admises sont signees ou derivees.
{
  // ⚠️ LE MOTIF EST VOLONTAIREMENT ETROIT, et c'est un choix mesure.
  //    Une premiere version capturait « la cle, puis tout jusqu'a la virgule ».
  //    Elle coupait les ternaires multi-lignes en plein milieu — ne gardant que
  //    la CONDITION (`inDeletion || !policy.reveal_photo || …`) alors que la
  //    valeur signee vivait deux lignes plus bas — et elle attrapait des
  //    fragments de requetes SQL (`photo_url: coalesce(prof.photo_url`).
  //    Trois faux positifs sur six.
  //
  //    Ce qu'on vise est PRECIS : la projection NUE d'une colonne, c'est-a-dire
  //    `cle: X.colonne` et rien d'autre. Un ternaire, un appel, une
  //    concatenation passent — parce qu'ils ne PEUVENT pas etre la colonne
  //    brute servie telle quelle, qui est le seul danger.
  const fautes = []
  for (const f of SOURCES.filter((p) => p.startsWith('app/api/'))) {
    const src = sansCommentaires(lire(f))
    for (const cle of [...COLONNES_IMAGE, 'avatar_url']) {
      const motif = new RegExp(
        `\\b${cle}\\s*:\\s*(\\w+\\??\\.(?:${COLONNES_IMAGE.join('|')})(?:\\s*\\?\\?\\s*null)?)\\s*[,}\\n]`,
        'g',
      )
      for (const m of src.matchAll(motif)) {
        fautes.push(`${f} — ${cle}: ${m[1].trim()}`)
      }
    }
  }
  if (fautes.length > 0) {
    ko(
      'Une route projette une colonne d\'image BRUTE vers le navigateur',
      fautes.join(' · ') +
        ' — servez une URL SIGNEE (signOrgLogoUrl / signOrgLogoUrls / signAvatarUrl) ou ' +
        'DERIVEE (urlPubliqueEcosysteme). Une colonne brute est un chemin, et c\'etait hier ' +
        'une adresse saisie par un utilisateur.',
    )
  } else {
    ok('Aucune route ne projette une colonne d\'image brute (app/api/**)')
  }
}

// ─── 1b. COTE CLIENT : un ecran ne fabrique jamais une adresse d'image ──────
//
// Un fichier qui lit la base EN CLIENT-DIRECT (`supabase.from(…)`) tient la
// colonne brute entre les mains. La poser dans un `<img src>` est le defaut
// exact qu'on ferme : le client n'a pas le service-role, il ne peut pas signer,
// donc il doit demander l'adresse a une route (meme discipline que §E.15).
{
  const fautes = []
  for (const f of SOURCES) {
    const src = sansCommentaires(lire(f))
    const litEnDirect = /supabase\s*\n?\s*\.from\s*\(|\bsupabase\.from\s*\(/.test(src)
    if (!litEnDirect) continue
    for (const m of src.matchAll(/<img\b([^>]*)>/g)) {
      const srcAttr = /src\s*=\s*\{([^}]*)\}/.exec(m[1])
      if (!srcAttr) continue
      const colonne = COLONNES_IMAGE.find((c) => new RegExp(`\\.\\s*${c}\\b`).test(srcAttr[1]))
      if (colonne) fautes.push(`${f} — src={${srcAttr[1].trim().slice(0, 50)}}`)
    }
  }
  if (fautes.length > 0) {
    ko(
      'Un ecran en lecture CLIENT-DIRECT pose une colonne d\'image dans <img src>',
      fautes.join(' · ') +
        ' — un client ne peut pas signer : demandez l\'adresse a une route.',
    )
  } else {
    ok('Aucun ecran en lecture client-directe ne fabrique d\'adresse d\'image')
  }
}

// ═══ 2. LA CLASSE, SECOND VOLET : tout <img> a un repli sur ECHEC ═══════════
//
// `src` absent et `src` qui ECHOUE sont deux choses. Sans `onError`, une
// adresse morte donne l'icone d'image cassee du navigateur — un ecran mort.
// Le cas est STRUCTUREL depuis les URL signees : elles vivent 300 s.
//
// On n'exige `onError` que sur les `<img>` dont la source est DYNAMIQUE : une
// image d'habillage en dur (`src="/x.svg"`) ne peut pas expirer.
{
  const sansRepli = []
  for (const f of SOURCES) {
    const src = sansCommentaires(lire(f))
    for (const m of src.matchAll(/<img\b([^>]*)>/g)) {
      const attrs = m[1]
      if (!/src\s*=\s*\{/.test(attrs)) continue // source statique : rien a expirer
      if (/onError\s*=/.test(attrs)) continue
      sansRepli.push(`${f} — src={${(/src\s*=\s*\{([^}]*)\}/.exec(attrs)?.[1] ?? '?').trim().slice(0, 50)}}`)
    }
  }
  if (sansRepli.length > 0) {
    ko(
      'Un <img> a source dynamique n\'a pas de repli sur echec',
      sansRepli.join(' · ') +
        ' — une URL signee expire (300 s) : sans onError, l\'ecran montre l\'icone d\'image cassee.',
    )
  } else {
    ok('Tout <img> a source dynamique a un repli sur echec (onError)')
  }
}

// ═══ 3. LA SAISIE D'URL NE REVIENT PAS ══════════════════════════════════════
//
// Deux chemins pour la meme donnee divergent un jour. On exige que les colonnes
// d'image soient ABSENTES des whitelists d'edition.
{
  const patch = sansCommentaires(lire(ROUTE_ORG_PATCH))
  const whitelist = /EDITABLE_FIELDS\s*=\s*\[([\s\S]*?)\]/.exec(patch)
  if (!whitelist) {
    ko('Whitelist introuvable', `${ROUTE_ORG_PATCH} — EDITABLE_FIELDS n'a pas ete trouvee : ` +
      'le controle ne peut pas verifier que logo_url en est absente.')
  } else if (/logo_url/.test(whitelist[1])) {
    ko(
      'La saisie d\'URL du logo est revenue',
      `${ROUTE_ORG_PATCH} — « logo_url » est de nouveau dans EDITABLE_FIELDS. Le logo se ` +
        'televerse (POST /api/me/organisation/logo) ; une seconde voie d\'ecriture divergera.',
    )
  } else {
    ok('logo_url reste hors de la whitelist d\'edition de l\'organisation')
  }

  const patchEco = sansCommentaires(lire(ROUTE_ECO_PATCH))
  // ANCRE sur le bloc d'ecriture (§E.8), pas une regex lachee sur tout le
  // fichier : le nom de la colonne apparait legitimement ailleurs.
  const ecrituresEco = [...patchEco.matchAll(/configUpdates\s*\[\s*k\s*\]|configUpdates\.(\w+)\s*=/g)]
  const boucleInterdite = /for\s*\(\s*const\s+k\s+of\s*\[[^\]]*['"](logo_url|favicon_url)['"]/.test(patchEco)
  if (boucleInterdite) {
    ko(
      'La saisie d\'URL des visuels d\'ecosysteme est revenue',
      `${ROUTE_ECO_PATCH} — logo_url/favicon_url sont de nouveau ecrites depuis le corps de ` +
        'la requete. Elles se televersent (POST …/visuel).',
    )
  } else {
    ok(`Les visuels d'ecosysteme restent hors de l'edition par URL (${ecrituresEco.length} ecriture(s) de config analysee(s))`)
  }
}

// ═══ 4. LES BUCKETS, ET LEUR ETAT ATTENDU ═══════════════════════════════════
//
// Un bucket qui rebascule en public doit ROUGIR. `ecosysteme` est public
// DELIBEREMENT (pages publiques et cachees : une URL signee y serait morte) —
// l'etat attendu est donc une TABLE, pas « tout doit etre prive ».
//
// Un bucket INCONNU rougit aussi : on force la decision au lieu de la subir.
{
  const ATTENDU = {
    cv: false,
    avatars: false,
    'org-logos': false,
    ecosysteme: true, // PUBLIC assume — cf. BUCKET_ECOSYSTEME dans lib/org-logo.ts
  }

  const dossierMigrations = join(ROOT, 'supabase/migrations')
  const declares = new Map()
  for (const f of readdirSync(dossierMigrations).filter((x) => x.endsWith('.sql')).sort()) {
    const code = sqlCodeSeul(lire('supabase/migrations/' + f))
    for (const m of code.matchAll(
      /insert\s+into\s+storage\.buckets[^;]*?values\s*\(\s*'([a-z0-9-]+)'\s*,\s*'[a-z0-9-]+'\s*,\s*(true|false)/gi,
    )) {
      declares.set(m[1], m[2].toLowerCase() === 'true')
    }
    // Une bascule posterieure par `update storage.buckets set public = …`.
    for (const m of code.matchAll(
      /update\s+storage\.buckets\s+set\s+public\s*=\s*(true|false)\s+where\s+id\s*=\s*'([a-z0-9-]+)'/gi,
    )) {
      declares.set(m[2], m[1].toLowerCase() === 'true')
    }
  }

  if (declares.size === 0) {
    ko('Aucun bucket lu', 'Le balayage des migrations n\'a trouve aucune declaration de bucket — ' +
      'le controle serait vert faute de matiere.')
  }
  for (const [id, estPublic] of declares) {
    if (!(id in ATTENDU)) {
      ko(
        'Bucket inconnu du controle',
        `« ${id} » (public=${estPublic}) n'est pas dans la table d'etat attendu. Ajoutez-le ` +
          'EXPLICITEMENT avec sa confidentialite voulue — un bucket dont personne n\'a decide ' +
          'la portee est un bucket qui finira public.',
      )
      continue
    }
    if (ATTENDU[id] !== estPublic) {
      ko(
        'Un bucket a change de confidentialite',
        `« ${id} » : attendu public=${ATTENDU[id]}, declare public=${estPublic}. ` +
          (estPublic
            ? 'Un bucket d\'images privees rendu public rouvre l\'acces par URL devinable.'
            : 'Un bucket attendu public rendu prive casserait les pages publiques et cachees.'),
      )
    }
  }
  const manquants = Object.keys(ATTENDU).filter((id) => !declares.has(id))
  if (manquants.length > 0) {
    ko('Bucket attendu non declare en migration', manquants.join(', '))
  }
  if (declares.size > 0 && manquants.length === 0) {
    ok(`Les ${declares.size} buckets sont dans l'etat attendu (dont « ecosysteme » public, assume)`)
  }
}

// ═══ 5. LA GARDE PAR ROLE — AU SERVEUR ET EN BASE ═══════════════════════════
{
  const route = sansCommentaires(lire(ROUTE_ORG))

  // ANCRE (§E.8) : le refus doit suivre IMMEDIATEMENT le test de role, sinon
  // un fichier qui cite les deux fragments a deux endroits differents passerait.
  const refusAncre =
    /role_in_org\s*!==\s*'admin'\s*\)\s*\{\s*return\s+json\(\s*\{[^}]*not_org_admin/g
  const nbRefus = [...route.matchAll(refusAncre)].length
  if (nbRefus < 2) {
    ko(
      'La garde admin du televersement a saute',
      `${ROUTE_ORG} — attendu au moins 2 refus ancres (POST et DELETE) sur ` +
        `« role_in_org !== 'admin' » suivi de « not_org_admin », trouve ${nbRefus}. ` +
        'Un editor ou un viewer pourrait changer le logo de son organisation.',
    )
  } else {
    ok(`La garde admin est au SERVEUR sur POST et DELETE (${nbRefus} refus ancres)`)
  }

  // En BASE : les policies d'ECRITURE doivent porter sur l'organisation, jamais
  // sur la personne. `auth.uid()` ici signifierait qu'un seul membre peut gerer
  // l'objet — le contraire du besoin.
  const policiesEcriture = [
    ...sqlMigration.matchAll(
      /create\s+policy\s+(org_logos_admin_\w+)[\s\S]*?;/gi,
    ),
  ]
  if (policiesEcriture.length < 3) {
    ko(
      'Les policies d\'ecriture du bucket ont saute',
      `${MIGRATION} — attendu 3 policies org_logos_admin_* (insert/update/delete), ` +
        `trouve ${policiesEcriture.length}.`,
    )
  } else {
    let mauvaises = 0
    for (const p of policiesEcriture) {
      const corps = p[0]
      if (!/is_active_admin_of_org/.test(corps)) {
        mauvaises++
        ko(
          'Une policy d\'ecriture ne porte plus la garde admin',
          `${MIGRATION} — « ${p[1]} » n'appelle plus is_active_admin_of_org.`,
        )
      }
      if (/auth\.uid\(\)/.test(corps)) {
        mauvaises++
        ko(
          'Une policy de logo est scopee sur la PERSONNE',
          `${MIGRATION} — « ${p[1]} » mentionne auth.uid(). Le logo appartient a ` +
            'l\'ORGANISATION : plusieurs membres doivent gerer le meme objet.',
        )
      }
    }
    if (mauvaises === 0) {
      ok(`Les ${policiesEcriture.length} policies d'ecriture sont scopees organization_id, jamais auth.uid()`)
    }
  }

  // Le CHECK en base : une adresse ne doit pas pouvoir etre ECRITE, quel que
  // soit le chemin de code.
  const checks = [...sqlMigration.matchAll(/add\s+constraint\s+(\w*(?:logo|favicon)\w*_chemin_check)/gi)]
  if (checks.length < 3) {
    ko(
      'Les contraintes de chemin ont saute',
      `${MIGRATION} — attendu 3 CHECK (organizations.logo_url, domain_configs.logo_url, ` +
        `domain_configs.favicon_url), trouve ${checks.length}. Sans elles, une URL redevient ` +
        'ecrivable par n\'importe quel chemin de code.',
    )
  } else {
    ok(`Les ${checks.length} CHECK de chemin interdisent d'ECRIRE une adresse`)
  }
}

// ═══ 6. LE FICHIER QUI MENT SUR SON TYPE ════════════════════════════════════
//
// Une extension et un Content-Type sont declaratifs. Ce qui protege est la
// SIGNATURE BINAIRE. On verifie qu'elle est bien lue, et que les deux routes
// d'ecriture l'utilisent — aucune ne doit avoir sa propre version.
{
  const SIGNATURES = [
    { nom: 'JPEG', motif: /0xff\s*&&[\s\S]{0,80}0xd8[\s\S]{0,80}0xff/ },
    { nom: 'PNG', motif: /0x89\s*,\s*0x50\s*,\s*0x4e\s*,\s*0x47/ },
    { nom: 'WebP (RIFF)', motif: /0x52\s*,\s*0x49\s*,\s*0x46\s*,\s*0x46/ },
    { nom: 'WebP (WEBP)', motif: /0x57\s*,\s*0x45\s*,\s*0x42\s*,\s*0x50/ },
  ]
  const manquantes = SIGNATURES.filter((s) => !s.motif.test(srcModule)).map((s) => s.nom)
  if (manquantes.length > 0) {
    ko(
      'Une signature binaire a disparu',
      `${MODULE} — manquant : ${manquantes.join(', ')}. Sans elle, un fichier qui ment sur ` +
        'son type passe : le Content-Type declare ne protege rien.',
    )
  } else {
    ok('Les 4 signatures binaires (JPEG, PNG, WebP×2) sont lues dans les octets')
  }

  // Le verdict doit comparer le type RENIFLE au type DECLARE, et c'est le
  // renifle qui sort. Sans cette comparaison, un fichier bien forme mais mal
  // etiquete serait servi sous un type que le client a choisi.
  if (!/reel\s*!==\s*declare/.test(srcModule)) {
    ko(
      'La comparaison declare/renifle a saute',
      `${MODULE} — le type reniflé n'est plus confronté au type déclaré.`,
    )
  } else {
    ok('Le type renifle est confronte au type declare, et c\'est lui qui est servi')
  }

  for (const [nom, chemin] of [['organisation', ROUTE_ORG], ['ecosysteme', ROUTE_ECO]]) {
    const src = sansCommentaires(lire(chemin))
    if (!/verifierFichierLogo\s*\(/.test(src)) {
      ko(
        'Une route d\'ecriture ne verifie plus le contenu',
        `${chemin} — verifierFichierLogo n'est plus appelee (route ${nom}).`,
      )
    } else if (!/contentType:\s*verdict\.type/.test(src)) {
      ko(
        'Le type servi n\'est plus le type renifle',
        `${chemin} — le contentType ecrit dans Storage ne vient plus du verdict (route ${nom}) : ` +
          'le client rechoisirait sous quel type sa ressource est servie.',
      )
    } else {
      ok(`La route ${nom} verifie le contenu et impose le type renifle`)
    }
  }
}

// ═══ 7. LE FILET QUI N'EXISTE PAS — LA CSP ══════════════════════════════════
//
// Ce n'est PAS une exigence : poser une CSP est un autre lot. C'est un CONSTAT
// tenu a jour, parce que c'est lui qui rend la classe de defaut exploitable.
// Le jour ou une CSP apparait, ce bloc le dira — et l'invariant des §1-2
// deviendra une seconde ligne au lieu de la seule.
{
  const aUneCsp = SOURCES.some((f) => /Content-Security-Policy|img-src/i.test(lire(f)))
  const config = existsSync(join(ROOT, 'next.config.ts')) ? lire('next.config.ts') : ''
  const aDesHeaders = /async\s+headers\s*\(/.test(sansCommentaires(config))
  if (aUneCsp || aDesHeaders) {
    ok('Une CSP (ou des en-tetes) existent desormais — les §1-2 deviennent une seconde ligne')
  } else {
    ok('CONSTAT : aucune CSP dans le depot — c\'est ce qui rend la classe exploitable, d\'ou §1-2')
  }
}

// ═══ VERDICT ════════════════════════════════════════════════════════════════
console.log('\n═══ diag-logo-organisation ═══\n')
for (const o of oks) console.log(`  OK   ${o}`)
if (echecs.length > 0) {
  console.log('')
  for (const e of echecs) {
    console.log(`  KO   ${e.quoi}`)
    console.log(`       → ${e.detail}`)
  }
}
console.log(
  echecs.length === 0
    ? `\n✔ ${oks.length} controle(s) au vert — aucune URL externe n'atteint un <img src>\n`
    : `\n✘ ${echecs.length} CONTROLE(S) EN ECHEC\n`,
)
process.exit(echecs.length === 0 ? 0 : 1)
