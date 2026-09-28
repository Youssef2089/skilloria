-- LA MISSION ÉCARTÉE — ecarter_mission(), l'écrivain unique, appelé par POST /api/me/missions/[id]/dismiss.
-- Populations : expert freelance, expert CDI (mission), et la collaboration entre experts (un besoin de
-- sous-traitance arrive par le même fil). Les correspondances sont FABRIQUÉES (le moteur les pose en
-- production) ; tout le reste naît par les chemins normaux. Puis ce que la base refuse : le profil d'autrui.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(8);

create or replace function pg_temp.proposer(p_pub uuid, p_profil uuid) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.matches (publication_id, profile_id, domain_id, status)
  values (p_pub, p_profil, pg_temp.fab_domaine(), 'notified')
  returning id into v;
  return v;
end $$;

create or replace function pg_temp.proprietaire(p_profil uuid) returns uuid
language sql as $$ select p.user_id from public.profiles p where p.id = p_profil $$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin   uuid := pg_temp.fab_compte('entreprise');
  v_org     uuid := pg_temp.fab_organisation(v_admin);
  v_mission uuid := pg_temp.fab_annonce_publiee(v_org, v_admin, 'mission');
  v_st      uuid := pg_temp.fab_annonce_publiee(v_org, v_admin, 'sous_traitance');
  v_free    uuid := pg_temp.fab_profil('expert');
  v_cdi     uuid := pg_temp.fab_profil('cdi');
  v_m       uuid[];
  v_p       uuid[] := array(select gen_random_uuid() from generate_series(1, 6));
  v_r       text;
begin
  v_m := array[pg_temp.proposer(v_mission, v_free), pg_temp.proposer(v_mission, v_cdi), pg_temp.proposer(v_st, v_cdi)];

  -- ── expert freelance : une mission ──
  v_r := public.ecarter_mission(v_p[1], null, 'utilisateur', pg_temp.proprietaire(v_free), 'expert_freelance', v_mission, v_free);
  return next ok(v_r = 'ecartee' and exists (select 1 from public.matches m where m.id = v_m[1] and m.status = 'dismissed'),
                 'freelance : la mission est écartée');
  return next ok(pg_temp.lignes(v_p[1]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[1]
                   and g.type_action = 'mission_ecartee' and g.sujet_type = 'matches' and g.sujet_id = v_m[1]
                   and g.acteur_type = 'expert_freelance' and g.detail ->> 'publication_type' = 'mission'
                   and g.detail ->> 'statut_de' = 'notified' and g.ecosysteme_id = pg_temp.fab_domaine()),
                 'freelance : UNE ligne, sujet le match, le statut d''AVANT et le type d''annonce');
  -- ── expert CDI : la même mission ──
  v_r := public.ecarter_mission(v_p[2], null, 'utilisateur', pg_temp.proprietaire(v_cdi), 'expert_cdi', v_mission, v_cdi);
  return next ok(v_r = 'ecartee' and pg_temp.lignes(v_p[2]) = 1
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[2] and g.acteur_type = 'expert_cdi'),
                 'CDI : écartée, UNE ligne');
  -- ── collaboration entre experts : un besoin de sous-traitance ──
  v_r := public.ecarter_mission(v_p[3], null, 'utilisateur', pg_temp.proprietaire(v_cdi), 'expert_cdi', v_st, v_cdi);
  return next ok(v_r = 'ecartee' and exists (select 1 from public.grand_livre g where g.piece = v_p[3]
                   and g.type_action = 'mission_ecartee' and g.detail ->> 'publication_type' = 'sous_traitance'),
                 'sous-traitance : écartée, la ligne dit le type — le filtre de la collaboration passe par là');
  -- ── idempotent : déjà écartée, rien ne s'écrit ──
  v_r := public.ecarter_mission(v_p[4], null, 'utilisateur', pg_temp.proprietaire(v_free), 'expert_freelance', v_mission, v_free);
  return next ok(v_r = 'deja_ecartee' and pg_temp.lignes(v_p[4]) = 0, 'déjà écartée : aucune ligne, rien n''a changé');
  -- ── le profil d'autrui : introuvable, rien ne change ──
  update public.matches m set status = 'notified' where m.id = v_m[2];
  v_r := public.ecarter_mission(v_p[5], null, 'utilisateur', pg_temp.proprietaire(v_free), 'expert_freelance', v_mission, v_cdi);
  return next ok(v_r = 'introuvable' and pg_temp.lignes(v_p[5]) = 0
                 and exists (select 1 from public.matches m where m.id = v_m[2] and m.status = 'notified'),
                 'le profil d''un autre : introuvable, le match n''est pas touché, aucune ligne');
  v_r := public.ecarter_mission(v_p[6], null, 'utilisateur', pg_temp.proprietaire(v_free), 'expert_freelance', gen_random_uuid(), v_free);
  return next ok(v_r = 'introuvable' and pg_temp.lignes(v_p[6]) = 0, 'une annonce inconnue : introuvable, aucune ligne');
  return next ok(not has_function_privilege('authenticated', 'public.ecarter_mission(uuid, uuid, text, uuid, text, uuid, uuid)', 'execute')
                 and not has_function_privilege('anon', 'public.ecarter_mission(uuid, uuid, text, uuid, text, uuid, uuid)', 'execute'),
                 'ecarter_mission : fermée au navigateur');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
