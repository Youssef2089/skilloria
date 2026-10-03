#!/usr/bin/env node
// tests/integration/moteur-reference.mjs — LE JEU DE RÉFÉRENCE DU MOTEUR DE MISE EN RELATION (lot DevOps CI).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QU'IL PROUVE, SUR LE VRAI CHEMIN DU MOTEUR (les modules de lib/matching/ tels qu'ils sont livrés, chargés
// par scripts/lib/chargeur-ts.mjs), contre la base jetable du runner :
//   1. SANS IA — le VIVIER de chaque annonce (`chargerVivierPourAnnonce`) : branche, spécialités (« Autre » seul
//      ne contraint rien, §D.39), séniorités, zones (continent, « Partout dans le monde », §D.34), public natif et
//      ouverture croisée, éligibilité (invisible, « ne pas déranger », salarié non en recherche, §D.20).
//   2. AVEC L'IA SIMULÉE — là où l'IA intervient dans le vrai parcours : le reranker (Cohere) note chaque couple.
//      `fetch` est intercepté : `api.cohere.com` reçoit des RÉPONSES FIXES, lues dans `NOTES` ; tout autre hôte
//      hors du runner est coupé (aucun e-mail, aucun appel externe). Le reste est le vrai moteur : le filtre du
//      flux, l'étiquette « Correspondance forte » (`relevance_tier = 'strong'`), la réconciliation, les avis.
//        · sens expert → annonces (`runMatchingForExpert`) ;
//        · sens annonce → experts (`runMatchingForPublication`) — le même résultat, par construction ;
//        · une correspondance fraîche pose UN avis (§D.48) ; un second passage ne renotifie personne ;
//        · un reranker en panne n'efface aucune correspondance (le run reste inachevé, §D.22).
//
// LES FILTRES (« filtre du flux », « palier fort ») sont posés par le jeu, par la fonction de l'écran
//   (`regler_matching`) : 3 et 8 sur 10. Les notes simulées sont DÉRIVÉES de ces deux valeurs relues — « fort »
//   au-dessus du palier, « normal » entre les deux, « sous » sous le filtre — jamais des nombres recopiés.
//
// CE QU'IL NE VOIT PAS : la qualité des notes d'un vrai reranker (c'est la simulation qui les fixe) ; le sens des
//   textes ; les écrans. Les comptes naissent par l'inscription (fabriques) ; les critères s'écrivent comme les
//   routes les écrivent (colonnes du profil et de l'annonce), la liste aplatie des pays par la base.
//
//   node --experimental-transform-types --no-warnings tests/integration/moteur-reference.mjs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Banc, environnementLocal, executerSql, lireJson, nAPasTourne } from './outils.mjs'
import { importerDuDepot } from '../../scripts/lib/chargeur-ts.mjs'
import { ANNONCES, ATTENDU, EXPERTS, FEED, INELIGIBLES, NOTES, PALIER, SENS_EXPERT } from './jeu-de-reference.mjs'

// ═══ LE JEU DE RÉFÉRENCE ══════════════════════════════════════════════════════
// Des données, dans leur propre module (tests/integration/jeu-de-reference.mjs) : leur cohérence interne se
// vérifie sans base (scripts/diag-integration-continue.mjs).

// ═══ LES SEMENCES, ÉCRITES DEPUIS LE JEU ═════════════════════════════════════
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const tableau = (xs, type) => `array[${xs.map(lit).join(', ')}]::${type}[]`
const RESUME = 'Profil de référence du banc du moteur de mise en relation. Ce texte existe parce qu’un profil visible ' +
  'doit porter un résumé de deux cents à huit cents caractères ; il ne dit rien de vrai sur personne, et aucune ' +
  'note ne dépend de lui : l’IA simulée lit le repère du titre.'

