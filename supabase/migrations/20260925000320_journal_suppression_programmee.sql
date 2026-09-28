-- ════════════════════════════════════════════════════════════════════════════
--  UNE SUPPRESSION PROGRAMMÉE S'ÉCRIT AU GRAND LIVRE — LE JALON ET LA LIGNE,
--  DANS LA MÊME TRANSACTION QUE LE TRANSFERT DU SIÈGE.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. `app/api/me/account/delete`
--  appelle la NOUVELLE signature dès ce commit. Rejouable.
--
--  LA FONCTION EXISTAIT DÉJÀ, et elle porte une garantie qu'on ne touche pas :
--  le transfert du siège d'administrateur plateforme et l'écriture du jalon
--  ont lieu dans la MÊME transaction — il n'existe aucun instant où la
--  plateforme serait sans administrateur. On ajoute la ligne du grand livre
--  DANS cette transaction : une suppression programmée sans trace, ou une
--  trace sans suppression, seraient deux moitiés du même défaut.
--
--  L'ANCIENNE SIGNATURE EST SUPPRIMÉE. `create or replace` ne remplace pas une
--  fonction dont les arguments changent : il en crée une SECONDE, et l'ancienne
--  — sans journal — resterait appelable. La postcondition vérifie qu'elle n'est
--  plus là (même parade que `set_default_package`, §B.2).
--
--  LES DEUX REFUS RESTENT DES REFUS, ET N'ÉCRIVENT RIEN : `introuvable` et
--  `dernier_admin` ne touchent aucune ligne — il n'y a pas de suppression à
--  journaliser. Le second est une COURSE tranchée par la clé étrangère ; la
--  route le traduit déjà en 409.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.programmer_suppression_compte(uuid, timestamptz);

create or replace function public.programmer_suppression_compte(
  p_piece         uuid,
  p_piece_origine uuid,
  p_origine       text,
  p_acteur_id     uuid,
  p_acteur_type   text,
  p_user_id       uuid,
  p_scheduled_at  timestamptz,
  p_grace_jours   integer
) returns text
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_u   record;
  v_res text;
  v_n   integer;
begin
  if p_piece is null then
    raise exception 'programmer_suppression_compte : la piece est obligatoire' using errcode = 'GL002';
  end if;

  select u.id, u.domain_id into v_u from public.users u where u.id = p_user_id;
  if not found then
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
    get diagnostics v_n = row_count;
    perform public.exiger_ecriture(v_n, 'programmer_suppression_compte : users');
  exception when foreign_key_violation then
    -- La cible occupe encore le siege : une transaction concurrente l'y a
    -- remise. On refuse proprement plutot que de laisser remonter une erreur
    -- technique. Aucune ligne de journal : rien n'a ete programme.
    return 'dernier_admin';
  end;

  perform public.journaliser(
    p_piece, 'suppression_programmee', 'reussi', p_origine,
    p_acteur_id, p_acteur_type, v_u.domain_id,
    'users', p_user_id,
    jsonb_build_object('echeance', p_scheduled_at, 'grace_jours', p_grace_jours),
    p_piece_origine, null::numeric, null::text);

  return 'ok';
end;
$fn$;

