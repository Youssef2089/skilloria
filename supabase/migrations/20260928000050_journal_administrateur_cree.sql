-- ════════════════════════════════════════════════════════════════════════════
--  LA CRÉATION D'UN ADMINISTRATEUR S'ÉCRIT AU GRAND LIVRE — LA PROMOTION ET SA
--  LIGNE DANS UNE SEULE FONCTION, SOUS LA PIÈCE DE `compte_cree`.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — `app/api/admin/create-admin` et
--  `scripts/creer-premier-administrateur.mjs` appellent `promouvoir_administrateur`
--  dès ce commit. Ajoute seulement : une action, une fonction. Rejouable.
--
--  LE MANQUE (audit de la phase B, 2.1) : un administrateur naissait en deux
--  écritures — `createUser` (rôle de pont `entreprise`, le trigger crée un client),
--  puis la bascule `users.update(user_type admin)` — écrites par DEUX appelants
--  (la route, le script du jour zéro), et tracées par l'audit seul. La bascule est
--  désormais UNE fonction, qui écrit sa ligne dans la même transaction : un
--  écrivain pour l'action, deux appelants.
--
--  CE QUE LA FONCTION REFUSE, EN BASE (la sécurité ne tient pas à l'appelant) :
--   · AD002 — une origine `administrateur` dont l'acteur n'est pas un
--     administrateur (levée, sans ligne : l'appelant n'avait pas le droit) ;
--   · AD001 — un compte qui n'est pas un client FRAÎCHEMENT créé pour
--     l'administration : `user_type` client ET voie déclarée `administrateur`
--     à la création (métadonnées, décision A). Aucun compte existant ne se
--     promeut par ici. Ce refus-là s'ÉCRIT : la ligne est échouée (cause AD001),
--     l'appelant nettoie le compte.
--  La forme : succès dans le bloc, échec dans le gestionnaire, même pièce —
--  celle d'`effacer_adresses_ip()`. Rend 'reussi' ou 'echoue'.
--
--  CE QUE LA LIGNE PORTE : sujet le compte promu ; `jour_zero` (vrai sans acteur :
--  le premier administrateur n'a personne pour le créer, origine `systeme`) ;
--  échouée, la `cause` (un SQLSTATE). Acteur : l'administrateur qui crée (origine
--  `administrateur`). Famille `administration`.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('administrateur_cree',        'administration', null,     'journal.actions.administrateur_cree')
on conflict (code) do nothing;

update public.grand_livre_actions
   set cles_detail = array['jour_zero', 'cause']::text[]
 where code = 'administrateur_cree';


create or replace function public.promouvoir_administrateur(
  p_piece         uuid,
  p_piece_origine uuid,
  p_origine       text,
  p_acteur_id     uuid,
  p_acteur_type   text,
  p_user_id       uuid,
  p_role_id       uuid
) returns text
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_dom   uuid;
  v_cause text;
begin
  -- L'acteur d'une origine « administrateur » EST un administrateur actif — sinon rien ne s'écrit.
  if p_origine = 'administrateur' and not exists (
       select 1 from public.users a where a.id = p_acteur_id and a.user_type = 'admin' and a.status = 'active') then
    raise exception 'promouvoir_administrateur : l acteur % n est pas un administrateur actif', p_acteur_id
      using errcode = 'AD002';
  end if;
  select u.domain_id into v_dom from public.users u where u.id = p_user_id;

  begin
    update public.users u
       set user_type      = 'admin',
           role_id        = p_role_id,
           status         = 'active',
           email_verified = true
     where u.id = p_user_id
       and u.user_type = 'client'
       and exists (select 1 from auth.users a
                    where a.id = u.id and a.raw_user_meta_data ->> 'voie' = 'administrateur');
    if not found then
      raise exception 'promouvoir_administrateur : % n est pas un compte cree pour l administration', p_user_id
        using errcode = 'AD001';
    end if;
    perform public.journaliser(
      p_piece, 'administrateur_cree', 'reussi', p_origine,
      p_acteur_id, p_acteur_type, v_dom, 'users', p_user_id,
      jsonb_build_object('jour_zero', p_acteur_id is null),
      p_piece_origine, null::numeric, null::text);
    return 'reussi';
  exception when others then
    v_cause := sqlstate;
    perform public.journaliser(
      p_piece, 'administrateur_cree', 'echoue', p_origine,
      p_acteur_id, p_acteur_type, v_dom, 'users', p_user_id,
      jsonb_build_object('jour_zero', p_acteur_id is null, 'cause', v_cause),
      p_piece_origine, null::numeric, null::text);
    return 'echoue';
  end;
end;
$fn$;

revoke all on function public.promouvoir_administrateur(uuid, uuid, text, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.promouvoir_administrateur(uuid, uuid, text, uuid, text, uuid, uuid) to service_role;


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_a record;
begin
  select a.famille, a.statut_impose, a.cles_detail into v_a
    from public.grand_livre_actions a where a.code = 'administrateur_cree';
  if not found then
    raise exception 'postcondition NON TENUE : administrateur_cree absente de la liste fermee';
  end if;
  if v_a.famille is distinct from 'administration' or v_a.statut_impose is not null
     or v_a.cles_detail is distinct from array['jour_zero', 'cause']::text[] then
    raise exception 'postcondition NON TENUE : administrateur_cree [famille %, statut %, cles %]', v_a.famille, v_a.statut_impose, v_a.cles_detail;
  end if;
  if to_regprocedure('public.promouvoir_administrateur(uuid, uuid, text, uuid, text, uuid, uuid)') is null then
    raise exception 'postcondition NON TENUE : promouvoir_administrateur(uuid, uuid, text, uuid, text, uuid, uuid) absente';
  end if;
  if has_function_privilege('authenticated', 'public.promouvoir_administrateur(uuid, uuid, text, uuid, text, uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.promouvoir_administrateur(uuid, uuid, text, uuid, text, uuid, uuid)', 'execute') then
    raise exception 'postcondition NON TENUE : promouvoir_administrateur executable depuis le navigateur';
  end if;
  raise notice 'postcondition tenue : administrateur_cree dans la liste fermee (famille administration), promouvoir_administrateur presente et fermee au navigateur ; la promotion, le jour zero et les refus AD001, AD002 sont prouves par tests/database/grand_livre/administrateur_cree.test.sql';
end
$post$;
