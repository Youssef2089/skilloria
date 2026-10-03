#!/usr/bin/env node
// tests/integration/generateur-jeu.mjs — LE GRAND JEU : DES EXPERTS, DES ORGANISATIONS, DES MISSIONS, DÉTERMINISTES.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QU'IL FAIT (lot DevOps CI, partie A bis, point 5) : Faker.js, GRAINE FIXE — la même graine rend le même jeu, au
//   caractère près. Par défaut 1 000 experts (freelance et CDI ; branches, spécialités — dont « Autre » seule —,
//   séniorités, zones pays / continent / monde, disponibilités, ouverture croisée, visibilité, approbation), 200
//   organisations (clients, cabinets, ESN — approuvées par la voie de l'administration) et 300 missions (missions et
//   offres) publiées par le chemin de publication. Les comptes naissent par l'INSCRIPTION (les fabriques des tests de
//   base : auth.users → handle_new_user, avec leur preuve signée) ; RIEN EN DUR : branches, spécialités et zones sont
//   LUES dans la base visée.
//
// OÙ IL ÉCRIT : la base jetable de la nuit (nuit-matching.mjs), et plus tard l'UAT — JAMAIS LA PRODUCTION
//   (tests/integration/cible-du-jeu.mjs : la lecture de la barrière, une base locale, ou une base distante nommée
//   explicitement et différente de la production déclarée ; sinon refus, nommé).
//
// LES DONNÉES SONT INVENTÉES : noms, sociétés, intitulés et textes de Faker ; adresses en `.invalid` ; téléphones
//   +336 9x xx xx xx dérivés du rang (uniques : un téléphone vérifié est unique en base). Aucune vraie personne.
//
//   node tests/integration/generateur-jeu.mjs [--graine=20261003] [--experts=1000] [--organisations=200] [--missions=300]
//        (SUPABASE_DB_URL = la base visée ; distante : JEU_CIBLE_AUTORISEE et SUPABASE_REF_PRODUCTION, voir cible-du-jeu.mjs)
//   node tests/integration/generateur-jeu.mjs --sql   → imprime le SQL d'un petit jeu (10/4/6), sans base
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Faker, fr, base } from '@faker-js/faker'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { RACINE, executerSql, lireJson, nAPasTourne } from './outils.mjs'
import { cibleDuJeu } from './cible-du-jeu.mjs'

export const GRAINE_PAR_DEFAUT = 20261003
const SENIORITES = ['junior', 'confirmed', 'senior', 'expert']

/** Le référentiel de la base visée — lu, jamais écrit en dur. */
export const SQL_REFERENTIEL = `\\ir supabase/tests/database/grand_livre/_fabriques.psql
select 'REFERENTIEL:' || json_build_object(
  'domaine', pg_temp.fab_domaine(),
  'branches', (select coalesce(json_agg(json_build_object('id', b.id, 'specialites',
                 (select coalesce(json_agg(s.id order by s.slug), '[]'::json) from public.specialities s where s.branch_id = b.id and s.active))
                 order by b.slug), '[]'::json)
               from public.branches b where b.domain_id = pg_temp.fab_domaine() and b.active),
  'pays', (select coalesce(json_agg(distinct z.country_code), '[]'::json) from public.work_zones z where z.active and z.kind = 'country' and z.country_code is not null),
  'continents', (select coalesce(json_agg(z.code order by z.code), '[]'::json) from public.work_zones z where z.active and z.kind = 'continent'),
  'monde', (select z.code from public.work_zones z where z.active and z.kind = 'world' limit 1))::text;`

