-- « AUTRE » : LA DÉFINITION, UNE SEULE (relecture indépendante du 01/10/2026, point 11) — migration
-- `specialite_autre_hors_referentiel` (premier temps : la fonction seule ; la reprise, la contrainte et la garde des
-- traductions sont au lot suivant, `specialite_autre_garde`, et prouvées par autre_hors_referentiel.test.sql).
--   · le mot, dans les quatre langues du produit, seul ou suivi d'une parenthèse, est « Autre » — c'est ce que
--     l'administration DEMANDE avant d'écrire un nom ou une TRADUCTION (« Other », « Otra » passaient) ;
--   · un slug de cette forme aussi, suffixe numérique compris ;
--   · un nom qui CONTIENT le mot sans l'être (« Autres services », « Otherwise ») n'est pas « Autre ».
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select ok(public.est_specialite_autre('Autre', null) and public.est_specialite_autre('autres', null)
          and public.est_specialite_autre('Autre (préciser)', null),
          'le mot français, seul ou avec sa parenthèse, est « Autre »');
select ok(public.est_specialite_autre('Other', null) and public.est_specialite_autre('Otra', null)
          and public.est_specialite_autre('Otro', null) and public.est_specialite_autre('Andere', null)
          and public.est_specialite_autre('Sonstiges', null),
          'une TRADUCTION — anglais, espagnol, allemand — est « Autre » aussi');
select ok(public.est_specialite_autre(null, 'autre') and public.est_specialite_autre(null, 'autre-2')
          and public.est_specialite_autre(null, 'other'),
          'un slug de cette forme, suffixe numérique compris, est « Autre »');
select ok(not public.est_specialite_autre('Autres services', null) and not public.est_specialite_autre('Otherwise', null)
          and not public.est_specialite_autre('Données', 'donnees') and not public.est_specialite_autre(null, null),
          'un nom qui contient le mot sans l''être, ou rien, n''est pas « Autre »');

select * from finish();
rollback;
