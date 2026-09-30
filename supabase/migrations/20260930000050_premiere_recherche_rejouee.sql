-- ════════════════════════════════════════════════════════════════════════════
--  UNE PREMIÈRE MISE EN RELATION RATÉE EST REJOUÉE — et l'écran de l'expert dit
--  qu'elle a échoué, au lieu d'« aucune opportunité » (§C.14, 30/09/2026).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent. Remplace deux fonctions À SIGNATURE
--  IDENTIQUE. Rejouable.
--
--  LE DÉFAUT (audit du 30/09/2026 sur aac5f79, M5) : `echouer_relance_expert`
--  posait la date et le code de l'échec, JAMAIS l'échéance. Or la file
--  (`prochaine_relance_expert`) et l'écran (`etatDerniereRecherche`) exigent
--  toutes deux une échéance. Une recherche lancée DIRECTEMENT — à l'approbation
--  par un administrateur, à l'auto-approbation, à une bascule de disponibilité —
--  n'en a pas : son échec n'était ni rejoué ni affiché. L'expert lisait « aucune
--  opportunité pour le moment », pour toujours. C'est le moment que §C.14 appelle
--  « le premier contact avec la plateforme ».
--
--  LA RÈGLE : un échec POSE une échéance s'il n'y en a pas — maintenant ; le
--  pilote `expert_relance_trigger` la reprend après son délai de grâce, bornée
--  par le plafond de tentatives. Une échéance déjà posée n'est pas avancée.
--
--  ET LE PLAFOND NE S'USE PLUS POUR TOUJOURS : cinq échecs vidaient le compteur
--  de tentatives, et une relance posée PLUS TARD par une modification de profil
--  n'était plus jamais sélectionnée. Une modification est une raison NOUVELLE de
--  chercher : `programmer_relance_expert` rouvre le compteur. Le coût reste borné
--  par le plafond horaire des programmations (20 par heure, lib/matching/relance.ts).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.echouer_relance_expert(
  p_profile_id uuid,
  p_code       text
) returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_n integer;
begin
  update public.profiles
     set matching_relance_echec_at   = now(),
         matching_relance_echec_code = p_code,
         -- L'ÉCHÉANCE, s'il n'y en a pas : sans elle, rien ne rejoue et rien ne s'affiche.
         matching_relance_due_at     = coalesce(matching_relance_due_at, now()),
         matching_relance_first_at   = coalesce(matching_relance_first_at, now())
   where id = p_profile_id;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'echouer_relance_expert : profiles');
end
$fn$;

create or replace function public.programmer_relance_expert(
  p_profile_id uuid,
  p_delai      interval,
  p_raison     text default null
) returns timestamptz
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_due timestamptz;
  v_n   integer;
begin
  update public.profiles
     set matching_relance_due_at = now() + p_delai,
         matching_relance_first_at = coalesce(matching_relance_first_at, now()),
         matching_relance_reported =
           case when matching_relance_due_at is null then 0
                else matching_relance_reported + 1 end,
         matching_relance_reason = coalesce(p_raison, matching_relance_reason),
         -- Une modification est une raison NOUVELLE : le plafond de tentatives repart.
         matching_relance_tentatives = 0
   where id = p_profile_id
  returning matching_relance_due_at into v_due;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'programmer_relance_expert : profiles');

  return v_due;
end
$fn$;

-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'echouer_relance_expert'
                    and p.prosrc ~ 'matching_relance_due_at\s*=\s*coalesce') then
    raise exception 'postcondition NON TENUE : echouer_relance_expert ne pose pas l echeance';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'programmer_relance_expert'
                    and p.prosrc ~ 'matching_relance_tentatives\s*=\s*0') then
    raise exception 'postcondition NON TENUE : programmer_relance_expert ne rouvre pas le compteur';
  end if;
  raise notice 'postcondition tenue : l echec pose une echeance, la programmation rouvre le compteur ; la reprise est prouvee par tests/database/matching/premiere_recherche.test.sql';
end
$post$;
