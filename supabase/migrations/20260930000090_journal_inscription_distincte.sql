-- ════════════════════════════════════════════════════════════════════════════
--  DEUX ÉCRITURES D'UN MÊME GESTE NE SE RESSEMBLENT PLUS (recette staging, 30/09/2026, §D.26).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement (§G.4). Elle remplace À SIGNATURE IDENTIQUE
--  `handle_new_user()` et élargit deux listes blanches ; le code en ligne n'écrit aucune de ces
--  lignes (seul le trigger les écrit) — rien ne casse entre le push et le déploiement.
--
--  LE CAS (Youssef, sur staging) : à l'inscription d'un expert, « Compte créé » et « Inscription
--  d'un expert » s'affichaient avec le même résumé, et la pièce ouverte ne montrait aucune
--  différence. Mesuré : même sujet (`users`, le compte), même acteur, même écosystème ; seule la
--  version des CGU les séparait.
--
--  DÉCISION DE YOUSSEF : un geste ne garde qu'une écriture quand deux ne se distinguent en rien.
--  Ici, chacune porte désormais ce qui LUI appartient, et l'écran le montre :
--   · `compte_cree` (sujet : le COMPTE) — son type FINAL, sa voie, la version des CGU acceptée, le
--     téléphone vérifié. Pour un administrateur, le type était « client » (le rôle de pont) : faux,
--     puisque le compte est promu dans la même transaction ; il vaut désormais « admin ».
--   · `expert_inscrit` (sujet : le PROFIL né à l'inscription) — sa branche, le nombre de
--     spécialités choisies au référentiel, et s'il a choisi « Autre ». Comme
--     `organisation_preinscrite` (sujet : l'organisation) et `invitation_acceptee` (sujet :
--     l'invitation), la seconde ligne dit l'OBJET que la voie a créé.
--  Balayage de toute la plateforme (docs/reprise.md, recette staging) : c'était le seul geste où
--  deux lignes ne se distinguaient en rien. Les lignes déjà écrites ne changent pas (ajout seul).
--
--  IDENTIFIANTS SEULEMENT (§D.26) : la précision « Autre » est un texte libre — elle n'entre pas ;
--  seul le fait qu'il y en ait une est écrit.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_meta        jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_refus       text;
  v_role        text;
  v_user_type   text;
  v_expert_type text;
  v_voie        text;
  v_piece       uuid;
  v_domain_id   uuid;
  v_role_id     uuid;
  v_confirme    boolean := new.email_confirmed_at is not null;
  v_tel         text;
  v_cgu         text;
  v_spec        text;
  v_miroir      uuid;
  v_contrainte  text;
  v_dom_mail    text;
  v_public      boolean;
  v_org         uuid;
  v_numero      text;
  v_inv         jsonb;
  v_acteur      text;
  v_admin_role  uuid;
  v_promotion   text;
  v_profil      uuid;
begin
  -- ① LA PREUVE, D'ABORD : sans elle, rien d'autre n'est lu.
  v_refus := public.preuve_inscription_refus(new.email, v_meta);
  if v_refus is not null then
    raise exception 'inscription refusee : %', v_refus
      using errcode = case v_refus when 'preuve_absente' then 'IN007'
                                   when 'preuve_expiree' then 'IN009'
                                   when 'secret_absent'  then 'IN011'
                                   else 'IN008' end;
  end if;

  -- ② LES RÈGLES — la même fonction que la route appelle avant de créer le compte.
  v_refus := public.inscription_refus(new.email, v_meta);
  if v_refus is not null then
    raise exception 'inscription refusee : %', v_refus
      using errcode = case v_refus when 'invalid_role'        then 'IN001'
                                   when 'invalid_domain'      then 'IN003'
                                   when 'role_gratuit_absent' then 'IN004'
                                   when 'invalid_branch'      then 'IN005'
                                   when 'invalid_speciality'  then 'IN005'
                                   when 'invalid_voie'        then 'IN006'
                                   when 'invalid_piece'       then 'IN006'
                                   else 'IN010' end;
  end if;

  -- ③ CE QUE LES RÈGLES ONT VALIDÉ, lu une fois.
  v_role  := v_meta ->> 'role';
  v_voie  := btrim(v_meta ->> 'voie');
  v_piece := (v_meta ->> 'piece')::uuid;
  v_tel   := nullif(btrim(coalesce(v_meta ->> 'telephone', '')), '');
  v_cgu   := nullif(btrim(coalesce(v_meta ->> 'cgu_version', '')), '');
  case v_role
    when 'expert'     then v_user_type := 'expert_freelance'; v_expert_type := 'freelance';
    when 'cdi'        then v_user_type := 'expert_cdi';       v_expert_type := 'cdi';
    when 'entreprise' then v_user_type := 'client';           v_expert_type := null;
    else                   v_user_type := 'cabinet';          v_expert_type := null;
  end case;
  select d.id into v_domain_id from public.domains d where d.slug = btrim(v_meta ->> 'domain_slug') and d.active limit 1;
  select r.id into v_role_id from public.roles r where r.name = 'Gratuit' and r.active limit 1;

  -- ④ LE COMPTE — avec ce que la preuve atteste : le téléphone vérifié, le consentement aux CGU.
  --    Confirmé à la création (l'invité, l'administrateur), il est actif tout de suite.
  begin
    insert into public.users (
      id, email, role_id, domain_id, user_type,
      status, email_verified, is_verified,
      first_name, last_name, locale,
      phone, phone_verified, cgu_accepted_at, cgu_version
    ) values (
      new.id, new.email, v_role_id, v_domain_id, v_user_type,
      case when v_confirme then 'active' else 'draft' end, v_confirme, false,
      btrim(v_meta ->> 'firstname'), btrim(v_meta ->> 'lastname'), 'fr',
      v_tel, v_tel is not null, case when v_cgu is not null then now() end, v_cgu
    )
    on conflict (id) do nothing
    returning id into v_miroir;
  exception when unique_violation then
    -- La course perdue contre un autre inscrit : le refus a un NOM (§E.22).
    get stacked diagnostics v_contrainte = constraint_name;
    raise exception 'inscription refusee : %', case when v_contrainte like '%phone%' then 'phone_already_used' else 'email_taken' end
      using errcode = 'IN010';
  end;
  if v_miroir is null then
    return new;
  end if;

  if v_expert_type is not null then
    v_spec := nullif(btrim(coalesce(v_meta ->> 'speciality_id', '')), '');
    insert into public.profiles (
      user_id, domain_id, expert_type, title, visible,
      profile_score, languages, skills, certifications,
      branch_id, speciality_ids, speciality_other
    ) values (
      new.id, v_domain_id, v_expert_type, nullif(btrim(coalesce(v_meta ->> 'specialty', '')), ''), false,
      0, array['fr']::text[], '{}'::text[], '[]'::jsonb,
      (v_meta ->> 'branch_id')::uuid,
      case when v_spec is null then '{}'::uuid[] else array[v_spec::uuid] end,
      nullif(btrim(coalesce(v_meta ->> 'speciality_other', '')), '')
    )
    on conflict (user_id) do nothing
    returning id into v_profil;
    if v_profil is null then
      select p.id into v_profil from public.profiles p where p.user_id = new.id;
    end if;
  end if;

  -- ⑤ LA LIGNE DU COMPTE — pour toute création : ce qui appartient au COMPTE (recette staging, 30/09/2026).
  --    Son type FINAL (un administrateur naît par le rôle de pont puis est promu dans CETTE transaction :
  --    « client » était faux), sa voie, la version des CGU acceptée, et le FAIT que le téléphone est vérifié — un
  --    booléen, JAMAIS le numéro (décision de Youssef, 01/10/2026) : le grand livre ne s'efface jamais, il ne porte
  --    aucune donnée personnelle, même partielle. Le numéro vit dans `users.phone`, sur le compte.
  perform public.journaliser(
    v_piece, 'compte_cree', 'reussi',
    case when v_voie = 'administrateur' then 'systeme' else 'utilisateur' end,
    case when v_voie = 'administrateur' then null else new.id end,
    case when v_voie = 'administrateur' then null else v_user_type end,
    v_domain_id, 'users', new.id,
    jsonb_build_object('type_de_compte', case when v_voie = 'administrateur' then 'admin' else v_user_type end,
                       'voie_declaree', v_voie, 'cgu_version', v_cgu, 'telephone_verifie', v_tel is not null),
    null::uuid, null::numeric, null::text);

  -- ⑥ CE QUE LA VOIE CRÉE, ET SA LIGNE SŒUR SOUS LA MÊME PIÈCE — tout, ou rien.
  if v_voie = 'inscription_expert' then
    -- Deux lignes qui ne se distinguaient en rien (décision de Youssef, recette staging du 30/09/2026) :
    -- `expert_inscrit` portait le compte et la version des CGU, que `compte_cree` porte déjà. Elle dit
    -- désormais ce qui appartient à l'EXPERT — son PROFIL, sa branche, ses spécialités — comme
    -- `organisation_preinscrite` dit l'organisation et `invitation_acceptee` l'invitation.
    perform public.journaliser(
      v_piece, 'expert_inscrit', 'reussi', 'utilisateur',
      new.id, v_user_type, v_domain_id, 'profiles', v_profil,
      jsonb_build_object('branch_id', (v_meta ->> 'branch_id')::uuid,
                         'nb_specialites', case when v_spec is null then 0 else 1 end,
                         'specialite_autre', nullif(btrim(coalesce(v_meta ->> 'speciality_other', '')), '') is not null),
      null::uuid, null::numeric, null::text);

  elsif v_voie = 'preinscription_organisation' then
    v_dom_mail := split_part(lower(btrim(new.email)), '@', 2);
    v_public := exists (select 1 from public.public_email_domains p where lower(p.email_domain) = v_dom_mail and p.active);
    v_numero := nullif(public.numero_identification_normalise(v_meta ->> 'siren'), '');
    begin
      v_org := public.creer_organisation_avec_admin(
        new.id, v_domain_id, v_meta ->> 'org_type', btrim(v_meta ->> 'company_name'), btrim(v_meta ->> 'country_code'),
        v_numero, nullif(btrim(coalesce(v_meta ->> 'vat_number', '')), ''),
        case when v_public then null else v_dom_mail end,
        'pending_provider_check');
    exception when unique_violation then
      get stacked diagnostics v_contrainte = constraint_name;
      raise exception 'inscription refusee : %',
        case when v_contrainte like '%siren%' then 'siren_taken'
             when v_contrainte like '%email_domain%' then 'email_domain_taken'
             else 'organisation_deja_inscrite' end
        using errcode = 'IN010';
    end;
    perform public.journaliser(
      v_piece, 'organisation_preinscrite', 'reussi', 'utilisateur',
      new.id, v_user_type, v_domain_id, 'organizations', v_org,
      jsonb_build_object('org_type', v_meta ->> 'org_type', 'domaine_public', v_public),
      null::uuid, null::numeric, null::text);

  elsif v_voie = 'invitation' then
    -- L'adresse d'un invité est confirmée d'office par sa route (le lien reçu prouve la boîte).
    -- Non confirmée, l'acceptation répondrait « email_mismatch » : un motif FAUX (§E.22).
    if not v_confirme then
      raise exception 'inscription refusee : invitation_non_confirmee' using errcode = 'IN010';
    end if;
    -- L'acceptation rejoue ses gardes sous verrou et écrit `invitation_acceptee` (§D.26) ;
    -- les statuts admis sont ceux que la route a signés (aucun littéral de statut ici).
    v_inv := public.accepter_invitation(
      v_piece, null, 'utilisateur', new.id, v_user_type, v_domain_id,
      (v_meta ->> 'invitation_id')::uuid, string_to_array(v_meta ->> 'invitation_statuts', ','));
    if v_inv ->> 'issue' is distinct from 'acceptee' then
      raise exception 'inscription refusee : %',
        case v_inv ->> 'issue' when 'expired' then 'invitation_expiree'
                               when 'email_mismatch' then 'invitation_email_mismatch'
                               else 'invitation_invalide' end
        using errcode = 'IN010';
    end if;

  elsif v_voie = 'administrateur' then
    v_acteur := nullif(btrim(coalesce(v_meta ->> 'acteur_id', '')), '');
    select r.id into v_admin_role from public.roles r where r.name = 'Admin' and r.active limit 1;
    v_promotion := public.promouvoir_administrateur(
      v_piece, null,
      case when v_acteur is null then 'systeme' else 'administrateur' end,
      v_acteur::uuid,
      case when v_acteur is null then null else 'admin' end,
      new.id, v_admin_role);
    if v_promotion is distinct from 'reussi' then
      raise exception 'inscription refusee : administrateur_non_promu' using errcode = 'AD001';
    end if;
  end if;

  return new;
end;
$fn$;


-- ── LES LISTES BLANCHES : chaque ligne déclare ce qu'elle peut porter (GL004) ──
update public.grand_livre_actions
   set cles_detail = array['type_de_compte', 'voie_declaree', 'cgu_version', 'telephone_verifie']::text[]
 where code = 'compte_cree';
update public.grand_livre_actions
   set cles_detail = array['branch_id', 'nb_specialites', 'specialite_autre']::text[]
 where code = 'expert_inscrit';


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_corps text;
begin
  if (select a.cles_detail from public.grand_livre_actions a where a.code = 'compte_cree')
       is distinct from array['type_de_compte', 'voie_declaree', 'cgu_version', 'telephone_verifie']::text[]
     or (select a.cles_detail from public.grand_livre_actions a where a.code = 'expert_inscrit')
       is distinct from array['branch_id', 'nb_specialites', 'specialite_autre']::text[] then
    raise exception 'postcondition NON TENUE : listes blanches de compte_cree et expert_inscrit';
  end if;
  select p.prosrc into v_corps from pg_proc p where p.oid = to_regprocedure('public.handle_new_user()');
  if v_corps is null
     or strpos(v_corps, 'preuve_inscription_refus(') = 0
     or strpos(v_corps, 'preuve_inscription_refus(') > strpos(v_corps, 'into v_miroir')
     or strpos(v_corps, 'public.inscription_refus(new.email') > strpos(v_corps, 'into v_miroir') then
    raise exception 'postcondition NON TENUE : handle_new_user ne verifie plus la preuve et les regles avant d ecrire';
  end if;
  raise notice 'postcondition tenue : listes blanches de compte_cree et expert_inscrit, handle_new_user verifie avant d ecrire ; chaque voie et ses deux lignes distinctes sont prouvees par tests/database/grand_livre/inscriptions.test.sql et tests/database/inscription/compte_cree.test.sql';
end
$post$;
