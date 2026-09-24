// scripts/diag-durees-reglables.mjs — LES DEUX DUREES NE SONT PLUS DANS LE CODE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE DEFAUT QU'ON FERME
//   `PUBLICATION_TTL_DAYS = 30` et `CONVERSATION_TTL_DAYS = 15` : deux
//   constantes, dans deux fichiers, qui definissaient le contrat de la place —
//   combien de temps une annonce se voit, combien de temps on a pour se parler.
//   Les changer demandait un deploiement.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE CE CONTROLE DEFEND, ET POURQUOI C'EST UNE CLASSE
//
//   ① AUCUN DEFAUT, NULLE PART. Le piege d'un reglage n'est pas de l'oublier :
//      c'est de laisser, « pour les cas simples », une valeur de repli dans le
//      code. On a alors DEUX sources de verite, et la seconde prend la main le
//      jour ou l'on comprend le moins ce qui se passe. Un `= 30` reintroduit
//      dans une signature doit rougir.
//
//   ② TOUTE ROUTE QUI LIT LA REGLE LIT LE REGLAGE. Un fichier qui importe
//      l'expiration sans jamais appeler `chargerDurees` applique forcement une
//      valeur venue d'ailleurs. Decouvert par balayage, jamais par une liste :
//      une liste laisserait passer la vingt-deuxieme route.
//
//   ③ L'ASYMETRIE EST STRUCTURELLE, ET ELLE DOIT LE RESTER.
//        vie d'une annonce  → RETROACTIVE     (expires_at jamais ecrit)
//        fenetre d'echange  → NON retroactive (expires_at ecrit au deblocage)
//      Si `isConversationExpired` se mettait a prendre une duree, il
//      recalculerait la fin d'un echange en cours : la fenetre deviendrait
//      retroactive, et l'ecran qui promet le contraire mentirait.
//
//   ④ LA BAISSE ALERTE, ELLE NE BLOQUE PAS. Le comptage precede l'ecriture, et
//      le refus est CONDITIONNEL a la confirmation. Un refus definitif
//      obligerait a modifier la base a la main — le defaut meme qu'on ferme.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-durees-reglables.mjs
//
// AUCUN acces base, AUCUN reseau. LECTURE PURE : ce script n'ecrit JAMAIS.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Fins de ligne NORMALISEES (§E.3) : le depot sort les fichiers en CRLF, et un
// retour chariot casse tout motif qui traverse un saut de ligne.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

