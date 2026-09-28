-- LE NETTOYAGE DU GRAND LIVRE (phase B 2.7) — regler_conservation_journal(), annoncer_nettoyage_journal(),
-- nettoyer_journal() : le seul chemin de suppression. Les planchers légaux naissent « à arbitrer » (NULL) ; le
-- test en FABRIQUE (le choix est celui de Youssef, écrit par migration). Le passé aussi est fabriqué : journaliser()
-- écrit à now(), et un nettoyage ne touche que ce qui est ANCIEN — des lignes anciennes sont donc insérées
-- directement, dans la transaction annulée du test, seule façon de fabriquer un passé.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(17);

create or replace function pg_temp.ancienne(p_code text, p_mois integer) returns bigint
language plpgsql as $$
declare v bigint;
begin
  insert into public.grand_livre (horodatage, piece, type_action, statut, origine, detail)
  values (now() - make_interval(months => p_mois), gen_random_uuid(), p_code, 'reussi', 'systeme', '{}'::jsonb)
  returning id into v;
  return v;
end $$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_admin();
  v_client uuid := pg_temp.fab_compte('entreprise');
  v_p      uuid[] := array(select gen_random_uuid() from generate_series(1, 8));
  v_r      jsonb;
  v_base   bigint;
  v_vieux  bigint[];
  v_recent bigint;
  v_journal bigint;
  v_compte bigint;
