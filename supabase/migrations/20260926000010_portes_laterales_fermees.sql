-- ════════════════════════════════════════════════════════════════════════════
--  LES PORTES LATÉRALES DU GRAND LIVRE SE FERMENT — AUCUN CLIENT N'ÉCRIT
--  DIRECTEMENT DANS UNE TABLE DONT L'ÉCRITURE EST UNE ACTION DU JOURNAL.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement, le code DANS LA FOULÉE (§G.4). Douze des
--  treize politiques n'étaient empruntées par aucun écran ; la treizième,
--  `profiles_self_update`, l'était par les bascules de disponibilité des tableaux de
--  bord — que le même lot fait passer par POST /api/profile/disponibilite (T.4,
--  28/09/2026). Un onglet resté sur l'ANCIEN code après le push reçoit une ERREUR
--  (42501, voir le retrait de droit plus bas) : l'écran revient en arrière et affiche
--  son toast d'échec ; recharger suffit. Rejouable.
--
--  LE DÉFAUT (audit du 26/09/2026, point 2.8). Une action du grand livre s'écrit
--  par une route ou une RPC qui journalise. Mais une politique RLS qui laisse un
--  rôle client (`authenticated`, `anon`, `public`) écrire la même table est une
--  SECONDE porte : le geste a lieu, sans pièce ni ligne. Treize, en état final :
--  `organization_invitations_admin_all` (FOR ALL, nommée par Youssef) et douze
--  autres. Les TREIZE se ferment ici.
--
--  LA LECTURE NE CHANGE PAS. Les deux politiques FOR ALL portaient aussi la
--  lecture ; elle reste servie, à l'identique, par les politiques de lecture qui
--  existent déjà (`organization_invitations_member_read`, `publications_member_read`
--  — tout membre actif, administrateurs compris). Aucune politique nouvelle, donc
--  aucun risque de récursion 42P17.
--
--  LA GARDE EST L'ABSENCE DE POLITIQUE : la RLS reste ACTIVE sur ces tables ; sans
--  politique d'écriture, un rôle client n'écrit rien, quels que soient ses droits de
--  table. La postcondition la relit dans `pg_policies`. (Corrigé le 28/09/2026 : cet
--  en-tête disait qu'`ensure_rls` « redonne les droits à chaque DDL ». Lu dans le
--  code, `rls_auto_enable()` ne fait qu'ACTIVER la RLS sur une table CRÉÉE ; il
--  n'accorde rien.)
--
--  `profiles_self_update` — LA TREIZIÈME (arbitrage de Youssef, 28/09/2026). Les
--  quatre bascules des tableaux de bord (`availability_status`, `cdi_status`,
--  `open_to_cdi`, `open_to_freelance`) passent par le geste serveur qui écrit
--  `disponibilite_basculee`. Plus aucun écran n'écrit `profiles` depuis le navigateur
--  (mesuré par diag-portes-laterales). La politique se ferme ENTIÈRE : aucune colonne
--  n'y reste, parce qu'aucune n'a de raison d'être écrite hors d'un geste serveur.
--  ET LE DROIT D'ÉCRIRE `profiles` EST RETIRÉ au navigateur — non comme protection
--  (c'est l'absence de politique qui protège), mais pour qu'un client périmé ÉCHOUE
--  BRUYAMMENT : sans politique mais avec le droit, son UPDATE toucherait zéro ligne
--  SANS ERREUR, et l'écran afficherait « enregistré » (§E.74). Aucune migration ne
--  redonne ce droit après la baseline (vérifié : seuls les GRANT de la baseline).
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
drop policy if exists profiles_self_update              on public.profiles;

revoke insert, update, delete on table public.profiles from anon, authenticated;


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_portes text;
  v_n      integer;
begin
  -- Plus AUCUNE politique d'écriture cliente sur ces tables — sans exception.
  select string_agg(format('%s.%s (%s → %s)', p.tablename, p.policyname, p.cmd, array_to_string(p.roles, ',')), ' | '
                    order by p.tablename, p.policyname)
    into v_portes
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in ('organization_invitations', 'candidatures', 'messages', 'organization_members',
                         'organizations', 'profiles', 'publications', 'users')
     and p.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
     and p.roles && array['authenticated', 'anon', 'public']::name[];
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
  -- Le navigateur ne peut plus ÉCRIRE profiles : un client périmé échoue bruyamment.
  if has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     or has_table_privilege('anon', 'public.profiles', 'UPDATE') then
    raise exception 'postcondition NON TENUE : le navigateur garde le droit d ecrire profiles';
  end if;
  -- Et il la LIT toujours : le retrait ne touche que l'écriture.
  if not has_table_privilege('authenticated', 'public.profiles', 'SELECT') then
    raise exception 'postcondition NON TENUE : le retrait a emporte la lecture de profiles';
  end if;
  raise notice 'postcondition tenue : treize portes laterales fermees, la RLS active sur les huit tables, la lecture inchangee, le navigateur n ecrit plus profiles';
end
$post$;
