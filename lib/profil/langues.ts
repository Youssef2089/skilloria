// lib/profil/langues.ts
//
// LES LANGUES PARLÉES — UN CODE EN BASE, UN NOM DANS LA LANGUE DE L'ÉCRAN
// (recette staging du 01/10/2026, point 3 — décision de Youssef : liste fermée,
// jamais de saisie libre).
//
// LE DÉFAUT : `profile_languages.language` recevait du TEXTE LIBRE — ce que l'expert
// tapait, ou ce que l'analyseur du CV écrivait. Un CV en anglais donnait « French,
// English, Arabic », affichés tels quels sur un écran en français ; « Ajouter une
// langue » montrait le texte d'exemple comme s'il était une langue, avec un niveau B2
// choisi d'office.
//
// LA RÈGLE :
//   · la base garde un CODE ISO 639-1 (`fr`, `en`, `ar`) — la liste fermée vit dans la
//     table `langues` (migration `langues_liste_fermee`) ; le déclencheur qui refuse tout code
//     hors liste vient au lot suivant (`langues_garde`, après le déploiement — §E.72) ;
//   · le NOM s'affiche dans la langue de l'écran, par `Intl.DisplayNames` — les quatre
//     langues du produit sans une traduction écrite à la main ;
//   · un nom lu dans un CV (« French », « Français », « Francés », « Französisch »,
//     « français ») est RATTACHÉ à son code par UNE règle et UNE liste : celles de la base
//     (`code_de_langue()` sur `langues` et `langues_noms`). Relecture du 01/10/2026, point 20 :
//     le rattachement passait ici par `Intl` — tout code ISO, 180 langues — et en base par la
//     liste fermée de 92 ; « Latin » devenait `la` à l'écran, hors liste, montré brut (point 12).
//     `rattacheurDeLangues` applique la règle de `code_de_langue` aux lignes LUES de ces deux
//     tables — `diag-recette-s1` compare les deux textes.
//
// ⚠️ MODULE PUR : aucun import, aucun accès à la base — `diag-recette-s1` l'exécute.
//    Une ligne HÉRITÉE (texte libre écrit avant la liste fermée) n'est jamais effacée :
//    `nomDeLangue` la rend telle quelle, et l'écran de validation demande de la choisir.

/** Un code ISO 639-1 : deux lettres minuscules. */
export function estCodeLangue(v: unknown): v is string {
  return typeof v === 'string' && /^[a-z]{2}$/.test(v)
}

function nomsIntl(locale: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' })
  } catch {
    return null
  }
}

/**
 * Le nom d'une langue dans la langue de l'écran, avec sa majuscule (« Français »,
 * « Anglais »). Une valeur qui n'est pas un code connu — une ligne héritée — est
 * rendue TELLE QUELLE : on ne cache jamais ce que la base contient.
 */
export function nomDeLangue(valeur: string, locale: string): string {
  if (!estCodeLangue(valeur)) return valeur
  const nom = nomsIntl(locale)?.of(valeur)
  if (!nom || nom === valeur) return valeur
  return nom.charAt(0).toUpperCase() + nom.slice(1)
}

/** Une langue de la liste fermée, avec son nom dans la langue de l'écran. */
export type LangueProposee = { code: string; nom: string }

/** La liste fermée, nommée et triée dans la langue de l'écran (« Allemand, Anglais, Arabe… »). */
export function listeDesLangues(codes: readonly string[], locale: string): LangueProposee[] {
  return codes
    .filter(estCodeLangue)
    .map((code) => ({ code, nom: nomDeLangue(code, locale) }))
    .sort((a, b) => a.nom.localeCompare(b.nom, locale))
}

/** Les niveaux du CECR que la base accepte (`profile_languages_level_check`). */
export const NIVEAUX_LANGUE = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'] as const

export type LigneLangueSaisie = { language: string; level: string; is_primary: boolean }

/**
 * CE QUI PART AU SERVEUR — et ce qui ne part pas. Une ligne entièrement vide est ignorée (on
 * a cliqué « Ajouter une langue » sans rien choisir). Une ligne dont la langue n'est pas dans
 * la liste (une saisie HÉRITÉE, en texte libre) ou dont le niveau n'est pas choisi BLOQUE
 * l'enregistrement, avec son rang — aucun niveau n'est plus choisi d'office, et rien ne part
 * en silence.
 */
export function languesAEnvoyer(
  lignes: readonly LigneLangueSaisie[],
  codesConnus: ReadonlySet<string>,
):
  | { ok: true; lignes: LigneLangueSaisie[] }
  | { ok: false; raison: 'langue_hors_liste' | 'niveau_manquant'; rang: number } {
  const retenues: LigneLangueSaisie[] = []
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i]
    const langue = l.language.trim()
    if (!langue && !l.level) continue
    if (!codesConnus.has(langue)) return { ok: false, raison: 'langue_hors_liste', rang: i + 1 }
    if (!(NIVEAUX_LANGUE as readonly string[]).includes(l.level)) return { ok: false, raison: 'niveau_manquant', rang: i + 1 }
    retenues.push({ language: langue, level: l.level, is_primary: l.is_primary })
  }
  return { ok: true, lignes: retenues }
}

/** Un nom connu d'une langue, tel que la base le garde (`langues_noms` : minuscules, sans espaces autour). */
export type NomDeLangueConnu = { nom: string; code: string }

/** Le code qu'un texte désigne dans la liste fermée, ou `null` — l'appelant l'écarte et le DIT. */
export type Rattacheur = (texte: string) => string | null

/**
 * LA RÈGLE DE `code_de_langue()` (migration `langues_liste_fermee`), appliquée aux lignes LUES
 * de `langues` et `langues_noms` : le texte, en minuscules et sans espaces autour, est un code
 * de la liste — ou un nom connu d'une langue de la liste. Rien d'autre : aucun `Intl`, aucun
 * alias écrit ici. Une langue manque ? Elle s'ajoute EN BASE, et les deux chemins la voient.
 */
export function rattacheurDeLangues(codes: readonly string[], noms: readonly NomDeLangueConnu[]): Rattacheur {
  const lesCodes = new Set(codes)
  const parNom = new Map(noms.map((n) => [n.nom, n.code] as const))
  return (texte) => {
    const cle = texte.trim().toLowerCase()
    if (cle === '') return null
    if (lesCodes.has(cle)) return cle
    return parNom.get(cle) ?? null
  }
}