function semences() {
  const l = []
  // Un texte (pas un fichier) : `\ir` se résout depuis la racine du dépôt (outils.mjs, executerSql).
  l.push('\\ir supabase/tests/database/grand_livre/_fabriques.psql')
  l.push('create temp table refs (ref text primary key, valeur text not null);')
  l.push(`create or replace function pg_temp.zone_ref(p text) returns uuid language plpgsql as $$
declare v uuid;
begin
  if length(p) = 2 then select z.id into v from public.work_zones z where z.country_code = p and z.active order by z.id limit 1;
  else select z.id into v from public.work_zones z where z.code = p and z.active limit 1; end if;
  if v is null then raise exception 'jeu de référence : zone % absente du référentiel', p; end if;
  return v;
end $$;`)
  // Les branches et les spécialités.
  l.push(`insert into refs values ('domaine', pg_temp.fab_domaine()::text);`)
  l.push(`insert into refs select 'branche_R', b.id::text from public.branches b where b.domain_id = pg_temp.fab_domaine() and b.active order by b.slug limit 1;`)
  l.push(`insert into refs select 'branche_T', b.id::text from public.branches b where b.domain_id = pg_temp.fab_domaine() and b.active
            and b.id <> (select valeur::uuid from refs where ref = 'branche_R') order by b.slug limit 1;`)
  l.push(`insert into public.branches (domain_id, name, slug, active, sort_order)
          select pg_temp.fab_domaine(), 'Référence — branche témoin', 'reference-branche-temoin', true, 999
           where not exists (select 1 from refs where ref = 'branche_T');`)
  l.push(`insert into refs select 'branche_T', b.id::text from public.branches b where b.slug = 'reference-branche-temoin'
            and not exists (select 1 from refs where ref = 'branche_T');`)
  for (const s of ['S1', 'S2']) {
    l.push(`insert into public.specialities (branch_id, domain_id, name, slug, active, sort_order)
            values ((select valeur::uuid from refs where ref = 'branche_R'), pg_temp.fab_domaine(), 'Référence ${s}', 'reference-${s.toLowerCase()}', true, 0);`)
    l.push(`insert into refs select 'spec_${s}', s.id::text from public.specialities s where s.slug = 'reference-${s.toLowerCase()}';`)
  }
  const specs = (xs) => `array[${xs.map((s) => `(select valeur::uuid from refs where ref = 'spec_${s}')`).join(', ')}]::uuid[]`
  const zones = (xs) => `array[${xs.map((z) => `pg_temp.zone_ref(${lit(z)})`).join(', ')}]::uuid[]`
  // Les filtres du moteur, par la fonction de l'écran — sous un administrateur, comme l'écran (le journal l'exige).
  l.push(`insert into refs values ('admin', pg_temp.fab_admin()::text);`)
  l.push(`select public.regler_matching(gen_random_uuid(), (select valeur::uuid from refs where ref = 'admin'), pg_temp.fab_domaine(), pg_temp.fab_domaine(),
            jsonb_build_object('feed_threshold', ${FEED}, 'notify_threshold', ${PALIER}),
            (select jsonb_build_object('feed_threshold', m.feed_threshold, 'notify_threshold', m.notify_threshold)
               from public.matching_settings m where m.domain_id = pg_temp.fab_domaine()));`)
  // Les experts.
  for (const e of EXPERTS) {
    l.push(`insert into refs values ('user_${e.ref}', pg_temp.fab_compte(${lit(e.voie)})::text);`)
    l.push(`insert into refs select 'profil_${e.ref}', p.id::text from public.profiles p where p.user_id = (select valeur::uuid from refs where ref = 'user_${e.ref}');`)
    const freelance = e.voie === 'expert'
    l.push(`update public.profiles set
              branch_id = (select valeur::uuid from refs where ref = 'branche_${e.branche}'),
              speciality_ids = ${e.specialites.length ? specs(e.specialites) : `'{}'::uuid[]`},
              speciality_other = ${e.autre ? lit(e.autre) : 'null'},
              seniorities = ${tableau(e.seniorites, 'text')},
              work_zone_ids = ${zones(e.zones)},
              title = ${lit(`REF-${e.ref} Expert de référence`)},
              summary = ${lit(RESUME)},
              skills = array['Référence']::text[],
              years_total_experience = 8,
              availability_status = ${freelance ? lit(e.indisponible ? 'do_not_disturb' : 'available') : 'null'},
              cdi_status = ${freelance ? 'null' : lit(e.indisponible ? 'employed' : 'open_to_work')},
              open_to_freelance = ${!freelance && Boolean(e.ouvert)},
              open_to_cdi = false,
              cv_parsing_status = 'done',
              ai_consent_at = now(),
              verification_status = 'approved',
              visible = ${!e.invisible}
            where id = (select valeur::uuid from refs where ref = 'profil_${e.ref}');`)
  }
  // L'organisation qui publie, et les annonces — par le chemin de publication.
  l.push(`insert into refs values ('client', pg_temp.fab_compte('entreprise')::text);`)
  l.push(`insert into refs select 'org', m.organization_id::text from public.organization_members m where m.user_id = (select valeur::uuid from refs where ref = 'client') and m.status = 'active' limit 1;`)
  for (const a of ANNONCES) {
    l.push(`insert into refs select 'pub_${a.ref}', pg_temp.fab_brouillon((select valeur::uuid from refs where ref = 'org'), ${lit(a.type)})::text;`)
    l.push(`update public.publications set
              title = ${lit(`REF-${a.ref} Annonce de référence`)},
              description = 'Annonce du jeu de référence du moteur : son texte ne décide de rien, le repère du titre si.',
              branch_id = (select valeur::uuid from refs where ref = 'branche_${a.branche}'),
              speciality_ids = ${a.specialites.length ? specs(a.specialites) : `'{}'::uuid[]`},
              seniorities = ${a.seniorites.length ? tableau(a.seniorites, 'text') : `'{}'::text[]`},
              work_zone_ids = ${zones(a.zones)},
              skills_required = array['Référence']::text[]
            where id = (select valeur::uuid from refs where ref = 'pub_${a.ref}');`)
    l.push(`select public.publier_annonce(gen_random_uuid(), null, 'utilisateur', (select valeur::uuid from refs where ref = 'client'), 'client',
              (select valeur::uuid from refs where ref = 'pub_${a.ref}'), pg_temp.fab_domaine(), (select valeur::uuid from refs where ref = 'org'),
              array['draft'], 'published', 8, 'sonde', '{}'::jsonb);`)
  }
  l.push(`select 'REFERENCES:' || json_object_agg(ref, valeur)::text from refs;`)
  return l.join('\n')
}

