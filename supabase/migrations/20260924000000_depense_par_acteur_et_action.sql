-- ════════════════════════════════════════════════════════════════════════════
--  CE QUE CHAQUE COMPTE A COÛTÉ, ET SUR QUOI.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : INDIFFÉRENT. N'ajoute qu'une fonction de LECTURE ; ne
--  touche aucune donnée, aucune colonne, aucune contrainte. Rejouable.
--
--  ┌─ LE DÉFAUT QU'ON FERME ─────────────────────────────────────────────────┐
--  │ `ai_spend_par_acteur` dit COMBIEN chaque compte a coûté. Elle ne dit pas │
--  │ SUR QUOI. Un compte à 24 $ sur un plafond de 25 $ est une décision à     │
--  │ prendre — et on ne peut pas la prendre sans savoir si ces 24 $ sont      │
--  │ cent classements légitimes ou une boucle d'analyses de CV.               │
--  │                                                                          │
--  │ `ai_depense_par_mois` ventile DÉJÀ par action — mais GLOBALEMENT, tous   │
--  │ comptes confondus. Les deux lectures existantes se croisent donc sur     │
--  │ tout sauf sur la seule case qui décide : (ce compte-ci, cette action).   │
--  └──────────────────────────────────────────────────────────────────────────┘
--
--  ⚠️ LA DONNÉE EXISTAIT DEPUIS LE PREMIER JOUR. `ai_spend_events` porte
--     l'acteur ET l'action sur chaque ligne ; il manquait la lecture qui les
--     croise. C'est exactement ce que dit `suivi_consommation` de son propre
--     défaut : un compteur qui ne montre qu'un total ne permet de décider de
--     RIEN — il rassure quand il est bas, et il ne dit pas quoi faire quand il
--     est haut.
-- ─────────────────────────────────────────────────────────────────────────────


