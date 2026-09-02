-- ─────────────────────────────────────────────────────────────────────────────
-- PROFIL ET ANNONCE — SPÉCIALITÉS, SÉNIORITÉS ET ZONES DEVIENNENT MULTIPLES
--
-- ⚠️ ORDRE D'EXÉCUTION — CETTE MIGRATION PASSE **AVANT** LE DÉPLOIEMENT DU CODE,
--    et le code doit partir DANS LA FOULÉE. Elle SUPPRIME quatre colonnes que
--    le code en ligne lit encore (profiles.speciality_id, profiles.seniority,
--    publications.speciality_id, publications.seniority) et en renomme une
--    (publications.location). Entre le `db push` et le déploiement, les écrans
--    de profil, d'annonce et le matching sont cassés.
--
--    Séquence correcte, sans fenêtre d'indisponibilité possible autrement :
--      1. `supabase db push` (cette migration) ;
--      2. déploiement IMMÉDIAT du code du même lot.
--
--    La base étant une base de TEST, aucune reprise de données n'est prévue :
--    les colonnes supprimées le sont sèchement, sans recopie vers les nouvelles.
--    Sur une base de production, cette migration devrait être scindée en
--    trois (ajout, recopie + double écriture, suppression).
--
-- POURQUOI DES TABLEAUX PLUTÔT QUE DES TABLES DE LIAISON
--   Le filtre de matching est le chemin chaud : il doit répondre « ces deux
--   ensembles se recoupent-ils » sur des dizaines de milliers de lignes, et il
--   est construit avec PostgREST. Un `&&` sur un tableau indexé en GIN exprime
--   exactement cette question, en une clause, sans jointure et sans risque de
--   dupliquer la ligne parente. Une table de liaison imposerait un `EXISTS` que
--   PostgREST n'exprime qu'indirectement, et dont la forme embarquée produit
--   des doublons qu'il faudrait dédoublonner côté serveur.
--
--   Le projet a déjà ce précédent partout : skills, languages, work_modes,
--   cdi_sectors, cdi_contract_types sont des tableaux.
--
--   CONTREPARTIE, à traiter dans le même lot : un uuid[] ne porte pas de clé
--   étrangère. Supprimer une spécialité laisserait des identifiants fantômes.
--   Les routes admin `delete-speciality` et `delete-branch` DOIVENT donc
--   retirer l'identifiant des tableaux avant de supprimer la ligne. C'est le
--   prix de ce choix, et il est explicite.
--
-- SÉMANTIQUE D'UN ENSEMBLE VIDE — décision structurante
--   Un ensemble vide côté ANNONCE signifie « aucune contrainte sur cet axe »,
--   jamais « ne correspond à personne ». L'inverse ferait qu'une annonce
--   incomplètement remplie ne matcherait rien, en silence. Le filtre s'écrit
--   donc toujours :  annonce.axe = '{}'  OU  expert.axe && annonce.axe.
--   Côté EXPERT l'ensemble ne peut pas être vide : la contrainte de visibilité
--   ci-dessous l'interdit.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ ⚠️  CE QUE CETTE MIGRATION FAIT AUX DONNÉES EXISTANTES — À LIRE AVANT DE  ║
-- ║     LA REJOUER SUR UNE BASE QUI PORTE DE VRAIES ANNONCES ET DE VRAIS      ║
-- ║     PROFILS. Elle prend DEUX décisions à la place de leurs auteurs.       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
--   Les colonnes de zones, spécialités et séniorités viennent d'être créées :
--   aucune ligne existante ne peut donc satisfaire les contraintes posées plus
--   bas. Sans repli, la migration échoue et exige d'un opérateur qu'il répare
--   la base à la main avant de la rejouer — ce qui n'est pas une migration,
--   c'est un piège. Et sur une base réelle, « supprimez vos annonces
--   publiées » n'est pas une option.
--
--   ① ANNONCES DÉJÀ PUBLIÉES SANS ZONE  →  passées en « Monde entier ».
--
--      PERSONNE N'A DÉCIDÉ CELA. Ces annonces ont été publiées avant que le
--      champ existe, donc SANS restriction géographique : « le monde » est la
--      seule lecture honnête de leur état. Inventer une zone plus étroite
--      (le pays de l'organisation, par exemple) fabriquerait une décision que
--      leur auteur n'a jamais prise, et retirerait des experts de leur pool.
--      Le repli va donc TOUJOURS vers l'inclusion, jamais vers l'exclusion —
--      conformément à la règle « aucun profil n'est écarté sans une raison
--      nommable ». Une annonce trop large se corrige en l'éditant ; un expert
--      écarté par un repli ne le saurait jamais.
--
--      CONSÉQUENCE CONCRÈTE : ces annonces recouperont TOUS les experts, quelle
--      que soit leur zone déclarée. Le nombre exact de lignes touchées est
--      affiché en `notice` au passage de la migration. Si ce nombre est élevé
--      sur une base réelle, prévoyez de faire réviser ces annonces par leur
--      organisation APRÈS la migration — pas avant, la migration n'attend rien.
--
--   ② PROFILS DÉJÀ VISIBLES NE REMPLISSANT PAS LES NOUVEAUX CRITÈRES
--      →  passés en `visible = false`.
--
--      Rien n'est supprimé, mais CES EXPERTS DEVIENNENT INVISIBLES SANS ÊTRE
--      PRÉVENUS. C'est la bonne décision — un profil visible sans branche, sans
--      spécialité, sans zone ni résumé ne serait retenu par aucun filtre et
--      disparaîtrait du matching en silence, ce qui est pire — mais elle a un
--      coût humain : un expert qui se croyait référencé ne l'est plus.
--
--      SUR UNE BASE RÉELLE, cela demande un accompagnement que la migration ne
--      fournit pas : prévenir les experts concernés et leur dire quoi
--      compléter. Le nombre de profils masqués est affiché en `notice`.
--
--   Les deux replis sont IDEMPOTENTS : rejouer la migration ne touche plus
--   rien, puisque les lignes sont désormais conformes.
-- ─────────────────────────────────────────────────────────────────────────────

-- Séniorités admises. Liste reprise telle quelle du code existant
-- (SENIORITY_VALUES : junior, confirmed, senior, expert) — cette migration ne
-- change PAS le vocabulaire, seulement sa cardinalité.
-- Volontairement pas un ENUM : ajouter une valeur à un ENUM se fait hors
-- transaction sur certaines versions, un CHECK se remplace en une instruction.


-- ═══ PROFILS ════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists speciality_ids       uuid[]        not null default '{}',
  add column if not exists seniorities          text[]        not null default '{}',
  add column if not exists work_zone_ids        uuid[]        not null default '{}',
  -- DÉRIVÉE — jamais écrite à la main. Maintenue par le trigger plus bas à
  -- partir de work_zone_ids. C'est elle, et elle seule, que le filtre compare.
  add column if not exists work_zone_countries  varchar(2)[]  not null default '{}';

comment on column public.profiles.work_zone_countries is
  'DÉRIVÉE de work_zone_ids par trg_profiles_work_zones. Ne jamais écrire directement : '
  'toute écriture manuelle serait écrasée à la mise à jour suivante de work_zone_ids.';

alter table public.profiles
  drop constraint if exists profiles_seniorities_check;
alter table public.profiles
  add constraint profiles_seniorities_check
  check (seniorities <@ array['junior','confirmed','senior','expert']::text[]);


-- ═══ ANNONCES ═══════════════════════════════════════════════════════════════

alter table public.publications
  add column if not exists speciality_ids       uuid[]        not null default '{}',
  add column if not exists seniorities          text[]        not null default '{}',
  add column if not exists work_zone_ids        uuid[]        not null default '{}',
  add column if not exists work_zone_countries  varchar(2)[]  not null default '{}';

comment on column public.publications.work_zone_countries is
  'DÉRIVÉE de work_zone_ids par trg_publications_work_zones. Ne jamais écrire directement.';

alter table public.publications
  drop constraint if exists publications_seniorities_check;
alter table public.publications
  add constraint publications_seniorities_check
  check (seniorities <@ array['junior','confirmed','senior','expert']::text[]);

-- « Localisation » devient « Zones de travail » (structuré, filtrant) et le
-- champ texte libre survit UNIQUEMENT comme précision d'affichage
-- (« Paris ou Lyon »). Le renommage est délibérément cassant : il force chaque
-- lecteur à être revu, ce qu'un simple changement de libellé aurait laissé
-- passer en silence. `location_note` ne filtre rien et n'est PLUS envoyé à l'IA.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'publications'
                and column_name = 'location')
     and not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'publications'
                and column_name = 'location_note')
  then
    alter table public.publications rename column location to location_note;
  end if;
