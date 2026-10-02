-- ════════════════════════════════════════════════════════════════════════════
--  UNE SPÉCIALITÉ RÉACTIVÉE NE REVIENT PAS SOUS « AUTRE » — ni « Other », ni « Otra », ni « Andere »
--  (relecteur, 02/10/2026 ; lot zones de travail, point 6).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement, PAR EXCEPTION ÉCRITE (décision de Youssef, 02/10/2026 : pas de migration
--  poussée à part). Elle restreint UN geste, celui qu'elle interdit : réactiver une spécialité dont une traduction
--  EXISTANTE est « Autre ». Le code en ligne (lot B) n'est pas cassé par elle : sa route `update-speciality` écrit la
--  spécialité AVANT toute traduction, lit le refus de la base par `estRefusAutre()` (23514 + le nom de la contrainte)
--  et rend `specialite_autre_reservee` (400) — rien n'est écrit, et l'administrateur lit la règle. `diag-deux-temps`
--  porte l'exception, sa raison, et le PROUVE sur le fichier du commit en ligne.
--
--  LE TROU (ARRÊT 24, « ce qui reste ») : la contrainte `specialities_autre_hors_referentiel` lit le NOM et le SLUG ; la
--  garde des traductions (`translations_specialite_autre`) lit l'ÉCRITURE d'une traduction, et seulement pour une
--  spécialité active. Une spécialité INACTIVE dont la traduction anglaise est « Other » passait donc les deux à sa
--  réactivation — et les deux « Autre » revenaient à l'écran, en anglais.
--
--  LA RÈGLE : au passage d'inactive à active, aucune traduction du NOM de la spécialité n'est « Autre » (la définition
--  unique, `est_specialite_autre`). Refus 23514 sous le nom de la contrainte, comme ses deux sœurs : l'administration le
--  rend déjà `specialite_autre_reservee`. Le code du lot le DEMANDE en plus avant d'écrire (les traductions qui
--  resteront), et écrit les traductions AVANT la réactivation quand le geste les remplace.
--
--  Colonnes et contraintes lues (§G.10) : specialities (name varchar(100) NOT NULL, slug, active NOT NULL, contrainte
--  specialities_autre_hors_referentiel ; déclencheur trg_specialities_updated_at) ; translations (table_name, row_id,
--  field, locale, value text NOT NULL ; clé (table_name, row_id, field, locale) ; aucune clé étrangère sur row_id ;
--  déclencheur translations_specialite_autre) ; est_specialite_autre(p_nom text, p_slug text).
--
--  Prouvée par tests/database/taxonomie/reactivation_hors_autre.test.sql.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.specialite_reactivee_hors_autre()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $fn$
declare
  v_traduction text;
begin
  if new.active and not old.active then
    select t.value into v_traduction
      from public.translations t
     where t.table_name = 'specialities' and t.row_id = new.id and t.field = 'name'
       and public.est_specialite_autre(t.value, null)
     limit 1;
    if v_traduction is not null then
      raise exception 'specialities_autre_hors_referentiel : la spécialité « % » a une traduction « % » — elle ne peut pas être réactivée sous « Autre »', new.name, v_traduction
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$fn$;

comment on function public.specialite_reactivee_hors_autre() is
  'Garde de la réactivation : une spécialité qui redevient active ne garde aucune traduction « Autre » (« Other », « Otra »…) — refus 23514 sous le nom de la contrainte specialities_autre_hors_referentiel, que l''administration rend specialite_autre_reservee.';

drop trigger if exists specialites_reactivation_hors_autre on public.specialities;
create trigger specialites_reactivation_hors_autre
  before update of active on public.specialities
  for each row execute function public.specialite_reactivee_hors_autre();

-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if to_regprocedure('public.specialite_reactivee_hors_autre()') is null then
    raise exception 'postcondition NON TENUE : la garde de réactivation manque';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.specialities'::regclass
                  and t.tgname = 'specialites_reactivation_hors_autre' and not t.tgisinternal) then
    raise exception 'postcondition NON TENUE : le déclencheur specialites_reactivation_hors_autre manque';
  end if;
  raise notice 'postcondition tenue : une réactivation ne ramène pas « Autre » ; le geste est prouvé par tests/database/taxonomie/reactivation_hors_autre.test.sql';
end
$post$;
