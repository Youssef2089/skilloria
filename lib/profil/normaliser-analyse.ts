// lib/profil/normaliser-analyse.ts
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CE QU'UN CV A DONNÉ, RAMENÉ AUX FORMES QUE LA BASE ATTEND — ET CHAQUE    ║
// ║ RETOUCHE SIGNALÉE (§E.88, point 5 du mandat du 30/09/2026).              ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ⚠️ MODULE PUR : aucun import hors des deux modules purs ci-dessous, aucun accès
//    à la base. `diag-parcours-expert` l'EXÉCUTE sur des analyses fabriquées —
//    « 2020-01 », 7,5 ans, un type « mission », un niveau « natif » — plutôt que
//    de relire son texte (§E.33).
//
// LE PARTAGE DES RÔLES, et il compte :
//   · ICI, les FORMES : une date au mois ou à l'année, une décimale, un type ou un
//     niveau écrit autrement, un code pays, des doublons. Ce sont des lectures du
//     document, pas des bornes de la base.
//   · EN BASE (`ecrire_analyse_cv`), les BORNES : la longueur réelle des colonnes,
//     une fin avant le début, une année hors de ce que la table accepte. Recopier
//     ces bornes ici ferait deux listes qui vieilliraient séparément (§E.20).
//   · Chaque retouche, des deux côtés, devient un ÉCART au code stable, et l'écran
//     les dit (quatre langues).

import { TYPES_EXPERIENCE, estTypeExperience, type TypeExperience } from './types-experience.ts'
import { RESUME_MAX, RESUME_MIN } from '../profile-visibility.ts'

/** Un écart : ce qui a été ramené ou écarté, jamais la valeur (elle peut être personnelle). */
export type Ecart = {
  bloc: 'profil' | 'experiences' | 'formations' | 'langues'
  /** Rang dans la liste, à partir de 1 — tel que l'expert lit son CV. */
  rang?: number
  champ?: string
  code: CodeEcart
}

/** LES CODES STABLES — ceux d'ici et ceux de la base (`ecrire_analyse_cv`). */
export const CODES_ECART = [
  // ramenés ici
  'date_completee', 'nombre_arrondi', 'type_ramene', 'niveau_ramene', 'resume_raccourci',
  // écartés ici
  'date_illisible', 'code_pays_illisible', 'valeur_hors_liste', 'ligne_sans_intitule', 'doublon',
  'adresse_web_illisible',
  // signalés sans rien changer
  'resume_trop_court',
  // de la base
  'texte_tronque', 'valeur_refusee', 'fin_avant_debut', 'annee_hors_bornes', 'champ_obligatoire',
  'nombre_illisible', 'ligne_refusee', 'liste_entierement_refusee',
] as const
export type CodeEcart = (typeof CODES_ECART)[number]

/** Les valeurs que la base accepte pour ces colonnes-là (contraintes de `profiles` et `profile_languages`). */
const SENIORITES = ['junior', 'confirmed', 'senior', 'expert'] as const
const MODES_DE_TRAVAIL = ['remote', 'onsite', 'hybrid'] as const
const NIVEAUX = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'] as const

type Brut = Record<string, unknown>

export type AnalyseNormalisee = {
  /** Les champs du profil, aux formes attendues (clés absentes = rien lu). */
  profil: Record<string, unknown>
  experiences: Array<Record<string, unknown>> | null
  formations: Array<Record<string, unknown>> | null
  langues: Array<{ language: string; level: string; is_primary: boolean }> | null
  ecarts: Ecart[]
}

const texte = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

/** La longueur telle que la BASE la mesure (`char_length`) : en caractères, pas en unités UTF-16. */
export const longueurCaracteres = (s: string): number => Array.from(s).length

/**
 * Une date d'expérience. Un CV écrit « 2020-01 », « 01/2020 », « 2020 » : la base
 * veut un jour. On COMPLÈTE au 1er du mois (ou au 1er janvier) et on le dit.
 * `null` : illisible.
 */
