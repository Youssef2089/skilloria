-- ════════════════════════════════════════════════════════════════════════════
--  LE GRAND LIVRE SE LIT EN PHRASES : LES NOMS DES OBJETS, RELUS À L'AFFICHAGE (ARRÊT 22, 01/10/2026, §D.33).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement (§G.4) — une fonction NOUVELLE, de lecture, que seul le code nouveau appelle.
--
--  « Vérification conclue » ne disait pas QUEL profil. Le grand livre ne porte que des identifiants (§D.26 — jamais un
--  nom écrit) ; la phrase les relit ICI, au moment de l'affichage, pour l'administrateur seulement : le nom du compte,
--  du profil (son titulaire), de l'organisation, l'intitulé de l'annonce — et un CONTEXTE quand l'objet en a un (la
--  candidature : l'expert ; l'annonce : son organisation ; un membre : son nom). Un compte effacé n'a plus de nom
--  (NULL) : l'écran dit « compte supprimé ».
--  Colonnes lues dans les migrations (§G.10) : users (first_name, last_name, anonymized_at), profiles (user_id),
--  organizations (company_name), publications (title, organization_id), candidatures / matches / candidature_depots
--  (publication_id, profile_id), organization_invitations / organization_members (organization_id ; user_id),
--  domains / packages / branches / specialities (name).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.libelles_journal(p_admin_id uuid, p_sujets jsonb)
  returns table (sujet_type text, sujet_id uuid, nom text, contexte text)
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $fn$
begin
  if not exists (select 1 from public.users u where u.id = p_admin_id and u.user_type = 'admin' and u.status = 'active') then
    raise exception 'libelles_journal : reserve a un administrateur actif' using errcode = 'AD002';
  end if;
  if jsonb_typeof(coalesce(p_sujets, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_sujets, '[]'::jsonb)) > 500 then
    raise exception 'libelles_journal : une liste de 500 sujets au plus est attendue' using errcode = '22023';
  end if;

  return query
  with s as (
    select distinct x ->> 'type' as t, (x ->> 'id')::uuid as i
      from jsonb_array_elements(coalesce(p_sujets, '[]'::jsonb)) x
     where x ->> 'id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ),
  personne as (
    -- Le nom d'un compte, s'il n'est pas effacé.
    select u.id, nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') as nom
      from public.users u where u.anonymized_at is null
  )
  select s.t, s.i,
    case s.t
      when 'users'                    then (select pe.nom from personne pe where pe.id = s.i)
      when 'profiles'                 then (select pe.nom from public.profiles p join personne pe on pe.id = p.user_id where p.id = s.i)
      when 'organizations'            then (select o.company_name::text from public.organizations o where o.id = s.i)
      when 'publications'             then (select pb.title::text from public.publications pb where pb.id = s.i)
      when 'candidatures'             then (select pb.title::text from public.candidatures c join public.publications pb on pb.id = c.publication_id where c.id = s.i)
      when 'matches'                  then (select pb.title::text from public.matches m join public.publications pb on pb.id = m.publication_id where m.id = s.i)
      when 'candidature_depots'       then (select pb.title::text from public.candidature_depots d join public.publications pb on pb.id = d.publication_id where d.id = s.i)
      when 'organization_invitations' then (select o.company_name::text from public.organization_invitations i join public.organizations o on o.id = i.organization_id where i.id = s.i)
      when 'organization_members'     then (select o.company_name::text from public.organization_members m join public.organizations o on o.id = m.organization_id where m.id = s.i)
      when 'domains'                  then (select d.name::text from public.domains d where d.id = s.i)
      when 'packages'                 then (select pk.name::text from public.packages pk where pk.id = s.i)
      when 'branches'                 then (select b.name::text from public.branches b where b.id = s.i)
      when 'specialities'             then (select sp.name::text from public.specialities sp where sp.id = s.i)
    end,
    case s.t
      when 'candidatures'         then (select pe.nom from public.candidatures c join public.profiles p on p.id = c.profile_id join personne pe on pe.id = p.user_id where c.id = s.i)
      when 'matches'              then (select pe.nom from public.matches m join public.profiles p on p.id = m.profile_id join personne pe on pe.id = p.user_id where m.id = s.i)
      when 'candidature_depots'   then (select pe.nom from public.candidature_depots d join public.profiles p on p.id = d.profile_id join personne pe on pe.id = p.user_id where d.id = s.i)
      when 'publications'         then (select o.company_name::text from public.publications pb join public.organizations o on o.id = pb.organization_id where pb.id = s.i)
      when 'organization_members' then (select pe.nom from public.organization_members m join personne pe on pe.id = m.user_id where m.id = s.i)
    end
  from s;
end;
$fn$;
revoke all on function public.libelles_journal(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.libelles_journal(uuid, jsonb) to service_role;


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if to_regprocedure('public.libelles_journal(uuid, jsonb)') is null then
    raise exception 'postcondition NON TENUE : libelles_journal absente';
  end if;
  if has_function_privilege('authenticated', 'public.libelles_journal(uuid, jsonb)', 'execute') then
    raise exception 'postcondition NON TENUE : libelles_journal ouverte au navigateur';
  end if;
  raise notice 'postcondition tenue : libelles_journal presente, reservee a la cle de service ; les noms rendus par sujet sont prouves par tests/database/grand_livre/liste_validee.test.sql';
end
$post$;