begin
  -- ── AD002 : un non-administrateur ne règle, n'annonce ni ne nettoie ──
  return next throws_ok(format('select public.regler_conservation_journal(%L, %L, %L, 24)', v_p[1], v_client, 'annonce'),
                        'AD002', null, 'regler_conservation_journal : un client est refusé (AD002)');
  return next throws_ok(format('select public.annoncer_nettoyage_journal(%L)', v_client), 'AD002', null,
                        'annoncer_nettoyage_journal : un client est refusé (AD002)');
  return next throws_ok(format('select public.nettoyer_journal(%L, %L, 0)', v_p[1], v_client), 'AD002', null,
                        'nettoyer_journal : un client est refusé (AD002)');

  -- ── les planchers à arbitrer bloquent le réglage ──
  v_r := public.regler_conservation_journal(v_p[1], v_admin, 'annonce', 24);
  return next ok(v_r ->> 'issue' = 'plancher_a_arbitrer' and pg_temp.lignes(v_p[1]) = 0,
                 'plancher à arbitrer : la conservation ne se règle pas, rien ne s''écrit');
  v_r := public.regler_conservation_journal(v_p[1], v_admin, 'journal', 24);
  return next ok(v_r ->> 'issue' = 'journal_conserve', 'la famille journal (les nettoyages eux-mêmes) ne se règle jamais');
  return next is(public.regler_conservation_journal(v_p[1], v_admin, 'inventee', 24) ->> 'issue', 'famille_inconnue'::text,
                 'une famille inconnue est nommée comme telle');

  -- ── des planchers FABRIQUÉS (la décision de Youssef s'écrira par migration) ──
  update public.grand_livre_conservation set plancher_mois = 12 where famille = 'annonce';
  update public.grand_livre_conservation set plancher_mois = 0 where famille = 'recherche';
  v_r := public.regler_conservation_journal(v_p[2], v_admin, 'annonce', 6);
  return next ok(v_r ->> 'issue' = 'sous_le_plancher' and (v_r ->> 'plancher_mois')::int = 12 and pg_temp.lignes(v_p[2]) = 0,
                 'sous le plancher légal : refusé, le plancher est rendu, rien ne s''écrit');
  v_r := public.regler_conservation_journal(v_p[3], v_admin, 'annonce', 24);
  return next ok(v_r ->> 'issue' = 'regle' and pg_temp.lignes(v_p[3]) = 1
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[3] and g.type_action = 'reglage_modifie'
                              and g.detail ->> 'famille' = 'annonce' and g.detail -> 'apres' ->> 'conservation_mois' = '24'
                              and g.detail -> 'avant' -> 'conservation_mois' = 'null'::jsonb),
                 'réglée : UNE ligne reglage_modifie (famille, avant, après)');
  v_r := public.regler_conservation_journal(v_p[4], v_admin, 'annonce', 24);
  return next ok(v_r ->> 'issue' = 'inchange' and pg_temp.lignes(v_p[4]) = 0, 'inchangée : aucune ligne');

  -- ── l'annonce : ce qui serait effacé, famille par famille ──
  select coalesce(sum(x.lignes), 0) into v_base from public.nettoyage_journal_calcul() x;
  v_vieux := array[pg_temp.ancienne('annonce_creee', 30), pg_temp.ancienne('annonce_publiee', 40)];
  v_recent := pg_temp.ancienne('annonce_creee', 2);
  v_journal := pg_temp.ancienne('journal_nettoye', 60);
  v_compte := pg_temp.ancienne('compte_cree', 60);
  v_r := public.annoncer_nettoyage_journal(v_admin);
  return next ok((v_r ->> 'total')::bigint = v_base + 2
                 and exists (select 1 from jsonb_array_elements(v_r -> 'familles') f where f ->> 'famille' = 'annonce'
                              and (f ->> 'lignes')::int >= 2 and f ->> 'jusqu_au' is not null)
                 and exists (select 1 from jsonb_array_elements(v_r -> 'familles') f where f ->> 'famille' = 'compte' and f ->> 'raison' = 'plancher_a_arbitrer')
                 and exists (select 1 from jsonb_array_elements(v_r -> 'familles') f where f ->> 'famille' = 'recherche' and f ->> 'raison' = 'conservation_illimitee')
                 and exists (select 1 from jsonb_array_elements(v_r -> 'familles') f where f ->> 'famille' = 'journal' and f ->> 'raison' = 'journal_conserve'),
                 'l''annonce : les deux lignes anciennes, la date limite ; et la raison de chaque famille qui ne se nettoie pas');

  -- ── la confirmation est une comparaison : un total périmé n'efface rien ──
  v_r := public.nettoyer_journal(v_p[5], v_admin, v_base + 1);
  return next ok(v_r ->> 'issue' = 'annonce_perimee' and pg_temp.lignes(v_p[5]) = 0
                 and exists (select 1 from public.grand_livre g where g.id = v_vieux[1]),
                 'annonce périmée : RIEN n''est effacé, rien ne s''écrit, le total actuel est rendu');

  -- ── le nettoyage : exactement l'annoncé, et sa ligne ──
  v_r := public.nettoyer_journal(v_p[6], v_admin, v_base + 2);
  return next ok(v_r ->> 'issue' = 'nettoye' and (v_r ->> 'lignes')::bigint = v_base + 2
                 and not exists (select 1 from public.grand_livre g where g.id = any (v_vieux)),
                 'nettoyé : les lignes anciennes de la famille réglée sont effacées');
  return next ok(exists (select 1 from public.grand_livre g where g.id = v_recent)
                 and exists (select 1 from public.grand_livre g where g.id = v_journal)
                 and exists (select 1 from public.grand_livre g where g.id = v_compte),
                 'restent : la ligne récente, la trace d''un nettoyage ancien, et la famille sans plancher arbitré');
  return next ok(pg_temp.lignes(v_p[6]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[6]
                   and g.type_action = 'journal_nettoye' and g.acteur_id = v_admin and (g.detail ->> 'lignes')::bigint = v_base + 2
                   and exists (select 1 from jsonb_array_elements(g.detail -> 'familles') f where f ->> 'famille' = 'annonce')),
                 'UNE ligne journal_nettoye : le total, et par famille la date limite et le compte');
  return next is(public.nettoyer_journal(v_p[7], v_admin, 0) ->> 'issue', 'rien_a_nettoyer'::text,
                 'rien à nettoyer : dit, et rien ne s''écrit');

  -- ── le verrou se referme : hors de la fonction, un DELETE lève toujours ──
  return next throws_ok(format('delete from public.grand_livre where id = %s', v_recent), 'GL001', null,
                        'après le nettoyage, le réglage est retiré : un DELETE hors de la fonction lève GL001');
  return next ok(not has_function_privilege('authenticated', 'public.nettoyer_journal(uuid, uuid, bigint)', 'execute')
                 and not has_function_privilege('authenticated', 'public.regler_conservation_journal(uuid, uuid, text, integer)', 'execute')
                 and not has_function_privilege('authenticated', 'public.annoncer_nettoyage_journal(uuid)', 'execute'),
                 'les trois fonctions sont fermées au navigateur');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
