import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { budgetDisponible, enregistrerDepense } from '@/lib/ai-budget'

/**
 * LE JUGEMENT DE CLAUDE — au DÉPÔT d'une candidature, et nulle part ailleurs.
 *
 * ═══ CE QUI A CHANGÉ ══════════════════════════════════════════════════════
 *   Claude notait la mise en relation : cent profils dans un prompt, comparés
 *   entre eux, pour produire des recommandations que personne n'avait demandées.
 *   Il ne le fait plus. Il intervient ici, sur UN couple profil × annonce, au
 *   moment où quelqu'un a décidé de postuler.
 *
 *   Le changement n'est pas qu'un déplacement de coût. C'est un changement de
 *   question :
 *     • au matching  : « pourquoi ce profil apparaît-il ? » — une question de
 *       pertinence, à laquelle un reranker répond mieux, sans compétition ;
 *     • à la candidature : « que vaut ce dossier ? » — une question de jugement,
 *       adressée à une organisation qui va y consacrer du temps.
 *
 * ═══ DEUX TEXTES, DEUX DESTINATAIRES ══════════════════════════════════════
 *   `reason`    va à l'EXPERT : ce que son dossier a de solide, ce qui manque.
 *   `pitch_org` va à l'ORGANISATION, et il est affiché AVANT le déverrouillage
 *               payant. D'où l'interdiction stricte, dans la consigne, de nommer
 *               un employeur, un client ou une personne : ce texte doit rester
 *               compatible avec le masquage, sinon il le contourne.
 *
 * ═══ IL NE BLOQUE JAMAIS UNE CANDIDATURE ══════════════════════════════════
 *   Un dépôt réussit même si Claude ne répond pas. La note reste nulle, les
 *   écrans savent se taire, et l'organisation dévoile à la main. Faire échouer
 *   un dépôt parce qu'un modèle est indisponible serait punir l'expert d'une
 *   panne qui ne le concerne pas.
 */

const MODELE = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 1200
const TIMEOUT_MS = 20_000

/**
 * Coût unitaire estimé d'un jugement, en dollars.
 *
 * Écrit ici parce que le plafond mensuel s'appuie dessus. On enregistre AUSSI le
 * nombre de jetons réellement consommés (`units`) : le coût se recalcule, le
 * volume non.
 */
const COUT_USD_PAR_1M_JETONS_ENTREE = 1
const COUT_USD_PAR_1M_JETONS_SORTIE = 5

export type EntreeJugement = {
  locale: 'fr' | 'en' | 'es' | 'de'
  annonce: {
    type: string
    title: string
    description: string
    skills_required: string[]
    seniorities: string[]
  }
  profil: {
    title: string | null
    summary: string | null
    skills: string[]
    seniorities: string[]
    years_total_experience: number | null
    /** Rôles et secteurs. JAMAIS d'employeur : ce texte peut être servi masqué. */
    experiences: Array<{ role: string | null; sector: string | null }>
  }
}

export type Jugement = {
  score: number
  reason: string
  pitch_org: string
  model: string
}

export type ResultatJugement =
  | { ok: true; jugement: Jugement }
  | { ok: false; raison: string }

const LANGUES: Record<EntreeJugement['locale'], string> = {
  fr: 'français',
  en: 'anglais',
  es: 'espagnol',
  de: 'allemand',
}

function construirePrompt(e: EntreeJugement): string {
  const p = e.profil
  const a = e.annonce
  const parcours = p.experiences
    .map((x) => [x.role, x.sector].filter(Boolean).join(' — '))
    .filter(Boolean)
    .slice(0, 8)

  return `Tu évalues UNE candidature pour UNE annonce. Tu ne compares ce dossier à aucun autre : aucun autre dossier ne t'est présenté, et tu ne dois en supposer aucun.

ANNONCE
Titre : ${a.title}
Description : ${a.description}
Compétences attendues : ${a.skills_required.join(', ') || '(non précisées)'}
Séniorités recherchées : ${a.seniorities.join(', ') || '(non précisées)'}

DOSSIER
Titre : ${p.title ?? '(non précisé)'}
Résumé : ${p.summary ?? '(non précisé)'}
Compétences : ${p.skills.join(', ') || '(non précisées)'}
Séniorités déclarées : ${p.seniorities.join(', ') || '(non précisées)'}
Expérience totale : ${p.years_total_experience != null ? `${p.years_total_experience} an(s)` : '(non précisée)'}
Parcours : ${parcours.join(' | ') || '(non précisé)'}

CE QUE TU PRODUIS
1. "score" : un entier de 0 à 10. 0-3 le dossier ne répond pas au besoin ; 4-6 il y répond partiellement ; 7-8 il y répond ; 9-10 il y répond avec des éléments qui vont au-delà.
2. "reason" : 2 phrases maximum, adressées À L'EXPERT, en ${LANGUES[e.locale]}. Dis ce que son dossier a de solide pour ce besoin, et ce qui n'y répond pas. Sois précis et factuel ; ne le flatte pas et ne le décourage pas.
3. "pitch_org" : 2 phrases maximum, adressées À L'ORGANISATION, en ${LANGUES[e.locale]}. Dis ce que cette personne apporte à ce besoin précis.

INTERDICTIONS ABSOLUES pour "pitch_org"
- Ne nomme JAMAIS une personne, un employeur, un client, une école ni une ville. Ce texte est affiché AVANT que l'organisation n'ait accès à l'identité du candidat : le moindre nom contournerait ce masquage.
- N'invente rien qui ne figure pas dans le dossier ci-dessus.

Réponds STRICTEMENT en JSON, sans aucun texte avant ou après :
{"score": <entier 0..10>, "reason": "<texte>", "pitch_org": "<texte>"}`
}

