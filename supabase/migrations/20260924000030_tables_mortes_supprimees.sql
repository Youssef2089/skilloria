-- ════════════════════════════════════════════════════════════════════════════
--  LES DEUX TABLES MORTES PARTENT — ET LA MIGRATION PROUVE QU'ELLES LE SONT.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : INDIFFÉRENT. Aucune ligne de code ne lit ni n'écrit ces
--  deux tables (mesuré : app/, lib/, components/, scripts/, et les types
--  générés nettoyés dans le même commit) ; aucune fonction SQL ne les cite ;
--  aucune vue, aucun trigger, aucune clé étrangère entrante. Rejouable.
--
--  ┌─ CE QU'ON FERME ────────────────────────────────────────────────────────┐
--  │ `user_section_visits` et `subscription_history` sont des vestiges du    │
--  │ dump de baseline (§B.1 architecture). Verdict du 24/09/2026 (§H.2) :     │
--  │ MORTES — aucun écrivain, aucun lecteur, dans le code comme dans le SQL.  │
--  │ La règle de l'architecte : « règle 0, elles partent ». Une table morte  │
--  │ qui reste coûte : des politiques RLS ouvertes sur une pièce vide          │
--  │ (`user_section_visits_self_write` pour `authenticated`), des types       │
--  │ générés qui font croire à une fonctionnalité, et un inventaire qu'on     │
--  │ croit exhaustif.                                                         │
--  └──────────────────────────────────────────────────────────────────────────┘
--
--  MESURÉ AVANT (lecture seule sur staging, 24/09/2026) : `user_section_visits`
--  porte 5 lignes — des visites de sections d'un parcours qui n'existe plus,
--  aucune n'est lue par rien ; `subscription_history` en porte 0. Les cinq
--  partent avec la table : ce sont des données personnelles (compte, section,
--  date) qu'aucune finalité ne justifie plus. La précondition les COMPTE et
--  l'annonce ; elle ne bloque pas dessus.
--
--  LA PREUVE EST EXÉCUTÉE, PAS AFFIRMÉE (§E.67, §E.61) : un balayage de app/
--  et lib/ avait déclaré `rate_limit_hits` morte alors qu'une fonction SQL
--  l'écrit. Ici, la précondition lit `pg_proc.prosrc` (toute fonction, tout
--  langage, tout schéma hors système), `pg_constraint` (clés étrangères
--  entrantes), `pg_rewrite`/`pg_depend` (vues) et `pg_trigger` — et REFUSE
--  de supprimer si quoi que ce soit s'y accroche, en le nommant.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── PRÉCONDITION — rien ne les cite, rien n'en dépend ───────────────────────
do $pre$
declare
  v_t   text;
  v_oid oid;
  v_fn  text;
  v_dep text;
  v_n   bigint;
begin
  foreach v_t in array array['user_section_visits', 'subscription_history'] loop
    v_oid := to_regclass('public.' || v_t);
    if v_oid is null then
      raise notice 'tables_mortes_supprimees : public.% deja absente', v_t;
      continue;
    end if;

    -- (a) AUCUNE FONCTION NE LA CITE — le corps de toute fonction, quel que soit
    --     son langage, hors schémas système. C'est la preuve que le balayage du
    --     code ne peut pas donner.
    select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
      into v_fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname not in ('pg_catalog', 'information_schema')
       and n.nspname not like 'pg_%'
       and p.prosrc ilike '%' || v_t || '%';
    if v_fn is not null then
      raise exception 'precondition NON TENUE : des fonctions citent % — % ; la table n est pas morte',
        v_t, v_fn;
    end if;

    -- (b) aucune clé étrangère ENTRANTE
    select string_agg(c.conrelid::regclass::text || '.' || c.conname, ', ')
      into v_dep
      from pg_constraint c
     where c.confrelid = v_oid;
    if v_dep is not null then
      raise exception 'precondition NON TENUE : cles etrangeres entrantes sur % — %', v_t, v_dep;
    end if;

    -- (c) aucune VUE ne la lit (règles de réécriture qui dépendent de la relation)
    select string_agg(distinct dc.relname, ', ')
      into v_dep
      from pg_depend d
      join pg_rewrite r on r.oid = d.objid and d.classid = 'pg_rewrite'::regclass
      join pg_class dc on dc.oid = r.ev_class
     where d.refobjid = v_oid
       and dc.oid <> v_oid;
    if v_dep is not null then
      raise exception 'precondition NON TENUE : des vues lisent % — %', v_t, v_dep;
    end if;

    -- (d) aucun trigger utilisateur
    select string_agg(t.tgname, ', ')
      into v_dep
      from pg_trigger t
     where t.tgrelid = v_oid
       and not t.tgisinternal;
    if v_dep is not null then
      raise exception 'precondition NON TENUE : des triggers vivent sur % — %', v_t, v_dep;
    end if;

    -- (e) ce qu'elle porte est COMPTÉ et ANNONCÉ — pas bloquant : une table
    --     morte peut garder des lignes d'un parcours disparu (5 mesurées le
    --     24/09/2026 sur user_section_visits), et elles partent avec elle.
    execute format('select count(*) from public.%I', v_t) into v_n;
    raise notice 'tables_mortes_supprimees : public.% — % ligne(s) emportee(s), aucune dependance', v_t, v_n;
  end loop;
end
$pre$;

-- ── LA SUPPRESSION — les politiques RLS et les index partent avec ───────────
drop table if exists public.user_section_visits;
drop table if exists public.subscription_history;

-- ── POSTCONDITION — elles n'existent plus, et rien ne les cite ──────────────
do $post$
declare
  v_t  text;
  v_fn text;
begin
  foreach v_t in array array['user_section_visits', 'subscription_history'] loop
    if to_regclass('public.' || v_t) is not null then
      raise exception 'postcondition NON TENUE : public.% existe encore', v_t;
    end if;
    -- Une fonction créée APRÈS la précondition (par une migration intercalée)
    -- serait invisible à la première lecture : on relit.
    select string_agg(n.nspname || '.' || p.proname, ', ')
      into v_fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname not in ('pg_catalog', 'information_schema')
       and n.nspname not like 'pg_%'
       and p.prosrc ilike '%' || v_t || '%';
    if v_fn is not null then
      raise exception 'postcondition NON TENUE : % supprimee mais encore citee par %', v_t, v_fn;
    end if;
  end loop;
  raise notice 'postcondition tenue : user_section_visits et subscription_history supprimees, rien ne les cite';
end
$post$;
