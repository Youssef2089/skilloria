-- M4 : resserrement de l'ecriture sur organization_members.
-- Avant : une seule policy FOR ALL (INSERT+UPDATE+DELETE) gardee par is_active_admin_of_org -> aucun garde-fou
-- sur la mutation de role ni sur l'auto-retrogradation (risque de lock-out du dernier admin).
-- Apres : 3 policies par commande, meme gate admin, + interdiction pour un admin de modifier/supprimer SA PROPRE ligne.
-- Reutilise la fonction SECURITY DEFINER existante is_active_admin_of_org (anti-recursion deja en place).
-- La policy de LECTURE (organization_members_select_self_or_org) n'est PAS touchee.

-- Retire l'ancienne policy trop large + les nouvelles (idempotence si re-run).
drop policy if exists organization_members_admin_write on public.organization_members;
drop policy if exists organization_members_admin_insert on public.organization_members;
drop policy if exists organization_members_admin_update on public.organization_members;
drop policy if exists organization_members_admin_delete on public.organization_members;

-- INSERT : seul un admin actif de l'org cible peut ajouter un membre.
create policy organization_members_admin_insert on public.organization_members
  for insert to authenticated
  with check (public.is_active_admin_of_org(organization_id));

-- UPDATE : admin actif de l'org (ligne existante ET ligne cible), et interdiction de modifier sa propre ligne
-- (empeche un admin de se retrograder/suspendre lui-meme -> pas de lock-out du dernier admin par auto-modification).
create policy organization_members_admin_update on public.organization_members
  for update to authenticated
  using (public.is_active_admin_of_org(organization_id))
  with check (public.is_active_admin_of_org(organization_id) and user_id <> auth.uid());

-- DELETE : admin actif de l'org, et interdiction de se supprimer soi-meme.
create policy organization_members_admin_delete on public.organization_members
  for delete to authenticated
  using (public.is_active_admin_of_org(organization_id) and user_id <> auth.uid());
