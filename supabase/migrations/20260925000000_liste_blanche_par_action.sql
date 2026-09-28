-- ════════════════════════════════════════════════════════════════════════════
--  UNE LISTE BLANCHE PAR ACTION — et une écriture UNE FOIS, tenue par une clé.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : INDIFFÉRENT. Ajoute une colonne à `grand_livre_actions`,
--  une fonction pure, un index unique, et REMPLACE `journaliser()` (même
--  signature). Aucune ligne existante touchée ; les deux actions déjà branchées
--  reçoivent leur liste. Rejouable.
--
--  ┌─ LA CORRECTION DE CONCEPTION (l'architecte, 25/09/2026) ────────────────┐
--  │ Le filtre de données personnelles était une LISTE NOIRE :               │
--  │ `audit_logs_detail_sans_pii()` retire des clés CONNUES. Une clé nouvelle │
--  │ — « nom_contact », « email_facturation » — passerait. C'est exactement   │
--  │ la discipline qu'on remplace partout.                                    │
--  │                                                                          │
--  │ Pour le grand livre : UNE LISTE BLANCHE PAR ACTION. Chaque action        │
--  │ déclare les clés autorisées dans son détail ; journaliser() refuse toute │
--  │ autre clé, NOMMÉMENT (GL004). La liste noire reste en SECONDE barrière,  │
--  │ jamais en première.                                                      │
--  └──────────────────────────────────────────────────────────────────────────┘
--
--  LA FORME D'UNE CLÉ : un CHEMIN. `avant.vie_annonce_jours` pour une clé
--  imbriquée, `modifications[].champ` pour un élément de tableau, `cause` pour
--  une clé de premier niveau. Une valeur nulle compte pour sa clé
--  (`retroactivite` quand la garde n'a pas joué). Un objet ou un tableau VIDE
--  compte pour sa propre clé. La liste porte donc les FEUILLES du détail : une
--  clé imbriquée inconnue ne passe pas parce que son parent est connu.
--
--  ET UNE ACTION S'ÉCRIT UNE FOIS — par une CLÉ, pas par une discipline
--  (§E.31) : index unique (piece, type_action, sujet). La seconde écriture du
--  même geste, pour la même action, sur le même sujet, LÈVE (GL005). Un run du
--  moteur écrit ses étapes sous des types différents ; un message, une
--  candidature, un réglage ont chacun leur sujet. Une action qui s'écrirait
--  légitimement deux fois par geste n'existe pas : si elle apparaît, c'est la
--  conception qui doit le dire, pas l'index qui doit se taire.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── ① LA LISTE, PAR ACTION ──────────────────────────────────────────────────
alter table public.grand_livre_actions
  add column if not exists cles_detail text[] not null default '{}'::text[];

comment on column public.grand_livre_actions.cles_detail is
  'LISTE BLANCHE des chemins de cles autorises dans grand_livre.detail pour cette action '
  '(feuilles : a.b, liste[].c). journaliser() refuse toute autre cle (GL004). '
  'Miroir TypeScript : lib/journal/actions.ts (CLES_DETAIL), compare par diag-grand-livre.';

-- Les deux actions déjà branchées déclarent leur détail.
update public.grand_livre_actions
   set cles_detail = array[
     'avant.vie_annonce_jours', 'avant.fenetre_echange_jours', 'avant.invitation_jours', 'avant.conservation_ip_mois',
     'apres.vie_annonce_jours', 'apres.fenetre_echange_jours', 'apres.invitation_jours', 'apres.conservation_ip_mois',
     'retroactivite', 'retroactivite.basculent', 'retroactivite.dont_devoilees', 'retroactivite.confirmee'
   ]::text[]
 where code = 'reglage_modifie';

update public.grand_livre_actions
   set cles_detail = array['mois', 'limite', 'audit_logs', 'session_logs', 'cause', 'sqlstate']::text[]
 where code = 'ip_effacees';


-- ── ② LES CHEMINS D'UN DÉTAIL — pure, exécutable par la postcondition ──────
-- LES CHEMINS D'UN DÉTAIL DÉCRIVENT SA FORME, PAS SON CONTENU : c'est un
-- ENSEMBLE. Un tableau de deux objets a UN chemin `l[].x`, pas deux — la liste
-- blanche est un ensemble, et le refus GL004 doit nommer chaque clé fautive
-- UNE fois. Rendus DISTINCTS, dans un ordre STABLE (collation "C" : l'ordre ne
-- dépend pas de la collation du serveur).
-- La première version, récursive en PL/pgSQL, émettait un chemin par ÉLÉMENT
-- de tableau : sa propre postcondition l'a arrêtée au premier rejeu local.
-- Les feuilles : un scalaire (JSON null compris), un objet vide, un tableau
-- vide. Un objet vide À LA RACINE n'a aucun chemin.
create or replace function public.grand_livre_chemins(p jsonb, p_prefixe text default '')
returns setof text
language sql
immutable
as $$
  with recursive n(chemin, valeur) as (
    select coalesce(p_prefixe, ''), p
     where p is not null
    union all
    select case when e.cle is null then n.chemin || '[]'
                when n.chemin = '' then e.cle
                else n.chemin || '.' || e.cle end,
           e.valeur
      from n
      cross join lateral (
        select o.key as cle, o.value as valeur
          from jsonb_each(case when jsonb_typeof(n.valeur) = 'object' then n.valeur else '{}'::jsonb end) o
        union all
        select null::text, a.value
          from jsonb_array_elements(case when jsonb_typeof(n.valeur) = 'array' then n.valeur else '[]'::jsonb end) a
      ) e
  )
  select distinct n.chemin collate "C"
    from n
   where (jsonb_typeof(n.valeur) not in ('object', 'array')
          or n.valeur = '{}'::jsonb
          or n.valeur = '[]'::jsonb)
     and not (n.chemin = '' and n.valeur = '{}'::jsonb)
   order by 1
$$;


-- ── ③ UNE FOIS — la clé ─────────────────────────────────────────────────────
create unique index if not exists grand_livre_une_fois_idx
  on public.grand_livre (piece, type_action, coalesce(sujet_id, '00000000-0000-0000-0000-000000000000'::uuid));


-- ── ③ bis UNE ÉCRITURE SANS EFFET NE PASSE JAMAIS EN SILENCE — la fonction unique ─
--  Ajoutée le 28/09/2026 (lot T.3, §E.74). Une RPC qui verrouille une ligne puis la
--  met à jour par son identifiant ne peut toucher ZÉRO ligne que sur anomalie — une
--  politique forcée, un trigger qui annule, une ligne disparue. Rendue telle quelle,
--  l'anomalie passait pour un succès ; rendue en `false`, pour un rejeu (§E.22).
--  Chaque écriture de ce genre appelle `exiger_ecriture()` juste après son
--  `get diagnostics … row_count` : la transaction lève EC001, nommée, et la ligne
--  du grand livre qui aurait suivi n'est jamais écrite. Un zéro LÉGITIME (une
--  écriture conditionnelle dont le WHERE est la garde) ne l'appelle pas : il rend
--  son issue nommée — c'est `diag-ecritures-effectives` qui tient la différence.
create or replace function public.exiger_ecriture(p_lignes bigint, p_ou text, p_attendu bigint default 1)
  returns void
  language plpgsql
  set search_path to 'public'
as $fn$
begin
  if p_lignes is distinct from p_attendu then
    raise exception 'ecriture sans effet : % — % ligne(s) touchee(s), % attendue(s)', p_ou, coalesce(p_lignes::text, 'aucune mesure'), p_attendu
      using errcode = 'EC001';
  end if;
end;
$fn$;
revoke all on function public.exiger_ecriture(bigint, text, bigint) from public, anon, authenticated;


-- ── ④ journaliser() — même signature, deux barrières, une clé ───────────────
create or replace function public.journaliser(
  p_piece          uuid,
  p_type_action    text,
  p_statut         text,
  p_origine        text,
  p_acteur_id      uuid    default null,
  p_acteur_type    text    default null,
  p_ecosysteme_id  uuid    default null,
  p_sujet_type     text    default null,
  p_sujet_id       uuid    default null,
  p_detail         jsonb   default '{}'::jsonb,
  p_piece_origine  uuid    default null,
  p_cout_usd       numeric default null,
  p_unite_facturee text    default null
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_impose text;
  v_cles   text[];
  v_hors   text[];
  v_detail jsonb;
  v_id     bigint;
begin
  if p_piece is null then
    raise exception 'journaliser : la piece est obligatoire — une ecriture sans piece ne se relie a rien'
      using errcode = 'GL002';
  end if;
  if p_type_action is null then
    raise exception 'journaliser : le type d action est obligatoire'
      using errcode = 'GL002';
  end if;

  select statut_impose, cles_detail into v_impose, v_cles
    from public.grand_livre_actions
   where code = p_type_action;
  if not found then
    raise exception 'journaliser : type d action inconnu « % » — la liste est FERMEE (grand_livre_actions) et s etend par migration', p_type_action
      using errcode = 'GL003';
  end if;
  if v_impose is not null and p_statut is distinct from v_impose then
    raise exception 'journaliser : « % » impose le statut « % », recu « % »', p_type_action, v_impose, p_statut
      using errcode = 'GL003';
  end if;

  -- PREMIÈRE BARRIÈRE — la liste blanche de l'action. Toute clé hors liste
  -- est refusée et NOMMÉE ; une clé personnelle nouvelle n'a aucune chance
  -- d'y figurer.
  v_detail := coalesce(p_detail, '{}'::jsonb);
  select array_agg(c order by c) into v_hors
    from public.grand_livre_chemins(v_detail) as c
   where c <> all (v_cles);
  if v_hors is not null then
    raise exception 'journaliser : « % » n accepte pas les cles % — liste blanche : %', p_type_action, v_hors, v_cles
      using errcode = 'GL004';
  end if;
  -- SECONDE BARRIÈRE — la liste noire commune au journal d'audit. Elle ne
  -- décide plus de rien ici (une clé personnelle n'est jamais dans une liste
  -- blanche) ; elle reste, parce qu'une barrière qui coûte zéro se garde.
  v_detail := public.audit_logs_detail_sans_pii(v_detail);

  begin
    insert into public.grand_livre
      (piece, piece_origine, type_action, statut, origine,
       acteur_id, acteur_type, ecosysteme_id, sujet_type, sujet_id,
       detail, cout_usd, unite_facturee)
    values
      (p_piece, p_piece_origine, p_type_action, p_statut, p_origine,
       p_acteur_id, p_acteur_type, p_ecosysteme_id, p_sujet_type, p_sujet_id,
       v_detail, p_cout_usd, p_unite_facturee)
    returning id into v_id;
  exception when unique_violation then
    -- UNE FOIS. La seconde écriture du même geste pour la même action sur le
    -- même sujet est un défaut de l'appelant, jamais une ligne de plus.
    raise exception 'journaliser : « % » deja ecrite pour la piece % (sujet %) — une action s ecrit UNE fois par geste', p_type_action, p_piece, p_sujet_id
      using errcode = 'GL005';
  end;

  return v_id;
end;
$fn$;


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_sautee boolean := false;  -- une sonde sautée rend la ligne finale PARTIELLE (§E.67)
  v_sig    text;
  v_id     bigint;
  v_piece  uuid;
  v_sujet  uuid;
  v_cles   text[];
  v_chem   text[];
  v_acteur uuid;
  v_vie    integer;
  v_fen    integer;
  v_inv    integer;
  v_ip     integer;
  v_n      integer;
begin
  -- exiger_ecriture : le compte attendu passe, tout autre lève EC001 (aucune donnée requise).
  perform public.exiger_ecriture(1, 'postcondition');
  perform public.exiger_ecriture(3, 'postcondition', 3);
  begin
    perform public.exiger_ecriture(0, 'postcondition');
    raise exception 'postcondition NON TENUE : exiger_ecriture laisse passer une ecriture sans effet';
  exception when sqlstate 'EC001' then
    null;
  end;
  for v_sig in
    select s from unnest(array[
      'public.exiger_ecriture(bigint, text, bigint)',
      'public.grand_livre_chemins(jsonb, text)',
      'public.journaliser(uuid, text, text, text, uuid, text, uuid, text, uuid, jsonb, uuid, numeric, text)',
      'public.regler_durees_place(uuid, uuid, uuid, uuid, integer, integer, integer, integer, jsonb)',
      'public.effacer_adresses_ip()'
    ]) as s
    where to_regprocedure(s) is null
  loop
    raise exception
      'postcondition NON TENUE : % manque ou a change de signature [vu : %]',
      v_sig,
      coalesce(
        (select string_agg(p.oid::regprocedure::text, ' | ')
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname = split_part(split_part(v_sig, '.', 2), '(', 1)),
        'aucune fonction de ce nom');
  end loop;

  -- La colonne existe, NOT NULL ; les deux actions branchées ont leur liste.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'grand_livre_actions'
                    and column_name = 'cles_detail' and is_nullable = 'NO') then
    raise exception 'postcondition NON TENUE : grand_livre_actions.cles_detail absente ou nullable';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'reglage_modifie';
  if v_cles is null or not (v_cles @> array['avant.vie_annonce_jours', 'apres.conservation_ip_mois', 'retroactivite']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de reglage_modifie ne couvre pas son detail [vu : %]', v_cles;
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'ip_effacees';
  if v_cles is null or not (v_cles @> array['mois', 'session_logs', 'cause']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de ip_effacees ne couvre pas son detail [vu : %]', v_cles;
  end if;

  -- L'index « une fois » : unique, sur trois attributs (le troisième est une expression).
  if not exists (select 1 from pg_index i
                  where i.indexrelid = to_regclass('public.grand_livre_une_fois_idx')
                    and i.indisunique and i.indnatts = 3) then
    raise exception 'postcondition NON TENUE : grand_livre_une_fois_idx absent, non unique, ou pas sur trois attributs';
  end if;

  -- LA FONCTION PURE S'EXÉCUTE : objets imbriqués, tableau d'objets, nul, vide.
  --   Un tableau de DEUX objets : un chemin, pas deux. Tri en collation "C" : la
  --   comparaison ne dépend pas de la collation du serveur.
  select array_agg(c order by c collate "C") into v_chem
    from public.grand_livre_chemins('{"a":{"b":1,"c":null},"l":[{"x":1},{"x":2}],"v":{},"t":[]}'::jsonb) as c;
  if v_chem is distinct from array['a.b', 'a.c', 'l[].x', 't', 'v']::text[] then
    raise exception 'postcondition NON TENUE : grand_livre_chemins rend % au lieu de {a.b,a.c,l[].x,t,v}', v_chem;
  end if;
  --   Tableaux imbriqués, tableau de scalaires, racine vide, nul SQL.
  select array_agg(c order by c collate "C") into v_chem
    from public.grand_livre_chemins('{"m":[[1,2],[3]],"s":[1,2,3],"o":[{"p":{"q":1}},{"p":{"q":2,"r":3}}]}'::jsonb) as c;
  if v_chem is distinct from array['m[][]', 'o[].p.q', 'o[].p.r', 's[]']::text[] then
    raise exception 'postcondition NON TENUE : grand_livre_chemins rend % au lieu de {m[][],o[].p.q,o[].p.r,s[]}', v_chem;
  end if;
  if exists (select 1 from public.grand_livre_chemins('{}'::jsonb))
     or exists (select 1 from public.grand_livre_chemins(null::jsonb)) then
    raise exception 'postcondition NON TENUE : un detail vide ou nul a des chemins';
  end if;

  -- SONDE ① — une clé hors liste est REFUSÉE et NOMMÉE (GL004).
  begin
    perform public.journaliser(gen_random_uuid(), 'ip_effacees', 'reussi', 'systeme',
                               null::uuid, null::text, null::uuid, 'sonde', gen_random_uuid(),
                               '{"mois":12,"email_facturation":"a@b.c"}'::jsonb);
    raise exception 'postcondition NON TENUE : journaliser a ACCEPTE une cle hors liste blanche';
  exception when sqlstate 'GL004' then
    if sqlerrm not like '%email_facturation%' then
      raise exception 'postcondition NON TENUE : le refus GL004 ne NOMME pas la cle fautive (%)', sqlerrm;
    end if;
  end;
  -- SONDE ① bis — une clé fautive RÉPÉTÉE dans un tableau est nommée UNE fois.
  begin
    perform public.journaliser(gen_random_uuid(), 'ip_effacees', 'reussi', 'systeme',
                               null::uuid, null::text, null::uuid, 'sonde', gen_random_uuid(),
                               '{"mois":12,"l":[{"courriel":"a"},{"courriel":"b"}]}'::jsonb);
    raise exception 'postcondition NON TENUE : journaliser a ACCEPTE une cle hors liste blanche dans un tableau';
  exception when sqlstate 'GL004' then
    if (length(sqlerrm) - length(replace(sqlerrm, 'l[].courriel', ''))) / length('l[].courriel') <> 1 then
      raise exception 'postcondition NON TENUE : le refus GL004 ne nomme pas l[].courriel exactement UNE fois (%)', sqlerrm;
    end if;
  end;
  -- SONDE ② — une clé personnelle NOUVELLE, imbriquée, est refusée par la liste blanche
  -- (la liste noire ne la connaît pas — c'est tout le point).
  begin
    perform public.journaliser(gen_random_uuid(), 'reglage_modifie', 'reussi', 'systeme',
                               null::uuid, null::text, null::uuid, 'sonde', gen_random_uuid(),
                               '{"avant":{"vie_annonce_jours":30,"nom_contact":"x"}}'::jsonb);
    raise exception 'postcondition NON TENUE : une cle personnelle nouvelle (avant.nom_contact) est PASSEE';
  exception when sqlstate 'GL004' then
    null;
  end;
  -- SONDE ③ — un détail conforme passe, puis la même écriture LÈVE (GL005). Annulée.
  begin
    v_piece := gen_random_uuid();
    v_sujet := gen_random_uuid();
    v_id := public.journaliser(v_piece, 'ip_effacees', 'reussi', 'systeme',
                               null::uuid, null::text, null::uuid, 'sonde', v_sujet,
                               '{"mois":12,"limite":"2025-09-25T00:00:00Z","audit_logs":0,"session_logs":0}'::jsonb);
    begin
      perform public.journaliser(v_piece, 'ip_effacees', 'reussi', 'systeme',
                                 null::uuid, null::text, null::uuid, 'sonde', v_sujet,
                                 '{"mois":12}'::jsonb);
      raise exception 'postcondition NON TENUE : la MEME ecriture a ete acceptee deux fois';
    exception when sqlstate 'GL005' then
      null;
    end;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE ④ — l'action réelle passe sa propre liste blanche (base vierge : sautée, et dite).
  select id into v_acteur from public.users order by created_at limit 1;
  if v_acteur is null then
    raise notice 'postcondition : sonde regler_durees_place SAUTEE — aucun compte en base (base vierge)';
    v_sautee := true;
  else
    begin
      select vie_annonce_jours, fenetre_echange_jours, invitation_jours, conservation_ip_mois
        into v_vie, v_fen, v_inv, v_ip
        from public.duree_reglages where ligne_unique = true;
      v_id := public.regler_durees_place(gen_random_uuid(), v_acteur, null::uuid, gen_random_uuid(),
                                         v_vie, v_fen, v_inv, v_ip,
                                         jsonb_build_object(
                                           'avant', jsonb_build_object('vie_annonce_jours', v_vie, 'fenetre_echange_jours', v_fen, 'invitation_jours', v_inv, 'conservation_ip_mois', v_ip),
                                           'apres', jsonb_build_object('vie_annonce_jours', v_vie, 'fenetre_echange_jours', v_fen, 'invitation_jours', v_inv, 'conservation_ip_mois', v_ip),
                                           'retroactivite', null));
      if v_id is null then
        raise exception 'postcondition NON TENUE : regler_durees_place n a rien journalise';
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;

  select count(*) into v_n from public.grand_livre_actions where cardinality(cles_detail) > 0;
  if v_sautee then
    raise notice 'postcondition PARTIELLE — une sonde SAUTEE faute de donnees, la fonction du geste n a PAS tourne ici ; seul le reste est verifie : liste blanche par action (GL004), une fois par cle (GL005) — % action(s) declarent leur detail', v_n;
  else
    raise notice 'postcondition tenue : liste blanche par action (GL004), une fois par cle (GL005) — % action(s) declarent leur detail', v_n;
  end if;
end
$post$;
