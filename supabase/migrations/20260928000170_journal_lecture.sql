-- ════════════════════════════════════════════════════════════════════════════
--  LA LECTURE DU GRAND LIVRE — RÉSERVÉE À L'ADMINISTRATEUR, EN BASE, PAR DEUX
--  FONCTIONS BORNÉES. Aucune politique : la table reste fermée à tout client.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — l'écran /admin/journal et ses deux
--  routes les appellent dès ce commit. N'ajoute que deux fonctions de lecture.
--  Rejouable.
--
--  LE MANDAT (phase B, 2.6) : l'écran du grand livre — filtres (type, acteur,
--  écosystème, période, statut, origine), la pièce complète depuis une ligne,
--  le lien vers l'objet, les montants avec leur devise, le nom rejoint À LA
--  LECTURE (jamais stocké) ou « compte supprimé », une pagination RÉELLE, une
--  troncature annoncée, le nettoyage visible même sous un filtre.
--
--  LA SÉCURITÉ EST EN BASE. `grand_livre` n'a aucune politique RLS et seul
--  `service_role` peut le lire (socle). Les deux fonctions sont SECURITY DEFINER,
--  fermées au navigateur (revoke), et VÉRIFIENT que l'appelant nommé est un
--  administrateur ACTIF (AD002) — la route l'a déjà vérifié, la base ne le
--  suppose pas. Aucune `FOR ALL`, aucune politique ajoutée.
--
--  BORNÉES. La liste rend au plus 200 lignes par page (défaut 50), la pièce au
--  plus 500 lignes et 50 lignes par sous-journal — et chacune DIT si elle a
--  tronqué (`suivant`, `tronquee`), l'écran l'annonce (§E.26).
--
--  LA PAGINATION EST UN CURSEUR, PAS UN NUMÉRO. Clé (horodatage, id) décroissante :
--  stable quand des lignes arrivent pendant la lecture, servie par l'index
--  (horodatage desc) et ses variantes filtrées. L'identifiant ne sert qu'au
--  curseur : l'écran ne l'affiche JAMAIS — `grand_livre.id` a des trous normaux
--  (sondes annulées), montré en suite il ferait croire à une ligne manquante.
--
--  LE NETTOYAGE RESTE VISIBLE SOUS TOUT FILTRE. Les lignes de la famille
--  `journal` (le nettoyage du grand livre lui-même) échappent aux filtres de
--  type, d'acteur, d'écosystème, de statut et d'origine — seule la PÉRIODE les
--  borne. Un filtre qui cacherait une suppression du journal permettrait de
--  nettoyer sans être vu.
--
--  LE NOM EST REJOINT À LA LECTURE. Le grand livre ne porte que des identifiants
--  (§D.26) ; le nom de l'acteur vient de `users` au moment où l'administrateur
--  regarde. Compte disparu ou anonymisé : `acteur_supprime = true`, pas de nom.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.lire_grand_livre(
  p_admin_id       uuid,
  p_familles       text[]      default null,
  p_types          text[]      default null,
  p_acteur_id      uuid        default null,
  p_ecosysteme_id  uuid        default null,
  p_du             timestamptz default null,
  p_au             timestamptz default null,
  p_statuts        text[]      default null,
  p_origines       text[]      default null,
  p_limite         integer     default 50,
  p_apres_horodatage timestamptz default null,
  p_apres_id       bigint      default null
) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $fn$
declare
  v_limite integer := least(greatest(coalesce(p_limite, 50), 1), 200);
  v_lignes jsonb;
  v_n      integer;
  v_dernier record;