// ═══ L'IA SIMULÉE ════════════════════════════════════════════════════════════
const repere = (texte) => /REF-([A-Z][0-9])/.exec(texte ?? '')?.[1] ?? null
const ia = { mode: 'normal', appels: 0, couplesManquants: [] }
let notes = null // { fort, normal, sous } en 0-1, dérivées des filtres relus

function fauxCohere(init) {
  ia.appels++
  if (ia.mode === 'panne') return new Response(JSON.stringify({ message: 'panne simulée' }), { status: 500 })
  const corps = JSON.parse(String(init?.body ?? '{}'))
  const q = repere(corps.query)
  const results = []
  for (const [index, doc] of (corps.documents ?? []).entries()) {
    const d = repere(doc)
    // Un couple = (annonce, expert), dans un sens ou dans l'autre.
    const [annonce, expert] = /^[MO]/.test(q ?? '') ? [q, d] : [d, q]
    const etiquette = NOTES[annonce]?.[expert]
    if (!etiquette) { ia.couplesManquants.push(`${annonce}×${expert}`); continue }
    results.push({ index, relevance_score: notes[etiquette] })
  }
  if (results.length === 0) return new Response(JSON.stringify({ message: 'aucun couple du jeu' }), { status: 400 })
  return new Response(JSON.stringify({ results, meta: { billed_units: { search_units: 1 } } }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function couperLeReseau() {
  const reel = globalThis.fetch
  globalThis.fetch = async (entree, init) => {
    const adresse = typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url
    const hote = new URL(adresse).hostname
    // Le reranker appelle `fetch(adresse, { body })` (lib/matching/rerank.ts) : le corps est dans `init`.
    if (hote === 'api.cohere.com') return fauxCohere(init)
    if (['127.0.0.1', 'localhost', '::1'].includes(hote)) return reel(entree, init)
    // Tout autre fournisseur (e-mail, autre IA) : coupé, comme une panne — le moteur ne doit pas en dépendre.
    return new Response(JSON.stringify({ message: `réseau coupé dans le banc (${hote})` }), { status: 503 })
  }
}

// ═══ LE BANC ═════════════════════════════════════════════════════════════════
const banc = new Banc('Moteur de mise en relation — jeu de référence')
const trier = (xs) => [...xs].sort()
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b)

async function principal() {
  const env = environnementLocal()
  if (env.erreur) return nAPasTourne(banc.titre, env.erreur)
  // Le moteur lit ces variables : l'interrupteur, une clé (factice — la réponse est simulée).
  process.env.ENABLE_RERANKING = 'true'
  process.env.COHERE_API_KEY = process.env.COHERE_API_KEY || 'ci-factice'

  let refs
  try {
    refs = lireJson(executerSql(semences(), { db: env.db }), 'REFERENCES')
  } catch (e) {
    return nAPasTourne(banc.titre, `jeu de référence impossible à semer : ${e.message}`)
  }
  couperLeReseau()

  let moteur, vivier, journal, supabase
  try {
    moteur = await importerDuDepot('lib/matching/index.ts')
    vivier = await importerDuDepot('lib/matching/pool.ts')
    journal = await importerDuDepot('lib/journal/contexte.ts')
    const { createClient } = await import('@supabase/supabase-js')
    supabase = createClient(env.url, env.service, { auth: { persistSession: false, autoRefreshToken: false } })
  } catch (e) {
    return nAPasTourne(banc.titre, `le moteur ne se charge pas hors de Next : ${e.code ?? ''} ${e.message}`)
  }

  const { data: reglage, error: errReglage } = await supabase.from('matching_settings')
    .select('feed_threshold, notify_threshold').eq('domain_id', refs.domaine).maybeSingle()
  if (errReglage || !reglage) return nAPasTourne(banc.titre, `réglages du moteur illisibles : ${errReglage?.message ?? 'absents'}`)
  banc.section('Les filtres, posés par la fonction de l’écran')
  banc.ok(Number(reglage.feed_threshold) === FEED && Number(reglage.notify_threshold) === PALIER,
    `filtre du flux ${FEED}/10, palier « Correspondance forte » ${PALIER}/10`, JSON.stringify(reglage))
  const f = Number(reglage.feed_threshold), p = Number(reglage.notify_threshold)
  notes = { fort: (p + 10) / 20, normal: (f + p) / 20, sous: f / 20 }

  const parProfil = new Map(EXPERTS.map((e) => [refs[`profil_${e.ref}`], e.ref]))
  const parAnnonce = new Map(ANNONCES.map((a) => [refs[`pub_${a.ref}`], a.ref]))
  const contexte = () => journal.ouvrirContexte({ origine: 'systeme', ecosystemeId: refs.domaine })

  // ── 1. SANS IA : le vivier ──
  banc.section('1. Sans IA — le vivier de chaque annonce (zones, spécialités, « Autre », séniorités, public, éligibilité)')
  for (const a of ANNONCES) {
    const { data: pub } = await supabase.from('publications')
      .select('id, domain_id, type, created_by, branch_id, speciality_ids, seniorities, work_zone_countries').eq('id', refs[`pub_${a.ref}`]).single()
    const v = await vivier.chargerVivierPourAnnonce(supabase, {
      id: pub.id, domain_id: pub.domain_id, type: pub.type, created_by: pub.created_by, branch_id: pub.branch_id,
      speciality_ids: pub.speciality_ids ?? [], seniorities: pub.seniorities ?? [], work_zone_countries: pub.work_zone_countries ?? [],
    })
    const duJeu = trier(v.profils.map((x) => parProfil.get(x.profile_id)).filter(Boolean))
    banc.ok(!v.erreur && egal(duJeu, trier(ATTENDU[a.ref].vivier)),
      `${a.ref} : vivier = ${ATTENDU[a.ref].vivier.join(', ')}`, v.erreur ?? `rendu : ${duJeu.join(', ') || '(vide)'}`)
  }

  const lireCorrespondances = async () => {
    const { data, error } = await supabase.from('matches').select('profile_id, publication_id, relevance_tier, relevance_score')
      .in('publication_id', [...parAnnonce.keys()])
    if (error) throw new Error(error.message)
    const out = {}
    for (const m of data ?? []) {
      const a = parAnnonce.get(m.publication_id), e = parProfil.get(m.profile_id)
      if (a && e) (out[a] ??= {})[e] = m.relevance_tier
    }
    return out
  }
  const attenduPour = (filtreExpert) => {
    const out = {}
    for (const [a, { correspondances }] of Object.entries(ATTENDU)) {
      for (const [e, palier] of Object.entries(correspondances)) if (filtreExpert(e)) (out[a] ??= {})[e] = palier
    }
    return out
  }
  const trierObjet = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, Object.fromEntries(Object.entries(o[k]).sort())]))

  // ── 2. AVEC L'IA SIMULÉE : sens expert → annonces ──
  banc.section('2. IA simulée — sens expert → annonces (runMatchingForExpert)')
  for (const e of [...SENS_EXPERT, ...INELIGIBLES]) {
    await moteur.runMatchingForExpert({ supabaseAdmin: supabase, profileId: refs[`profil_${e}`], journal: contexte() })
  }
  const apresExpert = trierObjet(await lireCorrespondances())
  const attenduExpert = trierObjet(attenduPour((e) => SENS_EXPERT.includes(e)))
  banc.ok(egal(apresExpert, attenduExpert), `correspondances et paliers de ${SENS_EXPERT.join(', ')} ; aucune pour ${INELIGIBLES.join(', ')} (inéligibles)`,
    `rendu : ${JSON.stringify(apresExpert)} — attendu : ${JSON.stringify(attenduExpert)}`)

  // ── 3. AVEC L'IA SIMULÉE : sens annonce → experts ──
  banc.section('3. IA simulée — sens annonce → experts (runMatchingForPublication)')
  for (const a of ANNONCES) {
    const verdict = await moteur.runMatchingForPublication({ supabaseAdmin: supabase, publicationId: refs[`pub_${a.ref}`], journal: contexte() })
    banc.ok(verdict.status === 'ok', `${a.ref} : le run s’achève (ok)`, `${verdict.status} — ${verdict.notes}`)
  }
  const final = trierObjet(await lireCorrespondances())
  const attenduTout = trierObjet(attenduPour(() => true))
  banc.ok(egal(final, attenduTout), 'la matrice complète : chaque correspondance, et son étiquette « Correspondance forte » (strong) ou non',
    `rendu : ${JSON.stringify(final)} — attendu : ${JSON.stringify(attenduTout)}`)
  banc.ok(ia.couplesManquants.length === 0, 'l’IA simulée n’a reçu aucun couple hors du jeu (le vivier n’a rien laissé passer)', ia.couplesManquants.join(', '))

  // ── 4. Les avis ──
  banc.section('4. Une correspondance fraîche pose UN avis ; un second passage ne renotifie personne')
  const lireAvis = async () => {
    const users = EXPERTS.map((e) => refs[`user_${e.ref}`])
    const { data, error } = await supabase.from('notifications').select('user_id, entity_id').in('user_id', users).in('entity_id', [...parAnnonce.keys()])
    if (error) throw new Error(error.message)
    const parUser = new Map(EXPERTS.map((e) => [refs[`user_${e.ref}`], e.ref]))
    const compte = {}
    for (const n of data ?? []) { const k = `${parAnnonce.get(n.entity_id)}×${parUser.get(n.user_id)}`; compte[k] = (compte[k] ?? 0) + 1 }
    return compte
  }
  const avis = await lireAvis()
  const couplesAttendus = Object.entries(ATTENDU).flatMap(([a, { correspondances }]) => Object.keys(correspondances).map((e) => `${a}×${e}`)).sort()
  banc.ok(egal(Object.keys(avis).sort(), couplesAttendus) && Object.values(avis).every((n) => n === 1),
    `un avis, et un seul, par correspondance (${couplesAttendus.length})`, JSON.stringify(avis))
  const appelsAvant = ia.appels
  await moteur.runMatchingForPublication({ supabaseAdmin: supabase, publicationId: refs.pub_M1, journal: contexte() })
  banc.ok(egal(await lireAvis(), avis) && egal(trierObjet(await lireCorrespondances()), attenduTout),
    'second passage sur M1 : mêmes correspondances, aucun avis de plus', `appels au reranker : ${ia.appels - appelsAvant}`)

  // ── 5. L'IA en panne ──
  banc.section('5. Le reranker en panne n’efface rien')
  ia.mode = 'panne'
  // Une note déjà acquise n'est pas repayée : pour forcer l'appel, le texte de l'annonce change (§D.15).
  await supabase.from('publications').update({ description: 'Annonce du jeu de référence, réécrite pour forcer une nouvelle notation.' }).eq('id', refs.pub_O1)
  const enPanne = await moteur.runMatchingForPublication({ supabaseAdmin: supabase, publicationId: refs.pub_O1, journal: contexte() })
  ia.mode = 'normal'
  banc.ok(enPanne.status === 'error', 'O1 avec un reranker en panne : le run est INACHEVÉ (error), pas « personne ne correspond »', `${enPanne.status} — ${enPanne.notes}`)
  banc.ok(egal(trierObjet(await lireCorrespondances()), attenduTout), 'O1 : la correspondance de C1 est conservée')

  banc.conclure()
}

// `--semences` : imprime le SQL du jeu, sans base ni moteur — pour le relire.
if (process.argv.includes('--semences')) console.log(semences())
else await principal()
