import { capaciteActive } from '@/lib/interrupteurs'
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { budgetDisponible, enregistrerDepense } from '@/lib/ai-budget'
// Deux LECTEURS, pas deux filtres : ils vérifient que le modèle a répondu
// quelque chose d'exploitable, ils ne jugent pas le contenu du texte. Sans
// aucune dépendance, donc éprouvables à l'exécution.
import { lireNote, lireTexte } from './lecture-reponse'

export { lireNote, lireTexte } from './lecture-reponse'

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
 * ═══ DEUX TEXTES, DEUX DESTINATAIRES ══════════════════════════════════════
 *   `reason`    va à l'EXPERT : ce que son dossier a de solide, ce qui manque.
 *   `pitch_org` va à l'ORGANISATION, et il est affiché AVANT le déverrouillage
 *               payant.
 *
 * ═══ LA CONFORMITÉ VIT DANS LE PROMPT, ET NULLE PART AILLEURS ═════════════
 *   Il y avait une seconde barrière : les années étaient expurgées du document
 *   envoyé, et un texte produit qui en contenait était refusé. Elle est
 *   RETIRÉE, aux deux bouts.
 *
 *   Ce qui l'a condamnée n'est pas le refus, c'est l'AMPUTATION. Sur une place
 *   de marché Microsoft, les produits portent des années : SQL Server 2019,
 *   Dynamics AX 2012, SharePoint 2016. Le modèle recevait « Expert Dynamics AX
 *   … et SQL Server … » — privé de la précision technique qui fait justement la
 *   valeur des profils les plus pointus, ceux pour lesquels une organisation
 *   paie le déverrouillage. On effaçait la compétence en croyant protéger
 *   l'âge.
 *
 *   La règle est donc redevenue une consigne, écrite en toutes lettres : ce qui
 *   est interdit, ce qui est EXPLICITEMENT AUTORISÉ, et ce qui est exigé.
 *   Autoriser explicitement les produits versionnés n'est pas un détail : sans
 *   cela, un modèle prudent les éviterait de lui-même, et le défaut serait
 *   reproduit par un autre chemin.
 *
 * ═══ RIEN NE BLOQUE UNE CANDIDATURE. C'EST LA RÈGLE LA PLUS IMPORTANTE ════
 *   Modèle muet, plafond atteint, réponse illisible : la candidature est
 *   déposée normalement et l'organisation la reçoit. Il manque un texte
 *   d'agrément, pas un dossier. Chaque échec rend une CAUSE, et cette cause est
 *   comptée (`ai_redaction_failures`) pour que l'absence de résumés se voie.
 */

/**
 * Modèle le plus capable de la famille.
 *
 * Ce n'est pas un réflexe : c'est le SEUL appel de modèle qui subsiste hors
 * analyse de CV, son volume est d'un appel par candidature, et son texte est lu
 * par l'organisation AVANT qu'elle paie. Économiser ici se verrait dans la
 * qualité de la seule chose qu'on lui donne à lire — et depuis ce lot, c'est
 * lui, et lui seul, qui porte les règles de conformité.
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
 * Les trois raisons pour lesquelles un résumé n'est pas écrit.
 *
 * Elles restent DISTINCTES jusqu'à l'affichage : un compteur unique dirait
 * seulement « il en manque beaucoup », là où trois compteurs disent lequel des
 * trois problèmes on a — et donc quoi faire.
 */
export type CausePanne = 'plafond' | 'modele_indisponible' | 'reponse_illisible'

/**
 * Ce que le modèle reçoit.
 *
 * REGARDEZ CE QUI N'Y EST PAS : ni nom, ni employeur, ni client, ni école, ni
 * ville, ni date. Ces champs n'existent pas dans ce type — on ne peut donc pas
 * les transmettre par étourderie. C'est la seule barrière STRUCTURELLE qui
 * subsiste, et c'est la plus solide : une absence ne se contourne pas.
 *
 * Le résumé et la description, eux, partent INTACTS. Ils sont écrits par
 * l'expert et par l'organisation ; les amputer pour se rassurer revenait à
 * juger un dossier sur un extrait qu'on a soi-même abîmé.
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
    /** Durée RELATIVE, en années écoulées. Jamais une date. */
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
  | { ok: false; cause: CausePanne; raison: string }

const LANGUES: Record<Langue, string> = {
  fr: 'français',
  en: 'anglais',
  es: 'espagnol',
  de: 'allemand',
}

const propre = (v: string | null | undefined): string => (v ?? '').replace(/\s+/g, ' ').trim()

/**
 * LE PROMPT DE RÉDACTION — il porte désormais TOUTE la conformité.
 *
 * Les trois blocs d'instruction ne sont pas décoratifs :
 *   INTERDIT   — ce qui identifierait la personne avant le déverrouillage ;
 *   AUTORISÉ   — les produits versionnés, dits explicitement, sans quoi un
 *                modèle prudent les éviterait et amputerait le texte lui-même ;
 *   EXIGÉ      — la durée en relatif, là où une date viendrait naturellement.
 *
 * Les trois valent pour les DEUX textes. Le texte destiné à l'expert traverse
 * les mêmes écrans que celui destiné à l'organisation.
 */