begin
  if not exists (select 1 from public.users a where a.id = p_admin_id and a.user_type = 'admin' and a.status = 'active') then
    raise exception 'lire_grand_livre : % n est pas un administrateur actif', p_admin_id using errcode = 'AD002';
  end if;
  if (p_apres_horodatage is null) <> (p_apres_id is null) then
    raise exception 'lire_grand_livre : curseur incomplet' using errcode = '22023';
  end if;

  with page as (
    select g.*, a.famille
      from public.grand_livre g
      join public.grand_livre_actions a on a.code = g.type_action
     where (p_du is null or g.horodatage >= p_du)
       and (p_au is null or g.horodatage < p_au)
       and (p_apres_horodatage is null
            or (g.horodatage, g.id) < (p_apres_horodatage, p_apres_id))
       and (a.famille = 'journal' or (
                 (p_familles is null or a.famille = any (p_familles))
             and (p_types is null or g.type_action = any (p_types))
             and (p_acteur_id is null or g.acteur_id = p_acteur_id)
             and (p_ecosysteme_id is null or g.ecosysteme_id = p_ecosysteme_id)
             and (p_statuts is null or g.statut = any (p_statuts))
             and (p_origines is null or g.origine = any (p_origines))))
     order by g.horodatage desc, g.id desc
     limit v_limite + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'curseur_id', p.id,
           'horodatage', p.horodatage,
           'piece', p.piece,
           'piece_origine', p.piece_origine,
           'type_action', p.type_action,
           'famille', p.famille,
           'statut', p.statut,
           'origine', p.origine,
           'acteur_id', p.acteur_id,
           'acteur_type', p.acteur_type,
           'acteur_nom', case when u.id is not null and u.anonymized_at is null
                              then nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') end,
           'acteur_supprime', p.acteur_id is not null and (u.id is null or u.anonymized_at is not null),
           'ecosysteme_id', p.ecosysteme_id,
           'ecosysteme_nom', d.name,
           'sujet_type', p.sujet_type,
           'sujet_id', p.sujet_id,
           'detail', p.detail,
           'cout_usd', p.cout_usd,
           'unite_facturee', p.unite_facturee
         ) order by p.horodatage desc, p.id desc), '[]'::jsonb),
         count(*)
    into v_lignes, v_n
    from page p
    left join public.users u on u.id = p.acteur_id
    left join public.domains d on d.id = p.ecosysteme_id;

  -- Une ligne de plus que la page : il y a une suite, et on le DIT.
  if v_n > v_limite then
    v_lignes := v_lignes - v_limite;
    select (v_lignes -> (v_limite - 1) ->> 'horodatage')::timestamptz as h,
           (v_lignes -> (v_limite - 1) ->> 'curseur_id')::bigint as i
      into v_dernier;
    return jsonb_build_object('lignes', v_lignes, 'limite', v_limite,
                              'suivant', jsonb_build_object('horodatage', v_dernier.h, 'id', v_dernier.i));
  end if;
  return jsonb_build_object('lignes', v_lignes, 'limite', v_limite, 'suivant', null);
end;
$fn$;

revoke all on function public.lire_grand_livre(uuid, text[], text[], uuid, uuid, timestamptz, timestamptz, text[], text[], integer, timestamptz, bigint)
  from public, anon, authenticated;
grant execute on function public.lire_grand_livre(uuid, text[], text[], uuid, uuid, timestamptz, timestamptz, text[], text[], integer, timestamptz, bigint)
  to service_role;


-- ── LA PIÈCE COMPLÈTE, DEPUIS UNE DE SES LIGNES ──────────────────────────────
--  Toutes ses lignes (500 au plus), les pièces qui la REFERENCENT (rejeux,
--  contrepassations), et ce que les cinq sous-journaux portent sous elle —
--  identifiants et faits, jamais le détail d'audit (il peut porter une valeur
--  d'avant la liste blanche).
create or replace function public.lire_piece(
  p_admin_id uuid,
  p_piece    uuid
) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $fn$
declare
  v_lignes jsonb;
  v_n      integer;
