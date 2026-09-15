-- LA PLATEFORME NE PEUT PLUS TOMBER A ZERO ADMINISTRATEUR
--
-- ═══ LE DEFAUT ════════════════════════════════════════════════════════════
--   `/api/me/account/delete` compte les autres administrateurs plateforme
--   disponibles, compare, puis ecrit `deletion_scheduled_at`. Deux
--   administrateurs qui programment leur suppression au meme instant lisent
--   tous deux « il en reste un autre » et ecrivent tous deux.
--
--   C'est le dernier membre de la classe lire-puis-comparer-puis-ecrire, et le
--   seul qui restait ouvert.
--
-- ═══ MEME MECANISME QUE LE SIEGE D'ORGANISATION, DEUX DIFFICULTES EN PLUS ══
--   Le siege d'organisation (20260914200010) repose sur une cle etrangere
--   composite : l'organisation DESIGNE une ligne, et la cle impose que cette
--   ligne soit un administrateur actif. Ici le mecanisme est le meme, mais deux
--   choses que le cas organisation avait gratuitement manquaient.
--
--   1. AUCUNE LIGNE NE PORTE LE PERIMETRE. `organizations.id` servait de
--      troisieme colonne a la cle. « La plateforme » n'a pas de table. D'ou la
--      table singleton `public.plateforme` ci-dessous — une seule ligne, et un
--      CHECK qui garantit qu'il ne peut y en avoir qu'une.
--
--   2. LE PREDICAT N'EST PAS FAIT QUE D'EGALITES. « Administrateur disponible »
--      vaut :
--          user_type = 'admin' ET status = 'active'
--          ET deletion_scheduled_at IS NULL ET anonymized_at IS NULL
--      Une cle etrangere ne sait comparer que des EGALITES : elle ne peut
--      exprimer ni une nullite, ni une inegalite. D'ou la colonne GENEREE
--      `users.admin_disponible`, qui replie les quatre conditions en un seul
--      booleen — et restaure l'egalite.
--
--   ⚠️ CETTE COLONNE GENEREE N'EST PAS UN CONFORT : c'est elle qui fait tenir
--      l'argument de concurrence. Etant STOCKEE, elle bascule lors d'une mise a
--      jour de `status` ou de `deletion_scheduled_at`, et comme elle appartient
--      a une cle unique ORDINAIRE referencee par une cle etrangere, cette
--      bascule est une MISE A JOUR DE CLE. Elle prend donc un verrou de force
--      `FOR UPDATE`, qui entre en conflit avec le `FOR KEY SHARE` de la
--      verification de cle etrangere. Les deux transactions ne peuvent plus
--      s'ignorer — exactement la preuve du siege d'organisation, transposee.
--
--      Elle est aussi INFALSIFIABLE : aucun code ne l'ecrit, elle se recalcule
--      a chaque ecriture de la ligne.
--
--   ⚠️ COUT DE LA MIGRATION : ajouter une colonne generee STOCKEE reecrit la
--      table `users`. Sur ce volume (V0) c'est immediat ; sur une table de
--      plusieurs millions de lignes il faudrait une fenetre.
--
-- ═══ CE QUI CHANGE POUR LA PURGE — ET POURQUOI ON Y TOUCHE ════════════════
--   La purge RGPD refuse deja d'anonymiser le dernier administrateur
--   plateforme : elle journalise, conserve `deletion_scheduled_at`, et passe au
--   suivant. C'est un refus GRACIEUX, et il doit le rester.
--
--   Sans precaution, la cle etrangere transformerait ce refus en erreur
--   technique 23503 au milieu d'une boucle — sur un chemin RGPD, irreversible
--   et legalement du. La purge appelle donc `preparer_purge_plateforme` AVANT
--   d'anonymiser : la fonction transfere le siege s'il est detenu par la cible,
--   et rend « dernier_admin » s'il n'y a personne a qui le transferer. Ce
--   « dernier_admin » rejoint exactement le chemin `blocked` existant.
--
-- ═══ CE QUI NE CHANGE PAS ═════════════════════════════════════════════════
--   `countOtherAvailablePlatformAdmins` (lib/admin/user-actions-guard.ts) RESTE.
--   Les deux etages ne font pas double emploi : la base ferme la COURSE, le code
--   applicatif donne le refus PRECIS avant tout aller-retour, et son fail-safe
--   (`null` sur erreur de lecture) reste ce qui protege la purge quand le
--   comptage est indisponible.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. « ADMINISTRATEUR DISPONIBLE », REPLIE EN UNE EGALITE
-- ═══════════════════════════════════════════════════════════════════════════
-- MEME PREDICAT que countOtherAvailablePlatformAdmins, et ce n'est pas une
-- copie decorative : c'est la seule forme qu'une cle etrangere sait lire.
--
-- `coalesce(..., false)` sur la premiere condition : `user_type` est nullable,
-- et `null = 'admin'` vaut NULL, pas false. Sans ce repli, la colonne vaudrait
-- NULL pour tout compte sans type — jamais egale a `true`, donc jamais
-- designable : le resultat serait juste, mais par accident. On l'ecrit.
alter table public.users
  add column if not exists admin_disponible boolean
  generated always as (
    coalesce(user_type = 'admin', false)
    and coalesce(status = 'active', false)
    and deletion_scheduled_at is null
    and anonymized_at is null
  ) stored;