end
$$;

comment on column public.publications.location_note is
  'Précision d''affichage uniquement (« Paris ou Lyon »). NE FILTRE RIEN et n''est jamais '
  'envoyé à l''IA. Le critère géographique opposable est work_zone_ids / work_zone_countries.';


-- ═══ MAINTIEN DE LA COLONNE DÉRIVÉE ═════════════════════════════════════════
-- Un trigger, et non un calcul dans la route : la règle 20 veut la garantie au
-- serveur. Une route oubliée, un script d'admin, une correction manuelle —
-- aucun chemin d'écriture ne peut produire une dérivée incohérente.
create or replace function public.sync_work_zone_countries()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $fn$
begin
  new.work_zone_countries := public.work_zone_country_codes(new.work_zone_ids);
  return new;
end
$fn$;

create or replace trigger trg_profiles_work_zones
  before insert or update of work_zone_ids on public.profiles
  for each row execute function public.sync_work_zone_countries();

create or replace trigger trg_publications_work_zones
  before insert or update of work_zone_ids on public.publications
  for each row execute function public.sync_work_zone_countries();


-- ═══ SUPPRESSION DES COLONNES À VALEUR UNIQUE ═══════════════════════════════
-- Deux sources de vérité pour la même information sont une panne différée : le
-- jour où l'une des deux n'est plus écrite, personne ne le voit. Base de test,
-- donc suppression sèche.
--
-- ⚠️ EFFET DE BORD MAJEUR, à traiter dans le même lot de code : la suppression
--    de `speciality_id` retire la clé étrangère dont dépendent onze embeds
--    PostgREST `specialities(name)`. Ces lectures doivent passer par le cache de
--    taxonomie déjà chargé (loadTranslations / /api/taxonomy), qui résout
--    id -> libellé traduit sans jointure. C'est d'ailleurs préférable : cela
--    retire une jointure du chemin chaud du matching.
alter table public.profiles     drop column if exists speciality_id;
alter table public.profiles     drop column if exists seniority;
alter table public.publications drop column if exists speciality_id;
alter table public.publications drop column if exists seniority;


