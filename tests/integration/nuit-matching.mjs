#!/usr/bin/env node
// tests/integration/nuit-matching.mjs — LE GRAND JEU DE NUIT : LE VRAI MOTEUR SUR 1 000 EXPERTS ET 300 MISSIONS.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Lancé par .github/workflows/nuit-matching.yml, chaque nuit (jamais sur une demande de fusion), sur la base jetable du
// runner. Le jeu vient de tests/integration/generateur-jeu.mjs (Faker, graine fixe). L'IA simulée rend une note FIXE par
// couple (un hachage du couple et de la graine) ; tout autre fournisseur est coupé. Le moteur est celui de lib/matching/,
// tel qu'il est livré.
//
// LES PASSAGES
//   A. filtre 0, palier 8 : TOUT le vivier devient correspondance — le passage « à froid » (aucune note acquise) donne
//      le temps d'un passage complet, et le nombre d'appels d'IA qu'un passage réel coûterait ; ses notes donnent, pour
//      chaque note minimale, le nombre d'experts qui seraient alertés.
//   B. filtre 3 (correspondances et avis remis à zéro) : les experts réellement alertés = le compte prévu pour 3.
//   C. le même, rejoué : aucune alerte en double.
//   D. 50 couples POSTULÉS (une candidature par le dépôt réel), puis un passage : aucune mission postulée ne revient
//      dans le flux de son expert, et elle n'alerte pas de nouveau.
// LES RÈGLES, sur chaque recommandation (en base, sur toutes) : même branche ; au moins une spécialité commune — ou
//   « Autre » seule d'un côté (§D.39, compté à part) ; au moins un pays commun ; une séniorité commune quand l'annonce en
//   exige ; le bon public (ou l'ouverture croisée) ; aucun expert Occupé (« ne pas déranger », salarié non en recherche) ;
//   aucun invisible ni non approuvé.
// LES TEMPS : la génération, un passage complet, l'affichage des recommandations (la vraie requête du flux, sur 200
//   experts : moyenne et 95ᵉ centile).
// LE RÉSULTAT : un tableau chiffré dans le résumé de l'exécution, et nuit-matching.json (artefact).
//
//   node --experimental-transform-types --no-warnings tests/integration/nuit-matching.mjs
//        [--graine=…] [--experts=1000] [--organisations=200] [--missions=300]
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { appendFileSync, writeFileSync } from 'node:fs'
import { Banc, environnementLocal, executerSql, lireJson, nAPasTourne } from './outils.mjs'
import { importerDuDepot } from '../../scripts/lib/chargeur-ts.mjs'
import { GRAINE_PAR_DEFAUT, noteFixe, remplir } from './generateur-jeu.mjs'

const arg = (nom, defaut) => Number(process.argv.find((a) => a.startsWith(`--${nom}=`))?.split('=')[1] ?? defaut)
const GRAINE = arg('graine', GRAINE_PAR_DEFAUT)
const TAILLE = { experts: arg('experts', 1000), organisations: arg('organisations', 200), missions: arg('missions', 300) }
const FILTRES = [0, 2, 3, 4, 5, 6, 7, 8, 9]
const PALIER = 8
const FILTRE_DU_JEU = 3
const POSTULEES = 50
const ECHANTILLON_AFFICHAGE = 200

const banc = new Banc('Grand jeu de nuit — le moteur sur tout le jeu')
const chrono = async (f) => { const t = performance.now(); const r = await f(); return { r, ms: Math.round(performance.now() - t) } }

