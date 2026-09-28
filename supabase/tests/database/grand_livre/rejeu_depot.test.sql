-- LE REJEU D'UN DÉPÔT EN ÉCHEC EST UN NOUVEAU GESTE (§D.26, architecture §C.20) — le chemin de
-- POST /api/admin/depots-en-echec : `contexteDepuisAuth(auth, ligne.piece)` ouvre une pièce NEUVE qui référence
-- celle de la tentative rejouée, puis `deposerCandidature` passe par ouvrir_depot_candidature() et
-- inserer_candidature_jugee() avec cette pièce et `p_piece_origine`. Ce test rejoue EXACTEMENT ces appels sur des
-- données fabriquées : la ligne du rejeu porte la pièce neuve et `piece_origine` vers l'originale ; la tentative
-- d'origine garde sa pièce et sa ligne ; la pièce d'origine se voit reprise depuis l'écran (lire_piece).
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(6);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_admin();
  v_client uuid := pg_temp.fab_compte('entreprise');
  v_org    uuid := pg_temp.fab_organisation(v_client);
  v_pub    uuid := pg_temp.fab_annonce_publiee(v_org, v_client);
  v_profil uuid := pg_temp.fab_profil('expert');
  v_p0     uuid := gen_random_uuid();   -- la tentative d'origine, qui échoue
  v_p1     uuid := gen_random_uuid();   -- le rejeu de l'administrateur
  v_cand   jsonb;
  v_r      jsonb;
begin
  -- ── la tentative d'origine : ouverte, puis soldée en échec (sa pièce, sa ligne) ──
  perform public.ouvrir_depot_candidature(v_pub, v_profil, pg_temp.fab_domaine(), 'sonde', v_p0);
  perform public.solder_depot_en_echec(v_p0, null, 'systeme', null, null, v_pub, v_profil, 'plafond', 'panne simulee');
  return next ok(pg_temp.lignes(v_p0) = 1
                 and exists (select 1 from public.candidature_depots d where d.publication_id = v_pub and d.profile_id = v_profil
                              and d.etat = 'echec' and d.piece = v_p0),
                 'la tentative d''origine : en échec, sous SA pièce, une ligne');

  -- ── le rejeu : pièce NEUVE, pièce d'origine vers la tentative rejouée ──
  perform public.ouvrir_depot_candidature(v_pub, v_profil, pg_temp.fab_domaine(), 'sonde', v_p1);
  v_cand := jsonb_build_object('publication_id', v_pub, 'profile_id', v_profil, 'domain_id', pg_temp.fab_domaine(),
                               'ai_match_score', 7, 'ai_assessment', jsonb_build_object('reason', 'sonde', 'pitch_org', 'sonde', 'model', 'sonde'),
                               'ai_model', 'sonde', 'status', 'received', 'preview', '{}'::jsonb);
  v_r := public.inserer_candidature_jugee(v_p1, v_p0, 'administrateur', v_admin, 'admin', v_cand, 'relance_admin');
  return next ok(v_r ->> 'id' is not null
                 and exists (select 1 from public.candidature_depots d where d.publication_id = v_pub and d.profile_id = v_profil
                              and d.etat = 'depose' and d.piece = v_p1 and d.tentatives = 2),
                 'le rejeu dépose : le journal du dépôt passe sous la pièce NEUVE, tentative 2');
  return next ok(pg_temp.lignes(v_p1) = 1
                 and exists (select 1 from public.grand_livre g where g.piece = v_p1 and g.type_action = 'candidature_deposee'
                              and g.piece_origine = v_p0 and g.origine = 'administrateur' and g.acteur_id = v_admin
                              and g.detail ->> 'origine_depot' = 'relance_admin' and g.detail ->> 'tentative' = '2'),
                 'UNE ligne du rejeu : nouvelle pièce, piece_origine vers la tentative d''origine, l''administrateur qui l''a décidé');
  return next ok(pg_temp.lignes(v_p0) = 1
                 and not exists (select 1 from public.grand_livre g where g.piece = v_p0 and g.type_action = 'candidature_deposee'),
                 'la tentative d''origine garde sa ligne, et aucune candidature ne s''écrit sous sa pièce');
  -- ── depuis l'écran : la pièce d'origine se voit reprise, le rejeu montre d'où il vient ──
  return next ok((public.lire_piece(v_admin, v_p0) -> 'referencee_par') @> to_jsonb(array[v_p1]),
                 'lire_piece(pièce d''origine) : « reprise par » la pièce du rejeu');
  return next ok(public.lire_piece(v_admin, v_p1) -> 'lignes' -> 0 ->> 'piece_origine' = v_p0::text,
                 'lire_piece(rejeu) : la ligne porte sa pièce d''origine — le lien de l''écran');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
