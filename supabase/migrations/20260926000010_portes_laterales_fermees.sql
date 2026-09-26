-- ════════════════════════════════════════════════════════════════════════════
--  LES PORTES LATÉRALES DU GRAND LIVRE SE FERMENT — AUCUN CLIENT N'ÉCRIT
--  DIRECTEMENT DANS UNE TABLE DONT L'ÉCRITURE EST UNE ACTION DU JOURNAL.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent. Ne retire que des politiques d'ÉCRITURE qu'aucun
--  écran n'emprunte (mesuré : le seul client navigateur, lib/supabase.ts, n'écrit
--  dans aucune de ces tables) ; les routes et les RPC écrivent en `service_role`,
--  que la RLS ne concerne pas. Rejouable.
--
--  LE DÉFAUT (audit du 26/09/2026, point 2.8). Une action du grand livre s'écrit
--  par une route ou une RPC qui journalise. Mais une politique RLS qui laisse un
--  rôle client (`authenticated`, `anon`, `public`) écrire la même table est une
--  SECONDE porte : le geste a lieu, sans pièce ni ligne. Treize, en état final :
--  `organization_invitations_admin_all` (FOR ALL, nommée par Youssef) et douze
--  autres. Douze se ferment ici. La treizième ne se ferme pas — voir plus bas.
--
--  LA LECTURE NE CHANGE PAS. Les deux politiques FOR ALL portaient aussi la
--  lecture ; elle reste servie, à l'identique, par les politiques de lecture qui
--  existent déjà (`organization_invitations_member_read`, `publications_member_read`
--  — tout membre actif, administrateurs compris). Aucune politique nouvelle, donc
--  aucun risque de récursion 42P17.
--
--  POURQUOI UN RETRAIT DE POLITIQUE TIENT, ALORS QU'UN RETRAIT DE DROITS NE TIENT
--  PAS (`ensure_rls` redonne les droits à chaque DDL) : la RLS reste ACTIVE sur ces
--  tables ; sans politique d'écriture, un rôle client n'écrit rien, quels que soient
--  ses droits de table. La garde est l'ABSENCE de politique, que la postcondition
--  relit dans `pg_policies`.
--
--  CE QUI RESTE OUVERT, ÉCRIT : `profiles_self_update`. Les bascules de
--  disponibilité des tableaux de bord freelance et CDI (`availability_status`,
--  `cdi_status`, `open_to_*`) écrivent `profiles` DIRECTEMENT depuis le navigateur ;
--  fermer la politique casserait ces écrans. Décision réservée à Youssef (arrêt de
--  l'étape 2). DÉFAUT NOMMÉ : ces bascules n'écrivent pas `disponibilite_basculee`.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists organization_invitations_admin_all on public.organization_invitations;
drop policy if exists candidatures_expert_insert        on public.candidatures;
drop policy if exists candidatures_expert_update        on public.candidatures;
drop policy if exists messages_party_mark_read          on public.messages;
drop policy if exists messages_sender_insert            on public.messages;
drop policy if exists organization_members_admin_insert on public.organization_members;
drop policy if exists organization_members_admin_update on public.organization_members;
drop policy if exists organization_members_admin_delete on public.organization_members;
drop policy if exists organizations_admin_update        on public.organizations;
drop policy if exists profiles_self_insert              on public.profiles;
drop policy if exists publications_member_write         on public.publications;
drop policy if exists users_self_update                 on public.users;


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_portes text;
  v_n      integer;
begin
  -- Plus AUCUNE politique d'écriture cliente sur ces tables — sauf l'exception écrite.
  select string_agg(format('%s.%s (%s → %s)', p.tablename, p.policyname, p.cmd, array_to_string(p.roles, ',')), ' | '
                    order by p.tablename, p.policyname)
    into v_portes
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in ('organization_invitations', 'candidatures', 'messages', 'organization_members',
                         'organizations', 'profiles', 'publications', 'users')
     and p.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
     and p.roles && array['authenticated', 'anon', 'public']::name[]
     and not (p.tablename = 'profiles' and p.policyname = 'profiles_self_update');
  if v_portes is not null then
    raise exception 'postcondition NON TENUE : une porte laterale reste ouverte : %', v_portes;
  end if;
  -- La RLS reste ACTIVE : c'est elle, et l'absence de politique, qui garde.
  select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relrowsecurity
     and c.relname in ('organization_invitations', 'candidatures', 'messages', 'organization_members',
                       'organizations', 'profiles', 'publications', 'users');
  if v_n <> 8 then
    raise exception 'postcondition NON TENUE : la RLS n est active que sur % table(s) sur 8', v_n;
  end if;
  -- La LECTURE ne change pas.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organization_invitations'
                  and policyname = 'organization_invitations_member_read' and cmd = 'SELECT')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'publications'
                     and policyname = 'publications_member_read' and cmd = 'SELECT') then
    raise exception 'postcondition NON TENUE : une lecture qui portait les membres a disparu';
  end if;
  raise notice 'postcondition tenue : douze portes laterales fermees, la RLS active sur les huit tables, la lecture inchangee ; profiles_self_update reste ouverte (DEFAUT NOMME, arbitrage)';
end
$post$;
