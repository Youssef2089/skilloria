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
//     table `langues`, et un déclencheur refuse tout code hors liste (migration
//     `langues_liste_fermee`) ;
//   · le NOM s'affiche dans la langue de l'écran, par `Intl.DisplayNames` — les quatre
//     langues du produit sans une traduction écrite à la main ;
//   · un nom lu dans un CV (« French », « Français », « Francés », « Französisch »,
//     « français ») est RATTACHÉ à son code ici, avant l'écriture.
//
// ⚠️ MODULE PUR : aucun import, aucun accès à la base — `diag-recette-s1` l'exécute.
//    Une ligne HÉRITÉE (texte libre écrit avant la liste fermée) n'est jamais effacée :
//    `nomDeLangue` la rend telle quelle, et l'écran de validation demande de la choisir.

const LOCALES_DU_PRODUIT = ['fr', 'en', 'es', 'de'] as const

/** Un code ISO 639-1 : deux lettres minuscules. */
export function estCodeLangue(v: unknown): v is string {
  return typeof v === 'string' && /^[a-z]{2}$/.test(v)
}

const sansAccents = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

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

/** Les noms courants qu'`Intl` ne porte pas (il dit « Chinese », pas « Mandarin »). */
const ALIAS: Readonly<Record<string, string>> = { mandarin: 'zh', farsi: 'fa' }

let index: Map<string, string> | null = null

/** Tous les noms connus d'une langue → son code : dans les quatre langues du produit ET dans la sienne. */
function indexDesNoms(): Map<string, string> {
  if (index) return index
  const m = new Map<string, string>()
  const lecteurs = LOCALES_DU_PRODUIT.map((l) => nomsIntl(l)).filter((x): x is Intl.DisplayNames => x !== null)
  const a = 'a'.charCodeAt(0)
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(a + i) + String.fromCharCode(a + j)
      const noms = lecteurs.map((d) => d.of(code)).filter((n): n is string => typeof n === 'string' && n !== code)
      if (noms.length === 0) continue
      const natif = nomsIntl(code)?.of(code)
      if (natif && natif !== code) noms.push(natif)
      for (const n of noms) {
        const cle = sansAccents(n)
        if (!m.has(cle)) m.set(cle, code)
      }
    }
  }
  for (const [nom, code] of Object.entries(ALIAS)) if (!m.has(nom)) m.set(nom, code)
  index = m
  return m
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

/**
 * Le code d'une langue écrite par un CV ou par une ancienne saisie : un code ISO
 * (« FR », « fr ») ou un nom dans l'une des quatre langues du produit ou dans la
 * sienne. `null` si rien ne s'y rattache — l'appelant l'écarte et le DIT.
 */
export function codeDeLangue(texte: unknown): string | null {
  if (typeof texte !== 'string') return null
  const t = texte.trim()
  if (t.length === 0) return null
  const minuscule = t.toLowerCase()
  if (estCodeLangue(minuscule)) {
    const nom = nomsIntl('en')?.of(minuscule)
    if (nom && nom !== minuscule) return minuscule
  }
  return indexDesNoms().get(sansAccents(t)) ?? null
}
