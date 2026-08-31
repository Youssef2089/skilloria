/**
 * lib/expert-name-code.ts — CALCUL PUR du code de masquage d'un nom d'expert.
 *
 * POURQUOI CE FICHIER EST SÉPARÉ DE `expert-name-masking.ts`
 *   Le masquage est une règle de SÉCURITÉ, et sa correction tient presque
 *   entièrement à une douzaine de cas limites : noms d'une lettre, prénom ou
 *   nom absent, accents décomposés, particules, apostrophes, alphabets sans
 *   casse, eszett qui double en majuscule. Ces cas doivent être VÉRIFIABLES en
 *   exécutant la fonction, pas en relisant le code.
 *
 *   Ce module n'a donc AUCUN import : ni alias `@/`, ni JSON de traduction, ni
 *   type Next. `scripts/diag-expert-name-masking.mjs` peut l'importer
 *   directement et éprouver le comportement réel. Le module voisin y ajoute la
 *   seule chose qui dépende de l'extérieur : les libellés de repli traduits.
 *
 * RÈGLE : première lettre du prénom + deux premières lettres du nom, en
 * majuscules, sans espace ni point.
 *   "Youssef Cherif" → "YCH"   ·   "Sonia Idrissi" → "SID"
 */

/**
 * Les `n` PREMIÈRES lettres d'une chaîne, en majuscules.
 *
 * Trois précautions, chacune répondant à un défaut d'affichage réel :
 *
 *  1. `normalize('NFC')` D'ABORD. Un « É » saisi en forme décomposée est
 *     ('E' + U+0301) : deux code points. Sans recomposition on prendrait le
 *     'E', puis l'accent combinant seul — qui s'affiche détaché ou en carré
 *     vide. La normalisation en fait un caractère unique.
 *
 *  2. Filtrage sur `\p{L}` : seules les LETTRES comptent. Tirets, apostrophes
 *     et espaces sont SAUTÉS, jamais comptés — « D'Amico » donne « DA », pas
 *     « D' ». `Array.from` découpe en code points (et non en unités UTF-16),
 *     donc les alphabets hors plan de base ne sont pas coupés en deux.
 *
 *  3. Majuscule caractère par caractère, en ne gardant que le PREMIER
 *     caractère du résultat. En allemand `'ß'.toUpperCase()` vaut « SS » :
 *     sans cette garde, « Straße » ferait déborder le code à quatre
 *     caractères. Et c'est `toUpperCase()`, NON `toLocaleUpperCase()` : sans
 *     argument, la variante locale suit la locale par défaut du runtime, où
 *     'i' devient 'İ' en turc — le même nom s'afficherait alors différemment
 *     selon le serveur qui rend la réponse.
 *
 * Les alphabets sans casse (arabe, hébreu, Han) traversent inchangés : la
 * majuscule y est un no-op, ce qui est le comportement correct.
 */
export function firstLetters(source: string, n: number): string {
  const out: string[] = []
  for (const ch of Array.from(source.normalize('NFC'))) {
    if (out.length >= n) break
    if (!/\p{L}/u.test(ch)) continue
    const upper = ch.toUpperCase()
    out.push(Array.from(upper)[0] ?? ch)
  }
  return out.join('')
}

/**
 * Code de masquage, ou `null` si NI le prénom NI le nom ne contient une seule
 * lettre exploitable. `null` — et jamais la chaîne vide — pour que l'appelant
 * soit OBLIGÉ de choisir un libellé de repli : une pastille vide à l'écran est
 * un défaut visible par le client.
 *
 * ASYMÉTRIE VOULUE entre prénom manquant et nom manquant :
 *   - nom absent    → 3 lettres du PRÉNOM. Un code d'une seule lettre n'est
 *     pas un identifiant, et l'ancienne règle divulguait ici le prénom ENTIER :
 *     la nouvelle resserre.
 *   - prénom absent → 2 lettres du NOM, on ne complète pas. Le patronyme est
 *     la partie identifiante : on n'en donne JAMAIS plus de deux lettres, quel
 *     que soit le cas de figure.
 */
export function expertNameCode(
  first_name: string | null | undefined,
  last_name: string | null | undefined,
): string | null {
  const first = (first_name ?? '').trim()
  const last = (last_name ?? '').trim()

  const firstPart = firstLetters(first, 1)
  const lastPart = firstLetters(last, 2)

  if (firstPart && lastPart) return `${firstPart}${lastPart}`
  if (firstPart) return firstLetters(first, 3)
  if (lastPart) return lastPart
  return null
}