comment on column public.users.admin_disponible is
'Ce compte peut-il administrer la PLATEFORME, maintenant ?

GENEREE, donc infalsifiable : aucun code ne l''ecrit, elle se recalcule a chaque
ecriture de la ligne. Elle replie en un seul booleen les quatre conditions de
countOtherAvailablePlatformAdmins (lib/admin/user-actions-guard.ts) —
user_type, status, suppression programmee, anonymisation.

POURQUOI UN BOOLEEN PLUTOT QUE LES QUATRE COLONNES : une cle etrangere ne sait
comparer que des EGALITES. Elle ne peut exprimer ni « IS NULL » ni « <> ». Ce
repli est ce qui rend le siege d''administrateur plateforme exprimable comme une
contrainte, et non comme du code.';

-- LA CLE REFERENCABLE. `id` etant deja cle primaire, ce couple est trivialement
-- unique : il ne refuse aucune donnee existante. Son role n'est pas de
-- contraindre, c'est d'etre REFERENCABLE — et de faire de `admin_disponible`
-- une COLONNE DE CLE, ce qui donne a sa bascule un verrou fort.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'users_admin_disponible_unique'
       and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_admin_disponible_unique unique (id, admin_disponible);
  end if;
end
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LA TABLE QUI PORTE LE PERIMETRE
-- ═══════════════════════════════════════════════════════════════════════════
-- UNE SEULE LIGNE, garantie par la construction : la cle primaire est un
-- booleen qu'un CHECK force a `true`. Une seconde ligne devrait valoir `true`
-- elle aussi, et se heurterait a la cle primaire. Ce n'est pas une convention
-- qu'on espere respectee — c'est impossible.
create table if not exists public.plateforme (
  ligne_unique boolean primary key default true check (ligne_unique),
  siege_admin_user_id uuid,
  siege_admin_disponible boolean generated always as (
    case when siege_admin_user_id is null then null else true end
  ) stored
);

comment on table public.plateforme is
'Etat global de la plateforme. UNE SEULE LIGNE, garantie par construction (cle
primaire booleenne + CHECK).

Elle n''existe que pour porter le SIEGE D''ADMINISTRATEUR PLATEFORME : le siege
d''organisation vit sur `organizations`, mais « la plateforme » n''avait aucune
ligne pour l''accueillir.';

comment on column public.plateforme.siege_admin_user_id is
'Compte occupant le SIEGE d''administrateur de la plateforme.

LA GARANTIE « JAMAIS ZERO ADMINISTRATEUR PLATEFORME » TIENT ENTIEREMENT ICI. La
cle etrangere ci-dessous impose que ce compte soit, a tout instant, un
administrateur DISPONIBLE. Il ne peut donc etre ni suspendu, ni programme en
suppression, ni anonymise, tant qu''il occupe le siege.

NULL = siege vacant. Deux cas, et aucun n''est une anomalie :
  - aucun administrateur disponible au moment du backfill (plateforme deja sans
    administrateur : on ne la repare pas, on ne la gele pas non plus) ;
  - liberation deliberee par le depannage, sous drapeau de transaction.';

alter table public.plateforme enable row level security;
-- Aucune policy : aucun client ne lit ni n'ecrit cette table. Les fonctions
-- ci-dessous sont SECURITY DEFINER et bornees au service_role. Aucune policy
-- d'aucune autre table ne la lit non plus — donc aucun risque de recursion.

insert into public.plateforme (ligne_unique) values (true) on conflict do nothing;