let echecs = 0
const ok = (cond, libelle, indice) => {
  if (cond) console.log(`  ok   ${libelle}`)
  else { echecs++; console.log(`  KO   ${libelle}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

/** Commentaires retires — LIGNES d'abord, BLOCS ensuite (cf. §E.3 et §E.12). */
const sansCommentaires = (src) =>
  src.replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '')

// ─────────────────────────────────────────────────────────────────────────────
// LE BALAYAGE — on DECOUVRE les fichiers, on ne les liste pas.
// ─────────────────────────────────────────────────────────────────────────────
const RACINES = ['app', 'lib', 'components']
const fichiers = []
for (const racine of RACINES) {
  const pile = [racine]
  while (pile.length) {
    const d = pile.pop()
    for (const e of readdirSync(join(ROOT, d))) {
      const rel = `${d}/${e}`
      if (statSync(join(ROOT, rel)).isDirectory()) { pile.push(rel); continue }
      if (/\.tsx?$/.test(e)) fichiers.push(rel)
    }
  }
}

const REGLE_ANNONCE = /from '@\/lib\/publications\/expiry'/
const REGLE_ECHANGE = /from '@\/lib\/conversations\/expiry'/
const LIT_REGLAGE = /\bchargerDurees\s*\(/

// ═════════════════════════════════════════════════════════════════════════════
section('A. Les constantes ont disparu, et rien ne les a remplacees')
// ═════════════════════════════════════════════════════════════════════════════

{
  const CONSTANTES = [/\bPUBLICATION_TTL_DAYS\b/, /\bCONVERSATION_TTL_DAYS\b/]
  const coupables = fichiers.filter((f) => {
    const code = sansCommentaires(read(f))
    return CONSTANTES.some((re) => re.test(code))
  })
  ok(coupables.length === 0,
    'aucune constante de duree ne subsiste dans app/, lib/ ni components/',
    coupables.join(', '))

  // ET LA FORME DEGUISEE : un `30 * 24 * 60 * 60 * 1000` ecrit a la main
  // rendrait la constante sans en porter le nom.
  //
  // LE PERIMETRE EST CELUI DU LOT, ET IL EST DIT. Ce controle defend LES DEUX
  // DUREES DE LA PLACE : les deux regles, le lecteur, et tout fichier qui les
  // importe. Une duree en dur AILLEURS est un defaut de la meme famille, mais
  // d'un autre sujet — la denoncer ici ferait rougir ce controle pour un
  // travail qu'il ne fait pas, et un controle rouge en permanence est un
  // controle qu'on desactive. Elle est donc RECENSEE, nommement, sans faire
  // echouer : perdue nulle part, jugee nulle part a tort.
  const EN_DUR = /\b(?!24\b)\d{1,3}\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/
  const dansLaChaine = (f) => {
    if (/^lib\/(durees\.ts|publications\/expiry\.ts|conversations\/expiry\.ts)$/.test(f)) return true
    const code = sansCommentaires(read(f))
    return REGLE_ANNONCE.test(code) || REGLE_ECHANGE.test(code) || LIT_REGLAGE.test(code)
  }
  const enDur = fichiers.filter((f) => EN_DUR.test(sansCommentaires(read(f))))
  const dedans = enDur.filter(dansLaChaine)
  const dehors = enDur.filter((f) => !dansLaChaine(f))

  ok(dedans.length === 0,
    'aucune duree en dur dans la chaine des deux durees de la place',
    dedans.join(', ') + ' — une constante sans son nom reste une constante')

  if (dehors.length > 0) {
    console.log(`  note ${dehors.length} duree(s) en dur HORS du perimetre de ce controle :`)
    for (const f of dehors) console.log(`         ${f}`)
    console.log('         → meme famille de defaut, autre sujet. Recensees, pas jugees ici.')
  }
}

// ═════════════════════════════════════════════════════════════════════════════
section('B. Aucun defaut, dans aucune des deux regles')
// ═════════════════════════════════════════════════════════════════════════════

{
  const ANNONCE = sansCommentaires(read('lib/publications/expiry.ts'))
  const ECHANGE = sansCommentaires(read('lib/conversations/expiry.ts'))

  ok(/vieAnnonceJours: number/.test(ANNONCE) && !/vieAnnonceJours\?:/.test(ANNONCE),
    'la vie d’une annonce est un champ REQUIS, jamais optionnel',
    'un champ optionnel se resout en `undefined`, donc en NaN, donc en « tout est expire »')

  ok(!/vieAnnonceJours\s*(=|:\s*number\s*=)\s*\d/.test(ANNONCE),
    'aucune valeur par defaut n’est posee sur la vie d’une annonce',
    'un defaut fait DEUX sources de verite, et la seconde gagne en silence')

  ok(/fenetreEchangeJours: number/.test(ECHANGE) && !/fenetreEchangeJours\?:/.test(ECHANGE),
    'la fenetre d’echange est un champ REQUIS, jamais optionnel')

  ok(!/fenetreEchangeJours\s*(=|:\s*number\s*=)\s*\d/.test(ECHANGE),
    'aucune valeur par defaut n’est posee sur la fenetre d’echange')

  // Le lecteur lui-meme ne doit rien inventer.
  const LECTEUR = sansCommentaires(read('lib/durees.ts'))
  ok(!/\b(30|15)\b/.test(LECTEUR),
    'le lecteur de reglage ne contient AUCUNE des deux anciennes valeurs',
    'un repli a 30 ou 15 dans lib/durees.ts annulerait tout le lot')
  ok(/ok: false/.test(LECTEUR),
    'une lecture en echec rend une RAISON, pas une valeur',
    'servir une duree inventee est pire que refuser en le disant')
}

// ═════════════════════════════════════════════════════════════════════════════
section('C. Toute route qui lit la regle lit aussi le reglage')
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Un fichier qui importe une regle d'expiration doit, SOIT lire le reglage
 * lui-meme (c'est une route), SOIT recevoir la duree en argument (c'est une
 * lib, et son appelant s'en charge). Ce qu'on refuse, c'est le troisieme cas :
 * importer la regle et n'avoir ni l'un ni l'autre.
 */
const RECOIT_DUREE = /(vieAnnonceJours|fenetreEchangeJours|durees)\b/

{
  const lecteurs = fichiers.filter((f) => {
    const code = sansCommentaires(read(f))
    return REGLE_ANNONCE.test(code) || REGLE_ECHANGE.test(code)
  })
  console.log(`       ${lecteurs.length} fichier(s) lisent une regle de duree.\n`)

  const muets = lecteurs.filter((f) => {
    const code = sansCommentaires(read(f))
    return !LIT_REGLAGE.test(code) && !RECOIT_DUREE.test(code)
  })
  ok(muets.length === 0,
    'aucun lecteur de regle n’applique une duree venue de nulle part',
    muets.join(', '))

  // LE CAS CLIENT, celui qui a failli passer : un composant 'use client' ne
  // peut PAS lire la base. S'il calcule une duree, elle vient forcement d'une
  // constante compilee dans le bundle — c'est-a-dire d'un mensonge des que le
  // reglage change.
  const clients = fichiers.filter((f) => read(f).split('\n')[0].includes('use client'))
  const clientsCoupables = clients.filter((f) => {
    const code = sansCommentaires(read(f))
    return REGLE_ANNONCE.test(code) || REGLE_ECHANGE.test(code)
  })
  ok(clientsCoupables.length === 0,
    'aucun composant CLIENT n’importe une regle de duree',
    clientsCoupables.join(', ') + ' — un client ne lit pas la base, il afficherait une valeur figee')
}

// ═════════════════════════════════════════════════════════════════════════════
section('D. L’asymetrie est structurelle — et elle le reste')
// ═════════════════════════════════════════════════════════════════════════════

{
  const ECHANGE = sansCommentaires(read('lib/conversations/expiry.ts'))
  const debut = ECHANGE.indexOf('export function isConversationExpired')
  const corps = debut < 0 ? '' : ECHANGE.slice(debut, ECHANGE.indexOf('\n}', debut))

  ok(debut >= 0, 'le predicat de lecture d’un echange existe toujours')
  ok(!/fenetreEchangeJours/.test(corps),
    'isConversationExpired ne prend AUCUNE duree',
    'lui en passer une recalculerait la fin d’un echange EN COURS : la fenetre deviendrait retroactive')

  // Cote annonce, c'est l'inverse : la date n'est jamais ecrite, donc la regle
  // DOIT recalculer, donc elle DOIT recevoir la duree.
  const ANNONCE = sansCommentaires(read('lib/publications/expiry.ts'))
  ok(/export function isActivePublished\([\s\S]{0,300}?vieAnnonceJours/.test(ANNONCE) ||
     /isActivePublished\([\s\S]{0,300}?ContexteExpiration/.test(ANNONCE),
    'isActivePublished, lui, EXIGE la duree — il recalcule a chaque lecture')

  // Et personne n'ecrit expires_at sur une publication : c'est ce qui rend le
  // reglage retroactif, et c'est ce que l'ecran promet.
  // ANCRE SUR L'ECRITURE, ET SUR ELLE SEULE. Le premier motif cherchait
  // `expires_at:` dans les 400 caracteres suivant `.from('publications')` — il
  // trouvait donc les SELECT qui LISENT la colonne pour construire une fenetre,
  // et denoncait deux fichiers sains. Un controle qui crie a tort finit ignore.
  const ecrivains = fichiers.filter((f) => {
    const code = sansCommentaires(read(f))
    return /\.from\('publications'\)\s*\.?\s*\n?\s*\.(update|insert|upsert)\([\s\S]{0,400}?expires_at:/.test(code)
  })
  ok(ecrivains.length === 0,
    'aucun code n’ECRIT publications.expires_at',
    ecrivains.join(', ') + ' — l’ecrire figerait des annonces et rendrait le reglage partiellement inerte')
}

// ═════════════════════════════════════════════════════════════════════════════
section('E. La baisse est COMPTEE avant d’etre ecrite — et elle n’est pas bloquee')
// ═════════════════════════════════════════════════════════════════════════════

{
  const ROUTE = sansCommentaires(read('app/api/admin/durees/route.ts'))

  ok(/annonces_basculant_par_duree/.test(ROUTE),
    'le nombre d’annonces qui BASCULENT est compte par la base',
    'un total n’est pas une bascule : « 14 seraient expirees » n’alarme personne si 12 le sont deja')

  // L'ordre compte : le comptage precede l'ecriture, sinon on annonce apres coup.
  const iCompte = ROUTE.indexOf('compterBascule(admin, avant.durees.vieAnnonceJours, vie)')
  const iEcrit = ROUTE.indexOf(".from('duree_reglages')\n    .update(")
  ok(iCompte > 0 && iEcrit > iCompte,
    'le comptage precede l’ecriture, et non l’inverse',
    'compter apres avoir ecrit, c’est annoncer un degat deja fait')

  ok(/retroactivite_non_confirmee/.test(ROUTE) && /confirme_retroactivite !== true/.test(ROUTE),
    'le refus est CONDITIONNEL a la confirmation — ce n’est pas un plafond',
    'un refus definitif obligerait a modifier la base a la main, le defaut meme qu’on ferme')

  ok(/logAudit\(/.test(ROUTE) && /durees_place_updated/.test(ROUTE),
    'chaque changement laisse une trace nommee dans audit_logs',
    'le seuil expert est passe de 9 a 8 sans trace exploitable (§E.10)')

  // La garde ne se declenche QUE sur une baisse : allonger n'expire personne.
  ok(/if \(vie < avant\.durees\.vieAnnonceJours\)/.test(ROUTE),
    'la garde ne se declenche que sur une BAISSE',
    'demander confirmation pour un allongement apprendrait a cliquer sans lire')
}

// ═════════════════════════════════════════════════════════════════════════════
section('F. L’ecran DIT l’asymetrie, dans les quatre langues')
// ═════════════════════════════════════════════════════════════════════════════

{
  const LANGUES = ['fr', 'en', 'es', 'de']
  const CLES = [
    'life.retroactive_label',
    'life.retroactive_body',
    'exchange.not_retroactive_label',
    'exchange.not_retroactive_body',
    'confirm.body',
    'preview',
  ]
  for (const langue of LANGUES) {
    const j = JSON.parse(read(`messages/${langue}.json`))
    const bloc = j.admin_durees
    const manquantes = CLES.filter((c) => {
      const v = c.split('.').reduce((o, k) => (o ? o[k] : undefined), bloc)
      return typeof v !== 'string' || v.trim().length === 0
    })
    ok(manquantes.length === 0,
      `${langue} : l’asymetrie et le comptage sont ecrits`,
      'clef(s) absente(s) : ' + manquantes.join(', '))
  }

  const ECRAN = sansCommentaires(read('app/[locale]/admin/durees/page.tsx'))
  ok(/life\.retroactive_body/.test(ECRAN) && /exchange\.not_retroactive_body/.test(ECRAN),
    'les deux avertissements sont RENDUS, et non seulement traduits',
    'une traduction qu’aucun ecran n’affiche ne previent personne')
}

// ═════════════════════════════════════════════════════════════════════════════
section('G. Le detecteur lui-meme est eprouve')
// ═════════════════════════════════════════════════════════════════════════════

{
  const EN_DUR = /\b(?!24\b)\d{1,3}\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/
  const cas = [
    ['const ms = 30 * 24 * 60 * 60 * 1000', true, 'une duree recalculee en dur'],
    ['const ms = jours * 24 * 60 * 60 * 1000', false, 'un calcul a partir d’une VARIABLE'],
    ['const ms = ctx.vieAnnonceJours * 24 * 60 * 60 * 1000', false, 'un calcul depuis le reglage'],
  ]
  for (const [src, attendu, quoi] of cas) {
    ok(EN_DUR.test(sansCommentaires(src)) === attendu,
      `${attendu ? 'detecte' : 'ignore'} : ${quoi}`,
      attendu ? 'une constante deguisee passerait' : 'faux positif : un controle qui crie a tort finit ignore')
  }
  ok(!EN_DUR.test(sansCommentaires('// avant : 30 * 24 * 60 * 60 * 1000')),
    'ignore : une duree citee dans un COMMENTAIRE',
    'l’histoire d’un defaut doit pouvoir etre racontee')
}

section('H. La TROISIEME duree — celle qui vivait en DEUX exemplaires')

{
  const LECTEUR = sansCommentaires(read('lib/durees.ts'))
  const JETON = sansCommentaires(read('lib/invitation-token.ts'))

  ok(/invitationJours: number/.test(LECTEUR) && !/invitationJours\?:/.test(LECTEUR),
    'la duree d’invitation est un champ REQUIS du lecteur',
    'optionnelle, elle se resoudrait en undefined, donc en NaN, donc en date invalide')

  ok(!/\b7\b/.test(LECTEUR),
    'le lecteur ne contient pas l’ancienne valeur 7',
    'un repli a 7 dans lib/durees.ts annulerait ce lot')

  // LA SOURCE EST UNIQUE. C'est le coeur du defaut ferme : le meme nombre
  // vivait dans DEUX routes, et deux copies derivent — six copies du mappage
  // des offres avaient deja derive sur ce projet.
  ok(/export function invitationExpiryIso/.test(JETON),
    'une source UNIQUE calcule la date d’expiration d’une invitation')

  // ANCRE SUR L'ECRITURE, ET SUR ELLE SEULE.
  //   Premier motif : « cite organization_invitations ET expires_at ». Il
  //   denoncait SIX fichiers sains — ceux qui LISENT la date pour dire si une
  //   invitation est encore valable, plus les types generes. C'est la troisieme
  //   fois de la journee que ce piege se referme : un controle qui crie a tort
  //   est desactive le jour meme (§E.7).
  const POSE_UNE_DATE =
    /\.from\('organization_invitations'\)\s*\.?\s*\n?\s*\.(insert|update|upsert)\([\s\S]{0,400}?expires_at/
  const ecrivains = fichiers.filter((f) => POSE_UNE_DATE.test(sansCommentaires(read(f))))
  const sansSource = ecrivains.filter((f) => !/invitationExpiryIso/.test(sansCommentaires(read(f))))
  ok(sansSource.length === 0,
    `les ${ecrivains.length} fichier(s) qui posent une expiration d’invitation passent par la source unique`,
    sansSource.join(', ') + ' — une seconde copie du meme nombre finira par diverger')

  // ET ELLE N'EST PAS RETROACTIVE : la date est ECRITE. Poser une garde de
  // comptage laisserait croire le contraire.
  const ROUTE = sansCommentaires(read('app/api/admin/durees/route.ts'))
  // ANCRE SUR LA FORME DE L'APPEL, ET NON SUR LA PROXIMITE.
  //   Premier motif : `basculant` seul — il ne visait que le nom de la fonction
  //   SQL et laissait passer un appel au helper `compterBascule`.
  //   Deuxieme : « invitation puis bascul a moins de 200 caracteres » — il
  //   rougissait sur le fichier SAIN, parce que la trace d'audit fait suivre
  //   `invitation_jours` de `retroactivite: bascule`, tout a fait legitimement.
  //   Un motif de PROXIMITE est le mauvais outil : ce qu'on interdit, c'est que
  //   la duree d'invitation soit l'ARGUMENT d'un comptage.
  ok(!/compterBascule\([^)]*invitation/i.test(ROUTE) &&
     !/annonces_basculant_par_duree[\s\S]{0,120}invitation/i.test(ROUTE),
    'la duree d’invitation n’est l’argument d’AUCUN comptage',
    'il n’y a rien a compter : la date est ecrite, rien ne bascule — en compter laisserait croire le contraire')

  ok(/invitation_jours: invitation/.test(ROUTE),
    'la troisieme duree est REELLEMENT ecrite par la route d’administration')
}

section('I. Les trois durees, et l’asymetrie, sont DITES dans les quatre langues')

{
  const LANGUES = ['fr', 'en', 'es', 'de']
  const CLES = [
    'life.retroactive_label',
    'exchange.not_retroactive_label',
    'invitation.not_retroactive_label',
    'invitation.not_retroactive_body',
  ]
  for (const langue of LANGUES) {
    const j = JSON.parse(read(`messages/${langue}.json`))
    const manquantes = CLES.filter((c) => {
      const v = c.split('.').reduce((o, k) => (o ? o[k] : undefined), j.admin_durees)
      return typeof v !== 'string' || v.trim().length === 0
    })
    ok(manquantes.length === 0,
      `${langue} : les trois durees disent si elles retroagissent`,
      'clef(s) absente(s) : ' + manquantes.join(', '))
  }

  const ECRAN = sansCommentaires(read('app/[locale]/admin/durees/page.tsx'))
  ok(/invitation\.not_retroactive_body/.test(ECRAN),
    'l’avertissement de la troisieme duree est RENDU, pas seulement traduit',
    'une traduction qu’aucun ecran n’affiche ne previent personne')
}

section('J. La QUATRIEME duree — la conservation des adresses IP, et la tache qui les efface')
//
//   Une duree LEGALE, pas une promesse de la place : 12 mois, reglables (1–60),
//   puis l'adresse ET le navigateur sont mis a NULL dans audit_logs ET
//   session_logs, par une tache SQL qui ecrit son propre verdict. Mesure le
//   24/09/2026 : 29 lignes d'audit et 185 sessions avec IP, aucune tache.
//   Meme classe que les trois autres : AUCUN defaut dans le code, la route
//   borne avec une raison nommee, l'ecran DIT le comportement (il agit sur
//   l'existant), et tout est traduit quatre fois.
{
  const nomMigration = (suffixe) => {
    const hits = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith(`_${suffixe}.sql`))
    if (hits.length !== 1) throw new Error(`migration « ${suffixe} » : ${hits.length} correspondance(s)`)
    return `supabase/migrations/${hits[0]}`
  }
  const SQL = read(nomMigration('conservation_ip')).split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
  ok(/add column if not exists conservation_ip_mois integer/.test(SQL) && /alter column conservation_ip_mois set not null/.test(SQL),
    'la colonne existe et est NOT NULL')
  ok(/conservation_ip_mois between 1 and 60/.test(SQL), 'bornee en base : 1 a 60 mois')

  const iFn = SQL.indexOf('function public.effacer_adresses_ip()')
  const FN = iFn < 0 ? '' : SQL.slice(iFn, SQL.indexOf('$fn$;', iFn))
  ok(/select conservation_ip_mois into v_mois/.test(FN) && !/coalesce\(\s*v_mois/.test(FN) && !/\b12\b/.test(FN),
    'la tache LIT le reglage et n’a AUCUN defaut',
    'un 12 dans la fonction serait une seconde source, celle qui prend la main le jour ou la lecture echoue')
  const tables = ['audit_logs', 'session_logs'].filter((t) =>
    new RegExp(`update public\\.${t}\\s+set ip_address = null, user_agent = null\\s+where created_at < v_limite`).test(FN))
  ok(tables.length === 2, 'l’adresse ET le navigateur sont effaces, dans les DEUX tables',
    `vu : ${tables.join(', ') || 'aucune'}`)
  ok(/insert into public\.cron_run_log \(job_name\)\s+values \('ip_retention_purge'\)/.test(FN)
    && /cloturer_run_cron\(v_log_id, 200/.test(FN) && /cloturer_run_cron\(v_log_id, 500/.test(FN),
    'la tache ouvre sa ligne de run et la clot par le MEME guichet, succes comme echec',
    'un second mecanisme de verdict serait un jumeau (§E.20) ; un echec leve emporterait la ligne')
  ok(/cron\.schedule\(\s*'ip_retention_purge'/.test(SQL) && /select public\.effacer_adresses_ip\(\)/.test(SQL),
    'planifiee dans pg_cron')
  ok(/'ip_retention_purge',\s*'jobs\.ip_retention\.label',[\s\S]{0,200}?'legal',\s*'legal_basis\.ip_12m'/.test(SQL),
    'au catalogue, LEGALE, avec son obligation nommee')
  ok(/function public\.cron_purge_health\(\)[\s\S]*?\('ip_retention_purge'\)/.test(SQL),
    'la sante des purges la voit (cron_purge_health enumere ses taches)')

  const iPost = SQL.indexOf('do $post$')
  const POST = iPost < 0 ? '' : SQL.slice(iPost)
  ok(/to_regprocedure\(s\) is null/.test(POST) && /effacer_adresses_ip\(\)'/.test(POST),
    'postcondition : signatures par TYPES (§E.67)')
  ok(/set conservation_ip_mois = 0 where/.test(POST) && /set conservation_ip_mois = 61 where/.test(POST) && /when check_violation/.test(POST),
    'postcondition : la contrainte est EPROUVEE (0 et 61 refuses), pas lue')
  ok(/v_res := public\.effacer_adresses_ip\(\)/.test(POST) && /SONDE_ANNULEE/.test(POST),
    'postcondition : l’effacement est EXECUTE puis annule (sonde en sous-transaction)')

  const LECTEUR = sansCommentaires(read('lib/durees.ts'))
  ok(/export async function chargerConservationIp/.test(LECTEUR) && !/conservationIpMois\s*(=|\?\?)\s*\d/.test(LECTEUR) && !/\b12\b/.test(LECTEUR),
    'le lecteur existe et n’a AUCUN defaut')
  const ROUTE = sansCommentaires(read('app/api/admin/durees/route.ts'))
  ok(/conservation_ip_mois: conservationIp,/.test(ROUTE) && /invalid_ip_retention/.test(ROUTE) && /estConservationIpAcceptable\(conservationIp\)/.test(ROUTE),
    'la route l’ecrit, bornee, avec une raison nommee distincte des jours')
  const TRACE = ROUTE.slice(ROUTE.indexOf("action: 'durees_place_updated'"))
  ok((TRACE.match(/conservation_ip_mois/g) || []).length >= 2, 'la trace porte la valeur AVANT et APRES')
  const ECRAN = sansCommentaires(read('app/[locale]/admin/durees/page.tsx'))
  ok(/conservation_ip_mois: Number\(conservationIp\)/.test(ECRAN) && /max=\{60\}/.test(ECRAN) && /ip\.acts_on_existing_body/.test(ECRAN),
    'l’ecran porte le champ, borne a 60, et DIT qu’il agit sur l’existant')

  for (const langue of ['fr', 'en', 'es', 'de']) {
    const j = JSON.parse(read(`messages/${langue}.json`))
    const lire = (racine, chemin) => chemin.split('.').reduce((o, k) => (o ? o[k] : undefined), racine)
    const manquantes = [
      ...['months', 'invalid_ip', 'ip.title', 'ip.acts_on_existing_label', 'ip.acts_on_existing_body', 'ip.help']
        .filter((c) => typeof lire(j.admin_durees, c) !== 'string' || !lire(j.admin_durees, c).trim()),
      ...['jobs.ip_retention.label', 'jobs.ip_retention.description', 'legal_basis.ip_12m']
        .filter((c) => typeof lire(j.admin_back_office?.cron, c) !== 'string' || !lire(j.admin_back_office.cron, c).trim()),
    ]
    ok(manquantes.length === 0, `${langue} : le champ, son avertissement et la tache sont traduits`,
      'clef(s) absente(s) : ' + manquantes.join(', '))
  }
}

console.log(echecs === 0 ? '\n✔ TOUT VERT' : `\n✘ ${echecs} CONTROLE(S) EN ECHEC`)
process.exit(echecs === 0 ? 0 : 1)