// ── L'IA simulée : une note fixe par couple, et la facture que rendrait le fournisseur ──
const ia = { appels: 0, documents: 0, unites: 0, inconnus: 0 }
const repere = (t, prefixe) => new RegExp(`${prefixe}\\d+`).exec(t ?? '')?.[0] ?? null
function fauxCohere(init) {
  const corps = JSON.parse(String(init?.body ?? '{}'))
  const docs = corps.documents ?? []
  ia.appels++
  ia.documents += docs.length
  const unites = Math.ceil(docs.length / 100) // une « recherche » = une requête et jusqu'à 100 documents
  ia.unites += unites
  const qA = repere(corps.query, 'GEN-M'), qE = repere(corps.query, 'GEN-E')
  const results = docs.map((d, index) => {
    const a = qA ?? repere(d, 'GEN-M'), e = qE ?? repere(d, 'GEN-E')
    if (!a || !e) { ia.inconnus++; return { index, relevance_score: 0 } }
    return { index, relevance_score: noteFixe(a, e, GRAINE) / 10 }
  })
  return new Response(JSON.stringify({ results, meta: { billed_units: { search_units: unites } } }), { status: 200, headers: { 'content-type': 'application/json' } })
}
function couperLeReseau() {
  const reel = globalThis.fetch
  globalThis.fetch = async (entree, init) => {
    const adresse = typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url
    const hote = new URL(adresse).hostname
    if (hote === 'api.cohere.com') return fauxCohere(init)
    if (['127.0.0.1', 'localhost', '::1'].includes(hote)) return reel(entree, init)
    return new Response(JSON.stringify({ message: `réseau coupé dans le banc (${hote})` }), { status: 503 })
  }
}