-- LA GARANTIE.
-- ON DELETE / ON UPDATE NO ACTION (defaut) : un compte n'est JAMAIS supprime
-- physiquement (la purge anonymise, cf. lib/account-purge.ts), donc le cas ne
-- se presente pas. Et s'il se presentait un jour, refuser vaut mieux que
-- cascader — une plateforme sans administrateur n'a aucun ecran pour s'en
-- sortir.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'plateforme_siege_admin_fkey'
       and conrelid = 'public.plateforme'::regclass
  ) then
    alter table public.plateforme
      add constraint plateforme_siege_admin_fkey
      foreign key (siege_admin_user_id, siege_admin_disponible)
      references public.users (id, admin_disponible);
  end if;
end
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LE BACKFILL — degrade, jamais bloquant
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_siege uuid;
begin
  select u.id into v_siege
    from public.users u
   where u.admin_disponible
   order by u.created_at asc, u.id asc
   limit 1;

  update public.plateforme
     set siege_admin_user_id = v_siege
   where ligne_unique
     and siege_admin_user_id is null
     and v_siege is not null;

  if v_siege is null then
    raise notice 'Siege administrateur plateforme : VACANT — aucun administrateur disponible en base. La plateforme est deja sans administrateur, ce que cette migration ne repare pas et n aggrave pas.';
  else
    raise notice 'Siege administrateur plateforme : pourvu par %.', v_siege;
  end if;
end
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. LE CLIQUET
-- ═══════════════════════════════════════════════════════════════════════════
-- La cle etrangere empeche de rendre l'occupant indisponible. Elle n'empeche
-- pas d'ecrire NULL sur le siege, ce qui reviendrait au meme par un autre
-- chemin. Ce cliquet ferme ce chemin.
--
-- Il ne lit que OLD et NEW de la MEME ligne : ce n'est pas un recomptage, et
-- aucune transaction concurrente ne peut le tromper.
create or replace function public.cliquet_siege_plateforme()
returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
begin
  if old.siege_admin_user_id is not null
     and new.siege_admin_user_id is null
     and coalesce(current_setting('skilloria.liberation_siege_plateforme', true), '') <> 'oui'
  then
    raise exception 'siege administrateur plateforme : liberation interdite'
      using errcode = 'check_violation',
            hint = 'Transferez le siege a un autre administrateur disponible.';
  end if;
  return new;
end;
$fn$;

drop trigger if exists plateforme_cliquet_siege on public.plateforme;
create trigger plateforme_cliquet_siege
  before update of siege_admin_user_id on public.plateforme
  for each row execute function public.cliquet_siege_plateforme();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. UN SIEGE VACANT SE POURVOIT DES QU'UN ADMINISTRATEUR APPARAIT
-- ═══════════════════════════════════════════════════════════════════════════
-- Sans cela, la creation du premier administrateur, ou la reactivation d'un
-- compte apres annulation de suppression, laisserait le siege vide.
--
-- Ce n'est PAS un recomptage : la condition est « le siege est-il vacant ? »,
-- lue sur UNE ligne. Deux ecritures simultanees sont serialisees par le verrou
-- de ligne, et le siege finit occupe par un administrateur disponible dans les
-- deux ordres.
--
-- AFTER, et jamais BEFORE : une colonne generee n'est pas encore calculee dans
-- NEW au moment d'un trigger BEFORE. On lirait NULL et on ne pourvoirait jamais.
create or replace function public.pourvoir_siege_plateforme_si_vacant()
returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
begin
  if new.admin_disponible then
    update public.plateforme
       set siege_admin_user_id = new.id
     where ligne_unique
       and siege_admin_user_id is null;
  end if;
  return null;
end;
$fn$;

drop trigger if exists users_pourvoir_siege_plateforme on public.users;
create trigger users_pourvoir_siege_plateforme
  after insert or update of user_type, status, deletion_scheduled_at, anonymized_at
  on public.users
  for each row execute function public.pourvoir_siege_plateforme_si_vacant();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. LIBERER LE SIEGE DE LA CIBLE — transfert, ou refus
-- ═══════════════════════════════════════════════════════════════════════════
-- Brique commune aux deux appelants : la programmation de suppression (§7) et
-- la purge. Elle ne touche PAS au compte cible — elle ne fait que degager le
-- siege, pour que l'appelant puisse ensuite ecrire sans se heurter a la cle.
create or replace function public.liberer_siege_plateforme(
  p_user_id uuid,
  p_forcer  boolean default false
) returns text
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_au_siege  boolean;
  v_transfere boolean := false;
  v_cand      uuid;