/** Lecture STRICTE : l'absence de note est un ÉCHEC, jamais une valeur de repli. */
export function lireNote(valeur: unknown): number | null {
  let brut: number
  if (typeof valeur === 'number') brut = valeur
  else if (typeof valeur === 'string' && valeur.trim().length > 0) brut = Number(valeur)
  else return null
  if (!Number.isFinite(brut)) return null
  return Math.max(0, Math.min(10, Math.round(brut)))
}

/** Un texte vide n'est pas un texte : le rendre vaudrait mieux se taire. */
export function lireTexte(valeur: unknown, maxCaracteres: number): string | null {
  if (typeof valeur !== 'string') return null
  const t = valeur.replace(/\s+/g, ' ').trim()
  if (t.length === 0) return null
  return t.length > maxCaracteres ? `${t.slice(0, maxCaracteres).trimEnd()}…` : t
}

function texteFinal(reponse: Anthropic.Messages.Message): string {
  let out = ''
  for (const bloc of reponse.content) {
    if (bloc.type === 'text' && 'text' in bloc) out += `${bloc.text}\n`
  }
  return out
}

function extraireJson(texte: string): Record<string, unknown> | null {
  const debut = texte.indexOf('{')
  const fin = texte.lastIndexOf('}')
  if (debut === -1 || fin <= debut) return null
  try {
    const v = JSON.parse(texte.slice(debut, fin + 1))
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function jugerCandidature(args: {
  supabaseAdmin: SupabaseClient
  domainId: string | null
  entree: EntreeJugement
  candidatureId: string
}): Promise<ResultatJugement> {
  if (process.env.ENABLE_AI_CANDIDATURE_ASSESSMENT === 'false') {
    return { ok: false, raison: 'jugement désactivé par interrupteur' }
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[jugement] ANTHROPIC_API_KEY absente')
    return { ok: false, raison: 'clé du modèle absente de l environnement' }
  }

  // Le budget est vérifié AVANT l'appel. Au plafond, on ne juge pas — et on le
  // dit : la candidature existe, elle est simplement sans note, et l'écran sait
  // se taire.
  const budget = await budgetDisponible(args.supabaseAdmin, 'claude')
  if (!budget.ok) {
    console.warn('[jugement] non rendu', { candidature: args.candidatureId, raison: budget.raison })
    return { ok: false, raison: budget.raison }
  }

  let reponse: Anthropic.Messages.Message
  try {
    const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS })
    reponse = await client.messages.create({
      model: MODELE,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: construirePrompt(args.entree) }],
    })
  } catch (err) {
    // AUCUN second essai. Une candidature n'attend pas : le dossier est déjà
    // déposé, et un jugement qui arrive avec trente secondes de retard ne sert
    // personne. L'absence de note est un état prévu, pas une panne.
    console.error('[jugement] appel en échec', {
      candidature: args.candidatureId,
      cause: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, raison: 'appel au modèle en échec' }
  }

  // Dépense enregistrée sur les jetons RÉELLEMENT consommés, pas sur une
  // estimation : un plafond réglé sur des estimations dérive.
  const entree = reponse.usage?.input_tokens ?? 0
  const sortie = reponse.usage?.output_tokens ?? 0
  await enregistrerDepense(args.supabaseAdmin, {
    provider: 'claude',
    domain_id: args.domainId,
    units: entree + sortie,
    cost_usd:
      (entree / 1_000_000) * COUT_USD_PAR_1M_JETONS_ENTREE +
      (sortie / 1_000_000) * COUT_USD_PAR_1M_JETONS_SORTIE,
    context: { model: MODELE, candidature_id: args.candidatureId },
  })

  const charge = extraireJson(texteFinal(reponse))
  if (!charge) {
    console.error('[jugement] réponse illisible', { candidature: args.candidatureId })
    return { ok: false, raison: 'réponse du modèle illisible' }
  }

  const score = lireNote(charge.score)
  const reason = lireTexte(charge.reason, 400)
  const pitch = lireTexte(charge.pitch_org, 400)

  // Un jugement incomplet n'est pas un demi-jugement : c'est une absence de
  // jugement. Le compléter par des valeurs de repli produirait un verdict que
  // personne n'a rendu — exactement le défaut corrigé sur la porte de
  // publication.
  if (score == null || !reason || !pitch) {
    console.error('[jugement] réponse incomplète', {
      candidature: args.candidatureId,
      score_present: score != null,
      reason_present: !!reason,
      pitch_present: !!pitch,
    })
    return { ok: false, raison: 'jugement incomplet rendu par le modèle' }
  }

  return { ok: true, jugement: { score, reason, pitch_org: pitch, model: MODELE } }
}