-- ═══ VISIBILITÉ : LES CRITÈRES DE MATCHING DEVIENNENT OBLIGATOIRES ══════════
-- La règle est déjà appliquée dans la route qui bascule `visible`. Elle est
-- REDITE ici en contrainte, parce qu'un profil visible sans critère est
-- exactement ce que le nouveau moteur ne sait pas traiter : il ne serait
-- retenu par aucun filtre et disparaîtrait sans que rien ne le signale.
-- Défense en profondeur, au sens de la règle 20.
--
-- La disponibilité est testée « au moins l'une des deux » : un freelance porte
-- availability_status, un salarié cdi_status, et une contrainte de table ne
-- peut pas joindre users.user_type. La route, elle, exige la bonne des deux.

-- Le défaut historique de `visible` est `true` : un profil neuf serait donc
-- visible sans avoir rien déclaré, ce que la règle interdit désormais.
alter table public.profiles alter column visible set default false;

-- LE RÉSUMÉ est un critère de visibilité au même titre que les autres, et il
-- l'est pour une raison mécanique : c'est le texte que le reranker lit pour
-- juger la pertinence. Un profil visible sans résumé serait soumis au moteur
-- avec presque rien à lire, donc mal classé — sans que ni l'expert ni personne
-- ne puisse dire pourquoi. La borne haute de 800 caractères est celle du
-- document envoyé au reranker ; la borne basse de 200 garantit qu'il y a
-- matière à juger.
--
-- La contrainte porte sur la VISIBILITÉ, jamais sur la ligne : un brouillon de
-- 2 000 caractères doit pouvoir être enregistré. C'est la route qui borne à la
-- saisie ; la base garantit seulement qu'aucun profil visible n'y échappe.

