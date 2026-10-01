-- ════════════════════════════════════════════════════════════════════════════
--  « AUTRE » N'EST JAMAIS UNE LIGNE DU RÉFÉRENTIEL — LE SECOND TEMPS : LA REPRISE ET LA GARDE
--  (recette S1 du 01/10/2026, point 1 ; relecture indépendante du 01/10/2026, points 2 et 11).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : APRÈS le déploiement du lot A (§E.72, §E.91). Le code d'AVANT le lot A (13d1524) rend 400
--  `bad_speciality` sur une spécialité INACTIVE : une page chargée avant le push, « Autre » coché, ne se serait plus
--  enregistrée. Le code du lot A la tolère (`/api/profile` la sort des spécialités et garde « Autre » en précision,
--  la règle de cette reprise) ; c'est lui qui est en ligne entre le push de ce lot et son déploiement.
--
--  LA DÉFINITION vit au lot A (`est_specialite_autre`, migration `specialite_autre_hors_referentiel`) : le mot, en
--  quatre langues, seul ou suivi d'une parenthèse, ou un slug de cette forme. Ici :
--    1. `retirer_specialites_autre()` reprend les profils et les annonces qui portent une spécialité « Autre » :
--       l'identifiant sort de `speciality_ids`, et la précision `speciality_other` reçoit le NOM de la ligne quand
--       elle est vide — la personne avait choisi « Autre », c'est exactement ce qu'elle garde. Puis la ligne est
--       DÉSACTIVÉE, jamais supprimée (`profile_alerts.speciality_id` peut la citer) ;
--    2. la contrainte `specialities_autre_hors_referentiel` refuse qu'une spécialité ACTIVE soit « Autre » — par son
--       nom ou son slug (création, renommage, réactivation) ;
--    3. la garde des TRADUCTIONS (relecture, point 11) : une traduction du nom d'une spécialité ACTIVE qui est
--       « Autre » (« Other », « Otra », « Andere ») est refusée sous la même contrainte nommée (23514) — les deux
--       « Autre » reviendraient dans cette langue. L'administration le DEMANDE déjà avant d'écrire (lot A,
--       `contientAutre`) ; la base le tient.
--
--  ⚠️ LA REPRISE TOUCHE DES DONNÉES : une reprise VOULUE, dans son propre bloc (§G.4 ter), AVANT la contrainte (sinon
--     la contrainte échouerait sur la ligne semée). Elle ne lit que ce qu'elle reprend, et le dit en chiffres. Elle
--     n'écrit rien au grand livre (décision de Youssef, fusion S1). Prouvée sur des données fabriquées par
--     tests/database/taxonomie/autre_hors_referentiel.test.sql.
--
--  Colonnes et contraintes lues (§G.10) : specialities (name, slug, active NOT NULL, domain_id, branch_id),
--  profiles / publications (speciality_ids uuid[], speciality_other text), translations (table_name, row_id, field,
--  locale, value text NOT NULL ; aucune clé étrangère sur row_id).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.retirer_specialites_autre()
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_autres   uuid[];
  v_profils  integer;
  v_annonces integer;
  v_lignes   integer;
begin
  select coalesce(array_agg(s.id), '{}') into v_autres
    from public.specialities s
   where public.est_specialite_autre(s.name, s.slug);
  if cardinality(v_autres) = 0 then
    return jsonb_build_object('specialites', 0, 'profils', 0, 'annonces', 0);
  end if;

  -- Les profils : l'identifiant sort, la précision garde « Autre » si elle était vide.
  update public.profiles p
     set speciality_other = coalesce(
           nullif(btrim(p.speciality_other), ''),
           (select s.name from public.specialities s where s.id = any (p.speciality_ids) and s.id = any (v_autres) order by s.name limit 1)
         ),
         speciality_ids = array(select x from unnest(p.speciality_ids) as x where not (x = any (v_autres)))
   where p.speciality_ids && v_autres;
  get diagnostics v_profils = row_count;

  -- Les annonces : la même reprise, la même règle.
  update public.publications u
     set speciality_other = coalesce(
           nullif(btrim(u.speciality_other), ''),
           (select s.name from public.specialities s where s.id = any (u.speciality_ids) and s.id = any (v_autres) order by s.name limit 1)
         ),
         speciality_ids = array(select x from unnest(u.speciality_ids) as x where not (x = any (v_autres)))
   where u.speciality_ids && v_autres;
  get diagnostics v_annonces = row_count;

  -- Désactivée, jamais supprimée : `profile_alerts.speciality_id` peut encore la citer.
  update public.specialities s set active = false where s.id = any (v_autres) and s.active;
  get diagnostics v_lignes = row_count;

  return jsonb_build_object('specialites', v_lignes, 'profils', v_profils, 'annonces', v_annonces);
