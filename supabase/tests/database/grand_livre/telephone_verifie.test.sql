-- telephone_verifie — verifier_telephone() : le drapeau, le numéro sur le COMPTE et la ligne, ensemble ;
-- le numéro n'entre jamais dans la ligne ; un compte inconnu n'écrit rien. Depuis l'ARRÊT 22 (décision de Youssef,
-- 01/10/2026) : le MÊME numéro, déjà vérifié, revérifié, ne change rien et n'écrit rien. Relecture du 01/10/2026,
-- point 21 : le même numéro NON vérifié, lui, est un changement — le drapeau passe à vrai, et la ligne s'écrit.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(6);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_user uuid := pg_temp.fab_compte('expert');
  -- Un numéro qu'aucun compte ne peut porter : indicatif +999 non attribué, tiré au hasard.
  v_tel  text := '+999' || lpad((floor(random() * 1e10))::bigint::text, 10, '0');
  v_p1   uuid := gen_random_uuid();
  v_p2   uuid := gen_random_uuid();
  v_p3   uuid := gen_random_uuid();
  v_p4   uuid := gen_random_uuid();
  v_ok   boolean;
begin
  return next ok(public.verifier_telephone(v_p1, null, 'utilisateur', v_user, 'expert_freelance', v_user, v_tel, 'otp_sms'),
                 'le téléphone est vérifié');
  return next ok(exists (select 1 from public.users u where u.id = v_user and u.phone_verified and u.phone = v_tel),
                 'le drapeau et le numéro sont sur le compte');
  return next ok(pg_temp.lignes(v_p1) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p1
                  and g.type_action = 'telephone_verifie' and g.detail ->> 'methode' = 'otp_sms' and g.detail::text not like '%' || v_tel || '%'),
                 'exactement UNE ligne, avec la méthode et SANS le numéro');
  return next ok(not public.verifier_telephone(v_p2, null, 'utilisateur', v_user, 'expert_freelance', gen_random_uuid(), v_tel || '9', 'otp_sms')
                 and pg_temp.lignes(v_p2) = 0,
                 'un compte inconnu rend false et n''écrit rien');
  return next ok(public.verifier_telephone(v_p3, null, 'utilisateur', v_user, 'expert_freelance', v_user, v_tel, 'otp_sms')
                 and pg_temp.lignes(v_p3) = 0,
                 'le même numéro, déjà vérifié : true, et AUCUNE ligne');
  update public.users set phone_verified = false where id = v_user;
  v_ok := public.verifier_telephone(v_p4, null, 'utilisateur', v_user, 'expert_freelance', v_user, v_tel, 'otp_sms');
  return next ok(v_ok and pg_temp.lignes(v_p4) = 1
                 and exists (select 1 from public.users u where u.id = v_user and u.phone_verified and u.phone = v_tel),
                 'le même numéro, NON vérifié : vérifié, et UNE ligne');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
