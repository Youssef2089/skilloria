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


-- ── POSTCONDITION — LA STRUCTURE ICI, LE COMPORTEMENT PAR LES TESTS (§E.77) ───────────
do $post$
-- LA STRUCTURE, ICI ; LE COMPORTEMENT, PAR LES TESTS (CLAUDE.md §G.4 ter, docs/pieges.md §E.77).
-- La sonde qui programmait la suppression d'un vrai compte est retirée (28/09/2026). Le geste — jalon et
-- ligne ensemble avec la durée de grâce, compte inconnu « introuvable » sans rien écrire — est prouvé par
-- supabase/tests/database/grand_livre/suppression_programmee.test.sql. Le compte inconnu reste sondé ici :
-- identifiants INVENTÉS, aucune ligne réelle touchée.
declare
  v_cles text[];
  v_res  text;
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
  begin
    v_res := public.programmer_suppression_compte(gen_random_uuid(), null::uuid, 'utilisateur', gen_random_uuid(), 'client',
                                                  gen_random_uuid(), now() + interval '90 days', 90);
    if v_res is distinct from 'introuvable' then
      raise exception 'postcondition NON TENUE : un compte inconnu a ete programme [%]', v_res;
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  begin
    perform public.journaliser(gen_random_uuid(), 'suppression_programmee', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'users', gen_random_uuid(),
                               '{"echeance":"2026-12-24T00:00:00Z","email":"qui@exemple.fr"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : une adresse est entree dans suppression_programmee';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : suppression_programmee — ancienne signature absente, nouvelle par types, liste blanche, compte inconnu introuvable, donnee personnelle refusee ; le geste est prouve par tests/database/grand_livre/suppression_programmee.test.sql';
end
$post$;