function construirePrompt(e: EntreeJugement): string {
  const p = e.profil
  const a = e.annonce
  const parcours = p.experiences
    .map((x) => [propre(x.role), propre(x.sector)].filter(Boolean).join(' — '))
    .filter(Boolean)
    .slice(0, 8)

  return `Tu évalues UNE candidature pour UNE annonce. Tu ne compares ce dossier à aucun autre : aucun autre dossier ne t'est présenté, et tu ne dois en supposer aucun.

ANNONCE
Titre : ${propre(a.title)}
Description : ${propre(a.description)}
Compétences attendues : ${a.skills_required.join(', ') || '(non précisées)'}
Séniorités recherchées : ${a.seniorities.join(', ') || '(non précisées)'}

DOSSIER
Titre : ${propre(p.title) || '(non précisé)'}
Résumé : ${propre(p.summary) || '(non précisé)'}
Compétences : ${p.skills.join(', ') || '(non précisées)'}
Séniorités déclarées : ${p.seniorities.join(', ') || '(non précisées)'}
Expérience totale : ${p.years_total_experience != null ? `${p.years_total_experience} an(s)` : '(non précisée)'}
Parcours : ${parcours.join(' | ') || '(non précisé)'}

CE QUE TU PRODUIS
1. "score" : un entier de 0 à 10. 0-3 le dossier ne répond pas au besoin ; 4-6 il y répond partiellement ; 7-8 il y répond ; 9-10 il y répond avec des éléments qui vont au-delà.
2. "reason" : 2 phrases maximum, adressées À L'EXPERT, en ${LANGUES[e.locale]}. Dis ce que son dossier a de solide pour ce besoin, et ce qui n'y répond pas. Sois précis et factuel ; ne le flatte pas et ne le décourage pas.
3. "pitch_org" : 2 phrases maximum, adressées À L'ORGANISATION, en ${LANGUES[e.locale]}. Dis ce que cette personne apporte à ce besoin précis.

═══ RÈGLES DE RÉDACTION — ELLES VALENT POUR LES DEUX TEXTES ═══

Ces deux textes sont affichés AVANT que l'organisation n'ait accès à l'identité du candidat. Ce sont les seuls textes qui traversent ce masquage : ce que tu y écris ne peut plus être retiré.

INTERDIT — n'écris JAMAIS :
- une année de diplôme, une année de naissance, une année de début de carrière, ni aucune date de début ou de fin de poste ;
- le nom d'un employeur ou d'un client de cette personne, même s'il apparaît dans le dossier ci-dessus ;
- le nom d'une personne, d'une école, d'une ville ou d'un quartier ;
- toute autre donnée permettant d'identifier la personne : identifiant, adresse, coordonnée, particularité unique.

AUTORISÉ, ET MÊME ATTENDU — écris SANS HÉSITER :
- les noms de produits et de technologies, Y COMPRIS lorsqu'ils contiennent une année, car l'année fait partie du nom du produit et non de l'identité de la personne. Exemples : Dynamics AX 2012, SQL Server 2019, SharePoint 2016, Windows Server 2022, Visual Studio 2022, Exchange 2019, Office 365.
- Ces versions sont ce qui distingue un profil d'un autre sur cet écosystème. Les taire appauvrirait ton texte exactement là où il a le plus de valeur.

EXIGÉ — pour toute notion de durée :
- exprime-la en RELATIF, jamais par des dates. Écris « 8 ans sur Dynamics », « plusieurs années sur ce type de poste », « une expérience récente sur cette version » ;
- n'écris jamais « depuis 2016 », « de 2019 à 2022 », « diplômé en 2015 ».

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
 * jugement est un état PRÉVU — et désormais COMPTÉ, avec sa cause.
 */
async function appeler(args: {
  supabaseAdmin: SupabaseClient
  domainId: string | null
  prompt: string
  contexte: Record<string, unknown>
}): Promise<
  { ok: true; charge: Record<string, unknown> } | { ok: false; cause: CausePanne; raison: string }
> {
  // Convention unique, fail-closed (cf. lib/interrupteurs.ts) : seule la
  // valeur exacte 'true' active. Avant, tout ce qui n'était pas la chaîne
  // 'false' laissait le jugement ACTIF — y compris une faute de frappe.
  if (!capaciteActive('ENABLE_AI_CANDIDATURE_ASSESSMENT')) {
    return {
      ok: false,
      cause: 'modele_indisponible',
      raison: 'jugement désactivé par interrupteur',
    }
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[jugement] ANTHROPIC_API_KEY absente')
    return {
      ok: false,
      cause: 'modele_indisponible',
      raison: 'clé du modèle absente de l environnement',
    }
  }

  // Le budget est vérifié AVANT l'appel. Au plafond, on ne juge pas — et on le
  // DIT : la candidature existe, elle est simplement sans note.
  const budget = await budgetDisponible(args.supabaseAdmin, 'claude')
  if (!budget.ok) {
    console.warn('[jugement] non rendu', { ...args.contexte, raison: budget.raison })
    return { ok: false, cause: 'plafond', raison: budget.raison }
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
    return { ok: false, cause: 'modele_indisponible', raison: 'appel au modèle en échec' }
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
    return { ok: false, cause: 'reponse_illisible', raison: 'réponse du modèle illisible' }
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
  if (!appel.ok) return { ok: false, cause: appel.cause, raison: appel.raison }

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
    return {
      ok: false,
      cause: 'reponse_illisible',
      raison: 'jugement incomplet rendu par le modèle',
    }
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
  | { ok: false; cause: CausePanne; raison: string }

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
  if (!appel.ok) return { ok: false, cause: appel.cause, raison: appel.raison }

  const pitch = lireTexte(appel.charge.pitch_org)
  if (!pitch) {
    return {
      ok: false,
      cause: 'reponse_illisible',
      raison: 'aucun pitch rendu par le modèle',
    }
  }
  return { ok: true, pitch, deja: false }
}
