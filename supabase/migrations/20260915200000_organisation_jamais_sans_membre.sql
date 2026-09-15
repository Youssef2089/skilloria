-- UNE ORGANISATION NE PEUT PLUS NAITRE SANS MEMBRE
--
-- ═══ LE DEFAUT, ET SON CHEMIN EXACT ═══════════════════════════════════════
--   Deux organisations de staging existent sans aucune ligne
--   `organization_members` — pas meme une ligne 'removed' — sans publication,
--   sans `organization_domains`, sans audit. Voici comment elles sont nees.
--
--   `register-org` insere l'organisation, PUIS le membre, PUIS le lien de
--   domaine : TROIS ALLERS-RETOURS, AUCUNE TRANSACTION. Le 2026-05-30, le
--   `catch` de rattrapage supprimait `public.users` et `auth.users` mais PAS
--   l'organisation. Or `organization_members.user_id` est en ON DELETE CASCADE :
--   le nettoyage de l'utilisateur EMPORTAIT le membre et LAISSAIT
--   l'organisation. Le commit 71e7210 du meme jour a 23h42 (Paris) s'intitule
--   « cleanup atomique reel — supprime aussi l'organization ». Les deux
--   organisations datent de 22h30 et 23h14 : toutes deux ANTERIEURES au
--   correctif.
--
--   ET LE DEFAUT DE FOND N'EST PAS REFERME POUR AUTANT. Ce rattrapage reste du
--   code applicatif, donc du best-effort : une fonction TUEE — depassement de
--   `maxDuration`, recyclage d'instance, deploiement en cours de requete —
--   n'execute jamais son `catch`. `lib/collaboration/ensure-personal-org.ts` a
--   exactement la meme structure. Le vrai defaut n'est pas ces deux lignes,
--   c'est QU'ELLES ONT PU EXISTER.
--
-- ═══ CE QU'ON POSE, ET POURQUOI LES DEUX ENSEMBLE ═════════════════════════
--   1. UNE RPC TRANSACTIONNELLE. Organisation + membre administrateur + lien de
--      domaine deviennent UNE SEULE instruction, donc UNE SEULE transaction.
--      Aucune fenetre entre les trois. Un processus tue ne laisse rien : la
--      transaction n'a jamais ete validee.
--
--   2. UNE CONTRAINTE DIFFEREE. La RPC ferme les DEUX chemins d'aujourd'hui ;
--      la contrainte ferme ceux de demain. Un futur script, une migration, une
--      route de back-office qui inserait une organisation nue serait refuse par
--      la base, sans que personne ait a s'en souvenir.
--      La RPC seule redeviendrait une discipline ; la contrainte seule
--      casserait les chemins existants. Il faut les deux.
--
-- ═══ LA CONTRAINTE : A L'INSERT SEULEMENT, ET DIFFEREE ════════════════════
--   A L'INSERT SEULEMENT — c'est la regle demandee, mot pour mot : « une
--   organisation sans membre ne doit pas pouvoir NAITRE ». Une contrainte qui
--   s'appliquerait aussi aux mises a jour GELERAIT les deux organisations deja
--   orphelines : plus aucune ecriture possible dessus, pas meme pour les
--   marquer. On refuse une naissance ; on ne gele pas une ligne.
--
--   DIFFEREE — au moment de l'INSERT de l'organisation, le membre n'existe pas
--   encore : c'est l'ordre naturel, et l'inverse est impossible puisque le
--   membre reference l'organisation. La verification doit donc avoir lieu au
--   COMMIT, quand la transaction est complete.
--
--   CE N'EST PAS UN TRIGGER QUI RECOMPTE. Il ne pose qu'une question sur UNE
--   ligne — « son siege est-il pourvu ? » — et ne lit rien d'autre. Aucune
--   transaction concurrente ne peut le tromper : il n'a rien a voir avec ce qui
--   est commite ailleurs.
--
--   ET IL NE DUPLIQUE AUCUNE REGLE. Il relit `siege_admin_membre_id`, pourvu
--   automatiquement par `pourvoir_siege_admin_si_vacant` (20260914200010) des
--   qu'un administrateur actif apparait. « Avoir un membre administrateur
--   actif » et « avoir un siege pourvu » sont donc la MEME chose, ecrite une
--   seule fois. Une organisation nee avec un membre `viewer` serait refusee —
--   et c'est voulu : une organisation qu'on ne peut pas administrer est aussi
--   bloquee qu'une organisation vide.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LA CREATION, ATOMIQUE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Parametres EXPLICITES et typés plutot qu'un `jsonb` fourre-tout : une clé mal
-- orthographiee dans un jsonb serait silencieusement ignoree, et l'organisation
-- naitrait sans son offre ou sans son pays. Les clients Supabase ne sont pas
-- typés — c'est ici, et nulle part ailleurs, que le typage peut exister.
--
-- L'union des besoins des deux appelants :
--   register-org        : org_type, company_name, country, siren, vat_number,
--                         email_domain, verification_status ;
--   ensure-personal-org : org_type, company_name, country, owner_user_id,
--                         is_verified, verification_status, verified_at,
--                         setup_completed_at, package_id, package_started_at.
create or replace function public.creer_organisation_avec_admin(
  p_user_id             uuid,
  p_domain_id           uuid,
  p_org_type            character varying,
  p_company_name        character varying,
  p_country             character varying,
  p_siren               character varying   default null,
  p_vat_number          character varying   default null,
  p_email_domain        character varying   default null,
  p_verification_status character varying   default 'pending_provider_check',
  p_owner_user_id       uuid                default null,
  p_is_verified         boolean             default false,
  p_verified_at         timestamptz         default null,
  p_setup_completed_at  timestamptz         default null,
  p_package_id          uuid                default null,
  p_package_started_at  timestamptz         default null
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_org uuid;
begin
  insert into public.organizations (
    org_type, company_name, country, siren, vat_number, email_domain,
    verification_status, owner_user_id, is_verified, verified_at,
    setup_completed_at, package_id, package_started_at
  ) values (
    p_org_type, p_company_name, p_country, p_siren, p_vat_number, p_email_domain,
    p_verification_status, p_owner_user_id, p_is_verified, p_verified_at,
    p_setup_completed_at, p_package_id, p_package_started_at
  )
  returning id into v_org;

  -- LE MEMBRE ADMINISTRATEUR, dans la meme transaction. C'est cette insertion
  -- qui declenche `pourvoir_siege_admin_si_vacant` et pourvoit le siege — donc
  -- qui satisfait la contrainte differee au commit.
  insert into public.organization_members (
    user_id, organization_id, role_in_org, status, invited_by
  ) values (
    p_user_id, v_org, 'admin', 'active', null
  );

  -- TRACE de l'ecosysteme d'inscription. Facultative pour la garantie, mais
  -- elle appartient a la meme creation : la sortir de la transaction
  -- reintroduirait une organisation a moitie creee, ce qu'on ferme ici.
  if p_domain_id is not null then
    insert into public.organization_domains (organization_id, domain_id, active)
    values (v_org, p_domain_id, true);
  end if;

  return v_org;
end;
$fn$;

comment on function public.creer_organisation_avec_admin is
'Cree une organisation, son membre ADMINISTRATEUR ACTIF et son lien
d''ecosysteme en UNE SEULE TRANSACTION.

Remplace trois allers-retours PostgREST dont le rattrapage, purement applicatif,
ne pouvait pas s''executer si le processus etait tue. Deux organisations de
staging sont nees exactement comme ca.

Aucune exception n''est avalee : une violation d''unicite (organisation
personnelle deja existante, domaine e-mail deja pris) remonte telle quelle a
l''appelant, qui sait la traiter.

Le membre est cree ADMIN/ACTIVE : c''est ce qui pourvoit le siege
(pourvoir_siege_admin_si_vacant) et satisfait la contrainte differee ci-dessous.';

revoke all on function public.creer_organisation_avec_admin(uuid, uuid, character varying, character varying, character varying, character varying, character varying, character varying, character varying, uuid, boolean, timestamptz, timestamptz, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.creer_organisation_avec_admin(uuid, uuid, character varying, character varying, character varying, character varying, character varying, character varying, character varying, uuid, boolean, timestamptz, timestamptz, uuid, timestamptz) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LA CONTRAINTE : PAS DE NAISSANCE SANS ADMINISTRATEUR
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.exiger_siege_a_la_naissance()
returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_siege  uuid;
  v_trouve boolean := false;
begin
  -- ON RELIT LA LIGNE. `new` porte les valeurs du moment de l'INSERT, ou le
  -- siege etait forcement vide — le membre n'existait pas encore. La question
  -- ne se pose qu'au COMMIT, sur l'etat final.
  select o.siege_admin_membre_id, true
    into v_siege, v_trouve
    from public.organizations o
   where o.id = new.id;

  -- Creee PUIS supprimee dans la meme transaction (un rollback applicatif qui
  -- a eu le temps de tourner) : il n'y a plus rien a exiger.
  if not v_trouve then
    return null;
  end if;

  if v_siege is null then
    raise exception 'organisation % creee sans administrateur actif', new.id
      using errcode = 'check_violation',
            hint = 'Passez par creer_organisation_avec_admin : l''organisation et son membre administrateur doivent naitre dans la meme transaction.';
  end if;

  return null;
end;
$fn$;

comment on function public.exiger_siege_a_la_naissance() is
'Exige, au COMMIT, qu''une organisation NOUVELLEMENT CREEE ait un siege
d''administrateur pourvu.

A L''INSERT SEULEMENT : les organisations deja orphelines ne sont ni reparees ni
GELEES — aucune mise a jour ne declenche ce controle. On refuse une naissance,
on ne gele pas une ligne.

DIFFEREE : au moment de l''INSERT le membre ne peut pas encore exister, puisqu''il
reference l''organisation. La question n''a de sens qu''une fois la transaction
complete.

Ce n''est PAS un recomptage : une seule question, sur une seule ligne. Aucune
transaction concurrente ne peut le tromper.';

drop trigger if exists organizations_exiger_siege_naissance on public.organizations;
create constraint trigger organizations_exiger_siege_naissance
  after insert on public.organizations
  deferrable initially deferred
  for each row execute function public.exiger_siege_a_la_naissance();
