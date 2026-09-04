import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { budgetDisponible, enregistrerDepense } from '@/lib/ai-budget'
// Les quatre barrières de conformité vivent à part, SANS aucune dépendance :
// c'est ce qui les rend éprouvables à l'exécution, hors de tout client HTTP.
// Un garde-fou qu'on ne peut pas éprouver n'est qu'une intention.
import { contientUneAnnee, expurgerAnnees, lireNote, lireTexte } from './conformite'

export { contientUneAnnee, expurgerAnnees, lireNote, lireTexte } from './conformite'

/**
 * LE JUGEMENT DE CLAUDE — au DÉPÔT d'une candidature, et le PITCH à la demande.
 *
 * ═══ LE SEUL ENDROIT OÙ CLAUDE SUBSISTE ═══════════════════════════════════
 *   Il notait la mise en relation : cent profils dans un prompt, comparés entre
 *   eux. Il n'y est plus. Il intervient ici, sur UN couple profil × annonce, et
 *   la question a changé :
 *     • au matching  : « pourquoi ce profil apparaît-il ? » — de la pertinence,
 *       à laquelle un reranker répond mieux, sans compétition ;
 *     • ici          : « que vaut ce dossier ? » — un jugement, adressé à une
 *       organisation qui va y consacrer du temps, puis de l'argent.
 *
 *   Volume faible, texte lu avant paiement : c'est ce qui justifie le modèle le
 *   plus capable plutôt que le moins cher.
 *
 * ═══ DEUX TEXTES, DEUX DESTINATAIRES ══════════════════════════════════════
 *   `reason`    va à l'EXPERT : ce que son dossier a de solide, ce qui manque.
 *   `pitch_org` va à l'ORGANISATION, et il est affiché AVANT le déverrouillage
 *               payant.
 *
 * ═══ LA CONFORMITÉ N'EST PAS CONFIÉE AU PROMPT SEUL ═══════════════════════
 *   Une consigne de rédaction est une intention, pas une garantie. Trois
 *   barrières, dans cet ordre :
 *
 *     1. CE QUI ENTRE. Le type d'entrée ne PEUT PAS porter de nom, d'employeur,
 *        de client, d'école ni de date : ces champs n'existent pas. Ce n'est pas
 *        un filtre, c'est une absence.
 *     2. CE QUI ENTRE, BIS. Les textes libres (résumé, description de poste)
 *        sont expurgés de toute ANNÉE avant l'envoi — un expert écrit « diplômé
 *        en 2015 » dans son résumé sans y penser, et l'année est une donnée
 *        identifiante autant qu'un discriminant d'âge.
 *     3. CE QUI SORT. Le texte est REFUSÉ s'il contient une année. On ne fait
 *        pas confiance à la consigne : on vérifie ce qui a été produit.
 *
 *   La durée reste dite en RELATIF (« huit ans d'expérience »), jamais en dates.
 *
 * ═══ IL NE BLOQUE JAMAIS UNE CANDIDATURE ══════════════════════════════════
 *   Un dépôt réussit même si Claude ne répond pas, ou si le plafond mensuel est
 *   atteint. La note reste nulle, les écrans savent se taire, l'organisation
 *   dévoile à la main, et `candidature_ai_health()` compte les dossiers sans
 *   jugement. Faire échouer un dépôt pour une panne qui ne concerne pas
 *   l'expert serait le punir de quelque chose qu'il ne peut ni voir ni corriger.
 */

/**
 * Modèle le plus capable de la famille.
 *
 * Ce n'est pas un réflexe : c'est le SEUL appel de modèle qui subsiste hors
 * analyse de CV, son volume est d'un appel par candidature, et son texte est lu
 * par l'organisation AVANT qu'elle paie. Économiser ici se verrait dans la
 * qualité de la seule chose qu'on lui donne à lire.
 */
const MODELE = 'claude-sonnet-5'
const MAX_TOKENS = 1200
const TIMEOUT_MS = 30_000

/**
 * Coût par million de jetons, en dollars. Écrit ici parce que le plafond
 * mensuel s'appuie dessus ; on journalise AUSSI le volume brut de jetons, pour
 * que le coût reste recalculable quand la grille change.
 */
const COUT_USD_PAR_1M_ENTREE = 3
const COUT_USD_PAR_1M_SORTIE = 15

export type Langue = 'fr' | 'en' | 'es' | 'de'

/**
 * Ce que le modèle reçoit.
 *
 * REGARDEZ CE QUI N'Y EST PAS : ni nom, ni employeur, ni client, ni école, ni
 * ville, ni date, ni année de diplôme. Ces champs n'existent pas dans ce type —
 * on ne peut donc pas les transmettre par étourderie.
 */