revoke all on function public.programmer_suppression_compte(uuid, uuid, text, uuid, text, uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.programmer_suppression_compte(uuid, uuid, text, uuid, text, uuid, timestamptz, integer)
  to service_role;

comment on function public.programmer_suppression_compte(uuid, uuid, text, uuid, text, uuid, timestamptz, integer) is
'Programme la suppression d''un compte, en garantissant qu''il reste au moins un
administrateur plateforme disponible, et ECRIT la ligne du grand livre dans la
MEME transaction (§D.26).

Rend ''ok'', ''dernier_admin'' (refus, aucune ecriture, aucune ligne) ou
''introuvable''.

Le transfert du siege, l''ecriture de deletion_scheduled_at et la ligne du
journal ont lieu ensemble : aucune fenetre ou la plateforme serait sans
administrateur, et aucune suppression programmee sans trace.';


update public.grand_livre_actions
   set cles_detail = array['echeance', 'grace_jours']::text[]
 where code = 'suppression_programmee';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_sautee boolean := false;  -- une sonde sautée rend la ligne finale PARTIELLE (§E.67)
  v_cles   text[];
  v_user   uuid;
  v_piece  uuid := gen_random_uuid();
  v_res    text;
  v_lignes integer;
begin
  if to_regprocedure('public.programmer_suppression_compte(uuid, timestamptz)') is not null then
    raise exception 'postcondition NON TENUE : l ancienne signature SANS journal est encore appelable';
  end if;
  if to_regprocedure('public.programmer_suppression_compte(uuid, uuid, text, uuid, text, uuid, timestamptz, integer)') is null then
    raise exception 'postcondition NON TENUE : programmer_suppression_compte manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'suppression_programmee';
  if v_cles is null or not (v_cles @> array['echeance', 'grace_jours']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de suppression_programmee est incomplete [vu : %]', v_cles;
  end if;

  -- SONDE — un compte réel non administrateur : suppression programmée, jalon
  -- et ligne relus ; un identifiant inconnu rend « introuvable » SANS ligne.
  select u.id into v_user
    from public.users u
   where u.deletion_scheduled_at is null and u.user_type is distinct from 'admin'
   limit 1;
  if v_user is null then
    raise notice 'postcondition : sonde programmer_suppression_compte SAUTEE — aucun compte non administrateur (base vierge)';
    v_sautee := true;
  else
    begin
      v_res := public.programmer_suppression_compte(v_piece, null::uuid, 'utilisateur', v_user, 'client',
                                                    v_user, now() + interval '90 days', 90);
      if v_res <> 'ok' then
        raise exception 'postcondition NON TENUE : la programmation n a pas abouti [%]', v_res;
      end if;
      if not exists (select 1 from public.users u where u.id = v_user and u.deletion_scheduled_at is not null) then
        raise exception 'postcondition NON TENUE : le jalon n est pas pose';
      end if;
      if not exists (select 1 from public.grand_livre g
                      where g.piece = v_piece and g.type_action = 'suppression_programmee' and g.statut = 'reussi'
                        and g.sujet_type = 'users' and g.sujet_id = v_user
                        and g.detail ->> 'echeance' is not null and (g.detail ->> 'grace_jours')::integer = 90) then
        raise exception 'postcondition NON TENUE : la ligne suppression_programmee manque ou ne porte pas son detail';
      end if;
      -- UN COMPTE INCONNU : refus, et AUCUNE ligne.
      v_res := public.programmer_suppression_compte(gen_random_uuid(), null::uuid, 'utilisateur', v_user, 'client',
                                                    gen_random_uuid(), now() + interval '90 days', 90);
      select count(*) into v_lignes from public.grand_livre g where g.type_action = 'suppression_programmee';
      if v_res <> 'introuvable' or v_lignes <> 1 then
        raise exception 'postcondition NON TENUE : un compte inconnu a ete programme ou journalise [% / % ligne(s)]', v_res, v_lignes;
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  -- SONDE — une donnée personnelle est REFUSÉE (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'suppression_programmee', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'users', gen_random_uuid(),
                               '{"echeance":"2026-12-24T00:00:00Z","email":"qui@exemple.fr"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : une adresse est entree dans suppression_programmee';
  exception when sqlstate 'GL004' then
    null;
  end;
  if v_sautee then
    raise notice 'postcondition PARTIELLE — une sonde SAUTEE faute de donnees, la fonction du geste n a PAS tourne ici ; seul le reste est verifie : suppression_programmee — ancienne signature supprimee, jalon et ligne naissent ensemble, un compte inconnu n ecrit rien, donnee personnelle refusee';
  else
    raise notice 'postcondition tenue : suppression_programmee — ancienne signature supprimee, jalon et ligne naissent ensemble, un compte inconnu n ecrit rien, donnee personnelle refusee';
  end if;
end
$post$;