async function principal() {
  const env = environnementLocal()
  if (env.erreur) return nAPasTourne(banc.titre, env.erreur)
  process.env.ENABLE_RERANKING = 'true'
  process.env.COHERE_API_KEY = process.env.COHERE_API_KEY || 'ci-factice'

  // ── Le jeu ──
  let generation
  try { generation = await chrono(async () => remplir({ db: env.db, graine: GRAINE, ...TAILLE })) } catch (e) { return nAPasTourne(banc.titre, `jeu impossible : ${e.message}`) }
  const { jeu, refs } = generation.r
  couperLeReseau()
  const moteur = await importerDuDepot('lib/matching/index.ts')
  const journal = await importerDuDepot('lib/journal/contexte.ts')
  const { buildExpertMissionsSelect, expertMissionsQuery } = await importerDuDepot('lib/missions/feed.ts')
  const { chargerDurees } = await importerDuDepot('lib/durees.ts')
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(env.url, env.service, { auth: { persistSession: false, autoRefreshToken: false } })
  const durees = await chargerDurees(supabase)
  if (!durees.ok) return nAPasTourne(banc.titre, `durées illisibles : ${durees.raison}`)
  const domaine = lireJson(executerSql(`\\ir supabase/tests/database/grand_livre/_fabriques.psql
select 'DOMAINE:' || to_json(pg_temp.fab_domaine())::text;`, { db: env.db }), 'DOMAINE')
  const pubs = jeu.missions.map((m) => refs[`pub:${m.ref}`])
  const profils = jeu.experts.map((e) => refs[`profil:${e.ref}`])
  const liste = (xs) => `array[${xs.map((x) => `'${x}'`).join(', ')}]::uuid[]`
  const reglage = (feed, palier) => executerSql(`select public.regler_matching(gen_random_uuid(), '${refs.admin}', '${domaine}', '${domaine}',
      jsonb_build_object('feed_threshold', ${feed}, 'notify_threshold', ${palier}),
      (select jsonb_build_object('feed_threshold', m.feed_threshold, 'notify_threshold', m.notify_threshold) from public.matching_settings m where m.domain_id = '${domaine}'));`, { db: env.db })
  const remettreAZero = () => executerSql(`delete from public.notifications where entity_id = any(${liste(pubs)});
    delete from public.matches where publication_id = any(${liste(pubs)});`, { db: env.db })
  const passage = async () => {
    const verdicts = {}
    const { ms } = await chrono(async () => {
      for (const id of pubs) {
        const v = await moteur.runMatchingForPublication({ supabaseAdmin: supabase, publicationId: id, journal: journal.ouvrirContexte({ origine: 'systeme', ecosystemeId: domaine }) })
        verdicts[v.status] = (verdicts[v.status] ?? 0) + 1
      }
    })
    return { ms, verdicts }
  }
  const sql = (texte, prefixe) => lireJson(executerSql(texte, { db: env.db }), prefixe)

  // ── A. À froid, filtre 0 : tout le vivier ──
  banc.section(`A. Un passage complet, à froid — ${pubs.length} missions, ${profils.length} experts`)
  reglage(0, PALIER)
  remettreAZero()
  const iaAvant = { ...ia }
  const A = await passage()
  const factureA = { appels: ia.appels - iaAvant.appels, documents: ia.documents - iaAvant.documents, unites: ia.unites - iaAvant.unites }
  banc.ok((A.verdicts.ok ?? 0) + (A.verdicts.empty_pool ?? 0) === pubs.length && ia.inconnus === 0,
    `chaque passage s’achève (ok ou vivier vide) : ${JSON.stringify(A.verdicts)}`, `couples sans repère : ${ia.inconnus}`)
  const tarif = sql(`select 'TARIF:' || coalesce((select json_build_object('model', t.model, 'usd_par_unite', t.usd_par_unite)
      from public.ai_model_tarifs t join public.matching_settings m on m.rerank_model = t.model where m.domain_id = '${domaine}'), 'null'::json)::text;`, 'TARIF')
  const regles = sql(`with gm as (
      select m.profile_id, m.publication_id, m.relevance_score, p.branch_id pb, p.speciality_ids ps, p.seniorities psen,
             p.work_zone_countries pz, p.availability_status, p.cdi_status, p.visible, p.verification_status,
             p.open_to_cdi, p.open_to_freelance, u.user_type, a.type, a.branch_id ab, a.speciality_ids asp,
             a.seniorities asen, a.work_zone_countries az
        from public.matches m join public.profiles p on p.id = m.profile_id join public.users u on u.id = p.user_id
        join public.publications a on a.id = m.publication_id
       where m.publication_id = any(${liste(pubs)}))
    select 'REGLES:' || json_build_object(
      'recommandations', count(*),
      'experts_recommandes', count(distinct profile_id),
      'specialite_commune', count(*) filter (where ps && asp),
      'autre_seule', count(*) filter (where cardinality(asp) = 0 or cardinality(ps) = 0),
      'hors_specialite', count(*) filter (where not (cardinality(asp) = 0 or cardinality(ps) = 0 or ps && asp)),
      'hors_zone', count(*) filter (where not (pz && az)),
      'hors_branche', count(*) filter (where pb is distinct from ab),
      'hors_seniorite', count(*) filter (where cardinality(asen) > 0 and not (psen && asen)),
      'hors_public', count(*) filter (where (type = 'offre' and user_type = 'expert_freelance' and not open_to_cdi)
                                         or (type <> 'offre' and user_type = 'expert_cdi' and not open_to_freelance)),
      'occupes', count(*) filter (where (user_type = 'expert_freelance' and availability_status = 'do_not_disturb')
                                     or (user_type = 'expert_cdi' and cdi_status = 'employed')),
      'invisibles_ou_non_approuves', count(*) filter (where not visible or verification_status <> 'approved'),
      'par_filtre', (select json_object_agg(t, (select count(distinct g2.profile_id) from gm g2 where g2.relevance_score >= t))
                       from unnest(array[${FILTRES.join(', ')}]) t))::text from gm;`, 'REGLES')
  banc.ok(regles.recommandations > 0, `${regles.recommandations} recommandations pour ${regles.experts_recommandes} experts`)
  banc.ok(regles.hors_specialite === 0, `chaque recommandation a au moins une spécialité commune (${regles.specialite_commune}) ou « Autre » seule d’un côté (${regles.autre_seule})`, `${regles.hors_specialite} hors règle`)
  banc.ok(regles.hors_zone === 0, 'chaque recommandation a au moins un pays commun', `${regles.hors_zone} sans pays commun`)
  banc.ok(regles.hors_branche === 0 && regles.hors_seniorite === 0 && regles.hors_public === 0,
    'même branche, une séniorité commune quand l’annonce en exige, le bon public ou l’ouverture croisée',
    `branche ${regles.hors_branche}, séniorité ${regles.hors_seniorite}, public ${regles.hors_public}`)
  banc.ok(regles.occupes === 0, 'aucun expert Occupé (« ne pas déranger », salarié non en recherche) n’est recommandé', `${regles.occupes}`)
  banc.ok(regles.invisibles_ou_non_approuves === 0, 'aucun profil invisible ni non approuvé n’est recommandé', `${regles.invisibles_ou_non_approuves}`)

  // ── B. Filtre du jeu : les experts alertés = le compte prévu ──
  banc.section(`B. Filtre ${FILTRE_DU_JEU} : les experts réellement alertés`)
  reglage(FILTRE_DU_JEU, PALIER)
  remettreAZero()
  const B = await passage()
  const alertesB = sql(`select 'ALERTES:' || json_build_object('experts', count(distinct user_id), 'avis', count(*))::text
      from public.notifications where entity_id = any(${liste(pubs)});`, 'ALERTES')
  banc.ok(alertesB.experts === regles.par_filtre[String(FILTRE_DU_JEU)],
    `filtre ${FILTRE_DU_JEU} : ${alertesB.experts} experts alertés, le compte prévu par les notes du passage A`,
    `prévu ${regles.par_filtre[String(FILTRE_DU_JEU)]}`)

  // ── C. Rejoué : aucune alerte en double ──
  banc.section('C. Le même passage, rejoué : aucune alerte en double')
  const C = await passage()
  const doublons = sql(`select 'DOUBLONS:' || json_build_object('doublons', (select count(*) from (select user_id, entity_id from public.notifications
      where entity_id = any(${liste(pubs)}) group by 1, 2 having count(*) > 1) d), 'avis', (select count(*) from public.notifications where entity_id = any(${liste(pubs)})))::text;`, 'DOUBLONS')
  banc.ok(doublons.doublons === 0 && doublons.avis === alertesB.avis, `aucune alerte en double, aucune de plus (${doublons.avis} avis)`, JSON.stringify(doublons))

  // ── D. Postulées : elles ne reviennent pas ──
  banc.section(`D. ${POSTULEES} missions postulées : elles ne reviennent pas`)
  const couples = sql(`select 'COUPLES:' || coalesce(json_agg(json_build_object('pub', m.publication_id, 'profil', m.profile_id, 'user', p.user_id)), '[]'::json)::text
      from (select * from public.matches where publication_id = any(${liste(pubs)}) order by publication_id, profile_id limit ${POSTULEES}) m
      join public.profiles p on p.id = m.profile_id;`, 'COUPLES')
  executerSql(`\\ir supabase/tests/database/grand_livre/_fabriques.psql
${couples.map((c) => `select pg_temp.fab_candidature('${c.pub}', '${c.profil}');`).join('\n')}`, { db: env.db })
  const D = await passage()
  let revenues = 0
  for (const c of couples) {
    const { data } = await expertMissionsQuery(supabase, c.profil, { select: buildExpertMissionsSelect({ matchColumns: 'id, publication_id' }), vieAnnonceJours: durees.durees.vieAnnonceJours })
    if ((data ?? []).some((m) => m.publication_id === c.pub)) revenues++
  }
  const avisPostulees = sql(`select 'AVIS:' || json_build_object('max', coalesce(max(n), 0))::text from (select count(*) n from public.notifications
      where (user_id, entity_id) in (${couples.map((c) => `('${c.user}'::uuid, '${c.pub}'::uuid)`).join(', ') || "(null::uuid, null::uuid)"}) group by user_id, entity_id) x;`, 'AVIS')
  banc.ok(couples.length === POSTULEES && revenues === 0, `aucune des ${couples.length} missions postulées ne revient dans le flux de son expert`, `${revenues} revenues`)
  banc.ok(avisPostulees.max <= 1, 'une mission postulée n’alerte pas de nouveau', `jusqu’à ${avisPostulees.max} avis pour un couple`)

  // ── L'affichage des recommandations ──
  banc.section(`L’affichage des recommandations — la vraie requête du flux, sur ${ECHANTILLON_AFFICHAGE} experts`)
  const temps = []
  for (const id of profils.slice(0, ECHANTILLON_AFFICHAGE)) {
    const { ms } = await chrono(async () => expertMissionsQuery(supabase, id, { select: buildExpertMissionsSelect({ matchColumns: 'id, publication_id, relevance_score, relevance_tier' }), vieAnnonceJours: durees.durees.vieAnnonceJours }))
    temps.push(ms)
  }
  temps.sort((a, b) => a - b)
  const affichage = { moyenne_ms: Math.round(temps.reduce((s, x) => s + x, 0) / temps.length), p95_ms: temps[Math.floor(temps.length * 0.95)], max_ms: temps.at(-1) }
  banc.ok(temps.length === ECHANTILLON_AFFICHAGE, `affichage mesuré : moyenne ${affichage.moyenne_ms} ms, 95ᵉ centile ${affichage.p95_ms} ms`)

  // ── Le résultat chiffré ──
  const cout = tarif?.usd_par_unite != null ? Number((factureA.unites * Number(tarif.usd_par_unite)).toFixed(6)) : null
  const resultat = {
    graine: GRAINE, taille: TAILLE,
    temps_s: { generation: Math.round(generation.ms / 1000), passage_complet_a_froid: Math.round(A.ms / 1000), passage_filtre_du_jeu: Math.round(B.ms / 1000), passage_rejoue: Math.round(C.ms / 1000), passage_postulees: Math.round(D.ms / 1000) },
    affichage, regles, experts_alertes_par_filtre: regles.par_filtre, alertes_filtre_du_jeu: alertesB,
    ia_passage_a_froid: { ...factureA, modele: tarif?.model ?? null, usd_par_unite: tarif?.usd_par_unite ?? null, cout_usd_au_tarif_regle: cout },
  }
  writeFileSync('nuit-matching.json', JSON.stringify(resultat, null, 2))
  console.log(JSON.stringify(resultat, null, 2))
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      `### Le grand jeu de nuit — graine ${GRAINE} : ${TAILLE.experts} experts, ${TAILLE.organisations} organisations, ${TAILLE.missions} missions`, '',
      '| Mesure | Valeur |', '|---|---|',
      `| Génération du jeu | ${resultat.temps_s.generation} s |`,
      `| Passage complet, à froid (${TAILLE.missions} missions) | ${resultat.temps_s.passage_complet_a_froid} s |`,
      `| Passage rejoué (notes reprises) | ${resultat.temps_s.passage_rejoue} s |`,
      `| Affichage des recommandations (${ECHANTILLON_AFFICHAGE} experts) | moyenne ${affichage.moyenne_ms} ms · 95ᵉ centile ${affichage.p95_ms} ms · max ${affichage.max_ms} ms |`,
      `| Recommandations (filtre 0) | ${regles.recommandations} pour ${regles.experts_recommandes} experts |`,
      `| dont « Autre » seule d’un côté | ${regles.autre_seule} |`,
      `| Appels d’IA d’un passage réel | ${factureA.appels} appels · ${factureA.documents} documents · ${factureA.unites} recherches facturées |`,
      `| Coût au tarif réglé (${tarif?.model ?? '—'}) | ${cout ?? '—'} $ |`,
      '', '| Note minimale | Experts alertés |', '|---|---|',
      ...FILTRES.map((t) => `| ${t} | ${regles.par_filtre[String(t)]} |`), '',
    ].join('\n') + '\n')
  }
  banc.conclure()
}

await principal()
