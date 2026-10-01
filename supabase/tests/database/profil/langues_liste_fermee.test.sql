-- LES LANGUES SE CHOISISSENT DANS UNE LISTE FERMÉE (recette staging du 01/10/2026, point 3) — migration
-- `langues_liste_fermee` (lot A : tables, `code_de_langue`, reprise), et sa garde `langues_garde` (lot B, déployé APRÈS :
-- le déclencheur LG001). Ce test décrit l'état FINAL, lot B compris (rejeu local du lot B, 01/10/2026 : il décrivait
-- encore la fenêtre du lot A — le texte libre accepté — et ses sections B et C mouraient sur LG001) :
--   A. la liste existe, ses noms rattachent un texte libre à son code (quatre langues, natif, sans accents) ;
--   B. après le lot B, le TEXTE LIBRE est REFUSÉ à l'insertion (LG001), et ce que le code du lot A envoie — des CODES de
--      la liste — passe par `remplacer_listes_profil` ;
--   C. la reprise des lignes HÉRITÉES de `profile_languages` : « French » et « Français » d'un même profil deviennent
--      UNE ligne `fr` (la principale d'abord), « Klingon » reste tel quel, « English » d'un autre profil devient `en` ;
--      la liste PLATE suit ; rejouée, elle ne fait plus rien ; elle est fermée au navigateur.
--
-- ⚠️ EXCEPTION NOMMÉE À §G.4 ter (« jamais un trigger désactivé ») — décision de Youssef, 01/10/2026 : les lignes
--    héritées sont celles qu'écrivait le code d'AVANT pendant la fenêtre du lot A, quand la garde n'existait pas encore.
--    Elles ne se fabriquent qu'en reproduisant cette fenêtre : la garde est DÉSACTIVÉE le temps de leur seule insertion,
--    dans la transaction du test (annulée), RÉACTIVÉE aussitôt — et le test vérifie qu'elle mord de nouveau (C).
--    Sans cela, la reprise retombe dans §E.103 : intestable.
-- Colonnes et contraintes lues dans les migrations (§G.10) : profile_languages (language varchar 50 NOT NULL, level
-- A1–C2 ou native NOT NULL, is_primary NOT NULL, unique (profile_id, language), clé vers profiles en cascade ; un seul
-- déclencheur, profile_languages_langue_de_la_liste, posé par langues_garde) ; profiles.languages (text[]).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(12);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_profil uuid := pg_temp.fab_profil('expert');
  v_autre  uuid := pg_temp.fab_profil('expert');
  v_tiers  uuid := pg_temp.fab_profil('expert');
  v_bilan  jsonb;
begin
  -- A.
  return next ok((select count(*) >= 90 from public.langues l where l.active)
                 and exists (select 1 from public.langues l where l.code = 'fr')
                 and exists (select 1 from public.langues l where l.code = 'ar'),
                 'A. la liste fermée est semée');
  return next ok(public.code_de_langue('French') = 'fr' and public.code_de_langue('Français') = 'fr'
                 and public.code_de_langue('francais') = 'fr' and public.code_de_langue('Francés') = 'fr'
                 and public.code_de_langue('Französisch') = 'fr' and public.code_de_langue(' ARABIC ') = 'ar'
                 and public.code_de_langue('FR') = 'fr',
                 'A. un nom ou un code, dans les quatre langues, se rattache à son code');
  return next ok(public.code_de_langue('Klingon') is null and public.code_de_langue('') is null,
                 'A. ce qu''aucun nom ne reconnaît ne se rattache à rien');

  -- B. après le lot B : le texte libre est refusé ; les codes que le code du lot A envoie passent
  delete from public.profile_languages where profile_id in (v_profil, v_autre, v_tiers);
  return next throws_ok(format($q$insert into public.profile_languages (profile_id, language, level, is_primary) values (%L, 'French', 'B2', false)$q$, v_profil),
                        'LG001', null, 'B. un nom en texte libre est REFUSÉ à l''insertion (LG001, la garde du lot B)');
  perform public.remplacer_listes_profil(v_tiers, null, null, '[{"language":"en","level":"B2","is_primary":true},{"language":"fr","level":"native","is_primary":false}]'::jsonb);
  return next ok((select count(*) = 2 from public.profile_languages l where l.profile_id = v_tiers and l.language in ('en', 'fr')),
                 'B. remplacer_listes_profil écrit les CODES de la liste — ce que le code du lot A envoie passe la garde');

  -- C. la reprise des lignes héritées, écrites comme pendant la fenêtre du lot A (garde désactivée pour cette seule
  --    insertion, dans la transaction annulée — voir l'en-tête), puis la garde rétablie.
  alter table public.profile_languages disable trigger profile_languages_langue_de_la_liste;
  insert into public.profile_languages (profile_id, language, level, is_primary)
  values (v_profil, 'French', 'B2', false), (v_profil, 'Français', 'C1', true), (v_profil, 'Klingon', 'A1', false),
         (v_autre, 'English', 'B2', true);
  alter table public.profile_languages enable trigger profile_languages_langue_de_la_liste;
  return next throws_ok(format($q$insert into public.profile_languages (profile_id, language, level, is_primary) values (%L, 'Spanish', 'B1', false)$q$, v_autre),
                        'LG001', null, 'C. la garde est RÉTABLIE après la fabrique des lignes héritées : le texte libre est de nouveau refusé');

  v_bilan := public.rattacher_langues_heritees();
  return next ok((select count(*) = 1 from public.profile_languages l where l.profile_id = v_profil and l.language = 'fr')
                 and (select l.is_primary and l.level = 'C1' from public.profile_languages l where l.profile_id = v_profil and l.language = 'fr'),
                 'C. « French » et « Français » deviennent UNE ligne fr — la principale gardée');
  return next ok(exists (select 1 from public.profile_languages l where l.profile_id = v_profil and l.language = 'Klingon')
                 and exists (select 1 from public.profile_languages l where l.profile_id = v_autre and l.language = 'en'),
                 'C. « Klingon » reste tel quel ; « English » d''un autre profil devient en');
  update public.profiles set languages = array['French', 'fr', 'Klingon'] where id = v_profil;
  v_bilan := public.rattacher_langues_heritees();
  -- L'ENSEMBLE, pas l'ordre : `distinct on` trie selon la collation de la base, qui n'est pas la même partout.
  return next ok((select p.languages @> array['fr', 'Klingon'] and cardinality(p.languages) = 2 from public.profiles p where p.id = v_profil),
                 'C. la liste plate : « French » rejoint « fr » (une fois), l''inconnu reste tel quel');
  v_bilan := public.rattacher_langues_heritees();
  return next ok((v_bilan ->> 'rattachees')::int = 0 and (v_bilan ->> 'doublons')::int = 0 and (v_bilan ->> 'profils')::int = 0,
                 'C. rejouée, la reprise ne fait plus rien');
  return next ok((v_bilan ->> 'non_reconnues')::int >= 1,
                 'C. ce qu''elle ne reconnaît pas, elle le COMPTE (non_reconnues) au lieu de le taire');
  return next ok(not has_function_privilege('authenticated', 'public.rattacher_langues_heritees()', 'execute')
                 and not has_table_privilege('authenticated', 'public.langues', 'insert'),
                 'C. la reprise et la liste sont fermées au navigateur');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