-- ⚠️ LE MÊME CLASSEMENT QUE `ai_spend_par_acteur`, AU CARACTÈRE PRÈS, ET C'EST
--    LA PROPRIÉTÉ QUI COMPTE. L'écran affiche la liste rendue par l'une et
--    replie sous chaque ligne le détail rendu par l'autre. Si les deux ne
--    retenaient pas EXACTEMENT les mêmes comptes, un compte s'afficherait sans
--    détail — ou, pire, un détail se rattacherait à une ligne absente.
--
--    L'ordre `(depense desc, acteur_id)` est TOTAL : le second terme départage
--    les montants égaux. Sans lui, deux comptes à la même dépense pourraient
--    être classés différemment d'une requête à l'autre, et les deux fonctions
--    divergeraient SANS QUE RIEN NE CHANGE dans les données.
--
--    Et la fenêtre mensuelle vient de `ai_spend_debut_du_mois()`, comme les
--    quatre autres lectures : une recopie ici décalerait ce détail de quelques
--    heures en fin de mois, et la somme des actions d'un compte cesserait
--    d'égaler sa dépense (§E.31).
create or replace function public.ai_spend_par_acteur_et_action(p_limite integer default 50)
  returns table (
    acteur_type text,
    acteur_id   uuid,
    action      text,
    depense     numeric,
    operations  integer
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  with mois as (
    select e.organization_id, e.profile_id, e.action, e.cost_usd
      from public.ai_spend_events e
     where e.created_at >= public.ai_spend_debut_du_mois()
  ),
  impute as (
    select
      case when m.organization_id is not null then 'organization' else 'profile' end as acteur_type,
      coalesce(m.organization_id, m.profile_id)                                      as acteur_id,
      sum(m.cost_usd)                                                                as depense
      from mois m
     where m.organization_id is not null or m.profile_id is not null
     group by 1, 2
  ),
  classe as (
    select i.*, row_number() over (order by i.depense desc, i.acteur_id) as rang
      from impute i
  )
  select
      c.acteur_type::text,
      c.acteur_id,
      -- ⚠️ `action` PEUT ÊTRE NULL, et ça ne se remplace pas par une chaîne
      --    vide : les dépenses antérieures à la colonne `action` n'en portent
      --    aucune. L'écran les nomme « non catégorisée » — un libellé qui DIT
      --    ce qu'il est, plutôt qu'une case vide qu'on prendrait pour un bogue.
      coalesce(m.action, 'inconnue')::text,
      round(sum(m.cost_usd), 6),
      count(*)::integer
    from classe c
    join mois m
      on (c.acteur_type = 'organization' and m.organization_id = c.acteur_id)
      or (c.acteur_type = 'profile'      and m.profile_id      = c.acteur_id)
   where c.rang <= greatest(1, coalesce(p_limite, 50))
   group by 1, 2, 3
   order by 1, 2, 4 desc;
$fn$;

comment on function public.ai_spend_par_acteur_et_action(integer) is
  'Depense du mois VENTILEE par (compte, action), pour les memes comptes que '
  'ai_spend_par_acteur retient — meme classement, meme fenetre. Sans cette lecture, '
  'on voit combien un compte a coute sans jamais savoir sur quoi.';

revoke all on function public.ai_spend_par_acteur_et_action(integer) from public, anon, authenticated;
grant execute on function public.ai_spend_par_acteur_et_action(integer) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
--  POSTCONDITION — une migration qui « réussit » n'a rien prouvé (§E.60)
-- ════════════════════════════════════════════════════════════════════════════
do $post$
declare
  v_n integer;
  v_resultat text;
  v_total_liste numeric;
  v_total_detail numeric;
begin
  -- ── LA FONCTION EXISTE, ET ELLE REND LES CINQ COLONNES ───────────────────
  --  ⚠️ Une fonction qui rend une table N'EST PAS une table : elle n'apparaît
  --     pas dans `information_schema.columns`. On lit son type de retour.
  select pg_get_function_result(p.oid) into v_resultat
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ai_spend_par_acteur_et_action';
  if v_resultat is null then
    raise exception 'postcondition NON TENUE : ai_spend_par_acteur_et_action est introuvable';
  end if;
  if v_resultat not like '%acteur_type%' or v_resultat not like '%action%'
     or v_resultat not like '%depense%' or v_resultat not like '%operations%' then
    raise exception 'postcondition NON TENUE : le detail ne rend pas ses colonnes — %', v_resultat;
  end if;

  -- ── ELLE LIT LA FENÊTRE UNIQUE, elle ne la recopie pas ───────────────────
  select count(*) into v_n
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ai_spend_par_acteur_et_action'
     and p.prosrc like '%ai_spend_debut_du_mois()%';
  if v_n <> 1 then
    raise exception 'postcondition NON TENUE : le detail ne lit pas la fenetre mensuelle unique';
  end if;

  -- ══ LA PROPRIÉTÉ QUI REND CET ÉCRAN CROYABLE, ÉPROUVÉE SUR LES DONNÉES ══
  --  Pour les comptes DÉTAILLÉS, la somme du détail par action doit ÉGALER la
  --  somme de la liste. Vérifier que les deux fonctions « se ressemblent » ne
  --  prouve rien ; on les EXÉCUTE et on compare leurs totaux.
  --
  --  ⚠️ On compare à 1e-6 près — les deux passent par `round(…, 6)` sur des
  --     regroupements différents, et exiger l'égalité binaire ferait rougir
  --     sur un arrondi, c'est-à-dire sur rien.
  select coalesce(sum(a.depense_mois), 0) into v_total_liste
    from public.ai_spend_par_acteur(50) a
   where a.acteur_type in ('organization', 'profile');

  select coalesce(sum(d.depense), 0) into v_total_detail
    from public.ai_spend_par_acteur_et_action(50) d;

  if abs(v_total_liste - v_total_detail) > 0.000001 then
    raise exception
      'postcondition NON TENUE : le detail totalise % la ou la liste totalise % — un ecran de depense qui ne boucle pas cesse d etre cru',
      v_total_detail, v_total_liste;
  end if;

  -- ── ET LE MÊME NOMBRE DE COMPTES, des deux côtés ─────────────────────────
  --  Un compte present dans la liste et absent du detail s afficherait vide ;
  --  l inverse rattacherait un detail a une ligne qui n existe pas.
  select count(*) into v_n
    from (
      select a.acteur_type, a.acteur_id
        from public.ai_spend_par_acteur(50) a
       where a.acteur_type in ('organization', 'profile')
      except
      select d.acteur_type, d.acteur_id
        from public.ai_spend_par_acteur_et_action(50) d
    ) manquants;
  if v_n <> 0 then
    raise exception 'postcondition NON TENUE : % compte(s) de la liste n ont aucun detail', v_n;
  end if;

  select count(*) into v_n
    from (
      select d.acteur_type, d.acteur_id
        from public.ai_spend_par_acteur_et_action(50) d
      except
      select a.acteur_type, a.acteur_id
        from public.ai_spend_par_acteur(50) a
       where a.acteur_type in ('organization', 'profile')
    ) orphelins;
  if v_n <> 0 then
    raise exception 'postcondition NON TENUE : % detail(s) ne se rattachent a aucune ligne de la liste', v_n;
  end if;

  raise notice 'postcondition tenue : le detail par action boucle avec la liste par compte';
end
$post$;