-- ── REPLI ① bis : mise en conformité des profils déjà visibles ─────────────
-- Sans elle, l'ajout de la contrainte échoue sur les lignes existantes. On rend
-- invisible ce qui ne remplit pas les critères, sans rien supprimer : l'expert
-- n'a qu'à compléter son profil pour redevenir visible.
--
-- Le compte est REMONTÉ en notice : des experts deviennent invisibles sans être
-- prévenus, et l'opérateur doit savoir combien (cf. ② de l'en-tête).
do $$
declare v_masques integer;
begin
  update public.profiles
     set visible = false
   where visible = true
     and (
          branch_id is null
       or coalesce(array_length(speciality_ids, 1), 0) = 0
       or coalesce(array_length(seniorities,    1), 0) = 0
       or coalesce(array_length(work_zone_ids,  1), 0) = 0
       or (availability_status is null and cdi_status is null)
       or summary is null
       or char_length(btrim(summary)) not between 200 and 800
     );
  get diagnostics v_masques = row_count;

  if v_masques > 0 then
    raise notice
      '[profil_annonce_multivalues] % profil(s) sont passés en invisible : ils ne remplissent pas '
      'les nouveaux critères de visibilité (branche, spécialités, séniorités, zones, disponibilité, '
      'résumé de 200 à 800 caractères). Rien n''est supprimé — ces experts redeviennent visibles en '
      'complétant leur profil, mais ILS NE SONT PAS PRÉVENUS. Voir ② dans l''en-tête.',
      v_masques;
  end if;
end
$$;

-- ── VÉRIFICATION avant de poser la contrainte ──────────────────────────────
-- La condition du repli ci-dessus et celle de la contrainte ci-dessous sont
-- deux écritures du MÊME prédicat, l'une en positif, l'autre en négatif. Deux
-- copies dérivent : le jour où l'une est modifiée sans l'autre, la migration
-- casse à nouveau sur un « SQLSTATE 23514 » que personne ne sait lire.
--
-- Ce bloc est le garde-fou contre cette dérive. Il échoue AVANT la contrainte,
-- en NOMMANT les lignes fautives — un message actionnable au lieu d'un code.
--
-- Seuls les identifiants sont cités : un message d'erreur peut atterrir dans un
-- journal, et rien de nominatif ne doit y transiter.
do $$
declare v_fautifs text; v_n integer;
begin
  select count(*), string_agg(id::text, ', ' order by id)
    into v_n, v_fautifs
    from public.profiles
   where visible = true
     and (
          branch_id is null
       or coalesce(array_length(speciality_ids, 1), 0) = 0
       or coalesce(array_length(seniorities,    1), 0) = 0
       or coalesce(array_length(work_zone_ids,  1), 0) = 0
       or (availability_status is null and cdi_status is null)
       or summary is null
       or char_length(btrim(summary)) not between 200 and 800
     );

  if v_n > 0 then
    raise exception
      -- AUCUN littéral E'...', AUCUN retour à la ligne. Volontairement.
      --
      -- PostgreSQL concatène deux constantes de chaîne séparées par un saut de
      -- ligne, MAIS la continuation doit être une chaîne SIMPLE : un E'...' en
      -- deuxième position est une ERREUR DE SYNTAXE (42601). C'est exactement
      -- ce qui a fait échouer le troisième push, sur ce bloc-ci.
      --
      -- Un message d'une seule ligne, identifiants séparés par des virgules,
      -- vaut mieux qu'une migration qui ne passe pas. Le contrôle qui interdit
      -- désormais ce motif vit dans scripts/diag-sql-litteraux.mjs.
      '[profil_annonce_multivalues] % profil(s) sont encore visibles sans remplir les critères '
      'APRÈS le repli — la contrainte profiles_visible_requiert_criteres_check ne peut pas être '
      'posée. Cause probable : le prédicat du repli et celui de la contrainte ont divergé. '
      'Profils concernés : %',
      v_n, v_fautifs;
  end if;
end
$$;

alter table public.profiles
  drop constraint if exists profiles_visible_requiert_criteres_check;
