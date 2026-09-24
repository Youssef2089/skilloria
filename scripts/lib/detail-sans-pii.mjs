// scripts/lib/detail-sans-pii.mjs — LE DÉTECTEUR DE DONNÉES PERSONNELLES DANS
// UN DÉTAIL DE JOURNAL, PARTAGÉ.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE MODULE EXISTE, ET POURQUOI IL EST PARTAGÉ
//
//   Deux journaux portent un `detail` jsonb qui ne doit contenir AUCUNE donnée
//   personnelle : `audit_logs` (§E.68, étape 0.3) et le grand livre (§D.26).
//   Deux contrôles les gardent. Deux copies du même détecteur auraient fini par
//   diverger — l'une apprenant une forme de fuite, l'autre non — et c'est
//   précisément le jumeau que §E.20 nomme. Le détecteur vit donc ici, une fois,
//   et les deux contrôles l'importent.
//
// CE QU'IL SAIT VOIR
//   · une CLÉ de la liste personnelle, à toute profondeur d'un objet littéral ;
//   · une VALEUR visiblement personnelle sous une clé innocente : un accès
//     `x.email`, un identifiant nu `phone`, `newEmail`, `firstName`… ;
//   · un détail OPAQUE — spread `...x`, raccourci `detail`, variable — qu'aucun
//     balayage ne peut lire, donc refusé.
//
// CE QU'IL NE VOIT PAS, ET LE DIT
//   Une donnée personnelle sous une clé innocente ET une valeur qui n'a pas
//   l'air d'en être une (`ref: x.contact`). C'est la relecture de chaque nouvel
//   appel qui la voit ; ce module ne dispense pas de lire.
//
// LA LISTE DES CLÉS est lue dans la migration `audit_sans_donnee_personnelle`
// (`audit_logs_cles_personnelles()`) — une seule source, jamais recopiée.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Le texte entre `ouvre` et sa fermeture équilibrée, après la première occurrence de `debut`. */
export function blocApres(src, debut, ouvre = '{', ferme = '}') {
  const i = src.indexOf(debut)
  if (i < 0) return null
  const o = src.indexOf(ouvre, i + debut.length - (debut.endsWith(ouvre) ? 1 : 0))
  if (o < 0) return null
  let p = 0
  for (let k = o; k < src.length; k++) {
    if (src[k] === ouvre) p++
    else if (src[k] === ferme) { p--; if (p === 0) return src.slice(o, k + 1) }
  }
  return null
}

/** Tous les objets passés à `<nom>({…})` — par exemple `logAudit(` ou `journaliser(`. */
export function appelsDe(src, nom) {
  const out = []
  let from = 0
  for (;;) {
    const i = src.indexOf(nom, from)
    if (i < 0) return out
    const b = blocApres(src.slice(i), nom)
    if (b) out.push(b)
    from = i + nom.length
  }
}

/**
 * Les clés personnelles, lues dans la migration qui les déclare en base.
 * `lireSql` rend le texte (sans commentaires `--`) de la migration
 * `audit_sans_donnee_personnelle` ; le premier `[` après le nom de la fonction
 * est celui de `returns text[]`, on part donc de `select array[`.
 */
export function chargerClesPersonnelles(sqlSansCommentaires) {
  const iListe = sqlSansCommentaires.indexOf('function public.audit_logs_cles_personnelles()')
  const corps = iListe < 0 ? null : blocApres(sqlSansCommentaires.slice(iListe), 'select array[', '[', ']')
  return corps ? [...corps.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]) : []
}

/** Les clés d'un objet littéral, à toute profondeur. */
export function clesDe(litteral) {
  return [...litteral.matchAll(/(?:^|[{,\s])([A-Za-z_][A-Za-z0-9_]*)\s*:(?!:)/g)].map((m) => m[1])
}

/**
 * Fabrique le verdict sur un bloc d'appel `{…}` : `null` si sain, sinon le
 * motif. `champ` est le nom de la propriété qui porte le détail (`detail` pour
 * logAudit et journaliser, `p_detail` pour un appel RPC direct).
 */
export function fabriquerDetecteur(CLES, champ = 'detail') {
  const camel = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
  const NOMS_VALEUR = [...new Set(CLES.flatMap((k) => [k, camel(k)]))]
  const ACCES_PII = new RegExp(`\\.(${CLES.join('|')})\\b`)
  const IDENT_PII = new RegExp(`(?<![.\\w'"])(${NOMS_VALEUR.join('|')})(?![\\w'"])`)
  const PROP = new RegExp(`\\b${champ}\\s*([:,}])`)
  /**
   * `contexte` : le source du fichier. Un détail passé par une VARIABLE
   * (`detail: detailReglage`) n'est opaque que si sa définition littérale
   * (`const detailReglage = {…}`) est introuvable dans le fichier — sinon
   * c'est ce littéral qui est jugé.
   */
  return function defautDe(bloc, contexte = '') {
    const m = PROP.exec(bloc)
    if (!m) return null
    if (m[1] !== ':') return `détail OPAQUE (raccourci \`${champ}\`) — un objet qu’on ne lit pas ne se vérifie pas`
    const apres = bloc.slice(m.index + m[0].length).trimStart()
    let litteral
    if (apres.startsWith('{')) {
      litteral = blocApres(bloc.slice(m.index), `${champ}:`)
    } else {
      const ident = /^([A-Za-z_$][\w$]*)\s*[,}\n]/.exec(apres)
      const definition = ident ? blocApres(contexte, `const ${ident[1]} = {`) : null
      if (!definition) return `détail OPAQUE (\`${champ}: ${apres.slice(0, 24).split('\n')[0]}…\`) — ni littéral, ni \`const\` littéral dans le fichier`
      litteral = definition
    }
    if (!litteral) return 'détail illisible'
    if (/\.\.\./.test(litteral)) return 'détail OPAQUE (spread `...`) — les clés viennent d’ailleurs'
    const cles = clesDe(litteral).filter((k) => CLES.includes(k))
    if (cles.length) return `clé personnelle : ${cles.join(', ')}`
    const valeurs = litteral.replace(/(?:^|[{,\s])[A-Za-z_][A-Za-z0-9_]*\s*:(?!:)/g, ' ')
    const acces = ACCES_PII.exec(valeurs)
    if (acces) return `valeur personnelle : \`…${acces[0]}\``
    const ident = IDENT_PII.exec(valeurs)
    if (ident) return `valeur personnelle : \`${ident[1]}\``
    return null
  }
}