begin
  if not exists (select 1 from public.users a where a.id = p_admin_id and a.user_type = 'admin' and a.status = 'active') then
    raise exception 'lire_piece : % n est pas un administrateur actif', p_admin_id using errcode = 'AD002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'horodatage', g.horodatage,
           'piece', g.piece,
           'piece_origine', g.piece_origine,
           'type_action', g.type_action,
           'famille', a.famille,
           'statut', g.statut,
           'origine', g.origine,
           'acteur_id', g.acteur_id,
           'acteur_type', g.acteur_type,
           'acteur_nom', case when u.id is not null and u.anonymized_at is null
                              then nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') end,
           'acteur_supprime', g.acteur_id is not null and (u.id is null or u.anonymized_at is not null),
           'ecosysteme_id', g.ecosysteme_id,
           'ecosysteme_nom', d.name,
           'sujet_type', g.sujet_type,
           'sujet_id', g.sujet_id,
           'detail', g.detail,
           'cout_usd', g.cout_usd,
           'unite_facturee', g.unite_facturee
         ) order by g.horodatage, g.id), '[]'::jsonb), count(*)
    into v_lignes, v_n
    from (select * from public.grand_livre x where x.piece = p_piece order by x.horodatage, x.id limit 501) g
    join public.grand_livre_actions a on a.code = g.type_action
    left join public.users u on u.id = g.acteur_id
    left join public.domains d on d.id = g.ecosysteme_id;

  return jsonb_build_object(
    'piece', p_piece,
    'lignes', case when v_n > 500 then v_lignes - 500 else v_lignes end,
    'tronquee', v_n > 500,
    'referencee_par', (select coalesce(jsonb_agg(distinct r.piece), '[]'::jsonb)
                         from (select g.piece from public.grand_livre g where g.piece_origine = p_piece limit 50) r),
    'sous_journaux', jsonb_build_object(
      'audit_logs', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'action', x.action, 'entity_type', x.entity_type,
                                                                  'entity_id', x.entity_id, 'horodatage', x.created_at) order by x.created_at), '[]'::jsonb)
                       from (select * from public.audit_logs l where l.piece = p_piece order by l.created_at limit 50) x),
      'ai_spend_events', (select coalesce(jsonb_agg(jsonb_build_object('provider', x.provider, 'action', x.action, 'units', x.units,
                                                                       'cost_usd', x.cost_usd, 'horodatage', x.created_at) order by x.created_at), '[]'::jsonb)
                            from (select * from public.ai_spend_events e where e.piece = p_piece order by e.created_at limit 50) x),
      'stripe_events', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'type', x.type, 'status', x.status,
                                                                     'horodatage', x.received_at) order by x.received_at), '[]'::jsonb)
                          from (select * from public.stripe_events s where s.piece = p_piece order by s.received_at limit 50) x),
      'cron_run_log', (select coalesce(jsonb_agg(jsonb_build_object('job_name', x.job_name, 'trigger_source', x.trigger_source,
                                                                    'http_status', x.http_status, 'horodatage', x.requested_at) order by x.requested_at), '[]'::jsonb)
                         from (select * from public.cron_run_log c where c.piece = p_piece order by c.requested_at limit 50) x),
      'notifications', (select coalesce(jsonb_agg(jsonb_build_object('type', x.type, 'channel', x.channel, 'status', x.status,
                                                                     'horodatage', x.created_at) order by x.created_at), '[]'::jsonb)
                          from (select * from public.notifications n where n.piece = p_piece order by n.created_at limit 50) x)
    ));
end;
$fn$;

revoke all on function public.lire_piece(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lire_piece(uuid, uuid) to service_role;


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_f text;
begin
  foreach v_f in array array[
    'public.lire_grand_livre(uuid, text[], text[], uuid, uuid, timestamptz, timestamptz, text[], text[], integer, timestamptz, bigint)',
    'public.lire_piece(uuid, uuid)'] loop
    if to_regprocedure(v_f) is null then
      raise exception 'postcondition NON TENUE : % absente', v_f;
    end if;
    if has_function_privilege('authenticated', v_f, 'execute') or has_function_privilege('anon', v_f, 'execute') then
      raise exception 'postcondition NON TENUE : % executable depuis le navigateur', v_f;
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = to_regprocedure(v_f)) then
      raise exception 'postcondition NON TENUE : % n est pas SECURITY DEFINER', v_f;
    end if;
  end loop;
  if exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'grand_livre') then
    raise exception 'postcondition NON TENUE : une politique RLS existe sur grand_livre — la lecture passe par les fonctions bornees';
  end if;
  raise notice 'postcondition tenue : lire_grand_livre et lire_piece presentes, SECURITY DEFINER, fermees au navigateur, aucune politique sur grand_livre ; les filtres, le curseur, le nettoyage toujours visible, le nom rejoint et AD002 sont prouves par tests/database/grand_livre/lecture.test.sql';
end
$post$;
