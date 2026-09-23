-- ════════════════════════════════════════════════════════════════════════════
--  UN PLAFOND PAR ACTEUR. LE GLOBAL DEVIENT LE DERNIER GARDE-FOU.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement.
--    Elle ajoute une colonne, une contrainte et deux fonctions ; elle ne
--    retire rien que le code en ligne utilise. `ai_spend_par_acteur` est
--    recréée avec QUATRE COLONNES DE PLUS — un `select *` en lit davantage,
--    aucun n'en perd. Le code en ligne les ignore jusqu'à son déploiement.
--
--  ┌─ LE DÉFAUT QU'ON FERME ─────────────────────────────────────────────────┐
--  │ Il existait UN plafond : le plafond GLOBAL par fournisseur. Une seule    │
--  │ organisation pouvait donc consommer le budget de tout l'écosystème, et   │
--  │ ce qui s'arrêtait alors s'arrêtait POUR TOUT LE MONDE.                   │
--  │                                                                          │
--  │ Les seuils par acteur existaient déjà — mais ils ALERTENT, ils ne        │
--  │ bloquent pas (décision arbitrée, migration `depense_ia_par_acteur`). Une │
--  │ alerte prévient ; elle n'a jamais arrêté une dépense.                    │
--  └──────────────────────────────────────────────────────────────────────────┘
--
--  ═══ LES QUATRE MOTS, ET ILS SONT TENUS ICI (§D.9) ══════════════════════
--    · PLAFOND — il BLOQUE. Deux niveaux désormais : par acteur, puis global.
--    · ALERTE  — elle SIGNALE. Inchangée, et elle reste SOUS le plafond.
--    La colonne existante `seuil_mensuel_usd` GARDE SON NOM : elle est lue par
--    son nom, dans des chaînes, et la renommer casserait au runtime en silence
--    (§D.9, l'exception qui est dans le même paragraphe que la règle).
--
--  ═══ CE QU'UN PLAFOND D'ACTEUR ARRÊTE, ET CE QU'IL N'ARRÊTE PAS ═════════
--    Il arrête ce que la PLATEFORME dépense d'elle-même pour cet acteur — le
--    classement. Il n'arrête RIEN de ce que la personne vient de demander :
--    une organisation au plafond publie, un expert au plafond postule.
--    La règle vit dans `lib/ai-plafonds.ts`, où elle est EXÉCUTÉE par son
--    contrôle ; la base, elle, ne fait que MESURER.
-- ─────────────────────────────────────────────────────────────────────────────


-- ════════════════════════════════════════════════════════════════════════════
--  ① LA FENÊTRE MENSUELLE DEVIENT UN MÉCANISME
-- ════════════════════════════════════════════════════════════════════════════
--  Trois fonctions portaient `date_trunc('month', now() at time zone 'utc')`
--  recopié, sous un commentaire disant « AU CARACTÈRE PRÈS ». C'est une
--  DISCIPLINE : elle tient tant que personne ne se trompe, et le jour où l'une
--  des trois dérive, les totaux se décalent de quelques heures en fin de mois
--  et LA SOMME CESSE DE BOUCLER — c'est-à-dire que l'écran cesse d'être
--  croyable, sans afficher la moindre erreur.
--
--  Une garde qui est une FONCTION ne dépend d'aucune discipline (§E.31).
create or replace function public.ai_spend_debut_du_mois()
  returns timestamptz
  language sql
  stable
  set search_path to 'public'
as $fn$
  -- Le mois CIVIL en UTC : un plafond mensuel doit se remettre à zéro à une
  -- date que tout le monde peut nommer.
  select date_trunc('month', now() at time zone 'utc') at time zone 'utc';
$fn$;

comment on function public.ai_spend_debut_du_mois() is
  'Le debut de la fenetre mensuelle de depense. SOURCE UNIQUE : trois fonctions '
  'la recopiaient, et un decalage entre elles ferait cesser la somme de boucler.';

revoke all on function public.ai_spend_debut_du_mois() from public, anon, authenticated;
grant execute on function public.ai_spend_debut_du_mois() to service_role;


-- ════════════════════════════════════════════════════════════════════════════
--  ② LE PLAFOND PAR ACTEUR
-- ════════════════════════════════════════════════════════════════════════════
alter table public.ai_spend_seuils_acteur
  add column if not exists plafond_mensuel_usd numeric;

--  VALEURS DE DÉPART, ET LEUR RAISON — à réviser sur un mois de données
--  réelles, exactement comme les alertes le disent déjà d'elles-mêmes.
--    · profil : 5 $, pour une alerte à 2 $. Le cycle complet d'un expert se
--      compte en centimes ; 5 $ en un mois n'est plus un profil actif.
--    · organisation : 25 $, pour une alerte à 10 $ et un plafond global de
--      100 $. Une organisation seule ne prend donc pas plus du QUART du budget
--      de l'écosystème — au-delà, c'est aux autres qu'elle coûte.
--  L'écart entre l'alerte et le plafond est délibéré : on regarde AVANT de
--  bloquer. Une alerte posée sur le plafond ne laisserait aucun temps pour agir.
update public.ai_spend_seuils_acteur
   set plafond_mensuel_usd = case acteur
         when 'organization' then 25
         when 'profile'      then 5
       end,
       updated_at = now()
 where plafond_mensuel_usd is null;

alter table public.ai_spend_seuils_acteur
  alter column plafond_mensuel_usd set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_spend_plafond_montant_check') then
    alter table public.ai_spend_seuils_acteur
      add constraint ai_spend_plafond_montant_check check (plafond_mensuel_usd >= 0);
  end if;

  -- ⚠️ L'ALERTE RESTE SOUS LE PLAFOND, ET LA BASE LE TIENT.
  --    Une alerte au-dessus du plafond ne se déclencherait JAMAIS : le plafond
  --    arrête la dépense avant qu'elle n'y arrive. Ce serait un réglage qu'on
  --    peut saisir, qui s'affiche, et qui ne peut rien produire.
  if not exists (select 1 from pg_constraint where conname = 'ai_spend_alerte_sous_plafond') then
    alter table public.ai_spend_seuils_acteur
      add constraint ai_spend_alerte_sous_plafond
      check (seuil_mensuel_usd <= plafond_mensuel_usd);
  end if;
end
$$;

comment on column public.ai_spend_seuils_acteur.plafond_mensuel_usd is
  'Le PLAFOND mensuel de cet acteur. Il BLOQUE — mais seulement ce que la plateforme '
  'depense d elle-meme (le classement) : une organisation au plafond publie quand meme, '
  'un expert au plafond garde son compte utilisable. Regle dans lib/ai-plafonds.ts.';

comment on column public.ai_spend_seuils_acteur.seuil_mensuel_usd is
  'L ALERTE mensuelle. Elle SIGNALE, elle n empeche rien, et elle reste SOUS le plafond '
  '(contrainte ai_spend_alerte_sous_plafond). Nom conserve : il est lu dans des chaines.';


-- ════════════════════════════════════════════════════════════════════════════
--  ③ L'ÉTAT D'UN ACTEUR — la lecture que la garde interroge
-- ════════════════════════════════════════════════════════════════════════════
--  RIEN N'EST STOCKÉ. Un état « au plafond » écrit quelque part serait faux à
--  la seconde suivante, et il faudrait ensuite le réparer — même parti pris que
--  `ai_spend_par_acteur` depuis le premier jour.
--
--  ⚠️ ELLE REND TOUJOURS UNE LIGNE, MÊME POUR UN ACTEUR QUI N'A RIEN DÉPENSÉ.
--     Zéro ligne voudrait dire « je ne sais pas », et l'appelant devrait
--     deviner ; il devinerait « pas de dépense », ce qui est vrai ici et
--     faux le jour où la lecture tombe en panne (§E.22).
create or replace function public.ai_spend_acteur_etat(
  p_acteur_type text,
  p_acteur_id   uuid
) returns table (
    depense_mois        numeric,
    plafond_mensuel_usd numeric,
    seuil_mensuel_usd   numeric,
    au_plafond          boolean,
    en_alerte           boolean
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  with reglage as (
    select s.plafond_mensuel_usd, s.seuil_mensuel_usd
      from public.ai_spend_seuils_acteur s
     where s.acteur = p_acteur_type
  ),
  depense as (
    select coalesce(sum(e.cost_usd), 0) as total
      from public.ai_spend_events e
     where e.created_at >= public.ai_spend_debut_du_mois()
       and (
         (p_acteur_type = 'organization' and e.organization_id = p_acteur_id)
         or (p_acteur_type = 'profile' and e.profile_id = p_acteur_id)
       )
  )
  select
    round(d.total, 6),
    r.plafond_mensuel_usd,
    r.seuil_mensuel_usd,
    d.total >= r.plafond_mensuel_usd,
    d.total >= r.seuil_mensuel_usd
  from depense d
  cross join reglage r;
$fn$;

comment on function public.ai_spend_acteur_etat(text, uuid) is
  'Depense du mois d UN acteur, son plafond, son alerte, et les deux etats. '
  'Aucune ligne rendue = le type d acteur n a pas de reglage : l appelant doit '
  'traiter ce cas, pas le confondre avec une depense nulle.';

revoke all on function public.ai_spend_acteur_etat(text, uuid) from public, anon, authenticated;
grant execute on function public.ai_spend_acteur_etat(text, uuid) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
--  ④ LA LISTE PAR ACTEUR APPREND LE PLAFOND
-- ════════════════════════════════════════════════════════════════════════════
--  `drop` puis `create` : `create or replace` ne peut pas changer le type de
--  retour d'une fonction. Les quatre colonnes ajoutées sont en FIN de liste,
--  donc aucun lecteur positionnel existant n'est décalé.
--
--  ⚠️ LA PROPRIÉTÉ QU'ON NE CASSE PAS : Σ(lignes rendues) = dépense du mois.
--     Trois familles disjointes et exhaustives — un acteur nommé, le reste
--     agrégé et compté, le non-imputable. Les colonnes de plafond sont NULLES
--     sur les deux dernières : ce ne sont pas des acteurs, elles n'ont pas de
--     plafond, et mettre zéro les ferait passer pour « au plafond ».
drop function if exists public.ai_spend_par_acteur(integer);

create function public.ai_spend_par_acteur(p_limite integer default 25)
  returns table (
    acteur_type         text,
    acteur_id           uuid,
    acteur_nom          text,
    depense_mois        numeric,
    evenements          integer,
    acteurs_regroupes   integer,
    plafond_mensuel_usd numeric,
    seuil_mensuel_usd   numeric,
    au_plafond          boolean,
    en_alerte           boolean
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  with mois as (
    select e.organization_id, e.profile_id, e.cost_usd
      from public.ai_spend_events e
     where e.created_at >= public.ai_spend_debut_du_mois()
  ),
  impute as (
    select
      case when m.organization_id is not null then 'organization' else 'profile' end as acteur_type,
      coalesce(m.organization_id, m.profile_id)                                      as acteur_id,
      sum(m.cost_usd)                                                                as depense,
      count(*)::integer                                                              as evenements
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
      (case c.acteur_type
         when 'organization' then o.company_name
         else coalesce(
                nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''),
                p.title)
       end)::text,
      round(c.depense, 6),
      c.evenements,
      1,
      s.plafond_mensuel_usd,
      s.seuil_mensuel_usd,
      c.depense >= s.plafond_mensuel_usd,
      c.depense >= s.seuil_mensuel_usd
    from classe c
    left join public.organizations o on c.acteur_type = 'organization' and o.id = c.acteur_id
    left join public.profiles      p on c.acteur_type = 'profile'      and p.id = c.acteur_id
    left join public.users         u on u.id = p.user_id
    left join public.ai_spend_seuils_acteur s on s.acteur = c.acteur_type
   where c.rang <= greatest(1, coalesce(p_limite, 25))
  union all
  select
      'reste_non_detaille'::text,
      null::uuid,
      null::text,
      round(coalesce(sum(c.depense), 0), 6),
      coalesce(sum(c.evenements), 0)::integer,
      count(*)::integer,
      null::numeric,
      null::numeric,
      null::boolean,
      null::boolean
    from classe c
   where c.rang > greatest(1, coalesce(p_limite, 25))
  union all
  select
      'non_imputable'::text,
      null::uuid,
      null::text,
      round(coalesce(sum(m.cost_usd), 0), 6),
      count(*)::integer,
      0,
      null::numeric,
      null::numeric,
      null::boolean,
      null::boolean
    from mois m
   where m.organization_id is null and m.profile_id is null
   order by 4 desc;
$fn$;

revoke all on function public.ai_spend_par_acteur(integer) from public, anon, authenticated;
grant execute on function public.ai_spend_par_acteur(integer) to service_role;

comment on function public.ai_spend_par_acteur(integer) is
  'Depense IA du mois par acteur declencheur, avec son plafond et son alerte. La somme '
  'des lignes rendues EGALE la depense totale du mois : acteurs detailles + '
  'reste_non_detaille + non_imputable. Les deux dernieres n ont pas de plafond (NULL, '
  'jamais zero : zero se lirait comme « au plafond »).';


-- ════════════════════════════════════════════════════════════════════════════
--  ⑤ COMBIEN D'ACTEURS SONT À LEUR PLAFOND — pour la supervision
-- ════════════════════════════════════════════════════════════════════════════
--  ⚠️ UN DÉCOMPTE, PAS UNE LECTURE DE LA LISTE DES DIX PLUS GROS.
--     La supervision lit `ai_spend_par_acteur(10)` ; compter les `au_plafond`
--     de ces dix lignes rendrait un nombre JUSTE TANT QU'IL Y EN A MOINS DE
--     DIX, et silencieusement faux ensuite — c'est-à-dire exactement le jour
--     où le signal compte. Un chiffre qui n'est vrai que dans le cas facile
--     est un chiffre faux (§E.24).
create or replace function public.ai_spend_acteurs_au_plafond()
  returns table (organisations integer, experts integer)
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  with mois as (
    select e.organization_id, e.profile_id, e.cost_usd
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
  )
  select
    count(*) filter (
      where i.acteur_type = 'organization' and i.depense >= s.plafond_mensuel_usd
    )::integer,
    count(*) filter (
      where i.acteur_type = 'profile' and i.depense >= s.plafond_mensuel_usd
    )::integer
  from impute i
  join public.ai_spend_seuils_acteur s on s.acteur = i.acteur_type;
$fn$;

comment on function public.ai_spend_acteurs_au_plafond() is
  'Combien d organisations et d experts ont atteint LEUR plafond ce mois-ci. '
  'Compte sur TOUS les acteurs, jamais sur la liste des plus gros : un decompte '
  'qui n est juste que sous dix acteurs est faux le jour ou il compte.';

revoke all on function public.ai_spend_acteurs_au_plafond() from public, anon, authenticated;
grant execute on function public.ai_spend_acteurs_au_plafond() to service_role;


-- ════════════════════════════════════════════════════════════════════════════
--  ⑥ LE PLAFOND GLOBAL LIT LA MÊME FENÊTRE
-- ════════════════════════════════════════════════════════════════════════════
--  Même corps qu'avant, à une expression près : la fenêtre vient désormais de
--  la fonction. C'est la seule raison de le réécrire.
create or replace function public.ai_spend_status()
  returns table (
    provider        text,
    monthly_cap_usd numeric,
    depense_mois    numeric,
    reste           numeric,
    part_consommee  numeric,
    au_plafond      boolean
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select
    c.provider,
    c.monthly_cap_usd,
    coalesce(d.total, 0),
    greatest(0, c.monthly_cap_usd - coalesce(d.total, 0)),
    case when c.monthly_cap_usd > 0
         then round(coalesce(d.total, 0) / c.monthly_cap_usd, 4)
         else null end,
    coalesce(d.total, 0) >= c.monthly_cap_usd
  from public.ai_spend_caps c
  left join (
    select e.provider, sum(e.cost_usd) as total
      from public.ai_spend_events e
     where e.created_at >= public.ai_spend_debut_du_mois()
     group by e.provider
  ) d on d.provider = c.provider;
$fn$;

revoke all on function public.ai_spend_status() from public, anon, authenticated;
grant execute on function public.ai_spend_status() to service_role;


-- ════════════════════════════════════════════════════════════════════════════
--  POSTCONDITION — une migration qui « réussit » n'a rien prouvé (§E.60)
-- ════════════════════════════════════════════════════════════════════════════
do $post$
declare
  v_n integer;
  v_mord boolean;
  v_debut timestamptz;
  v_resultat text;
  -- ⚠️ ON MÉMORISE L'ALERTE AVANT DE LA BOUSCULER, ET ON LA REMET TELLE
  --    QUELLE. La remettre à sa valeur de SEED écraserait un réglage qu'un
  --    administrateur aurait ajusté depuis /admin/plafonds-ia — exactement ce
  --    que §D.7 interdit au seed de faire.
  v_alerte_origine numeric;
begin
  -- ── LA FENÊTRE EST BIEN UNE SOURCE UNIQUE ────────────────────────────────
  select public.ai_spend_debut_du_mois() into v_debut;
  if v_debut is null then
    raise exception 'postcondition NON TENUE : la fenetre mensuelle est nulle';
  end if;
  if v_debut <> date_trunc('month', now() at time zone 'utc') at time zone 'utc' then
    raise exception 'postcondition NON TENUE : la fenetre rend % au lieu du debut du mois UTC', v_debut;
  end if;

  --  Et les deux fonctions qui doivent boucler ensemble la LISENT, plutôt que
  --  de la recopier. On lit leur SOURCE : c'est le seul moyen de distinguer
  --  « elles donnent le même résultat aujourd'hui » de « elles ne peuvent pas
  --  diverger demain ».
  select count(*) into v_n
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'ai_spend_status', 'ai_spend_par_acteur',
       'ai_spend_acteur_etat', 'ai_spend_acteurs_au_plafond'
     )
     and p.prosrc like '%ai_spend_debut_du_mois()%';
  if v_n <> 4 then
    raise exception 'postcondition NON TENUE : % fonction(s) sur 4 lisent la fenetre unique', v_n;
  end if;

  -- ── LE PLAFOND EXISTE, IL EST NUMÉRIQUE ET OBLIGATOIRE ───────────────────
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'ai_spend_seuils_acteur'
     and column_name = 'plafond_mensuel_usd'
     and data_type = 'numeric' and is_nullable = 'NO';
  if v_n <> 1 then
    raise exception 'postcondition NON TENUE : la colonne de plafond manque, n est pas numerique, ou tolere NULL';
  end if;

  select count(*) into v_n from public.ai_spend_seuils_acteur where plafond_mensuel_usd is null;
  if v_n <> 0 then
    raise exception 'postcondition NON TENUE : % acteur(s) sans plafond', v_n;
  end if;

  select count(*) into v_n from public.ai_spend_seuils_acteur;
  if v_n <> 2 then
    raise exception 'postcondition NON TENUE : % type(s) d acteur au lieu de 2', v_n;
  end if;

  -- ── LA CONTRAINTE MORD, ET DANS LE BON SENS ──────────────────────────────
  --  Elle est ÉPROUVÉE, pas lue : une ligne dans `pg_constraint` prouve qu'un
  --  nom est pris, pas qu'une regle refuse quelque chose (§E.7 transposé).
  v_mord := false;
  begin
    update public.ai_spend_seuils_acteur
       set seuil_mensuel_usd = plafond_mensuel_usd + 1
     where acteur = 'profile';
  exception when check_violation then
    v_mord := true;
  end;
  if not v_mord then
    raise exception 'postcondition NON TENUE : une alerte AU-DESSUS du plafond est acceptee — elle ne se declencherait jamais';
  end if;

  --  … et l'inverse est bien ACCEPTÉ, sinon la contrainte refuserait tout et
  --  la sonde precedente passerait sans rien prouver (§E.34).
  select seuil_mensuel_usd into v_alerte_origine
    from public.ai_spend_seuils_acteur where acteur = 'profile';
  v_mord := false;
  begin
    update public.ai_spend_seuils_acteur
       set seuil_mensuel_usd = plafond_mensuel_usd
     where acteur = 'profile';
  exception when check_violation then
    v_mord := true;
  end;
  if v_mord then
    raise exception 'postcondition NON TENUE : une alerte EGALE au plafond est refusee — la contrainte refuse tout';
  end if;
  update public.ai_spend_seuils_acteur
     set seuil_mensuel_usd = v_alerte_origine
   where acteur = 'profile';

  -- ── LA LISTE REND BIEN SES QUATRE COLONNES DE PLUS ───────────────────────
  --  ⚠️ UNE FONCTION QUI REND UNE TABLE N'EST PAS UNE TABLE : elle n'apparaît
  --     pas dans `information_schema.columns`. Un `count(*)` y aurait rendu
  --     zéro — c'est-à-dire une postcondition qui échoue toujours, ou pire, si
  --     on l'avait écrite en négatif, qui réussit toujours.
  select pg_get_function_result(p.oid) into v_resultat
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ai_spend_par_acteur';
  if v_resultat is null then
    raise exception 'postcondition NON TENUE : ai_spend_par_acteur est introuvable';
  end if;
  if v_resultat not like '%plafond_mensuel_usd%'
     or v_resultat not like '%seuil_mensuel_usd%'
     or v_resultat not like '%au_plafond%'
     or v_resultat not like '%en_alerte%' then
    raise exception 'postcondition NON TENUE : la liste par acteur ne rend pas les quatre colonnes de plafond — %', v_resultat;
  end if;

  -- ── ET L'ÉTAT D'UN ACTEUR REND UNE LIGNE, MÊME SANS DÉPENSE ──────────────
  --  Zero ligne se lirait comme « je ne sais pas », et l appelant devinerait.
  select count(*) into v_n
    from public.ai_spend_acteur_etat('profile', '00000000-0000-0000-0000-000000000000'::uuid);
  if v_n <> 1 then
    raise exception 'postcondition NON TENUE : l etat d un acteur sans depense rend % ligne(s) au lieu de 1', v_n;
  end if;

  -- ── LE DÉCOMPTE REND UNE LIGNE, ET DES NOMBRES ───────────────────────────
  --  Zero ligne rendrait `null` a l appelant, qui le lit comme « lecture en
  --  panne » — un signal d attention permanent que rien ne peut eteindre.
  select count(*) into v_n from public.ai_spend_acteurs_au_plafond();
  if v_n <> 1 then
    raise exception 'postcondition NON TENUE : le decompte des acteurs au plafond rend % ligne(s) au lieu de 1', v_n;
  end if;
  select organisations + experts into v_n from public.ai_spend_acteurs_au_plafond();
  if v_n is null then
    raise exception 'postcondition NON TENUE : le decompte rend NULL — il se lirait comme une panne de lecture';
  end if;

  raise notice 'postcondition tenue : chaque acteur a un plafond, et la fenetre est unique';
end
$post$;