export type EntreeJugement = {
  locale: Langue
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
    /** Durée RELATIVE, en années. Jamais une date. */
    years_total_experience: number | null
    /** Rôle et secteur seulement. L'employeur est absent du type. */
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

const LANGUES: Record<Langue, string> = {
  fr: 'français',
  en: 'anglais',
  es: 'espagnol',
  de: 'allemand',
}

const propre = (v: string | null | undefined): string => (v ?? '').replace(/\s+/g, ' ').trim()

function construirePrompt(e: EntreeJugement): string {
  const p = e.profil
  const a = e.annonce
  const parcours = p.experiences
    .map((x) => [propre(x.role), propre(x.sector)].filter(Boolean).join(' — '))
    .filter(Boolean)
    .slice(0, 8)

  // Les deux textes libres sont expurgés de toute année AVANT l'envoi.
  const resume = expurgerAnnees(propre(p.summary)) || '(non précisé)'
  const description = expurgerAnnees(propre(a.description))

  return `Tu évalues UNE candidature pour UNE annonce. Tu ne compares ce dossier à aucun autre : aucun autre dossier ne t'est présenté, et tu ne dois en supposer aucun.

ANNONCE
Titre : ${propre(a.title)}
Description : ${description}
Compétences attendues : ${a.skills_required.join(', ') || '(non précisées)'}
Séniorités recherchées : ${a.seniorities.join(', ') || '(non précisées)'}

DOSSIER
Titre : ${propre(p.title) || '(non précisé)'}
Résumé : ${resume}
Compétences : ${p.skills.join(', ') || '(non précisées)'}
Séniorités déclarées : ${p.seniorities.join(', ') || '(non précisées)'}
Expérience totale : ${p.years_total_experience != null ? `${p.years_total_experience} an(s)` : '(non précisée)'}
Parcours : ${parcours.join(' | ') || '(non précisé)'}

CE QUE TU PRODUIS
1. "score" : un entier de 0 à 10. 0-3 le dossier ne répond pas au besoin ; 4-6 il y répond partiellement ; 7-8 il y répond ; 9-10 il y répond avec des éléments qui vont au-delà.
2. "reason" : 2 phrases maximum, adressées À L'EXPERT, en ${LANGUES[e.locale]}. Dis ce que son dossier a de solide pour ce besoin, et ce qui n'y répond pas. Sois précis et factuel ; ne le flatte pas et ne le décourage pas.
3. "pitch_org" : 2 phrases maximum, adressées À L'ORGANISATION, en ${LANGUES[e.locale]}. Dis ce que cette personne apporte à ce besoin précis.

INTERDICTIONS ABSOLUES, POUR LES DEUX TEXTES
- Ne nomme JAMAIS une personne, un employeur, un client, une école ni une ville. Ces textes sont affichés AVANT que l'organisation n'ait accès à l'identité du candidat : le moindre nom contournerait ce masquage.
- N'écris JAMAIS d'année ni de date. Exprime toute durée en RELATIF : « huit ans d'expérience », « plusieurs années sur ce type de poste ». Une année de diplôme est une donnée identifiante, et un discriminant d'âge.
- N'invente rien qui ne figure pas dans le dossier ci-dessus.

Réponds STRICTEMENT en JSON, sans aucun texte avant ou après :
{"score": <entier 0..10>, "reason": "<texte>", "pitch_org": "<texte>"}`
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

/**
 * L'appel, une seule fois, sans second essai.
 *
 * AUCUN REPLI DE MODÈLE, et c'est délibéré : le dossier est déjà déposé, et un
 * jugement qui arrive trente secondes plus tard ne sert personne. L'absence de
 * jugement est un état PRÉVU, compté par `candidature_ai_health()`.
 */
async function appeler(args: {
  supabaseAdmin: SupabaseClient
  domainId: string | null
  prompt: string
  contexte: Record<string, unknown>
}): Promise<{ ok: true; charge: Record<string, unknown> } | { ok: false; raison: string }> {
  if (process.env.ENABLE_AI_CANDIDATURE_ASSESSMENT === 'false') {
    return { ok: false, raison: 'jugement désactivé par interrupteur' }
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[jugement] ANTHROPIC_API_KEY absente')
    return { ok: false, raison: 'clé du modèle absente de l environnement' }
  }

  // Le budget est vérifié AVANT l'appel. Au plafond, on ne juge pas — et on le
  // DIT : la candidature existe, elle est simplement sans note.
  const budget = await budgetDisponible(args.supabaseAdmin, 'claude')
  if (!budget.ok) {
    console.warn('[jugement] non rendu', { ...args.contexte, raison: budget.raison })
    return { ok: false, raison: budget.raison }
  }

  let reponse: Anthropic.Messages.Message
  try {
    const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS })
    reponse = await client.messages.create({
      model: MODELE,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: args.prompt }],
    })
  } catch (err) {
    console.error('[jugement] appel en échec', {
      ...args.contexte,
      cause: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, raison: 'appel au modèle en échec' }
  }

  // Dépense enregistrée sur les jetons RÉELLEMENT consommés, jamais estimés.
  const entree = reponse.usage?.input_tokens ?? 0
  const sortie = reponse.usage?.output_tokens ?? 0
  await enregistrerDepense(args.supabaseAdmin, {
    provider: 'claude',
    domain_id: args.domainId,
    units: entree + sortie,
    cost_usd:
      (entree / 1_000_000) * COUT_USD_PAR_1M_ENTREE + (sortie / 1_000_000) * COUT_USD_PAR_1M_SORTIE,
    context: { model: MODELE, ...args.contexte },
  })

  const charge = extraireJson(texteFinal(reponse))
  if (!charge) {
    console.error('[jugement] réponse illisible', args.contexte)
    return { ok: false, raison: 'réponse du modèle illisible' }
  }
  return { ok: true, charge }
}

