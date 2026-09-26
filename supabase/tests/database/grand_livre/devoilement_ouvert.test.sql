-- devoilement_ouvert — devoiler_candidature() : la conversation, la bascule et la ligne, ensemble ;
-- le rejeu est « déjà » sur la même conversation ; une transition invalide n'écrit rien.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(7);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin uuid := pg_temp.fab_compte('entreprise');
  v_org   uuid := pg_temp.fab_organisation(v_admin);
  v_pub   uuid := pg_temp.fab_annonce_publiee(v_org, v_admin);
  v_cand  uuid := pg_temp.fab_candidature(v_pub, pg_temp.fab_profil('expert'));
  v_autre uuid := pg_temp.fab_candidature(v_pub, pg_temp.fab_profil('cdi'));
  v_admis text[] := array['received', 'in_review', 'shortlisted'];
  v_p1    uuid := gen_random_uuid();
  v_p2    uuid := gen_random_uuid();
  v_p3    uuid := gen_random_uuid();
  v_r     jsonb;
  v_r2    jsonb;
begin
  v_r := public.devoiler_candidature(v_p1, null, 'utilisateur', v_admin, 'client', v_cand, v_admis, now() + interval '15 days', false);
  return next is(v_r ->> 'issue', 'devoilee', 'la candidature est dévoilée');
  return next ok(exists (select 1 from public.candidatures c where c.id = v_cand and c.status = 'unlocked')
                 and exists (select 1 from public.conversations v where v.candidature_id = v_cand
                              and v.id = (v_r ->> 'conversation_id')::uuid and v.status = 'open'),
                 'la bascule et la conversation sont relues');
  return next is(pg_temp.lignes(v_p1), 1::bigint, 'exactement UNE ligne sous la pièce');
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p1 and g.type_action = 'devoilement_ouvert'
                          and g.detail ->> 'conversation_id' = v_r ->> 'conversation_id' and (g.detail ->> 'auto')::boolean = false),
                 'la ligne porte la conversation et l''origine (manuel)');
  v_r2 := public.devoiler_candidature(v_p2, null, 'systeme', null, null, v_cand, v_admis, now() + interval '15 days', true);
  return next ok(v_r2 ->> 'issue' = 'deja' and v_r2 ->> 'conversation_id' = v_r ->> 'conversation_id' and pg_temp.lignes(v_p2) = 0,
                 'le rejeu est « déjà », sur la même conversation, sans ligne');
  -- UNE TRANSITION INVALIDE : une candidature déclinée ne se dévoile pas.
  perform public.decliner_candidature(gen_random_uuid(), null, 'utilisateur', v_admin, 'client', v_autre,
                                      pg_temp.fab_domaine(), v_org, null, v_admis);
  v_r2 := public.devoiler_candidature(v_p3, null, 'utilisateur', v_admin, 'client', v_autre, v_admis, now() + interval '15 days', false);
  return next is(v_r2 ->> 'issue', 'transition', 'une candidature déclinée ne se dévoile pas');
  return next is(pg_temp.lignes(v_p3), 0::bigint, 'la transition invalide n''écrit rien');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