alter table public.profiles
  add constraint profiles_visible_requiert_criteres_check
  check (
    visible = false
    or (
          branch_id is not null
      and coalesce(array_length(speciality_ids, 1), 0) > 0
      and coalesce(array_length(seniorities,    1), 0) > 0
      and coalesce(array_length(work_zone_ids,  1), 0) > 0
      and (availability_status is not null or cdi_status is not null)
      and summary is not null
      and char_length(btrim(summary)) between 200 and 800
    )
  );

-- ── REPLI ① : les annonces DÉJÀ PUBLIÉES passent en « Monde entier » ───────
-- C'est la correction de l'échec constaté au premier push :
--   ERROR: check constraint "publications_publiee_requiert_zones_check" of
--   relation "publications" is violated by some row (SQLSTATE 23514)
--
-- Six annonces étaient publiées, et aucune ne POUVAIT porter de zone : la
-- colonne venait d'être créée. La contrainte les refusait, et la migration
-- exigeait qu'un opérateur répare la base à la main avant de la rejouer.
--
-- « Monde entier » plutôt qu'une zone déduite : ces annonces ont été publiées
-- sans restriction géographique, c'est leur état réel. Inventer plus étroit
-- fabriquerait une décision jamais prise et RETIRERAIT des experts du pool.
-- Le repli va vers l'inclusion, jamais vers l'exclusion. Détail en ① de l'en-tête.
--
-- Ne touche QUE les annonces publiées : un brouillon garde son champ vide, son
-- auteur peut encore le renseigner lui-même.
do $$
declare
  v_monde    uuid;
  v_touchees integer;
begin
  select id into v_monde from public.work_zones where code = 'WORLD';

  -- Garde-fou : sans cette zone, `array[null]` produirait un tableau de
  -- longueur 1 contenant NULL — la contrainte passerait, et les annonces
  -- porteraient une zone qui ne recoupe rien. Une panne silencieuse, exactement
  -- ce que ce lot supprime partout ailleurs.
  if v_monde is null then
    raise exception
      '[profil_annonce_multivalues] la zone racine « WORLD » est introuvable. '
      'La migration referentiel_zones_de_travail doit être appliquée AVANT celle-ci.';
  end if;

  update public.publications
     set work_zone_ids = array[v_monde]
   where status = 'published'
     and coalesce(array_length(work_zone_ids, 1), 0) = 0;
  get diagnostics v_touchees = row_count;

  if v_touchees > 0 then
    raise notice
      '[profil_annonce_multivalues] % annonce(s) déjà publiée(s) sans zone sont passées en '
      '« Monde entier ». PERSONNE N''A DÉCIDÉ CELA : elles recouperont désormais tous les experts, '
      'quelle que soit leur zone. À faire réviser par leur organisation. Voir ① dans l''en-tête.',
      v_touchees;
  end if;
end
$$;

-- ── VÉRIFICATION avant de poser la contrainte ──────────────────────────────
-- Même motif que côté profils : échouer AVANT la contrainte, avec un message
-- qui NOMME les lignes fautives plutôt qu'un code SQLSTATE illisible.
-- Le titre d'une annonce est une donnée d'entreprise, pas une donnée
-- personnelle : le citer aide l'opérateur sans rien exposer.
do $$
declare v_fautives text; v_n integer;
begin
  select count(*), string_agg(id::text || ' « ' || left(coalesce(title, ''), 60) || ' »', ' | ' order by id)
    into v_n, v_fautives
    from public.publications
   where status = 'published'
     and coalesce(array_length(work_zone_ids, 1), 0) = 0;

  if v_n > 0 then
    raise exception
      -- Même règle qu'au-dessus : aucun E'...', aucun retour à la ligne. Une
      -- continuation de littéral doit être une chaîne SIMPLE (cf. bloc profils).
      '[profil_annonce_multivalues] % annonce(s) publiée(s) n''ont toujours aucune zone de travail '
      'APRÈS le repli — la contrainte publications_publiee_requiert_zones_check ne peut pas être '
      'posée. Annonces concernées : %',
      v_n, v_fautives;
  end if;
end
$$;