export async function jugerCandidature(args: {
  supabaseAdmin: SupabaseClient
  domainId: string | null
  entree: EntreeJugement
  candidatureId: string
}): Promise<ResultatJugement> {
  const appel = await appeler({
    supabaseAdmin: args.supabaseAdmin,
    domainId: args.domainId,
    prompt: construirePrompt(args.entree),
    contexte: { candidature_id: args.candidatureId },
  })
  if (!appel.ok) return { ok: false, raison: appel.raison }

  const score = lireNote(appel.charge.score)
  const reason = lireTexte(appel.charge.reason)
  const pitch = lireTexte(appel.charge.pitch_org)

  // Un jugement incomplet n'est pas un demi-jugement : c'est une absence de
  // jugement. Le compléter par des valeurs de repli produirait un verdict que
  // personne n'a rendu — le défaut exact corrigé sur la porte de publication.
  if (score == null || !reason || !pitch) {
    console.error('[jugement] réponse incomplète', {
      candidature: args.candidatureId,
      score_present: score != null,
      reason_present: !!reason,
      pitch_present: !!pitch,
    })
    return { ok: false, raison: 'jugement incomplet rendu par le modèle' }
  }

  // TROISIÈME BARRIÈRE : on vérifie le texte produit, on ne se fie pas à la
  // consigne. Une année dans un texte lu avant le déverrouillage est une donnée
  // identifiante que le masquage n'aurait pas arrêtée.
  if (contientUneAnnee(pitch) || contientUneAnnee(reason)) {
    console.error('[jugement] texte REFUSÉ : contient une année malgré la consigne', {
      candidature: args.candidatureId,
    })
    return { ok: false, raison: 'texte produit non conforme (année présente)' }
  }

  return { ok: true, jugement: { score, reason, pitch_org: pitch, model: MODELE } }
}

/**
 * LE PITCH À LA DEMANDE — un appel par profil RÉELLEMENT ouvert.
 *
 * POURQUOI À LA DEMANDE ET PAS D'AVANCE
 *   Une annonce peut avoir des centaines de profils. En rédiger un pitch pour
 *   chacun coûterait des centaines d'appels dont l'organisation n'en lirait
 *   qu'une poignée. On rédige donc quand quelqu'un ouvre la carte, et UNE SEULE
 *   FOIS : le texte est écrit dans `matches.explanation` et n'est jamais
 *   régénéré.
 *
 * POURQUOI JAMAIS RÉGÉNÉRÉ
 *   Deux raisons, et la seconde compte plus que la première. Le coût, d'abord.
 *   Mais surtout : un texte qui change entre deux ouvertures ferait douter
 *   l'organisation de ce qu'elle a lu la première fois. Un jugement rendu est
 *   rendu.
 */
export type ResultatPitch =
  | { ok: true; pitch: string; deja: boolean }
  | { ok: false; raison: string }

export async function redigerPitchOrg(args: {
  supabaseAdmin: SupabaseClient
  domainId: string | null
  matchId: string
  /** Le pitch déjà écrit, s'il existe. Fourni par l'appelant, qui l'a déjà lu. */
  pitchExistant: string | null
  entree: EntreeJugement
}): Promise<ResultatPitch> {
  const dejaEcrit = lireTexte(args.pitchExistant)
  if (dejaEcrit) return { ok: true, pitch: dejaEcrit, deja: true }

  const appel = await appeler({
    supabaseAdmin: args.supabaseAdmin,
    domainId: args.domainId,
    prompt: construirePrompt(args.entree),
    contexte: { match_id: args.matchId },
  })
  if (!appel.ok) return { ok: false, raison: appel.raison }

  const pitch = lireTexte(appel.charge.pitch_org)
  if (!pitch) return { ok: false, raison: 'aucun pitch rendu par le modèle' }
  if (contientUneAnnee(pitch)) {
    console.error('[pitch] texte REFUSÉ : contient une année malgré la consigne', {
      match: args.matchId,
    })
    return { ok: false, raison: 'texte produit non conforme (année présente)' }
  }
  return { ok: true, pitch, deja: false }
}