begin
  select (p.siege_admin_user_id = p_user_id) into v_au_siege
    from public.plateforme p where p.ligne_unique;

  -- La cible n'occupe pas le siege : il reste donc occupe par quelqu'un
  -- d'autre, qui est par construction un administrateur disponible. Rien a
  -- faire, et rien a refuser.
  if not coalesce(v_au_siege, false) then
    return 'ok';
  end if;

  -- TRANSFERT. On essaie les remplacants un par un : un candidat devenu
  -- indisponible au meme instant fait echouer la cle etrangere — ce n'est pas
  -- une panne, c'est la garantie qui parle. On passe au suivant plutot que de
  -- refuser, sans quoi on annoncerait « dernier administrateur » alors qu'il en
  -- reste.
  for v_cand in
    select u.id
      from public.users u
     where u.admin_disponible
       and u.id <> p_user_id
     order by u.created_at asc, u.id asc
  loop
    begin
      update public.plateforme
         set siege_admin_user_id = v_cand
       where ligne_unique;
      v_transfere := true;
      exit;
    exception when foreign_key_violation then
      null;
    end;
  end loop;

  if v_transfere then
    return 'ok';
  end if;

  if not p_forcer then
    -- REFUS. Aucune ecriture n'a eu lieu.
    return 'dernier_admin';
  end if;

  -- LA PORTE, nommee et unique. Le drapeau est LOCAL A LA TRANSACTION
  -- (troisieme argument `true`) : il ne peut pas fuir vers un autre appel de la
  -- meme connexion.
  perform set_config('skilloria.liberation_siege_plateforme', 'oui', true);
  update public.plateforme set siege_admin_user_id = null where ligne_unique;
  perform set_config('skilloria.liberation_siege_plateforme', '', true);
  return 'ok';
end;
$fn$;

comment on function public.liberer_siege_plateforme(uuid, boolean) is
'Degage le siege d''administrateur plateforme si la cible l''occupe.

Rend ''ok'' (siege libre, ou jamais occupe par la cible) ou ''dernier_admin''
(refus : personne a qui transferer, et aucune ecriture n''a eu lieu).

NE TOUCHE PAS au compte cible : l''appelant ecrit ensuite ce qu''il a a ecrire.
Entre les deux, la cible n''occupe plus le siege — la cle etrangere ne s''y
oppose donc plus, et le nouveau titulaire est lui protege.

p_forcer : libere le siege sans remplacant. Reserve a un depannage explicite ;
aucun appelant ne le passe aujourd''hui.';

revoke all on function public.liberer_siege_plateforme(uuid, boolean) from public, anon, authenticated;
grant execute on function public.liberer_siege_plateforme(uuid, boolean) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. PROGRAMMER UNE SUPPRESSION DE COMPTE, SANS FENETRE
-- ═══════════════════════════════════════════════════════════════════════════
-- Le transfert du siege et l'ecriture de `deletion_scheduled_at` ont lieu dans
-- la MEME transaction : il n'existe aucun instant ou la plateforme serait sans
-- administrateur.
create or replace function public.programmer_suppression_compte(
  p_user_id      uuid,
  p_scheduled_at timestamptz
) returns text
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_existe boolean := false;
  v_res    text;
begin
  select true into v_existe from public.users u where u.id = p_user_id;
  if not coalesce(v_existe, false) then
    return 'introuvable';
  end if;

  v_res := public.liberer_siege_plateforme(p_user_id, false);
  if v_res <> 'ok' then
    return v_res;
  end if;

  begin
    update public.users
       set deletion_scheduled_at = p_scheduled_at
     where id = p_user_id;
  exception when foreign_key_violation then
    -- La cible occupe encore le siege : une transaction concurrente l'y a
    -- remise. On refuse proprement plutot que de laisser remonter une erreur
    -- technique.
    return 'dernier_admin';
  end;

  return 'ok';
end;
$fn$;

comment on function public.programmer_suppression_compte(uuid, timestamptz) is
'Programme la suppression d''un compte, en garantissant qu''il reste au moins un
administrateur plateforme disponible.

Rend ''ok'', ''dernier_admin'' (refus, aucune ecriture) ou ''introuvable''.

Le transfert du siege et l''ecriture de deletion_scheduled_at ont lieu dans la
MEME transaction : aucune fenetre ou la plateforme serait sans administrateur.
Sous concurrence, c''est la cle etrangere qui tranche.

Ne remplace PAS countOtherAvailablePlatformAdmins : celui-la donne le refus
precis avant tout aller-retour, et son fail-safe protege la purge quand le
comptage est indisponible.';

revoke all on function public.programmer_suppression_compte(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.programmer_suppression_compte(uuid, timestamptz) to service_role;