-- Côté annonce, l'obligation ne vaut qu'à la PUBLICATION : un brouillon
-- incomplet doit pouvoir être enregistré.
-- Spécialités et séniorités ne sont volontairement PAS exigées ici — un
-- ensemble vide y signifie « aucune contrainte sur cet axe » (cf. en-tête).
-- Si Youssef décide de les rendre obligatoires aussi, il suffit d'ajouter les
-- deux conditions à cette contrainte ET au repli ci-dessus, ensemble.
alter table public.publications
  drop constraint if exists publications_publiee_requiert_zones_check;
alter table public.publications
  add constraint publications_publiee_requiert_zones_check
  check (
    status <> 'published'
    or coalesce(array_length(work_zone_ids, 1), 0) > 0
  );


-- ═══ INDEX DU CHEMIN CHAUD ══════════════════════════════════════════════════
-- Les trois axes de recoupement, en GIN : c'est ce qui rend `&&` utilisable sur
-- des dizaines de milliers de lignes.
create index if not exists profiles_speciality_ids_gin
  on public.profiles using gin (speciality_ids);
create index if not exists profiles_seniorities_gin
  on public.profiles using gin (seniorities);
create index if not exists profiles_work_zone_countries_gin
  on public.profiles using gin (work_zone_countries);

create index if not exists publications_speciality_ids_gin
  on public.publications using gin (speciality_ids);
create index if not exists publications_seniorities_gin
  on public.publications using gin (seniorities);
create index if not exists publications_work_zone_countries_gin
  on public.publications using gin (work_zone_countries);

-- Index de PARCOURS du pool. C'est LUI qu'on interroge pour savoir combien
-- d'experts une annonce soumet au reranking, et c'est donc ici que se lit la
-- taille du pool. Partiel : seules les lignes éligibles y figurent.
--
-- ┌─ CONDITION DE RETOUR D'UNE PRÉSÉLECTION ─────────────────────────────────┐
-- │ Aujourd'hui, TOUT le pool filtré est soumis au reranking : aucun plafond,│
-- │ donc aucun expert écarté sans raison nommable. C'est tenable parce que le│
-- │ reranking coûte ~0,72 $ par annonce à 12 000 experts.                    │
-- │                                                                          │
-- │ Ce n'est plus vrai au-delà d'environ 50 000 experts dans UN pool filtré :│
-- │ le reranking y dépasse 3 $ par annonce, et un plafond redevient          │
-- │ économiquement nécessaire. C'est ALORS, et alors seulement, qu'une étape │
-- │ de présélection (recherche lexicale et/ou vectorielle, fusion RRF) reprend│
-- │ son sens : elle sert à protéger le rappel LÀ OÙ L'ON TRONQUE. Tant qu'on │
-- │ ne tronque pas, le rappel est de 100 % par construction et cette étape   │
-- │ n'apporte rien — c'est pourquoi elle a été retirée de cette conception.  │
-- │                                                                          │
-- │ COMMENT SAVOIR QU'ON Y EST :                                             │
-- │   select count(*) from public.profiles                                   │
-- │    where visible and verification_status = 'approved'                    │
-- │      and cv_parsing_status = 'done' and ai_consent_at is not null        │
-- │    group by domain_id, branch_id order by 1 desc limit 5;                │
-- │ Le jour où la première ligne approche 50 000, relire ce commentaire.     │
-- └──────────────────────────────────────────────────────────────────────────┘
create index if not exists profiles_pool_matching_idx
  on public.profiles (domain_id, branch_id, id)
  where visible = true
    and verification_status = 'approved'
    and cv_parsing_status = 'done'
    and ai_consent_at is not null;


-- ═══ RECALCUL DES DÉRIVÉES ══════════════════════════════════════════════════
-- Les colonnes viennent d'être créées à '{}' ; les triggers ne se déclenchent
-- qu'à l'écriture. Cette affectation apparemment inutile (`x = x`) FAIT tourner
-- le trigger sur chaque ligne et remplit work_zone_countries. C'est aussi la
-- commande à rejouer après tout ajout de pays au référentiel.
update public.profiles     set work_zone_ids = work_zone_ids;
update public.publications set work_zone_ids = work_zone_ids;