/** Un score fixe par couple — un hachage, pas un tirage : il ne dépend ni de l'ordre ni du nombre d'appels. */
export function noteFixe(annonce, expert, graine) {
  let h = 2166136261 ^ graine
  for (const c of `${annonce}|${expert}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return Math.round(((h >>> 0) % 1001) / 10) / 10 // 0,0 à 10,0 au dixième
}

/**
 * LE JEU, en mémoire — pur et déterministe (graine + référentiel ⇒ toujours le même).
 * @param {{ graine: number, experts: number, organisations: number, missions: number,
 *           referentiel: { branches: {id: string, specialites: string[]}[], pays: string[], continents: string[], monde: string|null } }} o
 */
export function genererJeu({ graine, experts, organisations, missions, referentiel }) {
  const f = new Faker({ locale: [fr, base] })
  f.seed(graine)
  const branches = referentiel.branches.filter((b) => b.specialites.length > 0)
  if (branches.length === 0) throw new Error('aucune branche active avec des spécialités dans la base visée')
  if (referentiel.pays.length < 3) throw new Error('le référentiel des pays est vide ou presque')
  const pays = [...referentiel.pays].sort()
  const parmi = (xs) => xs[f.number.int({ min: 0, max: xs.length - 1 })]
  const plusieurs = (xs, min, max) => f.helpers.arrayElements(xs, { min: Math.min(min, xs.length), max: Math.min(max, xs.length) })
  const texte = (min, max) => {
    let t = ''
    while (t.length < min) t += (t ? ' ' : '') + f.lorem.sentence({ min: 8, max: 16 })
    return t.slice(0, max).trim()
  }
  const zones = () => {
    const r = f.number.float({ min: 0, max: 1 })
    if (r < 0.08 && referentiel.monde) return [referentiel.monde]
    if (r < 0.25 && referentiel.continents.length) return [parmi(referentiel.continents)]
    return plusieurs(pays, 1, 3)
  }
  const pad = (n, l) => String(n).padStart(l, '0')

  const listeExperts = []
  for (let i = 1; i <= experts; i++) {
    const branche = parmi(branches)
    const autre = f.number.float({ min: 0, max: 1 }) < 0.1
    listeExperts.push({
      ref: `GEN-E${pad(i, 4)}`,
      id: f.string.uuid(),
      voie: f.number.float({ min: 0, max: 1 }) < 0.7 ? 'expert' : 'cdi',
      telephone: `+3369${pad(i, 7)}`,
      prenom: f.person.firstName(),
      nom: f.person.lastName(),
      branche: branche.id,
      specialites: autre ? [] : plusieurs(branche.specialites, 1, 3),
      autre: autre ? f.person.jobArea() : null,
      seniorites: plusieurs(SENIORITES, 1, 2),
      zones: zones(),
      occupe: f.number.float({ min: 0, max: 1 }) < 0.15,
      ouvert: f.number.float({ min: 0, max: 1 }) < 0.1,
      visible: f.number.float({ min: 0, max: 1 }) < 0.95,
      approuve: f.number.float({ min: 0, max: 1 }) < 0.92,
      titre: `GEN-E${pad(i, 4)} ${f.person.jobTitle()}`.slice(0, 180),
      resume: texte(220, 600),
    })
  }
  const listeOrganisations = []
  for (let i = 1; i <= organisations; i++) {
    const r = f.number.float({ min: 0, max: 1 })
    const orgType = r < 0.6 ? 'client' : r < 0.85 ? 'cabinet' : 'esn'
    listeOrganisations.push({
      ref: `GEN-O${pad(i, 3)}`,
      id: f.string.uuid(),
      role: orgType === 'client' ? 'entreprise' : 'cabinet',
      orgType,
      telephone: `+3368${pad(i, 7)}`,
      prenom: f.person.firstName(),
      nom: f.person.lastName(),
      societe: f.company.name().slice(0, 120),
    })
  }
  const listeMissions = []
  for (let i = 1; i <= missions; i++) {
    const org = parmi(listeOrganisations)
    const branche = parmi(branches)
    const autre = f.number.float({ min: 0, max: 1 }) < 0.08
    listeMissions.push({
      ref: `GEN-M${pad(i, 3)}`,
      organisation: org.ref,
      type: f.number.float({ min: 0, max: 1 }) < 0.7 ? 'mission' : 'offre',
      branche: branche.id,
      specialites: autre ? [] : plusieurs(branche.specialites, 1, 3),
      seniorites: f.number.float({ min: 0, max: 1 }) < 0.3 ? [] : plusieurs(SENIORITES, 1, 2),
      zones: f.number.float({ min: 0, max: 1 }) < 0.15 && referentiel.continents.length ? [parmi(referentiel.continents)] : plusieurs(pays, 1, 2),
      titre: `GEN-M${pad(i, 3)} ${f.person.jobTitle()}`.slice(0, 180),
      description: texte(120, 900),
    })
  }
  return { graine, experts: listeExperts, organisations: listeOrganisations, missions: listeMissions }
}

// ═══ LE SQL, depuis le jeu ═══════════════════════════════════════════════════
const lit = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`)
const tab = (xs, type) => (xs.length ? `array[${xs.map(lit).join(', ')}]::${type}[]` : `'{}'::${type}[]`)

export function sqlDuJeu(jeu) {
  const l = []
  l.push('\\ir supabase/tests/database/grand_livre/_fabriques.psql')
  l.push('create temp table jeu_refs (ref text primary key, valeur text not null);')
  l.push(`create or replace function pg_temp.zone_ref(p text) returns uuid language plpgsql as $$
declare v uuid;
begin
  if length(p) = 2 then select z.id into v from public.work_zones z where z.country_code = p and z.active order by z.id limit 1;
  else select z.id into v from public.work_zones z where z.code = p and z.active limit 1; end if;
  if v is null then raise exception 'jeu : zone % absente du référentiel', p; end if;
  return v;
end $$;`)
  l.push(`create or replace function pg_temp.gen_compte(p_id uuid, p_role text, p_tel text, p_prenom text, p_nom text, p_extra jsonb)
returns uuid language plpgsql as $$
declare v_email text := pg_temp.fab_email(p_id);
begin
  perform pg_temp.fab_auth(p_id, v_email, pg_temp.fab_signer(v_email,
    pg_temp.fab_meta(p_role, p_id) || jsonb_build_object('telephone', p_tel, 'firstname', p_prenom, 'lastname', p_nom) || coalesce(p_extra, '{}'::jsonb)));
  if not exists (select 1 from public.users u where u.id = p_id) then raise exception 'jeu : le compte % n est pas ne', p_id; end if;
  return p_id;
end $$;`)
  l.push(`create or replace function pg_temp.gen_expert(p_id uuid, p_voie text, p_tel text, p_prenom text, p_nom text, p_branche uuid,
  p_specs uuid[], p_autre text, p_seniorites text[], p_zones text[], p_titre text, p_resume text,
  p_occupe boolean, p_ouvert boolean, p_visible boolean, p_approuve boolean)
returns uuid language plpgsql as $$
declare v_profil uuid; v_freelance boolean := p_voie = 'expert';
begin
  perform pg_temp.gen_compte(p_id, p_voie, p_tel, p_prenom, p_nom, null);
  select p.id into v_profil from public.profiles p where p.user_id = p_id;
  update public.profiles set
    branch_id = p_branche, speciality_ids = p_specs, speciality_other = p_autre, seniorities = p_seniorites,
    work_zone_ids = (select array_agg(pg_temp.zone_ref(z)) from unnest(p_zones) z),
    title = p_titre, summary = p_resume, skills = array['Jeu de nuit']::text[], years_total_experience = 6,
    availability_status = case when v_freelance then (case when p_occupe then 'do_not_disturb' else 'available' end) end,
    cdi_status = case when not v_freelance then (case when p_occupe then 'employed' else 'open_to_work' end) end,
    open_to_freelance = (not v_freelance and p_ouvert), open_to_cdi = (v_freelance and p_ouvert),
    cv_parsing_status = 'done', ai_consent_at = now(),
    verification_status = case when p_approuve then 'approved' else 'pending_admin_review' end,
    visible = p_visible
  where id = v_profil;
  return v_profil;
end $$;`)
  l.push(`create or replace function pg_temp.gen_organisation(p_id uuid, p_role text, p_org_type text, p_tel text, p_prenom text,
  p_nom text, p_societe text, p_admin uuid)
returns uuid language plpgsql as $$
declare v_org uuid; v_statut text;
begin
  perform pg_temp.gen_compte(p_id, p_role, p_tel, p_prenom, p_nom, jsonb_build_object('org_type', p_org_type, 'company_name', p_societe));
  select m.organization_id into v_org from public.organization_members m where m.user_id = p_id and m.status = 'active' limit 1;
  select o.verification_status into v_statut from public.organizations o where o.id = v_org;
  perform public.statuer_sur_organisation(gen_random_uuid(), null, 'administrateur', p_admin, 'admin', v_org, v_statut, true, null);
  return v_org;
end $$;`)
  l.push(`create or replace function pg_temp.gen_mission(p_auteur uuid, p_type text, p_branche uuid, p_specs uuid[], p_seniorites text[],
  p_zones text[], p_titre text, p_description text)
returns uuid language plpgsql as $$
declare v_org uuid; v_pub uuid; v_type_compte text; v_r jsonb;
begin
  select m.organization_id into v_org from public.organization_members m where m.user_id = p_auteur and m.status = 'active' limit 1;
  select u.user_type into v_type_compte from public.users u where u.id = p_auteur;
  v_pub := pg_temp.fab_brouillon(v_org, p_type);
  update public.publications set title = p_titre, description = p_description, branch_id = p_branche,
    speciality_ids = p_specs, seniorities = p_seniorites, skills_required = array['Jeu de nuit']::text[],
    work_zone_ids = (select array_agg(pg_temp.zone_ref(z)) from unnest(p_zones) z)
  where id = v_pub;
  v_r := public.publier_annonce(gen_random_uuid(), null, 'utilisateur', p_auteur, v_type_compte, v_pub, pg_temp.fab_domaine(), v_org,
                                array['draft'], 'published', 8, 'jeu', '{}'::jsonb);
  if v_r ->> 'status' is distinct from 'published' then raise exception 'jeu : publication echouee [%]', v_r; end if;
  return v_pub;
end $$;`)
  l.push(`insert into jeu_refs values ('admin', pg_temp.fab_admin()::text);`)
  for (const e of jeu.experts) {
    l.push(`insert into jeu_refs values (${lit(`profil:${e.ref}`)}, pg_temp.gen_expert(${lit(e.id)}, ${lit(e.voie)}, ${lit(e.telephone)}, ${lit(e.prenom)}, ${lit(e.nom)}, ${lit(e.branche)}, ${tab(e.specialites, 'uuid')}, ${lit(e.autre)}, ${tab(e.seniorites, 'text')}, ${tab(e.zones, 'text')}, ${lit(e.titre)}, ${lit(e.resume)}, ${e.occupe}, ${e.ouvert}, ${e.visible}, ${e.approuve})::text);`)
  }
  for (const o of jeu.organisations) {
    l.push(`insert into jeu_refs values (${lit(`org:${o.ref}`)}, pg_temp.gen_organisation(${lit(o.id)}, ${lit(o.role)}, ${lit(o.orgType)}, ${lit(o.telephone)}, ${lit(o.prenom)}, ${lit(o.nom)}, ${lit(o.societe)}, (select valeur::uuid from jeu_refs where ref = 'admin'))::text);`)
  }
  const auteur = new Map(jeu.organisations.map((o) => [o.ref, o.id]))
  for (const m of jeu.missions) {
    l.push(`insert into jeu_refs values (${lit(`pub:${m.ref}`)}, pg_temp.gen_mission(${lit(auteur.get(m.organisation))}, ${lit(m.type)}, ${lit(m.branche)}, ${tab(m.specialites, 'uuid')}, ${tab(m.seniorites, 'text')}, ${tab(m.zones, 'text')}, ${lit(m.titre)}, ${lit(m.description)})::text);`)
  }
  l.push(`select 'JEU:' || json_object_agg(ref, valeur)::text from jeu_refs;`)
  return l.join('\n')
}

/** Lit le référentiel, génère, écrit — après la garde. Rend { jeu, refs, referentiel } ou lève. */
export async function remplir({ db, graine, experts, organisations, missions }) {
  const { cibleDeConstruction } = await import(pathToFileURL(join(RACINE, 'lib/configuration/variables.ts')).href)
  const cible = cibleDuJeu(process.env, db, cibleDeConstruction)
  if (!cible.autorisee) throw new Error(`cible refusée : ${cible.motif} (tests/integration/cible-du-jeu.mjs)`)
  const referentiel = lireJson(executerSql(SQL_REFERENTIEL, { db }), 'REFERENTIEL')
  const jeu = genererJeu({ graine, experts, organisations, missions, referentiel })
  const refs = lireJson(executerSql(sqlDuJeu(jeu), { db }), 'JEU')
  return { jeu, refs, referentiel, cible }
}

// ── En ligne de commande ──
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (nom, defaut) => Number(process.argv.find((a) => a.startsWith(`--${nom}=`))?.split('=')[1] ?? defaut)
  if (process.argv.includes('--sql')) {
    const referentiel = { branches: [{ id: '00000000-0000-4000-8000-0000000000b1', specialites: ['00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2'] }],
      pays: ['FR', 'DE', 'MA', 'ES'], continents: ['EU', 'AF'], monde: 'WORLD' }
    console.log(sqlDuJeu(genererJeu({ graine: arg('graine', GRAINE_PAR_DEFAUT), experts: 10, organisations: 4, missions: 6, referentiel })))
  } else {
    const db = process.env.SUPABASE_DB_URL ?? ''
    if (!db) nAPasTourne('Générateur du grand jeu', 'SUPABASE_DB_URL absente : la base visée doit être nommée')
    else {
      try {
        const debut = Date.now()
        const { jeu, cible } = await remplir({ db, graine: arg('graine', GRAINE_PAR_DEFAUT), experts: arg('experts', 1000), organisations: arg('organisations', 200), missions: arg('missions', 300) })
        console.log(`Jeu écrit (${cible.cible}) : ${jeu.experts.length} experts, ${jeu.organisations.length} organisations, ${jeu.missions.length} missions, graine ${jeu.graine}, en ${Math.round((Date.now() - debut) / 1000)} s.`)
      } catch (e) {
        nAPasTourne('Générateur du grand jeu', e.message)
      }
    }
  }
}