export function normaliserDate(v: unknown): { date: string | null; completee: boolean } {
  const s = texte(v)
  if (!s) return { date: null, completee: false }
  const valide = (a: number, m: number, j: number): boolean => {
    if (a < 1900 || a > 2200 || m < 1 || m > 12 || j < 1) return false
    const d = new Date(Date.UTC(a, m - 1, j))
    return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) {
    const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return valide(a, mo, j) ? { date: `${a}-${pad(mo)}-${pad(j)}`, completee: false } : { date: null, completee: false }
  }
  m = s.match(/^(\d{4})[-/.](\d{1,2})$/) ?? null
  if (m) {
    const [a, mo] = [Number(m[1]), Number(m[2])]
    return valide(a, mo, 1) ? { date: `${a}-${pad(mo)}-01`, completee: true } : { date: null, completee: false }
  }
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/)
  if (m) {
    const [mo, a] = [Number(m[1]), Number(m[2])]
    return valide(a, mo, 1) ? { date: `${a}-${pad(mo)}-01`, completee: true } : { date: null, completee: false }
  }
  m = s.match(/^(\d{4})$/)
  if (m) {
    const a = Number(m[1])
    return valide(a, 1, 1) ? { date: `${a}-01-01`, completee: true } : { date: null, completee: false }
  }
  return { date: null, completee: false }
}

/** Un nombre entier : une décimale est ARRONDIE (et dite), un texte illisible donne `null`. */
export function normaliserEntier(v: unknown): { valeur: number | null; arrondi: boolean } {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN
  if (!Number.isFinite(n)) return { valeur: null, arrondi: false }
  const r = Math.round(n)
  return { valeur: r, arrondi: r !== n }
}

/** Un type d'expérience écrit autrement que la liste : ramené, ou déduit de ce que la ligne porte. */
export function normaliserTypeExperience(v: unknown, employeur: string | null): { type: TypeExperience; ramene: boolean } {
  if (estTypeExperience(v)) return { type: v, ramene: false }
  const s = (typeof v === 'string' ? v : '').trim().toLowerCase()
  if (/^(mission|missions|projet|projets|project|projects|consulting|freelance)$/.test(s)) return { type: 'project', ramene: true }
  if (/^(emploi|poste|job|employment|career|carriere|carrière|cdi|salarie|salarié)$/.test(s)) return { type: 'career', ramene: true }
  // Rien de lisible : un employeur nommé fait une carrière, sinon une mission.
  return { type: employeur ? 'career' : 'project', ramene: true }
}

/** Un niveau de langue écrit autrement que le CECR : ramené, ou `null`. */
export function normaliserNiveau(v: unknown): { niveau: string | null; ramene: boolean } {
  const s = (typeof v === 'string' ? v : '').trim()
  if ((NIVEAUX as readonly string[]).includes(s)) return { niveau: s, ramene: false }
  const u = s.toUpperCase()
  if (/^[ABC][12]$/.test(u)) return { niveau: u, ramene: true }
  const l = s.toLowerCase()
  if (/^(natif|native|langue maternelle|maternelle|mother tongue|nativo|muttersprache)$/.test(l)) return { niveau: 'native', ramene: true }
  if (/^(bilingue|bilingual|courant|fluent|fließend|fluido)$/.test(l)) return { niveau: 'C1', ramene: true }
  if (/^(intermédiaire|intermediaire|intermediate)$/.test(l)) return { niveau: 'B1', ramene: true }
  if (/^(débutant|debutant|beginner|notions)$/.test(l)) return { niveau: 'A2', ramene: true }
  return { niveau: null, ramene: false }
}

/**
 * Le résumé : la base le veut entre 200 et 800 caractères pour publier. Au-delà,
 * on le RACCOURCIT à la dernière phrase entière qui tient ; en deçà, on le garde
 * et on le DIT (on n'invente pas un texte).
 */
export function normaliserResume(v: unknown): { resume: string | null; raccourci: boolean; tropCourt: boolean } {
  const s = texte(v)
  if (!s) return { resume: null, raccourci: false, tropCourt: false }
  const car = Array.from(s)
  if (car.length > RESUME_MAX) {
    const coupe = car.slice(0, RESUME_MAX).join('')
    const fin = Math.max(coupe.lastIndexOf('. '), coupe.lastIndexOf('! '), coupe.lastIndexOf('? '), coupe.lastIndexOf('.\n'))
    const resume = (fin >= RESUME_MIN ? coupe.slice(0, fin + 1) : coupe).trim()
    return { resume, raccourci: true, tropCourt: longueurCaracteres(resume) < RESUME_MIN }
  }
  return { resume: s, raccourci: false, tropCourt: car.length < RESUME_MIN }
}

