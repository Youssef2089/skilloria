-- ════════════════════════════════════════════════════════════════════════════
--  TOUTE CRÉATION DE COMPTE ÉCRIT SA LIGNE AU GRAND LIVRE — PAR SON SEUL
--  PASSAGE OBLIGÉ, `handle_new_user`, DANS LA MÊME TRANSACTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Elle ajoute une action, une
--  fonction de lecture (`taxonomie_inscription_refus`) et recrée la fonction
--  du trigger d'inscription. Le code en ligne continue de fonctionner : il ne
--  met pas de pièce dans les métadonnées, et la ligne s'écrit alors avec une
--  pièce née ici (voie « aucune »). Le code de ce commit, lui, APPELLE
--  `taxonomie_inscription_refus` : elle doit exister avant lui. Rejouable.
--
--  ┌─ LA DÉCISION (Youssef, 28/09/2026, décision A de la phase B) ───────────┐
--  │ Un compte naît par plusieurs voies : l'inscription d'un expert, la      │
--  │ préinscription d'une organisation, l'invitation d'un membre (dans le    │
--  │ NAVIGATEUR, `supabase.auth.signUp`), la création d'un administrateur —  │
--  │ et l'appel DIRECT à l'API d'authentification avec la clé publique, qui  │
--  │ ne passe par aucune de nos routes. Le SEUL point commun à toutes est    │
--  │ l'insertion dans `auth.users`, donc ce trigger. C'est lui qui écrit la  │
--  │ ligne : la porte unique (`journaliser()`) reste la seule porte, et      │
--  │ toute création de compte a UN écrivain.                                 │
--  └──────────────────────────────────────────────────────────────────────────┘
--
--  CE N'EST PAS UN « TRIGGER D'ÉCRITURE » AU SENS DU SOCLE (§D.26 : « jamais de
--  trigger d'écriture »). Ce que le socle interdit, c'est un trigger qui
--  DÉDUIT une ligne d'une modification de table, loin du geste, sans pièce ni
--  acteur (`set local` ne survit pas à une requête PostgREST). Ici, la fonction
--  EST le geste : elle fait l'écriture métier (le miroir `public.users`, le
--  profil d'un expert) et écrit sa ligne dans la même transaction, comme une
--  RPC métier. L'exception et sa raison : docs/architecture.md §D.26.
--
--  LA RÈGLE DU NOM TRANCHE : UNE ACTION, `compte_cree`, LA VOIE EN DÉTAIL.
--  Les métadonnées d'inscription (`raw_user_meta_data`) sont écrites par
--  l'APPELANT — n'importe qui, avec la clé publique. Le trigger ne peut donc
--  pas SAVOIR par quelle voie un compte arrive ; il sait qu'un compte est créé,
--  de quel type, dans quel écosystème. Une action par voie (« expert inscrit
--  par le formulaire ») afficherait comme un fait ce qui n'est qu'une
--  déclaration : filtrer sur elle rendrait aussi les appels directs qui s'en
--  réclament — un chiffre juste sous une étiquette fausse (§E.24). Le nom dit
--  ce que le trigger sait ; le détail dit ce que l'appelant DÉCLARE
--  (`voie_declaree`) ; la PREUVE qu'une route est passée est la ligne que cette
--  route écrit elle-même, sous la MÊME pièce (`expert_inscrit`,
--  `organisation_preinscrite`, `administrateur_cree`). Un `compte_cree` sans
--  ligne sœur sous sa pièce est un compte né hors de nos routes.
--
--  LA PIÈCE ET L'ORIGINE
--   · l'appelant met la pièce du geste dans les métadonnées (`piece`, un uuid) :
--     la ligne la porte, origine `utilisateur`, acteur le compte créé — sauf la
--     voie `administrateur`, où la personne qui agit est un administrateur que
--     le trigger ne connaît pas : origine `systeme`, sans acteur (l'acteur est
--     sur la ligne `administrateur_cree`, même pièce) ;
--   · pas de pièce : elle naît ICI (`gen_random_uuid()`), origine `systeme`,
--     acteur le compte créé — c'est l'appel direct, et l'origine le dit.
--
--  CE QUI EST REFUSÉ (nouveau code, IN006) : une voie déclarée hors de la
--  liste ou incohérente avec le rôle (un expert qui se dit « préinscription
--  d'organisation »), une pièce qui n'est pas un uuid. Une étiquette fausse ne
--  s'écrit pas ; un appel qui ne déclare RIEN reste admis (voie « aucune »).
--
--  LA RÈGLE BRANCHE/SPÉCIALITÉ S'ÉCRIT UNE FOIS : `taxonomie_inscription_refus`,
--  appelée par ce trigger ET par la route register-expert (elle la dupliquait).
--  Elle rend `null` (admis), `invalid_branch` ou `invalid_speciality` — les
--  codes que la route rendait déjà.
--
--  CE QUI N'ÉCRIT PAS DE LIGNE, ET POURQUOI : un refus du trigger (IN001 à
--  IN006) annule l'insertion dans `auth.users` ET toute ligne écrite dans la
--  même transaction. Aucun compte n'existe, rien n'a changé ; la route qui a
--  appelé rend son code (`create_user_failed`).
--
--  LES CODES
--    IN001  rôle d'inscription inconnu ou absent                (inchangé)
--    IN002  domain_slug absent des métadonnées                  (inchangé)
--    IN003  aucun écosystème ACTIF pour ce slug                 (inchangé)
--    IN004  rôle commercial « Gratuit » actif introuvable       (inchangé)
--    IN005  branche ou spécialité hors de l'écosystème          (inchangé, règle déplacée)
--    IN006  voie déclarée inconnue ou incohérente avec le rôle, ou pièce qui n'est pas un uuid
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('compte_cree',                'compte',         null,     'journal.actions.compte_cree')
on conflict (code) do nothing;

update public.grand_livre_actions
   set cles_detail = array['type_de_compte', 'voie_declaree']::text[]
 where code = 'compte_cree';


-- ── LA RÈGLE BRANCHE/SPÉCIALITÉ, UNE FOIS ────────────────────────────────────
--  Une branche ACTIVE de l'écosystème ; une spécialité ACTIVE de l'écosystème,
--  et de CETTE branche quand une branche est donnée. `null` = admis.
create or replace function public.taxonomie_inscription_refus(
  p_domain_id     uuid,
  p_branch_id     uuid,
  p_speciality_id uuid
) returns text
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select case
    when p_branch_id is not null and not exists (
           select 1 from public.branches b
            where b.id = p_branch_id and b.domain_id = p_domain_id and b.active)
      then 'invalid_branch'
    when p_speciality_id is not null and not exists (
           select 1 from public.specialities s
            where s.id = p_speciality_id and s.domain_id = p_domain_id and s.active
              and (p_branch_id is null or s.branch_id = p_branch_id))
      then 'invalid_speciality'
  end
$fn$;

revoke all on function public.taxonomie_inscription_refus(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.taxonomie_inscription_refus(uuid, uuid, uuid) to service_role;


-- ── LE TRIGGER D'INSCRIPTION ─────────────────────────────────────────────────
--  Repris À L'IDENTIQUE de inscription_specialites (rôles, refus IN001 à IN005,
--  colonnes écrites, `on conflict do nothing`), plus : la règle de taxonomie
--  par la fonction unique, la voie et la pièce lues et vérifiées (IN006), la
--  ligne `compte_cree` par journaliser().
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_meta             jsonb;
  v_role_front       text;
  v_user_type        text;
  v_expert_type      text;
  v_domain_slug      text;
  v_domain_id        uuid;
  v_role_id          uuid;
  v_firstname        text;
  v_lastname         text;
  v_specialty        text;
  v_branch_id        uuid;
  v_speciality_id    uuid;
  v_speciality_other text;
  v_refus_taxonomie  text;
  v_voie             text;
  v_piece_brute      text;
  v_piece            uuid;
  v_origine          text;
  v_acteur_id        uuid;
  v_acteur_type      text;
  v_miroir           uuid;
begin
  v_meta             := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role_front       := v_meta ->> 'role';
  v_domain_slug      := nullif(trim(v_meta ->> 'domain_slug'), '');
  v_firstname        := v_meta ->> 'firstname';
  v_lastname         := v_meta ->> 'lastname';
  v_specialty        := v_meta ->> 'specialty';
  v_branch_id        := nullif(trim(v_meta ->> 'branch_id'), '')::uuid;
  v_speciality_id    := nullif(trim(v_meta ->> 'speciality_id'), '')::uuid;
  v_speciality_other := nullif(trim(v_meta ->> 'speciality_other'), '');
  v_voie             := nullif(trim(v_meta ->> 'voie'), '');
  v_piece_brute      := nullif(trim(v_meta ->> 'piece'), '');

  -- Le rôle d'inscription (mot du front) → type de compte en base.
  case v_role_front
    when 'expert'     then v_user_type := 'expert_freelance'; v_expert_type := 'freelance';
    when 'cdi'        then v_user_type := 'expert_cdi';       v_expert_type := 'cdi';
    when 'entreprise' then v_user_type := 'client';           v_expert_type := null;
    when 'cabinet'    then v_user_type := 'cabinet';          v_expert_type := null;
    else                   v_user_type := null;               v_expert_type := null;
  end case;

  -- Un rôle inconnu LÈVE : jamais de compte auth sans miroir (§E.23).
  if v_user_type is null then
    raise exception '[handle_new_user] role d inscription inconnu ou absent (« % ») - inscription annulee pour %', v_role_front, new.id
      using errcode = 'IN001';
  end if;

  if v_domain_slug is null then
    raise exception '[handle_new_user] domain_slug manquant dans les metadonnees d inscription - inscription annulee pour %', new.id
      using errcode = 'IN002';
  end if;

  select d.id into v_domain_id
    from public.domains d
   where d.slug = v_domain_slug and d.active
   limit 1;
  if v_domain_id is null then
    raise exception '[handle_new_user] ecosysteme actif introuvable pour slug="%" - inscription annulee pour %', v_domain_slug, new.id
      using errcode = 'IN003';
  end if;

  select r.id into v_role_id
    from public.roles r
   where r.name = 'Gratuit' and r.active
   limit 1;
  if v_role_id is null then
    raise exception '[handle_new_user] role "Gratuit" actif introuvable - inscription annulee pour %', new.id
      using errcode = 'IN004';
  end if;

  -- La taxonomie d'un expert, par la règle UNIQUE (la route register-expert appelle la même).
  if v_expert_type is not null then
    v_refus_taxonomie := public.taxonomie_inscription_refus(v_domain_id, v_branch_id, v_speciality_id);
    if v_refus_taxonomie is not null then
      raise exception '[handle_new_user] % (branche %, specialite %) dans l ecosysteme % - inscription annulee pour %',
        v_refus_taxonomie, v_branch_id, v_speciality_id, v_domain_slug, new.id
        using errcode = 'IN005';
    end if;
  end if;

  -- La voie DÉCLARÉE : dans la liste, et cohérente avec le rôle. Absente, elle reste absente.
  if v_voie is not null and not (
       (v_voie = 'inscription_expert' and v_expert_type is not null)
    or (v_voie in ('preinscription_organisation', 'invitation', 'administrateur') and v_expert_type is null)) then
    raise exception '[handle_new_user] voie declaree « % » inconnue ou incoherente avec le role % - inscription annulee pour %', v_voie, v_role_front, new.id
      using errcode = 'IN006';
  end if;
  -- La pièce du geste, quand l'appelant l'a mise : un uuid, sinon refus (une pièce illisible ne relie rien).
  if v_piece_brute is not null then
    if v_piece_brute !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception '[handle_new_user] piece « % » illisible (uuid attendu) - inscription annulee pour %', left(v_piece_brute, 40), new.id
        using errcode = 'IN006';
    end if;
    v_piece := v_piece_brute::uuid;
  end if;

  -- Le miroir public.users. Toute erreur remonte et annule l'inscription.
  insert into public.users (
    id, email, role_id, domain_id, user_type,
    status, email_verified, is_verified,
    first_name, last_name, locale
  ) values (
    new.id, new.email, v_role_id, v_domain_id, v_user_type,
    'draft', coalesce(new.email_confirmed_at is not null, false), false,
    v_firstname, v_lastname, 'fr'
  )
  on conflict (id) do nothing
  returning id into v_miroir;

  -- Le profil d'un expert (freelance et CDI), la spécialité dans speciality_ids.
  if v_expert_type is not null then
    insert into public.profiles (
      user_id, domain_id, expert_type, title, visible,
      profile_score, languages, skills, certifications,
      branch_id, speciality_ids, speciality_other
    ) values (
      new.id, v_domain_id, v_expert_type, v_specialty, false,
      0, array['fr']::text[], '{}'::text[], '[]'::jsonb,
      v_branch_id,
      case when v_speciality_id is null then '{}'::uuid[] else array[v_speciality_id] end,
      v_speciality_other
    )
    on conflict (user_id) do nothing;
  end if;

  -- LA LIGNE — seulement si le miroir est NÉ ici. Un miroir déjà présent (conflit sur
  -- l'identifiant) n'est pas une création : rien n'est écrit, et rien ne s'invente.
  if v_miroir is not null then
    if v_piece is null then
      v_piece       := gen_random_uuid();
      v_origine     := 'systeme';
      v_acteur_id   := new.id;
      v_acteur_type := v_user_type;
    elsif v_voie = 'administrateur' then
      v_origine     := 'systeme';
      v_acteur_id   := null;
      v_acteur_type := null;
    else
      v_origine     := 'utilisateur';
      v_acteur_id   := new.id;
      v_acteur_type := v_user_type;
    end if;
    perform public.journaliser(
      v_piece, 'compte_cree', 'reussi', v_origine,
      v_acteur_id, v_acteur_type, v_domain_id, 'users', new.id,
      jsonb_build_object('type_de_compte', v_user_type, 'voie_declaree', v_voie),
      null::uuid, null::numeric, null::text);
  end if;

  return new;
end;
$fn$;


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
--  Aucune sonde : le comportement (chaque voie, l'appel direct sans pièce, IN006)
--  est prouvé par tests/database/inscription/compte_cree.test.sql, sur des comptes
--  FABRIQUÉS.
do $post$
declare
  v_a record;
begin
  select a.famille, a.statut_impose, a.cles_detail into v_a
    from public.grand_livre_actions a where a.code = 'compte_cree';
  if not found then
    raise exception 'postcondition NON TENUE : compte_cree absente de la liste fermee';
  end if;
  if v_a.famille is distinct from 'compte' or v_a.statut_impose is not null
     or v_a.cles_detail is distinct from array['type_de_compte', 'voie_declaree']::text[] then
    raise exception 'postcondition NON TENUE : compte_cree [famille %, statut %, cles %]', v_a.famille, v_a.statut_impose, v_a.cles_detail;
  end if;
  if to_regprocedure('public.taxonomie_inscription_refus(uuid, uuid, uuid)') is null then
    raise exception 'postcondition NON TENUE : taxonomie_inscription_refus(uuid, uuid, uuid) absente';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'handle_new_user'
                    and p.prosrc ~ 'public\.journaliser\(' and p.prosrc ~ 'taxonomie_inscription_refus\(') then
    raise exception 'postcondition NON TENUE : handle_new_user n appelle pas journaliser() et la regle unique de taxonomie';
  end if;
  if has_function_privilege('authenticated', 'public.taxonomie_inscription_refus(uuid, uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.taxonomie_inscription_refus(uuid, uuid, uuid)', 'execute') then
    raise exception 'postcondition NON TENUE : taxonomie_inscription_refus executable depuis le navigateur';
  end if;
  raise notice 'postcondition tenue : compte_cree dans la liste fermee (famille compte, cles type_de_compte et voie_declaree), handle_new_user journalise et appelle la regle unique, taxonomie_inscription_refus fermee au navigateur ; chaque voie est prouvee par tests/database/inscription/compte_cree.test.sql';
end
$post$;
