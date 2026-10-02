-- LES CRITÈRES COMMUNS DE L'ANNONCE ET DU PROFIL (lot « critères des annonces », 03/10/2026 — §D.39 ; migration
-- annonce_criteres_communs).
--
--  CE QUI EST PROUVÉ ICI :
--   A. LE CODE EN LIGNE N'ÉCHOUE PAS (§E.72) : une annonce écrite « à l'ancienne » — sans les colonnes neuves, avec
--      `work_mode` et `duration` en texte — se crée, se modifie et se publie ; un profil aussi ;
--   B. LES CONTRAINTES REFUSENT ce qu'elles doivent refuser (23514), et acceptent ce que les écrans écrivent ;
--   C. `lire_duree` lit ce qui se lit (un nombre, une unité connue, quatre langues) et ne devine rien ;
--   D. LA REPRISE sur des lignes fabriquées comme le code en ligne les écrit : le mode unique devient la liste, la durée
--      lisible devient un nombre et une unité, l'illisible est NOMMÉE, une offre CDI ne reçoit aucune durée, et un second
--      passage ne change rien.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(27);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_compte('entreprise');
  v_org    uuid := pg_temp.fab_organisation(v_admin);
  v_profil uuid := pg_temp.fab_profil('expert');
  a_vieux  uuid;
  a_lisible uuid := pg_temp.fab_brouillon(v_org, 'mission');
  a_six    uuid := pg_temp.fab_brouillon(v_org, 'sous_traitance');
  a_offre  uuid := pg_temp.fab_brouillon(v_org, 'offre');
  a_neuve  uuid := pg_temp.fab_brouillon(v_org, 'mission');
  v_r      jsonb;
  v_r2     jsonb;
