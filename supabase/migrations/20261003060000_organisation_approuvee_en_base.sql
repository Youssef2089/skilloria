-- ════════════════════════════════════════════════════════════════════════════
--  UNE ORGANISATION NON APPROUVÉE NE PUBLIE PAS, NE RETIENT PAS, NE DÉVOILE PAS — TENU EN BASE
--  (lot DevOps CI, partie A bis, point 1 — checklist V1, point 4 ; §D.52).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : APRÈS le déploiement du code de ce lot (second temps, §G.4, §E.72). Elle RESTREINT : deux
--  déclencheurs refusent ce que le code d'avant écrivait encore pour une organisation non approuvée (mettre une annonce
--  en ligne, retenir, dévoiler). Le code du lot refuse ces gestes AVANT la base, au serveur (`requireOrgApproved`, 403
--  `org_not_approved`) : quand cette migration passe, plus aucun écrivain en ligne ne les tente pour une organisation non
--  approuvée — la base ferme la porte d'à côté (une route oubliée demain, un appel direct de RPC). Déclarée dans
--  `SECOND_TEMPS` de scripts/diag-deux-temps.mjs. À pousser APRÈS la seconde livraison du regroupement (`05xxxx`).
--
--  LA RÈGLE : une annonce ne PASSE en ligne (`status` devient 'published') que si son organisation est approuvée
--  (`organizations.verification_status = 'approved'`) ; une candidature ne PASSE à 'unlocked' (dévoilée) ou 'selected'
--  (retenue) que si l'organisation de son annonce l'est. Seules les TRANSITIONS sont gardées : une annonce déjà en ligne,
--  une candidature déjà dévoilée restent ce qu'elles sont si l'approbation change ensuite ; clôturer, expirer, retirer
--  passent toujours. L'organisation personnelle d'un expert (sous-traitance) naît approuvée (ensure-personal-org).
--  Refus nommé : SQLSTATE OA001.
--
--  Colonnes et contraintes lues (§G.10) : publications (organization_id uuid NOT NULL, status text NOT NULL default
--  'draft') ; candidatures (publication_id uuid NOT NULL, status text, organisations via l'annonce) ; organizations
--  (verification_status varchar, CHECK pending_provider_check | pending_admin_review | approved | rejected |
--  requires_more_info, nullable). Déclencheurs voisins : trg_publications_work_zones (BEFORE, zones) — sans rapport.
-- ─────────────────────────────────────────────────────────────────────────────

-- ① La règle, une fois.
create or replace function public.organisation_est_approuvee(p_organisation uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select exists (
    select 1 from public.organizations o
     where o.id = p_organisation and o.verification_status = 'approved'
  )
$fn$;
revoke all on function public.organisation_est_approuvee(uuid) from public, anon, authenticated;
grant execute on function public.organisation_est_approuvee(uuid) to service_role;

-- ② Une annonce ne passe en ligne que pour une organisation approuvée.
create or replace function public.garde_publication_organisation_approuvee()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and not public.organisation_est_approuvee(new.organization_id) then
    raise exception 'organisation non approuvee : l annonce % ne peut pas etre mise en ligne', new.id
      using errcode = 'OA001';
  end if;
  return new;
end
$fn$;
revoke all on function public.garde_publication_organisation_approuvee() from public, anon, authenticated;

drop trigger if exists publications_organisation_approuvee on public.publications;
create trigger publications_organisation_approuvee
  before insert or update of status on public.publications
  for each row execute function public.garde_publication_organisation_approuvee();

-- ③ Une candidature n'est retenue ni dévoilée que pour une organisation approuvée.
create or replace function public.garde_candidature_organisation_approuvee()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_organisation uuid;
begin
  if new.status in ('unlocked', 'selected')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    select p.organization_id into v_organisation from public.publications p where p.id = new.publication_id;
    if not public.organisation_est_approuvee(v_organisation) then
      raise exception 'organisation non approuvee : la candidature % ne peut pas passer a %', new.id, new.status
        using errcode = 'OA001';
    end if;
  end if;
  return new;
end
$fn$;
revoke all on function public.garde_candidature_organisation_approuvee() from public, anon, authenticated;

drop trigger if exists candidatures_organisation_approuvee on public.candidatures;
create trigger candidatures_organisation_approuvee
  before insert or update of status on public.candidatures
  for each row execute function public.garde_candidature_organisation_approuvee();

-- ④ POSTCONDITION — la STRUCTURE seulement (§G.4 ter, §E.77) : aucune table métier lue, aucune donnée touchée.
--    Le COMPORTEMENT (refus OA001, passage approuvé, organisation personnelle, transitions seules) est prouvé par
--    supabase/tests/database/organisations/organisation_approuvee.test.sql.
do $post$
begin
  if to_regprocedure('public.organisation_est_approuvee(uuid)') is null then
    raise exception 'postcondition NON TENUE : organisation_est_approuvee(uuid) manque';
  end if;
  if has_function_privilege('anon', 'public.organisation_est_approuvee(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.organisation_est_approuvee(uuid)', 'execute') then
    raise exception 'postcondition NON TENUE : organisation_est_approuvee est ouverte au navigateur';
  end if;
  if (select count(*) from pg_trigger t
       where not t.tgisinternal and t.tgenabled <> 'D'
         and ((t.tgrelid = 'public.publications'::regclass and t.tgname = 'publications_organisation_approuvee')
           or (t.tgrelid = 'public.candidatures'::regclass and t.tgname = 'candidatures_organisation_approuvee'))) <> 2 then
    raise exception 'postcondition NON TENUE : les deux déclencheurs de garde ne sont pas posés et actifs';
  end if;
  raise notice 'organisation_approuvee_en_base : structure vérifiée (fonction fermée au navigateur, 2 déclencheurs actifs) — le comportement est prouvé par organisations/organisation_approuvee.test.sql';
end
$post$;