const listeDans = <T extends string>(v: unknown, admises: readonly T[]): { valeurs: T[]; ecartees: number } => {
  if (!Array.isArray(v)) return { valeurs: [], ecartees: 0 }
  const valeurs: T[] = []
  let ecartees = 0
  for (const x of v) {
    const s = typeof x === 'string' ? x.trim().toLowerCase() : ''
    if ((admises as readonly string[]).includes(s)) {
      if (!valeurs.includes(s as T)) valeurs.push(s as T)
    } else ecartees++
  }
  return { valeurs, ecartees }
}

const textesDistincts = (v: unknown): string[] => {
  if (!Array.isArray(v)) return []
  const vus = new Set<string>()
  const out: string[] = []
  for (const x of v) {
    const t = texte(x)
    if (!t) continue
    const k = t.toLowerCase()
    if (vus.has(k)) continue
    vus.add(k)
    out.push(t)
  }
  return out
}

/**
 * LE CŒUR : l'analyse brute d'un CV (freelance ou CDI) → les formes attendues,
 * et la liste des écarts. Les champs de GOUVERNANCE et d'IDENTITÉ ne passent pas :
 * seule la liste ci-dessous sort d'ici, et la base en tient une seconde (§E.87).
 */
export function normaliserAnalyse(brut: Brut): AnalyseNormalisee {
  const ecarts: Ecart[] = []
  const profil: Record<string, unknown> = {}

  // Textes simples.
  for (const k of ['title', 'location', 'phone', 'address_line', 'postal_code', 'city', 'cdi_career_goals', 'cdi_motivations'] as const) {
    if (k in brut) profil[k] = texte(brut[k])
  }
  // Le résumé.
  if ('summary' in brut) {
    const r = normaliserResume(brut.summary)
    profil.summary = r.resume
    if (r.raccourci) ecarts.push({ bloc: 'profil', champ: 'summary', code: 'resume_raccourci' })
    if (r.tropCourt) ecarts.push({ bloc: 'profil', champ: 'summary', code: 'resume_trop_court' })
  }
  // L'adresse LinkedIn : une adresse web, sinon rien.
  if ('linkedin_url' in brut) {
    const u = texte(brut.linkedin_url)
    const ok = u !== null && /^https?:\/\/\S+$/i.test(u)
    profil.linkedin_url = ok ? u : null
    if (u !== null && !ok) ecarts.push({ bloc: 'profil', champ: 'linkedin_url', code: 'adresse_web_illisible' })
  }
  // Le pays : un code ISO à deux lettres, sinon rien.
  if ('country' in brut) {
    const c = texte(brut.country)
    const ok = c !== null && /^[A-Za-z]{2}$/.test(c)
    profil.country = ok ? c.toUpperCase() : null
    if (c !== null && !ok) ecarts.push({ bloc: 'profil', champ: 'country', code: 'code_pays_illisible' })
  }
  // Les entiers.
  for (const k of ['years_experience', 'years_total_experience', 'tjm_min', 'tjm_max', 'birth_year', 'cdi_salary_min', 'cdi_salary_max', 'cdi_variable_pct'] as const) {
    if (!(k in brut)) continue
    const e = normaliserEntier(brut[k])
    profil[k] = e.valeur
    if (e.arrondi) ecarts.push({ bloc: 'profil', champ: k, code: 'nombre_arrondi' })
  }
  // Les listes à valeurs fermées.
  if ('seniorities' in brut) {
    const s = listeDans(brut.seniorities, SENIORITES)
    profil.seniorities = s.valeurs
    if (s.ecartees > 0) ecarts.push({ bloc: 'profil', champ: 'seniorities', code: 'valeur_hors_liste' })
  }
  if ('work_modes' in brut) {
    const w = listeDans(brut.work_modes, MODES_DE_TRAVAIL)
    profil.work_modes = w.valeurs
    if (w.ecartees > 0) ecarts.push({ bloc: 'profil', champ: 'work_modes', code: 'valeur_hors_liste' })
  }
  // Les listes de textes.
  if ('skills' in brut) profil.skills = textesDistincts(brut.skills)
  if ('languages' in brut) profil.languages = textesDistincts(brut.languages)
  if ('certifications' in brut) profil.certifications = Array.isArray(brut.certifications) ? brut.certifications : []
  // Les codes CDI : passés tels quels ; la base écarte un code hors de sa liste (valeur_refusee).
  for (const k of ['cdi_status', 'cdi_notice_period'] as const) {
    if (k in brut) profil[k] = texte(brut[k])
  }

  // ── Les expériences ──
  let experiences: AnalyseNormalisee['experiences'] = null
  if (Array.isArray(brut.experiences) && brut.experiences.length > 0) {
    experiences = []
    brut.experiences.forEach((x, i) => {
      const e = (x ?? {}) as Brut
      const rang = i + 1
      const role = texte(e.role)
      if (!role) {
        ecarts.push({ bloc: 'experiences', rang, champ: 'role', code: 'ligne_sans_intitule' })
        return
      }
      const debut = normaliserDate(e.start_date)
      if (!debut.date) {
        ecarts.push({ bloc: 'experiences', rang, champ: 'start_date', code: 'date_illisible' })
        return
      }
      if (debut.completee) ecarts.push({ bloc: 'experiences', rang, champ: 'start_date', code: 'date_completee' })
      const enCours = e.is_current === true
      let fin: string | null = null
      if (!enCours && e.end_date != null) {
        const f = normaliserDate(e.end_date)
        if (f.date) {
          fin = f.date
          if (f.completee) ecarts.push({ bloc: 'experiences', rang, champ: 'end_date', code: 'date_completee' })
        } else {
          ecarts.push({ bloc: 'experiences', rang, champ: 'end_date', code: 'date_illisible' })
        }
      }
      const employeur = texte(e.employer)
      const t = normaliserTypeExperience(e.experience_type, employeur)
      if (t.ramene) ecarts.push({ bloc: 'experiences', rang, champ: 'experience_type', code: 'type_ramene' })
      experiences!.push({
        experience_type: t.type,
        role,
        employer: employeur,
        client_name: texte(e.client_name),
        sector: texte(e.sector),
        start_date: debut.date,
        end_date: enCours ? null : fin,
        is_current: enCours,
        description: texte(e.description),
      })
    })
    if (experiences.length === 0) experiences = null
  }

  // ── Les formations ──
  let formations: AnalyseNormalisee['formations'] = null
  const formationsBrutes = Array.isArray(brut.educations) ? brut.educations : []
  if (formationsBrutes.length > 0) {
    formations = []
    formationsBrutes.forEach((x, i) => {
      const f = (x ?? {}) as Brut
      const rang = i + 1
      const ecole = texte(f.school)
      const diplome = texte(f.degree)
      if (!ecole || !diplome) {
        ecarts.push({ bloc: 'formations', rang, code: 'champ_obligatoire' })
        return
      }
      const debut = normaliserEntier(f.start_year)
      const fin = normaliserEntier(f.end_year)
      if (debut.arrondi || fin.arrondi) ecarts.push({ bloc: 'formations', rang, champ: 'annees', code: 'nombre_arrondi' })
      formations!.push({
        school: ecole,
        degree: diplome,
        field: texte(f.field),
        start_year: debut.valeur,
        end_year: fin.valeur,
        location: texte(f.location),
      })
    })
    if (formations.length === 0) formations = null
  }

  // ── Les langues : dédoublonnées, un seul « principal », niveaux ramenés ──
  let langues: AnalyseNormalisee['langues'] = null
  const languesBrutes = Array.isArray(brut.languages_structured) ? brut.languages_structured : []
  if (languesBrutes.length > 0) {
    const vues = new Set<string>()
    let principale = false
    langues = []
    languesBrutes.forEach((x, i) => {
      const l = (x ?? {}) as Brut
      const rang = i + 1
      const nom = texte(l.language)
      if (!nom) return
      const cle = nom.toLowerCase()
      if (vues.has(cle)) {
        ecarts.push({ bloc: 'langues', rang, code: 'doublon' })
        return
      }
      const n = normaliserNiveau(l.level)
      if (!n.niveau) {
        ecarts.push({ bloc: 'langues', rang, champ: 'level', code: 'valeur_hors_liste' })
        return
      }
      if (n.ramene) ecarts.push({ bloc: 'langues', rang, champ: 'level', code: 'niveau_ramene' })
      vues.add(cle)
      const estPrincipale = l.is_primary === true && !principale
      if (estPrincipale) principale = true
      langues!.push({ language: nom, level: n.niveau, is_primary: estPrincipale })
    })
    if (langues.length === 0) langues = null
  }

  return { profil, experiences, formations, langues, ecarts }
}

export { TYPES_EXPERIENCE }