end
$fn$;

revoke all on function public.retirer_specialites_autre() from public, anon, authenticated;

comment on function public.retirer_specialites_autre() is
  'Reprise : sort les spécialités « Autre » du référentiel des profils et des annonces (la précision speciality_other garde « Autre »), puis les désactive. Rend ce qu''elle a repris. Appelée par la migration specialite_autre_garde ; rejouable.';

-- ── 1. LA REPRISE — son propre bloc (§G.4 ter), AVANT la contrainte ──────────
do $reprise$
declare
  v_bilan jsonb;
begin
  v_bilan := public.retirer_specialites_autre();
  raise notice 'reprise « Autre » : % spécialité(s) désactivée(s), % profil(s) et % annonce(s) repris',
    v_bilan ->> 'specialites', v_bilan ->> 'profils', v_bilan ->> 'annonces';
end
$reprise$;

-- ── 2. LA RÈGLE, POUR L'AVENIR : le nom et le slug ───────────────────────────
alter table public.specialities
  drop constraint if exists specialities_autre_hors_referentiel;
alter table public.specialities
  add constraint specialities_autre_hors_referentiel
  check (not active or not public.est_specialite_autre(name, slug));

comment on constraint specialities_autre_hors_referentiel on public.specialities is
  '« Autre » n''est jamais une spécialité active du référentiel : c''est la précision speciality_other. Refus rendu par l''administration sous specialite_autre_reservee.';

-- ── 3. LA RÈGLE, POUR L'AVENIR : les traductions du nom ──────────────────────
create or replace function public.translations_specialite_autre()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $fn$
begin
  if new.table_name = 'specialities' and new.field = 'name'
     and public.est_specialite_autre(new.value, null)
     and exists (select 1 from public.specialities s where s.id = new.row_id and s.active) then
    raise exception 'specialities_autre_hors_referentiel : la traduction « % » d''une spécialité active est « Autre »', new.value
      using errcode = '23514';
  end if;
  return new;
end
$fn$;

comment on function public.translations_specialite_autre() is
  'Garde des traductions : le nom traduit d''une spécialité ACTIVE n''est jamais « Autre » (« Other », « Otra »…) — refus 23514 sous le nom de la contrainte specialities_autre_hors_referentiel, que l''administration rend specialite_autre_reservee.';

drop trigger if exists translations_specialite_autre on public.translations;
create trigger translations_specialite_autre
  before insert or update of value on public.translations
  for each row execute function public.translations_specialite_autre();


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if to_regprocedure('public.retirer_specialites_autre()') is null
     or to_regprocedure('public.translations_specialite_autre()') is null then
    raise exception 'postcondition NON TENUE : une fonction « Autre » manque';
  end if;
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.specialities'::regclass
       and c.conname = 'specialities_autre_hors_referentiel'
       and c.convalidated
  ) then
    raise exception 'postcondition NON TENUE : la contrainte specialities_autre_hors_referentiel manque ou n''est pas validée';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.translations'::regclass
                  and t.tgname = 'translations_specialite_autre' and not t.tgisinternal) then
    raise exception 'postcondition NON TENUE : la garde des traductions manque';
  end if;
  if has_function_privilege('authenticated', 'public.retirer_specialites_autre()', 'execute') then
    raise exception 'postcondition NON TENUE : la reprise est ouverte au navigateur';
  end if;
  raise notice 'postcondition tenue : « Autre » hors du référentiel, nom, slug et traductions ; la règle et la reprise sont prouvées par tests/database/taxonomie/autre_hors_referentiel.test.sql';
end
$post$;
