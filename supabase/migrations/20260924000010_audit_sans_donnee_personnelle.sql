-- ════════════════════════════════════════════════════════════════════════════
--  LE JOURNAL D'AUDIT SE NETTOIE D'UN COMPTE — AUCUNE DONNÉE PERSONNELLE
--  N'Y SURVIT À LA PURGE.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : INDIFFÉRENT. N'ajoute que trois fonctions ; ne touche
--  aucune ligne, aucune colonne, aucune contrainte au moment où elle passe.
--  Le nettoyage s'exécute PLUS TARD, à chaque purge de compte, depuis
--  `purgeAccount` (lib/account-purge.ts). Rejouable.
--
--  ┌─ LE DÉFAUT QU'ON FERME ─────────────────────────────────────────────────┐
--  │ `audit_logs.detail` portait des données personnelles en clair : une     │
--  │ adresse e-mail (invitation envoyée, renvoyée, changement d'adresse),    │
--  │ un numéro de téléphone (`phone_e164`), un nom d'organisation — qui est  │
--  │ « Prénom Nom » pour l'organisation personnelle d'un expert (§D.8).      │
--  │                                                                          │
--  │ La purge RGPD anonymise `users` et `profiles` et NE TOUCHAIT PAS le      │
--  │ journal : le compte disparaissait, son adresse restait lisible dans     │
--  │ `audit_logs`, indéfiniment. Un manquement réel, pas un risque.          │
--  └──────────────────────────────────────────────────────────────────────────┘
--
--  MESURÉ AVANT DE CORRIGER — lecture seule sur staging, 24/09/2026 :
--    127 lignes d'audit, dont 4 portent une clé personnelle dans `detail`
--    (`email`, `new_email`, `phone_e164`, `company_name`), sur 4 actions
--    (org_member_invited, email_change_requested, phone_verified,
--    org_approved) et 5 comptes concernés (acteur ou sujet).
--
--  LA PARADE, EN DEUX MOITIÉS :
--    · les écritures NOUVELLES ne portent plus que des identifiants — gardé
--      par scripts/diag-audit-sans-donnee-personnelle.mjs, qui lit la liste
--      des clés CI-DESSOUS (une seule source, pas de jumeau §E.20) ;
--    · les lignes EXISTANTES sont nettoyées par la purge du compte, ici.
--
--  POURQUOI PAS DE MIGRATION DE DONNÉES (§E.12) : 4 lignes, et une migration
--  de données ne serait validée par rien. La purge nettoiera chacune le jour
--  où son compte sera purgé ; d'ici là, elles restent liées à un compte vivant,
--  ce qui est la situation normale d'un journal.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── ① LA LISTE DES CLÉS PERSONNELLES — UNE SEULE SOURCE ─────────────────────
--  Lue par le nettoyage SQL ET par le contrôle statique : une clé ajoutée ici
--  est refusée à l'écriture par le contrôle et effacée à la purge par la base.
--  Une liste recopiée côté TypeScript aurait divergé un jour, en silence.
create or replace function public.audit_logs_cles_personnelles()
returns text[]
language sql
immutable
as $$
  select array[
    'email', 'new_email', 'old_email', 'invitee_email',
    'phone', 'phone_e164',
    'first_name', 'last_name', 'full_name', 'company_name',
    'address', 'address_line', 'city', 'postal_code', 'birth_year',
    'linkedin_url', 'photo_url', 'cv_url',
    'ip', 'ip_address', 'user_agent'
  ]::text[]
$$;

comment on function public.audit_logs_cles_personnelles() is
  'Clés de `audit_logs.detail` qui portent une donnée personnelle. Source unique : lue par audit_logs_detail_sans_pii() et par scripts/diag-audit-sans-donnee-personnelle.mjs.';


-- ── ② LA FONCTION PURE — retire ces clés À TOUTE PROFONDEUR ─────────────────
--  Récursive sur les objets et les tableaux : un `detail.avant.email` est
--  aussi personnel qu'un `detail.email`. Pure et immuable : c'est elle que la
--  postcondition EXÉCUTE, et que le contrôle peut relire sans deviner.
create or replace function public.audit_logs_detail_sans_pii(p jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_cles text[] := public.audit_logs_cles_personnelles();
  v_out  jsonb;
  v_k    text;
  v_v    jsonb;
begin
  if p is null then
    return null;
  end if;
  if jsonb_typeof(p) = 'object' then
    v_out := '{}'::jsonb;
    for v_k, v_v in select key, value from jsonb_each(p) loop
      if v_k = any (v_cles) then
        continue;
      end if;
      v_out := v_out || jsonb_build_object(v_k, public.audit_logs_detail_sans_pii(v_v));
    end loop;
    return v_out;
  elsif jsonb_typeof(p) = 'array' then
    select coalesce(jsonb_agg(public.audit_logs_detail_sans_pii(e)), '[]'::jsonb)
      into v_out
      from jsonb_array_elements(p) as e;
    return v_out;
  else
    return p;
  end if;
end
$$;


-- ── ③ LE NETTOYAGE D'UN COMPTE — appelé par la purge, AVANT le jalon ────────
--  Trois façons dont une ligne parle d'un compte, et les trois sont prises :
--    · il en est l'ACTEUR (`user_id`) ;
--    · il en est le SUJET (`entity_id`) ;
--    · son ADRESSE apparaît dans `detail` — le cas de l'invitation, dont le
--      sujet est l'invitation et l'acteur l'inviteur : sans l'adresse, rien
--      ne relie cette ligne au compte qu'elle nomme. La purge connaît encore
--      l'adresse à ce moment-là (elle anonymise APRÈS).
--  Rend le nombre de lignes modifiées : la purge l'écrit dans sa propre
--  trace (`account_purged.detail.audit_lignes_nettoyees`), pour que le
--  registre dise ce qui a eu lieu, pas ce qu'on espérait (§E.27).
create or replace function public.audit_logs_nettoyer_compte(p_user_id uuid, p_email text)
returns integer
language plpgsql
volatile
set search_path = public
as $$
declare
  v_n integer;
begin
  if p_user_id is null then
    raise exception 'audit_logs_nettoyer_compte : identifiant de compte requis';
  end if;

  update public.audit_logs a
     set detail = public.audit_logs_detail_sans_pii(a.detail)
   where a.detail is not null
     and (
       a.user_id = p_user_id
       or a.entity_id = p_user_id
       or (p_email is not null and p_email <> ''
           and position(lower(p_email) in lower(a.detail::text)) > 0)
     )
     and a.detail <> public.audit_logs_detail_sans_pii(a.detail);

  get diagnostics v_n = row_count;
  return v_n;
end
$$;

comment on function public.audit_logs_nettoyer_compte(uuid, text) is
  'Retire les clés personnelles de audit_logs.detail sur toute ligne dont le compte est l''acteur, le sujet, ou dont l''adresse apparaît dans le détail. Appelée par purgeAccount avant de poser anonymized_at.';

-- Un nettoyage n'est PAS une action d'utilisateur : seul le serveur le lance.
revoke all on function public.audit_logs_nettoyer_compte(uuid, text) from public, anon, authenticated;
grant execute on function public.audit_logs_nettoyer_compte(uuid, text) to service_role;


-- ── POSTCONDITION — ELLE S'EXÉCUTE, ELLE N'AFFIRME PAS (§E.67) ──────────────
do $post$
declare
  v_sig     text;
  v_cles    text[];
  v_attendu jsonb := '{"x":{"y":2},"z":[{}],"n":null}'::jsonb;
  v_obtenu  jsonb;
  v_zero    integer;
begin
  -- Les trois signatures, résolues par TYPES — jamais par une chaîne rendue.
  for v_sig in
    select s from unnest(array[
      'public.audit_logs_cles_personnelles()',
      'public.audit_logs_detail_sans_pii(jsonb)',
      'public.audit_logs_nettoyer_compte(uuid, text)'
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

  -- La liste couvre ce qui a été MESURÉ (les quatre clés trouvées en base).
  v_cles := public.audit_logs_cles_personnelles();
  if not (v_cles @> array['email', 'new_email', 'phone_e164', 'company_name']::text[]) then
    raise exception
      'postcondition NON TENUE : la liste des cles personnelles ne couvre pas les cles mesurees [vu : %]',
      v_cles;
  end if;

  -- La fonction pure S'EXÉCUTE, sur un objet imbriqué ET un tableau : une
  -- fonction qui ne retirerait qu'au premier niveau passerait un test plat.
  v_obtenu := public.audit_logs_detail_sans_pii(
    '{"email":"a@b.c","x":{"phone":"+33","y":2},"z":[{"first_name":"n"}],"n":null}'::jsonb);
  if v_obtenu is distinct from v_attendu then
    raise exception
      'postcondition NON TENUE : audit_logs_detail_sans_pii rend % au lieu de %',
      v_obtenu, v_attendu;
  end if;

  -- Le nettoyage S'EXÉCUTE — sur un identifiant qui n'existe pas : zéro ligne,
  -- aucun effet. Un corps plpgsql n'est vérifié qu'à l'exécution.
  v_zero := public.audit_logs_nettoyer_compte(gen_random_uuid(), null);
  if v_zero <> 0 then
    raise exception
      'postcondition NON TENUE : le nettoyage d un compte inexistant a touche % ligne(s)', v_zero;
  end if;

  raise notice 'postcondition tenue : audit_logs se nettoie d un compte (% cles personnelles)',
    array_length(v_cles, 1);
end
$post$;