begin
  -- ── A. LE CODE EN LIGNE : une écriture « à l'ancienne » passe ───────────────────────────────────────────────────
  a_vieux := pg_temp.fab_brouillon(v_org, 'mission');
  return next lives_ok(
    format($q$update public.publications set work_mode = 'hybrid', duration = '6 mois renouvelables', title = 'Ancienne' where id = %L$q$, a_vieux),
    'A1. une annonce modifiée à l''ancienne (work_mode, duration en texte) passe');
  return next lives_ok(
    format($q$select pg_temp.fab_annonce_publiee(%L, %L, 'offre')$q$, v_org, v_admin),
    'A2. une offre publiée par le chemin de publication, sans les colonnes neuves, passe');
  return next lives_ok(
    format($q$update public.profiles set work_modes = array['remote','hybrid'], title = 'Sonde' where id = %L$q$, v_profil),
    'A3. un profil écrit à l''ancienne (sans temps_travail) passe');
  return next ok((select p.work_modes = '{}' and p.temps_travail = '{}' and p.duree_valeur is null and p.jours_sur_site is null
                    from public.publications p where p.id = a_vieux),
    'A4. une annonce écrite à l''ancienne garde les défauts vides des colonnes neuves');

  -- ── B. LES CONTRAINTES ─────────────────────────────────────────────────────────────────────────────────────────
  return next throws_ok(format($q$update public.publications set work_modes = array['teletravail'] where id = %L$q$, a_neuve),
    '23514', null, 'B1. un mode de travail hors liste est refusé');
  return next throws_ok(format($q$update public.publications set temps_travail = array['mi_temps'] where id = %L$q$, a_neuve),
    '23514', null, 'B2. un temps de travail hors liste est refusé (annonce)');
  return next throws_ok(format($q$update public.profiles set temps_travail = array['mi_temps'] where id = %L$q$, v_profil),
    '23514', null, 'B3. un temps de travail hors liste est refusé (profil)');
  return next throws_ok(format($q$update public.publications set work_modes = array['remote'], jours_sur_site = 3, jours_teletravail = 2 where id = %L$q$, a_neuve),
    '23514', null, 'B4. une répartition sans « Hybride » est refusée');
  return next throws_ok(format($q$update public.publications set work_modes = array['hybrid'], jours_sur_site = 5, jours_teletravail = 3 where id = %L$q$, a_neuve),
    '23514', null, 'B5. une répartition de plus de sept jours est refusée');
  return next throws_ok(format($q$update public.publications set work_modes = array['hybrid'], jours_sur_site = 0, jours_teletravail = 5 where id = %L$q$, a_neuve),
    '23514', null, 'B6. zéro jour sur site n''est pas de l''hybride : refusé');
  return next throws_ok(format($q$update public.publications set duree_valeur = 6 where id = %L$q$, a_neuve),
    '23514', null, 'B7. une durée sans unité est refusée');
  return next throws_ok(format($q$update public.publications set duree_valeur = 0, duree_unite = 'mois' where id = %L$q$, a_neuve),
    '23514', null, 'B8. une durée nulle est refusée');
  return next throws_ok(format($q$update public.publications set duree_valeur = 1, duree_unite = 'annees' where id = %L$q$, a_offre),
    '23514', null, 'B9. une offre CDI n''a pas de durée : refusée');
  return next lives_ok(
    format($q$update public.publications set work_modes = array['onsite','hybrid'], jours_sur_site = 3, jours_teletravail = 2,
                                            temps_travail = array['plein','partiel'], duree_valeur = 6, duree_unite = 'mois'
              where id = %L$q$, a_neuve),
    'B10. ce que les écrans écrivent passe : modes multiples, répartition 3 + 2, temps plein et partiel, 6 mois');
  return next lives_ok(format($q$update public.profiles set temps_travail = array['partiel'] where id = %L$q$, v_profil),
    'B11. un profil « temps partiel » passe');

  -- ── C. LIRE UNE DURÉE ──────────────────────────────────────────────────────────────────────────────────────────
  return next is((select row(d.valeur, d.unite)::text from public.lire_duree('6 mois') d), '(6,mois)', 'C1. « 6 mois » → 6 mois');
  return next is((select row(d.valeur, d.unite)::text from public.lire_duree(' 3 Weeks ') d), '(3,semaines)', 'C2. « 3 Weeks » → 3 semaines');
  return next is((select row(d.valeur, d.unite)::text from public.lire_duree('1 an renouvelable') d), '(1,annees)', 'C3. « 1 an renouvelable » → 1 an');
  return next is((select row(d.valeur, d.unite)::text from public.lire_duree('2 años') d), '(2,annees)', 'C4. « 2 años » → 2 ans');
  return next is((select row(d.valeur, d.unite)::text from public.lire_duree('10 Tage') d), '(10,jours)', 'C5. « 10 Tage » → 10 jours');
  return next is((select count(*)::integer from public.lire_duree('6') d), 0, 'C6. « 6 » ne se lit pas (quelle unité ?)');
  return next is((select count(*)::integer from (select * from public.lire_duree('3 à 6 mois') union all select * from public.lire_duree('CDI')
                    union all select * from public.lire_duree('0 mois') union all select * from public.lire_duree(null)) d), 0,
    'C7. « 3 à 6 mois », « CDI », « 0 mois » et rien ne se lisent pas');

  -- ── D. LA REPRISE, sur des lignes écrites comme le code en ligne les écrit ─────────────────────────────────────
  update public.publications set work_mode = 'remote', duration = '6 mois' where id = a_lisible;
  update public.publications set duration = '6' where id = a_six;
  update public.publications set duration = '1 an' where id = a_offre;
  v_r := public.reprendre_criteres_annonces();
  return next ok((select p.work_modes = array['remote'] and p.duree_valeur = 6 and p.duree_unite = 'mois'
                    from public.publications p where p.id = a_lisible)
                 and (select p.work_modes = array['hybrid'] and p.duree_valeur = 6 and p.duree_unite = 'mois'
                        from public.publications p where p.id = a_vieux),
    'D1. le mode unique devient la liste, « 6 mois » et « 6 mois renouvelables » deviennent 6 mois');
  return next ok((select p.duree_valeur is null from public.publications p where p.id = a_six)
                 and exists (select 1 from jsonb_array_elements(v_r -> 'durees_illisibles') e
                              where e ->> 'id' = a_six::text and e ->> 'duree' = '6'),
    'D2. « 6 » n''est pas devinée : la durée reste vide, et l''annonce est NOMMÉE parmi les illisibles');
  return next ok((select p.duree_valeur is null from public.publications p where p.id = a_offre)
                 and (v_r ->> 'offres_avec_duree_texte')::integer >= 1,
    'D3. une offre CDI ne reçoit aucune durée (elle est comptée à part)');
  v_r2 := public.reprendre_criteres_annonces();
  return next ok((v_r2 ->> 'modes_repris')::integer = 0 and (v_r2 ->> 'durees_reprises')::integer = 0,
    'D4. un second passage ne reprend plus rien (idempotente)');
  return next ok((select p.duree_valeur = 6 and p.duree_unite = 'mois' and p.work_modes = array['onsite','hybrid']
                    from public.publications p where p.id = a_neuve),
    'D5. la reprise ne touche pas une annonce qui a déjà ses critères');
end $$;

select * from pg_temp.essai();

select * from finish();
rollback;
