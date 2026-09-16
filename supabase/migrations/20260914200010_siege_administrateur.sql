-- UNE ORGANISATION NE PEUT PLUS TOMBER A ZERO ADMINISTRATEUR
--
-- ═══ LE DEFAUT ════════════════════════════════════════════════════════════
--   Trois routes retirent un administrateur — changement de role, retrait d'un
--   membre, depart volontaire — et toutes les trois font la meme chose :
--   compter les admins actifs, comparer a 1, puis ecrire. Deux administrateurs
--   qui se retrogradent au meme instant lisent tous deux « il en reste 2 »,
--   concluent tous deux que le retrait est sur, et ecrivent tous deux.
--   L'organisation se retrouve SANS AUCUN administrateur.
--
--   La seule protection en base etait `user_id <> auth.uid()` sur la policy de
--   suppression : elle interdit de se retirer soi-meme, elle ne dit rien de
--   deux personnes qui se retirent l'une l'autre.
--
--   C'EST LE PLUS GRAVE DES DEUX POINTS DE CE LOT, ET PAS POUR LA CONCURRENCE :
--   par ses CONSEQUENCES. Une organisation sans administrateur ne peut plus
--   inviter personne, ni gerer ses membres, ni changer d'offre. Aucun ecran ne
--   permet d'en sortir ; seule une intervention en base la debloque.
--
-- ═══ ETAT DES DONNEES, VERIFIE AVANT D'ECRIRE (staging, lecture seule) ════
--   4 organisations. DEUX sont deja sans aucun administrateur — et personne ne
--   le savait :
--     · abbbc311-3e60-4021-aa6d-fdd29283e1fe  « SAS », creee le 2026-05-30
--     · d6a1d09b-c61e-45bf-b86d-59b6bfbfdbab  « SAS », creee le 2026-05-30
--   Toutes deux : `verification_status = pending_provider_check`, siren NULL,
--   ZERO ligne organization_members (pas meme une ligne 'removed'), ZERO
--   publication. Ce ne sont pas des organisations bloquees dont quelqu'un
--   serait prisonnier : ce sont des COQUILLES laissees par une inscription
--   interrompue, que personne ne peut atteindre puisque personne n'y est
--   membre.
--
--   ON N'Y TOUCHE PAS DANS CETTE MIGRATION. Le rattrapage reste degrade et sur
--   (voir « LE BACKFILL » plus bas) : ces deux lignes gardent un siege vacant,
--   la contrainte ne les gele pas, et leur sort est une decision produit, pas
--   un effet de bord d'une migration technique.
--
-- ═══ LE MECANISME : UN SIEGE, ET UNE CLE ETRANGERE COMPOSITE ══════════════
--   L'organisation DESIGNE une ligne d'appartenance comme occupant le SIEGE
--   d'administrateur. Une cle etrangere composite garantit que la ligne
--   designee est, a tout instant, un administrateur ACTIF DE CETTE
--   ORGANISATION :
--
--     organizations (siege_admin_membre_id, id, <role='admin'>, <statut='active'>)
--        ->  organization_members (id, organization_id, role_in_org, status)
--
--   Les deux valeurs constantes sont des COLONNES GENEREES : elles ne sont pas
--   ecrites par du code, elles ne peuvent pas etre falsifiees, et elles valent
--   NULL exactement quand le siege est vacant — auquel cas la cle etrangere
--   (MATCH SIMPLE) ne verifie rien. Et c'est `organizations.id` LUI-MEME qui
--   sert de troisieme colonne : le siege ne peut donc PAS designer un
--   administrateur d'une AUTRE organisation.
--
--   Consequence : l'occupant du siege ne peut NI etre retrograde, NI etre
--   retire. Comme le siege est toujours occupe par un administrateur actif, il
--   en reste toujours au moins un. La garantie est DECLARATIVE.
--
-- ═══ POURQUOI CA TIENT SOUS CONCURRENCE — LE POINT PRECIS ═════════════════
--   La cle unique referencee est `(id, organization_id, role_in_org, status)`,
--   une contrainte UNIQUE ordinaire : ni partielle, ni sur expression. Elle est
--   donc, au sens de PostgreSQL, « referencable par une cle etrangere », et ses
--   colonnes sont des COLONNES DE CLE.
--
--   Cela change tout : une mise a jour qui touche `role_in_org` ou `status` est
--   une MISE A JOUR DE CLE, qui prend un verrou de force `FOR UPDATE` — lequel
--   ENTRE EN CONFLIT avec le `FOR KEY SHARE` que prend la verification de cle
--   etrangere. Les deux transactions ne peuvent plus s'ignorer.
--
--   Deroule, deux administrateurs A (au siege) et B se retrogradant ensemble :
--     · T_A voit qu'il occupe le siege, cherche un remplacant, trouve B, et
--       ecrit le siege sur B. La verification de cle prend FOR KEY SHARE sur la
--       ligne de B.
--     · T_B veut retrograder B : mise a jour de cle, donc FOR UPDATE. Elle
--       BLOQUE sur le verrou de T_A.
--     · T_A valide. T_B repart, ecrit, et sa verification NO ACTION trouve
--       l'organisation qui reference desormais B : VIOLATION (23503). T_B est
--       refusee.
--   Dans l'autre sens, T_A voit B deja retrograde au moment de poser le siege :
--   violation cote organisation, T_A refusee. Dans les deux cas il reste
--   exactement un administrateur. Aucune relecture applicative, aucun ordre
--   suppose.
--
--   ⚠️ POURQUOI PAS UN TRIGGER QUI RECOMPTE. Il ne voit que ce qui est COMMITE :
--      sous deux transactions simultanees, aucune ne voit l'autre, et les deux
--      passent. C'est le defaut qu'on corrige, deplace d'un etage.
--
--   ⚠️ POURQUOI PAS UN VERROU APPLICATIF (advisory lock, SELECT ... FOR UPDATE
--      sur l'organisation). Ca tiendrait, mais la garantie dependrait alors de
--      ce que CHAQUE appelant pense a prendre le verrou. Le premier chemin
--      ecrit sans lui la rouvre en silence. Ici, il n'y a rien a penser a faire.
--
-- ═══ DEUX ETAGES, DEUX QUESTIONS DIFFERENTES — A DIRE HONNETEMENT ═════════
--   Cette garantie porte sur les LIGNES D'APPARTENANCE : il reste toujours une
--   ligne admin/active. Elle ne dit RIEN du COMPTE derriere.
--
--   `countActiveAdmins` (lib/org-members.ts) pose une question plus exigeante :
--   le compte est-il encore JOIGNABLE (ni suspendu, ni en grace de suppression,
--   ni anonymise) ? Un compte purge laisse sa ligne d'appartenance intacte — et
--   c'est voulu, l'historique doit survivre. La base ne peut donc pas voir ce
--   cas depuis `organization_members` seul.
--
--   Les deux etages restent, et ils ne font pas double emploi : la base ferme
--   la COURSE, le code applicatif ferme le FANTOME. Retirer l'un des deux
--   rouvrirait un trou different.
--
-- ═══ CAS A NE PAS CASSER — VERIFIES AVANT D'ECRIRE ═══════════════════════
--   1. SUPPRESSION D'UNE ORGANISATION ENTIERE. `delete from organizations`
--      emporte les membres par cascade. La cle etrangere posee ici est en NO
--      ACTION : sa verification, declenchee par la suppression des membres,
--      cherche une organisation qui les reference — et ne trouve rien, la ligne
--      venant d'etre supprimee dans la MEME transaction. La suppression passe.
--      (Chemin reel : le rollback de /api/auth/register-org, et la migration
--      20260828000000 de nettoyage des organisations fantomes.)
--
--   2. DEPART DU DERNIER MEMBRE. Il n'existe AUCUNE suppression physique de
--      `organization_members` dans le code : retrait et depart ecrivent
--      `status = 'removed'`. La purge RGPD (lib/account-purge.ts) ne supprime
--      jamais la ligne `users` — elle l'anonymise — donc aucune cascade
--      n'emporte une appartenance. Le seul chemin qui supprime physiquement une
--      ligne de membre est la cascade depuis l'organisation, traitee au point 1.
--
--   3. LE DEPANNAGE PLATEFORME. /api/admin/user-org-role peut DELIBEREMENT
--      laisser une organisation sans administrateur (`force: true`, sous
--      re-authentification, avec une modale qui le dit et une trace d'audit).
--      C'est le SEUL outil de reparation d'une organisation deja bloquee :
--      une garantie qui le casserait rendrait le probleme irreparable. Il
--      conserve donc une porte, NOMMEE et unique — voir `p_forcer` ci-dessous.
--
-- ═══ LE BACKFILL, ET POURQUOI IL EST DEGRADE ET NON BLOQUANT ═════════════
--   On designe, pour chaque organisation qui a au moins un administrateur actif,
--   le plus ancien. Les organisations qui n'en ont AUCUN gardent un siege
--   vacant : on ne peut pas designer quelqu'un qui n'existe pas.
--
--   Siege vacant = cle etrangere non verifiee (MATCH SIMPLE) = AUCUNE ligne
--   gelee. Une organisation deja cassee n'est ni reparee ni aggravee, et la
--   migration ne peut pas echouer sur des donnees non conformes. Des qu'un
--   administrateur actif y apparait, le siege est pris automatiquement.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LA CLE REFERENCABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- `id` est deja la cle primaire : ce quadruplet est donc trivialement unique et
-- la contrainte ne peut refuser aucune donnee existante. Son role n'est pas de
-- contraindre — c'est d'etre REFERENCABLE, et de faire de `role_in_org` et
-- `status` des colonnes de cle (voir « POURQUOI CA TIENT SOUS CONCURRENCE »).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'organization_members_identite_role_unique'
       and conrelid = 'public.organization_members'::regclass
  ) then
    alter table public.organization_members
      add constraint organization_members_identite_role_unique
      unique (id, organization_id, role_in_org, status);
  end if;
end
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LE SIEGE
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.organizations
  add column if not exists siege_admin_membre_id uuid;

-- Les deux constantes de la cle etrangere. GENEREES : aucun code ne les ecrit,
-- rien ne peut les falsifier, et elles valent NULL exactement quand le siege est
-- vacant — ce qui neutralise la cle etrangere (MATCH SIMPLE) sans exception
-- ecrite nulle part.
alter table public.organizations
  add column if not exists siege_admin_role character varying
    generated always as (
      case when siege_admin_membre_id is null then null else 'admin' end
    ) stored;

alter table public.organizations
  add column if not exists siege_admin_statut character varying
    generated always as (
      case when siege_admin_membre_id is null then null else 'active' end
    ) stored;

comment on column public.organizations.siege_admin_membre_id is
'Ligne organization_members occupant le SIEGE d''administrateur de cette
organisation.

LA GARANTIE « JAMAIS ZERO ADMINISTRATEUR » TIENT ENTIEREMENT ICI. La cle
etrangere composite ci-dessous impose que la ligne designee soit, a tout
instant, un administrateur ACTIF DE CETTE ORGANISATION. Son occupant ne peut
donc etre ni retrograde ni retire : il en reste toujours au moins un.

NULL = siege vacant. Deux cas, et aucun n''est une anomalie :
  - organisation sans aucun administrateur actif au moment du backfill
    (deja cassee : on ne la repare pas, on ne la gele pas non plus) ;
  - liberation deliberee par le depannage plateforme (force: true).
Siege vacant ⇒ cle etrangere non verifiee ⇒ aucune ligne gelee.

Ce champ ne dit PAS qui sont les administrateurs — il y en a souvent plusieurs,
et un seul occupe le siege. Il ne sert qu''a rendre le zero impossible.';

-- LA GARANTIE. `organizations.id` sert de troisieme colonne : le siege ne peut
-- pas designer un administrateur d'une AUTRE organisation.
-- ON DELETE / ON UPDATE NO ACTION (defaut) : voir « CAS A NE PAS CASSER » § 1.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'organizations_siege_admin_fkey'
       and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_siege_admin_fkey
      foreign key (siege_admin_membre_id, id, siege_admin_role, siege_admin_statut)
      references public.organization_members (id, organization_id, role_in_org, status);
  end if;
end
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LE BACKFILL — degrade, jamais bloquant
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_pourvues integer;
  v_vacantes integer;
begin
  update public.organizations o
     set siege_admin_membre_id = m.id
    from (
      select distinct on (x.organization_id) x.organization_id, x.id
        from public.organization_members x
       where x.role_in_org = 'admin'
         and x.status = 'active'
       order by x.organization_id, x.joined_at asc, x.id asc
    ) m
   where m.organization_id = o.id
     and o.siege_admin_membre_id is null;
  get diagnostics v_pourvues = row_count;

  select count(*) into v_vacantes
    from public.organizations where siege_admin_membre_id is null;

  raise notice 'Siege administrateur : % organisation(s) pourvue(s), % siege(s) vacant(s) (organisation sans aucun administrateur actif — deja bloquee avant cette migration, ni reparee ni aggravee ici).',
    v_pourvues, v_vacantes;
end
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. LE CLIQUET — un siege pourvu ne redevient pas vacant par accident
-- ═══════════════════════════════════════════════════════════════════════════
-- La cle etrangere empeche de retrograder l'occupant. Elle n'empeche pas
-- d'ecrire NULL sur le siege, ce qui reviendrait au meme resultat par un autre
-- chemin. Ce cliquet ferme ce chemin.
--
-- Ce n'est PAS un trigger qui recompte : il ne lit que OLD et NEW de la MEME
-- ligne. Aucune transaction concurrente ne peut le tromper — il n'a rien a voir
-- avec ce qui est commite ailleurs.
--
-- LA SEULE PORTE : le drapeau de transaction pose par `maj_membre_organisation`
-- sous `p_forcer`, c'est-a-dire le depannage plateforme. Elle est NOMMEE, elle
-- est unique, et elle n'est atteignable que par une fonction accordee au seul
-- service_role.
--
-- ⚠️ POURQUOI PAS UN REVOKE DE COLONNE sur `authenticated`. Un `ensure_rls`
--    event trigger recable les droits (cf. CLAUDE.md) : un REVOKE ne tiendrait
--    pas. La garantie doit vivre dans la contrainte et dans ce cliquet, pas
--    dans un droit qu'on nous reprendra.
create or replace function public.cliquet_siege_admin()
returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
begin
  if old.siege_admin_membre_id is not null
     and new.siege_admin_membre_id is null
     and coalesce(current_setting('skilloria.liberation_siege_admin', true), '') <> 'oui'
  then
    raise exception 'siege administrateur : liberation interdite pour l''organisation %', old.id
      using errcode = 'check_violation',
            hint = 'Designez un autre administrateur actif, ou passez par le depannage plateforme (force).';
  end if;
  return new;
end;
$fn$;

comment on function public.cliquet_siege_admin() is
'Interdit de rendre vacant un siege d''administrateur deja pourvu.

Ne lit que OLD et NEW de la meme ligne : aucune transaction concurrente ne peut
le tromper. Il complete la cle etrangere, qui empeche de retrograder l''occupant
mais pas d''effacer la designation.

Seule exception : le drapeau de transaction pose par maj_membre_organisation
sous p_forcer (depannage plateforme).';

drop trigger if exists organizations_cliquet_siege_admin on public.organizations;
create trigger organizations_cliquet_siege_admin
  before update of siege_admin_membre_id on public.organizations
  for each row execute function public.cliquet_siege_admin();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. UN SIEGE VACANT SE POURVOIT DES QU'UN ADMINISTRATEUR ACTIF APPARAIT
-- ═══════════════════════════════════════════════════════════════════════════
-- Sans cela, chaque chemin de creation (inscription, acceptation d'invitation,
-- promotion, organisation personnelle d'un expert) devrait penser a poser le
-- siege — et le premier qui l'oublierait creerait une organisation sans
-- garantie, silencieusement.
--
-- Ce n'est PAS un recomptage : la condition est « le siege est-il vacant ? »,
-- lue sur UNE ligne. Deux insertions simultanees sur une organisation sans
-- siege ecrivent toutes deux ; le verrou de ligne les serialise et le siege
-- finit occupe par un administrateur actif dans les deux ordres.
--
-- C'est aussi ce qui REPARE une organisation debloquee par le back-office : la
-- promotion d'un membre en administrateur repourvoit le siege toute seule.
create or replace function public.pourvoir_siege_admin_si_vacant()
returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
begin
  if new.role_in_org = 'admin' and new.status = 'active' then
    update public.organizations
       set siege_admin_membre_id = new.id
     where id = new.organization_id
       and siege_admin_membre_id is null;
  end if;
  return null;
end;
$fn$;

comment on function public.pourvoir_siege_admin_si_vacant() is
'Pourvoit le siege d''administrateur d''une organisation des qu''un
administrateur actif y apparait, si le siege est vacant.

Evite que chaque chemin de creation ait a y penser — un oubli produirait une
organisation sans garantie, silencieusement. Repare aussi automatiquement une
organisation debloquee par le back-office.';

drop trigger if exists organization_members_pourvoir_siege on public.organization_members;
create trigger organization_members_pourvoir_siege
  after insert or update of role_in_org, status on public.organization_members
  for each row execute function public.pourvoir_siege_admin_si_vacant();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. LE SEUL CHEMIN D'ECRITURE SUR UN MEMBRE
-- ═══════════════════════════════════════════════════════════════════════════
-- Role et statut se changent desormais ICI. La fonction transfere le siege
-- AVANT de retrograder son occupant, dans la MEME transaction — donc sans
-- fenetre ou l'organisation serait a zero.
--
-- Elle ne remplace PAS la garde applicative `countActiveAdmins` : celle-la pose
-- une question plus exigeante (le compte est-il joignable ?) que la base ne peut
-- pas voir. Les deux etages se cumulent.
create or replace function public.maj_membre_organisation(
  p_membre_id       uuid,
  p_nouveau_role    character varying default null,
  p_nouveau_statut  character varying default null,
  p_forcer          boolean default false
) returns text
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_org          uuid;
  v_role         character varying;
  v_statut       character varying;
  v_role_cible   character varying;
  v_statut_cible character varying;
  v_au_siege     boolean;
  v_transfere    boolean := false;
  v_cand         uuid;
begin
  select m.organization_id, m.role_in_org, m.status
    into v_org, v_role, v_statut
    from public.organization_members m
   where m.id = p_membre_id;
  if v_org is null then
    return 'introuvable';
  end if;

  v_role_cible   := coalesce(p_nouveau_role, v_role);
  v_statut_cible := coalesce(p_nouveau_statut, v_statut);
  if v_role_cible = v_role and v_statut_cible = v_statut then
    return 'inchange';
  end if;

  -- Ne concerne que la PERTE du statut d'administrateur actif. Une promotion,
  -- ou un changement qui garde l'interesse administrateur actif, ne touche
  -- rien : le siege reste ou il est.
  if v_role = 'admin' and v_statut = 'active'
     and not (v_role_cible = 'admin' and v_statut_cible = 'active')
  then
    select (o.siege_admin_membre_id = p_membre_id) into v_au_siege
      from public.organizations o where o.id = v_org;

    if coalesce(v_au_siege, false) then
      -- ── TRANSFERT DU SIEGE ────────────────────────────────────────────────
      -- On essaie les remplacants un par un. Un candidat qui vient d'etre
      -- retrograde par une transaction concurrente fait echouer la cle
      -- etrangere : ce n'est pas une panne, c'est la garantie qui parle. On
      -- passe au suivant plutot que de refuser — refuser ici serait un
      -- « dernier administrateur » mensonger alors qu'il en reste.
      for v_cand in
        select m.id
          from public.organization_members m
         where m.organization_id = v_org
           and m.id <> p_membre_id
           and m.role_in_org = 'admin'
           and m.status = 'active'
         order by m.joined_at asc, m.id asc
      loop
        begin
          update public.organizations
             set siege_admin_membre_id = v_cand
           where id = v_org;
          v_transfere := true;
          exit;
        exception when foreign_key_violation then
          null;
        end;
      end loop;

      if not v_transfere then
        if not p_forcer then
          -- REFUS. Aucune ecriture n'a eu lieu.
          return 'dernier_admin';
        end if;
        -- ── LA PORTE DU DEPANNAGE PLATEFORME ─────────────────────────────
        -- Delibere, trace en amont (audit `last_admin_bypassed`), et seule
        -- issue pour reparer une organisation deja bloquee. Le drapeau est
        -- LOCAL A LA TRANSACTION (troisieme argument `true`) : il ne peut pas
        -- fuir vers un autre appel.
        perform set_config('skilloria.liberation_siege_admin', 'oui', true);
        update public.organizations set siege_admin_membre_id = null where id = v_org;
        perform set_config('skilloria.liberation_siege_admin', '', true);
      end if;
    end if;
  end if;

  begin
    update public.organization_members
       set role_in_org = v_role_cible,
           status      = v_statut_cible,
           updated_at  = now()
     where id = p_membre_id;
  exception when foreign_key_violation then
    -- L'interesse occupe encore le siege : une transaction concurrente l'y a
    -- remis, ou le transfert n'a pas pris. On refuse proprement plutot que de
    -- laisser remonter une erreur technique.
    return 'dernier_admin';
  end;

  return 'ok';
end;
$fn$;

comment on function public.maj_membre_organisation(uuid, character varying, character varying, boolean) is
'Change le role et/ou le statut d''une ligne d''appartenance, en garantissant
qu''il reste au moins un administrateur actif dans l''organisation.

Rend : ''ok'', ''dernier_admin'' (refus, aucune ecriture), ''introuvable'',
''inchange''.

Transfere le siege d''administrateur AVANT de retrograder son occupant, dans la
MEME transaction : il n''existe aucune fenetre ou l''organisation serait a zero.
Sous concurrence, c''est la cle etrangere composite qui tranche — voir l''entete
de la migration.

p_forcer = depannage plateforme UNIQUEMENT (/api/admin/user-org-role, sous
re-authentification et confirmation explicite). Laisse deliberement
l''organisation sans administrateur : c''est le seul outil qui repare une
organisation deja bloquee, et une garantie qui le casserait rendrait le probleme
irreparable.

Ne remplace PAS countActiveAdmins (lib/org-members.ts), qui verifie en plus que
le compte derriere la ligne est encore JOIGNABLE — ce que la base ne peut pas
voir depuis organization_members seul.';

revoke all on function public.maj_membre_organisation(uuid, character varying, character varying, boolean) from public, anon, authenticated;
grant execute on function public.maj_membre_organisation(uuid, character varying, character varying, boolean) to service_role;
